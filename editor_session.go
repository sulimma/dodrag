package main

import (
	"context"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Descriptions remain local while the user edits. Closing is asynchronous:
// Windows asks, the ready frontend flushes drafts/queued mutations, then confirms.
// Never call Wails while holding mu. Before frontend readiness no editable task
// snapshot exists, so an early close must not wait for a listener that isn't there.
func (a *App) requestEditorClose() (prevent, notify bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.editorReady || a.closeApproved {
		return false, false
	}
	if a.closePending {
		return true, false
	}
	a.closePending = true
	return true, true
}

func (a *App) beforeClose(ctx context.Context) bool {
	prevent, notify := a.requestEditorClose()
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

func (a *App) FinishClose(saved bool) {
	a.mu.Lock()
	if !a.closePending {
		a.mu.Unlock()
		return
	}
	a.closePending = false
	a.closeApproved = saved
	ctx := a.ctx
	a.mu.Unlock()
	if saved && ctx != nil {
		runtime.Quit(ctx)
	}
}
