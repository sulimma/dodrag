package eventstore

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func performanceCommands(count int) []Command {
	commands := make([]Command, count)
	for i := range commands {
		kind := "TASK_DESCRIPTION_SET"
		payload := fmt.Sprintf(`{"taskId":"t%d","description":"description %d"}`, i%100, i)
		if i < 100 {
			kind = "TASK_CREATED"
			payload = fmt.Sprintf(`{"taskId":"t%d","title":"Task %d","configuredStart":"2026-10-25T09:00:00+02:00","createdAt":"2026-10-25T07:00:00.123456789Z"}`, i, i)
		} else if i%3 == 0 {
			kind = "TASK_LOG_ADDED"
			payload = fmt.Sprintf(`{"taskId":"t%d","entryId":"log%d","text":"note %d","createdAt":"2026-10-24T07:00:00.123456789Z"}`, i%100, i, i)
		} else if i%3 == 1 {
			kind = "TASK_RENAMED"
			payload = fmt.Sprintf(`{"taskId":"t%d","title":"Title %d"}`, i%100, i)
		}
		commands[i] = Command{ID: fmt.Sprintf("e%d", i), Type: kind, Payload: json.RawMessage(payload)}
	}
	return commands
}

func assertCacheOracle(t *testing.T, s *Store) {
	t.Helper()
	events, tasks, err := s.readReplay(s.db)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(events, s.events) || !reflect.DeepEqual(tasks, s.tasks) {
		t.Fatal("cache differs from full replay oracle")
	}
	fromSnapshot, err := s.replayFromSnapshot(events, 0)
	if err != nil || !reflect.DeepEqual(tasks, fromSnapshot) {
		t.Fatal("snapshot plus tail differs from full replay", err)
	}
	for seq, state := range s.snapshots {
		prefix := events[:sortIndex(events, seq)+1]
		_, prefixTasks, err := replayPrefix(prefix)
		if err != nil || !reflect.DeepEqual(prefixTasks, state.tasks()) {
			t.Fatalf("snapshot %d differs from prefix: %v", seq, err)
		}
	}
}

func sortIndex(events []Event, seq int64) int {
	for i, event := range events {
		if event.Seq == seq {
			return i
		}
	}
	return -1
}

func replayPrefix(events []Event) ([]Event, map[string]*task, error) {
	tasks, err := replayEvents(events, nil, 0)
	return events, tasks, err
}

func TestSnapshotsFiveThousandHistoryCoalescingAndPrune(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshots.db")
	s, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	if _, err := s.AppendBatch(performanceCommands(5000)); err != nil {
		t.Fatal(err)
	}
	if len(s.snapshots) != 5 {
		t.Fatal("retention should keep latest five snapshots", len(s.snapshots))
	}
	assertCacheOracle(t, s)
	// Give imported fixture events individual history boundaries.
	if _, err := s.db.Exec(`UPDATE events SET group_id='edit-' || id`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetEvents(); err != nil {
		t.Fatal(err)
	}
	assertCacheOracle(t, s)
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.snapshots[5000]; ok {
		t.Fatal("undo did not invalidate snapshot at earliest changed seq")
	}
	assertCacheOracle(t, s)
	if _, err := s.Redo(); err != nil {
		t.Fatal(err)
	}
	assertCacheOracle(t, s)
	// A batch crossing a checkpoint followed by coalescing at that checkpoint.
	extra := make([]Command, 499)
	for i := range extra {
		extra[i] = Command{ID: fmt.Sprintf("extra%d", i), Type: "TASK_DESCRIPTION_SET", Payload: json.RawMessage(fmt.Sprintf(`{"taskId":"t0","description":"extra %d"}`, i))}
	}
	if _, err := s.AppendBatch(extra); err != nil {
		t.Fatal(err)
	}
	rename := func(id, title string) {
		t.Helper()
		if _, err := s.AppendBatch([]Command{{ID: id, Type: "TASK_RENAMED", GroupID: "coalescing", Payload: json.RawMessage(`{"taskId":"t0","title":"` + title + `"}`)}}); err != nil {
			t.Fatal(err)
		}
	}
	rename("boundary", "first")
	if _, ok := s.snapshots[5500]; !ok {
		t.Fatal("checkpoint missing")
	}
	rename("coalesced", "second")
	if len(s.events) != 5500 || s.events[5499].ID != "boundary" {
		t.Fatal("coalescing appended a new event")
	}
	if s.snapshots[5500].Tasks["t0"].Title != "second" {
		t.Fatal("coalescing left stale checkpoint")
	}
	assertCacheOracle(t, s)
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendEvent("branch", "TASK_RENAMED", `{"taskId":"t0","title":"branch"}`); err != nil {
		t.Fatal(err)
	}
	if s.ids["boundary"] {
		t.Fatal("pruned event ID retained")
	}
	assertCacheOracle(t, s)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	assertCacheOracle(t, s)
	// Restored DTOs must remain independent of cached snapshot objects.
	_, state := s.bestSnapshot(s.events, 0)
	copy := state.tasks()
	copy["t0"].title = "foreign"
	copy["t0"].predecessors["t1"] = true
	if state.Tasks["t0"].Title == "foreign" || state.Tasks["t0"].Predecessors["t1"] {
		t.Fatal("snapshot DTO aliases replay state")
	}
}

func TestCacheCOWRollbackNoopPayloadIsolationAndClosed(t *testing.T) {
	s, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "cow.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.AppendBatch(performanceCommands(100)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendBatch([]Command{{ID: "edit", Type: "TASK_RENAMED", GroupID: "g", Payload: json.RawMessage(`{"taskId":"t0","title":"first"}`)}}); err != nil {
		t.Fatal(err)
	}
	beforeEvents := copyEvents(s.events)
	beforeTasks := cloneTasks(s.tasks)
	untouched := s.tasks["t1"]
	if _, err := s.AppendBatch([]Command{
		{ID: "bad-log", Type: "TASK_LOG_ADDED", Payload: json.RawMessage(`{"taskId":"t0","entryId":"n","text":"note","createdAt":"2026-10-25T07:00:00Z"}`)},
		{ID: "bad-pred", Type: "DEPENDENCY_ADDED", Payload: json.RawMessage(`{"taskId":"t0","predecessorId":"t1"}`)},
		{ID: "bad-missing", Type: "TASK_REOPENED", Payload: json.RawMessage(`{"taskId":"missing"}`)},
	}); err == nil {
		t.Fatal("invalid COW batch accepted")
	}
	if !reflect.DeepEqual(beforeEvents, s.events) || !reflect.DeepEqual(beforeTasks, s.tasks) || s.ids["bad-log"] || s.groupID != "g" {
		t.Fatal("failed batch changed cache")
	}
	if s.tasks["t1"] != untouched {
		t.Fatal("failed COW batch copied untouched task")
	}
	// Force a SQLite write failure after validation; rollback must retain edit grouping.
	if _, err := s.db.Exec(`CREATE TRIGGER reject_write BEFORE INSERT ON events WHEN new.id='reject' BEGIN SELECT RAISE(ABORT,'injected'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetEvents(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendBatch([]Command{{ID: "edit2", Type: "TASK_RENAMED", GroupID: "g", Payload: json.RawMessage(`{"taskId":"t0","title":"second"}`)}}); err != nil {
		t.Fatal(err)
	}
	untouched = s.tasks["t1"]
	beforeEvents = copyEvents(s.events)
	beforeTasks = cloneTasks(s.tasks)
	beforeGroup := s.groupID
	if _, err := s.AppendBatch([]Command{
		{ID: "valid-first", Type: "TASK_DESCRIPTION_SET", Payload: json.RawMessage(`{"taskId":"t0","description":"must rollback"}`)},
		{ID: "reject", Type: "TASK_RENAMED", Payload: json.RawMessage(`{"taskId":"t0","title":"rejected"}`)},
	}); err == nil {
		t.Fatal("injected write accepted")
	}
	if !reflect.DeepEqual(beforeEvents, s.events) || !reflect.DeepEqual(beforeTasks, s.tasks) || s.groupID != beforeGroup {
		t.Fatal("SQL rollback changed cache")
	}
	if _, err := s.AppendBatch([]Command{{ID: "noop", Type: "TASK_RENAMED", GroupID: "other", Payload: json.RawMessage(`{"taskId":"t0","title":"second"}`)}}); err != nil {
		t.Fatal(err)
	}
	if s.ids["noop"] || s.groupID != "g" {
		t.Fatal("no-op consumed ID or interrupted group")
	}
	raw := json.RawMessage(`{"taskId":"t0","title":"third"}`)
	events, err := s.AppendBatch([]Command{{ID: "edit3", Type: "TASK_RENAMED", GroupID: "g", Payload: raw}})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != len(beforeEvents) || s.tasks["t1"] != untouched {
		t.Fatal("rollback closed group or copied untouched task")
	}
	raw[0] = '!'
	events[0].Payload[0] = '!'
	events[len(events)-1].Payload[0] = '!'
	events[0].ID = "foreign"
	assertCacheOracle(t, s)
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	undone := copyEvents(s.events)
	if _, err := s.AppendEvent("noop-redo", "TASK_RENAMED", `{"taskId":"t0","title":"first"}`); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(undone, s.events) {
		t.Fatal("no-op pruned redo")
	}
	if _, err := s.Redo(); err != nil {
		t.Fatal(err)
	}
	assertCacheOracle(t, s)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal("Close not idempotent", err)
	}
	for _, run := range []func() ([]Event, error){s.GetEvents, s.Undo, s.Redo, func() ([]Event, error) { return s.AppendBatch(nil) }} {
		if _, err := run(); err == nil || !strings.Contains(err.Error(), "closed") {
			t.Fatal("closed store accepted operation", err)
		}
	}
}

func TestLegacyUTCNormalizationTransactional(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(fmt.Sprint(corrupt), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "legacy.db")
			s, err := NewStoreWithOptions(path, false)
			if err != nil {
				t.Fatal(err)
			}
			legacy := []Command{
				{ID: "create", Type: "TASK_CREATED", Payload: json.RawMessage(`{ "taskId":"a", "title":"Title +02:00 2026-10-25T09:00:00+02:00", "configuredStart":"2026-10-25T09:00:00+02:00", "createdAt":"2026-10-25T09:00:00.123456789+02:00" }`)},
				{ID: "log", Type: "TASK_LOG_ADDED", Payload: json.RawMessage(`{"taskId":"a","entryId":"n","text":"text +02:00","createdAt":"2026-10-25T03:00:00.987654321-04:00"}`)},
				{ID: "done", Type: "TASK_COMPLETED", Payload: json.RawMessage(`{"taskId":"a","completedAt":"2026-10-25T08:00:00.123456789+01:00"}`)},
				{ID: "rename", Type: "TASK_RENAMED", Payload: json.RawMessage(`{ "taskId":"a", "title":"unchanged" }`)},
			}
			for _, command := range legacy {
				if _, err := s.db.Exec(`INSERT INTO events(id,timestamp,type,payload) VALUES(?,'2026-10-25T09:00:00.123456789+02:00',?,?)`, command.ID, command.Type, string(command.Payload)); err != nil {
					t.Fatal(err)
				}
			}
			if corrupt {
				if _, err := s.db.Exec(`UPDATE events SET payload='{"taskId":"missing","title":"bad"}' WHERE id='rename'`); err != nil {
					t.Fatal(err)
				}
			}
			s.Close()
			opened, err := NewStoreWithOptions(path, false)
			if corrupt {
				if err == nil {
					opened.Close()
					t.Fatal("migration bypassed semantic validation")
				}
				db, _ := sql.Open("sqlite", path)
				defer db.Close()
				var timestamp, payload string
				if err := db.QueryRow(`SELECT timestamp,payload FROM events WHERE id='create'`).Scan(&timestamp, &payload); err != nil {
					t.Fatal(err)
				}
				if timestamp != "2026-10-25T09:00:00.123456789+02:00" || payload != string(legacy[0].Payload) {
					t.Fatal("failed migration partially committed")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer opened.Close()
			for i, event := range opened.events {
				if event.Timestamp != "2026-10-25T07:00:00.123456789Z" {
					t.Fatal("timestamp lost nanoseconds", event.Timestamp)
				}
				var p, old map[string]interface{}
				json.Unmarshal(event.Payload, &p)
				json.Unmarshal(legacy[i].Payload, &old)
				for _, field := range []string{"title", "configuredStart", "text"} {
					if !reflect.DeepEqual(p[field], old[field]) {
						t.Fatal("migration rewrote user data", field)
					}
				}
				if i == 0 && p["createdAt"] != "2026-10-25T07:00:00.123456789Z" {
					t.Fatal("creation precision", p)
				}
				if i == 1 && p["createdAt"] != "2026-10-25T07:00:00.987654321Z" {
					t.Fatal("log precision", p)
				}
				if i == 2 && p["completedAt"] != "2026-10-25T07:00:00.123456789Z" {
					t.Fatal("completion precision", p)
				}
				if i == 3 && string(event.Payload) != string(legacy[i].Payload) {
					t.Fatal("unaffected payload rewritten")
				}
			}
			assertCacheOracle(t, opened)
		})
	}
}

func TestCorruptSnapshotsFallbackAndExternalEventsNeverTrusted(t *testing.T) {
	for _, corruption := range []string{"json", "version", "forged", "orphan", "schema", "old-invalid-payload", "old-invalid-semantics", "undone-invalid", "external"} {
		t.Run(corruption, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "corrupt.db")
			s, err := NewStoreWithOptions(path, false)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			if _, err := s.AppendBatch(performanceCommands(1000)); err != nil {
				t.Fatal(err)
			}
			original := cloneTasks(s.tasks)
			query := `UPDATE event_snapshots SET state_json='{' WHERE seq=1000`
			switch corruption {
			case "version":
				query = `UPDATE event_snapshots SET state_json=json_set(state_json,'$.version',999)`
			case "forged":
				query = `UPDATE event_snapshots SET state_json=json_set(state_json,'$.tasks.t0.title','forged')`
			case "orphan":
				query = `INSERT INTO event_snapshots(seq,state_json) SELECT 999999,state_json FROM event_snapshots LIMIT 1`
			case "schema":
				query = `DROP TABLE event_snapshots; CREATE TABLE event_snapshots(seq TEXT,state_json BLOB)`
			case "old-invalid-payload":
				query = `UPDATE events SET payload='{' WHERE seq=1`
			case "old-invalid-semantics":
				query = `UPDATE events SET payload='{"taskId":"missing","title":"bad"}',type='TASK_RENAMED' WHERE seq=1`
			case "undone-invalid":
				query = `UPDATE events SET payload='{' ,undone=1 WHERE seq=1`
			case "external":
				query = `UPDATE events SET payload='{' WHERE seq=1`
			}
			if corruption == "external" {
				db, err := sql.Open("sqlite", path)
				if err != nil {
					t.Fatal(err)
				}
				_, err = db.Exec(query)
				db.Close()
				if err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := s.db.Exec(query); err != nil {
					t.Fatal(err)
				}
			}
			invalidEvent := strings.Contains(corruption, "invalid") || corruption == "external"
			for attempt := 0; attempt < 2; attempt++ {
				_, err := s.GetEvents()
				if invalidEvent {
					if err == nil {
						t.Fatal("cache hid invalid authoritative event")
					}
				} else {
					if err != nil {
						t.Fatal("derived cache corruption rejected authoritative history", err)
					}
					if !reflect.DeepEqual(original, s.tasks) {
						t.Fatal("untrusted snapshot changed task state")
					}
					assertCacheOracle(t, s)
				}
			}
			opened, err := NewStoreWithOptions(path, false)
			if invalidEvent {
				if err == nil {
					opened.Close()
					t.Fatal("coldstart snapshot hid invalid old event")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				assertCacheOracle(t, opened)
				opened.Close()
			}
		})
	}
}

func TestSnapshotCoarseRetention(t *testing.T) {
	s, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "retention.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.AppendBatch(performanceCommands(10000)); err != nil {
		t.Fatal(err)
	}
	if len(s.snapshots) != 6 || s.snapshots[5000].Count != 5000 || s.snapshots[10000].Count != 10000 {
		t.Fatal("coarse 5000 retention", len(s.snapshots))
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM event_snapshots`).Scan(&count); err != nil || count != 6 {
		t.Fatal("persistent retention", count, err)
	}
	assertCacheOracle(t, s)
}

func TestMigrationTokenPreservationAmbiguityAndNanosecondBounds(t *testing.T) {
	raw := []byte(`{ "title":"keep \\ and \u0041", "createdAt" : "2026-10-25T23:59:00.000000001+23:59", "configuredStart":"2026-10-25T23:59:00+23:59" }`)
	got, err := normalizePayloadTime(raw, "createdAt")
	want := strings.Replace(string(raw), `"2026-10-25T23:59:00.000000001+23:59"`, `"2026-10-25T00:00:00.000000001Z"`, 1)
	if err != nil || string(got) != want {
		t.Fatal("migration altered non-time bytes", string(got), err)
	}
	for _, bad := range []string{
		`{"createdAt":"2026-10-25T09:00:00+02:00","createdAt":"2026-10-25T09:00:00Z"}`,
		`{"createdAt":"2026-10-25T09:00:00+02:00","created\u0041t":"2026-10-25T09:00:00Z"}`,
		`{"createdAt":"2026-10-25T09:00:00+02:00","title":"` + string([]byte{255}) + `"}`,
		`{"createdAt":"9999-12-31T23:59:59-23:59"}`,
		`{"createdAt":"0000-01-01T00:00:00+23:59"}`,
	} {
		if _, err := normalizePayloadTime([]byte(bad), "createdAt"); err == nil {
			t.Fatal("unsafe migration accepted", bad)
		}
	}
}

func TestNoncontiguousGroupInvalidatesEarliestSnapshot(t *testing.T) {
	s, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "noncontiguous.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.AppendBatch(performanceCommands(1001)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE events SET group_id='edit-' || id; UPDATE events SET group_id='G' WHERE seq IN (499,1001)`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetEvents(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	if !s.events[498].Undone || !s.events[1000].Undone || s.events[749].Undone || len(s.snapshots) != 0 {
		t.Fatal("noncontiguous group did not invalidate from seq499")
	}
	assertCacheOracle(t, s)
	if _, err := s.Redo(); err != nil {
		t.Fatal(err)
	}
	assertCacheOracle(t, s)
}

func TestSnapshotWriteAndHistoryRollbackAreCommitOnly(t *testing.T) {
	for _, action := range []string{"insert", "delete", "prune"} {
		t.Run(action, func(t *testing.T) {
			s, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "rollback.db"), false)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			count := 499
			if action != "insert" {
				count = 1000
			}
			if _, err := s.AppendBatch(performanceCommands(count)); err != nil {
				t.Fatal(err)
			}
			if _, err := s.db.Exec(`UPDATE events SET group_id='edit-' || id`); err != nil {
				t.Fatal(err)
			}
			trigger := `CREATE TRIGGER reject_snapshot BEFORE INSERT ON event_snapshots BEGIN SELECT RAISE(ABORT,'snapshot failure'); END`
			if action == "delete" {
				trigger = `CREATE TRIGGER reject_snapshot BEFORE DELETE ON event_snapshots BEGIN SELECT RAISE(ABORT,'snapshot failure'); END`
			}
			if action == "prune" {
				if _, err := s.Undo(); err != nil {
					t.Fatal(err)
				}
				trigger = `CREATE TRIGGER reject_snapshot BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'after prune'); END`
			}
			if _, err := s.db.Exec(trigger); err != nil {
				t.Fatal(err)
			}
			if _, err := s.GetEvents(); err != nil {
				t.Fatal(err)
			}
			beforeEvents := copyEvents(s.events)
			beforeTasks := cloneTasks(s.tasks)
			beforeSnapshots := make(map[int64]snapshotState)
			for seq, state := range s.snapshots {
				beforeSnapshots[seq] = state
			}
			beforeGroup := s.groupID
			if action == "delete" {
				_, err = s.Undo()
			} else {
				_, err = s.AppendEvent("checkpoint", "TASK_RENAMED", `{"taskId":"t0","title":"checkpoint"}`)
			}
			if err == nil {
				t.Fatal("injected snapshot/prune error ignored")
			}
			if !reflect.DeepEqual(beforeEvents, s.events) || !reflect.DeepEqual(beforeTasks, s.tasks) || !reflect.DeepEqual(beforeSnapshots, s.snapshots) || s.groupID != beforeGroup || s.ids["checkpoint"] {
				t.Fatal("rejected transaction published cache")
			}
			assertCacheOracle(t, s)
			if _, err := s.db.Exec(`DROP TRIGGER reject_snapshot`); err != nil {
				t.Fatal(err)
			}
			if action == "delete" {
				_, err = s.Undo()
			} else {
				_, err = s.AppendEvent("checkpoint", "TASK_RENAMED", `{"taskId":"t0","title":"checkpoint"}`)
			}
			if err != nil {
				t.Fatal("recovery after rollback failed", err)
			}
			assertCacheOracle(t, s)
		})
	}
}

func TestReopenClosesGroupAndCoalescingSQLRollback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.db")
	s, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	if _, err := s.AppendBatch(performanceCommands(100)); err != nil {
		t.Fatal(err)
	}
	rename := func(id, title string) error {
		_, err := s.AppendBatch([]Command{{ID: id, Type: "TASK_RENAMED", GroupID: "session", Payload: json.RawMessage(`{"taskId":"t0","title":"` + title + `"}`)}})
		return err
	}
	if err := rename("first", "first"); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := rename("second", "second"); err != nil {
		t.Fatal(err)
	}
	if len(s.events) != 102 || s.events[100].GroupID == s.events[101].GroupID {
		t.Fatal("reopen reconnected caller session")
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_coalescing BEFORE UPDATE ON events WHEN json_extract(new.payload,'$.title')='rejected' BEGIN SELECT RAISE(ABORT,'coalescing failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetEvents(); err != nil {
		t.Fatal(err)
	}
	// Re-establish the group after external schema invalidation.
	if err := rename("establish", "establish"); err != nil {
		t.Fatal(err)
	}
	before := copyEvents(s.events)
	if err := rename("rejected", "rejected"); err == nil {
		t.Fatal("coalescing update failure ignored")
	}
	if !reflect.DeepEqual(before, s.events) || s.tasks["t0"].title != "establish" || s.groupID != "session" {
		t.Fatal("coalescing rollback changed cache")
	}
	if err := rename("recovery", "recovery"); err != nil {
		t.Fatal(err)
	}
	if len(before) != len(s.events) {
		t.Fatal("coalescing rollback interrupted session")
	}
	assertCacheOracle(t, s)
}
