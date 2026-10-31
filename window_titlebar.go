package main

import (
	"errors"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Client caption controls use native window operations, not taskbar cycle steps.
// In particular '_' directly requests taskbar via the shared frontend flush path;
// close posts SC_CLOSE and therefore retains Wails' existing beforeClose handshake.
func (a *App) titlebarWindow() (uintptr, error) {
	a.mu.Lock()
	hwnd := a.ensureWindowHandleLocked()
	language := a.settings.UILanguage
	a.mu.Unlock()
	if hwnd == 0 {
		return 0, errors.New(backendText(language, "Fenstermodus konnte nicht angewendet werden"))
	}
	return hwnd, nil
}
func (a *App) GetWindowMaximized() (bool, error) {
	hwnd, err := a.titlebarWindow()
	if err != nil {
		return false, err
	}
	maximized, _, _ := procIsZoomed.Call(hwnd)
	return maximized != 0, nil
}
func (a *App) ToggleWindowMaximized() error {
	a.modeMu.Lock()
	defer a.modeMu.Unlock()
	a.mu.Lock()
	ctx, normal := a.ctx, a.currentWindowModeLocked() == WindowModeWindow
	a.mu.Unlock()
	if !normal {
		return nil
	}
	if _, err := a.titlebarWindow(); err != nil {
		return err
	}
	if ctx != nil {
		runtime.WindowToggleMaximise(ctx)
	}
	return nil
}
func (a *App) postTitlebarCommand(message uint32, wparam uintptr) error {
	hwnd, err := a.titlebarWindow()
	if err != nil {
		return err
	}
	result, _, postErr := procPostMessageW.Call(hwnd, uintptr(message), wparam, 0)
	if result == 0 {
		return postErr
	}
	return nil
}
func (a *App) RequestWindowClose() error   { return a.postTitlebarCommand(wmSysCommand, scClose) }
func (a *App) ShowWindowSystemMenu() error { return a.postTitlebarCommand(wmWindowSystemMenu, 0) }
func (a *App) emitWindowMaximized() {
	a.mu.Lock()
	ctx := a.ctx
	a.mu.Unlock()
	if ctx == nil {
		return
	}
	// Query at delivery time: delayed resize callbacks must not reapply a captured
	// pre-maximize state to the titlebar after a newer native size change.
	if maximized, err := a.GetWindowMaximized(); err == nil {
		runtime.EventsEmit(ctx, "window:maximized-changed", maximized)
	}
}
