package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime/debug"
)

// Diagnostics stay separate from task databases. Rotate at startup, retaining the
// previous file. Never recover arbitrary panics: continuing could corrupt state.
const diagnosticLimit = 2 * 1024 * 1024

func openDiagnosticFile(dir, name string) (*os.File, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, name)
	if info, err := os.Stat(path); err == nil && info.Size() >= diagnosticLimit {
		if err := os.Remove(path + ".previous"); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		if err := os.Rename(path, path+".previous"); err != nil {
			return nil, err
		}
	}
	return os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
}

func startDiagnostics() func() {
	dir, err := os.UserConfigDir()
	if err != nil {
		log.Printf("diagnostics directory: %v", err)
		return func() {}
	}
	dir = filepath.Join(dir, "DoDrag", "logs")
	file, err := openDiagnosticFile(dir, "dodrag.log")
	if err != nil {
		log.Printf("diagnostics: %v", err)
		return func() {}
	}
	previous := log.Writer()
	log.SetOutput(file)
	log.Printf("START version=%s build=%s pid=%d", buildVersion, buildTime, os.Getpid())
	crash, err := openDiagnosticFile(dir, "crash.log")
	if err == nil {
		// Go duplicates the handle: fatal panics on any goroutine are captured even
		// when deferred cleanup cannot run. This does not capture a WebView2 process crash.
		err = debug.SetCrashOutput(crash, debug.CrashOptions{})
		crash.Close()
	}
	if err != nil {
		log.Printf("crash logging unavailable: %v", err)
	}
	return func() {
		log.Print("STOP")
		log.SetOutput(previous)
		file.Close()
	}
}

type diagnosticLogger struct{}

func (diagnosticLogger) Print(s string)   { log.Printf("WAILS %s", s) }
func (diagnosticLogger) Trace(s string)   {}
func (diagnosticLogger) Debug(s string)   {}
func (diagnosticLogger) Info(s string)    { log.Printf("INFO %s", s) }
func (diagnosticLogger) Warning(s string) { log.Printf("WARNING %s", s) }
func (diagnosticLogger) Error(s string)   { log.Printf("ERROR %s", s) }
func (diagnosticLogger) Fatal(s string)   { log.Printf("FATAL %s", s); os.Exit(1) }

// Bound input size; no task payloads are deliberately added to diagnostics.
// Error messages themselves may contain paths or user content.
func (a *App) ReportFrontendError(detail string) {
	if len(detail) > 16384 {
		detail = detail[:16384]
	}
	log.Print(fmt.Sprintf("FRONTEND %q", detail))
}
