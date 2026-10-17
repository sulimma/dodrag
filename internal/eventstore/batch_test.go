package eventstore

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestBatchUndoRedo(t *testing.T) {
	s, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "batch.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, err = s.AppendEvent("e1", "TASK_CREATED", `{"taskId":"t1","title":"A","configuredStart":"2026-10-17T09:00:00Z","createdAt":"2026-10-17T09:00:00Z"}`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.AppendBatch([]Command{{ID: "e2", Type: "TASK_RENAMED", Payload: json.RawMessage(`{"taskId":"t1","title":"B"}`)}, {ID: "e3", Type: "TASK_START_DATE_SET", Payload: json.RawMessage(`{"taskId":"t1","configuredStart":"2026-10-18T09:00:00Z"}`)}})
	if err != nil {
		t.Fatal(err)
	}
	events, err := s.Undo()
	if err != nil {
		t.Fatal(err)
	}
	if events[0].Undone || !events[1].Undone || !events[2].Undone {
		t.Fatal("batch undo not atomic", events)
	}
	events, err = s.Redo()
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.Undone {
			t.Fatal("batch redo incomplete")
		}
	}
}
