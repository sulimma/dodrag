package main

import (
	"net/http"
	"testing"
)

func TestPreviewRejectsUnsafeWindowsPaths(t *testing.T) {
	a := previewTestApp(t)
	path, _ := writePreviewImage(t, ".png", 4, 4)
	for _, unsafe := range []string{path + ":stream", `C:relative.png`, `\\?\C:\file.png`} {
		if got := requestPreview(a, http.MethodGet, "task-1", unsafe); got.Code != http.StatusBadRequest {
			t.Errorf("preview for %q returned status %d", unsafe, got.Code)
		}
	}
}
