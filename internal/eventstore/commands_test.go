package eventstore

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestActivateWithOpenPredecessor(t *testing.T) {
	s, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "active.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	commands := []Command{
		{ID: "a", Type: "TASK_CREATED", Payload: json.RawMessage(`{"taskId":"a","title":"A","configuredStart":"2026-11-01T09:00:00Z","createdAt":"2026-10-17T09:00:00Z"}`)},
		{ID: "b", Type: "TASK_CREATED", Payload: json.RawMessage(`{"taskId":"b","title":"B","configuredStart":"2026-11-02T09:00:00Z","createdAt":"2026-10-17T09:00:00Z"}`)},
		{ID: "dep", Type: "DEPENDENCY_ADDED", Payload: json.RawMessage(`{"taskId":"b","predecessorId":"a"}`)},
		{ID: "active", Type: "TASK_ACTIVE_SET", Payload: json.RawMessage(`{"taskId":"b","isActive":true}`)},
	}
	if _, err := s.AppendBatch(commands); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendEvent("inactive", "TASK_ACTIVE_SET", `{"taskId":"b","isActive":false}`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	_, tasks, err := s.readReplay(s.db)
	if err != nil || !tasks["b"].active || len(tasks["b"].predecessors) != 1 || tasks["b"].start != "2026-11-02T09:00:00Z" {
		t.Fatal("activation lost on replay or altered stored scheduling", err)
	}
	if _, err := s.Redo(); err != nil {
		t.Fatal(err)
	}
	_, tasks, err = s.readReplay(s.db)
	if err != nil || tasks["b"].active {
		t.Fatal("deactivation not restored by redo", err)
	}
	if _, err := s.AppendEvent("done", "TASK_COMPLETED", `{"taskId":"b","completedAt":"2026-10-17T09:00:00Z"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendEvent("invalid", "TASK_ACTIVE_SET", `{"taskId":"b","isActive":true}`); err == nil {
		t.Fatal("completed task activated")
	}
}

func TestValidatedMutations(t *testing.T) {
	s, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "test.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	created := `{"taskId":"t1","title":"A","configuredStart":"2026-10-17T09:00:00Z","createdAt":"2026-10-17T09:00:00Z"}`
	if _, err = s.AppendEvent("e1", "TASK_CREATED", created); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []struct{ kind, payload string }{{"TASK_CREATED", created}, {"TASK_ACTIVE_SET", `{"taskId":"t1","isActive":"false"}`}, {"TASK_RENAMED", `{"taskId":"missing","title":"B"}`}, {"TASK_START_DATE_SET", `{"taskId":"t1","configuredStart":"2027-02-29T09:00:00Z"}`}} {
		if _, err = s.AppendEvent("bad", bad.kind, bad.payload); err == nil {
			t.Fatalf("accepted %s", bad.payload)
		}
	}
	rename := func(id, title, group string) []Event {
		ev, err := s.AppendBatch([]Command{{ID: id, Type: "TASK_RENAMED", Payload: json.RawMessage(`{"taskId":"t1","title":"` + title + `"}`), GroupID: group}})
		if err != nil {
			t.Fatal(err)
		}
		return ev
	}
	rename("e2", "B", "g1")
	ev := rename("e3", "C", "g1")
	if len(ev) != 2 {
		t.Fatal("explicit group did not coalesce")
	}
	before, err := s.Undo()
	if err != nil {
		t.Fatal(err)
	}
	noop, err := s.AppendEvent("no-op", "TASK_RENAMED", `{"taskId":"t1","title":"A"}`)
	if err != nil || !reflect.DeepEqual(before, noop) {
		t.Fatal("no-op changed history", err)
	}
	ev = rename("e4", "D", "g1")
	if len(ev) != 2 || ev[1].ID != "e4" {
		t.Fatal("undo did not close group")
	}
	before, _ = s.GetEvents()
	_, err = s.AppendBatch([]Command{{ID: "e5", Type: "TASK_RENAMED", Payload: json.RawMessage(`{"taskId":"t1","title":"E"}`)}, {ID: "e6", Type: "TASK_REOPENED", Payload: json.RawMessage(`{"taskId":"missing"}`)}})
	after, _ := s.GetEvents()
	if err == nil || !reflect.DeepEqual(before, after) {
		t.Fatal("batch did not roll back")
	}
	if _, err = s.db.Exec(`UPDATE events SET payload = '{' WHERE seq = 1`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.GetEvents(); err == nil {
		t.Fatal("accepted corrupt event")
	}
}

func TestMixedEditGroupBoundaries(t *testing.T) {
	s, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "groups.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	appendCommand := func(id, kind, payload, group string) []Event {
		events, err := s.AppendBatch([]Command{{ID: id, Type: kind, Payload: json.RawMessage(payload), GroupID: group}})
		if err != nil {
			t.Fatal(err)
		}
		return events
	}
	appendCommand("create", "TASK_CREATED", `{"taskId":"t1","title":"A","configuredStart":"2026-10-17T09:00:00Z","createdAt":"2026-10-17T09:00:00Z"}`, "")
	appendCommand("rename", "TASK_RENAMED", `{"taskId":"t1","title":"B"}`, "g")
	events := appendCommand("date", "TASK_START_DATE_SET", `{"taskId":"t1","configuredStart":"2026-10-18T09:00:00Z"}`, "g")
	if events[1].GroupID != events[2].GroupID {
		t.Fatal("rename and date split the external edit group", events)
	}
	events, err = s.Undo()
	if err != nil || events[0].Undone || !events[1].Undone || !events[2].Undone {
		t.Fatal("mixed edit not undone atomically", events, err)
	}
	if _, err := s.Redo(); err != nil {
		t.Fatal(err)
	}
	events = appendCommand("rename2", "TASK_RENAMED", `{"taskId":"t1","title":"C"}`, "g")
	if events[3].GroupID == events[1].GroupID {
		t.Fatal("redo did not close edit group")
	}
	appendCommand("active", "TASK_ACTIVE_SET", `{"taskId":"t1","isActive":true}`, "other")
	events = appendCommand("rename3", "TASK_RENAMED", `{"taskId":"t1","title":"D"}`, "g")
	if events[5].GroupID == events[3].GroupID {
		t.Fatal("interrupted group was reconnected")
	}
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	_, tasks, err := s.readReplay(s.db)
	if err != nil || tasks["t1"].title != "C" {
		t.Fatal("undo crossed interruption", err)
	}
	events = appendCommand("rename4", "TASK_RENAMED", `{"taskId":"t1","title":"E"}`, "g")
	if events[len(events)-1].GroupID == events[3].GroupID {
		t.Fatal("undo did not close edit group")
	}
}

func TestReplayFinalTopologyAndHistoryTargets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cycles.db")
	s, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	commands := []Command{
		{ID: "a", Type: "TASK_CREATED", Payload: json.RawMessage(`{"taskId":"a","title":"A","configuredStart":"2026-10-17T09:00:00Z","createdAt":"2026-10-17T09:00:00Z"}`)},
		{ID: "b", Type: "TASK_CREATED", Payload: json.RawMessage(`{"taskId":"b","title":"B","configuredStart":"2026-10-17T09:00:00Z","createdAt":"2026-10-17T09:00:00Z"}`)},
		{ID: "ab", Type: "DEPENDENCY_ADDED", Payload: json.RawMessage(`{"taskId":"b","predecessorId":"a"}`)},
		{ID: "ba", Type: "DEPENDENCY_ADDED", Payload: json.RawMessage(`{"taskId":"a","predecessorId":"b"}`)},
		{ID: "remove", Type: "DEPENDENCY_REMOVED", Payload: json.RawMessage(`{"taskId":"a","predecessorId":"b"}`)},
	}
	for _, command := range commands {
		if _, err := s.db.Exec(`INSERT INTO events(id,timestamp,type,payload) VALUES(?,?,?,?)`, command.ID, "2026-10-17T09:00:00Z", command.Type, string(command.Payload)); err != nil {
			t.Fatal(err)
		}
	}
	before, err := s.GetEvents()
	if err != nil {
		t.Fatal("rejected valid final graph after intermediate cycle", err)
	}
	if opened, err := NewStoreWithOptions(path, false); err != nil {
		t.Fatal("valid historical replay not activatable", err)
	} else {
		opened.Close()
	}
	if _, err := s.Undo(); err == nil {
		t.Fatal("undo accepted cyclic target")
	}
	after, err := s.GetEvents()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("failed undo wrote corrupt history", err)
	}
	if _, err := s.AppendBatch([]Command{
		{ID: "rename", Type: "TASK_RENAMED", Payload: json.RawMessage(`{"taskId":"a","title":"Changed"}`)},
		{ID: "new-cycle", Type: "DEPENDENCY_ADDED", Payload: commands[3].Payload},
		{ID: "new-remove", Type: "DEPENDENCY_REMOVED", Payload: commands[4].Payload},
	}); err == nil {
		t.Fatal("accepted newly cyclic command even though batch removed it later")
	}
	after, err = s.GetEvents()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("failed batch changed history", err)
	}
	if _, err := s.db.Exec(`DELETE FROM events WHERE id='remove'; UPDATE events SET undone=1 WHERE id='ba'`); err != nil {
		t.Fatal(err)
	}
	before, err = s.GetEvents()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Redo(); err == nil {
		t.Fatal("redo accepted cyclic target")
	}
	after, err = s.GetEvents()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("failed redo wrote corrupt history", err)
	}
	if _, err := s.db.Exec(`UPDATE events SET undone=0; INSERT INTO events(id,timestamp,type,payload) VALUES('done-a','2026-10-17T09:00:00Z','TASK_COMPLETED','{"taskId":"a","completedAt":"2026-10-17T09:00:00Z"}'),('done-b','2026-10-17T09:00:00Z','TASK_COMPLETED','{"taskId":"b","completedAt":"2026-10-17T09:00:00Z"}')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetEvents(); err == nil {
		t.Fatal("accepted final cycle involving completed tasks")
	}
	if opened, err := NewStoreWithOptions(path, false); err == nil {
		opened.Close()
		t.Fatal("activated corrupt final graph")
	}
}

func TestReplayTenThousandForwardAndReverse(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		t.Run(fmt.Sprintf("reverse=%v", reverse), func(t *testing.T) {
			s, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "chain.db"), false)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			tx, err := s.db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			insert, err := tx.Prepare(`INSERT INTO events(id,timestamp,type,payload) VALUES(?,'2026-10-17T09:00:00Z',?,?)`)
			if err != nil {
				t.Fatal(err)
			}
			defer insert.Close()
			for i := 0; i < 10000; i++ {
				payload := fmt.Sprintf(`{"taskId":"t%d","title":"Task","configuredStart":"2026-10-17T09:00:00Z","createdAt":"2026-10-17T09:00:00Z"}`, i)
				if _, err := insert.Exec(fmt.Sprintf("e%d", i), "TASK_CREATED", payload); err != nil {
					t.Fatal(err)
				}
			}
			for edge := 1; edge < 10000; edge++ {
				i := edge
				if reverse {
					i = 10000 - edge
				}
				if _, err := insert.Exec(fmt.Sprintf("d%d", i), "DEPENDENCY_ADDED", fmt.Sprintf(`{"taskId":"t%d","predecessorId":"t%d"}`, i, i-1)); err != nil {
					t.Fatal(err)
				}
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			start := time.Now()
			events, tasks, err := s.readReplay(s.db)
			t.Logf("replay %d events: %s", len(events), time.Since(start))
			if err != nil || len(tasks) != 10000 || !tasks["t9999"].predecessors["t9998"] {
				t.Fatal("incorrect deep replay", err)
			}
		})
	}
}

func TestPersistedTimestampConformance(t *testing.T) {
	cases := []struct {
		value string
		valid bool
	}{
		{"2026-10-17T09:00:00Z", true},
		{"2028-02-29T23:59:59.123456789+23:59", true},
		{"0000-01-01T00:00:00Z", true},
		{"9999-12-31T23:59:59-23:59", true},
		{"2026-10-17T09:00:00-00:00", true},
		{"2026-10-17T9:00:00Z", false},
		{"2026-10-17T09:00:00,1Z", false},
		{"2026-10-17T09:00:00+24:00", false},
		{"2026-10-17T09:00:00+00:60", false},
		{"2026-10-17T24:00:00Z", false},
		{"2026-10-17T09:60:00Z", false},
		{"2026-10-17T09:00:60Z", false},
		{"2027-02-29T09:00:00Z", false},
		{"2026-04-31T09:00:00Z", false},
		{"2026-00-01T09:00:00Z", false},
		{"2026-10-17T09:00:00.1234567890Z", false},
		{"2026-10-17t09:00:00z", false},
		{"2026-10-17T09:00:00", false},
	}
	for _, tc := range cases {
		t.Run(tc.value, func(t *testing.T) {
			if _, err := parseEventTime(tc.value); (err == nil) != tc.valid {
				t.Fatalf("timestamp valid=%v: %v", tc.valid, err)
			}
			payload, err := json.Marshal(map[string]string{"taskId": "a", "title": "A", "configuredStart": tc.value, "createdAt": tc.value})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := validatePayload("TASK_CREATED", payload); (err == nil) != tc.valid {
				t.Fatalf("payload valid=%v: %v", tc.valid, err)
			}
			path := filepath.Join(t.TempDir(), "time.db")
			s, err := NewStoreWithOptions(path, false)
			if err != nil {
				t.Fatal(err)
			}
			_, err = s.db.Exec(`INSERT INTO events(id,timestamp,type,payload) VALUES('a',?,'TASK_CREATED',?)`, tc.value, string(payload))
			s.Close()
			if err != nil {
				t.Fatal(err)
			}
			opened, err := NewStoreWithOptions(path, false)
			if opened != nil {
				opened.Close()
			}
			if (err == nil) != tc.valid {
				t.Fatalf("activation valid=%v: %v", tc.valid, err)
			}
		})
	}
}
