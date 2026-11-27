package main

import (
	"os"
	"path/filepath"
	"testing"
)

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
