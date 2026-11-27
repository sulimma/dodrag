package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Descriptions remain local while the user edits. Closing is asynchronous:
// The native window asks, the ready frontend flushes drafts and queued mutations, then confirms.
// Never call Wails while holding mu. Without a ready frontend, do not wait for
// a listener, but still stop any timer owned by this native process.
func (a *App) requestEditorClose() (prevent, notify bool, err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closeApproved {
		return false, false, nil
	}
	if !a.editorReady {
		err := a.stopOwnedTimeMeasurementLocked()
		return err != nil, false, err
	}
	if a.closePending {
		return true, false, nil
	}
	a.closePending = true
	return true, true, nil
}

func (a *App) beforeClose(ctx context.Context) bool {
	prevent, notify, err := a.requestEditorClose()
	if err != nil {
		runtime.LogError(ctx, err.Error())
	}
	if notify {
		runtime.EventsEmit(ctx, "app:before-close")
	}
	return prevent
}

// SetEditorReady is called only after the frontend has subscribed, and cleared
// when it unsubscribes. A removed frontend cannot leave a permanently pending close.
func (a *App) SetEditorReady(ready bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.editorReady = ready
	if !ready {
		a.closePending = false
	}
}

func (a *App) FinishClose(saved bool) error {
	a.mu.Lock()
	if !a.closePending {
		a.mu.Unlock()
		return nil
	}
	a.closePending = false
	if saved {
		if err := a.stopOwnedTimeMeasurementLocked(); err != nil {
			a.mu.Unlock()
			return err
		}
	}
	a.closeApproved = saved
	ctx := a.ctx
	a.mu.Unlock()
	if saved && ctx != nil {
		runtime.Quit(ctx)
	}
	return nil
}
