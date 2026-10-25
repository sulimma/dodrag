//go:build windows

package main

import "testing"

func TestDefaultNormalWindowRect(t *testing.T) {
	for _, tc := range []struct {
		name string
		work winRect
		dpi  uint32
		want winRect
	}{
		{"standard", winRect{Right: 1920, Bottom: 1040}, 96, winRect{Left: 240, Top: 110, Right: 1680, Bottom: 930}},
		{"150 percent", winRect{Right: 2560, Bottom: 1400}, 144, winRect{Left: 200, Top: 85, Right: 2360, Bottom: 1315}},
		{"200 percent capped", winRect{Right: 1920, Bottom: 1040}, 192, winRect{Right: 1920, Bottom: 1040}},
		{"small display", winRect{Right: 1024, Bottom: 728}, 96, winRect{Right: 1024, Bottom: 728}},
		{"negative monitor origin and top taskbar", winRect{Left: -1920, Top: 40, Bottom: 1080}, 96, winRect{Left: -1680, Top: 150, Right: -240, Bottom: 970}},
		{"invalid dpi fallback", winRect{Right: 1920, Bottom: 1040}, 0, winRect{Left: 240, Top: 110, Right: 1680, Bottom: 930}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := defaultNormalWindowRect(tc.work, tc.dpi); got != tc.want {
				t.Fatalf("bounds = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestMinimumWindowTrackSizeWorkAreaCap(t *testing.T) {
	for _, tc := range []struct {
		name string
		work winRect
		want winPoint
	}{
		{"large monitor preserves minimum", winRect{Right: 3840, Bottom: 2160}, winPoint{X: 1720, Y: 1120}},
		{"high dpi small monitor", winRect{Right: 1920, Bottom: 1040}, winPoint{X: 1720, Y: 1040}},
		{"both dimensions capped", winRect{Left: -1280, Top: 40, Bottom: 800}, winPoint{X: 1280, Y: 760}},
		{"invalid work area unchanged", winRect{}, winPoint{X: 1720, Y: 1120}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			info := winMinMaxInfo{MinTrackSize: winPoint{X: 1720, Y: 1120}, MaxTrackSize: winPoint{X: 9999, Y: 9999}}
			capMinimumWindowTrackSize(&info, tc.work)
			if info.MinTrackSize != tc.want || info.MaxTrackSize != (winPoint{X: 9999, Y: 9999}) {
				t.Fatalf("constraints = %+v, want minimum %+v and unchanged maximum", info, tc.want)
			}
		})
	}
}
