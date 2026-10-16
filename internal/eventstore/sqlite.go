package eventstore

import (
	"database/sql"
	"encoding/json"
	"fmt"
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
}

// Store manages the SQLite event log.
type Store struct {
	db *sql.DB
}

// NewStore opens or creates the SQLite database at dbPath and initializes the schema.
func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	schema := `
	PRAGMA journal_mode=WAL;
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

	s := &Store{db: db}
	if err := s.seedIfEmpty(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("seed initial data: %w", err)
	}

	return s, nil
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
	rows, err := s.db.Query(`SELECT seq, id, timestamp, type, payload, undone FROM events ORDER BY seq ASC`)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var ev Event
		var payloadStr string
		var undoneInt int
		if err := rows.Scan(&ev.Seq, &ev.ID, &ev.Timestamp, &ev.Type, &payloadStr, &undoneInt); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		ev.Payload = json.RawMessage(payloadStr)
		ev.Undone = undoneInt != 0
		events = append(events, ev)
	}
	if events == nil {
		events = []Event{}
	}
	return events, rows.Err()
}

// AppendEvent inserts a new active event or coalesces it with the latest active event
// if the same task and event type (e.g. TASK_RENAMED, TASK_START_DATE_SET, TASK_ACTIVE_SET)
// was already modified within the last 60 seconds.
func (s *Store) AppendEvent(id string, eventType string, payloadJSON string) ([]Event, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Remove undone future events when a new action occurs
	if _, err := tx.Exec(`DELETE FROM events WHERE undone = 1`); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	ts := now.Format(time.RFC3339Nano)

	coalesced := false
	if isCoalescableEventType(eventType) {
		var incomingPayload map[string]interface{}
		if err := json.Unmarshal([]byte(payloadJSON), &incomingPayload); err == nil {
			incomingTaskID, _ := incomingPayload["taskId"].(string)
			if incomingTaskID != "" {
				var lastSeq int64
				var lastType string
				var lastTS string
				var lastPayloadStr string
				rowErr := tx.QueryRow(
					`SELECT seq, type, timestamp, payload FROM events WHERE undone = 0 ORDER BY seq DESC LIMIT 1`,
				).Scan(&lastSeq, &lastType, &lastTS, &lastPayloadStr)

				if rowErr == nil && lastType == eventType {
					if parsedTS, pErr := parseEventTime(lastTS); pErr == nil && now.Sub(parsedTS) <= 60*time.Second {
						var prevPayload map[string]interface{}
						if json.Unmarshal([]byte(lastPayloadStr), &prevPayload) == nil {
							prevTaskID, _ := prevPayload["taskId"].(string)
							if prevTaskID == incomingTaskID {
								if _, uErr := tx.Exec(
									`UPDATE events SET payload = ?, timestamp = ? WHERE seq = ?`,
									payloadJSON, ts, lastSeq,
								); uErr != nil {
									return nil, uErr
								}
								coalesced = true
							}
						}
					}
				}
			}
		}
	}

	if !coalesced {
		if _, err := tx.Exec(
			`INSERT INTO events (id, timestamp, type, payload, undone) VALUES (?, ?, ?, ?, 0)`,
			id, ts, eventType, payloadJSON,
		); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetEvents()
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
	_, err := s.db.Exec(`
		UPDATE events
		SET undone = 1
		WHERE seq = (
			SELECT seq FROM events WHERE undone = 0 ORDER BY seq DESC LIMIT 1
		)
	`)
	if err != nil {
		return nil, err
	}
	return s.GetEvents()
}

// Redo restores the earliest undone event.
func (s *Store) Redo() ([]Event, error) {
	_, err := s.db.Exec(`
		UPDATE events
		SET undone = 0
		WHERE seq = (
			SELECT seq FROM events WHERE undone = 1 ORDER BY seq ASC LIMIT 1
		)
	`)
	if err != nil {
		return nil, err
	}
	return s.GetEvents()
}

// ResetDemoData clears all events and seeds fresh demonstration tasks.
func (s *Store) ResetDemoData() ([]Event, error) {
	if _, err := s.db.Exec(`DELETE FROM events`); err != nil {
		return nil, err
	}
	if err := s.seedIfEmpty(); err != nil {
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

	for i, sEv := range seeds {
		raw, err := json.Marshal(sEv.payload)
		if err != nil {
			return err
		}
		ts := now.Add(time.Duration(i) * time.Second).UTC().Format(time.RFC3339Nano)
		if _, err := s.db.Exec(
			`INSERT INTO events (id, timestamp, type, payload, undone) VALUES (?, ?, ?, ?, 0)`,
			sEv.id, ts, sEv.evType, string(raw),
		); err != nil {
			return err
		}
	}
	return nil
}
