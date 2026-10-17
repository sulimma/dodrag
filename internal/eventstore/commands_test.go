package eventstore

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
)

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
