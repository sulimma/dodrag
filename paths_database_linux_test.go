package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCaseDistinctDatabaseFiles(t *testing.T) {
	a := testApp(t)
	check := func(name, task string) string {
		t.Helper()
		settings, err := a.CreateDatabase(a.appDir, name, false)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := a.AppendEvent(task, "TASK_CREATED", `{"taskId":"`+task+`","title":"test","configuredStart":"2026-10-25T00:00:00Z","createdAt":"2026-10-25T12:00:00Z"}`); err != nil {
			t.Fatal(err)
		}
		return settings.ActiveDatabasePath
	}
	assertEvents := func(wantID string) {
		t.Helper()
		events, err := a.GetEvents()
		if err != nil || len(events) != 1 || events[0].ID != wantID {
			t.Fatalf("want only %q, got %+v, %v", wantID, events, err)
		}
	}

	upper := check("Plan.db", "upper")
	lower := filepath.Join(a.appDir, "plan.db")
	if _, err := os.Stat(lower); err == nil {
		t.Skip("temporary directory ignores filename case")
	} else if !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	if got := check("plan.db", "lower"); got != lower {
		t.Fatalf("create lower selected %q, want %q", got, lower)
	}
	for _, tc := range []struct{ path, eventID string }{{upper, "upper"}, {lower, "lower"}} {
		settings, err := a.SwitchDatabase(tc.path)
		if err != nil || settings.ActiveDatabasePath != tc.path || len(settings.KnownDatabases) != 2 {
			t.Fatalf("switch to %q: %+v, %v", tc.path, settings, err)
		}
		assertEvents(tc.eventID)
	}
	settings, err := a.DeleteDatabase(upper, true)
	if err != nil || !settings.DatabaseReady || settings.ActiveDatabasePath != lower || len(settings.KnownDatabases) != 1 || settings.KnownDatabases[0].Path != lower {
		t.Fatalf("deleting the other spelling changed the active database: %+v, %v", settings, err)
	}
	if _, err := os.Stat(upper); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("upper database was not deleted: %v", err)
	}
	assertEvents("lower")
}
