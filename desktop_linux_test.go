package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLinuxDesktopCapabilities(t *testing.T) {
	previousArgs := os.Args
	os.Args = []string{"dodrag", "--minimized"}
	t.Cleanup(func() { os.Args = previousArgs })
	if NewApp().bootMinimized {
		t.Fatal("Windows-only launch flag hid the Linux window")
	}
	a := testApp(t)
	settings, err := a.GetSettings()
	if err != nil || settings.Capabilities != (DesktopCapabilities{}) {
		t.Fatalf("unsupported desktop capabilities exposed: %+v, %v", settings.Capabilities, err)
	}
	if mode, err := a.SetWindowMode(WindowModeWindow); err != nil || mode != WindowModeWindow {
		t.Fatalf("normal window unavailable: %q, %v", mode, err)
	}
	for _, mode := range []WindowMode{WindowModeMini, WindowModeTaskbar} {
		if got, err := a.SetWindowMode(mode); err == nil || got != WindowModeWindow {
			t.Fatalf("unsupported mode accepted: %q, %v", got, err)
		}
	}
	if _, err := a.SetAutostart(true); err == nil || a.settings.Autostart {
		t.Fatal("unsupported autostart changed settings")
	}
	if _, err := a.RunSetupAction("install"); err == nil {
		t.Fatal("unsupported self-install succeeded")
	}
}

func TestLinuxUILanguage(t *testing.T) {
	for locale, want := range map[string]string{
		"de_DE.UTF-8": "de", "fr_FR@euro": "fr", "uk_UA": "uk",
		"zh_TW.UTF-8": "zh-TW", "zh_HK": "zh-TW", "zh-Hant": "zh-TW",
		"zh_CN.UTF-8": "zh-CN", "pt_PT.UTF-8": "pt-BR", "C.UTF-8": "en",
		"nl_NL": "en", "ja_JP": "ja", "eo": "eo", "tok": "tok",
	} {
		if got := uiLanguageFromLocale(locale); got != want {
			t.Errorf("locale %q: got %q, want %q", locale, got, want)
		}
	}
	t.Setenv("LANG", "de_DE.UTF-8")
	t.Setenv("LC_MESSAGES", "fr_FR.UTF-8")
	t.Setenv("LC_ALL", "ja_JP.UTF-8")
	a := testApp(t)
	if got := a.initialUILanguage(); got != "ja" {
		t.Fatalf("LC_ALL did not take precedence: %q", got)
	}
	t.Setenv("LC_ALL", "")
	if got := a.initialUILanguage(); got != "fr" {
		t.Fatalf("LC_MESSAGES did not take precedence: %q", got)
	}
	t.Setenv("LC_MESSAGES", "")
	if err := a.loadOrInitSettingsLocked(); err != nil || a.settings.UILanguage != "de" {
		t.Fatalf("first start ignored LANG: %q, %v", a.settings.UILanguage, err)
	}
	if _, err := a.SetUILanguage("uk"); err != nil {
		t.Fatal(err)
	}
	if err := a.loadOrInitSettingsLocked(); err != nil || a.settings.UILanguage != "uk" {
		t.Fatalf("locale replaced saved preference: %q, %v", a.settings.UILanguage, err)
	}
	a.settingsPath = filepath.Join(a.appDir, "missing", "settings.json")
	if settings, err := a.SetUILanguage("fr"); err == nil || settings.UILanguage != "uk" {
		t.Fatalf("failed language save did not roll back: %q, %v", settings.UILanguage, err)
	}
}

func TestLinuxPreviewCacheUsesUserDirectory(t *testing.T) {
	cache := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", cache)
	if got, want := defaultPreviewCacheDirectory(), filepath.Join(cache, "DoDrag", "previews"); got != want {
		t.Fatalf("cache = %q, want %q", got, want)
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CACHE_HOME", "")
	if got, want := defaultPreviewCacheDirectory(), filepath.Join(home, ".cache", "DoDrag", "previews"); got != want {
		t.Fatalf("fallback cache = %q, want %q", got, want)
	}
}
