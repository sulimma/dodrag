package main

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestLinuxAbsolutePathAndMarkdownImport(t *testing.T) {
	dir := t.TempDir()
	name := `notes: # ?%20 \"&.md`
	path := filepath.Join(dir, name)
	const content = "# Notes\n✅"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	a := &App{}
	if kind, err := a.GetPathKind(path); err != nil || kind != "file" {
		t.Fatalf("path was not treated literally: %q, %v", kind, err)
	}
	if got, err := a.ReadMarkdownFile(path); err != nil || got != content {
		t.Fatalf("import literal path: got %q, %v", got, err)
	}
	for _, invalid := range []string{"relative.md", `C:\notes.md`, `\\host\share\notes.md`, "file://" + path, path + "\x00"} {
		if _, err := absoluteLocalPath(invalid); err == nil {
			t.Errorf("accepted a non-native path %q", invalid)
		}
	}
}

func TestLinuxMarkdownRejectsFIFO(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pipe.md")
	if err := syscall.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := (&App{}).ReadMarkdownFile(path); err == nil {
		t.Fatal("import accepted a FIFO")
	}
}
