package eventstore

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestSQLiteEventStore(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test_dodrag.db")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("NewStore failed: %v", err)
	}
	defer store.Close()

	// Initial seeded events should exist
	events, err := store.GetEvents()
	if err != nil {
		t.Fatalf("GetEvents failed: %v", err)
	}
	initialCount := len(events)
	if initialCount == 0 {
		t.Fatalf("expected seeded events, got 0")
	}

	// Append a new event
	seed, err := validatePayload(events[0].Type, events[0].Payload)
	if err != nil {
		t.Fatal(err)
	}
	rename, err := json.Marshal(map[string]interface{}{"taskId": seed["taskId"], "title": "Geänderter Titel"})
	if err != nil {
		t.Fatal(err)
	}
	events, err = store.AppendEvent("test-ev-1", "TASK_RENAMED", string(rename))
	if err != nil {
		t.Fatalf("AppendEvent failed: %v", err)
	}
	if len(events) != initialCount+1 {
		t.Fatalf("expected %d events, got %d", initialCount+1, len(events))
	}

	// Undo the event
	events, err = store.Undo()
	if err != nil {
		t.Fatalf("Undo failed: %v", err)
	}
	last := events[len(events)-1]
	if !last.Undone {
		t.Fatalf("expected last event to be marked undone")
	}

	// Redo the event
	events, err = store.Redo()
	if err != nil {
		t.Fatalf("Redo failed: %v", err)
	}
	last = events[len(events)-1]
	if last.Undone {
		t.Fatalf("expected last event to be active after Redo")
	}

	// A standalone edit after redo must not coalesce with an earlier edit.
	rename, err = json.Marshal(map[string]interface{}{"taskId": seed["taskId"], "title": "Zweite Änderung innerhalb 1 Minute"})
	if err != nil {
		t.Fatal(err)
	}
	events, err = store.AppendEvent("test-ev-2", "TASK_RENAMED", string(rename))
	if err != nil {
		t.Fatalf("AppendEvent coalesced failed: %v", err)
	}
	if len(events) != initialCount+2 {
		t.Fatalf("expected separate edit count %d, got %d", initialCount+2, len(events))
	}

	// Empty database creation test (without demo seed)
	emptyDBPath := filepath.Join(t.TempDir(), "custom_google_drive.db")
	emptyStore, err := NewStoreWithOptions(emptyDBPath, false)
	if err != nil {
		t.Fatalf("NewStoreWithOptions(false) failed: %v", err)
	}
	defer emptyStore.Close()
	emptyEvents, err := emptyStore.GetEvents()
	if err != nil {
		t.Fatalf("emptyStore.GetEvents failed: %v", err)
	}
	if len(emptyEvents) != 0 {
		t.Fatalf("expected 0 events in custom empty database, got %d", len(emptyEvents))
	}
}

func TestRejectIncompatibleSchemaBeforeMigration(t *testing.T) {
	valid := `CREATE TABLE events (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, timestamp TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0)`
	cases := map[string]string{
		"reported empty schema":      `CREATE TABLE events (seq TEXT,id TEXT,timestamp TEXT,type TEXT,payload TEXT,undone INTEGER)`,
		"seq text primary key":       strings.Replace(valid, "seq INTEGER", "seq TEXT", 1),
		"seq descending primary key": strings.Replace(valid, "INTEGER PRIMARY KEY", "INTEGER PRIMARY KEY DESC", 1),
		"without rowid":              valid + ` WITHOUT ROWID`,
		"nullable id":                strings.Replace(valid, "id TEXT NOT NULL", "id TEXT", 1),
		"no unique id":               strings.Replace(valid, " NOT NULL UNIQUE", " NOT NULL", 1),
		"partial unique id":          strings.Replace(valid, " NOT NULL UNIQUE", " NOT NULL", 1) + `; CREATE UNIQUE INDEX ids ON events(id) WHERE undone=0`,
		"composite unique id":        strings.Replace(valid, "id TEXT NOT NULL UNIQUE", "id TEXT NOT NULL", 1) + `; CREATE UNIQUE INDEX ids ON events(id,timestamp)`,
		"nullable payload":           strings.Replace(valid, "payload TEXT NOT NULL", "payload TEXT", 1),
		"wrong timestamp type":       strings.Replace(valid, "timestamp TEXT", "timestamp INTEGER", 1),
		"wrong undone type":          strings.Replace(valid, "undone INTEGER", "undone TEXT", 1),
		"nullable group":             strings.TrimSuffix(valid, ")") + `, group_id TEXT DEFAULT '')`,
		"group without default":      strings.TrimSuffix(valid, ")") + `, group_id TEXT NOT NULL)`,
	}
	for name, schema := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "bad.db")
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if _, err := db.Exec(schema); err != nil {
				t.Fatal(err)
			}
			var before string
			if err := db.QueryRow(`SELECT sql FROM sqlite_schema WHERE name='events'`).Scan(&before); err != nil {
				t.Fatal(err)
			}
			if store, err := NewStoreWithOptions(path, true); err == nil {
				store.Close()
				t.Fatal("accepted incompatible schema")
			}
			var after string
			var count int
			if err := db.QueryRow(`SELECT sql FROM sqlite_schema WHERE name='events'`).Scan(&after); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow(`SELECT COUNT(*) FROM events`).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if before != after || count != 0 {
				t.Fatal("rejected store migrated or mutated empty database")
			}
		})
	}
}

func TestValidLegacySchemaMigration(t *testing.T) {
	for _, autoIncrement := range []string{"", " AUTOINCREMENT"} {
		t.Run(autoIncrement, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "legacy.db")
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			_, err = db.Exec(`CREATE TABLE events (seq INTEGER PRIMARY KEY` + autoIncrement + `, id TEXT NOT NULL, timestamp TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0); CREATE UNIQUE INDEX ids ON events(id); INSERT INTO events (id,timestamp,type,payload) VALUES ('e1','2026-10-17T09:00:00Z','TASK_CREATED','{"taskId":"t1","title":"A","configuredStart":"2026-10-17T09:00:00Z","createdAt":"2026-10-17T09:00:00Z"}')`)
			db.Close()
			if err != nil {
				t.Fatal(err)
			}
			store, err := NewStoreWithOptions(path, false)
			if err != nil {
				t.Fatal(err)
			}
			events, err := store.GetEvents()
			if err != nil || len(events) != 1 || events[0].Seq != 1 || events[0].GroupID != "" {
				t.Fatal("legacy event changed", events, err)
			}
			events, err = store.AppendEvent("e2", "TASK_RENAMED", `{"taskId":"t1","title":"B"}`)
			if err != nil || len(events) != 2 || events[1].Seq != 2 {
				t.Fatal("sequence allocation failed", events, err)
			}
			if _, err := store.db.Exec(`INSERT INTO events (id,timestamp,type,payload) SELECT id,timestamp,type,payload FROM events WHERE seq=1`); err == nil {
				t.Fatal("duplicate event id accepted")
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			store, err = NewStoreWithOptions(path, false)
			if err != nil {
				t.Fatal("migrated database not reopenable", err)
			}
			store.Close()
		})
	}
}
