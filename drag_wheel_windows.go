//go:build windows

package main

import (
	"syscall"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	procSetWindowsHookExW = user32.NewProc("SetWindowsHookExW")
	procCallNextHookEx    = user32.NewProc("CallNextHookEx")
	procGetCurrentThread  = syscall.NewLazyDLL("kernel32.dll").NewProc("GetCurrentThreadId")
	procGetKeyState       = user32.NewProc("GetKeyState")
	procWindowFromPoint   = user32.NewProc("WindowFromPoint")
	procGetAncestor       = user32.NewProc("GetAncestor")
	procScreenToClient    = user32.NewProc("ScreenToClient")
	dragWheelHook         uintptr
	dragWheelCallbackPtr  = syscall.NewCallback(dragWheelCallback)
	dragWheelEvents       = make(chan nativeDragWheel, 64)
)

type mouseHookData struct {
	Point     winPoint
	Window    uintptr
	HitTest   uint32
	Extra     uintptr
	MouseData uint32
}

type nativeDragWheel struct {
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Delta      float64 `json:"delta"`
	Horizontal bool    `json:"horizontal"`
}

// Runs on the Wails UI thread: WH_MOUSE also observes wheel messages consumed
// by the OLE drag loop. It neither captures global input nor suppresses messages.
func installDragWheelHook(app *App) {
	if dragWheelHook != 0 {
		return
	}
	thread, _, _ := procGetCurrentThread.Call()
	hook, _, err := procSetWindowsHookExW.Call(7 /* WH_MOUSE */, dragWheelCallbackPtr, 0, thread)
	if hook == 0 {
		runtime.LogErrorf(app.ctx, "Install drag wheel hook: %v", err)
		return
	}
	dragWheelHook = hook
	go func() {
		for {
			select {
			case <-app.ctx.Done():
				return
			case event := <-dragWheelEvents:
				runtime.EventsEmit(app.ctx, "task:drag-wheel", event)
			}
		}
	}()
}

func dragWheelCallback(code int32, message uintptr, data uintptr) uintptr {
	if code == 0 /* HC_ACTION, not HC_NOREMOVE */ && (message == 0x020A || message == 0x020E) {
		leftButton, _, _ := procGetKeyState.Call(1 /* VK_LBUTTON */)
		if leftButton&0x8000 != 0 {
			mouse := (*mouseHookData)(unsafe.Pointer(data))
			// WindowFromPoint takes POINT by value on 64-bit Windows.
			packed := uintptr(uint32(mouse.Point.X)) | uintptr(uint32(mouse.Point.Y))<<32
			window, _, _ := procWindowFromPoint.Call(packed)
			root, _, _ := procGetAncestor.Call(window, 2 /* GA_ROOT */)
			if root == subclassedHWND {
				point := mouse.Point
				ok, _, _ := procScreenToClient.Call(root, uintptr(unsafe.Pointer(&point)))
				if ok != 0 {
					dpi, _, _ := procGetDpiForWindow.Call(root)
					if dpi == 0 {
						dpi = 96
					}
					event := nativeDragWheel{X: float64(point.X) * 96 / float64(dpi), Y: float64(point.Y) * 96 / float64(dpi),
						Delta: float64(int16(mouse.MouseData >> 16)), Horizontal: message == 0x020E}
					// ponytail: bounded queue; discard excess wheel input rather than stall the UI thread.
					select {
					case dragWheelEvents <- event:
					default:
					}
				}
			}
		}
	}
	result, _, _ := procCallNextHookEx.Call(0, uintptr(code), message, data)
	return result
}
