//go:build windows

package main

import "testing"

func TestTaskMenuShutdownClearsQueuedRequests(t *testing.T) {
	app, other := &App{}, &App{}
	r := &taskMenuRequest{app: app, hwnd: 42, response: make(chan taskMenuResult, 1)}
	otherRequest := &taskMenuRequest{app: other, response: make(chan taskMenuResult, 1)}
	id, otherID := taskMenuRequestID.Add(1), taskMenuRequestID.Add(1)
	taskMenuRequests.Store(id, r)
	taskMenuRequests.Store(otherID, otherRequest)
	defer taskMenuRequests.Delete(id)
	defer taskMenuRequests.Delete(otherID)
	app.closeTaskContextMenusNative()
	app.closeTaskContextMenusNative()
	if !app.taskMenus.closed.Load() || r.state.Load() != 2 {
		t.Fatal("shutdown must close the owner and cancel queued requests")
	}
	if _, ok := taskMenuRequests.Load(id); ok {
		t.Fatal("canceled request leaked in queue")
	}
	if _, ok := taskMenuRequests.Load(otherID); !ok {
		t.Fatal("shutdown canceled another owner's request")
	}
	dispatchTaskContextMenu(42, id)
	select {
	case result := <-r.response:
		if result.id != "" || result.err != nil {
			t.Fatalf("expected cancellation, got %+v", result)
		}
	default:
		t.Fatal("shutdown did not unblock the caller")
	}
	r.finish("late", nil)
	select {
	case <-r.response:
		t.Fatal("request completed more than once")
	default:
	}
	if _, err := app.ShowTaskContextMenu([]TaskMenuItem{{ID: "edit", Label: "Edit"}}); err == nil {
		t.Fatal("closed owner must reject new requests")
	}
}

func TestTaskMenuDispatchCanceledOwner(t *testing.T) {
	app := &App{}
	app.taskMenus.closed.Store(true)
	r := &taskMenuRequest{app: app, hwnd: 42, response: make(chan taskMenuResult, 1)}
	id := taskMenuRequestID.Add(1)
	taskMenuRequests.Store(id, r)
	defer taskMenuRequests.Delete(id)
	dispatchTaskContextMenu(99, id)
	if r.state.Load() != 0 {
		t.Fatal("wrong HWND consumed request")
	}
	dispatchTaskContextMenu(42, id)
	if result := <-r.response; result.id != "" || result.err != nil {
		t.Fatalf("expected cancellation, got %+v", result)
	}
}
