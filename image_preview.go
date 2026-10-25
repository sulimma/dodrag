package main

import (
	"bytes"
	"crypto/sha256"
	"dodrag/internal/eventstore"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	_ "golang.org/x/image/bmp"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	previewMaxSide      = 1280
	previewSmallBytes   = 512 * 1024
	previewMaxBytes     = 64 * 1024 * 1024
	previewMaxPixels    = 16 * 1024 * 1024
	previewMaxDimension = 32768
	previewMaxSVGBytes  = 4 * 1024 * 1024
)

var previewTaskID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

func validPreviewTaskID(id string) bool {
	return previewTaskID.MatchString(id) && id != "constructor" && id != "__proto__" && id != "prototype" && id != "toString"
}

// Called with mu held, or before the App is shared. This is not a persisted setting.
func (a *App) previewCacheDirectory() string {
	if a.previewCacheDir != "" {
		return a.previewCacheDir
	}
	return filepath.Join(os.TempDir(), "DoDrag", "previews")
}

func previewTaskDirectory(cacheDir, taskID string) string {
	// Hash the complete ID: no traversal, reserved device names or case-fold collisions.
	return filepath.Join(cacheDir, fmt.Sprintf("%x", sha256.Sum256([]byte(taskID))))
}

// Refuse symlinks/junctions before writing or deleting inside the shared temp tree.
func ensurePreviewDirectory(path string) error {
	if !filepath.IsAbs(path) {
		return errors.New("absolute cache directory required")
	}
	for p := filepath.Clean(path); ; p = filepath.Dir(p) {
		info, err := os.Lstat(p)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
			return errors.New("cache directory must not contain symlinks or files")
		}
		if filepath.Dir(p) == p {
			break
		}
	}
	return os.MkdirAll(path, 0700)
}

func completedPreviewTasks(events []eventstore.Event) map[string]bool {
	completed := make(map[string]bool)
	for _, event := range events {
		if event.Undone {
			continue
		}
		var payload struct {
			TaskID string `json:"taskId"`
		}
		if json.Unmarshal(event.Payload, &payload) != nil || !validPreviewTaskID(payload.TaskID) {
			continue
		}
		switch event.Type {
		case "TASK_CREATED", "TASK_REOPENED":
			completed[payload.TaskID] = false
		case "TASK_COMPLETED":
			completed[payload.TaskID] = true
		}
	}
	return completed
}

// A cache failure must not turn a committed Wails command into a rejected Promise.
// Expose the warning through settings and notify separately after releasing locks.
func (a *App) cleanupCompletedPreviewsLocked(events []eventstore.Event, candidateEventIDs map[string]bool) {
	if len(candidateEventIDs) == 0 {
		return
	}
	completed := completedPreviewTasks(events)
	taskIDs := make(map[string]bool)
	for _, event := range events {
		if !event.Undone && event.Type == "TASK_COMPLETED" && candidateEventIDs[event.ID] {
			var payload struct {
				TaskID string `json:"taskId"`
			}
			if json.Unmarshal(event.Payload, &payload) == nil && completed[payload.TaskID] {
				taskIDs[payload.TaskID] = true
			}
		}
	}
	if len(taskIDs) == 0 {
		return
	}
	a.previewMu.Lock()
	defer a.previewMu.Unlock()
	var result error
	for id := range taskIDs {
		result = errors.Join(result, a.removeTaskPreviewCache(a.previewCacheDirectory(), id))
	}
	a.previewCacheError = ""
	if result != nil {
		err := a.errorLocked("Aenderung gespeichert, Vorschau-Cache konnte nicht bereinigt werden", result)
		a.previewCacheError = err.Error()
		if ctx := a.ctx; ctx != nil {
			message := err.Error()
			go func() {
				runtime.LogWarning(ctx, message)
				runtime.EventsEmit(ctx, "preview:cache-warning", message)
			}()
		}
	}
}

func (a *App) removeTaskPreviewCache(cacheDir, taskID string) error {
	if !validPreviewTaskID(taskID) {
		return errors.New("invalid task ID")
	}
	if _, err := os.Lstat(cacheDir); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err := ensurePreviewDirectory(cacheDir); err != nil {
		return err
	}
	return os.RemoveAll(previewTaskDirectory(cacheDir, taskID))
}

func (a *App) clearTaskPreviewCache(taskID string) error {
	a.mu.Lock()
	cacheDir, language := a.previewCacheDirectory(), a.settings.UILanguage
	a.previewMu.Lock()
	a.mu.Unlock()
	defer a.previewMu.Unlock()
	return localizedError(language, "Vorschau-Cache konnte nicht bereinigt werden", a.removeTaskPreviewCache(cacheDir, taskID))
}

func (a *App) ClearPreviewCache() error {
	a.mu.Lock()
	cacheDir, language := a.previewCacheDirectory(), a.settings.UILanguage
	a.previewMu.Lock()
	a.mu.Unlock()
	defer a.previewMu.Unlock()
	if err := ensurePreviewDirectory(cacheDir); err != nil {
		return localizedError(language, "Vorschau-Cache konnte nicht bereinigt werden", err)
	}
	entries, err := os.ReadDir(cacheDir)
	if err == nil {
		for _, entry := range entries {
			err = errors.Join(err, os.RemoveAll(filepath.Join(cacheDir, entry.Name())))
		}
	}
	return localizedError(language, "Vorschau-Cache konnte nicht bereinigt werden", err)
}

func (a *App) OpenPreviewCacheInExplorer() error {
	a.mu.Lock()
	cacheDir, language := a.previewCacheDirectory(), a.settings.UILanguage
	a.previewMu.Lock()
	a.mu.Unlock()
	err := ensurePreviewDirectory(cacheDir)
	a.previewMu.Unlock()
	if err != nil {
		return localizedError(language, "Vorschau-Cache konnte nicht geoeffnet werden", err)
	}
	return a.OpenFolderInExplorer(cacheDir, false)
}

func (a *App) previewAssetMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/dodrag-media" {
			next.ServeHTTP(w, r)
			return
		}
		a.serveImagePreview(w, r)
	})
}

func (a *App) serveImagePreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	a.mu.Lock()
	language := a.settings.UILanguage
	a.mu.Unlock()
	fail := func(status int) {
		http.Error(w, backendText(language, "Bildvorschau konnte nicht geladen werden"), status)
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		fail(http.StatusMethodNotAllowed)
		return
	}
	query := r.URL.Query()
	if len(query["taskId"]) != 1 || len(query["path"]) != 1 || !validPreviewTaskID(query.Get("taskId")) {
		fail(http.StatusBadRequest)
		return
	}
	path, err := absoluteLocalPath(query.Get("path"))
	if err != nil {
		fail(http.StatusBadRequest)
		return
	}
	ext := strings.ToLower(filepath.Ext(path))
	mimeTypes := map[string]string{".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml"}
	mimeType, allowed := mimeTypes[ext]
	if !allowed {
		fail(http.StatusUnsupportedMediaType)
		return
	}
	// Serialize task-state inspection with completion and cache publication.
	// Release mu before decoding/serving; never acquire mu under previewMu.
	a.mu.Lock()
	if a.store == nil {
		a.mu.Unlock()
		fail(http.StatusNotFound)
		return
	}
	// Known scaling ceiling: task authorization replays O(history) per request.
	// Keep correctness across database switches/Undo without a second state cache.
	events, err := a.store.GetEvents()
	completed, known := completedPreviewTasks(events)[query.Get("taskId")]
	if err != nil || !known || completed {
		a.mu.Unlock()
		fail(http.StatusNotFound)
		return
	}
	cacheDir := a.previewCacheDirectory()
	a.previewMu.Lock()
	a.mu.Unlock()
	defer a.previewMu.Unlock()
	f, err := os.Open(path)
	if err != nil {
		fail(http.StatusNotFound)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > previewMaxBytes {
		fail(http.StatusRequestEntityTooLarge)
		return
	}
	limit := int64(previewMaxBytes)
	if ext == ".svg" {
		limit = previewMaxSVGBytes
	}
	// DecodeConfig and Decode must see exactly the same bounded bytes: a file
	// modified between the two reads could otherwise bypass the pixel limit.
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || len(data) == 0 || int64(len(data)) > limit {
		fail(http.StatusRequestEntityTooLarge)
		return
	}
	if ext == ".svg" {
		if validatePreviewSVG(bytes.NewReader(data)) != nil {
			fail(http.StatusUnsupportedMediaType)
			return
		}
	} else {
		config, format, err := image.DecodeConfig(bytes.NewReader(data))
		expected := strings.TrimPrefix(mimeType, "image/")
		if err != nil || format != expected || !boundedPreviewDimensions(config.Width, config.Height) {
			fail(http.StatusUnsupportedMediaType)
			return
		}
		if info.Size() > previewSmallBytes || config.Width > previewMaxSide || config.Height > previewMaxSide {
			thumbnail, err := cachedThumbnail(data, info, path, previewTaskDirectory(cacheDir, query.Get("taskId")), config)
			if err != nil {
				fail(http.StatusInternalServerError)
				return
			}
			defer thumbnail.Close()
			w.Header().Set("Content-Type", "image/jpeg")
			http.ServeContent(w, r, "preview.jpg", time.Time{}, thumbnail)
			return
		}
	}
	w.Header().Set("Content-Type", mimeType)
	http.ServeContent(w, r, filepath.Base(path), time.Time{}, bytes.NewReader(data))
}

func boundedPreviewDimensions(w, h int) bool {
	return w > 0 && h > 0 && w <= previewMaxDimension && h <= previewMaxDimension && int64(w)*int64(h) <= previewMaxPixels
}

func validatePreviewSVG(reader io.Reader) error {
	decoder := xml.NewDecoder(reader)
	depth, roots := 0, 0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			if depth == 0 && roots == 1 {
				return nil
			}
			return errors.New("SVG root required")
		}
		if err != nil {
			return err
		}
		switch node := token.(type) {
		case xml.Directive:
			return errors.New("SVG directives are not supported")
		case xml.StartElement:
			if depth == 0 {
				roots++
				if roots != 1 || node.Name.Local != "svg" || (node.Name.Space != "" && node.Name.Space != "http://www.w3.org/2000/svg") {
					return errors.New("SVG root required")
				}
			}
			depth++
			if depth > 128 {
				return errors.New("SVG nesting limit exceeded")
			}
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(node)) != "" {
				return errors.New("unexpected SVG text")
			}
		}
	}
}

func cachedThumbnail(data []byte, info os.FileInfo, path, taskDir string, config image.Config) (*os.File, error) {
	if err := ensurePreviewDirectory(taskDir); err != nil {
		return nil, err
	}
	name := filepath.Join(taskDir, fmt.Sprintf("%x.jpg", sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d", path, info.ModTime().UnixNano(), info.Size())))))
	if cachedInfo, err := os.Lstat(name); err == nil {
		if !cachedInfo.Mode().IsRegular() || cachedInfo.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("invalid cached thumbnail")
		}
		return os.Open(name)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if img.Bounds().Dx() != config.Width || img.Bounds().Dy() != config.Height {
		return nil, errors.New("image dimensions changed")
	}
	w, h := config.Width, config.Height
	if w > previewMaxSide || h > previewMaxSide {
		if w >= h {
			h = max(1, h*previewMaxSide/w)
			w = previewMaxSide
		} else {
			w = max(1, w*previewMaxSide/h)
			h = previewMaxSide
		}
	}
	thumbnail := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(thumbnail, thumbnail.Bounds(), &image.Uniform{color.White}, image.Point{}, draw.Src)
	xdraw.ApproxBiLinear.Scale(thumbnail, thumbnail.Bounds(), img, img.Bounds(), draw.Over, nil)
	temp, err := os.CreateTemp(taskDir, ".thumbnail-*.tmp")
	if err != nil {
		return nil, err
	}
	defer os.Remove(temp.Name())
	err = jpeg.Encode(temp, thumbnail, &jpeg.Options{Quality: 82})
	if err == nil {
		err = temp.Sync()
	}
	err = errors.Join(err, temp.Close())
	if err != nil {
		return nil, err
	}
	if err := os.Rename(temp.Name(), name); err != nil {
		return nil, err
	}
	return os.Open(name)
}
