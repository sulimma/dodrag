package eventstore

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestDescriptionPayloadByteLimit(t *testing.T) {
	for _, tc := range []struct {
		name, value string
		valid       bool
	}{
		{"empty", "", true},
		{"ascii-limit", strings.Repeat("a", maxDescriptionBytes), true},
		{"ascii-over", strings.Repeat("a", maxDescriptionBytes+1), false},
		{"utf8-limit", strings.Repeat("\u00e9", maxDescriptionBytes/2), true},
		{"utf8-over", strings.Repeat("\u00e9", maxDescriptionBytes/2) + "a", false},
		{"four-byte-limit", strings.Repeat("\U00010000", maxDescriptionBytes/4), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			payload, err := json.Marshal(map[string]string{"taskId": "a", "description": tc.value})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := validatePayload("TASK_DESCRIPTION_SET", payload); (err == nil) != tc.valid {
				t.Fatalf("valid=%v: %v", tc.valid, err)
			}
		})
	}
	for _, raw := range []string{
		`{"taskId":"a","description":null}`,
		`{"taskId":"a","description":"","extra":true}`,
		`{"taskId":"a","description":"` + string([]byte{0xff}) + `"}`,
	} {
		if _, err := validatePayload("TASK_DESCRIPTION_SET", []byte(raw)); err == nil {
			t.Fatal("accepted invalid description payload")
		}
	}
}

func TestLogPayloadValidation(t *testing.T) {
	base := map[string]string{"taskId": "a", "entryId": "note-1", "text": " note\n", "createdAt": "2028-02-29T23:59:59.123456789Z"}
	for _, tc := range []struct {
		field, value string
	}{
		{"entryId", ""}, {"entryId", "constructor"}, {"entryId", "__proto__"},
		{"entryId", "note space"}, {"entryId", strings.Repeat("a", 129)},
		{"text", ""}, {"text", " \t\r\n"},
		{"createdAt", "2027-02-29T09:00:00Z"}, {"createdAt", "2026-10-17T09:00:00"},
		{"createdAt", "2026-10-17T09:00:00+24:00"},
		{"createdAt", "2026-10-17T09:00:00+02:00"},
	} {
		payload := make(map[string]string)
		for key, value := range base {
			payload[key] = value
		}
		payload[tc.field] = tc.value
		raw, _ := json.Marshal(payload)
		if _, err := validatePayload("TASK_LOG_ADDED", raw); err == nil {
			t.Fatalf("accepted %s=%q", tc.field, tc.value)
		}
	}
	raw, _ := json.Marshal(base)
	if payload, err := validatePayload("TASK_LOG_ADDED", raw); err != nil || payload["text"] != base["text"] {
		t.Fatal("valid log rejected or stored text rewritten", err)
	}
}

func TestLogRemovalPayloadValidation(t *testing.T) {
	if _, err := validatePayload("TASK_LOG_REMOVED", []byte(`{"taskId":"a","entryId":"note-1"}`)); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{
		`{"taskId":"a"}`, `{"taskId":"a","entryId":null}`,
		`{"taskId":"a","entryId":""}`, `{"taskId":"a","entryId":"constructor"}`,
		`{"taskId":"a","entryId":"__proto__"}`, `{"taskId":"a","entryId":"space id"}`,
		`{"taskId":"missing task","entryId":"note"}`, `{"taskId":"a","entryId":"note","text":"extra"}`,
	} {
		if _, err := validatePayload("TASK_LOG_REMOVED", []byte(raw)); err == nil {
			t.Fatalf("accepted invalid removal payload: %s", raw)
		}
	}
}

func TestLogRemovalHistoryAndNoOp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "log-removal.db")
	s, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	appendEvent := func(id, kind, payload string) []Event {
		events, err := s.AppendEvent(id, kind, payload)
		if err != nil {
			t.Fatal(err)
		}
		return events
	}
	for _, id := range []string{"a", "b"} {
		appendEvent("create-"+id, "TASK_CREATED", `{"taskId":"`+id+`","title":"Task","configuredStart":"2026-10-17T09:00:00Z","createdAt":"2026-10-17T09:00:00Z"}`)
		appendEvent("first-"+id, "TASK_LOG_ADDED", `{"taskId":"`+id+`","entryId":"first","text":"first","createdAt":"2026-10-17T09:00:00Z"}`)
	}
	appendEvent("second-a", "TASK_LOG_ADDED", `{"taskId":"a","entryId":"second","text":"second","createdAt":"2026-10-17T09:00:00Z"}`)
	appendEvent("complete-a", "TASK_COMPLETED", `{"taskId":"a","completedAt":"2026-10-17T10:00:00Z"}`)
	want := []taskLogEntry{{id: "first", text: "first", createdAt: "2026-10-17T09:00:00Z"}, {id: "second", text: "second", createdAt: "2026-10-17T09:00:00Z"}}
	assertEntries := func(store *Store, expected []taskLogEntry) {
		t.Helper()
		_, tasks, err := store.readReplay(store.db)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(tasks["a"].logEntries, expected) || !reflect.DeepEqual(tasks["b"].logEntries, want[:1]) || !tasks["a"].completed {
			t.Fatal("removal changed wrong entries or task state", tasks)
		}
	}
	before := appendEvent("remove", "TASK_LOG_REMOVED", `{"taskId":"a","entryId":"first"}`)
	assertEntries(s, want[1:])
	if after := appendEvent("remove-again", "TASK_LOG_REMOVED", `{"taskId":"a","entryId":"first"}`); !reflect.DeepEqual(before, after) {
		t.Fatal("absent entry removal changed history")
	}
	if _, err := s.AppendEvent("unknown-task", "TASK_LOG_REMOVED", `{"taskId":"missing","entryId":"first"}`); err == nil {
		t.Fatal("unknown task removal accepted")
	}
	undone, err := s.Undo()
	if err != nil {
		t.Fatal(err)
	}
	assertEntries(s, want)
	if after := appendEvent("missing-entry", "TASK_LOG_REMOVED", `{"taskId":"a","entryId":"missing"}`); !reflect.DeepEqual(undone, after) {
		t.Fatal("no-op discarded redo history")
	}
	if _, err := s.Redo(); err != nil {
		t.Fatal(err)
	}
	assertEntries(s, want[1:])
	opened, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer opened.Close()
	assertEntries(opened, want[1:])
	appendEvent("remove-last", "TASK_LOG_REMOVED", `{"taskId":"a","entryId":"second"}`)
	assertEntries(s, []taskLogEntry{})
}

func TestTaskDetailsReplayCoalescingAndHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "details.db")
	s, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	appendCommand := func(id, kind string, payload map[string]string, group string) []Event {
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		events, err := s.AppendBatch([]Command{{ID: id, Type: kind, Payload: raw, GroupID: group}})
		if err != nil {
			t.Fatal(err)
		}
		return events
	}
	appendCommand("create", "TASK_CREATED", map[string]string{"taskId": "a", "title": "A", "configuredStart": "2026-10-17T09:00:00Z", "createdAt": "2026-10-17T09:00:00Z"}, "")
	_, tasks, err := s.readReplay(s.db)
	if err != nil || tasks["a"].description != "" || tasks["a"].logEntries == nil || len(tasks["a"].logEntries) != 0 {
		t.Fatal("missing defaults", err)
	}
	description := func(id, value, group string) []Event {
		return appendCommand(id, "TASK_DESCRIPTION_SET", map[string]string{"taskId": "a", "description": value}, group)
	}
	description("desc1", "first", "desc-session")
	events := description("desc2", "- [x] done", "desc-session")
	if len(events) != 2 || events[1].ID != "desc1" {
		t.Fatal("description edits did not coalesce", events)
	}
	if noop := description("noop", "- [x] done", "desc-session"); !reflect.DeepEqual(events, noop) {
		t.Fatal("description no-op changed history")
	}
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	_, tasks, err = s.readReplay(s.db)
	if err != nil || tasks["a"].description != "" {
		t.Fatal("description undo failed", err)
	}
	if _, err := s.Redo(); err != nil {
		t.Fatal(err)
	}
	description("desc3", "new session", "desc-session")
	if events, _ := s.GetEvents(); len(events) != 3 {
		t.Fatal("redo did not close description group")
	}
	notes := []taskLogEntry{
		{id: "late", text: " late ", createdAt: "2026-10-17T10:00:00Z"},
		{id: "nano2", text: "second", createdAt: "2026-10-17T09:00:00.123456789Z"},
		{id: "nano1", text: "first", createdAt: "2026-10-17T09:00:00.123456788Z"},
		{id: "tie", text: "equal instant", createdAt: "2026-10-17T09:00:00.123456789Z"},
	}
	for _, note := range notes {
		appendCommand("log-"+note.id, "TASK_LOG_ADDED", map[string]string{"taskId": "a", "entryId": note.id, "text": note.text, "createdAt": note.createdAt}, "")
	}
	notes[0].text = "late"
	want := notes
	_, tasks, err = s.readReplay(s.db)
	if err != nil || !reflect.DeepEqual(tasks["a"].logEntries, want) {
		t.Fatal("log chronology/precision/stable ties incorrect", tasks["a"].logEntries, err)
	}
	before, _ := s.GetEvents()
	if _, err := s.AppendEvent("duplicate-note", "TASK_LOG_ADDED", `{"taskId":"a","entryId":"late","text":"duplicate","createdAt":"2026-10-17T09:00:00Z"}`); err == nil {
		t.Fatal("duplicate log entry accepted")
	}
	after, _ := s.GetEvents()
	if !reflect.DeepEqual(before, after) {
		t.Fatal("invalid note changed history")
	}
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	_, tasks, err = s.readReplay(s.db)
	if err != nil || !reflect.DeepEqual(tasks["a"].logEntries, notes[:3]) {
		t.Fatal("log undo removed incorrect note", err)
	}
	if _, err := s.Redo(); err != nil {
		t.Fatal(err)
	}
	opened, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer opened.Close()
	_, tasks, err = opened.readReplay(opened.db)
	if err != nil || tasks["a"].description != "new session" || !reflect.DeepEqual(tasks["a"].logEntries, want) {
		t.Fatal("persisted details not replayable", err)
	}
	description("clear", "", "")
	_, tasks, err = s.readReplay(s.db)
	if err != nil || tasks["a"].description != "" {
		t.Fatal("description could not be cleared", err)
	}
}
