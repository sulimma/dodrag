//go:build windows

package main

import (
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"
)

var (
	user32                       = syscall.NewLazyDLL("user32.dll")
	shcore                       = syscall.NewLazyDLL("shcore.dll")
	ole32                        = syscall.NewLazyDLL("ole32.dll")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
	procGetWindowRect            = user32.NewProc("GetWindowRect")
	procGetWindowLongPtrW        = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW        = user32.NewProc("SetWindowLongPtrW")
	procCallWindowProcW          = user32.NewProc("CallWindowProcW")
	procSetWindowPos             = user32.NewProc("SetWindowPos")
	procSetWindowPlacement       = user32.NewProc("SetWindowPlacement")
	procGetWindowPlacement       = user32.NewProc("GetWindowPlacement")
	procSystemParametersInfoW    = user32.NewProc("SystemParametersInfoW")
	procGetDpiForWindow          = user32.NewProc("GetDpiForWindow")
	procIsIconic                 = user32.NewProc("IsIconic")
	procShowWindow               = user32.NewProc("ShowWindow")
	procSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procGetClassNameW            = user32.NewProc("GetClassNameW")
	procEnumDisplayMonitors      = user32.NewProc("EnumDisplayMonitors")
	procGetMonitorInfoW          = user32.NewProc("GetMonitorInfoW")
	procGetCursorPos             = user32.NewProc("GetCursorPos")
	procGetSystemMenu            = user32.NewProc("GetSystemMenu")
	procEnableMenuItem           = user32.NewProc("EnableMenuItem")
	procInsertMenuW              = user32.NewProc("InsertMenuW")
	procModifyMenuW              = user32.NewProc("ModifyMenuW")
	procGetDpiForMonitor         = shcore.NewProc("GetDpiForMonitor")
	procCoInitializeEx           = ole32.NewProc("CoInitializeEx")
	procCoUninitialize           = ole32.NewProc("CoUninitialize")
	procCoCreateInstance         = ole32.NewProc("CoCreateInstance")
)

const (
	gwlStyle           = ^uintptr(15) // -16 (GWL_STYLE)
	gwlpWndProc        = ^uintptr(3)  // -4  (GWLP_WNDPROC)
	wsCaption          = 0x00C00000
	wsThickFrame       = 0x00040000
	wsMinimizeBox      = 0x00020000
	wsMaximizeBox      = 0x00010000
	wsSysMenu          = 0x00080000
	wsPopup            = 0x80000000
	wsVisible          = 0x10000000
	wsMinimize         = 0x20000000
	wsMaximize         = 0x01000000
	wsOverlappedWindow = wsCaption | wsSysMenu | wsThickFrame | wsMinimizeBox | wsMaximizeBox
	spiGetWorkArea     = 0x0030
	swpNoSize          = 0x0001
	swpNoMove          = 0x0002
	swpNoZOrder        = 0x0004
	swpNoActivate      = 0x0010
	swpFrameChanged    = 0x0020
	swpShowWindow      = 0x0040
	swShowNormal       = 1
	swRestore          = 9

	wmSize            = 0x0005
	wmDisplayChange   = 0x007E
	wmNcCalcSize      = 0x0083
	wmSysCommand      = 0x0112
	wmInitMenuPopup   = 0x0117
	wmMoving          = 0x0216
	wmEnterSizeMove   = 0x0231
	wmExitSizeMove    = 0x0232
	wmDpiChanged      = 0x02E0
	wmPopupSystemMenu = 0x0313

	scSize     = 0xF000
	scMove     = 0xF010
	scMinimize = 0xF020
	scMaximize = 0xF030
	scClose    = 0xF060
	scRestore  = 0xF120

	sysMenuRestoreID  = 0x1001
	sysMenuMinimizeID = 0x1002

	wmMouseActivate = 0x0021
	maActivate      = 1

	mfByCommand  = 0x00000000
	mfByPosition = 0x00000400
	mfString     = 0x00000000
	mfSeparator  = 0x00000800
	mfEnabled    = 0x00000000
	mfGrayed     = 0x00000001
	mfDisabled   = 0x00000002

	monitorInfoFPrimary = 0x00000001
	mdtEffectiveDPI     = 0
)

var (
	hwndTopMost   = ^uintptr(0) // -1 (HWND_TOPMOST)
	hwndNoTopMost = ^uintptr(1) // -2 (HWND_NOTOPMOST)
)

type winPoint struct {
	X int32
	Y int32
}

type winRect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type windowPlacement struct {
	Length           uint32
	Flags            uint32
	ShowCmd          uint32
	PtMinPosition    winPoint
	PtMaxPosition    winPoint
	RcNormalPosition winRect
}

type monitorInfoExW struct {
	CbSize    uint32
	RcMonitor winRect
	RcWork    winRect
	DwFlags   uint32
	SzDevice  [32]uint16
}

type desktopMonitor struct {
	DeviceName  string
	WorkArea    winRect
	MonitorArea winRect
	IsPrimary   bool
	DPI         uint32
}

var (
	inMiniModeAtomic    atomic.Bool
	subclassedHWND      uintptr
	origWndProc         atomic.Uintptr
	appInstanceForHooks atomic.Pointer[App]

	// UI-thread drag state for magnetic corner snapping
	isDraggingMini     atomic.Bool
	dragOffsetX        int32
	dragOffsetY        int32
	isCurrentlySnapped bool
	snappedMonitorName string
	snappedCornerName  string

	subclassWndProcPtr uintptr
	enumMonitorsCbPtr  = syscall.NewCallback(enumMonitorsCallback)
	monitorCalls       sync.Map
	monitorCallID      atomic.Uintptr
)

func enumMonitorsCallback(hMonitor uintptr, hdcMonitor uintptr, lprcMonitor uintptr, dwData uintptr) uintptr {
	value, ok := monitorCalls.Load(dwData)
	if !ok {
		return 0
	}
	collectedMonitors := value.(*[]desktopMonitor)
	var mi monitorInfoExW
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	ret, _, _ := procGetMonitorInfoW.Call(hMonitor, uintptr(unsafe.Pointer(&mi)))
	if ret != 0 {
		dpi := uint32(96)
		if procGetDpiForMonitor.Find() == nil {
			var dpiX, dpiY uint32
			hr, _, _ := procGetDpiForMonitor.Call(
				hMonitor,
				mdtEffectiveDPI,
				uintptr(unsafe.Pointer(&dpiX)),
				uintptr(unsafe.Pointer(&dpiY)),
			)
			if hr == 0 && dpiX >= 72 && dpiX <= 480 {
				dpi = dpiX
			}
		}
		devName := syscall.UTF16ToString(mi.SzDevice[:])
		isPrimary := (mi.DwFlags & monitorInfoFPrimary) != 0
		mon := desktopMonitor{
			DeviceName:  devName,
			WorkArea:    mi.RcWork,
			MonitorArea: mi.RcMonitor,
			IsPrimary:   isPrimary,
			DPI:         dpi,
		}
		if isPrimary {
			// Ensure Monitor 1 (Primary Monitor) is always first (index 0)
			*collectedMonitors = append([]desktopMonitor{mon}, (*collectedMonitors)...)
		} else {
			*collectedMonitors = append(*collectedMonitors, mon)
		}
	}
	return 1 // continue enumeration
}

func getConnectedMonitors() []desktopMonitor {
	var collectedMonitors []desktopMonitor
	id := monitorCallID.Add(1)
	monitorCalls.Store(id, &collectedMonitors)
	defer monitorCalls.Delete(id)
	procEnumDisplayMonitors.Call(0, 0, enumMonitorsCbPtr, id)
	if len(collectedMonitors) == 0 {
		work := getPrimaryWorkArea()
		return []desktopMonitor{
			{
				DeviceName:  "PRIMARY",
				WorkArea:    work,
				MonitorArea: work,
				IsPrimary:   true,
				DPI:         96,
			},
		}
	}
	return append([]desktopMonitor(nil), collectedMonitors...)
}

// resolveMonitorOrPrimary finds the requested monitor by device name, or falls back to Monitor 1 (Primary Monitor) if it does not exist.
func resolveMonitorOrPrimary(deviceName string) (desktopMonitor, bool) {
	monitors := getConnectedMonitors()
	trimmed := strings.TrimSpace(deviceName)
	if trimmed != "" {
		for _, m := range monitors {
			if strings.EqualFold(m.DeviceName, trimmed) {
				return m, true
			}
		}
	}
	return monitors[0], false
}

// isRectOnAnyMonitor checks if the center point of r lies within any currently connected monitor.
func isRectOnAnyMonitor(r winRect) (desktopMonitor, bool) {
	w := r.Right - r.Left
	h := r.Bottom - r.Top
	if w < 100 || h < 40 || r.Left < -10000 || r.Top < -10000 {
		monitors := getConnectedMonitors()
		return monitors[0], false
	}
	cx := (r.Left + r.Right) / 2
	cy := (r.Top + r.Bottom) / 2
	monitors := getConnectedMonitors()
	for _, m := range monitors {
		if cx >= m.MonitorArea.Left && cx <= m.MonitorArea.Right &&
			cy >= m.MonitorArea.Top && cy <= m.MonitorArea.Bottom {
			return m, true
		}
	}
	return monitors[0], false
}

func abs32(v int32) int32 {
	if v < 0 {
		return -v
	}
	return v
}

// computeCornerPosition returns the exact flush (0px margin) coordinates for a corner of workArea.
func computeCornerPosition(work winRect, corner string, physW int32, physH int32) (int32, int32, string) {
	switch corner {
	case "top-left":
		return work.Left, work.Top, "top-left"
	case "top-right":
		return work.Right - physW, work.Top, "top-right"
	case "bottom-right":
		return work.Right - physW, work.Bottom - physH, "bottom-right"
	default:
		return work.Left, work.Bottom - physH, "bottom-left"
	}
}

// findMagneticSnapCorner checks if (freeLeft, freeTop) is within snapThreshold of any corner of any connected monitor.
func findMagneticSnapCorner(freeLeft int32, freeTop int32, physW int32, physH int32) (bool, int32, int32, string, string) {
	monitors := getConnectedMonitors()
	corners := []string{"bottom-left", "top-left", "top-right", "bottom-right"}

	var bestDist int32 = 0x7FFFFFFF
	var found bool
	var bestX, bestY int32
	var bestMon, bestCorner string

	for _, m := range monitors {
		scale := float64(m.DPI) / 96.0
		if scale < 1.0 {
			scale = 1.0
		}
		threshold := int32(120.0 * scale)

		for _, c := range corners {
			tx, ty, resolvedC := computeCornerPosition(m.WorkArea, c, physW, physH)
			dx := abs32(freeLeft - tx)
			dy := abs32(freeTop - ty)
			if dx <= threshold && dy <= threshold {
				dist := dx + dy
				if dist < bestDist {
					bestDist = dist
					found = true
					bestX = tx
					bestY = ty
					bestMon = m.DeviceName
					bestCorner = resolvedC
				}
			}
		}
	}

	return found, bestX, bestY, bestMon, bestCorner
}

// findNearestCornerAcrossMonitors finds the closest corner of whichever connected monitor contains (or is closest to) the rect center.
func findNearestCornerAcrossMonitors(r winRect) (int32, int32, string, string) {
	monitors := getConnectedMonitors()
	physW := r.Right - r.Left
	physH := r.Bottom - r.Top
	cx := (r.Left + r.Right) / 2
	cy := (r.Top + r.Bottom) / 2

	targetMon := monitors[0]
	for _, m := range monitors {
		if cx >= m.MonitorArea.Left && cx <= m.MonitorArea.Right &&
			cy >= m.MonitorArea.Top && cy <= m.MonitorArea.Bottom {
			targetMon = m
			break
		}
	}

	midX := (targetMon.WorkArea.Left + targetMon.WorkArea.Right) / 2
	midY := (targetMon.WorkArea.Top + targetMon.WorkArea.Bottom) / 2

	var corner string
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

	tx, ty, resolvedC := computeCornerPosition(targetMon.WorkArea, corner, physW, physH)
	return tx, ty, targetMon.DeviceName, resolvedC
}

func ensureSystemMenuItems(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	hMenu, _, _ := procGetSystemMenu.Call(hwnd, 0)
	if hMenu == 0 {
		return
	}
	updateTaskbarSystemMenu(hwnd, inMiniModeAtomic.Load())
}

func updateTaskbarSystemMenu(hwnd uintptr, isMini bool) {
	if hwnd == 0 {
		return
	}
	hMenu, _, _ := procGetSystemMenu.Call(hwnd, 0)
	if hMenu == 0 {
		return
	}
	if isMini {
		procEnableMenuItem.Call(hMenu, scRestore, mfByCommand|mfEnabled)
		procEnableMenuItem.Call(hMenu, scMinimize, mfByCommand|mfGrayed)
	} else {
		procEnableMenuItem.Call(hMenu, scRestore, mfByCommand|mfGrayed)
		procEnableMenuItem.Call(hMenu, scMinimize, mfByCommand|mfEnabled)
	}
}

func installWindowSubclassIfNeeded(hwnd uintptr, app *App) {
	if hwnd == 0 {
		return
	}
	appInstanceForHooks.Store(app)
	if subclassedHWND == hwnd && origWndProc.Load() != 0 {
		return
	}
	if subclassWndProcPtr == 0 {
		subclassWndProcPtr = syscall.NewCallback(subclassWndProc)
	}
	prev, _, _ := procSetWindowLongPtrW.Call(hwnd, gwlpWndProc, subclassWndProcPtr)
	if prev != 0 {
		origWndProc.Store(prev)
		subclassedHWND = hwnd
		ensureSystemMenuItems(hwnd)
	}
}

func subclassWndProc(hwnd uintptr, msg uint32, wparam uintptr, lparam uintptr) uintptr {
	app := appInstanceForHooks.Load()
	switch msg {
	case wmTaskContextMenu:
		dispatchTaskContextMenu(hwnd, wparam)
		return 0

	case wmEndTaskContextMenu:
		if app != nil && app.taskMenus.closed.Load() {
			procEndMenu.Call()
		}
		return 0

	case wmNcDestroy:
		if app != nil {
			app.closeTaskContextMenusNative()
			// A posted message can no longer reach an HWND being destroyed.
			procEndMenu.Call()
		}

	case wmNcCalcSize:
		if inMiniModeAtomic.Load() {
			// Frameless 100% client area in mini mode with 0px invisible border
			return 0
		}

	case wmDpiChanged:
		if inMiniModeAtomic.Load() {
			// Recompute logical mini dimensions after Wails' DPI handling is suppressed.
			if app != nil {
				go app.onDisplayChange()
			}
			return 0
		}

	case wmMouseActivate:
		if inMiniModeAtomic.Load() {
			// The mini window is docked with SWP_NOACTIVATE and stays inactive; an inactive
			// host drops mouse buttons, including right-clicks, before WebView2 delivers them.
			procSetForegroundWindow.Call(hwnd)
			return maActivate
		}

	case wmInitMenuPopup, wmPopupSystemMenu:
		ret, _, _ := procCallWindowProcW.Call(origWndProc.Load(), hwnd, uintptr(msg), wparam, lparam)
		updateTaskbarSystemMenu(hwnd, inMiniModeAtomic.Load())
		return ret

	case wmSysCommand:
		cmd := wparam & 0xFFF0
		if cmd == scMinimize || wparam == sysMenuMinimizeID {
			if !inMiniModeAtomic.Load() && app != nil {
				go app.triggerMinimizeFromNative()
			}
			return 0
		}
		if cmd == scRestore || wparam == sysMenuRestoreID {
			if inMiniModeAtomic.Load() && app != nil {
				go app.triggerRestoreFromNative()
				return 0
			}
		}

	case wmEnterSizeMove:
		if inMiniModeAtomic.Load() {
			var pt winPoint
			procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
			if r, ok := getWindowRectNative(hwnd); ok {
				dragOffsetX = pt.X - r.Left
				dragOffsetY = pt.Y - r.Top
				isDraggingMini.Store(true)
				isCurrentlySnapped = false
			}
		}

	case wmMoving:
		if inMiniModeAtomic.Load() && isDraggingMini.Load() && lparam != 0 {
			r := (*winRect)(unsafe.Pointer(lparam))
			physW := r.Right - r.Left
			physH := r.Bottom - r.Top
			var pt winPoint
			procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
			freeLeft := pt.X - dragOffsetX
			freeTop := pt.Y - dragOffsetY

			if ok, tx, ty, monName, cornerName := findMagneticSnapCorner(freeLeft, freeTop, physW, physH); ok {
				r.Left = tx
				r.Top = ty
				r.Right = tx + physW
				r.Bottom = ty + physH
				isCurrentlySnapped = true
				snappedMonitorName = monName
				snappedCornerName = cornerName
			} else {
				r.Left = freeLeft
				r.Top = freeTop
				r.Right = freeLeft + physW
				r.Bottom = freeTop + physH
				isCurrentlySnapped = false
			}
			return 1
		}

	case wmExitSizeMove:
		if inMiniModeAtomic.Load() && isDraggingMini.Load() {
			isDraggingMini.Store(false)
			if isCurrentlySnapped && snappedCornerName != "" {
				monName := snappedMonitorName
				cornerName := snappedCornerName
				if app != nil {
					go app.onMiniWindowSnapped(monName, cornerName)
				}
			} else if r, ok := getWindowRectNative(hwnd); ok {
				tx, ty, monName, cornerName := findNearestCornerAcrossMonitors(r)
				physW := r.Right - r.Left
				physH := r.Bottom - r.Top
				procSetWindowPos.Call(
					hwnd,
					hwndTopMost,
					uintptr(tx),
					uintptr(ty),
					uintptr(physW),
					uintptr(physH),
					swpNoActivate|swpShowWindow,
				)
				if app != nil {
					go app.onMiniWindowSnapped(monName, cornerName)
				}
			}
		}

	case wmDisplayChange:
		if app != nil {
			go app.onDisplayChange()
		}
	}

	if origWndProc.Load() != 0 {
		ret, _, _ := procCallWindowProcW.Call(origWndProc.Load(), hwnd, uintptr(msg), wparam, lparam)
		return ret
	}
	return 0
}

func findAppWindowHandle() uintptr {
	currentPID := uint32(os.Getpid())
	var foundHWND uintptr

	cb := syscall.NewCallback(func(hwnd uintptr, lparam uintptr) uintptr {
		var pid uint32
		procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
		if pid == currentPID {
			var classBuf [64]uint16
			n, _, _ := procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&classBuf[0])), uintptr(len(classBuf)))
			if n > 0 && syscall.UTF16ToString(classBuf[:n]) == "wailsWindow" {
				foundHWND = hwnd
				return 0 // stop enumeration
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

func getForegroundWindowNative() uintptr {
	hwnd, _, _ := procGetForegroundWindow.Call()
	return hwnd
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

func applyMiniWindowBoundsNative(hwnd uintptr, targetMonitor string, corner string, logicalW int, logicalH int, activate bool) (string, string) {
	if hwnd == 0 {
		return targetMonitor, corner
	}

	mon, _ := resolveMonitorOrPrimary(targetMonitor)
	if corner == "" {
		corner = "bottom-left"
	}

	scale := float64(mon.DPI) / 96.0
	if scale <= 0 {
		scale = 1.0
	}
	physW := int32(float64(logicalW) * scale)
	physH := int32(float64(logicalH) * scale)

	x, y, resolvedCorner := computeCornerPosition(mon.WorkArea, corner, physW, physH)

	inMiniModeAtomic.Store(true)

	// If window was minimized to taskbar, set its normal placement directly to target corner so it never flashes on another monitor
	if isWindowMinimizedNative(hwnd) {
		var wp windowPlacement
		wp.Length = uint32(unsafe.Sizeof(wp))
		procGetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&wp)))
		wp.ShowCmd = swShowNormal
		wp.RcNormalPosition = winRect{
			Left:   x,
			Top:    y,
			Right:  x + physW,
			Bottom: y + physH,
		}
		procSetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&wp)))
	}

	// Keep wsSysMenu and wsMinimizeBox so the Taskbar icon right-click system menu has Minimieren / Wiederherstellen
	style := getWindowStyleNative(hwnd)
	if style != 0 {
		framelessStyle := (style &^ (wsCaption | wsThickFrame | wsMaximizeBox | wsMinimize | wsMaximize)) | wsPopup | wsVisible | wsSysMenu | wsMinimizeBox
		procSetWindowLongPtrW.Call(hwnd, gwlStyle, framelessStyle)
	}

	flags := uintptr(swpFrameChanged | swpShowWindow)
	if !activate {
		flags |= swpNoActivate
	}
	procSetWindowPos.Call(
		hwnd,
		hwndTopMost,
		uintptr(x),
		uintptr(y),
		uintptr(physW),
		uintptr(physH),
		flags,
	)

	// Re-apply target monitor DPI & position in case moving across monitors with different DPIs adjusted dimensions
	actualDPI := getWindowDPI(hwnd)
	if actualDPI != mon.DPI && actualDPI >= 72 {
		actualScale := float64(actualDPI) / 96.0
		physW = int32(float64(logicalW) * actualScale)
		physH = int32(float64(logicalH) * actualScale)
		x, y, resolvedCorner = computeCornerPosition(mon.WorkArea, resolvedCorner, physW, physH)
		procSetWindowPos.Call(
			hwnd,
			hwndTopMost,
			uintptr(x),
			uintptr(y),
			uintptr(physW),
			uintptr(physH),
			swpNoZOrder|swpNoActivate,
		)
	}

	updateTaskbarSystemMenu(hwnd, true)
	return mon.DeviceName, resolvedCorner
}

func restoreNormalWindowBoundsNative(hwnd uintptr, savedStyle uintptr, savedRect winRect) winRect {
	if hwnd == 0 {
		return savedRect
	}

	inMiniModeAtomic.Store(false)

	if isWindowMinimizedNative(hwnd) {
		procShowWindow.Call(hwnd, swRestore)
	}

	restoredStyle := uintptr(wsOverlappedWindow | wsVisible)
	if savedStyle != 0 {
		restoredStyle = (savedStyle &^ (wsPopup | wsMinimize | wsMaximize)) | wsOverlappedWindow | wsVisible
	}
	procSetWindowLongPtrW.Call(hwnd, gwlStyle, restoredStyle)

	// Ensure savedRect lies on a currently connected monitor; otherwise fall back to Monitor 1 (Primary Monitor)
	w := savedRect.Right - savedRect.Left
	h := savedRect.Bottom - savedRect.Top
	_, onValidMonitor := isRectOnAnyMonitor(savedRect)
	if w < 600 || h < 400 || !onValidMonitor {
		monitors := getConnectedMonitors()
		primary := monitors[0]
		work := primary.WorkArea
		scale := float64(primary.DPI) / 96.0
		if scale <= 0 {
			scale = 1.0
		}
		w = int32(1180.0 * scale)
		h = int32(820.0 * scale)
		if w > (work.Right - work.Left) {
			w = work.Right - work.Left
		}
		if h > (work.Bottom - work.Top) {
			h = work.Bottom - work.Top
		}
		left := work.Left + (work.Right-work.Left-w)/2
		top := work.Top + (work.Bottom-work.Top-h)/2
		savedRect = winRect{
			Left:   left,
			Top:    top,
			Right:  left + w,
			Bottom: top + h,
		}
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
	updateTaskbarSystemMenu(hwnd, false)
	return savedRect
}

// --- Windows Taskbar Jump List COM Registration ("Minimieren" & "Wiederherstellen" in Taskbar Icon Context Menu) ---

type comGUID struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type propertyKey struct {
	FmtID comGUID
	PID   uint32
}

type propVariant struct {
	Vt        uint16
	Reserved1 uint16
	Reserved2 uint16
	Reserved3 uint16
	Val       uintptr
	Padding   uintptr
}

var (
	clsidDestinationList            = comGUID{0x77f10cf0, 0x3db5, 0x4966, [8]byte{0xb5, 0x20, 0xb7, 0xc5, 0x4f, 0xd3, 0x5e, 0xd6}}
	iidICustomDestinationList       = comGUID{0x6332debf, 0x87b5, 0x4670, [8]byte{0x90, 0xc0, 0x5e, 0x57, 0xb4, 0x08, 0xa4, 0x9e}}
	clsidEnumerableObjectCollection = comGUID{0x2d3468c1, 0x36a7, 0x43b6, [8]byte{0xac, 0x24, 0xd3, 0xf0, 0x2f, 0xd9, 0x60, 0x7a}}
	iidIObjectCollection            = comGUID{0x5632b1a4, 0xe38a, 0x400a, [8]byte{0x92, 0x8a, 0xd4, 0xcd, 0x63, 0x23, 0x02, 0x95}}
	iidIObjectArray                 = comGUID{0x92ca9dcd, 0x5622, 0x4bba, [8]byte{0xa8, 0x05, 0x5e, 0x9f, 0x54, 0x1b, 0xd8, 0xc9}}
	clsidShellLink                  = comGUID{0x00021401, 0x0000, 0x0000, [8]byte{0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidIShellLinkW                  = comGUID{0x000214f9, 0x0000, 0x0000, [8]byte{0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidIPropertyStore               = comGUID{0x886d8eeb, 0x8cf2, 0x4446, [8]byte{0x8d, 0x02, 0xcd, 0xba, 0x1d, 0xbd, 0xcf, 0x99}}
	pkeyTitle                       = propertyKey{
		FmtID: comGUID{0xf29f85e0, 0x4ff9, 0x1068, [8]byte{0xab, 0x91, 0x08, 0x00, 0x2b, 0x27, 0xb3, 0xd9}},
		PID:   2,
	}
)

func comVtableMethod(obj uintptr, index uintptr) uintptr {
	vtbl := *(*uintptr)(unsafe.Pointer(obj))
	return *(*uintptr)(unsafe.Pointer(vtbl + index*unsafe.Sizeof(uintptr(0))))
}

func comRelease(obj uintptr) {
	if obj != 0 {
		fn := comVtableMethod(obj, 2)
		syscall.SyscallN(fn, obj)
	}
}

func createJumpListShellLink(exePath string, args string, title string, description string) uintptr {
	const clsctxInprocServer = 0x1
	var shellLink uintptr
	hr, _, _ := procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidShellLink)),
		0,
		clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidIShellLinkW)),
		uintptr(unsafe.Pointer(&shellLink)),
	)
	if hr != 0 || shellLink == 0 {
		return 0
	}

	exePtr, _ := syscall.UTF16PtrFromString(exePath)
	argsPtr, _ := syscall.UTF16PtrFromString(args)
	descPtr, _ := syscall.UTF16PtrFromString(description)
	titlePtr, _ := syscall.UTF16PtrFromString(title)

	// SetPath (index 20)
	hr, _, _ = syscall.SyscallN(comVtableMethod(shellLink, 20), shellLink, uintptr(unsafe.Pointer(exePtr)))
	if int32(hr) < 0 {
		comRelease(shellLink)
		return 0
	}
	// SetArguments (index 11)
	hr, _, _ = syscall.SyscallN(comVtableMethod(shellLink, 11), shellLink, uintptr(unsafe.Pointer(argsPtr)))
	if int32(hr) < 0 {
		comRelease(shellLink)
		return 0
	}
	// SetDescription (index 7)
	hr, _, _ = syscall.SyscallN(comVtableMethod(shellLink, 7), shellLink, uintptr(unsafe.Pointer(descPtr)))
	if int32(hr) < 0 {
		comRelease(shellLink)
		return 0
	}
	// SetIconLocation (index 17)
	hr, _, _ = syscall.SyscallN(comVtableMethod(shellLink, 17), shellLink, uintptr(unsafe.Pointer(exePtr)), 0)
	if int32(hr) < 0 {
		comRelease(shellLink)
		return 0
	}

	// QueryInterface for IPropertyStore (index 0)
	var propStore uintptr
	hr, _, _ = syscall.SyscallN(
		comVtableMethod(shellLink, 0),
		shellLink,
		uintptr(unsafe.Pointer(&iidIPropertyStore)),
		uintptr(unsafe.Pointer(&propStore)),
	)
	if hr == 0 && propStore != 0 {
		pv := propVariant{
			Vt:  31, // VT_LPWSTR
			Val: uintptr(unsafe.Pointer(titlePtr)),
		}
		// SetValue (index 6)
		hr, _, _ = syscall.SyscallN(comVtableMethod(propStore, 6), propStore, uintptr(unsafe.Pointer(&pkeyTitle)), uintptr(unsafe.Pointer(&pv)))
		// pv.Val is a uintptr: keep its Go allocation alive even on failure paths.
		runtime.KeepAlive(titlePtr)
		if int32(hr) < 0 {
			comRelease(propStore)
			comRelease(shellLink)
			return 0
		}
		// Commit (index 7)
		hr, _, _ = syscall.SyscallN(comVtableMethod(propStore, 7), propStore)
		if int32(hr) < 0 {
			comRelease(propStore)
			comRelease(shellLink)
			return 0
		}
		comRelease(propStore)
	} else {
		comRelease(shellLink)
		return 0
	}

	return shellLink
}

func registerTaskbarJumpList(language string) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	exePath, err := os.Executable()
	if err != nil || exePath == "" {
		return
	}

	// COINIT_APARTMENTTHREADED = 0x2
	initialized, _, _ := procCoInitializeEx.Call(0, 0x2)
	if int32(initialized) < 0 {
		return
	}
	defer procCoUninitialize.Call()

	const clsctxInprocServer = 0x1
	var destList uintptr
	hr, _, _ := procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidDestinationList)),
		0,
		clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidICustomDestinationList)),
		uintptr(unsafe.Pointer(&destList)),
	)
	if hr != 0 || destList == 0 {
		return
	}
	defer comRelease(destList)

	var minSlots uint32
	var removedArray uintptr
	// BeginList (index 4)
	hr, _, _ = syscall.SyscallN(
		comVtableMethod(destList, 4),
		destList,
		uintptr(unsafe.Pointer(&minSlots)),
		uintptr(unsafe.Pointer(&iidIObjectArray)),
		uintptr(unsafe.Pointer(&removedArray)),
	)
	if hr != 0 {
		return
	}
	if removedArray != 0 {
		comRelease(removedArray)
	}

	var objCollection uintptr
	hr, _, _ = procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidEnumerableObjectCollection)),
		0,
		clsctxInprocServer,
		uintptr(unsafe.Pointer(&iidIObjectCollection)),
		uintptr(unsafe.Pointer(&objCollection)),
	)
	if hr != 0 || objCollection == 0 {
		return
	}
	defer comRelease(objCollection)

	linkRestore := createJumpListShellLink(exePath, "--restore", backendText(language, "Wiederherstellen"), backendText(language, "DoDrag Hauptfenster wiederherstellen"))
	if linkRestore != 0 {
		// AddObject (index 5)
		hr, _, _ = syscall.SyscallN(comVtableMethod(objCollection, 5), objCollection, linkRestore)
		comRelease(linkRestore)
		if int32(hr) < 0 {
			return
		}
	}

	linkMinimize := createJumpListShellLink(exePath, "--minimize", backendText(language, "Minimieren"), backendText(language, "DoDrag in die Kompaktansicht minimieren"))
	if linkMinimize != 0 {
		// AddObject (index 5)
		hr, _, _ = syscall.SyscallN(comVtableMethod(objCollection, 5), objCollection, linkMinimize)
		comRelease(linkMinimize)
		if int32(hr) < 0 {
			return
		}
	}

	var tasksArray uintptr
	hr, _, _ = syscall.SyscallN(
		comVtableMethod(objCollection, 0),
		objCollection,
		uintptr(unsafe.Pointer(&iidIObjectArray)),
		uintptr(unsafe.Pointer(&tasksArray)),
	)
	if hr == 0 && tasksArray != 0 {
		// AddUserTasks (index 7)
		hr, _, _ = syscall.SyscallN(comVtableMethod(destList, 7), destList, tasksArray)
		comRelease(tasksArray)
		if int32(hr) < 0 {
			return
		}
		// CommitList (index 8)
		hr, _, _ = syscall.SyscallN(comVtableMethod(destList, 8), destList)
		if int32(hr) < 0 {
			return
		}
	}
}
