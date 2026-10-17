package eventstore

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Event represents a single immutable domain event stored in SQLite.
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
type Store struct {
	db      *sql.DB
	groupID string
}

// NewStore opens or creates the SQLite database at dbPath, initializes the schema, and seeds demo data if empty.
func NewStore(dbPath string) (*Store, error) {
	return NewStoreWithOptions(dbPath, true)
}

// NewStoreWithOptions opens or creates the SQLite database at dbPath and optionally seeds demo data if empty.
func NewStoreWithOptions(dbPath string, seedDemo bool) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

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
	if _, err := s.GetEvents(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("validate event store: %w", err)
	}
	if seedDemo {
		if err := s.seedIfEmpty(); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("seed initial data: %w", err)
		}
	}

	return s, nil
}

func validateSchema(db *sql.DB) error {
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
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// GetEvents returns all events ordered by sequence number ascending.
func (s *Store) GetEvents() ([]Event, error) {
	rows, err := s.db.Query(`SELECT seq, id, timestamp, type, payload, undone, group_id FROM events ORDER BY seq ASC`)
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
		if _, err := parseEventTime(ev.Timestamp); err != nil {
			return nil, err
		}
		if _, err := validatePayload(ev.Type, ev.Payload); err != nil {
			return nil, fmt.Errorf("event %d: %w", ev.Seq, err)
		}
		events = append(events, ev)
	}
	if events == nil {
		events = []Event{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	tasks := make(map[string]*task)
	for _, event := range events {
		if event.Undone {
			continue
		}
		payload, err := validatePayload(event.Type, event.Payload)
		if err != nil {
			return nil, err
		}
		if _, err := applyCommand(tasks, event.Type, payload); err != nil {
			return nil, fmt.Errorf("event %d: %w", event.Seq, err)
		}
	}
	return events, nil
}

func isCoalescableEventType(eventType string) bool {
	switch eventType {
	case "TASK_RENAMED", "TASK_START_DATE_SET", "TASK_ACTIVE_SET":
		return true
	default:
		return false
	}
}

func parseEventTime(ts string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339Nano, ts); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, ts)
}

// Undo marks the latest active event as undone.
func (s *Store) Undo() ([]Event, error) {
	s.groupID = ""
	_, err := s.db.Exec(`
		UPDATE events
		SET undone = 1
		WHERE seq = (SELECT seq FROM events WHERE undone = 0 ORDER BY seq DESC LIMIT 1)
		OR (group_id <> '' AND group_id = (SELECT group_id FROM events WHERE undone = 0 ORDER BY seq DESC LIMIT 1))
	`)
	if err != nil {
		return nil, err
	}
	return s.GetEvents()
}

// Redo restores the earliest undone event.
func (s *Store) Redo() ([]Event, error) {
	s.groupID = ""
	_, err := s.db.Exec(`
		UPDATE events
		SET undone = 0
		WHERE seq = (SELECT seq FROM events WHERE undone = 1 ORDER BY seq ASC LIMIT 1)
		OR (group_id <> '' AND group_id = (SELECT group_id FROM events WHERE undone = 1 ORDER BY seq ASC LIMIT 1))
	`)
	if err != nil {
		return nil, err
	}
	return s.GetEvents()
}

func (s *Store) seedIfEmpty() error {
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
				"createdAt":       now.Add(-5 * time.Minute).Format(time.RFC3339),
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
				"createdAt":       now.Add(-4 * time.Minute).Format(time.RFC3339),
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
				"createdAt":       now.Add(-3 * time.Minute).Format(time.RFC3339),
			},
		},
		{
			id:     "seed-6",
			evType: "TASK_CREATED",
			payload: map[string]interface{}{
				"taskId":          t4,
				"title":           "SSL-Zertifikat für Subdomain bestellen",
				"configuredStart": today.Format(time.RFC3339),
				"createdAt":       now.Add(-2 * time.Minute).Format(time.RFC3339),
			},
		},
		{
			id:     "seed-7",
			evType: "TASK_CREATED",
			payload: map[string]interface{}{
				"taskId":          t5,
				"title":           "Freigabe durch Datenschutzbeauftragten abwarten",
				"configuredStart": inTwoDays.Format(time.RFC3339),
				"createdAt":       now.Add(-1 * time.Minute).Format(time.RFC3339),
			},
		},
		{
			id:     "seed-8",
			evType: "TASK_CREATED",
			payload: map[string]interface{}{
				"taskId":          t6,
				"title":           "Produktiv-Deployment & Release-Notes versenden",
				"configuredStart": inFiveDays.Format(time.RFC3339),
				"createdAt":       now.Format(time.RFC3339),
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
