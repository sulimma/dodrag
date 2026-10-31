package main

import (
	"errors"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"time"
	"unsafe"
)

// WindowMode is runtime state, independent of content view and persisted settings.
// Geometry has one owner: Win32; activation never changes the saved placement.
type WindowMode string

const (
	WindowModeTaskbar WindowMode = "taskbar"
	WindowModeMini    WindowMode = "mini"
	WindowModeWindow  WindowMode = "window"
)

// The native minimize command advances visible foreground windows. Activation
// itself is handled by Windows without changing size or mode. A hidden/iconic
// app always restores the normal window, never the previously minimized mini.
func nextWindowMode(mode WindowMode) WindowMode {
	switch mode {
	case WindowModeWindow:
		return WindowModeMini
	case WindowModeMini:
		return WindowModeTaskbar
	default:
		return WindowModeWindow
	}
}
func nativeMinimizeTarget(mode WindowMode, foreground bool) (target WindowMode, focusOnly bool) {
	if mode != WindowModeTaskbar && !foreground {
		return mode, true
	}
	return nextWindowMode(mode), false
}
func validWindowMode(mode WindowMode) bool {
	return mode == WindowModeTaskbar || mode == WindowModeMini || mode == WindowModeWindow
}

// A read-only atomic mirror lets synchronous HWND callbacks capture the confirmed
// start mode without taking mu. Only the controller writes this mirror.
func (a *App) nativeWindowMode() WindowMode {
	switch a.nativeMode.Load() {
	case 1:
		return WindowModeMini
	case 2:
		return WindowModeTaskbar
	default:
		return WindowModeWindow
	}
}
func (a *App) storeNativeWindowMode(mode WindowMode) {
	var code uint32
	if mode == WindowModeMini {
		code = 1
	} else if mode == WindowModeTaskbar {
		code = 2
	}
	a.nativeMode.Store(code)
	a.modeRevision.Add(1)
}
func (a *App) currentWindowModeLocked() WindowMode {
	if a.windowMode != "" {
		return a.windowMode
	}
	if a.isMiniMode {
		return WindowModeMini
	}
	return WindowModeWindow
}
func (a *App) GetWindowMode() WindowMode {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.currentWindowModeLocked()
}

// modeMu queues real requests rather than discarding them with a busy flag.
// Subclass callbacks only read atomics and dispatch asynchronously; they never
// acquire mu while a synchronous Win32 operation is waiting on the window thread.
func (a *App) SetWindowMode(mode WindowMode) (WindowMode, error) {
	a.modeMu.Lock()
	defer a.modeMu.Unlock()
	return a.setWindowMode(mode)
}
func (a *App) setWindowMode(mode WindowMode) (WindowMode, error) {
	a.mu.Lock()
	old := a.currentWindowModeLocked()
	language := a.settings.UILanguage
	if !validWindowMode(mode) {
		a.mu.Unlock()
		return old, errors.New(backendText(language, "Fenstermodus konnte nicht angewendet werden"))
	}
	if old == mode {
		a.mu.Unlock()
		return old, nil
	}
	hwnd := a.ensureWindowHandleLocked()
	if hwnd == 0 {
		a.mu.Unlock()
		return old, errors.New(backendText(language, "Fenstermodus konnte nicht angewendet werden"))
	}
	// Never use the iconic sentinel rectangle as a monitor or normal placement.
	if old != WindowModeTaskbar {
		if rect, ok := getWindowRectNative(hwnd); ok {
			if mon, ok := isRectOnAnyMonitor(rect); ok {
				a.lastVisibleMonitor = mon.DeviceName
			}
		}
	}
	mon, _ := resolveMonitorOrPrimary(a.lastVisibleMonitor)
	if old == WindowModeWindow {
		var wp windowPlacement
		wp.Length = uint32(unsafe.Sizeof(wp))
		if r, _, _ := procGetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&wp))); r != 0 {
			a.savedPlacement = wp
		}
		if rect, ok := getWindowRectNative(hwnd); ok && !isWindowMinimizedNative(hwnd) {
			a.savedRect = rect
		}
		a.savedStyle = getWindowStyleNative(hwnd)
	}
	// Preserve background activation during the existing automatic mini rule.
	// User taskbar advancement already passed the foreground gate.
	activateMini := getForegroundWindowNative() == hwnd
	savedRect, savedStyle := a.savedRect, a.savedStyle
	corner, count := a.settings.DockCorner, a.lastMiniItemCount
	placement := a.savedPlacement
	a.mu.Unlock()
	// No Wails API is called under mu. Native activation does not enter this
	// geometry path; focus-only clicks preserve normal/maximized placement.
	inMiniModeAtomic.Store(mode == WindowModeMini)
	var err error
	switch mode {
	case WindowModeTaskbar:
		// Remove mini topmost even while iconic, preserving the shell button.
		procSetWindowPos.Call(hwnd, hwndNoTopMost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate)
		procShowWindow.Call(hwnd, 6)
		if !isWindowMinimizedNative(hwnd) {
			err = errors.New(backendText(language, "Fenstermodus konnte nicht angewendet werden"))
		}
	case WindowModeMini:
		_, corner = applyMiniWindowBoundsNative(hwnd, mon.DeviceName, corner, miniWidth(count), miniHeight(count), activateMini)
		err = verifyWindowGeometryNative(hwnd, language)
	case WindowModeWindow:
		// Map the saved normal geometry to the last visible monitor before restoring.
		savedRect = fitWindowRect(savedRect, mon.WorkArea)
		savedRect = restoreNormalWindowBoundsNative(hwnd, savedStyle, savedRect)
		if placement.Length != 0 {
			// WINDOWPLACEMENT is in workspace coordinates. Only pass it back to
			// SetWindowPlacement, then read screen geometry before fitting it to
			// the target monitor (including taskbars on the left/top).
			normal := placement
			normal.ShowCmd = swShowNormal
			normal.Flags &^= 2
			if result, _, placementErr := procSetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&normal))); result == 0 {
				err = placementErr
			} else if rect, ok := getWindowRectNative(hwnd); ok {
				savedRect = fitWindowRect(rect, mon.WorkArea)
				restoreNormalWindowBoundsNative(hwnd, savedStyle, savedRect)
			}
			if placement.ShowCmd == 3 {
				procShowWindow.Call(hwnd, 3)
			}
		}
		if err == nil {
			err = verifyWindowGeometryNative(hwnd, language)
		}
	}
	if err != nil {
		// A failed native transition restores a reachable normal surface; never claim
		// mini while showing the normal layout.
		inMiniModeAtomic.Store(false)
		restoreNormalWindowBoundsNative(hwnd, savedStyle, fitWindowRect(savedRect, mon.WorkArea))
		mode = WindowModeWindow
	}
	a.mu.Lock()
	a.windowMode = mode
	a.storeNativeWindowMode(mode)
	a.isMiniMode = mode == WindowModeMini
	a.unfocusedSince = time.Time{}
	a.bootMinimized = false
	a.lastVisibleMonitor = mon.DeviceName
	if mode == WindowModeMini {
		a.settings.DockMonitor = mon.DeviceName
		a.settings.DockCorner = corner
		_ = a.saveSettingsLocked()
	}
	ctx := a.ctx
	a.mu.Unlock()
	if ctx != nil {
		runtime.EventsEmit(ctx, "window:mode-changed", mode)
	}
	return mode, err
}
func miniWidth(count int) int  { w, _ := computeMiniLogicalSize(count); return w }
func miniHeight(count int) int { _, h := computeMiniLogicalSize(count); return h }

// Screen rectangles retain signed coordinates; a monitor left/above primary is valid.
func fitWindowRect(rect, work winRect) winRect {
	w, h := rect.Right-rect.Left, rect.Bottom-rect.Top
	if w <= 0 || h <= 0 {
		return defaultNormalWindowRect(work, 96)
	}
	if w > work.Right-work.Left {
		w = work.Right - work.Left
	}
	if h > work.Bottom-work.Top {
		h = work.Bottom - work.Top
	}
	x, y := rect.Left, rect.Top
	if x < work.Left {
		x = work.Left
	}
	if x+w > work.Right {
		x = work.Right - w
	}
	if y < work.Top {
		y = work.Top
	}
	if y+h > work.Bottom {
		y = work.Bottom - h
	}
	return winRect{Left: x, Top: y, Right: x + w, Bottom: y + h}
}
