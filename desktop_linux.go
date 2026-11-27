package main

import (
	"context"
	_ "embed"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed frontend/src/assets/app-icon.png
var linuxAppIcon []byte

var errDesktopFeatureUnavailable = errors.New("This desktop feature is not available on Linux")

type desktopState struct{}

func newDesktopState() desktopState            { return desktopState{} }
func desktopCapabilities() DesktopCapabilities { return DesktopCapabilities{} }
func defaultPreviewCacheDirectory() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		// Use the user's home rather than a world-writable, shared preview directory.
		dir, _ = os.UserHomeDir()
		dir = filepath.Join(dir, ".cache")
	}
	return filepath.Join(dir, "DoDrag", "previews")
}

func desktopDockPlacement(_, _ string) (string, string) { return "", "" }
func (a *App) initializeDesktopLocked()                 {}
func (a *App) startDesktopLocked(context.Context)       {}
func (a *App) stopDesktop()                             { a.closeTaskContextMenusNative() }
func (a *App) refreshDesktopActions()                   {}
func computeSetupState() SetupState                     { return SetupState{} }
func syncDesktopAutostart(bool, string) error           { return errDesktopFeatureUnavailable }
func (a *App) RunSetupAction(string) (AppSettings, error) {
	settings, _ := a.GetSettings()
	return settings, errDesktopFeatureUnavailable
}
func (a *App) GetWindowMode() WindowMode { return WindowModeWindow }
func (a *App) SetWindowMode(mode WindowMode) (WindowMode, error) {
	if mode != WindowModeWindow {
		return WindowModeWindow, errDesktopFeatureUnavailable
	}
	return WindowModeWindow, nil
}

func configureDesktopWindow(config *options.App) {
	config.Linux = &linux.Options{Icon: linuxAppIcon, ProgramName: "dodrag", WebviewGpuPolicy: linux.WebviewGpuPolicyNever}
}

// The WM owns minimization. A second launch only restores the existing window,
// regardless of Windows-only arguments.
func (a *App) onSecondInstanceLaunch(_ options.SecondInstanceData) {
	a.mu.Lock()
	ctx := a.ctx
	a.mu.Unlock()
	if ctx != nil {
		runtime.WindowUnminimise(ctx)
		runtime.WindowShow(ctx)
	}
}

func (a *App) initialUILanguage() string {
	for _, key := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if value := os.Getenv(key); value != "" {
			return uiLanguageFromLocale(value)
		}
	}
	return "en"
}

func uiLanguageFromLocale(locale string) string {
	tag, _, _ := strings.Cut(locale, ".")
	tag, _, _ = strings.Cut(tag, "@")
	primary, region, _ := strings.Cut(strings.ReplaceAll(tag, "_", "-"), "-")
	switch strings.ToLower(primary) {
	case "zh":
		switch strings.ToUpper(region) {
		case "TW", "HK", "MO", "HANT":
			return "zh-TW"
		default:
			return "zh-CN"
		}
	case "pt":
		return "pt-BR"
	default:
		if lang := strings.ToLower(primary); validUILanguage(lang) {
			return lang
		}
		return "en"
	}
}
