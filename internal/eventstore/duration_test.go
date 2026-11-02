package eventstore

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestTaskTimingValidation(t *testing.T) {
	for _, raw := range []string{
		`{"taskId":"a","duration":0,"durationUnit":"days","progress":null}`,
		`{"taskId":"a","duration":2,"durationUnit":"weeks","progress":null}`,
		`{"taskId":"a","duration":2,"durationUnit":"days","progress":-1}`,
		`{"taskId":"a","duration":2,"durationUnit":"days","progress":3}`,
		`{"taskId":"a","duration":2,"durationUnit":"days","progress":""}`,
		`{"taskId":"a","duration":2,"durationUnit":"days","extra":null}`,
		`{"taskId":"a","duration":36501,"durationUnit":"days","progress":null}`,
	} {
		if _, err := validatePayload("TASK_TIMING_SET", []byte(raw)); err == nil {
			t.Fatalf("accepted invalid timing %s", raw)
		}
	}
	for _, raw := range []string{
		`{"taskId":"a","duration":2.5,"durationUnit":"hours","progress":0.5}`,
		`{"taskId":"a","duration":45,"durationUnit":"minutes","progress":null}`,
		`{"taskId":"a","duration":4,"durationUnit":"days","progress":0}`,
	} {
		if _, err := validatePayload("TASK_TIMING_SET", []byte(raw)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestTaskTimingPersistenceHistoryAndSnapshots(t *testing.T) {
	path := filepath.Join(t.TempDir(), "duration.db")
	s, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	appendEvent := func(id, kind, raw string) {
		t.Helper()
		if _, err := s.AppendEvent(id, kind, raw); err != nil {
			t.Fatal(err)
		}
	}
	appendEvent("create", "TASK_CREATED", `{"taskId":"a","title":"A","configuredStart":"2026-11-02T09:00:00Z","createdAt":"2026-11-02T09:00:00Z"}`)
	check := func(duration float64, unit string, progress *float64) {
		t.Helper()
		_, tasks, err := s.readReplay(s.db)
		if err != nil {
			t.Fatal(err)
		}
		task := tasks["a"]
		if task.duration != duration || task.durationUnit != unit || ((task.progress == nil) != (progress == nil)) || (progress != nil && *task.progress != *progress) {
			t.Fatalf("unexpected task timing: %+v", task)
		}
		restored := makeSnapshot(tasks, 0).tasks()["a"]
		if restored.duration != duration || restored.durationUnit != unit || ((restored.progress == nil) != (progress == nil)) || (progress != nil && *restored.progress != *progress) {
			t.Fatalf("snapshot lost timing: %+v", restored)
		}
	}
	check(1, "days", nil)
	appendEvent("timing", "TASK_TIMING_SET", `{"taskId":"a","duration":4,"durationUnit":"days","progress":2}`)
	progress := 2.0
	check(4, "days", &progress)
	if _, err = s.Undo(); err != nil {
		t.Fatal(err)
	}
	check(1, "days", nil)
	if _, err = s.Redo(); err != nil {
		t.Fatal(err)
	}
	check(4, "days", &progress)
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	check(4, "days", &progress)
	before, _ := s.GetEvents()
	if _, err = s.AppendBatch([]Command{
		{ID: "good", Type: "TASK_TIMING_SET", Payload: json.RawMessage(`{"taskId":"a","duration":90,"durationUnit":"minutes","progress":null}`)},
		{ID: "bad", Type: "TASK_TIMING_SET", Payload: json.RawMessage(`{"taskId":"a","duration":0,"durationUnit":"minutes","progress":null}`)},
	}); err == nil {
		t.Fatal("invalid batch accepted")
	}
	after, _ := s.GetEvents()
	if len(after) != len(before) {
		t.Fatal("partial timing batch persisted")
	}
	check(4, "days", &progress)
	appendEvent("clear", "TASK_TIMING_SET", `{"taskId":"a","duration":90,"durationUnit":"minutes","progress":null}`)
	check(90, "minutes", nil)
}
