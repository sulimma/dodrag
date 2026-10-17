package main

import (
	"context"
	"dodrag/internal/eventstore"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// DatabaseEntry represents a known SQLite database file on this computer.
type DatabaseEntry struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	IsDemo bool   `json:"isDemo"`
	Exists bool   `json:"exists"`
}

// AppSettings stores known databases, the currently active database, autostart flag, and dock corner in %APPDATA%\DoDrag\settings.json.
type AppSettings struct {
	KnownDatabases     []DatabaseEntry `json:"knownDatabases"`
	ActiveDatabasePath string          `json:"activeDatabasePath"`
	Autostart          bool            `json:"autostart"`
	DockCorner         string          `json:"dockCorner"`
	BootMinimized      bool            `json:"bootMinimized,omitempty"`
	DatabaseReady      bool            `json:"databaseReady,omitempty"`
}

type persistedSettings struct {
	KnownDatabases     []DatabaseEntry `json:"knownDatabases"`
	ActiveDatabasePath string          `json:"activeDatabasePath"`
	Autostart          bool            `json:"autostart"`
	DockCorner         string          `json:"dockCorner"`
}

// App struct binds Go methods to the Wails frontend.
type App struct {
	ctx           context.Context
	mu            sync.Mutex
	store         *eventstore.Store
	appDir        string
	settingsPath  string
	demoDBPath    string
	settings      AppSettings
	hwnd          uintptr
	isMiniMode    bool
	savedStyle    uintptr
	savedRect     winRect
	bootMinimized bool
}

// NewApp creates a new App application struct.
func NewApp() *App {
	bootMin := false
	for _, arg := range os.Args[1:] {
		if strings.EqualFold(strings.TrimSpace(arg), "--minimized") {
			bootMin = true
			break
		}
	}
	return &App{
		bootMinimized: bootMin,
	}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx

	appDir := "."
	if configDir, err := os.UserConfigDir(); err == nil {
		candidate := filepath.Join(configDir, "DoDrag")
		if mkErr := os.MkdirAll(candidate, 0755); mkErr == nil {
			appDir = candidate
		}
	}
	a.appDir = appDir
	a.settingsPath = filepath.Join(appDir, "settings.json")
	a.demoDBPath = filepath.Clean(filepath.Join(appDir, "dodrag.db"))

	a.loadOrInitSettingsLocked()
	if a.settings.Autostart {
		_ = syncWindowsAutostart(true)
	}
	a.openActiveDatabaseLocked()
	a.mu.Unlock()

	go a.watchNativeMinimize(ctx)
}

func (a *App) ensureWindowHandleLocked() uintptr {
	if a.hwnd == 0 {
		a.hwnd = findAppWindowHandle()
	}
	return a.hwnd
}

func (a *App) watchNativeMinimize(ctx context.Context) {
	ticker := time.NewTicker(160 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.mu.Lock()
			hwnd := a.ensureWindowHandleLocked()
			if hwnd != 0 && !a.isMiniMode && isWindowMinimizedNative(hwnd) {
				// User clicked the native Windows Minimize button -> switch to compact corner-docked mode
				a.enterMiniModeLocked(a.settings.DockCorner, 4)
				a.mu.Unlock()
				runtime.EventsEmit(ctx, "window:minimized", true)
				continue
			}
			a.mu.Unlock()
		}
	}
}

func (a *App) ensureDemoDatabaseExistsLocked() {
	if _, err := os.Stat(a.demoDBPath); err != nil {
		if dir := filepath.Dir(a.demoDBPath); dir != "" && dir != "." {
			_ = os.MkdirAll(dir, 0755)
		}
		if s, openErr := eventstore.NewStoreWithOptions(a.demoDBPath, true); openErr == nil {
			_ = s.Close()
		}
	}
}

func (a *App) loadOrInitSettingsLocked() {
	raw, err := os.ReadFile(a.settingsPath)
	if err == nil {
		var loaded persistedSettings
		if jsonErr := json.Unmarshal(raw, &loaded); jsonErr == nil {
			for i := range loaded.KnownDatabases {
				loaded.KnownDatabases[i].Path = filepath.Clean(loaded.KnownDatabases[i].Path)
			}
			activePath := strings.TrimSpace(loaded.ActiveDatabasePath)
			if activePath != "" && activePath != "." {
				activePath = filepath.Clean(activePath)
			} else {
				activePath = ""
			}
			if len(loaded.KnownDatabases) == 0 {
				a.ensureDemoDatabaseExistsLocked()
				loaded.KnownDatabases = []DatabaseEntry{
					{
						Name:   "Demo-Datenbank",
						Path:   a.demoDBPath,
						IsDemo: true,
					},
				}
			}
			if loaded.DockCorner == "" {
				loaded.DockCorner = "bottom-right"
			}
			a.settings = AppSettings{
				KnownDatabases:     loaded.KnownDatabases,
				ActiveDatabasePath: activePath,
				Autostart:          loaded.Autostart,
				DockCorner:         loaded.DockCorner,
			}
			return
		}
	}

	// No valid settings.json yet: prepare Demo-Datenbank in KnownDatabases, but leave ActiveDatabasePath empty so Settings opens
	a.ensureDemoDatabaseExistsLocked()
	a.settings = AppSettings{
		KnownDatabases: []DatabaseEntry{
			{
				Name:   "Demo-Datenbank",
				Path:   a.demoDBPath,
				IsDemo: true,
			},
		},
		ActiveDatabasePath: "",
		Autostart:          false,
		DockCorner:         "bottom-right",
	}
	_ = a.saveSettingsLocked()
}

func (a *App) saveSettingsLocked() error {
	toSave := persistedSettings{
		KnownDatabases:     a.settings.KnownDatabases,
		ActiveDatabasePath: a.settings.ActiveDatabasePath,
		Autostart:          a.settings.Autostart,
		DockCorner:         a.settings.DockCorner,
	}
	data, err := json.MarshalIndent(toSave, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(a.settingsPath, data, 0644)
}

func (a *App) openActiveDatabaseLocked() {
	if a.store != nil {
		_ = a.store.Close()
		a.store = nil
	}

	activePath := strings.TrimSpace(a.settings.ActiveDatabasePath)
	if activePath == "" || activePath == "." {
		// No database selected -> leave a.store = nil so the Settings dialog is shown
		return
	}

	targetPath := filepath.Clean(activePath)
	info, statErr := os.Stat(targetPath)
	if statErr != nil || info.IsDir() {
		// Configured database file does not exist (deleted or moved) -> leave a.store = nil so Settings dialog is shown
		return
	}

	isDemo := strings.EqualFold(targetPath, a.demoDBPath)
	for _, entry := range a.settings.KnownDatabases {
		if strings.EqualFold(filepath.Clean(entry.Path), targetPath) {
			isDemo = entry.IsDemo
			break
		}
	}

	store, err := eventstore.NewStoreWithOptions(targetPath, isDemo)
	if err != nil {
		return
	}
	if _, err := store.GetEvents(); err != nil {
		_ = store.Close()
		return
	}
	a.store = store
}

func (a *App) snapshotSettingsLocked() AppSettings {
	out := AppSettings{
		ActiveDatabasePath: a.settings.ActiveDatabasePath,
		Autostart:          a.settings.Autostart,
		DockCorner:         a.settings.DockCorner,
		BootMinimized:      a.bootMinimized && a.store != nil,
		DatabaseReady:      a.store != nil,
		KnownDatabases:     make([]DatabaseEntry, len(a.settings.KnownDatabases)),
	}
	for i, entry := range a.settings.KnownDatabases {
		info, err := os.Stat(entry.Path)
		entry.Exists = err == nil && !info.IsDir()
		out.KnownDatabases[i] = entry
	}
	return out
}

func computeMiniLogicalSize(itemCount int) (int, int) {
	rows := itemCount
	if rows < 1 {
		rows = 1
	}
	if rows > 4 {
		rows = 4
	}
	logicalW := 240
	logicalH := 28 + rows*28 + 4
	return logicalW, logicalH
}

func (a *App) enterMiniModeLocked(corner string, itemCount int) string {
	hwnd := a.ensureWindowHandleLocked()
	if !a.isMiniMode && hwnd != 0 {
		if rect, ok := getWindowRectNative(hwnd); ok && (rect.Right-rect.Left) > 400 {
			a.savedRect = rect
		}
		if style := getWindowStyleNative(hwnd); style != 0 {
			a.savedStyle = style
		}
	}

	if a.ctx != nil {
		runtime.WindowSetMinSize(a.ctx, 180, 48)
		runtime.WindowSetAlwaysOnTop(a.ctx, true)
	}

	if corner == "" {
		corner = a.settings.DockCorner
	}
	logicalW, logicalH := computeMiniLogicalSize(itemCount)
	resolvedCorner := applyMiniWindowBoundsNative(hwnd, corner, logicalW, logicalH)
	a.isMiniMode = true
	a.settings.DockCorner = resolvedCorner
	_ = a.saveSettingsLocked()
	return resolvedCorner
}

// EnterMiniMode switches the window into the compact corner-docked task view.
func (a *App) EnterMiniMode(corner string, itemCount int) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.enterMiniModeLocked(corner, itemCount), nil
}

// UpdateMiniModeHeight adjusts the compact window height (up to 4 items) while staying docked in the current corner.
func (a *App) UpdateMiniModeHeight(itemCount int) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.isMiniMode {
		return nil
	}
	hwnd := a.ensureWindowHandleLocked()
	logicalW, logicalH := computeMiniLogicalSize(itemCount)
	applyMiniWindowBoundsNative(hwnd, a.settings.DockCorner, logicalW, logicalH)
	return nil
}

// SnapMiniWindowToNearestCorner snaps the compact window to whichever screen corner is closest after dragging.
func (a *App) SnapMiniWindowToNearestCorner(itemCount int) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	hwnd := a.ensureWindowHandleLocked()
	logicalW, logicalH := computeMiniLogicalSize(itemCount)
	resolvedCorner := applyMiniWindowBoundsNative(hwnd, "nearest", logicalW, logicalH)
	a.settings.DockCorner = resolvedCorner
	_ = a.saveSettingsLocked()
	return resolvedCorner, nil
}

// ExitMiniMode restores the full application window from compact corner-docked mode.
func (a *App) ExitMiniMode() error {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.isMiniMode = false
	a.bootMinimized = false
	hwnd := a.ensureWindowHandleLocked()

	if a.ctx != nil {
		runtime.WindowSetAlwaysOnTop(a.ctx, false)
		runtime.WindowSetMinSize(a.ctx, 860, 560)
	}

	restoreNormalWindowBoundsNative(hwnd, a.savedStyle, a.savedRect)
	return nil
}

// shutdown is called when the app terminates.
func (a *App) shutdown(ctx context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store != nil {
		_ = a.store.Close()
		a.store = nil
	}
}

// GetSettings returns the current database & application settings.
func (a *App) GetSettings() (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.snapshotSettingsLocked(), nil
}

// SetAutostart enables or disables launching DoDrag automatically on Windows boot/login.
func (a *App) SetAutostart(enabled bool) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if err := syncWindowsAutostart(enabled); err != nil {
		return a.snapshotSettingsLocked(), err
	}
	a.settings.Autostart = enabled
	_ = a.saveSettingsLocked()
	return a.snapshotSettingsLocked(), nil
}

// SelectFolderDialog opens a native folder picker dialog (e.g. to choose a Google Drive directory).
func (a *App) SelectFolderDialog() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	selected, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Speicherort für Datenbank wählen (z. B. Google Drive Ordner)",
	})
	if err != nil {
		return "", err
	}
	return selected, nil
}

// CreateDatabase creates a new SQLite database in folderPath with dbName, adds it to known databases, and activates it.
func (a *App) CreateDatabase(folderPath string, dbName string) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	trimmedName := strings.TrimSpace(dbName)
	if trimmedName == "" {
		return a.snapshotSettingsLocked(), errors.New("bitte einen Namen für die Datenbank eingeben")
	}

	trimmedFolder := strings.TrimSpace(folderPath)
	if trimmedFolder == "" {
		trimmedFolder = a.appDir
	}

	if err := os.MkdirAll(trimmedFolder, 0755); err != nil {
		return a.snapshotSettingsLocked(), fmt.Errorf("Ordner konnte nicht erstellt werden: %w", err)
	}

	fileName := trimmedName
	lower := strings.ToLower(fileName)
	if !strings.HasSuffix(lower, ".db") && !strings.HasSuffix(lower, ".sqlite") && !strings.HasSuffix(lower, ".sqlite3") {
		fileName += ".db"
	}

	displayName := strings.TrimSuffix(trimmedName, filepath.Ext(trimmedName))
	if displayName == "" {
		displayName = trimmedName
	}

	fullPath := filepath.Clean(filepath.Join(trimmedFolder, fileName))

	newStore, err := eventstore.NewStoreWithOptions(fullPath, false)
	if err != nil {
		return a.snapshotSettingsLocked(), fmt.Errorf("Datenbank konnte nicht angelegt werden: %w", err)
	}

	if a.store != nil {
		_ = a.store.Close()
	}
	a.store = newStore

	found := false
	for i := range a.settings.KnownDatabases {
		if strings.EqualFold(filepath.Clean(a.settings.KnownDatabases[i].Path), fullPath) {
			a.settings.KnownDatabases[i].Name = displayName
			a.settings.KnownDatabases[i].Path = fullPath
			found = true
			break
		}
	}
	if !found {
		a.settings.KnownDatabases = append(a.settings.KnownDatabases, DatabaseEntry{
			Name:   displayName,
			Path:   fullPath,
			IsDemo: false,
		})
	}

	a.settings.ActiveDatabasePath = fullPath
	_ = a.saveSettingsLocked()

	return a.snapshotSettingsLocked(), nil
}

// OpenExistingDatabaseDialog lets the user pick an existing .db file (e.g. from Google Drive) and activates it.
func (a *App) OpenExistingDatabaseDialog() (AppSettings, error) {
	if a.ctx == nil {
		return a.GetSettings()
	}
	selectedFile, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Vorhandene Datenbank auswählen",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "SQLite-Datenbank (*.db, *.sqlite)",
				Pattern:     "*.db;*.sqlite;*.sqlite3",
			},
		},
	})
	if err != nil {
		return a.GetSettings()
	}
	if strings.TrimSpace(selectedFile) == "" {
		return a.GetSettings()
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	fullPath := filepath.Clean(selectedFile)
	isDemo := strings.EqualFold(fullPath, a.demoDBPath)

	newStore, err := eventstore.NewStoreWithOptions(fullPath, isDemo)
	if err != nil {
		return a.snapshotSettingsLocked(), fmt.Errorf("Datenbank konnte nicht geöffnet werden: %w", err)
	}

	if a.store != nil {
		_ = a.store.Close()
	}
	a.store = newStore

	base := filepath.Base(fullPath)
	displayName := strings.TrimSuffix(base, filepath.Ext(base))
	if displayName == "" {
		displayName = base
	}

	found := false
	for i := range a.settings.KnownDatabases {
		if strings.EqualFold(filepath.Clean(a.settings.KnownDatabases[i].Path), fullPath) {
			found = true
			break
		}
	}
	if !found {
		a.settings.KnownDatabases = append(a.settings.KnownDatabases, DatabaseEntry{
			Name:   displayName,
			Path:   fullPath,
			IsDemo: isDemo,
		})
	}

	a.settings.ActiveDatabasePath = fullPath
	_ = a.saveSettingsLocked()

	return a.snapshotSettingsLocked(), nil
}

// SwitchDatabase switches the active database to dbPath.
func (a *App) SwitchDatabase(dbPath string) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	cleanTarget := filepath.Clean(dbPath)
	isDemo := strings.EqualFold(cleanTarget, a.demoDBPath)
	for _, entry := range a.settings.KnownDatabases {
		if strings.EqualFold(filepath.Clean(entry.Path), cleanTarget) {
			isDemo = entry.IsDemo
			break
		}
	}

	if isDemo {
		if dir := filepath.Dir(cleanTarget); dir != "" && dir != "." {
			_ = os.MkdirAll(dir, 0755)
		}
	} else {
		info, statErr := os.Stat(cleanTarget)
		if statErr != nil || info.IsDir() {
			return a.snapshotSettingsLocked(), fmt.Errorf("Datenbank-Datei wurde nicht gefunden (verschoben oder gelöscht): %s", cleanTarget)
		}
	}

	newStore, err := eventstore.NewStoreWithOptions(cleanTarget, isDemo)
	if err != nil {
		return a.snapshotSettingsLocked(), fmt.Errorf("Datenbank konnte nicht geladen werden: %w", err)
	}

	if a.store != nil {
		_ = a.store.Close()
	}
	a.store = newStore
	a.settings.ActiveDatabasePath = cleanTarget
	_ = a.saveSettingsLocked()

	return a.snapshotSettingsLocked(), nil
}

// DeleteDatabase deletes the specified database file from disk and removes it from known databases.
func (a *App) DeleteDatabase(dbPath string) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	cleanTarget := filepath.Clean(dbPath)
	wasActive := strings.EqualFold(filepath.Clean(a.settings.ActiveDatabasePath), cleanTarget)

	// Close the SQLite connection first if deleting the currently active database so Windows releases the file lock
	if wasActive && a.store != nil {
		_ = a.store.Close()
		a.store = nil
	}

	// Remove SQLite database file and optional WAL/SHM sidecar files
	_ = os.Remove(cleanTarget)
	_ = os.Remove(cleanTarget + "-wal")
	_ = os.Remove(cleanTarget + "-shm")

	remaining := make([]DatabaseEntry, 0, len(a.settings.KnownDatabases))
	for _, entry := range a.settings.KnownDatabases {
		if !strings.EqualFold(filepath.Clean(entry.Path), cleanTarget) {
			remaining = append(remaining, entry)
		}
	}

	if len(remaining) == 0 {
		remaining = []DatabaseEntry{
			{
				Name:   "Demo-Datenbank",
				Path:   a.demoDBPath,
				IsDemo: true,
			},
		}
	}
	a.settings.KnownDatabases = remaining

	if wasActive {
		// Active database was deleted -> clear selection so user chooses/creates one in Settings
		a.settings.ActiveDatabasePath = ""
	}

	_ = a.saveSettingsLocked()
	return a.snapshotSettingsLocked(), nil
}

// GetEvents returns the full event history from SQLite.
func (a *App) GetEvents() ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return []eventstore.Event{}, nil
	}
	return a.store.GetEvents()
}

// AppendEvent appends a new domain event to the SQLite event store and returns the updated list.
func (a *App) AppendEvent(id string, eventType string, payloadJSON string) ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return []eventstore.Event{}, errors.New("keine Datenbank geöffnet")
	}
	return a.store.AppendEvent(id, eventType, payloadJSON)
}

// Undo reverts the most recent active event.
func (a *App) Undo() ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return []eventstore.Event{}, nil
	}
	return a.store.Undo()
}

// Redo re-applies the most recently undone event.
func (a *App) Redo() ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return []eventstore.Event{}, nil
	}
	return a.store.Redo()
}

// ResetDemoData resets the database to the default demo state.
func (a *App) ResetDemoData() ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return []eventstore.Event{}, nil
	}
	return a.store.ResetDemoData()
}

