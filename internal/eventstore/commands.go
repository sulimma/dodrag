package eventstore

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type Command struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
	GroupID string          `json:"groupId,omitempty"`
}
type task struct {
	title, start      string
	description       string
	logEntries        []taskLogEntry
	active, completed bool
	predecessors      map[string]bool
}

type taskLogEntry struct {
	id, text, createdAt string
}

const maxDescriptionBytes = 256 * 1024

var validID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

func checkID(id string) error {
	if !validID.MatchString(id) || id == "constructor" || id == "__proto__" || id == "prototype" || id == "toString" {
		return fmt.Errorf("invalid ID: %q", id)
	}
	return nil
}
func validatePayload(kind string, raw []byte) (map[string]interface{}, error) {
	if kind == "TASK_DESCRIPTION_SET" && !utf8.Valid(raw) {
		return nil, fmt.Errorf("description payload must be valid UTF-8")
	}
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
	case "TASK_DESCRIPTION_SET":
		fields = append(fields, "description")
	case "TASK_LOG_ADDED":
		fields = append(fields, "entryId", "text", "createdAt")
	case "TASK_LOG_UPDATED":
		fields = append(fields, "entryId", "text")
	case "TASK_LOG_REMOVED":
		fields = append(fields, "entryId")
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
		case "taskId", "predecessorId", "entryId":
			if err := checkID(value); err != nil {
				return nil, err
			}
		case "title":
			if strings.TrimSpace(value) == "" {
				return nil, fmt.Errorf("empty title")
			}
		case "description":
			if !utf8.ValidString(value) || len(value) > maxDescriptionBytes {
				return nil, fmt.Errorf("description must be valid UTF-8 and at most %d bytes", maxDescriptionBytes)
			}
		case "text":
			if strings.TrimSpace(value) == "" {
				return nil, fmt.Errorf("empty log text")
			}
		case "createdAt", "completedAt":
			if _, err := parseUTCEventTime(value); err != nil {
				return nil, fmt.Errorf("invalid %s: %w", field, err)
			}
		default:
			if _, err := parseEventTime(value); err != nil {
				return nil, fmt.Errorf("invalid %s: %w", field, err)
			}
		}
	}
	return p, nil
}
func applyCommand(tasks map[string]*task, kind string, p map[string]interface{}) (bool, error) {
	return applyValidatedCommand(tasks, kind, p, true)
}

func applyValidatedCommand(tasks map[string]*task, kind string, p map[string]interface{}, checkCycle bool) (bool, error) {
	id := p["taskId"].(string)
	t := tasks[id]
	if kind == "TASK_CREATED" {
		if t != nil {
			return false, fmt.Errorf("duplicate task: %s", id)
		}
		tasks[id] = &task{title: p["title"].(string), start: p["configuredStart"].(string), logEntries: []taskLogEntry{}, predecessors: make(map[string]bool)}
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
	case "TASK_DESCRIPTION_SET":
		value := p["description"].(string)
		if t.description == value {
			return false, nil
		}
		t.description = value
	case "TASK_LOG_ADDED":
		entryID := p["entryId"].(string)
		for _, entry := range t.logEntries {
			if entry.id == entryID {
				return false, fmt.Errorf("duplicate log entry ID: %s", entryID)
			}
		}
		t.logEntries = append(t.logEntries, taskLogEntry{id: entryID, text: strings.TrimSpace(p["text"].(string)), createdAt: p["createdAt"].(string)})
	case "TASK_LOG_UPDATED":
		entryID := p["entryId"].(string)
		text := strings.TrimSpace(p["text"].(string))
		for i, entry := range t.logEntries {
			if entry.id == entryID {
				if entry.text == text {
					return false, nil
				}
				t.logEntries[i].text = text
				return true, nil
			}
		}
		return false, nil
	case "TASK_LOG_REMOVED":
		entryID := p["entryId"].(string)
		index := -1
		for i, entry := range t.logEntries {
			if entry.id == entryID {
				index = i
				break
			}
		}
		if index < 0 {
			return false, nil
		}
		t.logEntries = append(t.logEntries[:index], t.logEntries[index+1:]...)
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
		var stack []string
		if checkCycle {
			stack = append(stack, pred)
		}
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
	if err := s.checkOpen(); err != nil {
		return nil, err
	}
	owner := s
	working := *s
	s = &working
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer rollbackCache(tx, owner)
	if err := s.ensureCache(tx); err != nil {
		owner.ready = false
		return nil, err
	}
	if !s.ready {
		owner.ready = false
	}
	events := s.events
	// Copy the map and only clone task objects touched by this batch.
	tasks := make(map[string]*task, len(s.tasks))
	for id, t := range s.tasks {
		tasks[id] = t
	}
	touched := make(map[string]bool)
	changed := make([]Command, 0, len(commands))
	payloads := make(map[string]map[string]interface{}, len(commands))
	ids := make(map[string]bool, len(commands))
	for _, command := range commands {
		if err := checkID(command.ID); err != nil {
			return nil, err
		}
		if utf8.RuneCountInString(command.GroupID) > 256 || ids[command.ID] || s.ids[command.ID] {
			return nil, fmt.Errorf("invalid group or duplicate event ID: %s", command.ID)
		}
		ids[command.ID] = true
		p, err := validatePayload(command.Type, command.Payload)
		if err != nil {
			return nil, err
		}
		id := p["taskId"].(string)
		if !touched[id] && tasks[id] != nil {
			tasks[id] = cloneTask(tasks[id])
			touched[id] = true
		}
		effect, err := applyCommand(tasks, command.Type, p)
		if err != nil {
			return nil, err
		}
		if effect {
			command.Payload = append(json.RawMessage(nil), command.Payload...)
			changed = append(changed, command)
			payloads[command.ID] = p
		}
	}
	if len(changed) == 0 {
		stamp, err := readChangeStamp(tx)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			s.ready = false
			return nil, err
		}
		s.stamp, s.ready = stamp, true
		*owner = *s
		return copyEvents(events), nil
	}
	var earliest int64
	workingEvents := make([]Event, 0, len(events)+len(changed))
	for _, event := range events {
		if event.Undone {
			if earliest == 0 || event.Seq < earliest {
				earliest = event.Seq
			}
			continue
		}
		workingEvents = append(workingEvents, event)
	}
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
			incoming := payloads[command.ID]
			if !last.Undone && last.Type == command.Type && previous["taskId"] == incoming["taskId"] {
				if _, err := tx.Exec(`UPDATE events SET payload = ?, timestamp = ? WHERE seq = ?`, string(command.Payload), ts, last.Seq); err != nil {
					return nil, err
				}
				if earliest == 0 || last.Seq < earliest {
					earliest = last.Seq
				}
				workingEvents[len(workingEvents)-1].Payload = command.Payload
				workingEvents[len(workingEvents)-1].Timestamp = ts
				continue
			}
		}
		group := "edit-" + command.ID
		if command.GroupID != "" && command.GroupID == s.groupID && len(events) > 0 {
			last := events[len(events)-1]
			if !last.Undone {
				group = last.GroupID
			}
		}
		if batchGroup != "" {
			group = batchGroup
		}
		result, err := tx.Exec(`INSERT INTO events (id, timestamp, type, payload, undone, group_id) VALUES (?, ?, ?, ?, 0, ?)`, command.ID, ts, command.Type, string(command.Payload), group)
		if err != nil {
			return nil, err
		}
		seq, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		workingEvents = append(workingEvents, Event{Seq: seq, ID: command.ID, Timestamp: ts, Type: command.Type, Payload: command.Payload, GroupID: group})
	}
	if err := s.invalidateSnapshots(tx, earliest); err != nil {
		return nil, err
	}
	newSnapshots, err := s.writeSnapshots(tx, workingEvents, earliest)
	if err != nil {
		return nil, err
	}
	stamp, err := readChangeStamp(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.dropSnapshots(earliest)
	for seq, state := range newSnapshots {
		s.snapshots[seq] = state
	}
	s.retainSnapshots()
	if earliest != 0 {
		s.ids = make(map[string]bool, len(workingEvents))
		for _, ev := range workingEvents {
			s.ids[ev.ID] = true
		}
	} else {
		for _, ev := range workingEvents[len(events):] {
			s.ids[ev.ID] = true
		}
	}
	s.events, s.tasks, s.stamp, s.ready = workingEvents, tasks, stamp, true
	s.groupID = changed[len(changed)-1].GroupID
	*owner = *s
	return copyEvents(s.events), nil
}

// Final Kahn validation covers completed tasks and every persisted dependency.
func validateTopology(tasks map[string]*task) error {
	degree := make(map[string]int, len(tasks))
	successors := make(map[string][]string, len(tasks))
	queue := make([]string, 0, len(tasks))
	for id, task := range tasks {
		degree[id] = len(task.predecessors)
		if len(task.predecessors) == 0 {
			queue = append(queue, id)
		}
		for pred := range task.predecessors {
			successors[pred] = append(successors[pred], id)
		}
	}
	for i := 0; i < len(queue); i++ {
		for _, id := range successors[queue[i]] {
			degree[id]--
			if degree[id] == 0 {
				queue = append(queue, id)
			}
		}
	}
	if len(queue) != len(tasks) {
		return fmt.Errorf("dependency cycle in final event history")
	}
	return nil
}
