package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsAbsoluteLocalPath(t *testing.T) {
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

func TestSlashPathResolvesOnCurrentVolume(t *testing.T) {
	dir := t.TempDir()
	old, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(old) })
	file := filepath.Join(dir, "Plan.txt")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	rooted := filepath.ToSlash(file[len(filepath.VolumeName(file)):])
	got, _, err := existingPath(rooted, "en")
	if err != nil || !sameFilePath(got, file) {
		t.Fatalf("%q => %q: %v", rooted, got, err)
	}
	if _, _, err := existingPath(rooted+".missing", "en"); err == nil {
		t.Fatal("opened missing file")
	}
}
