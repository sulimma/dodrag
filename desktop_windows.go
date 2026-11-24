package main

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Desktop lifecycle and shell behavior are selected at build time. The shared
// app owns persistence and editor flushing; the adapter owns window handles,
// placement, desktop actions and background observation.
type desktopState struct {
	unfocusedSince        time.Time
	jumpListMu            sync.Mutex
	userDefaultUILanguage func() uint16
	registerJumpList      func(string)
	hwnd                  uintptr
	modeMu                sync.Mutex
	nativeMode            atomic.Uint32
	modeRevision          atomic.Uint64
	lastVisibleMonitor    string
	lastMiniItemCount     int
	savedStyle            uintptr
	savedRect             winRect
	savedPlacement        windowPlacement
	watchCancel           context.CancelFunc
	watchDone             chan struct{}
}

func newDesktopState() desktopState { return desktopState{lastMiniItemCount: 1} }
func desktopDockPlacement(monitor, corner string) (string, string) {
	if monitor == "" {
		return getConnectedMonitors()[0].DeviceName, "bottom-left"
	}
	resolved, _ := resolveMonitorOrPrimary(monitor)
	if corner == "" {
		corner = "bottom-left"
	}
	return resolved.DeviceName, corner
}

func (a *App) initializeDesktopLocked() {
	hwnd := a.ensureWindowHandleLocked()
	a.mu.Unlock()
	var rect winRect
	if hwnd != 0 {
		rect = applyInitialWindowBoundsNative(hwnd)
	}
	a.mu.Lock()
	if hwnd != 0 {
		a.savedRect = rect
	}
}

func (a *App) startDesktopLocked(ctx context.Context) {
	watchCtx, cancel := context.WithCancel(ctx)
	a.watchCancel = cancel
	a.watchDone = make(chan struct{})
	done := a.watchDone

	go a.refreshDesktopActions()
	go func() {
		defer close(done)
		a.watchNativeMinimize(watchCtx)
	}()
}

func (a *App) stopDesktop() {
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
	if a.currentWindowModeLocked() != WindowModeWindow || foreground {
		a.unfocusedSince = time.Time{}
		return false
	}
	if a.unfocusedSince.IsZero() {
		a.unfocusedSince = now
		return false
	}
	return now.Sub(a.unfocusedSince) >= 10*time.Minute
}

// The observer repairs monitor geometry only. Intentional taskbar minimization is
// never converted into mini. Auto-mini requests go through the frontend flush path.
func (a *App) watchNativeMinimize(ctx context.Context) {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.mu.Lock()
			hwnd := a.ensureWindowHandleLocked()
			auto := a.shouldAutoMiniLocked(time.Now(), getForegroundWindowNative() == hwnd)
			if auto {
				a.unfocusedSince = time.Now()
			}
			a.mu.Unlock()
			if auto {
				runtime.EventsEmit(ctx, "window:mode-requested", WindowModeMini, true)
			}
		}
	}
}

func (a *App) onDisplayChange() {
	a.modeMu.Lock()
	defer a.modeMu.Unlock()
	a.mu.Lock()
	mode := a.currentWindowModeLocked()
	hwnd := a.ensureWindowHandleLocked()
	monitor, corner, count := a.lastVisibleMonitor, a.settings.DockCorner, a.lastMiniItemCount
	style := a.savedStyle
	a.mu.Unlock()
	if mode == WindowModeTaskbar || hwnd == 0 {
		return
	}
	mon, _ := resolveMonitorOrPrimary(monitor)
	// Win32 may wait for the HWND thread, which needs mu to process WM_CLOSE.
	if mode == WindowModeMini {
		w, h := computeMiniLogicalSize(count)
		monitor, corner = applyMiniWindowBoundsNative(hwnd, mon.DeviceName, corner, w, h, false)
		a.mu.Lock()
		a.settings.DockMonitor, a.settings.DockCorner = monitor, corner
		a.mu.Unlock()
	} else if rect, ok := getWindowRectNative(hwnd); ok {
		if _, valid := isRectOnAnyMonitor(rect); !valid {
			restored := restoreNormalWindowBoundsNative(hwnd, style, rect)
			a.mu.Lock()
			a.savedRect = restored
			a.mu.Unlock()
		}
	}
}

func (a *App) onMiniWindowSnapped(monitorName string, corner string) {
	a.modeMu.Lock()
	defer a.modeMu.Unlock()
	a.mu.Lock()
	if a.currentWindowModeLocked() != WindowModeMini {
		a.mu.Unlock()
		return
	}
	hwnd, count := a.hwnd, a.lastMiniItemCount
	a.mu.Unlock()
	width, height := computeMiniLogicalSize(count)
	monitorName, corner = applyMiniWindowBoundsNative(hwnd, monitorName, corner, width, height, true)
	a.mu.Lock()
	a.settings.DockMonitor = monitorName
	a.settings.DockCorner = corner
	_ = a.saveSettingsLocked()
	ctx := a.ctx
	a.mu.Unlock()

	if ctx != nil {
		runtime.EventsEmit(ctx, "window:cornerChanged", corner)
	}
}

// System commands request the same frontend flush as direct mode choices.
// There is no gesture recognizer or timing heuristic: Windows activates a
// background window, and its next minimize command advances window -> mini ->
// taskbar. The iconic restore command always requests the normal window.
func (a *App) requestWindowMode(mode WindowMode) {
	a.mu.Lock()
	ctx, ready := a.ctx, a.editorReady
	a.mu.Unlock()
	if ready && ctx != nil {
		runtime.EventsEmit(ctx, "window:mode-requested", mode)
		return
	}
	_, _ = a.SetWindowMode(mode)
}

// Expected mode and revision are captured by the HWND callback before its async
// dispatch. A delayed callback cannot reinterpret a newer direct mode choice.
func (a *App) requestNativeWindowMode(target, expected WindowMode, revision uint64) {
	if a.modeRevision.Load() != revision {
		return
	}
	a.mu.Lock()
	if a.currentWindowModeLocked() != expected {
		a.mu.Unlock()
		return
	}
	ctx, ready := a.ctx, a.editorReady
	a.mu.Unlock()
	if ready && ctx != nil {
		runtime.EventsEmit(ctx, "window:mode-requested", target, false, expected)
		return
	}
	a.modeMu.Lock()
	defer a.modeMu.Unlock()
	if a.modeRevision.Load() == revision {
		_, _ = a.setWindowMode(target)
	}
}
func (a *App) triggerRestoreFromNative() { a.requestWindowMode(WindowModeWindow) }

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
		a.requestWindowMode(WindowModeMini)
	} else {
		a.triggerRestoreFromNative()
	}
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

// UpdateMiniModeHeight adjusts the compact window height (up to 4 items) while staying docked in the current corner.
func (a *App) UpdateMiniModeHeight(itemCount int) error {
	a.modeMu.Lock()
	defer a.modeMu.Unlock()
	a.mu.Lock()
	a.lastMiniItemCount = itemCount
	if a.currentWindowModeLocked() != WindowModeMini {
		a.mu.Unlock()
		return nil
	}
	hwnd := a.ensureWindowHandleLocked()
	monitor, corner := a.settings.DockMonitor, a.settings.DockCorner
	a.mu.Unlock()
	logicalW, logicalH := computeMiniLogicalSize(itemCount)
	monitor, corner = applyMiniWindowBoundsNative(hwnd, monitor, corner, logicalW, logicalH, false)
	a.mu.Lock()
	a.settings.DockMonitor, a.settings.DockCorner = monitor, corner
	a.mu.Unlock()
	return nil
}

// Serialize native registrations and read the latest setting, not a stale queued language.
func (a *App) refreshDesktopActions() {
	a.jumpListMu.Lock()
	defer a.jumpListMu.Unlock()
	language := a.currentUILanguage()
	if a.registerJumpList != nil {
		a.registerJumpList(language)
	} else {
		registerTaskbarJumpList(language)
	}
}

// The client titlebar retains Win32 resize borders and DWM shadow.
func configureDesktopWindow(config *options.App) { config.Frameless = true }
