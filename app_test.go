package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func testApp(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	a := &App{appDir: dir, settingsPath: filepath.Join(dir, "settings.json"), demoDBPath: filepath.Join(dir, "dodrag.db"), settings: AppSettings{KnownDatabases: []DatabaseEntry{}}}
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
		if err != nil || string(got) != string(want) {
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
