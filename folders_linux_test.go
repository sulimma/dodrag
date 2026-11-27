package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestLinuxLocalFileAdapters(t *testing.T) {
	dir := t.TempDir()
	bin := t.TempDir()
	t.Setenv("PATH", bin)
	// Log the actual argv without launching either desktop program.
	for _, cmd := range []string{"xdg-open", "code"} {
		if err := os.WriteFile(filepath.Join(bin, cmd), []byte(`#!/bin/sh
printf '%s\n' "${0##*/}" "$@" > "$PATH_LOG.tmp"
/bin/mv "$PATH_LOG.tmp" "$PATH_LOG"
`), 0700); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(dir, "task ; $(false) & %.md")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(dir, "missing.db")
	a := &App{}
	for _, tc := range []struct {
		name string
		open func() error
		want []string
	}{
		{"reveal-file", func() error { return a.OpenPathInExplorer(file) }, []string{"xdg-open", dir}},
		{"open-folder", func() error { return a.OpenPathInExplorer(dir) }, []string{"xdg-open", dir}},
		{"reveal-missing-db", func() error { return a.OpenFolderInExplorer(missing, true) }, []string{"xdg-open", dir}},
		{"edit-file", func() error { return a.OpenPathInVSCode(file) }, []string{"code", "--new-window", file}},
		{"edit-container", func() error { return a.OpenFolderInVSCode(missing, true) }, []string{"code", "--new-window", dir}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logFile := filepath.Join(t.TempDir(), "args")
			t.Setenv("PATH_LOG", logFile)
			if err := tc.open(); err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(3 * time.Second)
			for {
				data, err := os.ReadFile(logFile)
				if err == nil {
					if got := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n"); !reflect.DeepEqual(got, tc.want) {
						t.Fatalf("argv = %q, want %q", got, tc.want)
					}
					return
				}
				if !os.IsNotExist(err) || time.Now().After(deadline) {
					t.Fatal(err)
				}
				time.Sleep(10 * time.Millisecond)
			}
		})
	}
	if err := a.OpenPathInExplorer(missing); err == nil {
		t.Fatal("revealed missing file")
	}
	if err := a.OpenFolderInVSCode(file, false); err == nil {
		t.Fatal("opened file as a folder")
	}
}
