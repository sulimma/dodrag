//go:build windows && amd64

package main

import (
	"testing"
	"unsafe"
)

func TestMouseHookDataMatchesWindowsABI(t *testing.T) {
	var data mouseHookData
	if unsafe.Offsetof(data.Window) != 8 || unsafe.Offsetof(data.HitTest) != 16 ||
		unsafe.Offsetof(data.Extra) != 24 || unsafe.Offsetof(data.MouseData) != 32 || unsafe.Sizeof(data) != 40 {
		t.Fatal("MOUSEHOOKSTRUCTEX layout does not match Windows amd64")
	}
}
