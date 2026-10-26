package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAbsoluteLocalPathAndExistingPath(t *testing.T) {
	for _, raw := range []string{"", "relative", `C:relative`, `\rooted`, `\\?\C:\image.png`, `\\.\pipe\name`, "C:\\bad\x00.png", `C:\file.png:stream`, `C:\bad".png`} {
		if _, err := absoluteLocalPath(raw); err == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	for _, raw := range []string{`C:\Meine Ablage\file.png`, `\\server\share\file.png`, `\\server\share`} {
		if _, err := absoluteLocalPath(raw); err != nil {
			t.Errorf("rejected %q: %v", raw, err)
		}
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "file & percent %.txt")
	if err := os.WriteFile(path, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{dir, path} {
		if clean, _, err := existingPath(p, "en"); err != nil || clean != p {
			t.Fatal(clean, err)
		}
	}
	if _, _, err := existingPath(filepath.Join(dir, "missing"), "en"); err == nil {
		t.Fatal("missing path accepted")
	}
}

func TestExternalURLValidation(t *testing.T) {
	for _, raw := range []string{"https://example.org/path?q=1#hash", "http://localhost:3000", "https://[::1]:443/a", "HTTPS://example.org", "mailto:person@example.org?subject=Hello%20there", "sip:person@example.org", "sip:12345678", "sip:example.org", "tel:+493012345678", "tel:+49 (30) 1234_5678", "tel:112"} {
		if _, err := validatedExternalURL(raw); err != nil {
			t.Errorf("rejected %q: %v", raw, err)
		}
	}
	for _, raw := range []string{"", "javascript:alert(1)", "file:///C:/secret", "cmd:calc", "//example.org", "https:", "https:///path", "https://user:pass@example.org", "https://example.org\r\ncalc", "https://example.org/a b", `https://example.org\bad`, "https://example.org:bad", "https://example.org/%zz", "mailto:", "mailto://person@example.org", "mailto:person@example.org?subject=x%0d%0aBcc:evil@example.org", "sip:person@example.org?command=evil", "tel:abc", "tel:+1234567890123456", "tel:123?command=evil", "tel:%0acalc", "tel:()", "data:text/plain,evil"} {
		if _, err := validatedExternalURL(raw); err == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	if err := (&App{}).OpenExternalURL("https://example.org"); err == nil {
		t.Fatal("missing native context not reported")
	}
	if target, err := validatedExternalURL("tel:+49 (30) 1234_5678"); err != nil || target != "tel:+493012345678" {
		t.Fatal(target, err)
	}
}

func TestEncodedRawEmailDestinations(t *testing.T) {
	for _, raw := range []string{
		"mailto:AZaz09.%21%23%24%25%26%27%2A%2B-%2F%3D%3F%5E_%60%7B%7C%7D~@Example.123",
		"mailto:%22space%20%23%20%3F%20%25%20%2F%20%3A%20%3C%3E%20%28text%29%22@example.org",
	} {
		if target, err := validatedExternalURL(raw); err != nil || target != raw {
			t.Errorf("%q: got %q, %v", raw, target, err)
		}
	}
	for _, raw := range []string{"mailto:a%00b@example.org", "mailto:%22a%0Ab%22@example.org", "mailto:a%7Fb@example.org", "mailto:a\tb@example.org"} {
		if _, err := validatedExternalURL(raw); err == nil {
			t.Errorf("accepted control characters in %q", raw)
		}
	}
}

func TestGetPathKindUsesFilesystemNotExtension(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "no-extension")
	if err := os.WriteFile(file, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	folder := filepath.Join(dir, "folder.txt")
	if err := os.Mkdir(folder, 0700); err != nil {
		t.Fatal(err)
	}
	a := &App{}
	for path, want := range map[string]string{file: "file", folder: "directory"} {
		if got, err := a.GetPathKind(path); err != nil || got != want {
			t.Fatalf("%q: got %q, %v; want %q", path, got, err, want)
		}
	}
	for _, path := range []string{filepath.Join(dir, "missing"), "relative", `C:\file.txt:stream`, `\\?\C:\file.txt`} {
		if _, err := a.GetPathKind(path); err == nil {
			t.Errorf("accepted %q", path)
		}
	}
}

func TestExplorerPathCommandDoesNotExecuteFiles(t *testing.T) {
	path := `C:\Meine Ablage\file & %.cmd`
	cmd := explorerPathCommand(path, false)
	if len(cmd.Args) != 2 || cmd.Args[1] != "/select,"+path {
		t.Fatal(cmd.Args)
	}
	cmd = explorerPathCommand(filepath.Dir(path), true)
	if len(cmd.Args) != 2 || cmd.Args[1] != filepath.Dir(path) {
		t.Fatal(cmd.Args)
	}
}

func TestTaskMenuSeparators(t *testing.T) {
	items := []TaskMenuItem{{ID: "task", Label: "Task"}, {Separator: true}, {ID: "detail:separator", Separator: true}, {ID: "editor", Label: "Editor"}}
	if err := validateTaskMenuItems(items); err != nil {
		t.Fatal(err)
	}
	for _, item := range []TaskMenuItem{{Separator: true, ID: "\x00"}, {Separator: true, ID: " "}, {Separator: true, Label: "x"}, {Separator: true, Shortcut: "x"}, {Separator: true, Disabled: true}} {
		if validateTaskMenuItems([]TaskMenuItem{item}) == nil {
			t.Fatal("separator action fields accepted", item)
		}
	}
}
