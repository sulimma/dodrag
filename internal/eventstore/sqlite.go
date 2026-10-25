package eventstore

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

// Event is a stored command; explicit edit groups may coalesce the latest payload.
type Event struct {
	Seq       int64           `json:"seq"`
	ID        string          `json:"id"`
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
	Undone    bool            `json:"undone"`
	GroupID   string          `json:"groupId,omitempty"`
}

// Store manages the SQLite event log.
// Concurrency ceiling (ponytail): App's mutex must serialize all Store calls,
// including Close. The pinned SQLite connection is not a Store-level mutex.
type Store struct {
	db        *sql.DB
	groupID   string
	events    []Event
	tasks     map[string]*task
	ids       map[string]bool
	snapshots map[int64]snapshotState
	stamp     changeStamp
	ready     bool
	closed    bool
	// Benchmarks only; production stores always retain snapshot writes.
	skipSnapshots bool
}

// NewStore opens or creates the SQLite database at dbPath, initializes the schema, and seeds demo data if empty.
func NewStore(dbPath string) (*Store, error) {
	return NewStoreWithOptions(dbPath, true)
}

// NewStoreWithOptions opens or creates the database and optionally seeds it if empty.
// An optional translator applies only to newly seeded titles, never to stored data.
func NewStoreWithOptions(dbPath string, seedDemo bool, translateTitle ...func(string) string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// total_changes() is connection-local; keep the change detector on one connection.
	db.SetMaxOpenConns(1)

	schema := `
	CREATE TABLE IF NOT EXISTS events (
		seq INTEGER PRIMARY KEY AUTOINCREMENT,
		id TEXT NOT NULL UNIQUE,
		timestamp TEXT NOT NULL,
		type TEXT NOT NULL,
		payload TEXT NOT NULL,
		undone INTEGER NOT NULL DEFAULT 0
	);
	`
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("init schema: %w", err)
	}

	if err := validateSchema(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("incompatible events schema: %w", err)
	}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable WAL: %w", err)
	}
	s := &Store{db: db}
	if err := s.normalizeLegacyTimes(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("validate event store: %w", err)
	}
	if seedDemo {
		if err := s.seedIfEmpty(translateTitle...); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("seed initial data: %w", err)
		}
	}
	if _, err := s.GetEvents(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("validate event store: %w", err)
	}

	return s, nil
}

type schemaReader interface {
	eventReader
	QueryRow(string, ...interface{}) *sql.Row
	Exec(string, ...interface{}) (sql.Result, error)
}

func validateSchema(db schemaReader) error {
	rows, err := db.Query(`PRAGMA table_xinfo(events)`)
	if err != nil {
		return err
	}
	type column struct {
		kind       string
		notnull    int
		pk         int
		hidden     int
		defaultVal sql.NullString
	}
	columns := make(map[string]column)
	primaryKeys := 0
	for rows.Next() {
		var cid int
		var name string
		var c column
		if err := rows.Scan(&cid, &name, &c.kind, &c.notnull, &c.defaultVal, &c.pk, &c.hidden); err != nil {
			rows.Close()
			return err
		}
		if c.pk != 0 {
			primaryKeys++
		}
		columns[strings.ToLower(name)] = c
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, required := range []string{"seq", "id", "timestamp", "type", "payload", "undone"} {
		c, ok := columns[required]
		if !ok {
			return fmt.Errorf("missing %s", required)
		}
		kind := "TEXT"
		if required == "seq" || required == "undone" {
			kind = "INTEGER"
		}
		if !strings.EqualFold(strings.TrimSpace(c.kind), kind) || c.hidden != 0 {
			return fmt.Errorf("%s must be a writable %s column", required, kind)
		}
		if required == "seq" {
			if c.pk != 1 || primaryKeys != 1 {
				return fmt.Errorf("seq must be the sole INTEGER PRIMARY KEY")
			}
		} else if c.notnull != 1 || c.pk != 0 {
			return fmt.Errorf("%s must be NOT NULL and not a primary key", required)
		}
	}
	if c, ok := columns["group_id"]; ok {
		if !strings.EqualFold(strings.TrimSpace(c.kind), "TEXT") || c.notnull != 1 || c.pk != 0 || c.hidden != 0 || c.defaultVal.String != "''" {
			return fmt.Errorf("group_id must be TEXT NOT NULL DEFAULT ''")
		}
	}

	rows, err = db.Query(`PRAGMA index_list(events)`)
	if err != nil {
		return err
	}
	var uniqueIndexes []string
	for rows.Next() {
		var seq, unique, partial int
		var name, origin string
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			rows.Close()
			return err
		}
		// A rowid alias has no PK index. This excludes WITHOUT ROWID and INTEGER PK DESC.
		if origin == "pk" {
			rows.Close()
			return fmt.Errorf("seq must alias the SQLite rowid")
		}
		if unique == 1 && partial == 0 {
			uniqueIndexes = append(uniqueIndexes, name)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	uniqueID := false
	for _, name := range uniqueIndexes {
		var count, idColumns int
		if err := db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(lower(name) = 'id'), 0) FROM pragma_index_info(?)`, name).Scan(&count, &idColumns); err != nil {
			return err
		}
		uniqueID = uniqueID || count == 1 && idColumns == 1
	}
	if !uniqueID {
		return fmt.Errorf("id must have an unconditional single-column UNIQUE constraint")
	}
	// Additive migration happens only after the existing contract has been verified.
	if _, ok := columns["group_id"]; !ok {
		_, err = db.Exec(`ALTER TABLE events ADD COLUMN group_id TEXT NOT NULL DEFAULT ''`)
		return err
	}
	return nil
}

// Close closes the underlying SQLite connection.
func (s *Store) Close() error {
	if s.db != nil && !s.closed {
		s.closed = true
		s.ready = false
		return s.db.Close()
	}
	return nil
}

// GetEvents returns all events ordered by sequence number ascending.
func (s *Store) GetEvents() ([]Event, error) {
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
	return copyEvents(s.events), nil
}

type eventReader interface {
	Query(string, ...interface{}) (*sql.Rows, error)
}

func (s *Store) readEvents(reader eventReader) ([]Event, error) {
	return s.readEventsWithUTC(reader, true)
}

func (s *Store) readEventsWithUTC(reader eventReader, strict bool) ([]Event, error) {
	rows, err := reader.Query(`SELECT seq, id, timestamp, type, payload, undone, group_id FROM events ORDER BY seq ASC`)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var ev Event
		var payloadStr string
		var undoneInt int
		if err := rows.Scan(&ev.Seq, &ev.ID, &ev.Timestamp, &ev.Type, &payloadStr, &undoneInt, &ev.GroupID); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		ev.Payload = json.RawMessage(payloadStr)
		if undoneInt != 0 && undoneInt != 1 {
			return nil, fmt.Errorf("invalid undone flag at %d", ev.Seq)
		}
		ev.Undone = undoneInt == 1
		if err := checkID(ev.ID); err != nil {
			return nil, err
		}
		if ev.Seq < 1 || ev.Seq > 9007199254740991 || utf8.RuneCountInString(ev.GroupID) > 256 {
			return nil, fmt.Errorf("invalid event metadata at %d", ev.Seq)
		}
		parse := parseEventTime
		if strict {
			parse = parseUTCEventTime
		}
		if _, err := parse(ev.Timestamp); err != nil {
			return nil, err
		}
		events = append(events, ev)
	}
	if events == nil {
		events = []Event{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func (s *Store) readReplay(reader eventReader) ([]Event, map[string]*task, error) {
	events, err := s.readEvents(reader)
	if err != nil {
		return nil, nil, err
	}
	tasks, err := replayEvents(events, nil, 0)
	return events, tasks, err
}

func replayEvents(events []Event, initial map[string]*task, after int64) (map[string]*task, error) {
	tasks := make(map[string]*task)
	if initial != nil {
		tasks = initial
	}
	for _, event := range events[sort.Search(len(events), func(i int) bool { return events[i].Seq > after }):] {
		payload, err := validatePayload(event.Type, event.Payload)
		if err != nil {
			return nil, fmt.Errorf("event %d: %w", event.Seq, err)
		}
		if event.Undone {
			continue
		}
		// Only the final replay graph must be acyclic, not historical intermediates.
		if _, err := applyValidatedCommand(tasks, event.Type, payload, false); err != nil {
			return nil, fmt.Errorf("event %d: %w", event.Seq, err)
		}
	}
	if err := validateTopology(tasks); err != nil {
		return nil, err
	}
	return tasks, nil
}

func isCoalescableEventType(eventType string) bool {
	switch eventType {
	case "TASK_RENAMED", "TASK_START_DATE_SET", "TASK_ACTIVE_SET", "TASK_DESCRIPTION_SET":
		return true
	default:
		return false
	}
}

var persistedTimestamp = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`)

func parseEventTime(ts string) (time.Time, error) {
	if !persistedTimestamp.MatchString(ts) {
		return time.Time{}, fmt.Errorf("invalid persisted timestamp: %q", ts)
	}
	if ts[len(ts)-1] != 'Z' {
		offset := ts[len(ts)-5:]
		if offset[:2] >= "24" || offset[3:] >= "60" {
			return time.Time{}, fmt.Errorf("invalid timestamp offset: %q", ts)
		}
	}
	return time.Parse(time.RFC3339Nano, ts)
}

func parseUTCEventTime(ts string) (time.Time, error) {
	t, err := parseEventTime(ts)
	if err == nil && !strings.HasSuffix(ts, "Z") {
		err = fmt.Errorf("timestamp must be UTC Z: %q", ts)
	}
	return t, err
}

// Undo marks the latest active group as undone, only if its target state is valid.
func (s *Store) Undo() ([]Event, error) {
	return s.setHistoryUndone(true)
}

// Redo restores the earliest undone group, only if its target state is valid.
func (s *Store) Redo() ([]Event, error) {
	return s.setHistoryUndone(false)
}

func (s *Store) setHistoryUndone(undone bool) ([]Event, error) {
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
	order := "ASC"
	if undone {
		order = "DESC"
	}
	var seq int64
	var group string
	err = tx.QueryRow(`SELECT seq, group_id FROM events WHERE undone = ? ORDER BY seq `+order+` LIMIT 1`, !undone).Scan(&seq, &group)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if err == nil {
		if _, err := tx.Exec(`UPDATE events SET undone = ? WHERE seq = ? OR (group_id <> '' AND group_id = ?)`, undone, seq, group); err != nil {
			return nil, err
		}
	}
	events := append([]Event{}, s.events...)
	var earliest int64
	if err == nil {
		for i := range events {
			if events[i].Seq == seq || group != "" && events[i].GroupID == group {
				events[i].Undone = undone
				if earliest == 0 || events[i].Seq < earliest {
					earliest = events[i].Seq
				}
			}
		}
	}
	if err := s.invalidateSnapshots(tx, earliest); err != nil {
		return nil, err
	}
	tasks, err := s.replayFromSnapshot(events, earliest)
	if err != nil {
		return nil, fmt.Errorf("history change rejected: %w", err)
	}
	stamp, err := readChangeStamp(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.dropSnapshots(earliest)
	s.events, s.tasks, s.stamp, s.groupID, s.ready = events, tasks, stamp, "", true
	*owner = *s
	return copyEvents(events), nil
}

func (s *Store) seedIfEmpty(translateTitle ...func(string) string) error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM events`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, now.Location())
	inTwoDays := today.AddDate(0, 0, 2)
	inFiveDays := today.AddDate(0, 0, 5)
	yy := now.Year() % 100

	type seedEv struct {
		id      string
		evType  string
		payload map[string]interface{}
	}

	t1 := fmt.Sprintf("%02d-101", yy)
	t2 := fmt.Sprintf("%02d-102", yy)
	t3 := fmt.Sprintf("%02d-103", yy)
	t4 := fmt.Sprintf("%02d-104", yy)
	t5 := fmt.Sprintf("%02d-105", yy)
	t6 := fmt.Sprintf("%02d-106", yy)

	seeds := []seedEv{
		{
			id:     "seed-1",
			evType: "TASK_CREATED",
			payload: map[string]interface{}{
				"taskId":          t1,
				"title":           "API-Zugangsdaten vom Kunden anfordern",
				"configuredStart": today.Format(time.RFC3339),
				"createdAt":       now.Add(-5 * time.Minute).UTC().Format(time.RFC3339),
			},
		},
		{
			id:     "seed-2",
			evType: "TASK_ACTIVE_SET",
			payload: map[string]interface{}{
				"taskId":   t1,
				"isActive": true,
			},
		},
		{
			id:     "seed-3",
			evType: "TASK_CREATED",
			payload: map[string]interface{}{
				"taskId":          t2,
				"title":           "OAuth-Webhook im Staging-System konfigurieren",
				"configuredStart": today.Format(time.RFC3339),
				"createdAt":       now.Add(-4 * time.Minute).UTC().Format(time.RFC3339),
			},
		},
		{
			id:     "seed-4",
			evType: "DEPENDENCY_ADDED",
			payload: map[string]interface{}{
				"taskId":        t2,
				"predecessorId": t1,
			},
		},
		{
			id:     "seed-5",
			evType: "TASK_CREATED",
			payload: map[string]interface{}{
				"taskId":          t3,
				"title":           "End-to-End Integrationstest durchführen",
				"configuredStart": today.Format(time.RFC3339),
				"createdAt":       now.Add(-3 * time.Minute).UTC().Format(time.RFC3339),
			},
		},
		{
			id:     "seed-6",
			evType: "TASK_CREATED",
			payload: map[string]interface{}{
				"taskId":          t4,
				"title":           "SSL-Zertifikat für Subdomain bestellen",
				"configuredStart": today.Format(time.RFC3339),
				"createdAt":       now.Add(-2 * time.Minute).UTC().Format(time.RFC3339),
			},
		},
		{
			id:     "seed-7",
			evType: "TASK_CREATED",
			payload: map[string]interface{}{
				"taskId":          t5,
				"title":           "Freigabe durch Datenschutzbeauftragten abwarten",
				"configuredStart": inTwoDays.Format(time.RFC3339),
				"createdAt":       now.Add(-1 * time.Minute).UTC().Format(time.RFC3339),
			},
		},
		{
			id:     "seed-8",
			evType: "TASK_CREATED",
			payload: map[string]interface{}{
				"taskId":          t6,
				"title":           "Produktiv-Deployment & Release-Notes versenden",
				"configuredStart": inFiveDays.Format(time.RFC3339),
				"createdAt":       now.UTC().Format(time.RFC3339),
			},
		},
		{
			id:     "seed-9",
			evType: "DEPENDENCY_ADDED",
			payload: map[string]interface{}{
				"taskId":        t6,
				"predecessorId": t2,
			},
		},
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, sEv := range seeds {
		if title, ok := sEv.payload["title"].(string); ok && len(translateTitle) > 0 && translateTitle[0] != nil {
			sEv.payload["title"] = translateTitle[0](title)
		}
		raw, err := json.Marshal(sEv.payload)
		if err != nil {
			return err
		}
		ts := now.Add(time.Duration(i) * time.Second).UTC().Format(time.RFC3339Nano)
		if _, err := tx.Exec(
			`INSERT INTO events (id, timestamp, type, payload, undone) VALUES (?, ?, ?, ?, 0)`,
			sEv.id, ts, sEv.evType, string(raw),
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
