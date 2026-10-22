//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCopyFilePreservesExecutableContent(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.exe")
	target := filepath.Join(dir, "nested", "target.exe")
	want := []byte("DoDrag test payload")
	if err := os.WriteFile(source, want, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(source, target); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("copied content = %q, want %q", got, want)
	}
}

func TestFilesIdenticalComparesContent(t *testing.T) {
	dir := t.TempDir()
	left := filepath.Join(dir, "left.exe")
	right := filepath.Join(dir, "right.exe")
	if err := os.WriteFile(left, []byte("abcd"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(right, []byte("abcd"), 0600); err != nil {
		t.Fatal(err)
	}
	if !filesIdentical(left, right) {
		t.Fatal("identical content not detected")
	}
	// Same size, different content must not count as installed.
	if err := os.WriteFile(right, []byte("abce"), 0600); err != nil {
		t.Fatal(err)
	}
	if filesIdentical(left, right) {
		t.Fatal("different content reported as identical")
	}
}

func TestCreateShortcutWritesShellLink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "DoDrag.exe")
	if err := os.WriteFile(target, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(dir, "DoDrag.lnk")
	if err := createShortcut(linkPath, target, "en"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(linkPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() == 0 {
		t.Fatal("shortcut is empty")
	}
}
