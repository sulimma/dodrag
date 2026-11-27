package main

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestPreviewLinuxPathCharacters(t *testing.T) {
	a := previewTestApp(t)
	original, data := writePreviewImage(t, ".png", 4, 4)
	path := filepath.Join(filepath.Dir(original), `Preview: # ?%20 \"&.png`)
	if err := os.Rename(original, path); err != nil {
		t.Fatal(err)
	}
	if got := requestPreview(a, http.MethodGet, "task-1", path); got.Code != http.StatusOK || !bytes.Equal(got.Body.Bytes(), data) {
		t.Fatalf("Linux preview: status %d, body %q", got.Code, got.Body.String())
	}
}

func TestPreviewRejectsLinuxFIFO(t *testing.T) {
	a := previewTestApp(t)
	path := filepath.Join(t.TempDir(), "pipe.png")
	if err := syscall.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	if got := requestPreview(a, http.MethodGet, "task-1", path); got.Code < 400 {
		t.Fatalf("preview accepted a FIFO: status %d", got.Code)
	}
}
