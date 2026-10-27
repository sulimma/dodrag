//go:build windows

package main

import (
	"errors"
	"fmt"
	"math"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

const (
	wmTaskContextMenu    = 0x8000 + 0x51
	wmEndTaskContextMenu = 0x8000 + 0x52
	wmNcDestroy          = 0x0082
	tpmReturnCmd         = 0x0100
	tpmNoNotify          = 0x0080
	tpmRightButton       = 0x0002
)

var (
	procCreatePopupMenu    = user32.NewProc("CreatePopupMenu")
	procAppendMenuW        = user32.NewProc("AppendMenuW")
	procTrackPopupMenuEx   = user32.NewProc("TrackPopupMenuEx")
	procDestroyMenu        = user32.NewProc("DestroyMenu")
	procPostMessageW       = user32.NewProc("PostMessageW")
	procEndMenu            = user32.NewProc("EndMenu")
	procClientToScreen     = user32.NewProc("ClientToScreen")
	procGetCurrentThreadID = syscall.NewLazyDLL("kernel32.dll").NewProc("GetCurrentThreadId")
	taskMenuRequests       sync.Map
	taskMenuRequestID      atomic.Uintptr
)

type taskMenuResult struct {
	id  string
	err error
}

type taskMenuRequest struct {
	app      *App
	hwnd     uintptr
	items    []TaskMenuItem
	anchor   *TaskMenuAnchor
	state    atomic.Uint32 // 0 queued, 1 running, 2 canceled
	once     sync.Once
	response chan taskMenuResult
}

func (r *taskMenuRequest) finish(id string, err error) {
	r.once.Do(func() { r.response <- taskMenuResult{id, err} })
}

func (a *App) showTaskContextMenuNative(items []TaskMenuItem, anchor *TaskMenuAnchor) (string, error) {
	if a.taskMenus.closed.Load() {
		return "", errors.New("task menu owner is shutting down")
	}
	if !a.taskMenus.busy.CompareAndSwap(false, true) {
		return "", nil
	}
	defer a.taskMenus.busy.Store(false)
	a.mu.Lock()
	hwnd := a.ensureWindowHandleLocked()
	installed := hwnd != 0 && subclassedHWND == hwnd && origWndProc.Load() != 0
	a.mu.Unlock()
	if !installed {
		return "", errors.New("task menu owner window is unavailable")
	}
	r := &taskMenuRequest{app: a, hwnd: hwnd, items: items, anchor: anchor, response: make(chan taskMenuResult, 1)}
	id := taskMenuRequestID.Add(1)
	taskMenuRequests.Store(id, r)
	defer taskMenuRequests.Delete(id)
	if a.taskMenus.closed.Load() {
		return "", errors.New("task menu owner is shutting down")
	}
	// Only an integer token crosses the asynchronous Win32 message boundary.
	// Pin the thread while deciding whether waiting would block the owner thread.
	runtime.LockOSThread()
	thread, _, _ := procGetCurrentThreadID.Call()
	ownerThread, _, _ := procGetWindowThreadProcessId.Call(hwnd, 0)
	if thread == ownerThread {
		dispatchTaskContextMenu(hwnd, id)
		runtime.UnlockOSThread()
	} else {
		runtime.UnlockOSThread()
		ok, _, err := procPostMessageW.Call(hwnd, wmTaskContextMenu, id, 0)
		if ok == 0 {
			return "", taskMenuWin32Error("PostMessageW", err)
		}
	}
	// A stalled/destroyed owner must not leave an unconsumed request queued forever.
	// Once tracking starts, however, the user may keep the menu open indefinitely.
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case result := <-r.response:
		return result.id, result.err
	case <-timer.C:
		if r.state.CompareAndSwap(0, 2) {
			return "", errors.New("task menu UI dispatch timed out")
		}
		result := <-r.response
		return result.id, result.err
	}
}

func dispatchTaskContextMenu(hwnd, id uintptr) {
	value, ok := taskMenuRequests.Load(id)
	if !ok {
		return
	}
	r := value.(*taskMenuRequest)
	if r.hwnd != hwnd || !r.state.CompareAndSwap(0, 1) {
		return
	}
	if r.app.taskMenus.closed.Load() || getForegroundWindowNative() != hwnd {
		r.finish("", nil)
		return
	}
	selected, err := trackTaskContextMenu(hwnd, r.items, r.anchor, &r.app.taskMenus)
	if r.app.taskMenus.closed.Load() {
		selected = ""
	}
	r.finish(selected, err)
}

func trackTaskContextMenu(hwnd uintptr, items []TaskMenuItem, anchor *TaskMenuAnchor, state *taskMenuState) (selected string, err error) {
	menu, _, callErr := procCreatePopupMenu.Call()
	if menu == 0 {
		return "", taskMenuWin32Error("CreatePopupMenu", callErr)
	}
	defer func() {
		ok, _, destroyErr := procDestroyMenu.Call(menu)
		if ok == 0 {
			err = errors.Join(err, taskMenuWin32Error("DestroyMenu", destroyErr))
		}
	}()
	for i, item := range items {
		if item.Separator {
			if ok, _, appendErr := procAppendMenuW.Call(menu, mfSeparator, 0, 0); ok == 0 {
				return "", taskMenuWin32Error("AppendMenuW", appendErr)
			}
			continue
		}
		label, conversionErr := syscall.UTF16FromString(taskMenuNativeLabel(item.Label, item.Shortcut))
		if conversionErr != nil {
			return "", conversionErr
		}
		flags := uintptr(mfString)
		if item.Disabled {
			flags |= mfGrayed | mfDisabled
		}
		ok, _, appendErr := procAppendMenuW.Call(menu, flags, uintptr(i+1), uintptr(unsafe.Pointer(&label[0])))
		runtime.KeepAlive(label)
		if ok == 0 {
			return "", taskMenuWin32Error("AppendMenuW", appendErr)
		}
	}
	var position winPoint
	if anchor == nil {
		if ok, _, cursorErr := procGetCursorPos.Call(uintptr(unsafe.Pointer(&position))); ok == 0 {
			return "", taskMenuWin32Error("GetCursorPos", cursorErr)
		}
	} else {
		// Resolve DPI and client origin on the owner thread at dispatch time.
		position = taskMenuClientPoint(*anchor, getWindowDPI(hwnd))
		if ok, _, conversionErr := procClientToScreen.Call(hwnd, uintptr(unsafe.Pointer(&position))); ok == 0 {
			return "", taskMenuWin32Error("ClientToScreen", conversionErr)
		}
	}
	if state.closed.Load() || getForegroundWindowNative() != hwnd {
		return "", nil
	}
	// No foreground activation or App mutex: Windows owns the modal loop
	// and positions the popup in screen coordinates, including outside the HWND.
	command, _, _ := procTrackPopupMenuEx.Call(menu, tpmReturnCmd|tpmNoNotify|tpmRightButton,
		uintptr(position.X), uintptr(position.Y), hwnd, 0)
	// Zero means cancel for TPM_RETURNCMD; GetLastError is not reliable here.
	if command == 0 {
		return "", nil
	}
	if command > uintptr(len(items)) || items[command-1].Disabled || items[command-1].Separator {
		return "", errors.New("TrackPopupMenuEx returned an invalid command")
	}
	return items[command-1].ID, nil
}

// The API bounds anchors; getWindowDPI bounds DPI to 72..480 (or fallback 96).
func taskMenuClientPoint(anchor TaskMenuAnchor, dpi uint32) winPoint {
	scale := float64(dpi) / 96
	return winPoint{X: int32(math.Round(anchor.X * scale)), Y: int32(math.Round(anchor.Y * scale))}
}

func taskMenuWin32Error(operation string, err error) error {
	if err == nil || err == syscall.Errno(0) {
		return fmt.Errorf("%s failed", operation)
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func (a *App) closeTaskContextMenusNative() {
	a.taskMenus.closed.Store(true)
	taskMenuRequests.Range(func(key, value any) bool {
		r := value.(*taskMenuRequest)
		if r.app == a {
			if r.state.Swap(2) == 1 {
				// EndMenu is thread-local: execute it in the owner's nested menu loop.
				procPostMessageW.Call(r.hwnd, wmEndTaskContextMenu, 0, 0)
			}
			r.finish("", nil)
			taskMenuRequests.Delete(key)
		}
		return true
	})
}
