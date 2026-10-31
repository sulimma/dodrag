package main

import (
	"testing"
	"time"
)

func TestWindowModeCycle(t *testing.T) {
	mode := WindowModeTaskbar
	for _, want := range []WindowMode{WindowModeWindow, WindowModeMini, WindowModeTaskbar, WindowModeWindow, WindowModeMini, WindowModeTaskbar} {
		mode = nextWindowMode(mode)
		if mode != want {
			t.Fatalf("next mode = %q, want %q", mode, want)
		}
	}
}

func TestValidWindowMode(t *testing.T) {
	for _, mode := range []WindowMode{WindowModeTaskbar, WindowModeMini, WindowModeWindow} {
		if !validWindowMode(mode) {
			t.Errorf("%q must be valid", mode)
		}
	}
	for _, mode := range []WindowMode{"", "unknown", "Window", "fullscreen"} {
		if validWindowMode(mode) {
			t.Errorf("%q must be invalid", mode)
		}
	}
}

func TestFitWindowRect(t *testing.T) {
	work := winRect{Left: -1920, Top: -1080, Right: 0, Bottom: -40}
	for _, tc := range []struct {
		name       string
		rect, want winRect
	}{
		{"already on negative monitor", winRect{Left: -1800, Top: -900, Right: -800, Bottom: -200}, winRect{Left: -1800, Top: -900, Right: -800, Bottom: -200}},
		{"clamp left and top", winRect{Left: -2200, Top: -1200, Right: -1200, Bottom: -500}, winRect{Left: -1920, Top: -1080, Right: -920, Bottom: -380}},
		{"clamp right and bottom", winRect{Left: -500, Top: -400, Right: 500, Bottom: 300}, winRect{Left: -1000, Top: -740, Right: 0, Bottom: -40}},
		{"oversize", winRect{Left: -3000, Top: -1500, Right: 1000, Bottom: 500}, work},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := fitWindowRect(tc.rect, work); got != tc.want {
				t.Errorf("fit = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestAutoMiniExemptsTaskbar(t *testing.T) {
	now := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	for _, mode := range []WindowMode{WindowModeTaskbar} {
		t.Run(string(mode), func(t *testing.T) {
			a := &App{windowMode: mode, unfocusedSince: now.Add(-time.Hour)}
			if a.shouldAutoMiniLocked(now, false) {
				t.Fatal("exempt mode triggered auto-mini")
			}
			if !a.unfocusedSince.IsZero() {
				t.Fatal("exempt mode retained the unfocused timer")
			}
			if a.shouldAutoMiniLocked(now.Add(time.Hour), false) {
				t.Fatal("exempt mode triggered auto-mini after waiting")
			}
			a.windowMode = WindowModeWindow
			if a.shouldAutoMiniLocked(now.Add(time.Hour), false) {
				t.Fatal("return to window should start a fresh timer")
			}
			if !a.shouldAutoMiniLocked(now.Add(time.Hour+10*time.Minute), false) {
				t.Fatal("window should auto-mini after the new threshold")
			}
		})
	}
}

func TestWindowModeDirectChoiceIsIdempotent(t *testing.T) {
	for _, mode := range []WindowMode{WindowModeTaskbar, WindowModeMini, WindowModeWindow} {
		a := &App{windowMode: mode}
		got, err := a.SetWindowMode(mode)
		if err != nil || got != mode {
			t.Fatalf("idempotent %s: %s, %v", mode, got, err)
		}
	}
	a := &App{windowMode: WindowModeMini}
	if mode, err := a.SetWindowMode("invalid"); err == nil || mode != WindowModeMini {
		t.Fatal("invalid mode changed confirmed state")
	}
}

func TestLateMiniSnapDoesNotChangeNewerMode(t *testing.T) {
	a := &App{windowMode: WindowModeWindow}
	a.settings.DockCorner = "bottom-left"
	a.onMiniWindowSnapped("removed-monitor", "top-right")
	if a.settings.DockCorner != "bottom-left" || a.settings.DockMonitor != "" {
		t.Fatal("stale mini callback changed newer mode preferences")
	}
}

func TestNativeMinimizeFocusesBeforeChangingGeometry(t *testing.T) {
	for _, mode := range []WindowMode{WindowModeWindow, WindowModeMini} {
		target, focus := nativeMinimizeTarget(mode, false)
		if target != mode || !focus {
			t.Fatalf("background %s should only focus: %s %v", mode, target, focus)
		}
		target, focus = nativeMinimizeTarget(mode, true)
		if target != nextWindowMode(mode) || focus {
			t.Fatalf("foreground %s should advance: %s %v", mode, target, focus)
		}
	}
	target, focus := nativeMinimizeTarget(WindowModeTaskbar, false)
	if target != WindowModeWindow || focus {
		t.Fatal("taskbar should restore the foreground normal window")
	}
}
func TestLateNativeRequestDoesNotChangeNewerMode(t *testing.T) {
	a := &App{windowMode: WindowModeMini}
	a.storeNativeWindowMode(WindowModeMini)
	a.requestNativeWindowMode(WindowModeTaskbar, WindowModeWindow, 0)
	if a.GetWindowMode() != WindowModeMini {
		t.Fatal("stale revision changed mode")
	}
	a.requestNativeWindowMode(WindowModeTaskbar, WindowModeWindow, a.modeRevision.Load())
	if a.GetWindowMode() != WindowModeMini {
		t.Fatal("stale start mode changed mode")
	}
}
