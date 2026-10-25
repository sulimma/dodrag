package main

import (
	"context"
	"dodrag/internal/eventstore"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Build-time identity, overridable via: go build -ldflags "-X main.buildVersion=0.1.5 -X main.buildTime=..."
var (
	buildVersion = "dev"
	buildTime    = ""
)

// DatabaseEntry represents a known SQLite database file on this computer.
type DatabaseEntry struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	IsDemo bool   `json:"isDemo"`
	Exists bool   `json:"exists"`
}

// SetupState describes whether the executable and its shortcuts are installed.
type SetupState struct {
	CurrentExe        string `json:"currentExe"`
	CurrentDir        string `json:"currentDir"`
	InstallPath       string `json:"installPath"`
	ProgramInstalled  bool   `json:"programInstalled"`
	DesktopShortcut   bool   `json:"desktopShortcut"`
	StartMenuShortcut bool   `json:"startMenuShortcut"`
}

// AppSettings stores known databases, the currently active database, autostart flag, and dock monitor/corner in %APPDATA%\DoDrag\settings.json.
type AppSettings struct {
	KnownDatabases     []DatabaseEntry `json:"knownDatabases"`
	ActiveDatabasePath string          `json:"activeDatabasePath"`
	Autostart          bool            `json:"autostart"`
	DockMonitor        string          `json:"dockMonitor"`
	DockCorner         string          `json:"dockCorner"`
	UILanguage         string          `json:"uiLanguage"`
	BootMinimized      bool            `json:"bootMinimized,omitempty"`
	DatabaseReady      bool            `json:"databaseReady,omitempty"`
	Version            string          `json:"version,omitempty"`
	BuildTime          string          `json:"buildTime,omitempty"`
	Setup              SetupState      `json:"setup"`
}

type persistedSettings struct {
	KnownDatabases     []DatabaseEntry `json:"knownDatabases"`
	ActiveDatabasePath string          `json:"activeDatabasePath"`
	Autostart          bool            `json:"autostart"`
	DockMonitor        string          `json:"dockMonitor"`
	DockCorner         string          `json:"dockCorner"`
	UILanguage         string          `json:"uiLanguage"`
}

// App struct binds Go methods to the Wails frontend.
type App struct {
	ctx                   context.Context
	mu                    sync.Mutex
	jumpListMu            sync.Mutex
	store                 *eventstore.Store
	appDir                string
	settingsPath          string
	demoDBPath            string
	settings              AppSettings
	settingsLoadErr       error
	settingsSaveErr       error
	userDefaultUILanguage func() uint16
	registerJumpList      func(string)
	hwnd                  uintptr
	isMiniMode            bool
	lastMiniItemCount     int
	savedStyle            uintptr
	savedRect             winRect
	savedPlacement        windowPlacement
	bootMinimized         bool
	ignoreMinimizeUntil   time.Time
	unfocusedSince        time.Time
	watchCancel           context.CancelFunc
	watchDone             chan struct{}
	taskMenus             taskMenuState
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
		bootMinimized:     bootMin,
		lastMiniItemCount: 1,
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

	if err := a.loadOrInitSettingsLocked(); err != nil {
		runtime.LogErrorf(ctx, "%s: %v", a.textLocked("Settings konnten nicht geladen werden"), err)
	} else {
		if a.settings.Autostart {
			_ = syncWindowsAutostart(true, a.settings.UILanguage)
		}
		a.openActiveDatabaseLocked()
	}
	watchCtx, cancel := context.WithCancel(ctx)
	a.watchCancel = cancel
	a.watchDone = make(chan struct{})
	done := a.watchDone
	a.mu.Unlock()

	go a.refreshJumpList()
	go func() {
		defer close(done)
		a.watchNativeMinimize(watchCtx)
	}()
}

func (a *App) ensureWindowHandleLocked() uintptr {
	if a.hwnd == 0 {
		a.hwnd = findAppWindowHandle()
	}
	if a.hwnd != 0 {
		installWindowSubclassIfNeeded(a.hwnd, a)
	}
	return a.hwnd
}

func (a *App) shouldAutoMiniLocked(now time.Time, foreground bool) bool {
	if a.isMiniMode || foreground {
		a.unfocusedSince = time.Time{}
		return false
	}
	if a.unfocusedSince.IsZero() {
		a.unfocusedSince = now
		return false
	}
	return now.Sub(a.unfocusedSince) >= 10*time.Minute
}

func (a *App) watchNativeMinimize(ctx context.Context) {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.mu.Lock()
			if ctx.Err() != nil {
				a.mu.Unlock()
				return
			}
			hwnd := a.ensureWindowHandleLocked()
			if hwnd != 0 {
				autoMini := a.shouldAutoMiniLocked(time.Now(), getForegroundWindowNative() == hwnd)
				if !a.isMiniMode {
					if isWindowMinimizedNative(hwnd) {
						if time.Now().Before(a.ignoreMinimizeUntil) {
							procShowWindow.Call(hwnd, swRestore)
							a.mu.Unlock()
							continue
						}
						a.enterMiniModeLocked(a.settings.DockCorner, a.lastMiniItemCount, true)
						a.mu.Unlock()
						runtime.EventsEmit(ctx, "window:minimized", true)
						continue
					}
					if autoMini {
						a.enterMiniModeLocked(a.settings.DockCorner, a.lastMiniItemCount, false)
						a.mu.Unlock()
						runtime.EventsEmit(ctx, "window:minimized", true)
						continue
					}
					if rect, ok := getWindowRectNative(hwnd); ok && (rect.Right-rect.Left) >= 600 && (rect.Bottom-rect.Top) >= 400 && rect.Left > -10000 && rect.Top > -10000 {
						if _, onMon := isRectOnAnyMonitor(rect); !onMon {
							// Desktop/Monitor disappeared while running in normal mode -> move onto Monitor 1
							a.savedRect = restoreNormalWindowBoundsNative(hwnd, a.savedStyle, rect)
						} else {
							a.savedRect = rect
						}
					}
					if style := getWindowStyleNative(hwnd); style != 0 && (style&wsMinimize) == 0 && (style&wsPopup) == 0 {
						a.savedStyle = style
					}
				} else if !isDraggingMini.Load() {
					// In mini mode: verify the target monitor still exists; if disconnected, switch to Monitor 1
					mon, exists := resolveMonitorOrPrimary(a.settings.DockMonitor)
					if a.settings.DockMonitor != "" && !exists {
						logicalW, logicalH := computeMiniLogicalSize(a.lastMiniItemCount)
						resolvedMon, resolvedCorner := applyMiniWindowBoundsNative(hwnd, mon.DeviceName, a.settings.DockCorner, logicalW, logicalH, false)
						a.settings.DockMonitor = resolvedMon
						a.settings.DockCorner = resolvedCorner
						_ = a.saveSettingsLocked()
					} else if rect, ok := getWindowRectNative(hwnd); ok {
						if _, onMon := isRectOnAnyMonitor(rect); !onMon {
							logicalW, logicalH := computeMiniLogicalSize(a.lastMiniItemCount)
							resolvedMon, resolvedCorner := applyMiniWindowBoundsNative(hwnd, mon.DeviceName, a.settings.DockCorner, logicalW, logicalH, false)
							a.settings.DockMonitor = resolvedMon
							a.settings.DockCorner = resolvedCorner
							_ = a.saveSettingsLocked()
						}
					}
				}
			} else {
				a.unfocusedSince = time.Time{}
			}
			a.mu.Unlock()
		}
	}
}

func (a *App) onDisplayChange() {
	a.mu.Lock()
	defer a.mu.Unlock()
	hwnd := a.ensureWindowHandleLocked()
	if hwnd == 0 {
		return
	}
	if a.isMiniMode {
		logicalW, logicalH := computeMiniLogicalSize(a.lastMiniItemCount)
		resolvedMon, resolvedCorner := applyMiniWindowBoundsNative(hwnd, a.settings.DockMonitor, a.settings.DockCorner, logicalW, logicalH, false)
		a.settings.DockMonitor = resolvedMon
		a.settings.DockCorner = resolvedCorner
		_ = a.saveSettingsLocked()
	} else if rect, ok := getWindowRectNative(hwnd); ok {
		if _, onMon := isRectOnAnyMonitor(rect); !onMon {
			a.savedRect = restoreNormalWindowBoundsNative(hwnd, a.savedStyle, rect)
		}
	}
}

func (a *App) onMiniWindowSnapped(monitorName string, corner string) {
	a.mu.Lock()
	if a.isMiniMode {
		width, height := computeMiniLogicalSize(a.lastMiniItemCount)
		monitorName, corner = applyMiniWindowBoundsNative(a.hwnd, monitorName, corner, width, height, true)
	}
	a.settings.DockMonitor = monitorName
	a.settings.DockCorner = corner
	_ = a.saveSettingsLocked()
	ctx := a.ctx
	a.mu.Unlock()

	if ctx != nil {
		runtime.EventsEmit(ctx, "window:cornerChanged", corner)
	}
}

func (a *App) triggerMinimizeFromNative() {
	a.mu.Lock()
	if a.isMiniMode {
		a.mu.Unlock()
		return
	}
	a.enterMiniModeLocked(a.settings.DockCorner, a.lastMiniItemCount, true)
	ctx := a.ctx
	a.mu.Unlock()

	if ctx != nil {
		runtime.EventsEmit(ctx, "window:minimized", true)
	}
}

func (a *App) triggerRestoreFromNative() {
	a.mu.Lock()
	if !a.isMiniMode {
		hwnd := a.ensureWindowHandleLocked()
		if hwnd != 0 {
			a.savedRect = restoreNormalWindowBoundsNative(hwnd, a.savedStyle, a.savedRect)
		}
		a.mu.Unlock()
		return
	}
	a.exitMiniModeLocked()
	ctx := a.ctx
	a.mu.Unlock()

	if ctx != nil {
		runtime.EventsEmit(ctx, "window:restored", true)
	}
}

func (a *App) onSecondInstanceLaunch(secondInstanceData options.SecondInstanceData) {
	wantMinimize := false
	for _, arg := range secondInstanceData.Args {
		trimmed := strings.TrimSpace(arg)
		if strings.EqualFold(trimmed, "--minimize") || strings.EqualFold(trimmed, "--minimized") {
			wantMinimize = true
			break
		}
	}
	if wantMinimize {
		a.triggerMinimizeFromNative()
	} else {
		a.triggerRestoreFromNative()
	}
}

func (a *App) loadOrInitSettingsLocked() (err error) {
	defer func() { a.settingsLoadErr = err }()
	a.settingsLoadErr = nil
	a.settingsSaveErr = nil
	if !validUILanguage(a.settings.UILanguage) {
		a.settings.UILanguage = "en"
	}
	monitors := getConnectedMonitors()
	primaryMonName := monitors[0].DeviceName

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
		if len(loaded.KnownDatabases) == 0 {
			loaded.KnownDatabases = []DatabaseEntry{
				{
					Name:   backendText(loaded.UILanguage, "Demo-Datenbank"),
					Path:   a.demoDBPath,
					IsDemo: true,
				},
			}
		}
		// Default is bottom-left of Monitor 1 (Primary Monitor)
		if loaded.DockMonitor == "" {
			loaded.DockMonitor = primaryMonName
			loaded.DockCorner = "bottom-left"
		} else if _, exists := resolveMonitorOrPrimary(loaded.DockMonitor); !exists {
			loaded.DockMonitor = primaryMonName
		}
		if loaded.DockCorner == "" {
			loaded.DockCorner = "bottom-left"
		}
		a.settings = AppSettings{
			KnownDatabases:     loaded.KnownDatabases,
			ActiveDatabasePath: activePath,
			Autostart:          loaded.Autostart,
			DockMonitor:        loaded.DockMonitor,
			DockCorner:         loaded.DockCorner,
			UILanguage:         loaded.UILanguage,
		}
		if migrateLanguage {
			return a.saveSettingsLocked()
		}
		return nil
	}

	// Only a missing file is first start; unreadable or invalid originals stay untouched.
	language := a.initialUILanguage()
	a.settings = AppSettings{
		KnownDatabases: []DatabaseEntry{
			{
				Name:   backendText(language, "Demo-Datenbank"),
				Path:   a.demoDBPath,
				IsDemo: true,
			},
		},
		ActiveDatabasePath: "",
		Autostart:          false,
		DockMonitor:        primaryMonName,
		DockCorner:         "bottom-left",
		UILanguage:         language,
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
		KnownDatabases:     a.settings.KnownDatabases,
		ActiveDatabasePath: a.settings.ActiveDatabasePath,
		Autostart:          a.settings.Autostart,
		DockMonitor:        a.settings.DockMonitor,
		DockCorner:         a.settings.DockCorner,
		UILanguage:         a.settings.UILanguage,
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

	_ = isDemo // Demo seeding is exclusively an explicit creation option.
	store, err := eventstore.NewStoreWithOptions(targetPath, false)
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
		DockMonitor:        a.settings.DockMonitor,
		DockCorner:         a.settings.DockCorner,
		UILanguage:         a.settings.UILanguage,
		BootMinimized:      a.bootMinimized && a.store != nil,
		DatabaseReady:      a.store != nil,
		Version:            buildVersion,
		BuildTime:          buildTime,
		Setup:              computeSetupState(),
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
	logicalW := 320
	logicalH := 28 + rows*28 + 2
	return logicalW, logicalH
}

func (a *App) enterMiniModeLocked(corner string, itemCount int, activate bool) string {
	if itemCount > 0 {
		a.lastMiniItemCount = itemCount
	}
	hwnd := a.ensureWindowHandleLocked()
	if !a.isMiniMode && hwnd != 0 {
		var placement windowPlacement
		placement.Length = uint32(unsafe.Sizeof(placement))
		if result, _, _ := procGetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&placement))); result != 0 {
			if placement.ShowCmd == 2 || placement.ShowCmd == 6 || placement.ShowCmd == 7 {
				if placement.Flags&2 != 0 {
					placement.ShowCmd = 3
				} else {
					placement.ShowCmd = swShowNormal
				}
			}
			a.savedPlacement = placement
		}
	}
	if !a.isMiniMode && hwnd != 0 && !isWindowMinimizedNative(hwnd) {
		if rect, ok := getWindowRectNative(hwnd); ok && (rect.Right-rect.Left) >= 600 && (rect.Bottom-rect.Top) >= 400 && rect.Left > -10000 && rect.Top > -10000 {
			a.savedRect = rect
		}
		if style := getWindowStyleNative(hwnd); style != 0 && (style&wsMinimize) == 0 && (style&wsPopup) == 0 {
			a.savedStyle = style
		}
	}

	if a.ctx != nil {
		runtime.WindowSetMinSize(a.ctx, 180, 48)
		// Wails' topmost setter activates the window; native positioning handles automatic entry.
		if activate {
			runtime.WindowSetAlwaysOnTop(a.ctx, true)
		}
	}

	if corner == "" {
		corner = a.settings.DockCorner
	}
	if corner == "" {
		corner = "bottom-left"
	}
	logicalW, logicalH := computeMiniLogicalSize(a.lastMiniItemCount)
	resolvedMon, resolvedCorner := applyMiniWindowBoundsNative(hwnd, a.settings.DockMonitor, corner, logicalW, logicalH, activate)
	a.isMiniMode = true
	a.unfocusedSince = time.Time{}
	a.settings.DockMonitor = resolvedMon
	a.settings.DockCorner = resolvedCorner
	_ = a.saveSettingsLocked()
	return resolvedCorner
}

// EnterMiniMode switches the window into the compact corner-docked task view.
func (a *App) EnterMiniMode(corner string, itemCount int) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	corner = a.enterMiniModeLocked(corner, itemCount, true)
	return corner, a.settingsSaveErr
}

// UpdateMiniModeHeight adjusts the compact window height (up to 4 items) while staying docked in the current corner.
func (a *App) UpdateMiniModeHeight(itemCount int) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.lastMiniItemCount = itemCount
	if !a.isMiniMode {
		return nil
	}
	hwnd := a.ensureWindowHandleLocked()
	logicalW, logicalH := computeMiniLogicalSize(itemCount)
	resolvedMon, resolvedCorner := applyMiniWindowBoundsNative(hwnd, a.settings.DockMonitor, a.settings.DockCorner, logicalW, logicalH, false)
	a.settings.DockMonitor = resolvedMon
	a.settings.DockCorner = resolvedCorner
	return nil
}

// SnapMiniWindowToNearestCorner snaps the compact window to whichever screen corner is closest after dragging.
func (a *App) SnapMiniWindowToNearestCorner(itemCount int) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.isMiniMode {
		return a.settings.DockCorner, nil
	}
	hwnd := a.ensureWindowHandleLocked()
	if rect, ok := getWindowRectNative(hwnd); ok {
		tx, ty, monName, cornerName := findNearestCornerAcrossMonitors(rect)
		physW := rect.Right - rect.Left
		physH := rect.Bottom - rect.Top
		procSetWindowPos.Call(
			hwnd,
			hwndTopMost,
			uintptr(tx),
			uintptr(ty),
			uintptr(physW),
			uintptr(physH),
			swpNoActivate|swpShowWindow,
		)
		a.settings.DockMonitor = monName
		a.settings.DockCorner = cornerName
		if err := a.saveSettingsLocked(); err != nil {
			return cornerName, err
		}
	}
	return a.settings.DockCorner, nil
}

func (a *App) exitMiniModeLocked() {
	a.isMiniMode = false
	a.unfocusedSince = time.Time{}
	a.bootMinimized = false
	a.ignoreMinimizeUntil = time.Now().Add(800 * time.Millisecond)
	hwnd := a.ensureWindowHandleLocked()

	if a.ctx != nil {
		runtime.WindowSetAlwaysOnTop(a.ctx, false)
		runtime.WindowSetMinSize(a.ctx, 860, 560)
	}

	a.savedRect = restoreNormalWindowBoundsNative(hwnd, a.savedStyle, a.savedRect)
	if a.savedPlacement.Length != 0 {
		placement := a.savedPlacement
		if _, valid := isRectOnAnyMonitor(placement.RcNormalPosition); !valid {
			placement.RcNormalPosition = a.savedRect
		}
		procSetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&placement)))
	}
}

// ExitMiniMode restores the full application window from compact corner-docked mode.
func (a *App) ExitMiniMode() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.exitMiniModeLocked()
	return nil
}

// shutdown is called when the app terminates.
func (a *App) shutdown(ctx context.Context) {
	a.closeTaskContextMenusNative()
	a.mu.Lock()
	cancel, done := a.watchCancel, a.watchDone
	a.mu.Unlock()
	if cancel != nil {
		cancel()
		<-done
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.unfocusedSince = time.Time{}
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

// SetAutostart enables or disables launching DoDrag automatically on Windows boot/login.
func (a *App) SetAutostart(enabled bool) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	if err := syncWindowsAutostart(enabled, a.settings.UILanguage); err != nil {
		return a.snapshotSettingsLocked(), err
	}
	previous := a.settings.Autostart
	a.settings.Autostart = enabled
	if err := a.saveSettingsLocked(); err != nil {
		a.settings.Autostart = previous
		rollbackErr := syncWindowsAutostart(previous, a.settings.UILanguage)
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
	a.refreshJumpList()
	return settings, nil
}

// RunSetupAction performs one installation step and returns the refreshed setup state.
func (a *App) RunSetupAction(action string) (AppSettings, error) {
	language := a.currentUILanguage()
	switch action {
	case setupActionInstall:
		installed, err := installProgram(a.ctx, language)
		if err != nil {
			settings, _ := a.GetSettings()
			return settings, err
		}
		if installed {
			a.mu.Lock()
			autostart := a.settings.Autostart
			a.mu.Unlock()
			if autostart {
				if err := syncWindowsAutostart(true, language); err != nil {
					settings, _ := a.GetSettings()
					return settings, err
				}
			}
		}
	case setupActionDesktopShortcut, setupActionStartMenuShortcut:
		resolve := desktopShortcutPath
		if action == setupActionStartMenuShortcut {
			resolve = startMenuShortcutPath
		}
		path, err := resolve()
		if err == nil {
			var target string
			target, err = installedExecutable()
			if err == nil {
				err = createShortcut(path, target, language)
			}
		}
		if err != nil {
			settings, _ := a.GetSettings()
			return settings, err
		}
	default:
		settings, _ := a.GetSettings()
		return settings, errors.New(backendText(language, "Unbekannte Installationsaktion: {action}", "action", action))
	}
	return a.GetSettings()
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
	if strings.ContainsAny(trimmedName, `<>:"/\|?*`) || trimmedName == "." || trimmedName == ".." || strings.HasSuffix(trimmedName, ".") || strings.HasSuffix(trimmedName, " ") {
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
	newStore, err := eventstore.NewStoreWithOptions(fullPath, seedDemo, func(title string) string { return a.textLocked(title) })
	if err != nil {
		os.Remove(fullPath)
		return a.snapshotSettingsLocked(), a.errorLocked("Datenbank konnte nicht angelegt werden", err)
	}

	previous := a.settings
	a.settings.KnownDatabases = append([]DatabaseEntry(nil), previous.KnownDatabases...)
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
	isDemo := strings.EqualFold(fullPath, a.demoDBPath)

	info, err := os.Stat(fullPath)
	if err != nil || info.IsDir() {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("Datenbank nicht vorhanden: {path}", "path", fullPath))
	}
	newStore, err := eventstore.NewStoreWithOptions(fullPath, false)
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
	if err := a.activateStoreLocked(newStore, previous); err != nil {
		return a.snapshotSettingsLocked(), err
	}

	return a.snapshotSettingsLocked(), nil
}

// SwitchDatabase switches the active database to dbPath.
func (a *App) SwitchDatabase(dbPath string) (AppSettings, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.settingsLoadErr != nil {
		return a.snapshotSettingsLocked(), a.settingsLoadErr
	}
	cleanTarget := filepath.Clean(dbPath)
	known := false
	for _, entry := range a.settings.KnownDatabases {
		if strings.EqualFold(filepath.Clean(entry.Path), cleanTarget) {
			known = true
			break
		}
	}
	if !known {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("Datenbank ist nicht in der Liste"))
	}
	isDemo := strings.EqualFold(cleanTarget, a.demoDBPath)
	for _, entry := range a.settings.KnownDatabases {
		if strings.EqualFold(filepath.Clean(entry.Path), cleanTarget) {
			isDemo = entry.IsDemo
			break
		}
	}

	_ = isDemo
	{
		info, statErr := os.Stat(cleanTarget)
		if statErr != nil || info.IsDir() {
			return a.snapshotSettingsLocked(), errors.New(a.textLocked("Datenbank-Datei wurde nicht gefunden (verschoben oder gelöscht): {path}", "path", cleanTarget))
		}
	}

	newStore, err := eventstore.NewStoreWithOptions(cleanTarget, false)
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
	cleanTarget := filepath.Clean(dbPath)
	known := false
	for _, entry := range a.settings.KnownDatabases {
		if strings.EqualFold(filepath.Clean(entry.Path), cleanTarget) {
			known = true
			break
		}
	}
	if !known {
		return a.snapshotSettingsLocked(), errors.New(a.textLocked("Datenbank ist nicht in der Liste"))
	}
	wasActive := strings.EqualFold(filepath.Clean(a.settings.ActiveDatabasePath), cleanTarget)

	// Close the SQLite connection first if deleting the currently active database so Windows releases the file lock
	if wasActive && a.store != nil {
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

	remaining := make([]DatabaseEntry, 0, len(a.settings.KnownDatabases))
	for _, entry := range a.settings.KnownDatabases {
		if !strings.EqualFold(filepath.Clean(entry.Path), cleanTarget) {
			remaining = append(remaining, entry)
		}
	}

	previous := a.settings
	a.settings.KnownDatabases = remaining

	if wasActive {
		// Active database was deleted -> clear selection so user chooses/creates one in Settings
		a.settings.ActiveDatabasePath = ""
	}

	if err := a.saveSettingsLocked(); err != nil {
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

func (a *App) activateStoreLocked(candidate *eventstore.Store, previous AppSettings) error {
	if _, err := candidate.GetEvents(); err != nil {
		candidate.Close()
		a.settings = previous
		return a.errorLocked("Ereignisse konnten nicht geladen werden", err)
	}
	if err := a.saveSettingsLocked(); err != nil {
		candidate.Close()
		a.settings = previous
		return err
	}
	old := a.store
	a.store = candidate
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
	events, err := a.store.GetEvents()
	return events, a.errorLocked("Ereignisse konnten nicht geladen werden", err)
}

// AppendEvent appends a new domain event to the SQLite event store and returns the updated list.
func (a *App) AppendEvent(id string, eventType string, payloadJSON string) ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return []eventstore.Event{}, errors.New(a.textLocked("keine Datenbank geöffnet"))
	}
	events, err := a.store.AppendEvent(id, eventType, payloadJSON)
	return events, a.errorLocked("Änderung konnte nicht gespeichert werden", err)
}

func (a *App) AppendBatch(commands []eventstore.Command) ([]eventstore.Event, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.store == nil {
		return nil, errors.New(a.textLocked("keine Datenbank geöffnet"))
	}
	events, err := a.store.AppendBatch(commands)
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
	events, err := a.store.Redo()
	return events, a.errorLocked("Wiederholen fehlgeschlagen", err)
}
