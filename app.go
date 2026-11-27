package main

import (
	"context"
	"dodrag/internal/eventstore"
	timemeasurement "dodrag/internal/plugins/time-measurement"
	"encoding/json"
	"errors"
	"maps"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Build-time identity, overridable via -ldflags; the build scripts provide release values.
var (
	buildVersion = "dev"
	buildTime    = ""
)

// DatabaseEntry represents a known SQLite database file on this computer.
type DatabaseEntry struct {
	Name           string `json:"name"`
	Path           string `json:"path"`
	IsDemo         bool   `json:"isDemo"`
	Exists         bool   `json:"exists"`
	RequiresUpdate bool   `json:"requiresUpdate,omitempty"`
}

// SetupState describes whether the executable and its shortcuts are installed.
type SetupState struct {
	CurrentExe            string `json:"currentExe"`
	CurrentDir            string `json:"currentDir"`
	InstallPath           string `json:"installPath"`
	ProgramInstalled      bool   `json:"programInstalled"`
	InstalledVersionOlder bool   `json:"installedVersionOlder,omitempty"`
	DesktopShortcut       bool   `json:"desktopShortcut"`
	StartMenuShortcut     bool   `json:"startMenuShortcut"`
}

// DesktopCapabilities describe the optional native behaviors exposed to the UI.
type DesktopCapabilities struct {
	MiniWindow     bool `json:"miniWindow"`
	NativeTaskMenu bool `json:"nativeTaskMenu"`
	SelfInstall    bool `json:"selfInstall"`
	Autostart      bool `json:"autostart"`
}

// AppSettings combines persisted preferences with runtime state.
type AppSettings struct {
	Capabilities        DesktopCapabilities `json:"capabilities"`
	PluginEnabled       map[string]bool     `json:"pluginEnabled"`
	DefaultTimeMarkers  []int               `json:"defaultTimeMarkers"`
	DefaultDuration     float64             `json:"defaultDuration"`
	DefaultDurationUnit string              `json:"defaultDurationUnit"`
	KnownDatabases      []DatabaseEntry     `json:"knownDatabases"`
	ActiveDatabasePath  string              `json:"activeDatabasePath"`
	Autostart           bool                `json:"autostart"`
	DockMonitor         string              `json:"dockMonitor"`
	DockCorner          string              `json:"dockCorner"`
	UILanguage          string              `json:"uiLanguage"`
	BootMinimized       bool                `json:"bootMinimized,omitempty"`
	DatabaseReady       bool                `json:"databaseReady,omitempty"`
	DatabaseGeneration  uint64              `json:"databaseGeneration,omitempty"`
	DatabaseError       string              `json:"databaseError,omitempty"`
	Version             string              `json:"version,omitempty"`
	BuildTime           string              `json:"buildTime,omitempty"`
	PreviewCacheDir     string              `json:"previewCacheDir,omitempty"`
	PreviewCacheError   string              `json:"previewCacheError,omitempty"`
	Setup               SetupState          `json:"setup"`
}

type persistedSettings struct {
	PluginEnabled       map[string]bool `json:"pluginEnabled,omitempty"`
	DefaultTimeMarkers  []int           `json:"defaultTimeMarkers"`
	DefaultDuration     float64         `json:"defaultDuration"`
	DefaultDurationUnit string          `json:"defaultDurationUnit"`
	KnownDatabases      []DatabaseEntry `json:"knownDatabases"`
	ActiveDatabasePath  string          `json:"activeDatabasePath"`
	Autostart           bool            `json:"autostart"`
	DockMonitor         string          `json:"dockMonitor"`
	DockCorner          string          `json:"dockCorner"`
	UILanguage          string          `json:"uiLanguage"`
}

// App struct binds Go methods to the Wails frontend.
type App struct {
	ctx                context.Context
	mu                 sync.Mutex
	store              *eventstore.Store
	databaseGeneration uint64
	appDir             string
	settingsPath       string
	demoDBPath         string
	settings           AppSettings
	settingsLoadErr    error
	settingsSaveErr    error
	databaseOpenErr    error
	desktopState
	bootMinimized bool
	windowMode    WindowMode
	taskMenus     taskMenuState
	editorReady   bool
	closePending  bool
	closeApproved bool
	// Lock order: mu, then previewMu. Image processing never holds mu.
	previewMu         sync.Mutex
	previewCacheDir   string
	previewCacheError string
}

// NewApp creates a new App application struct.
func NewApp() *App {
	bootMin := false
	for _, arg := range os.Args[1:] {
		trimmed := strings.TrimSpace(arg)
		if strings.EqualFold(trimmed, "--minimized") || strings.EqualFold(trimmed, "--minimize") {
			bootMin = true
			break
		}
	}
	return &App{
		bootMinimized: bootMin && desktopCapabilities().MiniWindow,
		desktopState:  newDesktopState(),
	}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx

	a.initializeDesktopLocked()

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

	if err := a.loadOrInitSettingsLocked(); err != nil {
		runtime.LogErrorf(ctx, "%s: %v", a.textLocked("Settings konnten nicht geladen werden"), err)
	} else {
		if desktopCapabilities().Autostart && a.settings.Autostart {
			_ = syncDesktopAutostart(true, a.settings.UILanguage)
		}
		a.openActiveDatabaseLocked()
	}
	a.startDesktopLocked(ctx)
	a.mu.Unlock()
}

func (a *App) loadOrInitSettingsLocked() (err error) {
	defer func() { a.settingsLoadErr = err }()
	a.settingsLoadErr = nil
	a.settingsSaveErr = nil
	if !validUILanguage(a.settings.UILanguage) {
		a.settings.UILanguage = "en"
	}

	raw, err := os.ReadFile(a.settingsPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return a.errorLocked("Settings lesen ({path})", err, "path", a.settingsPath)
	}
	if err == nil {
		var loaded persistedSettings
		if jsonErr := json.Unmarshal(raw, &loaded); jsonErr != nil {
			return a.errorLocked("Settings JSON ({path})", jsonErr, "path", a.settingsPath)
		}
		if strings.TrimSpace(string(raw)) == "null" {
			return errors.New(a.textLocked("Settings JSON ({path}): Objekt erwartet", "path", a.settingsPath))
		}
		migrateLanguage := !validUILanguage(loaded.UILanguage)
		if migrateLanguage {
			loaded.UILanguage = a.initialUILanguage()
		}
		for i := range loaded.KnownDatabases {
			loaded.KnownDatabases[i].Path = filepath.Clean(loaded.KnownDatabases[i].Path)
		}
		activePath := strings.TrimSpace(loaded.ActiveDatabasePath)
		if activePath != "" && activePath != "." {
			activePath = filepath.Clean(activePath)
		} else {
			activePath = ""
		}
		if i := knownDatabaseIndex(loaded.KnownDatabases, activePath); i >= 0 {
			activePath = loaded.KnownDatabases[i].Path
		}
		if len(loaded.KnownDatabases) == 0 {
			loaded.KnownDatabases = []DatabaseEntry{
				{
					Name:   backendText(loaded.UILanguage, "Demo-Datenbank"),
					Path:   a.demoDBPath,
					IsDemo: true,
				},
			}
		}
		loaded.DockMonitor, loaded.DockCorner = desktopDockPlacement(loaded.DockMonitor, loaded.DockCorner)
		if !validDefaultDuration(loaded.DefaultDuration, loaded.DefaultDurationUnit) {
			loaded.DefaultDuration, loaded.DefaultDurationUnit = 1, "days"
		}
		markers, markerErr := eventstore.NormalizeMarkerMinutes(loaded.DefaultTimeMarkers)
		if markerErr != nil {
			return a.errorLocked("Settings lesen ({path})", markerErr, "path", a.settingsPath)
		}
		a.settings = AppSettings{
			PluginEnabled:       loaded.PluginEnabled,
			DefaultTimeMarkers:  markers,
			DefaultDuration:     loaded.DefaultDuration,
			DefaultDurationUnit: loaded.DefaultDurationUnit,
			KnownDatabases:      loaded.KnownDatabases,
			ActiveDatabasePath:  activePath,
			Autostart:           loaded.Autostart,
			DockMonitor:         loaded.DockMonitor,
			DockCorner:          loaded.DockCorner,
			UILanguage:          loaded.UILanguage,
		}
		if migrateLanguage {
			return a.saveSettingsLocked()
		}
		return nil
	}

	// Only a missing file is first start; unreadable or invalid originals stay untouched.
	language := a.initialUILanguage()
	defaultMonitor, defaultCorner := desktopDockPlacement("", "")
	a.settings = AppSettings{
		KnownDatabases: []DatabaseEntry{
			{
				Name:   backendText(language, "Demo-Datenbank"),
				Path:   a.demoDBPath,
				IsDemo: true,
			},
		},
		ActiveDatabasePath:  "",
		Autostart:           false,
		DockMonitor:         defaultMonitor,
		DockCorner:          defaultCorner,
		UILanguage:          language,
		DefaultDuration:     1,
		DefaultDurationUnit: "days",
	}
	return a.saveSettingsLocked()
}

func (a *App) saveSettingsLocked() (err error) {
	// Native callbacks cannot return errors; GetSettings exposes the latest save failure.
	defer func() {
		if err != nil && a.settingsLoadErr == nil {
			err = a.errorLocked("Settings konnten nicht gespeichert werden", err)
		}
		a.settingsSaveErr = err
	}()
	if a.settingsLoadErr != nil {
		return a.settingsLoadErr
	}
	toSave := persistedSettings{
		PluginEnabled:       a.settings.PluginEnabled,
		DefaultTimeMarkers:  append([]int{}, a.settings.DefaultTimeMarkers...),
		KnownDatabases:      a.settings.KnownDatabases,
		ActiveDatabasePath:  a.settings.ActiveDatabasePath,
		Autostart:           a.settings.Autostart,
		DockMonitor:         a.settings.DockMonitor,
		DockCorner:          a.settings.DockCorner,
		UILanguage:          a.settings.UILanguage,
		DefaultDuration:     a.settings.DefaultDuration,
		DefaultDurationUnit: a.settings.DefaultDurationUnit,
	}
	data, err := json.MarshalIndent(toSave, "", "  ")
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(a.settingsPath), ".settings-*.tmp")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if _, err = temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err = temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	return os.Rename(name, a.settingsPath)
}

func (a *App) openActiveDatabaseLocked() {
	a.databaseOpenErr = nil
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

	store, err := eventstore.OpenExistingStore(targetPath, eventstore.BuildInfo{Version: buildVersion, BuildTime: buildTime})
	if err != nil {
		a.databaseOpenErr = err
		return
	}
	if _, err := store.GetEvents(); err != nil {
		_ = store.Close()
		a.databaseOpenErr = err
		return
	}
	a.store = store
	a.databaseGeneration++
}

// Only these built-in IDs are exposed to the frontend. Unknown persisted flags
// stay in local settings for round trips through older versions of DoDrag.
var supportedPluginIDs = [...]string{"copy-task-summary", timemeasurement.ID}

func (a *App) snapshotSettingsLocked() AppSettings {
	flags := make(map[string]bool, len(supportedPluginIDs))
	for _, id := range supportedPluginIDs {
		flags[id] = a.settings.PluginEnabled[id]
	}
	out := AppSettings{
		PluginEnabled:       flags,
		Capabilities:        desktopCapabilities(),
		DefaultTimeMarkers:  append([]int{}, a.settings.DefaultTimeMarkers...),
		ActiveDatabasePath:  a.settings.ActiveDatabasePath,
		Autostart:           a.settings.Autostart,
		DockMonitor:         a.settings.DockMonitor,
		DockCorner:          a.settings.DockCorner,
		UILanguage:          a.settings.UILanguage,
		DefaultDuration:     a.settings.DefaultDuration,
		DefaultDurationUnit: a.settings.DefaultDurationUnit,
		BootMinimized:       a.bootMinimized && a.store != nil,
		DatabaseReady:       a.store != nil,
		Version:             buildVersion,
		BuildTime:           buildTime,
		PreviewCacheDir:     a.previewCacheDirectory(),
		PreviewCacheError:   a.previewCacheError,
		Setup:               computeSetupState(),
		KnownDatabases:      make([]DatabaseEntry, len(a.settings.KnownDatabases)),
	}
	if a.store != nil {
		out.DatabaseGeneration = a.databaseGeneration
	}
	if a.databaseOpenErr != nil {
		out.DatabaseError = a.errorLocked("Datenbank konnte nicht geöffnet werden", a.databaseOpenErr).Error()
	}
	for i, entry := range a.settings.KnownDatabases {
		info, err := os.Stat(entry.Path)
		entry.Exists = err == nil && !info.IsDir()
		entry.RequiresUpdate = false
		if entry.Exists {
			// Inspect local metadata only, including inactive databases. Never ask
			// GitHub whether an update exists; the user explicitly opens Releases.
			var compatibility *eventstore.CompatibilityError
			entry.RequiresUpdate = errors.As(eventstore.CheckCompatibility(entry.Path, eventstore.BuildInfo{Version: buildVersion}), &compatibility)
		}
		out.KnownDatabases[i] = entry
	}
	return out
}

// shutdown is called when the app terminates.
func (a *App) shutdown(ctx context.Context) {
	a.stopDesktop()
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
	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	return a.snapshotSettingsLocked(), a.settingsSaveErr
}

// SetPluginEnabled confirms a built-in plugin preference after it is saved locally.
func (a *App) SetPluginEnabled(id string, enabled bool) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !slices.Contains(supportedPluginIDs[:], id) {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("Unbekanntes Plugin: {id}", "id", id))
	}
	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	if id == timemeasurement.ID && !enabled && a.settings.PluginEnabled[id] {
		if err := a.stopOwnedTimeMeasurementLocked(); err != nil {
			return a.snapshotSettingsLocked(), err
		}
	}
	previous := a.settings.PluginEnabled
	a.settings.PluginEnabled = maps.Clone(previous)
	if a.settings.PluginEnabled == nil {
		a.settings.PluginEnabled = make(map[string]bool)
	}
	a.settings.PluginEnabled[id] = enabled
	if err := a.saveSettingsLocked(); err != nil {
		a.settings.PluginEnabled = previous
		return a.snapshotSettingsLocked(), err
	}
	return a.snapshotSettingsLocked(), nil
}

func validDefaultDuration(value float64, unit string) bool {
	factor := map[string]float64{"minutes": 1, "hours": 60, "days": 1440}[unit]
	return factor > 0 && !math.IsNaN(value) && !math.IsInf(value, 0) && value > 0 && value*factor <= 52560000
}

// Defaults are copied into each database day once; editing this list never
// rewrites existing day instances or the user's individual marker edits.
func (a *App) SetDefaultTimeMarkers(minutes []int) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	normalized, err := eventstore.NormalizeMarkerMinutes(minutes)
	if err != nil {
		return a.snapshotSettingsLocked(), err
	}
	previous := a.settings.DefaultTimeMarkers
	a.settings.DefaultTimeMarkers = normalized
	if err := a.saveSettingsLocked(); err != nil {
		a.settings.DefaultTimeMarkers = previous
		return a.snapshotSettingsLocked(), err
	}
	return a.snapshotSettingsLocked(), nil
}

func (a *App) SetDefaultDuration(value float64, unit string) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	if !validDefaultDuration(value, unit) {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("Ungültige Standarddauer"))
	}
	previous, previousUnit := a.settings.DefaultDuration, a.settings.DefaultDurationUnit
	a.settings.DefaultDuration, a.settings.DefaultDurationUnit = value, unit
	if err := a.saveSettingsLocked(); err != nil {
		a.settings.DefaultDuration, a.settings.DefaultDurationUnit = previous, previousUnit
		return a.snapshotSettingsLocked(), err
	}
	return a.snapshotSettingsLocked(), nil
}

// SetAutostart enables or disables launching DoDrag automatically at login.
func (a *App) SetAutostart(enabled bool) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	if err := syncDesktopAutostart(enabled, a.settings.UILanguage); err != nil {
		return a.snapshotSettingsLocked(), err
	}
	previous := a.settings.Autostart
	a.settings.Autostart = enabled
	if err := a.saveSettingsLocked(); err != nil {
		a.settings.Autostart = previous
		rollbackErr := syncDesktopAutostart(previous, a.settings.UILanguage)
		return a.snapshotSettingsLocked(), errors.Join(err, rollbackErr)
	}
	return a.snapshotSettingsLocked(), nil
}

// SetUILanguage persists a supported language before refreshing native shell tasks.
func (a *App) SetUILanguage(language string) (AppSettings, error) {
	a.mu.Lock()
	if a.settingsLoadErr != nil {
		settings, err := a.snapshotSettingsLocked(), a.settingsLoadErr
		a.mu.Unlock()
		return settings, err
	}
	if !validUILanguage(language) {
		settings := a.snapshotSettingsLocked()
		err := errors.New(a.textLocked("Ungültige UI-Sprache: {language}", "language", language))
		a.mu.Unlock()
		return settings, err
	}
	previous := a.settings.UILanguage
	a.settings.UILanguage = language
	if err := a.saveSettingsLocked(); err != nil {
		a.settings.UILanguage = previous
		settings := a.snapshotSettingsLocked()
		a.mu.Unlock()
		return settings, err
	}
	settings := a.snapshotSettingsLocked()
	a.mu.Unlock()
	a.refreshDesktopActions()
	return settings, nil
}

// SelectFolderDialog opens a native folder picker dialog (e.g. to choose a Google Drive directory).
func (a *App) SelectFolderDialog() (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	language := a.currentUILanguage()
	selected, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: backendText(language, "Speicherort für Datenbank wählen (z. B. Google Drive Ordner)"),
	})
	if err != nil {
		return "", localizedError(language, "Ordnerauswahl fehlgeschlagen", err)
	}
	return selected, nil
}

// CreateDatabase creates a new SQLite database in folderPath with dbName, adds it to known databases, and activates it.
func (a *App) CreateDatabase(folderPath string, dbName string, seedDemo bool) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	trimmedName := strings.TrimSpace(dbName)
	if trimmedName == "" {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("bitte einen Namen für die Datenbank eingeben"))
	}
	if !validDatabaseFilename(trimmedName) {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("Datenbankname muss ein reiner Dateiname sein"))
	}

	trimmedFolder := strings.TrimSpace(folderPath)
	if trimmedFolder == "" {
		trimmedFolder = a.appDir
	}

	if err := os.MkdirAll(trimmedFolder, 0755); err != nil {
		return a.snapshotSettingsLocked(), a.errorLocked("Ordner konnte nicht erstellt werden", err)
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

	file, err := os.OpenFile(fullPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return a.snapshotSettingsLocked(), a.errorLocked("Datei konnte nicht exklusiv angelegt werden", err)
	}
	if err := file.Close(); err != nil {
		os.Remove(fullPath)
		return a.snapshotSettingsLocked(), a.errorLocked("Datenbank konnte nicht geschlossen werden", err)
	}
	newStore, err := eventstore.NewStoreWithBuildInfo(fullPath, seedDemo, eventstore.BuildInfo{Version: buildVersion, BuildTime: buildTime}, func(title string) string { return a.textLocked(title) })
	if err != nil {
		os.Remove(fullPath)
		return a.snapshotSettingsLocked(), a.errorLocked("Datenbank konnte nicht angelegt werden", err)
	}

	previous := a.settings
	a.settings.KnownDatabases = append([]DatabaseEntry(nil), previous.KnownDatabases...)
	if index := knownDatabaseIndex(a.settings.KnownDatabases, fullPath); index >= 0 {
		a.settings.KnownDatabases[index].Name = displayName
		a.settings.KnownDatabases[index].Path = fullPath
	} else {
		a.settings.KnownDatabases = append(a.settings.KnownDatabases, DatabaseEntry{
			Name:   displayName,
			Path:   fullPath,
			IsDemo: false,
		})
	}

	a.settings.ActiveDatabasePath = fullPath
	if err := a.activateStoreLocked(newStore, previous); err != nil {
		os.Remove(fullPath)
		os.Remove(fullPath + "-wal")
		os.Remove(fullPath + "-shm")
		return a.snapshotSettingsLocked(), err
	}

	return a.snapshotSettingsLocked(), nil
}

// OpenExistingDatabaseDialog lets the user pick an existing .db file (e.g. from Google Drive) and activates it.
func (a *App) OpenExistingDatabaseDialog() (AppSettings, error) {
	if a.ctx == nil {
		return a.GetSettings()
	}
	language := a.currentUILanguage()
	selectedFile, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: backendText(language, "Vorhandene Datenbank auswählen"),
		Filters: []runtime.FileFilter{
			{
				DisplayName: backendText(language, "SQLite-Datenbank (*.db, *.sqlite)"),
				Pattern:     "*.db;*.sqlite;*.sqlite3",
			},
		},
	})
	if err != nil {
		settings, _ := a.GetSettings()
		return settings, localizedError(language, "Datenbankauswahl fehlgeschlagen", err)
	}
	if strings.TrimSpace(selectedFile) == "" {
		return a.GetSettings()
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	fullPath := filepath.Clean(selectedFile)
	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	known := knownDatabaseIndex(a.settings.KnownDatabases, fullPath)
	if known >= 0 {
		// Reuse the registered spelling so SQLite opens the same journal path.
		fullPath = a.settings.KnownDatabases[known].Path
	}
	if a.store != nil && sameFilePath(a.settings.ActiveDatabasePath, fullPath) {
		return a.snapshotSettingsLocked(), nil
	}
	isDemo := sameFilePath(fullPath, a.demoDBPath)

	info, err := os.Stat(fullPath)
	if err != nil || info.IsDir() {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("Datenbank nicht vorhanden: {path}", "path", fullPath))
	}
	newStore, err := eventstore.OpenExistingStore(fullPath, eventstore.BuildInfo{Version: buildVersion, BuildTime: buildTime})
	if err != nil {
		return a.snapshotSettingsLocked(), a.errorLocked("Datenbank konnte nicht geöffnet werden", err)
	}

	previous := a.settings
	a.settings.KnownDatabases = append([]DatabaseEntry(nil), previous.KnownDatabases...)

	base := filepath.Base(fullPath)
	displayName := strings.TrimSuffix(base, filepath.Ext(base))
	if displayName == "" {
		displayName = base
	}

	if known < 0 {
		a.settings.KnownDatabases = append(a.settings.KnownDatabases, DatabaseEntry{
			Name:   displayName,
			Path:   fullPath,
			IsDemo: isDemo,
		})
	}

	a.settings.ActiveDatabasePath = fullPath
	if err := a.activateStoreLocked(newStore, previous); err != nil {
		return a.snapshotSettingsLocked(), err
	}

	return a.snapshotSettingsLocked(), nil
}

// Prefer an exact stored spelling, then let the filesystem resolve aliases.
func knownDatabaseIndex(entries []DatabaseEntry, path string) int {
	for i, entry := range entries {
		if entry.Path == path {
			return i
		}
	}
	for i, entry := range entries {
		if sameFilePath(entry.Path, path) {
			return i
		}
	}
	return -1
}

// SwitchDatabase switches the active database to dbPath.
func (a *App) SwitchDatabase(dbPath string) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	index := knownDatabaseIndex(a.settings.KnownDatabases, filepath.Clean(dbPath))
	if index < 0 {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("Datenbank ist nicht in der Liste"))
	}
	cleanTarget := a.settings.KnownDatabases[index].Path
	if a.store != nil && sameFilePath(a.settings.ActiveDatabasePath, cleanTarget) {
		return a.snapshotSettingsLocked(), nil
	}
	info, statErr := os.Stat(cleanTarget)
	if statErr != nil || info.IsDir() {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("Datenbank-Datei wurde nicht gefunden (verschoben oder gelöscht): {path}", "path", cleanTarget))
	}

	newStore, err := eventstore.OpenExistingStore(cleanTarget, eventstore.BuildInfo{Version: buildVersion, BuildTime: buildTime})
	if err != nil {
		return a.snapshotSettingsLocked(), a.errorLocked("Datenbank konnte nicht geladen werden", err)
	}

	previous := a.settings
	a.settings.ActiveDatabasePath = cleanTarget
	if err := a.activateStoreLocked(newStore, previous); err != nil {
		return a.snapshotSettingsLocked(), err
	}

	return a.snapshotSettingsLocked(), nil
}

// DeleteDatabase separates forgetting an entry from physically deleting its files.
func (a *App) DeleteDatabase(dbPath string, deleteFile bool) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	index := knownDatabaseIndex(a.settings.KnownDatabases, filepath.Clean(dbPath))
	if index < 0 {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("Datenbank ist nicht in der Liste"))
	}
	cleanTarget := a.settings.KnownDatabases[index].Path
	wasActive := sameFilePath(a.settings.ActiveDatabasePath, cleanTarget)

	remaining := make([]DatabaseEntry, 0, len(a.settings.KnownDatabases))
	for _, entry := range a.settings.KnownDatabases {
		if !sameFilePath(entry.Path, cleanTarget) {
			remaining = append(remaining, entry)
		}
	}

	// Close the SQLite connection first if deleting the currently active database so Windows releases the file lock
	if wasActive && a.store != nil {
		if err := a.stopOwnedTimeMeasurementLocked(); err != nil {
			return a.snapshotSettingsLocked(), err
		}
		if err := a.store.Close(); err != nil {
			return a.snapshotSettingsLocked(), a.errorLocked("Datenbank konnte nicht geschlossen werden", err)
		}
		a.store = nil
	}

	var deleteErr error
	// Delete the main file first: a failed removal must not discard committed WAL.
	// This is not atomic; after success, sidecar/settings failures cannot restore the DB.
	if deleteFile {
		if err := os.Remove(cleanTarget); err != nil && !errors.Is(err, os.ErrNotExist) {
			if wasActive {
				a.openActiveDatabaseLocked()
			}
			return a.snapshotSettingsLocked(), a.errorLocked("Hauptdatei nicht geloescht ({path}), WAL/SHM nicht entfernt", err, "path", cleanTarget)
		}
		for _, path := range []string{cleanTarget + "-wal", cleanTarget + "-shm"} {
			if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				deleteErr = errors.Join(deleteErr, a.errorLocked("Hauptdatei entfernt, Sidecar nicht geloescht ({path})", err, "path", path))
			}
		}
	}

	previous := a.settings
	a.settings.KnownDatabases = remaining

	if wasActive {
		// Active database was deleted -> clear selection so user chooses/creates one in Settings
		a.settings.ActiveDatabasePath = ""
	}

	if err := a.saveDatabaseSelectionLocked(); err != nil {
		a.settings = previous
		if wasActive {
			a.openActiveDatabaseLocked()
		}
		if deleteFile {
			err = a.errorLocked("Hauptdatei entfernt, Settings nicht gespeichert", err)
		}
		return a.snapshotSettingsLocked(), errors.Join(deleteErr, err)
	}
	return a.snapshotSettingsLocked(), deleteErr
}

// Selection methods already report a settings failure directly. Do not poison
// the subsequent settings/snapshot read used to show the actual active store.
func (a *App) saveDatabaseSelectionLocked() error {
	previousWarning := a.settingsSaveErr
	err := a.saveSettingsLocked()
	if err != nil {
		a.settingsSaveErr = previousWarning
	}
	return err
}

func (a *App) activateStoreLocked(candidate *eventstore.Store, previous AppSettings) error {
	if _, err := candidate.GetEvents(); err != nil {
		candidate.Close()
		a.settings = previous
		return a.errorLocked("Ereignisse konnten nicht geladen werden", err)
	}
	if err := a.stopOwnedTimeMeasurementLocked(); err != nil {
		candidate.Close()
		a.settings = previous
		return err
	}
	if err := a.saveDatabaseSelectionLocked(); err != nil {
		candidate.Close()
		a.settings = previous
		return err
	}
	old := a.store
	a.store = candidate
	a.databaseGeneration++
	a.databaseOpenErr = nil
	if old != nil {
		if err := old.Close(); err != nil {
			if a.ctx != nil {
				runtime.LogErrorf(a.ctx, "%s: %v", a.textLocked("Neue Datenbank aktiv, Schliessen der alten fehlgeschlagen"), err)
			}
		}
	}
	return nil
}

// GetEvents returns the full event history from SQLite.
func (a *App) GetEvents() ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return []eventstore.Event{}, nil
	}
	if err := a.store.RecoverDescriptionDrafts(); err != nil {
		return nil, a.errorLocked("Ereignisse konnten nicht geladen werden", err)
	}
	events, err := a.store.GetEvents()
	return events, a.errorLocked("Ereignisse konnten nicht geladen werden", err)
}

// Checkpoints are bound to their database, even if a delayed bridge call arrives
// after a switch. Errors use the same visible save-failure path as event writes.
func (a *App) SaveDescriptionDraft(database, taskID, description, base, session string, revision int64) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil || database != a.settings.ActiveDatabasePath {
		return errors.New(a.textLocked("keine Datenbank geöffnet"))
	}
	return a.errorLocked("Änderung konnte nicht gespeichert werden", a.store.SaveDescriptionDraft(taskID, description, base, session, revision))
}

// DeleteProject accepts the database identity captured by the confirmation dialog.
func (a *App) DeleteProject(database, projectID string) ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil || database != a.settings.ActiveDatabasePath {
		return nil, errors.New(a.textLocked("keine Datenbank geöffnet"))
	}
	events, err := a.store.DeleteProject(projectID)
	return events, a.errorLocked("Änderungen konnten nicht gespeichert werden", err)
}

// AppendEvent appends a new domain event to the SQLite event store and returns the updated list.
func (a *App) AppendEvent(id string, eventType string, payloadJSON string) ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return []eventstore.Event{}, errors.New(a.textLocked("keine Datenbank geöffnet"))
	}
	events, err := a.store.AppendEvent(id, eventType, payloadJSON)
	if err == nil && eventType == "TASK_COMPLETED" {
		a.cleanupCompletedPreviewsLocked(events, map[string]bool{id: true})
	}
	return events, a.errorLocked("Änderung konnte nicht gespeichert werden", err)
}

func (a *App) AppendBatch(commands []eventstore.Command) ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return nil, errors.New(a.textLocked("keine Datenbank geöffnet"))
	}
	events, err := a.store.AppendBatch(commands)
	if err == nil {
		candidates := make(map[string]bool)
		for _, command := range commands {
			if command.Type == "TASK_COMPLETED" {
				candidates[command.ID] = true
			}
		}
		a.cleanupCompletedPreviewsLocked(events, candidates)
	}
	return events, a.errorLocked("Änderungen konnten nicht gespeichert werden", err)
}

// Undo reverts the most recent active event.
func (a *App) Undo() ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return []eventstore.Event{}, nil
	}
	events, err := a.store.Undo()
	return events, a.errorLocked("Rückgängig fehlgeschlagen", err)
}

// Redo re-applies the most recently undone event.
func (a *App) Redo() ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return []eventstore.Event{}, nil
	}
	before, err := a.store.GetEvents()
	if err != nil {
		return nil, a.errorLocked("Wiederholen fehlgeschlagen", err)
	}
	candidates := make(map[string]bool)
	for _, event := range before {
		if event.Undone && event.Type == "TASK_COMPLETED" {
			candidates[event.ID] = true
		}
	}
	events, err := a.store.Redo()
	if err == nil {
		a.cleanupCompletedPreviewsLocked(events, candidates)
	}
	return events, a.errorLocked("Wiederholen fehlgeschlagen", err)
}
