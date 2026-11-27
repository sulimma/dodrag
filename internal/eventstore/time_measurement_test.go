package eventstore

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	timemeasurement "dodrag/internal/plugins/time-measurement"
)

func timerFixture(t *testing.T) (*Store, string, *time.Time) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "timer.db")
	s, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	now := time.Date(2026, 11, 26, 9, 0, 0, 0, time.UTC)
	s.timerClock = func() time.Time { return now }
	return s, path, &now
}

func timerAddTask(t *testing.T, s *Store, id, creationID string) timemeasurement.TaskIdentity {
	t.Helper()
	if _, err := s.AppendEvent(creationID, "TASK_CREATED", fmt.Sprintf(`{"taskId":%q,"title":"Task","configuredStart":"2026-11-26T09:00:00Z","createdAt":"2026-11-26T09:00:00Z"}`, id)); err != nil {
		t.Fatal(err)
	}
	return timemeasurement.TaskIdentity{ID: id, CreationEventID: creationID}
}

func timerStart(t *testing.T, s *Store, task timemeasurement.TaskIdentity) timemeasurement.State {
	t.Helper()
	state, err := s.StartTimeMeasurement(task)
	if err != nil || state.Running == nil || !state.Running.Matches(task) {
		t.Fatalf("start: %+v %v", state, err)
	}
	return state
}

func timerRead(t *testing.T, s *Store) timemeasurement.State {
	t.Helper()
	state, err := s.TimeMeasurement()
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func TestTimeMeasurementCutoffAndHandoffRollback(t *testing.T) {
	s, _, now := timerFixture(t)
	a := timerAddTask(t, s, "a", "create-a")
	b := timerAddTask(t, s, "b", "create-b")
	first := timerStart(t, s, a).Running
	*now = now.Add(29_999 * time.Millisecond)
	again := timerStart(t, s, a).Running
	if again.ID != first.ID || again.StartMs != first.StartMs {
		t.Fatal("retry restarted timer")
	}
	state, err := s.StopTimeMeasurement(first.ID)
	if err != nil || !state.Discarded || len(state.Sessions) != 0 || state.Running != nil {
		t.Fatalf("short stop: %+v %v", state, err)
	}
	first = timerStart(t, s, a).Running
	*now = now.Add(30 * time.Second)
	if _, err = s.db.Exec(`CREATE TRIGGER reject_handoff BEFORE INSERT ON plugin_time_measurement_sessions BEGIN SELECT RAISE(ABORT, 'write failed'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.StartTimeMeasurement(b); err == nil {
		t.Fatal("accepted failed handoff")
	}
	state = timerRead(t, s)
	if state.Running == nil || state.Running.ID != first.ID || len(state.Sessions) != 0 {
		t.Fatalf("handoff partially committed: %+v", state)
	}
	if _, err = s.db.Exec(`DROP TRIGGER reject_handoff`); err != nil {
		t.Fatal(err)
	}
	state = timerStart(t, s, b)
	if len(state.Sessions) != 1 || *state.Sessions[0].EndMs != state.Running.StartMs || *state.Sessions[0].ElapsedMs != 30_000 {
		t.Fatalf("handoff did not share one timestamp: %+v", state)
	}
	if _, err = s.StopTimeMeasurement(first.ID); !errors.Is(err, timemeasurement.ErrSession) {
		t.Fatal("stale stop changed the new run", err)
	}
	if state = timerStart(t, s, a); !state.Discarded || len(state.Sessions) != 1 {
		t.Fatalf("short handoff saved history: %+v", state)
	}
}

func TestTimeMeasurementRecoveryAndHistory(t *testing.T) {
	s, path, now := timerFixture(t)
	a := timerAddTask(t, s, "a", "create-a")
	b := timerAddTask(t, s, "b", "create-b")
	first := timerStart(t, s, a).Running
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Hour)
	s, err := OpenExistingStore(path, BuildInfo{})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	s.timerClock = func() time.Time { return *now }
	if state := timerRead(t, s); state.Running != nil || state.Interrupted == nil || state.Interrupted.ID != first.ID {
		t.Fatalf("not interrupted: %+v", state)
	}
	if _, err := s.StartTimeMeasurement(b); !errors.Is(err, timemeasurement.ErrRecovery) {
		t.Fatal("start bypassed recovery", err)
	}
	if _, err := s.StopTimeMeasurement(first.ID); !errors.Is(err, timemeasurement.ErrSession) {
		t.Fatal("manual stop bypassed recovery", err)
	}
	if _, err := s.RecoverTimeMeasurement(first.ID, now.UnixMilli()+1, false); !errors.Is(err, timemeasurement.ErrFutureEnd) {
		t.Fatal("recovered in future", err)
	}
	state, err := s.RecoverTimeMeasurement(first.ID, first.StartMs+30_000, false)
	if err != nil || state.Interrupted != nil || len(state.Sessions) != 1 || *state.Sessions[0].ElapsedMs != 30_000 {
		t.Fatalf("recovery used wrong end: %+v %v", state, err)
	}
	second := timerStart(t, s, b).Running
	*now = now.Add(time.Minute)
	tests := []struct {
		end  int64
		want error
	}{
		{first.StartMs + 29_999, timemeasurement.ErrShortEdit},
		{now.UnixMilli() + 1, timemeasurement.ErrFutureEnd},
		{second.StartMs + 1, timemeasurement.ErrOverlap},
	}
	for _, tt := range tests {
		if _, err := s.UpdateTimeMeasurementEnd(first.ID, tt.end); !errors.Is(err, tt.want) {
			t.Fatal("wrong rejection", err, tt.want)
		}
		if got := *timerRead(t, s).Sessions[0].ElapsedMs; got != 30_000 {
			t.Fatal("failed edit changed original", got)
		}
	}
	if _, err := s.UpdateTimeMeasurementEnd(first.ID, second.StartMs); err != nil {
		t.Fatal("touching boundaries overlap", err)
	}
	if _, err := s.StopTimeMeasurement(second.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteTimeMeasurementSession(second.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = OpenExistingStore(path, BuildInfo{})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if state := timerRead(t, s); len(state.Sessions) != 1 || *state.Sessions[0].EndMs != second.StartMs {
		t.Fatalf("history changes did not persist: %+v", state)
	}
}

func TestTimeMeasurementDiscardInterruptedShortOrExplicit(t *testing.T) {
	for _, discard := range []bool{false, true} {
		t.Run(fmt.Sprint(discard), func(t *testing.T) {
			s, path, now := timerFixture(t)
			a := timerAddTask(t, s, "a", "create-a")
			open := timerStart(t, s, a).Running
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			s, err := OpenExistingStore(path, BuildInfo{})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			*now = now.Add(time.Hour)
			s.timerClock = func() time.Time { return *now }
			if err := s.StopOwnedTimeMeasurement(); err != nil || timerRead(t, s).Interrupted == nil {
				t.Fatal("lifecycle resolved interrupted row", err)
			}
			state, err := s.RecoverTimeMeasurement(open.ID, open.StartMs+29_999, discard)
			if err != nil || !state.Discarded || state.Interrupted != nil || len(state.Sessions) != 0 {
				t.Fatalf("recovery discard: %+v %v", state, err)
			}
		})
	}
}

func TestTimeMeasurementTaskIdentitySurvivesBranchReplacement(t *testing.T) {
	s, _, now := timerFixture(t)
	old := timerAddTask(t, s, "a", "create-old")
	first := timerStart(t, s, old).Running
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	if got := timerRead(t, s).Running; got == nil || got.ID != first.ID {
		t.Fatal("undo changed timer")
	}
	replacement := timerAddTask(t, s, "a", "create-new")
	if _, err := s.StartTimeMeasurement(old); !errors.Is(err, timemeasurement.ErrTask) {
		t.Fatal("stale identity accepted", err)
	}
	*now = now.Add(time.Minute)
	if _, err := s.AppendEvent("close-new", "TASK_COMPLETED", `{"taskId":"a","completedAt":"2026-11-26T09:01:00Z"}`); err != nil {
		t.Fatal(err)
	}
	if got := timerRead(t, s).Running; got == nil || !got.Matches(old) {
		t.Fatal("replacement completed old timer")
	}
	if _, err := s.StartTimeMeasurement(replacement); !errors.Is(err, timemeasurement.ErrTask) {
		t.Fatal("started completed task", err)
	}
	state, err := s.StopTimeMeasurement(first.ID)
	if err != nil || len(state.Sessions) != 1 || state.Sessions[0].Matches(replacement) {
		t.Fatalf("history transferred: %+v %v", state, err)
	}
}

func TestTimeMeasurementCompletionAndRedoAreAtomic(t *testing.T) {
	s, _, now := timerFixture(t)
	a := timerAddTask(t, s, "a", "create-a")
	_ = timerAddTask(t, s, "b", "create-b")
	first := timerStart(t, s, a).Running
	*now = now.Add(time.Minute)
	batch := []Command{
		{ID: "complete-b", Type: "TASK_COMPLETED", Payload: json.RawMessage(`{"taskId":"b","completedAt":"2026-11-26T09:01:00Z"}`)},
		{ID: "complete-a", Type: "TASK_COMPLETED", Payload: json.RawMessage(`{"taskId":"a","completedAt":"2026-11-26T09:01:00Z"}`)},
	}
	block := func() {
		t.Helper()
		if _, err := s.db.Exec(`CREATE TRIGGER reject_stop BEFORE UPDATE ON plugin_time_measurement_sessions BEGIN SELECT RAISE(ABORT,'stop failed'); END`); err != nil {
			t.Fatal(err)
		}
	}
	unblock := func() {
		t.Helper()
		if _, err := s.db.Exec(`DROP TRIGGER reject_stop`); err != nil {
			t.Fatal(err)
		}
	}
	block()
	if _, err := s.AppendBatch(batch); err == nil {
		t.Fatal("completed despite timer write failure")
	}
	events, err := s.GetEvents()
	if err != nil || len(events) != 2 || timerRead(t, s).Running.ID != first.ID {
		t.Fatalf("failed batch partially committed: %v %v", events, err)
	}
	unblock()
	if _, err := s.AppendBatch(batch); err != nil {
		t.Fatal(err)
	}
	state := timerRead(t, s)
	if state.Running != nil || len(state.Sessions) != 1 || *state.Sessions[0].ElapsedMs != 60_000 {
		t.Fatalf("batch failed to stop: %+v", state)
	}
	if _, err := s.Undo(); err != nil || timerRead(t, s).Running != nil {
		t.Fatal("undo restarted timer", err)
	}
	second := timerStart(t, s, a).Running
	*now = now.Add(time.Minute)
	block()
	if _, err := s.Redo(); err == nil {
		t.Fatal("reapplied completion despite stop failure")
	}
	events, err = s.GetEvents()
	if err != nil || len(events) != 4 || !events[2].Undone || !events[3].Undone || timerRead(t, s).Running.ID != second.ID {
		t.Fatalf("failed redo partially committed: %v %v", events, err)
	}
	unblock()
	if _, err := s.Redo(); err != nil {
		t.Fatal(err)
	}
	state = timerRead(t, s)
	if state.Running != nil || len(state.Sessions) != 2 || state.Sessions[0].ID != second.ID {
		t.Fatalf("redo failed to stop: %+v", state)
	}
}

func TestTimeMeasurementShortCompletionAndRedo(t *testing.T) {
	s, _, now := timerFixture(t)
	a := timerAddTask(t, s, "a", "create-a")
	timerStart(t, s, a)
	*now = now.Add(29_999 * time.Millisecond)
	if _, err := s.AppendEvent("complete-a", "TASK_COMPLETED", `{"taskId":"a","completedAt":"2026-11-26T09:00:29.999Z"}`); err != nil {
		t.Fatal(err)
	}
	if state := timerRead(t, s); state.Running != nil || len(state.Sessions) != 0 {
		t.Fatal("completion saved short run", state)
	}
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	timerStart(t, s, a)
	*now = now.Add(29_999 * time.Millisecond)
	if _, err := s.Redo(); err != nil {
		t.Fatal(err)
	}
	if state := timerRead(t, s); state.Running != nil || len(state.Sessions) != 0 {
		t.Fatal("redo saved short run", state)
	}
}

func TestTimeMeasurementMigrationAndSingleOpenConstraint(t *testing.T) {
	path := versionFixture(t, "0.8.0")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE INDEX plugin_time_measurement_one_open ON events(type)`); err != nil {
		t.Fatal(err)
	}
	if s, err := OpenExistingStore(path, BuildInfo{}); err == nil {
		s.Close()
		t.Fatal("migration unexpectedly succeeded")
	}
	var count int
	var floor string
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE name IN ('plugin_time_measurement_schema','plugin_time_measurement_sessions')`).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed migration left plugin schema", count, err)
	}
	if err := db.QueryRow(`SELECT minimum_app_version FROM database_metadata`).Scan(&floor); err != nil || floor != "0.8.0" {
		t.Fatal("failed migration changed format floor", floor, err)
	}
	if _, err := db.Exec(`DROP INDEX plugin_time_measurement_one_open`); err != nil {
		t.Fatal(err)
	}
	s, err := OpenExistingStore(path, BuildInfo{Version: MinimumAppVersion + "rc"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := db.QueryRow(`SELECT minimum_app_version FROM database_metadata`).Scan(&floor); err != nil || floor != "0.9.0" {
		t.Fatal("successful migration did not raise format floor", floor, err)
	}
	if _, err := db.Exec(`INSERT INTO plugin_time_measurement_sessions (task_id, task_creation_event_id, start_utc_ms) VALUES ('a','old',1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO plugin_time_measurement_sessions (task_id, task_creation_event_id, start_utc_ms) VALUES ('b','other',2)`); err == nil {
		t.Fatal("SQLite allowed two open rows")
	}
}
