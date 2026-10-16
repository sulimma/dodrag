package eventstore

import (
	"path/filepath"
	"testing"
)

func TestSQLiteEventStore(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test_dodrag.db")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	// Initial seeded events should exist
	events, err := store.GetEvents()
	if err != nil {
		t.Fatalf("GetEvents failed: %v", err)
	}
	initialCount := len(events)
	if initialCount == 0 {
		t.Fatalf("expected seeded events, got 0")
	}

	// Append a new event
	events, err = store.AppendEvent("test-ev-1", "TASK_RENAMED", `{"taskId":"26-101","title":"Geänderter Titel"}`)
	if err != nil {
		t.Fatalf("AppendEvent failed: %v", err)
	}
	if len(events) != initialCount+1 {
		t.Fatalf("expected %d events, got %d", initialCount+1, len(events))
	}

	// Undo the event
	events, err = store.Undo()
	if err != nil {
		t.Fatalf("Undo failed: %v", err)
	}
	last := events[len(events)-1]
	if !last.Undone {
		t.Fatalf("expected last event to be marked undone")
	}

	// Redo the event
	events, err = store.Redo()
	if err != nil {
		t.Fatalf("Redo failed: %v", err)
	}
	last = events[len(events)-1]
	if last.Undone {
		t.Fatalf("expected last event to be active after Redo")
	}

	// Coalesce test: another TASK_RENAMED on the same taskId within 60s should update the existing event instead of adding a new row
	events, err = store.AppendEvent("test-ev-2", "TASK_RENAMED", `{"taskId":"26-101","title":"Zweite Änderung innerhalb 1 Minute"}`)
	if err != nil {
		t.Fatalf("AppendEvent coalesced failed: %v", err)
	}
	if len(events) != initialCount+1 {
		t.Fatalf("expected coalesced event count to remain %d, got %d", initialCount+1, len(events))
	}
}
