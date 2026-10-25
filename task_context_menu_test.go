package main

import (
	"strconv"
	"strings"
	"testing"
)

func TestValidateTaskMenuItems(t *testing.T) {
	valid := []TaskMenuItem{{ID: "edit", Label: "Bearbeiten & Details", Shortcut: "F2"}, {ID: "delete", Label: "Supprimer", Disabled: true}}
	if err := validateTaskMenuItems(valid); err != nil {
		t.Fatal(err)
	}
	cases := map[string][]TaskMenuItem{
		"empty":                  nil,
		"too many":               make([]TaskMenuItem, maxTaskMenuItems+1),
		"empty ID":               {{Label: "Edit"}},
		"blank ID":               {{ID: "  ", Label: "Edit"}},
		"duplicate":              {{ID: "edit", Label: "Edit"}, {ID: "edit", Label: "Other", Disabled: true}},
		"long ID":                {{ID: strings.Repeat("a", maxTaskMenuIDBytes+1), Label: "Edit"}},
		"NUL ID":                 {{ID: "a\x00b", Label: "Edit"}},
		"invalid UTF-8 ID":       {{ID: "\xff", Label: "Edit"}},
		"empty label":            {{ID: "edit"}},
		"blank label":            {{ID: "edit", Label: "  "}},
		"long label":             {{ID: "edit", Label: strings.Repeat("a", maxTaskMenuLabelBytes+1)}},
		"NUL label":              {{ID: "edit", Label: "a\x00b"}},
		"multiline label":        {{ID: "edit", Label: "a\nb"}},
		"tab label":              {{ID: "edit", Label: "a\tb"}},
		"invalid UTF-8 label":    {{ID: "edit", Label: "\xff"}},
		"long shortcut":          {{ID: "edit", Label: "Edit", Shortcut: strings.Repeat("a", maxTaskMenuIDBytes+1)}},
		"blank shortcut":         {{ID: "edit", Label: "Edit", Shortcut: " "}},
		"NUL shortcut":           {{ID: "edit", Label: "Edit", Shortcut: "a\x00b"}},
		"multiline shortcut":     {{ID: "edit", Label: "Edit", Shortcut: "a\nb"}},
		"tab shortcut":           {{ID: "edit", Label: "Edit", Shortcut: "a\tb"}},
		"invalid UTF-8 shortcut": {{ID: "edit", Label: "Edit", Shortcut: "\xff"}},
	}
	for name, items := range cases {
		t.Run(name, func(t *testing.T) {
			if err := validateTaskMenuItems(items); err == nil {
				t.Fatal("expected validation error")
			}
			if _, err := (&App{}).ShowTaskContextMenu(items); err == nil {
				t.Fatal("API must reject invalid input before native calls")
			}
		})
	}
	boundary := make([]TaskMenuItem, maxTaskMenuItems)
	for i := range boundary {
		id := strconv.Itoa(i)
		boundary[i] = TaskMenuItem{ID: id + strings.Repeat("a", maxTaskMenuIDBytes-len(id)), Label: strings.Repeat("a", maxTaskMenuLabelBytes)}
	}
	if err := validateTaskMenuItems(boundary); err != nil {
		t.Fatal(err)
	}
}

func TestTaskMenuNativeLabel(t *testing.T) {
	for input, want := range map[string]string{"Edit": "Edit", "A & B": "A && B", "&&&": "&&&&&&", "日本語": "日本語"} {
		if got := taskMenuNativeLabel(input, ""); got != want {
			t.Errorf("%q: got %q, want %q", input, got, want)
		}
	}
	if got := taskMenuNativeLabel("A & B", "Ctrl+&"); got != "A && B\tCtrl+&&" {
		t.Fatalf("shortcut column: got %q", got)
	}
}
