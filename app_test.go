package main

import (
	"database/sql"
	"os"
	"path/filepath"
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
