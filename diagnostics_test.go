package main

import (
	"bytes"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestDiagnosticRotation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "dodrag.log")
	old := bytes.Repeat([]byte("x"), diagnosticLimit)
	if err := os.WriteFile(path, old, 0600); err != nil {
		t.Fatal(err)
	}
	file, err := openDiagnosticFile(dir, "dodrag.log")
	if err != nil {
		t.Fatal(err)
	}
	file.WriteString("new error")
	file.Close()
	previous, err := os.ReadFile(path + ".previous")
	if err != nil || !bytes.Equal(previous, old) {
		t.Fatal("previous diagnostics lost", err)
	}
	current, err := os.ReadFile(path)
	if err != nil || string(current) != "new error" {
		t.Fatal("new diagnostics missing", err)
	}
}

func TestFrontendDiagnostic(t *testing.T) {
	var buf bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(previous)
	(&App{}).ReportFrontendError("drop failed\nstack frame")
	if !strings.Contains(buf.String(), "drop failed") || !strings.Contains(buf.String(), "stack frame") {
		t.Fatal(buf.String())
	}
	buf.Reset()
	(&App{}).ReportFrontendError(strings.Repeat("x", 20000))
	if buf.Len() > 16500 {
		t.Fatal("unbounded report")
	}
}

// Crash a test subprocess, never the user's running app. This verifies that a
// panic outside the main goroutine reaches disk without relying on recover.
func TestDiagnosticFatalPanic(t *testing.T) {
	if os.Getenv("DODRAG_TEST_CRASH") == "1" {
		startDiagnostics()
		go func() { panic("diagnostic-test-panic") }()
		select {}
	}
	dir := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestDiagnosticFatalPanic$")
	cmd.Env = append(os.Environ(), "DODRAG_TEST_CRASH=1", "APPDATA="+dir, "XDG_CONFIG_HOME="+dir)
	if err := cmd.Run(); err == nil {
		t.Fatal("expected fatal panic")
	}
	data, err := os.ReadFile(filepath.Join(dir, "DoDrag", "logs", "crash.log"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "diagnostic-test-panic") || !strings.Contains(string(data), "TestDiagnosticFatalPanic") {
		t.Fatal(string(data))
	}
}
