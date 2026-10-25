package eventstore

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const snapshotInterval = 500
const snapshotVersion = 1

type changeStamp struct{ Changes, Data, Schema int64 }

func readChangeStamp(tx *sql.Tx) (changeStamp, error) {
	var stamp changeStamp
	err := tx.QueryRow(`SELECT total_changes(), (SELECT data_version FROM pragma_data_version), (SELECT schema_version FROM pragma_schema_version)`).Scan(&stamp.Changes, &stamp.Data, &stamp.Schema)
	return stamp, err
}

func rollbackCache(tx *sql.Tx, owner *Store) {
	if err := tx.Rollback(); err != nil {
		return
	}
	// SQLite total_changes includes rolled-back writes. A rejected transaction
	// must not accidentally close an edit group on the next cache check.
	if !owner.ready {
		return
	}
	check, err := owner.db.Begin()
	if err != nil {
		owner.ready = false
		return
	}
	defer check.Rollback()
	stamp, err := readChangeStamp(check)
	if err == nil && stamp.Data == owner.stamp.Data && stamp.Schema == owner.stamp.Schema {
		owner.stamp.Changes = stamp.Changes
	}
}

func (s *Store) checkOpen() error {
	if s.closed || s.db == nil {
		return fmt.Errorf("event store is closed")
	}
	return nil
}

func copyEvents(events []Event) []Event {
	result := make([]Event, len(events))
	copy(result, events)
	for i := range result {
		result[i].Payload = append(json.RawMessage(nil), result[i].Payload...)
	}
	return result
}

func cloneTask(t *task) *task {
	copy := *t
	copy.logEntries = append([]taskLogEntry{}, t.logEntries...)
	copy.predecessors = make(map[string]bool, len(t.predecessors))
	for id, value := range t.predecessors {
		copy.predecessors[id] = value
	}
	return &copy
}

func cloneTasks(tasks map[string]*task) map[string]*task {
	copy := make(map[string]*task, len(tasks))
	for id, t := range tasks {
		copy[id] = cloneTask(t)
	}
	return copy
}

// A change detector is only an invalidation signal, never proof of event validity.
// Cold starts and externally changed histories always replay every event, including
// payload validation of undone events. Persisted snapshots cannot hide bad prefixes.
func (s *Store) ensureCache(tx *sql.Tx) error {
	stamp, err := readChangeStamp(tx)
	if err != nil {
		return err
	}
	if s.ready && stamp == s.stamp {
		return nil
	}
	s.ready = false
	if err := validateSchema(tx); err != nil {
		return err
	}
	events, err := s.readEvents(tx)
	if err != nil {
		return err
	}
	if err := ensureSnapshotSchema(tx); err != nil {
		return err
	}
	tasks, snapshots, err := verifySnapshots(tx, events)
	if err != nil {
		return err
	}
	ids := make(map[string]bool, len(events))
	for _, event := range events {
		ids[event.ID] = true
	}
	s.events, s.tasks, s.ids, s.snapshots = events, tasks, ids, snapshots
	s.groupID = ""
	// Verification can delete corrupt derived rows. Publish only after the caller's
	// commit; ready stays false until the caller installs its transaction stamp.
	return nil
}

func (s *Store) normalizeLegacyTimes() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	events, err := s.readEventsWithUTC(tx, false)
	if err != nil {
		return err
	}
	for i, event := range events {
		timestamp, err := normalizeTime(event.Timestamp)
		if err != nil {
			return err
		}
		field := ""
		switch event.Type {
		case "TASK_CREATED", "TASK_LOG_ADDED":
			field = "createdAt"
		case "TASK_COMPLETED":
			field = "completedAt"
		}
		payload := event.Payload
		if field != "" {
			payload, err = normalizePayloadTime(payload, field)
			if err != nil {
				return err
			}
		}
		if timestamp != event.Timestamp || !bytes.Equal(payload, event.Payload) {
			if _, err := tx.Exec(`UPDATE events SET timestamp=?, payload=? WHERE seq=?`, timestamp, string(payload), event.Seq); err != nil {
				return err
			}
		}
		event.Timestamp, event.Payload = timestamp, payload
		events[i] = event
	}
	if err := ensureSnapshotSchema(tx); err != nil {
		return err
	}
	tasks, snapshots, err := verifySnapshots(tx, events)
	if err != nil {
		return err
	}
	stamp, err := readChangeStamp(tx)
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	ids := make(map[string]bool, len(events))
	for _, event := range events {
		ids[event.ID] = true
	}
	s.events, s.tasks, s.snapshots, s.ids, s.stamp, s.ready = events, tasks, snapshots, ids, stamp, true
	return nil
}

// Replace only the timestamp JSON token, preserving every other byte. Reject
// ambiguous duplicate keys (also escaped keys) instead of silently losing data.
func normalizePayloadTime(raw []byte, field string) ([]byte, error) {
	if !utf8.Valid(raw) {
		return nil, fmt.Errorf("invalid UTF-8 in legacy payload")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return nil, fmt.Errorf("invalid legacy payload object")
	}
	seen := make(map[string]bool)
	start, end := -1, -1
	var normalized string
	for dec.More() {
		token, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key, ok := token.(string)
		if !ok || seen[key] {
			return nil, fmt.Errorf("duplicate or invalid legacy payload key: %v", token)
		}
		seen[key] = true
		before := int(dec.InputOffset())
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, err
		}
		if key == field {
			var timestamp string
			if err := json.Unmarshal(value, &timestamp); err != nil {
				return nil, err
			}
			normalized, err = normalizeTime(timestamp)
			if err != nil {
				return nil, err
			}
			if normalized != timestamp {
				start, end = before, int(dec.InputOffset())
				for start < end && raw[start] != '"' {
					start++
				}
			}
		}
	}
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	var trailing interface{}
	if err := dec.Decode(&trailing); err != io.EOF {
		return nil, fmt.Errorf("trailing legacy payload data")
	}
	if !seen[field] {
		return nil, fmt.Errorf("missing legacy %s", field)
	}
	if start < 0 {
		return raw, nil
	}
	replacement, _ := json.Marshal(normalized)
	result := append([]byte{}, raw[:start]...)
	result = append(result, replacement...)
	return append(result, raw[end:]...), nil
}

func normalizeTime(value string) (string, error) {
	t, err := parseEventTime(value)
	if err != nil {
		return "", err
	}
	if strings.HasSuffix(value, "Z") {
		return value, nil
	}
	value = t.UTC().Format(time.RFC3339Nano)
	_, err = parseUTCEventTime(value)
	return value, err
}

// Explicit DTOs preserve the unexported domain fields, including empty collections.
type snapshotLog struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	CreatedAt string `json:"createdAt"`
}
type snapshotTask struct {
	Title        string          `json:"title"`
	Start        string          `json:"start"`
	Description  string          `json:"description"`
	Logs         []snapshotLog   `json:"logs"`
	Active       bool            `json:"active"`
	Completed    bool            `json:"completed"`
	Predecessors map[string]bool `json:"predecessors"`
}
type snapshotState struct {
	Version int                     `json:"version"`
	Count   int                     `json:"count"`
	Tasks   map[string]snapshotTask `json:"tasks"`
}

func makeSnapshot(tasks map[string]*task, count int) snapshotState {
	state := snapshotState{Version: snapshotVersion, Count: count, Tasks: make(map[string]snapshotTask, len(tasks))}
	for id, t := range tasks {
		logs := make([]snapshotLog, len(t.logEntries))
		for i, log := range t.logEntries {
			logs[i] = snapshotLog{log.id, log.text, log.createdAt}
		}
		preds := make(map[string]bool, len(t.predecessors))
		for pred, value := range t.predecessors {
			preds[pred] = value
		}
		state.Tasks[id] = snapshotTask{t.title, t.start, t.description, logs, t.active, t.completed, preds}
	}
	return state
}

func (state snapshotState) tasks() map[string]*task {
	tasks := make(map[string]*task, len(state.Tasks))
	for id, dto := range state.Tasks {
		t := &task{title: dto.Title, start: dto.Start, description: dto.Description, active: dto.Active, completed: dto.Completed, logEntries: []taskLogEntry{}, predecessors: make(map[string]bool)}
		for _, log := range dto.Logs {
			t.logEntries = append(t.logEntries, taskLogEntry{log.ID, log.Text, log.CreatedAt})
		}
		for pred, value := range dto.Predecessors {
			t.predecessors[pred] = value
		}
		tasks[id] = t
	}
	return tasks
}

const snapshotSchema = `CREATE TABLE event_snapshots (seq INTEGER PRIMARY KEY, state_json TEXT NOT NULL)`

func ensureSnapshotSchema(tx *sql.Tx) error {
	var schema string
	err := tx.QueryRow(`SELECT sql FROM sqlite_schema WHERE name='event_snapshots'`).Scan(&schema)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == nil && schema == snapshotSchema {
		return nil
	}
	// This table is disposable, but the authoritative events schema is never repaired.
	if _, err := tx.Exec(`DROP TABLE IF EXISTS event_snapshots`); err != nil {
		return err
	}
	if _, err := tx.Exec(snapshotSchema); err != nil {
		return err
	}
	return nil
}

// Replay authoritative events once, checking exact snapshot prefixes along the way.
// Undone payloads are validated too; only the final graph must be acyclic.
func verifySnapshots(tx *sql.Tx, events []Event) (map[string]*task, map[int64]snapshotState, error) {
	rows, err := tx.Query(`SELECT seq,state_json FROM event_snapshots ORDER BY seq`)
	if err != nil {
		return nil, nil, err
	}
	raw := make(map[int64]string)
	for rows.Next() {
		var seq int64
		var data string
		if err := rows.Scan(&seq, &data); err != nil {
			rows.Close()
			return nil, nil, err
		}
		raw[seq] = data
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	verified := make(map[int64]snapshotState)
	tasks := make(map[string]*task)
	count := 0
	prefixActive := true
	for _, event := range events {
		p, err := validatePayload(event.Type, event.Payload)
		if err != nil {
			return nil, nil, fmt.Errorf("event %d: %w", event.Seq, err)
		}
		if event.Undone {
			prefixActive = false
		} else {
			if _, err := applyValidatedCommand(tasks, event.Type, p, false); err != nil {
				return nil, nil, fmt.Errorf("event %d: %w", event.Seq, err)
			}
			count++
		}
		if data, ok := raw[event.Seq]; ok && prefixActive && count%snapshotInterval == 0 {
			expected := makeSnapshot(tasks, count)
			canonical, err := json.Marshal(expected)
			if err != nil {
				return nil, nil, err
			}
			// Exact canonical representation checks version, shape, all field values,
			// and the actual authoritative prefix, not a forgeable cache checksum.
			if data == string(canonical) {
				verified[event.Seq] = expected
			}
		}
	}
	if err := validateTopology(tasks); err != nil {
		return nil, nil, err
	}
	for seq := range raw {
		if _, ok := verified[seq]; !ok {
			if _, err := tx.Exec(`DELETE FROM event_snapshots WHERE seq=?`, seq); err != nil {
				return nil, nil, err
			}
		}
	}
	return tasks, verified, nil
}

func (s *Store) invalidateSnapshots(tx *sql.Tx, earliest int64) error {
	if earliest == 0 {
		return nil
	}
	_, err := tx.Exec(`DELETE FROM event_snapshots WHERE seq>=?`, earliest)
	return err
}
func (s *Store) dropSnapshots(earliest int64) {
	if earliest != 0 {
		for seq := range s.snapshots {
			if seq >= earliest {
				delete(s.snapshots, seq)
			}
		}
	}
}

func (s *Store) bestSnapshot(events []Event, invalidFrom int64) (int64, snapshotState) {
	limit := invalidFrom
	for _, event := range events {
		if event.Undone && (limit == 0 || event.Seq < limit) {
			limit = event.Seq
		}
	}
	var best int64
	var state snapshotState
	for seq, candidate := range s.snapshots {
		if seq > best && (limit == 0 || seq < limit) {
			best, state = seq, candidate
		}
	}
	return best, state
}

func (s *Store) replayFromSnapshot(events []Event, invalidFrom int64) (map[string]*task, error) {
	seq, state := s.bestSnapshot(events, invalidFrom)
	var initial map[string]*task
	if seq != 0 {
		initial = state.tasks()
	}
	return replayEvents(events, initial, seq)
}

func (s *Store) writeSnapshots(tx *sql.Tx, events []Event, invalidFrom int64) (map[int64]snapshotState, error) {
	if s.skipSnapshots {
		return nil, nil
	}
	seq, state := s.bestSnapshot(events, invalidFrom)
	count := state.Count
	newStates := make(map[int64]snapshotState)
	// Most appends need no replay, DTO serialization or task-state copy.
	tail := sort.Search(len(events), func(i int) bool { return events[i].Seq > seq })
	if count+len(events)-tail < (count/snapshotInterval+1)*snapshotInterval {
		return newStates, nil
	}
	tasks := make(map[string]*task)
	if seq != 0 {
		tasks = state.tasks()
	}
	for _, event := range events[tail:] {
		if event.Undone {
			break
		}
		p, err := validatePayload(event.Type, event.Payload)
		if err != nil {
			return nil, err
		}
		if _, err := applyValidatedCommand(tasks, event.Type, p, false); err != nil {
			return nil, err
		}
		count++
		if count%snapshotInterval == 0 {
			state := makeSnapshot(tasks, count)
			raw, err := json.Marshal(state)
			if err != nil {
				return nil, err
			}
			if _, err := tx.Exec(`INSERT OR REPLACE INTO event_snapshots(seq,state_json) VALUES(?,?)`, event.Seq, string(raw)); err != nil {
				return nil, err
			}
			newStates[event.Seq] = state
		}
	}
	_, err := tx.Exec(`DELETE FROM event_snapshots WHERE seq NOT IN (SELECT seq FROM event_snapshots ORDER BY seq DESC LIMIT 5) AND CAST(json_extract(state_json,'$.count') AS INTEGER) % 5000 <> 0`)
	return newStates, err
}

func (s *Store) retainSnapshots() {
	seqs := make([]int64, 0, len(s.snapshots))
	for seq := range s.snapshots {
		seqs = append(seqs, seq)
	}
	sort.Slice(seqs, func(i, j int) bool { return seqs[i] > seqs[j] })
	for _, seq := range seqs[min(5, len(seqs)):] {
		if s.snapshots[seq].Count%5000 != 0 {
			delete(s.snapshots, seq)
		}
	}
}
