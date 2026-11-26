// Package timemeasurement owns the timer schema and operations. Its caller
// owns the database connection and all transaction boundaries.
package timemeasurement

import (
	"database/sql"
	"errors"
	"fmt"
)

const ID = "time-measurement"
const schemaVersion = 1
const minimumElapsedMs = 30_000

var (
	ErrTask      = errors.New("the task is unavailable or completed")
	ErrRecovery  = errors.New("the interrupted session must be resolved first")
	ErrSession   = errors.New("the time measurement session is unavailable")
	ErrFutureEnd = errors.New("the end time is in the future")
	ErrShortEdit = errors.New("a saved session must be at least 30 seconds")
	ErrOverlap   = errors.New("the session overlaps another session")
)

// All stored timestamps are UTC Unix milliseconds. Intervals are half open.
func Migrate(tx *sql.Tx) error {
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS plugin_time_measurement_schema (
    id INTEGER PRIMARY KEY CHECK (id=1), version INTEGER NOT NULL
 )`); err != nil {
		return err
	}
	var version int
	err := tx.QueryRow(`SELECT version FROM plugin_time_measurement_schema WHERE id=1`).Scan(&version)
	if err == nil {
		if version != schemaVersion {
			return fmt.Errorf("unsupported time measurement schema version: %d", version)
		}
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err := tx.Exec(fmt.Sprintf(`CREATE TABLE plugin_time_measurement_sessions (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   task_id TEXT NOT NULL,
   task_creation_event_id TEXT NOT NULL,
   start_utc_ms INTEGER NOT NULL,
   end_utc_ms INTEGER,
   elapsed_ms INTEGER,
   CHECK ((end_utc_ms IS NULL AND elapsed_ms IS NULL) OR
          (end_utc_ms IS NOT NULL AND elapsed_ms IS NOT NULL AND
           elapsed_ms = end_utc_ms - start_utc_ms AND elapsed_ms >= %d))
 )`, minimumElapsedMs)); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE UNIQUE INDEX plugin_time_measurement_one_open
    ON plugin_time_measurement_sessions ((1)) WHERE end_utc_ms IS NULL`); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO plugin_time_measurement_schema (id,version) VALUES (1,?)`, schemaVersion)
	return err
}

type TaskIdentity struct {
	ID              string
	CreationEventID string
}

type Session struct {
	ID                  int64  `json:"id"`
	TaskID              string `json:"taskId"`
	TaskCreationEventID string `json:"taskCreationEventId"`
	StartMs             int64  `json:"startMs"`
	EndMs               *int64 `json:"endMs"`
	ElapsedMs           *int64 `json:"elapsedMs"`
}

func (s Session) Matches(task TaskIdentity) bool {
	return s.TaskID == task.ID && s.TaskCreationEventID == task.CreationEventID
}

type State struct {
	Running     *Session  `json:"running"`
	Interrupted *Session  `json:"interrupted"`
	Sessions    []Session `json:"sessions"`
	Discarded   bool      `json:"discarded"`
}

func ReadState(tx *sql.Tx, ownedID int64) (State, error) {
	state := State{Sessions: []Session{}}
	rows, err := tx.Query(`SELECT id, task_id, task_creation_event_id, start_utc_ms, end_utc_ms, elapsed_ms
     FROM plugin_time_measurement_sessions ORDER BY start_utc_ms DESC, id DESC`)
	if err != nil {
		return state, err
	}
	defer rows.Close()
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.ID, &s.TaskID, &s.TaskCreationEventID, &s.StartMs, &s.EndMs, &s.ElapsedMs); err != nil {
			return state, err
		}
		switch {
		case s.EndMs != nil:
			state.Sessions = append(state.Sessions, s)
		case s.ID == ownedID:
			state.Running = &s
		default:
			state.Interrupted = &s
		}
	}
	return state, rows.Err()
}

func OpenSession(tx *sql.Tx) (*Session, error) {
	var s Session
	err := tx.QueryRow(`SELECT id, task_id, task_creation_event_id, start_utc_ms
     FROM plugin_time_measurement_sessions WHERE end_utc_ms IS NULL`).Scan(&s.ID, &s.TaskID, &s.TaskCreationEventID, &s.StartMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

func Start(tx *sql.Tx, ownedID int64, task TaskIdentity, now int64) (int64, bool, error) {
	open, err := OpenSession(tx)
	if err != nil {
		return ownedID, false, err
	}
	var discarded bool
	if open != nil {
		if open.ID != ownedID {
			return ownedID, false, ErrRecovery
		}
		if open.Matches(task) {
			return ownedID, false, nil
		}
		discarded, err = Stop(tx, *open, now, false)
		if err != nil {
			return ownedID, false, err
		}
	}
	// Reject a backwards clock jump into saved history; a later normal stop
	// must not produce an interval overlapping already-counted work.
	if err := checkOverlap(tx, 0, now, nil); err != nil {
		return ownedID, false, err
	}
	result, err := tx.Exec(`INSERT INTO plugin_time_measurement_sessions (task_id,task_creation_event_id,start_utc_ms) VALUES (?,?,?)`, task.ID, task.CreationEventID, now)
	if err != nil {
		return ownedID, false, err
	}
	id, err := result.LastInsertId()
	return id, discarded, err
}

// Stop is the sole short-run policy boundary, shared by every stop reason.
func Stop(tx *sql.Tx, open Session, end int64, discard bool) (bool, error) {
	if discard || tooShort(open.StartMs, end) {
		_, err := tx.Exec(`DELETE FROM plugin_time_measurement_sessions WHERE id=? AND end_utc_ms IS NULL`, open.ID)
		return true, err
	}
	if err := checkOverlap(tx, open.ID, open.StartMs, &end); err != nil {
		return false, err
	}
	return false, updateEnd(tx, open.ID, open.StartMs, end)
}

func EditEnd(tx *sql.Tx, id, end, now int64) error {
	var start int64
	err := tx.QueryRow(`SELECT start_utc_ms FROM plugin_time_measurement_sessions WHERE id=? AND end_utc_ms IS NOT NULL`, id).Scan(&start)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrSession
	}
	if err != nil {
		return err
	}
	if end > now {
		return ErrFutureEnd
	}
	if tooShort(start, end) {
		return ErrShortEdit
	}
	if err := checkOverlap(tx, id, start, &end); err != nil {
		return err
	}
	return updateEnd(tx, id, start, end)
}

func tooShort(start, end int64) bool { return end < start || end-start < minimumElapsedMs }

func checkOverlap(tx *sql.Tx, id, start int64, end *int64) error {
	var exists bool
	err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM plugin_time_measurement_sessions WHERE id<>?
     AND (? IS NULL OR start_utc_ms < ?) AND (end_utc_ms IS NULL OR end_utc_ms > ?))`, id, end, end, start).Scan(&exists)
	if err != nil {
		return err
	}
	if exists {
		return ErrOverlap
	}
	return nil
}

func updateEnd(tx *sql.Tx, id, start, end int64) error {
	_, err := tx.Exec(`UPDATE plugin_time_measurement_sessions SET end_utc_ms=?, elapsed_ms=? WHERE id=?`, end, end-start, id)
	return err
}

func Delete(tx *sql.Tx, id int64) error {
	result, err := tx.Exec(`DELETE FROM plugin_time_measurement_sessions WHERE id=? AND end_utc_ms IS NOT NULL`, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count != 1 {
		return ErrSession
	}
	return err
}
