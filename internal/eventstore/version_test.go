package eventstore

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func versionFixture(t *testing.T, minimum string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "version.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE database_metadata (
		id INTEGER PRIMARY KEY, app_version TEXT NOT NULL, app_build_time TEXT NOT NULL, minimum_app_version TEXT NOT NULL
	); INSERT INTO database_metadata VALUES(1,'future-app','future-build',?)`, minimum); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestDatabaseVersionStampAndPatchReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tasks.db")
	s, err := NewStoreWithBuildInfo(path, false, BuildInfo{Version: "0.8.0rc", BuildTime: "2026-11-06T09:00:00Z"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendEvent("created", "TASK_CREATED", `{"taskId":"a","title":"Keep me","configuredStart":"2026-11-06T09:00:00Z","createdAt":"2026-11-06T09:00:00Z"}`); err != nil {
		t.Fatal(err)
	}
	before, err := s.GetEvents()
	if err != nil {
		t.Fatal(err)
	}
	assertStamp := func(store *Store, version, build string) {
		t.Helper()
		var gotVersion, gotBuild, gotMinimum string
		if err := store.db.QueryRow(`SELECT app_version,app_build_time,minimum_app_version FROM database_metadata WHERE id=1`).Scan(&gotVersion, &gotBuild, &gotMinimum); err != nil {
			t.Fatal(err)
		}
		if gotVersion != version || gotBuild != build || gotMinimum != MinimumAppVersion {
			t.Fatal("incorrect persisted app identity/format floor", gotVersion, gotBuild, gotMinimum)
		}
	}
	assertStamp(s, "0.8.0", "2026-11-06T09:00:00Z")
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = NewStoreWithBuildInfo(path, false, BuildInfo{Version: "0.8.1rc", BuildTime: "2026-11-07T10:00:00Z"})
	if err != nil {
		t.Fatal(err)
	}
	assertStamp(s, "0.8.1", "2026-11-07T10:00:00Z")
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	// A patch release did not make this file unreadable for the first app of the current format.
	s, err = NewStoreWithBuildInfo(path, false, BuildInfo{Version: "0.8.0", BuildTime: "2026-11-06T09:00:00Z"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	after, err := s.GetEvents()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("opening changed events", after, err)
	}
	assertStamp(s, "0.8.0", "2026-11-06T09:00:00Z")
}

func TestDatabaseVersionComparisonAndNoDowngrade(t *testing.T) {
	for _, tc := range []struct {
		app, minimum string
		allowed      bool
	}{
		{"0.8.0rc", "0.8.0", true}, {"0.8.0", "0.8.0rc", true},
		{"0.8.2rc", "0.8.1rc", true}, {"0.8.1", "0.8.2", false},
		{"0.9.0", "0.10.0", false}, {"0.10.0rc", "0.9.0", true},
		{"1.0.0", "0.99.0", true}, {"0.99.0", "1.0.0rc", false},
	} {
		t.Run(tc.app+"/"+tc.minimum, func(t *testing.T) {
			path := versionFixture(t, tc.minimum)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			s, err := NewStoreWithBuildInfo(path, false, BuildInfo{Version: tc.app})
			minimum, _ := normalizeAppVersion(tc.minimum)
			if tc.allowed {
				if err != nil {
					t.Fatal(err)
				}
				defer s.Close()
				var stored string
				if err := s.db.QueryRow(`SELECT minimum_app_version FROM database_metadata WHERE id=1`).Scan(&stored); err != nil {
					t.Fatal(err)
				}
				if stored != minimum {
					t.Fatal("minimum version lowered or rc retained", stored)
				}
			} else {
				if s != nil {
					s.Close()
					t.Fatal("accepted newer database")
				}
				var compatibility *CompatibilityError
				if !errors.As(err, &compatibility) || compatibility.MinimumVersion != minimum {
					t.Fatal("missing required upgrade version", err)
				}
				after, readErr := os.ReadFile(path)
				if readErr != nil || !reflect.DeepEqual(before, after) {
					t.Fatal("rejected database modified", readErr)
				}
			}
		})
	}
}

func TestOpenStoreStopsWritingAfterExternalFormatUpgrade(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgraded.db")
	store, err := NewStoreWithBuildInfo(path, false, BuildInfo{Version: MinimumAppVersion})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	other, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if _, err := other.Exec(`UPDATE database_metadata SET minimum_app_version='99.0.0' WHERE id=1`); err != nil {
		t.Fatal(err)
	}

	_, err = store.AppendEvent("create", "TASK_CREATED", `{"taskId":"a","title":"Task","createdAt":"2026-11-01T09:00:00Z","configuredStart":"2026-11-01T09:00:00Z"}`)
	var incompatibility *CompatibilityError
	if !errors.As(err, &incompatibility) || incompatibility.MinimumVersion != "99.0.0" {
		t.Errorf("expected the new minimum version to block the write, got %v", err)
	}
	var count int
	if err := other.QueryRow(`SELECT count(*) FROM events`).Scan(&count); err != nil || count != 0 {
		t.Errorf("incompatible write reached the database: count=%d, err=%v", count, err)
	}
}

func TestDatabaseVersionLegacyAndMissingMetadata(t *testing.T) {
	for _, mode := range []string{"no table", "no row", "empty version"} {
		t.Run(mode, func(t *testing.T) {
			path := versionFixture(t, "")
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "no table" {
				_, err = db.Exec(`DROP TABLE database_metadata`)
			}
			if mode == "no row" {
				_, err = db.Exec(`DELETE FROM database_metadata`)
			}
			if err != nil {
				t.Fatal(err)
			}
			db.Close()
			s, err := NewStoreWithBuildInfo(path, false, BuildInfo{Version: "0.8.0rc", BuildTime: "2026-11-06T09:00:00Z"})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			var minimum string
			if err := s.db.QueryRow(`SELECT minimum_app_version FROM database_metadata WHERE id=1`).Scan(&minimum); err != nil {
				t.Fatal(err)
			}
			if minimum != MinimumAppVersion {
				t.Fatal("missing format floor", minimum)
			}
		})
	}
}

func TestDatabaseVersionIncompatibleLegacyReportsFallback(t *testing.T) {
	for _, schema := range []string{
		`CREATE TABLE events(other TEXT)`,
		`CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,timestamp TEXT NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0);
		INSERT INTO events(id,timestamp,type,payload) VALUES('new','2026-11-06T09:00:00Z','FUTURE_EVENT','{}')`,
	} {
		path := filepath.Join(t.TempDir(), "legacy.db")
		db, err := sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(schema); err != nil {
			t.Fatal(err)
		}
		db.Close()
		s, err := NewStoreWithBuildInfo(path, false, BuildInfo{Version: "0.8.0rc"})
		if s != nil {
			s.Close()
			t.Fatal("accepted incompatible legacy data")
		}
		var compatibility *CompatibilityError
		if !errors.As(err, &compatibility) || compatibility.MinimumVersion != UnversionedMinimumAppVersion {
			t.Fatal("missing fallback", err)
		}
		db, err = sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		var count int
		if err := db.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE name='database_metadata'`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		db.Close()
		if count != 0 {
			t.Fatal("rejected database stamped as successfully opened")
		}
	}
}

func TestDatabaseVersionRejectsMalformedMetadata(t *testing.T) {
	for _, minimum := range []string{"newest", "0.5", "-1.0.0", "0.99999999999999999999999999.0"} {
		path := versionFixture(t, minimum)
		s, err := NewStoreWithBuildInfo(path, false, BuildInfo{Version: "0.8.0"})
		if s != nil {
			s.Close()
			t.Fatal("ignored malformed minimum", minimum)
		}
		var compatibility *CompatibilityError
		if !errors.As(err, &compatibility) || compatibility.MinimumVersion != UnversionedMinimumAppVersion {
			t.Fatal("missing fallback", err)
		}
	}
}

func TestDatabaseVersionInspectionIsReadOnly(t *testing.T) {
	for _, minimum := range []string{"0.8.0rc", "0.9.0"} {
		t.Run(minimum, func(t *testing.T) {
			original := versionFixture(t, minimum)
			path := filepath.Join(filepath.Dir(original), "database #1 ä.db")
			if err := os.Rename(original, path); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			err = CheckCompatibility(path, BuildInfo{Version: "0.8.0rc"})
			if minimum == "0.8.0rc" && err != nil {
				t.Fatal("rejected compatible version", err)
			}
			if minimum == "0.9.0" {
				var compatibility *CompatibilityError
				if !errors.As(err, &compatibility) || compatibility.MinimumVersion != minimum {
					t.Fatal("missed required update", err)
				}
			}
			after, err := os.ReadFile(path)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatal("inspection changed the database", err)
			}
		})
	}
	path := filepath.Join(t.TempDir(), "missing.db")
	if err := CheckCompatibility(path, BuildInfo{Version: "0.8.0"}); err == nil {
		t.Fatal("accepted missing file")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("inspection created missing database", err)
	}
}
