package eventstore

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestTimeMarkersPersistAndPreserveUndoRedo(t *testing.T) {
	path := filepath.Join(t.TempDir(), "markers.db")
	store, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { store.Close() }()
	appendEvent := func(id, kind, payload string) {
		t.Helper()
		if _, err := store.AppendEvent(id, kind, payload); err != nil {
			t.Fatal(err)
		}
	}
	appendEvent("task", "TASK_CREATED", `{"taskId":"A","title":"A","configuredStart":"2026-11-12T09:00:00Z","createdAt":"2026-11-11T09:00:00Z"}`)
	appendEvent("defaults", "TIME_DAY_INITIALIZED", `{"dateKey":"2026-11-12","minutes":[720,900]}`)
	_, err = store.AppendBatch([]Command{
		{ID: "marker", Type: "TIME_MARKER_CREATED", Payload: json.RawMessage(`{"markerId":"m","dateKey":"2026-11-12","minute":780}`)},
		{ID: "bind", Type: "TASK_TIME_MARKER_SET", Payload: json.RawMessage(`{"taskId":"A","markerId":"m"}`)},
	})
	if err != nil {
		t.Fatal(err)
	}
	events, err := store.Undo()
	if err != nil {
		t.Fatal(err)
	}
	state, err := replayTimeline(events)
	if err != nil || state.bindings["A"] != "" || !state.days["2026-11-12"] {
		t.Fatal("invalid undo", state, err)
	}
	appendEvent("next-day", "TIME_DAY_INITIALIZED", `{"dateKey":"2026-11-13","minutes":[]}`)
	events, err = store.Redo()
	if err != nil {
		t.Fatal(err)
	}
	state, err = replayTimeline(events)
	if err != nil || state.bindings["A"] != "m" || !state.days["2026-11-13"] {
		t.Fatal("initialization lost redo", err)
	}
	appendEvent("edit", "TIME_MARKER_SET", `{"markerId":"m","minute":810}`)
	if _, err := store.AppendEvent("cross", "TIME_MARKER_SET", `{"markerId":"m","minute":920}`); err == nil {
		t.Fatal("accepted crossed marker")
	}
	if _, err := store.AppendEvent("bad-binding", "TASK_TIME_MARKER_SET", `{"taskId":"A","markerId":"missing"}`); err == nil {
		t.Fatal("accepted absent marker")
	}
	appendEvent("remove", "TIME_MARKER_REMOVED", `{"markerId":"m"}`)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	events, tasks, err := store.readReplay(store.db)
	if err != nil {
		t.Fatal(err)
	}
	state, err = replayTimeline(events)
	if err != nil || !state.markers["m"].removed || tasks["A"].start != "2026-11-12T09:00:00Z" {
		t.Fatal("lost markers or configured start", err)
	}
	events, err = store.Undo()
	if err != nil {
		t.Fatal(err)
	}
	state, err = replayTimeline(events)
	if err != nil || state.markers["m"].removed || state.markers["m"].minute != 810 {
		t.Fatal("failed marker restore", err)
	}
}
func TestTaskReorderDoesNotAlterDependenciesOrDates(t *testing.T) {
	store, err := NewStoreWithOptions(filepath.Join(t.TempDir(), "order.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for _, id := range []string{"A", "B"} {
		if _, err := store.AppendEvent(id, "TASK_CREATED", `{"taskId":"`+id+`","title":"Task","configuredStart":"2026-11-12T09:00:00Z","createdAt":"2026-11-11T09:00:00Z"}`); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.AppendEvent("dep", "DEPENDENCY_ADDED", `{"taskId":"B","predecessorId":"A"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AppendEvent("move", "TASK_REORDERED", `{"taskId":"B","relativeTaskId":"A","side":"before"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AppendEvent("bad", "TASK_REORDERED", `{"taskId":"B","relativeTaskId":"missing","side":"before"}`); err == nil {
		t.Fatal("accepted unknown order anchor")
	}
	_, tasks, err := store.readReplay(store.db)
	if err != nil || !tasks["B"].predecessors["A"] || tasks["B"].start != "2026-11-12T09:00:00Z" {
		t.Fatal("order changed scheduling", err)
	}
	events, err := store.Undo()
	if err != nil || !events[len(events)-1].Undone {
		t.Fatal("order undo failed", err)
	}
}
