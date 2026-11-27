package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
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
