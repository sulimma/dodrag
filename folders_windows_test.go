//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFolderToOpenUsesContainingDirectoryForDatabaseFiles(t *testing.T) {
	dir := t.TempDir()
	database := filepath.Join(dir, "tasks.db")
	if err := os.WriteFile(database, []byte("db"), 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := folderToOpen(database, true, "en"); err != nil || got != dir {
		t.Fatalf("database folder = %q, %v; want %q", got, err, dir)
	}
	if got, err := folderToOpen(dir, false, "en"); err != nil || got != dir {
		t.Fatalf("folder = %q, %v; want %q", got, err, dir)
	}
	// A missing database file must still open its existing folder.
	if got, err := folderToOpen(filepath.Join(dir, "missing.db"), true, "en"); err != nil || got != dir {
		t.Fatalf("missing database folder = %q, %v; want %q", got, err, dir)
	}
	// A missing parent folder is an error.
	if _, err := folderToOpen(filepath.Join(dir, "missing", "tasks.db"), true, "en"); err == nil {
		t.Fatal("accepted missing folder")
	}
}

func TestVSCodeCommandOpensNewWindowWithoutHidingTheEditor(t *testing.T) {
	folder := `C:\data\tasks`
	cmd := vscodeCommand(`C:\Program Files\Microsoft VS Code\Code.exe`, folder)
	want := []string{`C:\Program Files\Microsoft VS Code\Code.exe`, "--new-window", folder}
	if len(cmd.Args) != len(want) {
		t.Fatalf("args = %q, want %q", cmd.Args, want)
	}
	for i := range want {
		if cmd.Args[i] != want[i] {
			t.Fatalf("args = %q, want %q", cmd.Args, want)
		}
	}
	if cmd.SysProcAttr != nil && cmd.SysProcAttr.HideWindow {
		t.Fatal("GUI editor must not be started hidden")
	}
}
