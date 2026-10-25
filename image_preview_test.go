package main

import (
	"bytes"
	"dodrag/internal/eventstore"
	"encoding/base64"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"golang.org/x/image/bmp"
)

func previewTestApp(t *testing.T) *App {
	t.Helper()
	a := testApp(t)
	a.previewCacheDir = filepath.Join(t.TempDir(), "previews")
	store, err := eventstore.NewStoreWithOptions(filepath.Join(t.TempDir(), "preview.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	a.store = store
	t.Cleanup(func() { store.Close() })
	if _, err := a.AppendEvent("create", "TASK_CREATED", `{"taskId":"task-1","title":"Preview","configuredStart":"2026-10-25T00:00:00Z","createdAt":"2026-10-25T12:00:00Z"}`); err != nil {
		t.Fatal(err)
	}
	return a
}

func requestPreview(a *App, method, taskID, path string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/dodrag-media?"+url.Values{"taskId": {taskID}, "path": {path}}.Encode(), nil)
	w := httptest.NewRecorder()
	a.previewAssetMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(418) })).ServeHTTP(w, r)
	return w
}

func writePreviewImage(t *testing.T, ext string, width, height int) (string, []byte) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	var data bytes.Buffer
	var err error
	switch ext {
	case ".png":
		err = png.Encode(&data, img)
	case ".gif":
		err = gif.Encode(&data, img, nil)
	case ".bmp":
		err = bmp.Encode(&data, img)
	default:
		err = jpeg.Encode(&data, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "image"+ext)
	if err := os.WriteFile(path, data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	return path, data.Bytes()
}

func TestPreviewDirectImagesAndSVG(t *testing.T) {
	a := previewTestApp(t)
	for _, ext := range []string{".jpg", ".jpeg", ".png", ".gif", ".bmp"} {
		path, data := writePreviewImage(t, ext, 8, 4)
		got := requestPreview(a, "GET", "task-1", path)
		if got.Code != 200 || !bytes.Equal(got.Body.Bytes(), data) || got.Header().Get("X-Content-Type-Options") != "nosniff" || got.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: %d %s", ext, got.Code, got.Body.String())
		}
		head := requestPreview(a, "HEAD", "task-1", path)
		if head.Code != 200 || head.Body.Len() != 0 {
			t.Fatal("HEAD", head.Code, head.Body.Len())
		}
	}
	svg := `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>`
	path := filepath.Join(t.TempDir(), "test.svg")
	if err := os.WriteFile(path, []byte(svg), 0600); err != nil {
		t.Fatal(err)
	}
	got := requestPreview(a, "GET", "task-1", path)
	if got.Code != 200 || got.Body.String() != svg || got.Header().Get("Content-Type") != "image/svg+xml" || !strings.Contains(got.Header().Get("Content-Security-Policy"), "default-src 'none'") || !strings.Contains(got.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("SVG protection", got.Code, got.Header())
	}
}

func TestPreviewWebPDecoder(t *testing.T) {
	a := previewTestApp(t)
	// One-pixel lossy WebP fixture; no encoder or external testdata dependency.
	data, err := base64.StdEncoding.DecodeString("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "pixel.webp")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	got := requestPreview(a, "GET", "task-1", path)
	if got.Code != 200 || got.Header().Get("Content-Type") != "image/webp" || !bytes.Equal(got.Body.Bytes(), data) {
		t.Fatal(got.Code, got.Body.String())
	}
}

func TestPreviewThumbnailAtomicCacheAndInvalidation(t *testing.T) {
	a := previewTestApp(t)
	for _, ext := range []string{".png", ".jpg"} {
		path, _ := writePreviewImage(t, ext, 1600, 800)
		got := requestPreview(a, "GET", "task-1", path)
		config, format, err := image.DecodeConfig(got.Body)
		if got.Code != 200 || err != nil || format != "jpeg" || config.Width != 1280 || config.Height != 640 {
			t.Fatal("thumbnail", got.Code, config, format, err)
		}
		files, err := os.ReadDir(previewTaskDirectory(a.previewCacheDir, "task-1"))
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range files {
			if !strings.HasSuffix(f.Name(), ".jpg") {
				t.Fatal("temporary file leaked", f.Name())
			}
		}
		before := len(files)
		if again := requestPreview(a, "GET", "task-1", path); again.Code != 200 {
			t.Fatal(again.Code)
		}
		files, _ = os.ReadDir(previewTaskDirectory(a.previewCacheDir, "task-1"))
		if len(files) != before {
			t.Fatal("cache not reused")
		}
		info, _ := os.Stat(path)
		if err := os.Chtimes(path, info.ModTime().Add(-1000000000), info.ModTime().Add(-1000000000)); err != nil {
			t.Fatal(err)
		}
		if again := requestPreview(a, "GET", "task-1", path); again.Code != 200 {
			t.Fatal(again.Code)
		}
		files, _ = os.ReadDir(previewTaskDirectory(a.previewCacheDir, "task-1"))
		if len(files) != before+1 {
			t.Fatal("mtime did not invalidate cache")
		}
	}
}

func TestPreviewRejectsUnsafeRequestsAndBounds(t *testing.T) {
	a := previewTestApp(t)
	path, data := writePreviewImage(t, ".png", 4, 4)
	for _, tc := range []struct {
		method, task, path string
		status             int
	}{
		{"POST", "task-1", path, 405}, {"GET", "../escape", path, 400},
		{"GET", "CON", path, 404}, {"GET", "missing", path, 404},
		{"GET", "task-1", "relative.png", 400}, {"GET", "task-1", `C:relative.png`, 400},
		{"GET", "task-1", `\\?\C:\file.png`, 400}, {"GET", "task-1", path + ":stream", 400},
		{"GET", "task-1", filepath.Join(t.TempDir(), "image.webp"), 404},
		{"GET", "task-1", filepath.Join(t.TempDir(), "image.bmp"), 404},
		{"GET", "task-1", filepath.Join(t.TempDir(), "secret.txt"), 415},
		{"GET", "task-1", filepath.Join(t.TempDir(), "missing.png"), 404},
	} {
		if got := requestPreview(a, tc.method, tc.task, tc.path); got.Code != tc.status {
			t.Errorf("%+v: %d", tc, got.Code)
		}
	}
	for name, contents := range map[string][]byte{"html.svg": []byte(`<html><script/></html>`), "doctype.svg": []byte(`<!DOCTYPE svg><svg/>`), "invalid.png": []byte("not an image"), "wrong.jpg": data} {
		file := filepath.Join(t.TempDir(), name)
		if err := os.WriteFile(file, contents, 0600); err != nil {
			t.Fatal(err)
		}
		if got := requestPreview(a, "GET", "task-1", file); got.Code != 415 {
			t.Fatal(name, got.Code)
		}
	}
	for _, dimensions := range [][2]int{{0, 1}, {1, 0}, {-1, 10}, {32769, 1}, {10000, 10000}, {1, 32769}} {
		if boundedPreviewDimensions(dimensions[0], dimensions[1]) {
			t.Fatal("unbounded dimensions", dimensions)
		}
	}
	if !boundedPreviewDimensions(4096, 4096) {
		t.Fatal("valid pixel limit rejected")
	}
	for _, raw := range []string{"<svg/ ><svg/>", "<svg>", "<svg/>extra", strings.Repeat("<svg>", 129) + strings.Repeat("</svg>", 129)} {
		if validatePreviewSVG(strings.NewReader(raw)) == nil {
			t.Fatal("invalid SVG accepted", raw)
		}
	}
	oversized := filepath.Join(t.TempDir(), "large.png")
	f, err := os.Create(oversized)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(previewMaxBytes + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if got := requestPreview(a, "GET", "task-1", oversized); got.Code != 413 {
		t.Fatal("file size bound", got.Code)
	}
}

func TestPreviewCompletionAppendBatchRedoAndFailedCommit(t *testing.T) {
	for _, mode := range []string{"append", "batch", "redo"} {
		t.Run(mode, func(t *testing.T) {
			a := previewTestApp(t)
			path, _ := writePreviewImage(t, ".png", 1600, 800)
			if got := requestPreview(a, "GET", "task-1", path); got.Code != 200 {
				t.Fatal(got.Code)
			}
			dir := previewTaskDirectory(a.previewCacheDir, "task-1")
			if _, err := a.AppendEvent("bad", "TASK_COMPLETED", `{"taskId":"task-1","completedAt":"bad"}`); err == nil {
				t.Fatal("invalid commit accepted")
			}
			if _, err := os.Stat(dir); err != nil {
				t.Fatal("failed commit cleared cache", err)
			}
			payload := `{"taskId":"task-1","completedAt":"2026-10-25T12:00:00Z"}`
			var err error
			if mode == "batch" {
				_, err = a.AppendBatch([]eventstore.Command{{ID: "complete", Type: "TASK_COMPLETED", Payload: []byte(payload)}})
			} else {
				_, err = a.AppendEvent("complete", "TASK_COMPLETED", payload)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(dir); !os.IsNotExist(err) {
				t.Fatal("cache not cleared", err)
			}
			if got := requestPreview(a, "GET", "task-1", path); got.Code != 404 {
				t.Fatal("completed task regenerated cache", got.Code)
			}
			if mode == "redo" {
				if _, err := a.Undo(); err != nil {
					t.Fatal(err)
				}
				if got := requestPreview(a, "GET", "task-1", path); got.Code != 200 {
					t.Fatal("undo", got.Code)
				}
				if _, err := a.Redo(); err != nil {
					t.Fatal(err)
				}
				if _, err := os.Stat(dir); !os.IsNotExist(err) {
					t.Fatal("redo did not clean", err)
				}
			}
		})
	}
}

func TestPreviewClearSettingsConcurrencyAndErrors(t *testing.T) {
	a := previewTestApp(t)
	settings, err := a.GetSettings()
	if err != nil || settings.PreviewCacheDir != a.previewCacheDir {
		t.Fatal(settings.PreviewCacheDir, err)
	}
	path, _ := writePreviewImage(t, ".png", 1600, 800)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if got := requestPreview(a, "GET", "task-1", path); got.Code != 200 {
				t.Error(got.Code)
			}
		}()
	}
	wg.Wait()
	if err := a.ClearPreviewCache(); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(a.previewCacheDir)
	if err != nil || len(entries) != 0 {
		t.Fatal("cache not empty", entries, err)
	}
	blocker := filepath.Join(t.TempDir(), "blocker")
	if err := os.WriteFile(blocker, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	a.previewCacheDir = blocker
	if err := a.ClearPreviewCache(); err == nil {
		t.Fatal("ignored invalid cache directory")
	}
	if got := requestPreview(a, "GET", "task-1", path); got.Code != 500 {
		t.Fatal("ignored thumbnail write failure", got.Code)
	}
	events, err := a.AppendEvent("complete", "TASK_COMPLETED", `{"taskId":"task-1","completedAt":"2026-10-25T12:00:00Z"}`)
	if err != nil || len(events) != 2 || events[1].Type != "TASK_COMPLETED" || a.previewCacheError == "" {
		t.Fatal("commit/cleanup failure semantics", events, err)
	}
	data, _ := os.ReadFile(blocker)
	if string(data) != "keep" {
		t.Fatal("invalid cache root deleted")
	}
	w := httptest.NewRecorder()
	a.previewAssetMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "next") })).ServeHTTP(w, httptest.NewRequest("GET", "/other", nil))
	if w.Body.String() != "next" {
		t.Fatal("middleware did not delegate")
	}
}

func TestPreviewBatchMultipleTasksAndReopenedFinalState(t *testing.T) {
	a := previewTestApp(t)
	if _, err := a.AppendEvent("create2", "TASK_CREATED", `{"taskId":"task-2","title":"Second","configuredStart":"2026-10-25T00:00:00Z","createdAt":"2026-10-25T12:00:00Z"}`); err != nil {
		t.Fatal(err)
	}
	path, _ := writePreviewImage(t, ".png", 1600, 800)
	for _, id := range []string{"task-1", "task-2"} {
		if got := requestPreview(a, "GET", id, path); got.Code != 200 {
			t.Fatal(id, got.Code)
		}
	}
	commands := []eventstore.Command{
		{ID: "c1", Type: "TASK_COMPLETED", Payload: []byte(`{"taskId":"task-1","completedAt":"2026-10-25T12:00:00Z"}`)},
		{ID: "c2", Type: "TASK_COMPLETED", Payload: []byte(`{"taskId":"task-2","completedAt":"2026-10-25T12:00:00Z"}`)},
	}
	if _, err := a.AppendBatch(commands); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"task-1", "task-2"} {
		if _, err := os.Stat(previewTaskDirectory(a.previewCacheDir, id)); !os.IsNotExist(err) {
			t.Fatal(id, "not cleared", err)
		}
	}
	if _, err := a.Undo(); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"task-1", "task-2"} {
		if got := requestPreview(a, "GET", id, path); got.Code != 200 {
			t.Fatal(id, "batch undo", got.Code)
		}
	}
	if _, err := a.Redo(); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"task-1", "task-2"} {
		if _, err := os.Stat(previewTaskDirectory(a.previewCacheDir, id)); !os.IsNotExist(err) {
			t.Fatal(id, "batch redo not cleared", err)
		}
	}
	if _, err := a.AppendEvent("reopen", "TASK_REOPENED", `{"taskId":"task-1"}`); err != nil {
		t.Fatal(err)
	}
	if got := requestPreview(a, "GET", "task-1", path); got.Code != 200 {
		t.Fatal("reopen", got.Code)
	}
	if _, err := a.AppendEvent("rename", "TASK_RENAMED", `{"taskId":"task-1","title":"Renamed"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(previewTaskDirectory(a.previewCacheDir, "task-1")); err != nil {
		t.Fatal("historic completion cleared reopened cache", err)
	}
	if err := a.clearTaskPreviewCache("task-1"); err != nil {
		t.Fatal(err)
	}
	if err := a.clearTaskPreviewCache("../escape"); err == nil {
		t.Fatal("unsafe cleanup task accepted")
	}
}

func TestPreviewLargeFileThresholdAndHeaderPixelLimit(t *testing.T) {
	a := previewTestApp(t)
	path, data := writePreviewImage(t, ".png", 16, 8)
	data = append(data, make([]byte, previewSmallBytes)...)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	got := requestPreview(a, "GET", "task-1", path)
	config, format, err := image.DecodeConfig(got.Body)
	if got.Code != 200 || err != nil || format != "jpeg" || config.Width != 16 || config.Height != 8 {
		t.Fatal("byte threshold", got.Code, config, format, err)
	}
	path, data = writePreviewImage(t, ".gif", 1, 1)
	// GIF logical-screen dimensions are visible before any pixel allocation.
	data[6], data[7], data[8], data[9] = 255, 255, 255, 255
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if got := requestPreview(a, "GET", "task-1", path); got.Code != 415 {
		t.Fatal("header pixel bound", got.Code)
	}
}

func TestPreviewConcurrentCompletionDoesNotRecreateCache(t *testing.T) {
	a := previewTestApp(t)
	path, _ := writePreviewImage(t, ".png", 1600, 800)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got := requestPreview(a, "GET", "task-1", path)
			if got.Code != 200 && got.Code != 404 {
				t.Error(got.Code)
			}
		}()
	}
	if _, err := a.AppendEvent("complete", "TASK_COMPLETED", `{"taskId":"task-1","completedAt":"2026-10-25T12:00:00Z"}`); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	if _, err := os.Stat(previewTaskDirectory(a.previewCacheDir, "task-1")); !os.IsNotExist(err) {
		t.Fatal("completion race recreated cache", err)
	}
}
