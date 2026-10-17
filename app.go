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

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// DatabaseEntry represents a known SQLite database file on this computer.
type DatabaseEntry struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	IsDemo bool   `json:"isDemo"`
	Exists bool   `json:"exists"`
}

// AppSettings stores known databases, the currently active database, and first-run status in %APPDATA%\DoDrag\settings.json.
type AppSettings struct {
	KnownDatabases     []DatabaseEntry `json:"knownDatabases"`
	ActiveDatabasePath string          `json:"activeDatabasePath"`
	FirstRunCompleted  bool            `json:"firstRunCompleted"`
}

// App struct binds Go methods to the Wails frontend.
type App struct {
	ctx          context.Context
	mu           sync.Mutex
	store        *eventstore.Store
	appDir       string
	settingsPath string
	demoDBPath   string
	settings     AppSettings
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()

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
	a.openActiveDatabaseLocked()
}

func (a *App) loadOrInitSettingsLocked() {
	raw, err := os.ReadFile(a.settingsPath)
	if err == nil {
		var loaded AppSettings
		if jsonErr := json.Unmarshal(raw, &loaded); jsonErr == nil {
			for i := range loaded.KnownDatabases {
				loaded.KnownDatabases[i].Path = filepath.Clean(loaded.KnownDatabases[i].Path)
			}
			loaded.ActiveDatabasePath = filepath.Clean(loaded.ActiveDatabasePath)
			if len(loaded.KnownDatabases) == 0 {
				loaded.KnownDatabases = []DatabaseEntry{
					{
						Name:   "Demo-Datenbank",
						Path:   a.demoDBPath,
						IsDemo: true,
					},
				}
			}
			if loaded.ActiveDatabasePath == "" || loaded.ActiveDatabasePath == "." {
				loaded.ActiveDatabasePath = loaded.KnownDatabases[0].Path
			}
			a.settings = loaded
			return
		}
	}

	// First start: initialize settings with Demo-Datenbank available for selection and FirstRunCompleted = false
	a.settings = AppSettings{
		KnownDatabases: []DatabaseEntry{
			{
				Name:   "Demo-Datenbank",
				Path:   a.demoDBPath,
				IsDemo: true,
			},
		},
		ActiveDatabasePath: a.demoDBPath,
		FirstRunCompleted:  false,
	}
	_ = a.saveSettingsLocked()
}

func (a *App) saveSettingsLocked() error {
	data, err := json.MarshalIndent(a.settings, "", "  ")
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

	targetPath := filepath.Clean(a.settings.ActiveDatabasePath)
	isDemo := filepath.Clean(targetPath) == a.demoDBPath
	for _, entry := range a.settings.KnownDatabases {
		if filepath.Clean(entry.Path) == targetPath {
			isDemo = entry.IsDemo
			break
		}
	}

	if dir := filepath.Dir(targetPath); dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0755)
	}

	store, err := eventstore.NewStoreWithOptions(targetPath, isDemo)
	if err != nil {
		// Fallback to demo database if active database path is inaccessible
		store, _ = eventstore.NewStoreWithOptions(a.demoDBPath, true)
		a.settings.ActiveDatabasePath = a.demoDBPath
		_ = a.saveSettingsLocked()
	}
	a.store = store
}

func (a *App) snapshotSettingsLocked() AppSettings {
	out := AppSettings{
		ActiveDatabasePath: a.settings.ActiveDatabasePath,
		FirstRunCompleted:  a.settings.FirstRunCompleted,
		KnownDatabases:     make([]DatabaseEntry, len(a.settings.KnownDatabases)),
	}
	for i, entry := range a.settings.KnownDatabases {
		_, err := os.Stat(entry.Path)
		entry.Exists = err == nil
		out.KnownDatabases[i] = entry
	}
	return out
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

// CompleteFirstRun marks the initial setup dialog as completed and saves settings.
func (a *App) CompleteFirstRun() (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.FirstRunCompleted = true
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
	a.settings.FirstRunCompleted = true
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
	a.settings.FirstRunCompleted = true
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

	if dir := filepath.Dir(cleanTarget); dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0755)
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
	a.settings.FirstRunCompleted = true
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
		a.settings.ActiveDatabasePath = a.settings.KnownDatabases[0].Path
		a.openActiveDatabaseLocked()
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
	return a.store.AppendEvent(id, eventType, payloadJSON)
}

// Undo reverts the most recent active event.
func (a *App) Undo() ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.store.Undo()
}

// Redo re-applies the most recently undone event.
func (a *App) Redo() ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.store.Redo()
}

// ResetDemoData resets the database to the default demo state.
func (a *App) ResetDemoData() ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.store.ResetDemoData()
}

