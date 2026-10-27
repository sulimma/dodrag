package main

import (
	"fmt"
	"math"
	"strings"
	"sync/atomic"
	"unicode/utf8"
)

const (
	// Bound native resources without limiting ordinary dependency-heavy task menus.
	maxTaskMenuItems      = 4096
	maxTaskMenuIDBytes    = 256
	maxTaskMenuLabelBytes = 2048
	// Leaves ample int32 headroom after scaling by the supported window DPI.
	maxTaskMenuAnchorCoordinate = 1 << 20
)

// TaskMenuItem carries an action ID and an already translated display label.
type TaskMenuItem struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Shortcut  string `json:"shortcut,omitempty"`
	Disabled  bool   `json:"disabled"`
	Separator bool   `json:"separator,omitempty"`
}

// TaskMenuAnchor is a point in 96-DPI logical (CSS client) pixels relative to
// the owner HWND's client origin, not page, screen, or physical pixel coordinates.
type TaskMenuAnchor struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type taskMenuState struct {
	closed atomic.Bool
	busy   atomic.Bool
}

func validateTaskMenuItems(items []TaskMenuItem) error {
	if len(items) == 0 || len(items) > maxTaskMenuItems {
		return fmt.Errorf("task menu item count must be between 1 and %d", maxTaskMenuItems)
	}
	ids := make(map[string]bool, len(items))
	for i, item := range items {
		if item.Separator {
			if item.Label != "" || item.Shortcut != "" || item.Disabled {
				return fmt.Errorf("separator must not carry action fields at index %d", i)
			}
			if item.ID != "" && (strings.TrimSpace(item.ID) == "" || len(item.ID) > maxTaskMenuIDBytes || !utf8.ValidString(item.ID) || strings.ContainsRune(item.ID, 0)) {
				return fmt.Errorf("invalid separator ID at index %d", i)
			}
			continue
		}
		if strings.TrimSpace(item.ID) == "" || len(item.ID) > maxTaskMenuIDBytes || !utf8.ValidString(item.ID) || strings.ContainsRune(item.ID, 0) {
			return fmt.Errorf("invalid task menu ID at index %d", i)
		}
		if ids[item.ID] {
			return fmt.Errorf("duplicate task menu ID at index %d", i)
		}
		ids[item.ID] = true
		if strings.TrimSpace(item.Label) == "" || len(item.Label) > maxTaskMenuLabelBytes || !utf8.ValidString(item.Label) || strings.ContainsAny(item.Label, "\x00\r\n\t") {
			return fmt.Errorf("invalid task menu label at index %d", i)
		}
		if len(item.Shortcut) > maxTaskMenuIDBytes || !utf8.ValidString(item.Shortcut) || strings.ContainsAny(item.Shortcut, "\x00\r\n\t") || (item.Shortcut != "" && strings.TrimSpace(item.Shortcut) == "") {
			return fmt.Errorf("invalid task menu shortcut at index %d", i)
		}
	}
	return nil
}

// ShowTaskContextMenu returns the selected action ID, or an empty string on cancel.
// Call only in response to a user's context-menu gesture.
func (a *App) ShowTaskContextMenu(items []TaskMenuItem) (string, error) {
	return a.ShowTaskContextMenuAt(items, nil)
}

func validateTaskMenuAnchor(anchor *TaskMenuAnchor) error {
	if anchor != nil && (math.IsNaN(anchor.X) || math.IsNaN(anchor.Y) ||
		math.IsInf(anchor.X, 0) || math.IsInf(anchor.Y, 0) ||
		math.Abs(anchor.X) > maxTaskMenuAnchorCoordinate || math.Abs(anchor.Y) > maxTaskMenuAnchorCoordinate) {
		return fmt.Errorf("task menu anchor coordinates must be finite and within +/- %d", maxTaskMenuAnchorCoordinate)
	}
	return nil
}

// ShowTaskContextMenuAt supports keyboard context-menu gestures with a client
// anchor. A nil anchor preserves native cursor positioning; cancel returns "".
func (a *App) ShowTaskContextMenuAt(items []TaskMenuItem, anchor *TaskMenuAnchor) (string, error) {
	if err := validateTaskMenuItems(items); err != nil {
		return "", err
	}
	if err := validateTaskMenuAnchor(anchor); err != nil {
		return "", err
	}
	if anchor != nil {
		copy := *anchor
		anchor = &copy
	}
	return a.showTaskContextMenuNative(append([]TaskMenuItem(nil), items...), anchor)
}

func taskMenuNativeLabel(label, shortcut string) string {
	label = strings.ReplaceAll(label, "&", "&&")
	if shortcut != "" {
		// A tab gives standard Win32 menus their right-aligned shortcut column.
		label += "\t" + strings.ReplaceAll(shortcut, "&", "&&")
	}
	return label
}
