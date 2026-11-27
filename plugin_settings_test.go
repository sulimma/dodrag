package main

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

const copySummaryPluginID = "copy-task-summary"

func TestPluginSettingsMatchFrontendRegistry(t *testing.T) {
	source, err := os.ReadFile("frontend/src/plugins/registry.ts")
	if err != nil {
		t.Fatal(err)
	}
	ids := regexp.MustCompile(`(?m)^\s+id: '([^']+)',`).FindAllSubmatch(source, -1)
	want := make(map[string]bool, len(ids))
	for _, match := range ids {
		want[string(match[1])] = false
	}
	settings, err := testApp(t).GetSettings()
	if err != nil || len(want) != len(ids) || !maps.Equal(settings.PluginEnabled, want) {
		t.Fatalf("backend plugin catalog %v does not match frontend IDs %v: %v", settings.PluginEnabled, want, err)
	}
}

func TestPluginSettingsPersistIndependentlyOfDatabase(t *testing.T) {
	a := testApp(t)
	const old = `{"uiLanguage":"en","defaultDuration":2,"defaultDurationUnit":"hours"}`
	if err := os.WriteFile(a.settingsPath, []byte(old), 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.loadOrInitSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	settings, err := a.GetSettings()
	if enabled, supported := settings.PluginEnabled[copySummaryPluginID]; err != nil || !supported || enabled {
		t.Fatalf("old settings did not expose the plugin as off: %v, %v", settings.PluginEnabled, err)
	}
	settings, err = a.SetPluginEnabled(copySummaryPluginID, true)
	if err != nil || !settings.PluginEnabled[copySummaryPluginID] || settings.DatabaseReady {
		t.Fatalf("could not enable without a database: %v, %v", settings, err)
	}
	settings.PluginEnabled[copySummaryPluginID] = false
	first, err := a.CreateDatabase("", "first", false)
	if err != nil || !first.PluginEnabled[copySummaryPluginID] {
		t.Fatalf("snapshot aliased settings or database creation lost the flag: %v, %v", first, err)
	}
	if _, err := a.CreateDatabase("", "second", false); err != nil {
		t.Fatal(err)
	}
	settings, err = a.SwitchDatabase(first.ActiveDatabasePath)
	if err != nil || !settings.PluginEnabled[copySummaryPluginID] {
		t.Fatalf("database switch lost the plugin flag: %v, %v", settings, err)
	}
	restarted := testApp(t)
	restarted.settingsPath = a.settingsPath
	if err := restarted.loadOrInitSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	settings, err = restarted.GetSettings()
	if err != nil || !settings.PluginEnabled[copySummaryPluginID] || settings.UILanguage != "en" || settings.DefaultDuration != 2 || settings.DefaultDurationUnit != "hours" {
		t.Fatalf("reloading lost plugin or unrelated preferences: %v, %v", settings, err)
	}
	settings, err = restarted.SetPluginEnabled(copySummaryPluginID, false)
	if err != nil || settings.PluginEnabled[copySummaryPluginID] || !first.PluginEnabled[copySummaryPluginID] {
		t.Fatalf("disabling failed or changed an earlier snapshot: %v, %v", settings, err)
	}
	if err := restarted.loadOrInitSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	settings, err = restarted.GetSettings()
	if err != nil || settings.PluginEnabled[copySummaryPluginID] {
		t.Fatalf("disable did not survive restart: %v, %v", settings, err)
	}
}

func TestPluginSettingsPreserveUnknownAndRollbackFailedSave(t *testing.T) {
	a := testApp(t)
	const unknown = "future-plugin"
	const raw = `{"uiLanguage":"en","pluginEnabled":{"copy-task-summary":true,"future-plugin":true}}`
	if err := os.WriteFile(a.settingsPath, []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.loadOrInitSettingsLocked(); err != nil {
		t.Fatal(err)
	}
	if settings, err := a.SetPluginEnabled(unknown, false); err == nil || settings.PluginEnabled[unknown] {
		t.Fatalf("unknown plugin was accepted or exposed: %v, %v", settings, err)
	}
	path := a.settingsPath
	a.settingsPath = filepath.Join(a.appDir, "missing", "settings.json")
	if settings, err := a.SetPluginEnabled(copySummaryPluginID, false); err == nil || !settings.PluginEnabled[copySummaryPluginID] {
		t.Fatalf("failed save changed the confirmed flag: %v, %v", settings, err)
	}
	a.settingsPath = path
	if _, err := a.SetPluginEnabled(copySummaryPluginID, false); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var settings struct{ PluginEnabled map[string]bool }
	if err := json.Unmarshal(bytes, &settings); err != nil || !maps.Equal(settings.PluginEnabled, map[string]bool{copySummaryPluginID: false, unknown: true}) {
		t.Fatalf("settings round trip did not preserve the unknown flag: %s, %v", bytes, err)
	}
}
