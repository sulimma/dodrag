package eventstore

import (
	"fmt"
	"path/filepath"
	"testing"
)

func TestProjectsReplayMembershipAndUndo(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.db")
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
	const assign = `{"projectId":"p","taskId":"A","assigned":true}`
	if _, err := store.AppendEvent("missing", "PROJECT_MEMBER_SET", assign); err == nil {
		t.Fatal("accepted missing project")
	}
	appendEvent("project", "PROJECT_SAVED", `{"projectId":"p","code":"IT","color":"#2288bb","summary":"Technology","description":""}`)
	appendEvent("assign", "PROJECT_MEMBER_SET", assign)
	appendEvent("remove", "PROJECT_MEMBER_SET", `{"projectId":"p","taskId":"A","assigned":false}`)
	if _, err := store.Undo(); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	events, err := store.GetEvents()
	if err != nil {
		t.Fatal(err)
	}
	state, err := replayProjects(events)
	if err != nil || !state.members[[2]string{"p", "A"}] {
		t.Fatal("membership not restored", err)
	}
	events, err = store.Redo()
	if err != nil {
		t.Fatal(err)
	}
	state, err = replayProjects(events)
	if err != nil || state.members[[2]string{"p", "A"}] {
		t.Fatal("membership not removed", err)
	}
}

func TestDeleteProjectKeepsTasksAndOtherMemberships(t *testing.T) {
	path := filepath.Join(t.TempDir(), "delete.db")
	store, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"AA", "BB"} {
		if _, err := store.AppendEvent("p"+code, "PROJECT_SAVED", fmt.Sprintf(`{"projectId":%q,"code":%q,"color":"#777777","description":"","summary":""}`, code, code)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.AppendBatch([]Command{
		{ID: "t", Type: "TASK_CREATED", Payload: []byte(`{"taskId":"T","title":"Task","createdAt":"2026-11-01T00:00:00Z","configuredStart":"2026-11-01T00:00:00Z"}`)},
		{ID: "a", Type: "PROJECT_MEMBER_SET", Payload: []byte(`{"taskId":"T","projectId":"AA","assigned":true}`)},
		{ID: "b", Type: "PROJECT_MEMBER_SET", Payload: []byte(`{"taskId":"T","projectId":"BB","assigned":true}`)},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.DeleteProject("AA"); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	events, err := store.GetEvents()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 || events[0].ID != "pBB" || events[1].ID != "t" || events[2].ID != "b" {
		t.Fatal(events)
	}
	if _, err = store.Undo(); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Redo(); err != nil {
		t.Fatal(err)
	}
}
