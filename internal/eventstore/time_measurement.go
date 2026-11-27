package eventstore

import (
	"database/sql"
	"time"

	timemeasurement "dodrag/internal/plugins/time-measurement"
)

func (s *Store) timerNow() int64 {
	if s.timerClock != nil {
		return s.timerClock().UnixMilli()
	}
	return time.Now().UnixMilli()
}

func activeTimerTask(tx *sql.Tx, task timemeasurement.TaskIdentity) (bool, error) {
	var exists bool
	err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM events WHERE id=? AND type='TASK_CREATED' AND undone=0
   AND json_extract(payload,'$.taskId')=?)`, task.CreationEventID, task.ID).Scan(&exists)
	return exists, err
}

type timerChange func(*sql.Tx) (ownedID int64, discarded bool, err error)

// The result is read inside the transaction but not published until commit.
// Update the change stamp when possible, without hiding external event edits.
func (s *Store) timerState(change timerChange, readState bool) (timemeasurement.State, error) {
	if err := s.checkOpen(); err != nil {
		return timemeasurement.State{}, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return timemeasurement.State{}, err
	}
	defer rollbackCache(tx, s)
	ownedID := s.timerID
	var discarded bool
	var before, after changeStamp
	if change != nil {
		before, err = readChangeStamp(tx)
		if err != nil {
			return timemeasurement.State{}, err
		}
		if _, err := checkDatabaseVersion(tx, s.appVersion); err != nil {
			return timemeasurement.State{}, err
		}
		ownedID, discarded, err = change(tx)
		if err != nil {
			return timemeasurement.State{}, err
		}
		after, err = readChangeStamp(tx)
		if err != nil {
			return timemeasurement.State{}, err
		}
	}
	var state timemeasurement.State
	if readState {
		state, err = timemeasurement.ReadState(tx, ownedID)
		if err != nil {
			return state, err
		}
	}
	if err := tx.Commit(); err != nil {
		return timemeasurement.State{}, err
	}
	s.timerID = ownedID
	if change != nil && s.stamp == before {
		s.stamp = after
	}
	state.Discarded = discarded
	return state, nil
}

func (s *Store) TimeMeasurement() (timemeasurement.State, error) { return s.timerState(nil, true) }

func (s *Store) StartTimeMeasurement(task timemeasurement.TaskIdentity) (timemeasurement.State, error) {
	return s.timerState(func(tx *sql.Tx) (int64, bool, error) {
		// Consult the validated current task state and independently match its
		// immutable creation-event ID. Never use an undone branch's identity.
		working := *s
		if err := working.ensureCache(tx); err != nil {
			return s.timerID, false, err
		}
		active, err := activeTimerTask(tx, task)
		if err != nil {
			return s.timerID, false, err
		}
		if t := working.tasks[task.ID]; !active || t == nil || t.completed {
			return s.timerID, false, timemeasurement.ErrTask
		}
		return timemeasurement.Start(tx, s.timerID, task, s.timerNow())
	}, true)
}

func (s *Store) StopTimeMeasurement(id int64) (timemeasurement.State, error) {
	return s.finishTimeMeasurement(id, 0, false, false)
}

func (s *Store) RecoverTimeMeasurement(id, end int64, discard bool) (timemeasurement.State, error) {
	return s.finishTimeMeasurement(id, end, discard, true)
}

func (s *Store) finishTimeMeasurement(id, end int64, discard, recovery bool) (timemeasurement.State, error) {
	return s.timerState(func(tx *sql.Tx) (int64, bool, error) {
		open, err := timemeasurement.OpenSession(tx)
		if err != nil {
			return s.timerID, false, err
		}
		if open == nil || open.ID != id || recovery == (open.ID == s.timerID) {
			return s.timerID, false, timemeasurement.ErrSession
		}
		now := s.timerNow()
		if !recovery {
			end = now
		} else if !discard && end > now {
			return s.timerID, false, timemeasurement.ErrFutureEnd
		}
		discarded, err := timemeasurement.Stop(tx, *open, end, discard)
		return 0, discarded, err
	}, true)
}

// StopOwnedTimeMeasurement is used by native lifecycle transitions. An open
// row from another process lifetime is left for explicit recovery, not timed
// up to this shutdown or switch. No history read is needed to close.
func (s *Store) StopOwnedTimeMeasurement() error {
	if s.timerID == 0 {
		return nil
	}
	_, err := s.timerState(func(tx *sql.Tx) (int64, bool, error) {
		open, err := timemeasurement.OpenSession(tx)
		if err != nil {
			return s.timerID, false, err
		}
		if open == nil || open.ID != s.timerID {
			return 0, false, nil
		}
		discarded, err := timemeasurement.Stop(tx, *open, s.timerNow(), false)
		return 0, discarded, err
	}, false)
	return err
}

func (s *Store) UpdateTimeMeasurementEnd(id, end int64) (timemeasurement.State, error) {
	return s.timerState(func(tx *sql.Tx) (int64, bool, error) {
		return s.timerID, false, timemeasurement.EditEnd(tx, id, end, s.timerNow())
	}, true)
}

func (s *Store) DeleteTimeMeasurementSession(id int64) (timemeasurement.State, error) {
	return s.timerState(func(tx *sql.Tx) (int64, bool, error) {
		return s.timerID, false, timemeasurement.Delete(tx, id)
	}, true)
}

// Called only at the task append/Redo transaction boundary. If the task ID
// was reused on another branch, completing the new task cannot stop the old run.
func (s *Store) stopTimerForCompletions(tx *sql.Tx, completed map[string]bool) error {
	if s.timerID == 0 || len(completed) == 0 {
		return nil
	}
	open, err := timemeasurement.OpenSession(tx)
	if err != nil {
		return err
	}
	if open == nil || open.ID != s.timerID || !completed[open.TaskID] {
		return nil
	}
	matches, err := activeTimerTask(tx, timemeasurement.TaskIdentity{ID: open.TaskID, CreationEventID: open.TaskCreationEventID})
	if err != nil || !matches {
		return err
	}
	_, err = timemeasurement.Stop(tx, *open, s.timerNow(), false)
	if err == nil {
		s.timerID = 0
	}
	return err
}
