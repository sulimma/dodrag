//go:build windows

package main

import (
	"os"
	"syscall"
	"unsafe"
)

var (
	user32                       = syscall.NewLazyDLL("user32.dll")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
	procGetWindowRect            = user32.NewProc("GetWindowRect")
	procGetWindowLongPtrW        = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW        = user32.NewProc("SetWindowLongPtrW")
	procSetWindowPos             = user32.NewProc("SetWindowPos")
	procSystemParametersInfoW    = user32.NewProc("SystemParametersInfoW")
	procGetDpiForWindow          = user32.NewProc("GetDpiForWindow")
	procIsIconic                 = user32.NewProc("IsIconic")
	procShowWindow               = user32.NewProc("ShowWindow")
	procSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
)

const (
	gwlStyle        = ^uintptr(15) // -16
	wsCaption       = 0x00C00000
	wsThickFrame    = 0x00040000
	wsMinimizeBox   = 0x00020000
	wsMaximizeBox   = 0x00010000
	wsSysMenu       = 0x00080000
	wsPopup         = 0x80000000
	wsVisible       = 0x10000000
	spiGetWorkArea  = 0x0030
	swpFrameChanged = 0x0020
	swpShowWindow   = 0x0040
	swRestore       = 9
)

var (
	hwndTopMost   = ^uintptr(0) // -1 (HWND_TOPMOST)
	hwndNoTopMost = ^uintptr(1) // -2 (HWND_NOTOPMOST)
)

type winRect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

func findAppWindowHandle() uintptr {
	currentPID := uint32(os.Getpid())
	var foundHWND uintptr

	cb := syscall.NewCallback(func(hwnd uintptr, lparam uintptr) uintptr {
		var pid uint32
		procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
		if pid == currentPID {
			vis, _, _ := procIsWindowVisible.Call(hwnd)
			if vis != 0 {
				var r winRect
				procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
				if (r.Right-r.Left) > 50 && (r.Bottom-r.Top) > 30 {
					foundHWND = hwnd
					return 0 // stop enumeration
				}
			}
		}
		return 1 // continue
	})

	procEnumWindows.Call(cb, 0)
	return foundHWND
}

func getWindowDPI(hwnd uintptr) uint32 {
	if hwnd != 0 && procGetDpiForWindow.Find() == nil {
		dpi, _, _ := procGetDpiForWindow.Call(hwnd)
		if dpi >= 72 && dpi <= 480 {
			return uint32(dpi)
		}
	}
	return 96
}

func getPrimaryWorkArea() winRect {
	var rc winRect
	ret, _, _ := procSystemParametersInfoW.Call(
		spiGetWorkArea,
		0,
		uintptr(unsafe.Pointer(&rc)),
		0,
	)
	if ret == 0 || rc.Right <= rc.Left || rc.Bottom <= rc.Top {
		return winRect{Left: 0, Top: 0, Right: 1920, Bottom: 1040}
	}
	return rc
}

func isWindowMinimizedNative(hwnd uintptr) bool {
	if hwnd == 0 {
		return false
	}
	ret, _, _ := procIsIconic.Call(hwnd)
	return ret != 0
}

func getWindowRectNative(hwnd uintptr) (winRect, bool) {
	var r winRect
	if hwnd == 0 {
		return r, false
	}
	ret, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	return r, ret != 0
}

func getWindowStyleNative(hwnd uintptr) uintptr {
	if hwnd == 0 {
		return 0
	}
	style, _, _ := procGetWindowLongPtrW.Call(hwnd, gwlStyle)
	return style
}

func applyMiniWindowBoundsNative(hwnd uintptr, corner string, logicalW int, logicalH int) string {
	if hwnd == 0 {
		return corner
	}

	if isWindowMinimizedNative(hwnd) {
		procShowWindow.Call(hwnd, swRestore)
	}

	work := getPrimaryWorkArea()
	dpi := getWindowDPI(hwnd)
	scale := float64(dpi) / 96.0

	physW := int32(float64(logicalW) * scale)
	physH := int32(float64(logicalH) * scale)
	margin := int32(8.0 * scale)

	if corner == "nearest" || corner == "" {
		if curRect, ok := getWindowRectNative(hwnd); ok {
			cx := (curRect.Left + curRect.Right) / 2
			cy := (curRect.Top + curRect.Bottom) / 2
			midX := (work.Left + work.Right) / 2
			midY := (work.Top + work.Bottom) / 2
			if cy < midY {
				if cx < midX {
					corner = "top-left"
				} else {
					corner = "top-right"
				}
			} else {
				if cx < midX {
					corner = "bottom-left"
				} else {
					corner = "bottom-right"
				}
			}
		} else {
			corner = "bottom-right"
		}
	}

	var x, y int32
	switch corner {
	case "top-left":
		x = work.Left + margin
		y = work.Top + margin
	case "top-right":
		x = work.Right - physW - margin
		y = work.Top + margin
	case "bottom-left":
		x = work.Left + margin
		y = work.Bottom - physH - margin
	default:
		corner = "bottom-right"
		x = work.Right - physW - margin
		y = work.Bottom - physH - margin
	}

	// Switch to frameless compact popup style so no native titlebar wastes space
	style := getWindowStyleNative(hwnd)
	if style != 0 {
		framelessStyle := (style &^ (wsCaption | wsThickFrame | wsMinimizeBox | wsMaximizeBox | wsSysMenu)) | wsPopup | wsVisible
		procSetWindowLongPtrW.Call(hwnd, gwlStyle, framelessStyle)
	}

	procSetWindowPos.Call(
		hwnd,
		hwndTopMost,
		uintptr(x),
		uintptr(y),
		uintptr(physW),
		uintptr(physH),
		swpFrameChanged|swpShowWindow,
	)

	return corner
}

func restoreNormalWindowBoundsNative(hwnd uintptr, savedStyle uintptr, savedRect winRect) {
	if hwnd == 0 {
		return
	}

	if isWindowMinimizedNative(hwnd) {
		procShowWindow.Call(hwnd, swRestore)
	}

	if savedStyle != 0 {
		procSetWindowLongPtrW.Call(hwnd, gwlStyle, savedStyle|wsVisible)
	}

	w := savedRect.Right - savedRect.Left
	h := savedRect.Bottom - savedRect.Top
	if w < 600 || h < 400 {
		work := getPrimaryWorkArea()
		w = 1180
		h = 820
		savedRect.Left = (work.Left + work.Right - w) / 2
		savedRect.Top = (work.Top + work.Bottom - h) / 2
	}

	procSetWindowPos.Call(
		hwnd,
		hwndNoTopMost,
		uintptr(savedRect.Left),
		uintptr(savedRect.Top),
		uintptr(w),
		uintptr(h),
		swpFrameChanged|swpShowWindow,
	)
	procSetForegroundWindow.Call(hwnd)
}
