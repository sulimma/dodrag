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
	for _, raw := range []string{"https://example.org/path?q=1#hash", "http://localhost:3000", "https://[::1]:443/a", "HTTPS://example.org"} {
		if _, err := validatedExternalURL(raw); err != nil {
			t.Errorf("rejected %q: %v", raw, err)
		}
	}
	for _, raw := range []string{"", "javascript:alert(1)", "file:///C:/secret", "cmd:calc", "//example.org", "https:", "https:///path", "https://user:pass@example.org", "https://example.org\r\ncalc", "https://example.org/a b", `https://example.org\bad`, "https://example.org:bad", "https://example.org/%zz"} {
		if _, err := validatedExternalURL(raw); err == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	if err := (&App{}).OpenExternalURL("https://example.org"); err == nil {
		t.Fatal("missing native context not reported")
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
