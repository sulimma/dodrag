package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestWindowsUILanguageMapping(t *testing.T) {
	for id, want := range map[uint16]string{
		0x0407: "de", 0x0807: "de", 0x0409: "en", 0x0809: "en",
		0x040c: "fr", 0x0c0a: "es", 0x0422: "uk", 0x0411: "ja", 0x0412: "ko",
		0x0804: "zh-CN", 0x1004: "zh-CN", 0x7804: "zh-CN", 0x0004: "zh-CN",
		0x0404: "zh-TW", 0x0c04: "zh-TW", 0x1404: "zh-TW", 0x7c04: "zh-TW",
		0x0416: "pt-BR", 0x0816: "pt-BR", 0x0016: "pt-BR", 0: "en", 0x0413: "en",
		0x0410: "it", 0x0810: "it", 0x0415: "pl", 0x041f: "tr",
	} {
		if got := uiLanguageFromWindows(id); got != want {
			t.Errorf("LANGID %04x: got %s, want %s", id, got, want)
		}
	}
	// The native helper must be callable; supported language selection remains pure/testable.
	if got := uiLanguageFromWindows(getUserDefaultUILanguage()); !validUILanguage(got) {
		t.Fatal("native UI language did not map to a supported language", got)
	}
}

func TestUILanguageFirstStartAndMigration(t *testing.T) {
	for _, raw := range []string{"", `{}`, `{"uiLanguage":"invalid"}`, `{"uiLanguage":""}`, `{"uiLanguage":null}`} {
		t.Run(raw, func(t *testing.T) {
			a := testApp(t)
			a.userDefaultUILanguage = func() uint16 { return 0x0c04 }
			if raw != "" {
				if err := os.WriteFile(a.settingsPath, []byte(raw), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := a.loadOrInitSettingsLocked(); err != nil {
				t.Fatal(err)
			}
			settings, err := a.GetSettings()
			if err != nil || settings.UILanguage != "zh-TW" {
				t.Fatal("wrong first-start/migration language", settings.UILanguage, err)
			}
			before, err := os.ReadFile(a.settingsPath)
			if err != nil || !strings.Contains(string(before), `"uiLanguage": "zh-TW"`) {
				t.Fatal("migration not persisted", string(before), err)
			}
			a.userDefaultUILanguage = func() uint16 { t.Fatal("queried OS after migration"); return 0 }
			if err := a.loadOrInitSettingsLocked(); err != nil {
				t.Fatal(err)
			}
			after, _ := os.ReadFile(a.settingsPath)
			if string(before) != string(after) || a.settings.UILanguage != "zh-TW" {
				t.Fatal("migration repeated or changed language")
			}
		})
	}
}

func TestUILanguagePersistValidationAndRollback(t *testing.T) {
	a := testApp(t)
	a.userDefaultUILanguage = func() uint16 { return 0x0413 }
	if err := a.loadOrInitSettingsLocked(); err != nil || a.settings.UILanguage != "en" {
		t.Fatal("unsupported OS language must fall back to en", err)
	}
	var registered []string
	a.registerJumpList = func(language string) { registered = append(registered, language) }
	for _, language := range uiLanguages {
		got, err := a.SetUILanguage(language)
		if err != nil || got.UILanguage != language {
			t.Fatal("failed valid language", language, err)
		}
		if err := a.loadOrInitSettingsLocked(); err != nil || a.settings.UILanguage != language {
			t.Fatal("language did not survive reload", language, err)
		}
	}
	if !reflect.DeepEqual(registered, uiLanguages) {
		t.Fatal("JumpList not refreshed after each setting", registered)
	}
	before, _ := os.ReadFile(a.settingsPath)
	previousLanguage := a.settings.UILanguage
	for _, invalid := range []string{"", "DE", "en-US", "pt-PT", "zh", " fr", "unknown"} {
		if got, err := a.SetUILanguage(invalid); err == nil || got.UILanguage != previousLanguage {
			t.Fatal("invalid language accepted/changed state", invalid, got, err)
		}
	}
	after, _ := os.ReadFile(a.settingsPath)
	if string(before) != string(after) || len(registered) != len(uiLanguages) {
		t.Fatal("invalid setting persisted or registered")
	}
	// Hold the original file without delete-sharing: atomic rename must fail on Windows.
	locked, err := os.Open(a.settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := a.SetUILanguage("fr"); err == nil || got.UILanguage != previousLanguage || a.settings.UILanguage != previousLanguage {
		t.Fatal("failed save did not roll back", got, err)
	}
	locked.Close()
	after, _ = os.ReadFile(a.settingsPath)
	if string(before) != string(after) || len(registered) != len(uiLanguages) {
		t.Fatal("failed save modified original or JumpList")
	}
	if _, err := a.GetSettings(); err == nil {
		t.Fatal("save failure not exposed")
	}
	if _, err := a.SetUILanguage("fr"); err != nil {
		t.Fatal("successful retry failed", err)
	}
	if _, err := a.GetSettings(); err != nil {
		t.Fatal("stale save failure", err)
	}
	files, _ := filepath.Glob(filepath.Join(a.appDir, ".settings-*.tmp"))
	if len(files) != 0 {
		t.Fatal("temporary settings leaked", files)
	}
}

func TestUILanguageMigrationFailurePreservesOriginal(t *testing.T) {
	a := testApp(t)
	a.userDefaultUILanguage = func() uint16 { return 0x0411 }
	name := "Meine unveraenderte Datenbank"
	fixture := persistedSettings{KnownDatabases: []DatabaseEntry{{Name: name, Path: filepath.Join(a.appDir, "mine.db")}}}
	raw, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(a.settingsPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	locked, err := os.Open(a.settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	defer locked.Close()
	if err := a.loadOrInitSettingsLocked(); err == nil {
		t.Fatal("ignored migration save failure")
	}
	if _, err := a.SetUILanguage("fr"); err == nil {
		t.Fatal("ignored failed migration blocker")
	}
	got, _ := os.ReadFile(a.settingsPath)
	if string(got) != string(raw) {
		t.Fatal("failed migration changed original")
	}
	if err := locked.Close(); err != nil {
		t.Fatal(err)
	}
	if err := a.loadOrInitSettingsLocked(); err != nil {
		t.Fatal("migration retry failed", err)
	}
	if a.settings.UILanguage != "ja" || len(a.settings.KnownDatabases) != 1 || a.settings.KnownDatabases[0].Name != name {
		t.Fatal("migration changed user data or failed", a.settings)
	}
}
