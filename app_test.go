package main

import (
	"context"
	"database/sql"
	"dodrag/internal/eventstore"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestAutoMiniUnfocusedTimer(t *testing.T) {
	start := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	a := &App{}
	for _, tc := range []struct {
		name       string
		after      time.Duration
		foreground bool
		mini       bool
		want       bool
		wantSince  time.Time
	}{
		{"foreground", 0, true, false, false, time.Time{}},
		{"focus lost", time.Minute, false, false, false, start.Add(time.Minute)},
		{"below threshold", 11*time.Minute - time.Nanosecond, false, false, false, start.Add(time.Minute)},
		{"at threshold", 11 * time.Minute, false, false, true, start.Add(time.Minute)},
		{"focus resets expired timer", 12 * time.Minute, true, false, false, time.Time{}},
		{"new unfocused period", 13 * time.Minute, false, false, false, start.Add(13 * time.Minute)},
		{"new period below threshold", 22 * time.Minute, false, false, false, start.Add(13 * time.Minute)},
		{"mini clears timer", 23 * time.Minute, false, true, false, time.Time{}},
		{"mini remains exempt", 24 * time.Hour, false, true, false, time.Time{}},
		{"restored starts fresh", 25 * time.Hour, false, false, false, start.Add(25 * time.Hour)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a.windowMode = WindowModeWindow
			if tc.mini {
				a.windowMode = WindowModeMini
			}
			if got := a.shouldAutoMiniLocked(start.Add(tc.after), tc.foreground); got != tc.want {
				t.Fatalf("auto mini = %v, want %v", got, tc.want)
			}
			if !a.unfocusedSince.Equal(tc.wantSince) {
				t.Fatalf("unfocused since = %v, want %v", a.unfocusedSince, tc.wantSince)
			}
		})
	}
}

func TestShutdownStopsNativeWatcher(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	a := &App{desktopState: desktopState{watchCancel: cancel, watchDone: done, unfocusedSince: time.Now()}}
	go func() {
		defer close(done)
		a.watchNativeMinimize(ctx)
	}()
	stopped := make(chan struct{})
	go func() {
		a.shutdown(context.Background())
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown did not stop watcher")
	}
	select {
	case <-done:
	default:
		t.Fatal("shutdown returned before watcher stopped")
	}
	if !a.unfocusedSince.IsZero() {
		t.Fatal("shutdown retained unfocused timer")
	}
	// Repeated shutdown must not block on an already stopped watcher.
	a.shutdown(context.Background())
}

func TestMiniLogicalSize(t *testing.T) {
	for _, tc := range []struct{ count, height int }{{0, 58}, {1, 58}, {2, 86}, {4, 142}, {8, 142}} {
		width, height := computeMiniLogicalSize(tc.count)
		if width != 320 || height != tc.height {
			t.Fatalf("count %d: got %dx%d, want 320x%d", tc.count, width, height, tc.height)
		}
	}
}

func testApp(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	a := &App{appDir: dir, settingsPath: filepath.Join(dir, "settings.json"), demoDBPath: filepath.Join(dir, "dodrag.db"), settings: AppSettings{KnownDatabases: []DatabaseEntry{}, UILanguage: "de"}}
	t.Cleanup(func() {
		if a.store != nil {
			a.store.Close()
		}
	})
	return a
}
func TestDatabaseLifecycle(t *testing.T) {
	a := testApp(t)
	if _, err := a.CreateDatabase("", "../bad", false); err == nil {
		t.Fatal("accepted path")
	}
	settings, err := a.CreateDatabase("", "empty", false)
	if err != nil {
		t.Fatal(err)
	}
	path := settings.ActiveDatabasePath
	events, _ := a.GetEvents()
	if len(events) != 0 {
		t.Fatal("unexpected demo")
	}
	if _, err := a.CreateDatabase("", "empty", true); err == nil {
		t.Fatal("overwrote existing file")
	}
	if _, err := a.SwitchDatabase(filepath.Join(a.appDir, "missing.db")); err == nil {
		t.Fatal("accepted missing file")
	}
	if a.settings.ActiveDatabasePath != path || a.store == nil {
		t.Fatal("failed switch replaced store")
	}
	a.settingsPath = filepath.Join(a.appDir, "missing", "settings.json")
	if _, err := a.CreateDatabase("", "failed", true); err == nil {
		t.Fatal("ignored settings failure")
	}
	if _, err := os.Stat(filepath.Join(a.appDir, "failed.db")); !os.IsNotExist(err) {
		t.Fatal("left failed creation")
	}
	if a.settings.ActiveDatabasePath != path {
		t.Fatal("failed activation changed settings")
	}
	a.settingsPath = filepath.Join(a.appDir, "settings.json")
	if _, err := a.DeleteDatabase(path, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("forget deleted file")
	}
	if _, err := a.CreateDatabase("", "demo", true); err != nil {
		t.Fatal(err)
	}
	events, _ = a.GetEvents()
	if len(events) == 0 {
		t.Fatal("demo not seeded")
	}
}

func TestDatabaseVersionBuildAndStartupError(t *testing.T) {
	previousVersion, previousBuild := buildVersion, buildTime
	const testVersion = "1.2.3"
	buildVersion, buildTime = testVersion+"rc", "2026-11-06T10:00:00Z"
	t.Cleanup(func() { buildVersion, buildTime = previousVersion, previousBuild })
	a := testApp(t)
	settings, err := a.CreateDatabase("", "versioned", false)
	if err != nil {
		t.Fatal(err)
	}
	path := settings.ActiveDatabasePath
	if err := a.store.Close(); err != nil {
		t.Fatal(err)
	}
	a.store = nil
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version, build, minimum string
	if err := db.QueryRow(`SELECT app_version,app_build_time,minimum_app_version FROM database_metadata WHERE id=1`).Scan(&version, &build, &minimum); err != nil {
		t.Fatal(err)
	}
	if version != testVersion || build != buildTime || minimum != eventstore.MinimumAppVersion {
		t.Fatal("app build identity was not passed to the database", version, build, minimum)
	}
	if _, err := db.Exec(`UPDATE database_metadata SET minimum_app_version='9.0.0rc'`); err != nil {
		t.Fatal(err)
	}
	a.openActiveDatabaseLocked()
	for _, language := range uiLanguages {
		a.settings.UILanguage = language
		settings, err = a.GetSettings()
		expected := backendText(language, "Diese Datenbank ist mit dieser App-Version nicht kompatibel. Bitte eine neuere Version von DoDrag installieren (mindestens {version}).", "version", "9.0.0")
		if err != nil || settings.DatabaseReady || !strings.Contains(settings.DatabaseError, expected) || strings.Contains(settings.DatabaseError, "9.0.0rc") {
			t.Fatal("startup did not expose the localized upgrade instruction", language, settings.DatabaseError, err)
		}
		_, err = a.SwitchDatabase(path)
		var compatibility *eventstore.CompatibilityError
		if !errors.As(err, &compatibility) || compatibility.MinimumVersion != "9.0.0" || !strings.Contains(err.Error(), expected) {
			t.Fatal("switch did not expose the localized upgrade instruction", language, err)
		}
	}
	if _, err := db.Exec(`UPDATE database_metadata SET minimum_app_version=?`, eventstore.MinimumAppVersion); err != nil {
		t.Fatal(err)
	}
	settings, err = a.SwitchDatabase(path)
	if err != nil || !settings.DatabaseReady || settings.DatabaseError != "" {
		t.Fatal("successful recovery retained startup error", settings, err)
	}
}

// Simulates the missing-drive boundary with a temporarily absent file. Native
// DriveFS mounting remains a manual test; no user drive or process is changed.
func TestDatabaseRecoveryAfterUnavailableStartup(t *testing.T) {
	a := testApp(t)
	settings, err := a.CreateDatabase("", "delayed", false)
	if err != nil {
		t.Fatal(err)
	}
	path := settings.ActiveDatabasePath
	for _, event := range []struct{ id, payload string }{
		{"original", `{"taskId":"a","title":"Original","configuredStart":"2026-11-05T09:00:00Z","createdAt":"2026-11-05T09:00:00Z"}`},
		{"copy", `{"taskId":"b","title":"Copy","configuredStart":"2026-11-05T09:00:00Z","createdAt":"2026-11-05T09:00:00Z","copiedFromId":"a"}`},
	} {
		if _, err := a.AppendEvent(event.id, "TASK_CREATED", event.payload); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.store.Close(); err != nil {
		t.Fatal(err)
	}
	a.store = nil
	parked := path + ".unavailable"
	if err := os.Rename(path, parked); err != nil {
		t.Fatal(err)
	}
	a.openActiveDatabaseLocked()
	settings, err = a.GetSettings()
	if err != nil || settings.DatabaseReady || settings.ActiveDatabasePath != path {
		t.Fatal("unavailable startup lost the configured database", settings, err)
	}
	if _, err := a.SwitchDatabase(path); err == nil {
		t.Fatal("accepted unavailable database")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("retry created a replacement database", err)
	}
	if err := os.Rename(parked, path); err != nil {
		t.Fatal(err)
	}
	settings, err = a.SwitchDatabase(path)
	if err != nil || !settings.DatabaseReady || settings.ActiveDatabasePath != path {
		t.Fatal("failed to recover the configured database", settings, err)
	}
	events, err := a.GetEvents()
	if err != nil || len(events) != 2 || events[0].ID != "original" || events[1].ID != "copy" ||
		!strings.Contains(string(events[1].Payload), `"copiedFromId":"a"`) {
		t.Fatal("recovered database lost existing tasks or copy provenance", events, err)
	}
}

func TestSwitchLegacyDatabaseNormalizesUTCAndResetsCachedTasks(t *testing.T) {
	a := testApp(t)
	settings, err := a.CreateDatabase("", "current", false)
	if err != nil {
		t.Fatal(err)
	}
	current := settings.ActiveDatabasePath
	if _, err := a.AppendEvent("same", "TASK_CREATED", `{"taskId":"a","title":"current","configuredStart":"2026-10-25T09:00:00Z","createdAt":"2026-10-25T09:00:00Z"}`); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(a.appDir, "legacy.db")
	db, err := sql.Open("sqlite", legacy)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,timestamp TEXT NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0);
		INSERT INTO events(id,timestamp,type,payload) VALUES('same','2026-10-25T09:00:00.000000001+02:00','TASK_CREATED','{"taskId":"a","title":"legacy","configuredStart":"2026-10-25T09:00:00+02:00","createdAt":"2026-10-25T09:00:00.000000001+02:00"}');`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	a.settings.KnownDatabases = append(a.settings.KnownDatabases, DatabaseEntry{Name: "legacy", Path: legacy})
	if _, err := a.SwitchDatabase(legacy); err != nil {
		t.Fatal(err)
	}
	events, err := a.GetEvents()
	if err != nil || len(events) != 1 || events[0].Timestamp != "2026-10-25T07:00:00.000000001Z" ||
		!strings.Contains(string(events[0].Payload), `"title":"legacy"`) ||
		!strings.Contains(string(events[0].Payload), `"createdAt":"2026-10-25T07:00:00.000000001Z"`) ||
		!strings.Contains(string(events[0].Payload), `"configuredStart":"2026-10-25T09:00:00+02:00"`) {
		t.Fatal("legacy database migration or cache isolation failed", events, err)
	}
	if _, err := a.SwitchDatabase(current); err != nil {
		t.Fatal(err)
	}
	events, err = a.GetEvents()
	if err != nil || len(events) != 1 || !strings.Contains(string(events[0].Payload), `"title":"current"`) {
		t.Fatal("database switch retained foreign cache", events, err)
	}
}

func TestIncompatibleDatabaseKeepsActive(t *testing.T) {
	a := testApp(t)
	if _, err := a.CreateDatabase("", "good", false); err != nil {
		t.Fatal(err)
	}
	old := a.store
	path := filepath.Join(a.appDir, "bad.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE events (other TEXT)`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	a.settings.KnownDatabases = append(a.settings.KnownDatabases, DatabaseEntry{Path: path})
	if _, err = a.SwitchDatabase(path); err == nil {
		t.Fatal("accepted incompatible schema")
	}
	if a.store != old {
		t.Fatal("closed active database")
	}
}
func TestSettingsAtomicReplacement(t *testing.T) {
	a := testApp(t)
	if err := a.saveSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	a.settings.Autostart = true
	if err := a.saveSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(a.settingsPath)
	if err != nil || len(raw) == 0 {
		t.Fatal("settings missing", err)
	}
}

func TestSettingsLoadPreservesInvalidOriginal(t *testing.T) {
	for _, raw := range []string{`{broken`, `null`, `[]`, `{"autostart":"yes"}`, ``} {
		t.Run(raw, func(t *testing.T) {
			a := testApp(t)
			if err := os.WriteFile(a.settingsPath, []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
			if err := a.loadOrInitSettingsLocked(); err == nil {
				t.Fatal("accepted invalid settings")
			}
			if _, err := a.GetSettings(); err == nil {
				t.Fatal("load failure not exposed")
			}
			a.onMiniWindowSnapped("PRIMARY", "top-right")
			if _, err := a.CreateDatabase("", "blocked", false); err == nil {
				t.Fatal("created database after load failure")
			}
			if _, err := a.SetAutostart(true); err == nil {
				t.Fatal("autostart not blocked before Registry access")
			}
			got, err := os.ReadFile(a.settingsPath)
			if err != nil || string(got) != raw {
				t.Fatalf("original overwritten: %q, %v", got, err)
			}
			if err := os.WriteFile(a.settingsPath, []byte(`{}`), 0600); err != nil {
				t.Fatal(err)
			}
			if err := a.loadOrInitSettingsLocked(); err != nil {
				t.Fatal("valid reload failed", err)
			}
			if _, err := a.GetSettings(); err != nil {
				t.Fatal("stale load error", err)
			}
		})
	}
}

func TestSettingsMissingAndReadFailure(t *testing.T) {
	a := testApp(t)
	if err := a.loadOrInitSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(a.settingsPath); err != nil {
		t.Fatal("first start not saved", err)
	}
	a.settingsPath = a.appDir // A directory is not a missing settings file.
	if err := a.loadOrInitSettingsLocked(); err == nil {
		t.Fatal("ignored read error")
	}
	if err := a.saveSettingsLocked(); err == nil {
		t.Fatal("ignored load blocker")
	}
	info, err := os.Stat(a.appDir)
	if err != nil || !info.IsDir() {
		t.Fatal("changed unreadable original", err)
	}
	failedInit := testApp(t)
	failedInit.settingsPath = filepath.Join(failedInit.appDir, "missing", "settings.json")
	if err := failedInit.loadOrInitSettingsLocked(); err == nil {
		t.Fatal("ignored first-start save failure")
	}
	if _, err := failedInit.GetSettings(); err == nil {
		t.Fatal("first-start save failure not exposed")
	}
}

func TestDockSaveFailureIsVisible(t *testing.T) {
	a := testApp(t)
	a.windowMode = WindowModeMini
	a.settingsPath = filepath.Join(a.appDir, "missing", "settings.json")
	a.onMiniWindowSnapped("PRIMARY", "top-right")
	if _, err := a.GetSettings(); err == nil {
		t.Fatal("dock save failure not exposed")
	}
	a.settingsPath = filepath.Join(a.appDir, "settings.json")
	if err := a.saveSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GetSettings(); err != nil {
		t.Fatal("successful save did not clear error", err)
	}
}

func TestDeleteFailurePreservesCommittedWAL(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows file sharing semantics")
	}
	a := testApp(t)
	path := filepath.Join(a.appDir, "recoverable.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE committed (value TEXT); INSERT INTO committed VALUES ('in WAL')`); err != nil {
		t.Fatal(err)
	}
	// Snapshot a committed, uncheckpointed database, then release all connections.
	snapshots := make(map[string][]byte)
	for _, name := range []string{path, path + "-wal", path + "-shm"} {
		raw, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		snapshots[name] = raw
	}
	if len(snapshots[path+"-wal"]) <= 32 {
		t.Fatal("no committed WAL fixture")
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	for name, raw := range snapshots {
		if err := os.WriteFile(name, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	// Go's Windows Open shares reads/writes, but not deletion.
	locked, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer locked.Close()
	a.settings.KnownDatabases = []DatabaseEntry{{Path: path}}
	if _, err := a.DeleteDatabase(path, true); err == nil {
		t.Fatal("ignored physical deletion error")
	}
	for name, want := range snapshots {
		got, err := os.ReadFile(name)
		// Read-only compatibility inspection can update SQLite's shared-memory
		// read marks. SHM must remain available, but its bytes are not durable
		// user data. Keep exact DB/WAL checks and the recovery assertion below.
		if err != nil || (name != path+"-shm" && string(got) != string(want)) {
			t.Fatalf("recoverable file changed: %s, %v", name, err)
		}
	}
	if len(a.settings.KnownDatabases) != 1 {
		t.Fatal("forgot database after failure")
	}
	if err := locked.Close(); err != nil {
		t.Fatal(err)
	}
	recovered, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	var value string
	if err := recovered.QueryRow(`SELECT value FROM committed`).Scan(&value); err != nil || value != "in WAL" {
		t.Fatal("committed WAL not recoverable", value, err)
	}
}

func TestDeletePartialFailures(t *testing.T) {
	for _, settingsFailure := range []bool{false, true} {
		t.Run(fmt.Sprint(settingsFailure), func(t *testing.T) {
			a := testApp(t)
			settings, err := a.CreateDatabase("", "delete", false)
			if err != nil {
				t.Fatal(err)
			}
			path := settings.ActiveDatabasePath
			if err := a.store.Close(); err != nil {
				t.Fatal(err)
			}
			a.store = nil
			if settingsFailure {
				a.settingsPath = filepath.Join(a.appDir, "missing", "settings.json")
			} else {
				if err := os.Mkdir(path+"-wal", 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(path+"-wal", "block"), []byte("x"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			got, err := a.DeleteDatabase(path, true)
			if err == nil || !strings.Contains(err.Error(), "Hauptdatei entfernt") {
				t.Fatal("partial failure not explicit", err)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("main file remains", err)
			}
			if got.DatabaseReady || a.store != nil {
				t.Fatal("claims deleted database is ready")
			}
			if !settingsFailure && (len(got.KnownDatabases) != 0 || got.ActiveDatabasePath != "") {
				t.Fatal("sidecar failure kept deleted database active", got)
			}
		})
	}
}

func TestDefaultDurationSettings(t *testing.T) {
	a := testApp(t)
	if err := a.loadOrInitSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	if a.settings.DefaultDuration != 1 || a.settings.DefaultDurationUnit != "days" {
		t.Fatal("missing duration defaults")
	}
	got, err := a.SetDefaultDuration(2.5, "hours")
	if err != nil || got.DefaultDuration != 2.5 || got.DefaultDurationUnit != "hours" {
		t.Fatal(got, err)
	}
	if err = a.loadOrInitSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	if a.settings.DefaultDuration != 2.5 || a.settings.DefaultDurationUnit != "hours" {
		t.Fatal("duration not persisted")
	}
	for _, invalid := range []struct {
		value float64
		unit  string
	}{{0, "days"}, {-1, "hours"}, {4, "weeks"}, {36501, "days"}} {
		if _, err = a.SetDefaultDuration(invalid.value, invalid.unit); err == nil {
			t.Fatal("accepted invalid default", invalid)
		}
	}
	a.settingsPath = a.appDir
	if _, err = a.SetDefaultDuration(45, "minutes"); err == nil {
		t.Fatal("save failure ignored")
	}
	if a.settings.DefaultDuration != 2.5 || a.settings.DefaultDurationUnit != "hours" {
		t.Fatal("failed save replaced defaults")
	}
	a = testApp(t)
	if err = os.WriteFile(a.settingsPath, []byte(`{"uiLanguage":"de"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = a.loadOrInitSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	if a.settings.DefaultDuration != 1 || a.settings.DefaultDurationUnit != "days" {
		t.Fatal("legacy settings not migrated")
	}
}

func TestDatabaseKnownCompatibilityChecksInactive(t *testing.T) {
	a := testApp(t)
	active, err := a.CreateDatabase("", "active", false)
	if err != nil {
		t.Fatal(err)
	}
	originalStore := a.store
	inactive := filepath.Join(a.appDir, "inactive.db")
	db, err := sql.Open("sqlite", inactive)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE database_metadata (id INTEGER PRIMARY KEY,app_version TEXT,app_build_time TEXT,minimum_app_version TEXT);
		INSERT INTO database_metadata VALUES(1,'9.0.0','future-build','9.0.0rc')`); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a.settings.KnownDatabases = append(a.settings.KnownDatabases,
		DatabaseEntry{Name: "inactive", Path: inactive},
		DatabaseEntry{Name: "offline", Path: filepath.Join(a.appDir, "missing.db")})
	settings, err := a.GetSettings()
	if err != nil || !settings.DatabaseReady || settings.ActiveDatabasePath != active.ActiveDatabasePath || a.store != originalStore {
		t.Fatal("inspection changed active database", settings, err)
	}
	if len(settings.KnownDatabases) != 3 || settings.KnownDatabases[0].RequiresUpdate || !settings.KnownDatabases[1].RequiresUpdate || settings.KnownDatabases[2].RequiresUpdate {
		t.Fatal("incorrect compatibility results", settings.KnownDatabases)
	}
	var version, build, minimum string
	if err := db.QueryRow(`SELECT app_version,app_build_time,minimum_app_version FROM database_metadata WHERE id=1`).Scan(&version, &build, &minimum); err != nil {
		t.Fatal(err)
	}
	if version != "9.0.0" || build != "future-build" || minimum != "9.0.0rc" {
		t.Fatal("settings inspection stamped an inactive database", version, build, minimum)
	}
	if a.settings.KnownDatabases[1].RequiresUpdate {
		t.Fatal("transient compatibility result entered persisted settings")
	}
	if _, err := db.Exec(`UPDATE database_metadata SET minimum_app_version=?`, eventstore.MinimumAppVersion); err != nil {
		t.Fatal(err)
	}
	settings, err = a.GetSettings()
	if err != nil || settings.KnownDatabases[1].RequiresUpdate {
		t.Fatal("settings refresh retained obsolete update requirement", settings, err)
	}
}

func TestDescriptionCheckpointDatabaseIdentityAndWebViewReload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "draft.db")
	store, err := eventstore.NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.AppendEvent("created", "TASK_CREATED", `{"taskId":"a","title":"A","configuredStart":"2026-11-10T09:00:00Z","createdAt":"2026-11-10T09:00:00Z"}`); err != nil {
		t.Fatal(err)
	}
	app := &App{store: store, settings: AppSettings{ActiveDatabasePath: path}}
	if err := app.SaveDescriptionDraft("old.db", "a", "Wrong database", "", "s", 1); err == nil {
		t.Fatal("late write crossed database identity")
	}
	if err := app.SaveDescriptionDraft(path, "a", "Restored after WebView reload", "", "s", 2); err != nil {
		t.Fatal(err)
	}
	events, err := app.GetEvents()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || !strings.Contains(string(events[1].Payload), "Restored after WebView reload") {
		t.Fatal("new frontend did not recover checkpoint")
	}
	again, err := app.GetEvents()
	if err != nil || len(again) != 2 {
		t.Fatal("reload duplicated recovery")
	}
}

func TestDefaultTimeMarkersSettings(t *testing.T) {
	a := testApp(t)
	values := []int{900, 720}
	settings, err := a.SetDefaultTimeMarkers(values)
	if err != nil || len(settings.DefaultTimeMarkers) != 2 || settings.DefaultTimeMarkers[0] != 720 {
		t.Fatal(settings, err)
	}
	values[0] = 1
	settings.DefaultTimeMarkers[0] = 2
	if a.settings.DefaultTimeMarkers[0] != 720 {
		t.Fatal("settings alias")
	}
	if _, err := a.SetDefaultTimeMarkers([]int{720, 720}); err == nil {
		t.Fatal("accepted duplicate times")
	}
	if _, err := a.SetDefaultTimeMarkers([]int{1440}); err == nil {
		t.Fatal("accepted invalid time")
	}
	if err := a.loadOrInitSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	if len(a.settings.DefaultTimeMarkers) != 2 || a.settings.DefaultTimeMarkers[0] != 720 {
		t.Fatal("lost marker defaults on reload")
	}
	a.settingsPath = filepath.Join(a.appDir, "missing", "settings.json")
	if _, err := a.SetDefaultTimeMarkers([]int{600}); err == nil {
		t.Fatal("ignored save failure")
	}
	if a.settings.DefaultTimeMarkers[0] != 720 {
		t.Fatal("failed save changed defaults")
	}
}

func TestForgetOnlyExactMissingDatabase(t *testing.T) {
	a := testApp(t)
	upper := filepath.Join(a.appDir, "Plan.db")
	lower := filepath.Join(a.appDir, "plan.db")
	a.settings.KnownDatabases = []DatabaseEntry{{Path: upper}, {Path: lower}}
	a.settings.ActiveDatabasePath = upper
	settings, err := a.DeleteDatabase(lower, false)
	if err != nil || len(settings.KnownDatabases) != 1 || settings.KnownDatabases[0].Path != upper || settings.ActiveDatabasePath != upper {
		t.Fatalf("forgetting %q changed the other entry: %+v, %v", lower, settings, err)
	}
}

func TestSwitchDatabaseByFileIdentity(t *testing.T) {
	a := testApp(t)
	settings, err := a.CreateDatabase(a.appDir, "Plan.db", false)
	if err != nil {
		t.Fatal(err)
	}
	original := settings.ActiveDatabasePath
	alias := filepath.Join(a.appDir, "other-name.db")
	if err := os.Link(original, alias); err != nil {
		t.Skipf("hard links unavailable: %v", err)
	}
	settings, err = a.SwitchDatabase(alias)
	if err != nil || settings.ActiveDatabasePath != original || len(settings.KnownDatabases) != 1 {
		t.Fatalf("alias did not select the registered database: %+v, %v", settings, err)
	}
}

func TestCaseDistinctDatabaseFiles(t *testing.T) {
	a := testApp(t)
	first, err := a.CreateDatabase(a.appDir, "Plan.db", false)
	if err != nil {
		t.Fatal(err)
	}
	lower := filepath.Join(a.appDir, "plan.db")
	if _, err := os.Stat(lower); err == nil {
		t.Skip("temporary directory ignores filename case")
	}
	second, err := a.CreateDatabase(a.appDir, "plan.db", false)
	if err != nil || len(second.KnownDatabases) != 2 {
		t.Fatalf("create: %+v, %v", second, err)
	}
	settings, err := a.DeleteDatabase(first.ActiveDatabasePath, true)
	if err != nil || !settings.DatabaseReady || settings.ActiveDatabasePath != lower || len(settings.KnownDatabases) != 1 {
		t.Fatalf("deleting the other spelling changed the active database: %+v, %v", settings, err)
	}
}
