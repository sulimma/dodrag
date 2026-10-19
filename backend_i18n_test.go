package main

import (
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"dodrag/internal/eventstore"
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

func TestUILanguageCorruptSettingsProtected(t *testing.T) {
	for _, raw := range []string{`{broken`, `null`, `[]`, `{"uiLanguage":42}`, `{"autostart":"yes","uiLanguage":"fr"}`} {
		t.Run(raw, func(t *testing.T) {
			a := testApp(t)
			if err := os.WriteFile(a.settingsPath, []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
			if err := a.loadOrInitSettingsLocked(); err == nil {
				t.Fatal("accepted corrupt settings")
			}
			a.registerJumpList = func(string) { t.Fatal("registered after failed load") }
			if _, err := a.SetUILanguage("ja"); err == nil {
				t.Fatal("changed language after failed load")
			}
			got, _ := os.ReadFile(a.settingsPath)
			if string(got) != raw {
				t.Fatal("overwrote corrupt original")
			}
		})
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

func TestBackendFallbackAndParameters(t *testing.T) {
	original := backendCatalogs
	t.Cleanup(func() { backendCatalogs = original })
	backendCatalogs = map[string]map[string]string{
		"de": {"Hallo {name}": "Hallo {name}", "Nur Deutsch": "Nur Deutsch"},
		"en": {"Hallo {name}": "Hello {name}"},
		"fr": {"Hallo {name}": "Bonjour {name}"},
	}
	for language, want := range map[string]string{"fr": "Bonjour Ada", "ja": "Hello Ada", "bad": "Hello Ada"} {
		if got := backendText(language, "Hallo {name}", "name", "Ada"); got != want {
			t.Fatal(language, got, want)
		}
	}
	if backendText("ja", "Nur Deutsch") != "Nur Deutsch" || backendText("ja", "unknown") != "unknown" {
		t.Fatal("missing catalog/key fallback failed")
	}
	detail := errors.New("technical OS detail")
	if got := localizedError("fr", "Hallo {name}", detail, "name", "Ada"); !errors.Is(got, detail) || got.Error() != "Bonjour Ada: technical OS detail" {
		t.Fatal("lost localized context or technical cause", got)
	}
}

func TestLocalizedDemoSeedPreservesExistingData(t *testing.T) {
	a := testApp(t)
	original := backendCatalogs
	catalogs := make(map[string]map[string]string)
	for language, catalog := range original {
		catalogs[language] = catalog
	}
	catalogs["ja"] = map[string]string{}
	for key := range original["de"] {
		catalogs["ja"][key] = "translated: " + key
	}
	backendCatalogs = catalogs
	t.Cleanup(func() { backendCatalogs = original })
	a.settings.UILanguage = "ja"
	settings, err := a.CreateDatabase("", "User database name", true)
	if err != nil {
		t.Fatal(err)
	}
	events, err := a.GetEvents()
	if err != nil {
		t.Fatal(err)
	}
	titles := 0
	for _, event := range events {
		var payload map[string]interface{}
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if title, ok := payload["title"].(string); ok {
			titles++
			if !strings.HasPrefix(title, "translated: ") {
				t.Fatal("untranslated seed", title)
			}
		}
	}
	if titles != 6 || settings.KnownDatabases[0].Name != "User database name" {
		t.Fatal("wrong titles/user name", titles, settings)
	}
	a.store.Close()
	a.store = nil
	called := false
	store, err := eventstore.NewStoreWithOptions(settings.ActiveDatabasePath, true, func(title string) string { called = true; return "changed" })
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	got, err := store.GetEvents()
	if err != nil || called || !reflect.DeepEqual(events, got) {
		t.Fatal("existing seed changed", called, err)
	}
}

func TestBackendCatalogParity(t *testing.T) {
	base := backendCatalogs["de"]
	if len(base) == 0 {
		t.Fatal("missing German catalog")
	}
	placeholders := regexp.MustCompile(`\{[a-zA-Z][a-zA-Z0-9_]*\}`)
	params := func(text string) []string {
		found := placeholders.FindAllString(text, -1)
		sort.Strings(found)
		return found
	}
	for _, language := range uiLanguages {
		t.Run(language, func(t *testing.T) {
			catalog, ok := backendCatalogs[language]
			if !ok {
				t.Fatalf("missing backend-%s.json", language)
			}
			if len(catalog) != len(base) {
				t.Errorf("got %d keys, want %d", len(catalog), len(base))
			}
			for key := range base {
				text := catalog[key]
				if strings.TrimSpace(text) == "" {
					t.Errorf("missing/empty %q", key)
				}
				if !reflect.DeepEqual(params(key), params(text)) {
					t.Errorf("placeholder mismatch %q: %q", key, text)
				}
			}
			for key := range catalog {
				if _, ok := base[key]; !ok {
					t.Errorf("extra key %q", key)
				}
			}
		})
	}
}

// A small runnable guard: go test -run TestNativeTextLocalization .
func TestNativeTextLocalization(t *testing.T) {
	literal := func(expr ast.Expr) (string, bool) {
		value, ok := expr.(*ast.BasicLit)
		if !ok || value.Kind != token.STRING {
			return "", false
		}
		text, err := strconv.Unquote(value.Value)
		return text, err == nil
	}
	for _, path := range []string{"app.go", "autostart_windows.go", "window_windows.go"} {
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(node ast.Node) bool {
			if field, ok := node.(*ast.KeyValueExpr); ok {
				if name, ok := field.Key.(*ast.Ident); ok && (name.Name == "Title" || name.Name == "DisplayName") {
					if _, raw := literal(field.Value); raw {
						t.Errorf("%s: unlocalized native field %s", fset.Position(field.Pos()), name.Name)
					}
				}
			}
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			name := ""
			switch fun := call.Fun.(type) {
			case *ast.Ident:
				name = fun.Name
			case *ast.SelectorExpr:
				name = fun.Sel.Name
			}
			keyIndex := -1
			switch name {
			case "backendText", "localizedError":
				keyIndex = 1
			case "textLocked", "errorLocked":
				keyIndex = 0
			}
			if keyIndex >= 0 && len(call.Args) > keyIndex {
				if key, ok := literal(call.Args[keyIndex]); ok {
					if _, exists := backendCatalogs["de"][key]; !exists {
						t.Errorf("%s: missing backend key %q", fset.Position(call.Pos()), key)
					}
				}
			}
			if (name == "New" || name == "Errorf") && len(call.Args) > 0 {
				if text, raw := literal(call.Args[0]); raw {
					t.Errorf("%s: raw user error %q", fset.Position(call.Pos()), text)
				}
			}
			if name == "createJumpListShellLink" && len(call.Args) == 4 {
				for _, arg := range call.Args[2:] {
					if text, raw := literal(arg); raw {
						t.Errorf("%s: raw JumpList text %q", fset.Position(call.Pos()), text)
					}
				}
			}
			return true
		})
	}
}
