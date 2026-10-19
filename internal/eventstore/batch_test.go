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

func TestMultipleTaskDependenciesAreAtomic(t *testing.T) {
	s, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "tasks.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, id := range []string{"a", "b", "c"} {
		payload, err := json.Marshal(map[string]string{"taskId": id, "title": id, "configuredStart": "2026-10-19T09:00:00Z", "createdAt": "2026-10-19T09:00:00Z"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.AppendEvent("create-"+id, "TASK_CREATED", string(payload)); err != nil {
			t.Fatal(err)
		}
	}
	// A becomes the common predecessor of B and C in one undoable step.
	events, err := s.AppendBatch([]Command{
		{ID: "a-b", Type: "DEPENDENCY_ADDED", Payload: json.RawMessage(`{"taskId":"b","predecessorId":"a"}`)},
		{ID: "a-c", Type: "DEPENDENCY_ADDED", Payload: json.RawMessage(`{"taskId":"c","predecessorId":"a"}`)},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 5 || events[3].GroupID != events[4].GroupID {
		t.Fatal("dependencies not grouped", events)
	}
	// The first addition is valid, but the second creates a cycle: neither persists.
	if _, err := s.AppendBatch([]Command{
		{ID: "b-c", Type: "DEPENDENCY_ADDED", Payload: json.RawMessage(`{"taskId":"c","predecessorId":"b"}`)},
		{ID: "c-a", Type: "DEPENDENCY_ADDED", Payload: json.RawMessage(`{"taskId":"a","predecessorId":"c"}`)},
	}); err == nil {
		t.Fatal("cyclic batch accepted")
	}
	events, err = s.Undo()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 5 || !events[3].Undone || !events[4].Undone || events[2].Undone {
		t.Fatal("failed batch persisted or successful batch undo split", events)
	}
	events, err = s.Redo()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 5 || events[3].Undone || events[4].Undone {
		t.Fatal("dependency batch redo split", events)
	}
	for _, commands := range [][]Command{
		{
			{ID: "postpone-b", Type: "TASK_START_DATE_SET", Payload: json.RawMessage(`{"taskId":"b","configuredStart":"2026-10-20T09:00:00Z"}`)},
			{ID: "postpone-c", Type: "TASK_START_DATE_SET", Payload: json.RawMessage(`{"taskId":"c","configuredStart":"2026-10-20T09:00:00Z"}`)},
		},
		{
			{ID: "complete-b", Type: "TASK_COMPLETED", Payload: json.RawMessage(`{"taskId":"b","completedAt":"2026-10-19T12:00:00Z"}`)},
			{ID: "complete-c", Type: "TASK_COMPLETED", Payload: json.RawMessage(`{"taskId":"c","completedAt":"2026-10-19T12:00:00Z"}`)},
		},
	} {
		events, err = s.AppendBatch(commands)
		if err != nil {
			t.Fatal(err)
		}
		last := len(events) - 1
		if events[last].GroupID != events[last-1].GroupID {
			t.Fatal("task action not grouped", events)
		}
		events, err = s.Undo()
		if err != nil {
			t.Fatal(err)
		}
		if !events[last].Undone || !events[last-1].Undone || events[last-2].Undone {
			t.Fatal("task action undo split", events)
		}
		events, err = s.Redo()
		if err != nil {
			t.Fatal(err)
		}
		if events[last].Undone || events[last-1].Undone {
			t.Fatal("task action redo split", events)
		}
	}
}
