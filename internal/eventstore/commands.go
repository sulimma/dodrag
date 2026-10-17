package eventstore

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
)

type Command struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
	GroupID string          `json:"groupId,omitempty"`
}
type task struct {
	title, start      string
	active, completed bool
	predecessors      map[string]bool
}

var validID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

func checkID(id string) error {
	if !validID.MatchString(id) || id == "constructor" || id == "__proto__" || id == "prototype" || id == "toString" {
		return fmt.Errorf("invalid ID: %q", id)
	}
	return nil
}
func validatePayload(kind string, raw []byte) (map[string]interface{}, error) {
	var p map[string]interface{}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("invalid payload: %w", err)
	}
	var trailing interface{}
	if err := dec.Decode(&trailing); err != io.EOF {
		return nil, fmt.Errorf("trailing payload data")
	}
	fields := []string{"taskId"}
	switch kind {
	case "TASK_CREATED":
		fields = append(fields, "title", "configuredStart", "createdAt")
	case "TASK_RENAMED":
		fields = append(fields, "title")
	case "TASK_START_DATE_SET":
		fields = append(fields, "configuredStart")
	case "DEPENDENCY_ADDED", "DEPENDENCY_REMOVED":
		fields = append(fields, "predecessorId")
	case "TASK_ACTIVE_SET":
		fields = append(fields, "isActive")
	case "TASK_COMPLETED":
		fields = append(fields, "completedAt")
	case "TASK_REOPENED":
	default:
		return nil, fmt.Errorf("unknown event type: %s", kind)
	}
	if len(p) != len(fields) {
		return nil, fmt.Errorf("unexpected payload fields for %s", kind)
	}
	for _, field := range fields {
		if field == "isActive" {
			if _, ok := p[field].(bool); !ok {
				return nil, fmt.Errorf("isActive must be boolean")
			}
			continue
		}
		value, ok := p[field].(string)
		if !ok {
			return nil, fmt.Errorf("%s must be string", field)
		}
		switch field {
		case "taskId", "predecessorId":
			if err := checkID(value); err != nil {
				return nil, err
			}
		case "title":
			if strings.TrimSpace(value) == "" {
				return nil, fmt.Errorf("empty title")
			}
		default:
			if _, err := time.Parse(time.RFC3339Nano, value); err != nil {
				return nil, fmt.Errorf("invalid %s: %w", field, err)
			}
		}
	}
	return p, nil
}
func applyCommand(tasks map[string]*task, kind string, p map[string]interface{}) (bool, error) {
	id := p["taskId"].(string)
	t := tasks[id]
	if kind == "TASK_CREATED" {
		if t != nil {
			return false, fmt.Errorf("duplicate task: %s", id)
		}
		tasks[id] = &task{title: p["title"].(string), start: p["configuredStart"].(string), predecessors: make(map[string]bool)}
		return true, nil
	}
	if t == nil {
		return false, fmt.Errorf("unknown task: %s", id)
	}
	switch kind {
	case "TASK_RENAMED":
		value := p["title"].(string)
		if t.title == value {
			return false, nil
		}
		t.title = value
	case "TASK_START_DATE_SET":
		value := p["configuredStart"].(string)
		old, _ := parseEventTime(t.start)
		next, _ := parseEventTime(value)
		if old.Equal(next) {
			return false, nil
		}
		t.start = value
	case "TASK_ACTIVE_SET":
		value := p["isActive"].(bool)
		if t.active == value {
			return false, nil
		}
		if value {
			if t.completed {
				return false, fmt.Errorf("completed task cannot be activated")
			}
			for pred := range t.predecessors {
				if !tasks[pred].completed {
					return false, fmt.Errorf("task has open predecessors")
				}
			}
		}
		t.active = value
	case "TASK_COMPLETED":
		if t.completed {
			return false, nil
		}
		t.completed = true
		t.active = false
	case "TASK_REOPENED":
		if !t.completed {
			return false, nil
		}
		t.completed = false
	case "DEPENDENCY_ADDED", "DEPENDENCY_REMOVED":
		pred := p["predecessorId"].(string)
		if tasks[pred] == nil {
			return false, fmt.Errorf("unknown predecessor: %s", pred)
		}
		if kind == "DEPENDENCY_REMOVED" {
			if !t.predecessors[pred] {
				return false, nil
			}
			delete(t.predecessors, pred)
			break
		}
		if t.predecessors[pred] {
			return false, nil
		}
		stack := []string{pred}
		visited := make(map[string]bool)
		for len(stack) > 0 {
			current := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if current == id {
				return false, fmt.Errorf("dependency cycle")
			}
			if visited[current] {
				continue
			}
			visited[current] = true
			for ancestor := range tasks[current].predecessors {
				stack = append(stack, ancestor)
			}
		}
		t.predecessors[pred] = true
	}
	return true, nil
}

func (s *Store) AppendEvent(id, kind, payload string) ([]Event, error) {
	return s.AppendBatch([]Command{{ID: id, Type: kind, Payload: json.RawMessage(payload)}})
}
func (s *Store) AppendBatch(commands []Command) ([]Event, error) {
	events, err := s.GetEvents()
	if err != nil {
		return nil, err
	}
	tasks := make(map[string]*task)
	for _, ev := range events {
		if ev.Undone {
			continue
		}
		p, err := validatePayload(ev.Type, ev.Payload)
		if err != nil {
			return nil, err
		}
		if _, err := applyCommand(tasks, ev.Type, p); err != nil {
			return nil, fmt.Errorf("event %d: %w", ev.Seq, err)
		}
	}
	changed := make([]Command, 0, len(commands))
	for _, command := range commands {
		if err := checkID(command.ID); err != nil {
			return nil, err
		}
		p, err := validatePayload(command.Type, command.Payload)
		if err != nil {
			return nil, err
		}
		effect, err := applyCommand(tasks, command.Type, p)
		if err != nil {
			return nil, err
		}
		if effect {
			changed = append(changed, command)
		}
	}
	if len(changed) == 0 {
		return events, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM events WHERE undone = 1`); err != nil {
		return nil, err
	}
	ts := time.Now().UTC().Format(time.RFC3339Nano)
	batchGroup := ""
	if len(changed) > 1 {
		batchGroup = "batch-" + changed[0].ID
	}
	for _, command := range changed {
		if len(changed) == 1 && command.GroupID != "" && command.GroupID == s.groupID && isCoalescableEventType(command.Type) && len(events) > 0 {
			last := events[len(events)-1]
			previous, _ := validatePayload(last.Type, last.Payload)
			incoming, _ := validatePayload(command.Type, command.Payload)
			if !last.Undone && last.Type == command.Type && previous["taskId"] == incoming["taskId"] {
				if _, err := tx.Exec(`UPDATE events SET payload = ?, timestamp = ? WHERE seq = ?`, string(command.Payload), ts, last.Seq); err != nil {
					return nil, err
				}
				continue
			}
		}
		group := command.GroupID
		if group == "" || group != s.groupID {
			group = "edit-" + command.ID
		}
		if batchGroup != "" {
			group = batchGroup
		}
		if _, err := tx.Exec(`INSERT INTO events (id, timestamp, type, payload, undone, group_id) VALUES (?, ?, ?, ?, 0, ?)`, command.ID, ts, command.Type, string(command.Payload), group); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.groupID = changed[len(changed)-1].GroupID
	return s.GetEvents()
}
