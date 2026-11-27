package main

import (
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"dodrag/internal/eventstore"
)

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
	for _, path := range []string{"app.go", "autostart_windows.go", "window_windows.go", "desktop_windows.go", "install_windows.go", "window_mode_windows.go", "window_titlebar_windows.go"} {
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(node ast.Node) bool {
			// RunSetupAction moved from app.go. The low-level COM helpers in
			// this file use API names and HRESULT diagnostics as error causes.
			if fn, ok := node.(*ast.FuncDecl); ok && path == "install_windows.go" && fn.Name.Name != "RunSetupAction" {
				return false
			}
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
