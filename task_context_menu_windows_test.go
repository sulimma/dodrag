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

func TestTaskMenuClientPoint(t *testing.T) {
	for _, tc := range []struct {
		anchor TaskMenuAnchor
		dpi    uint32
		want   winPoint
	}{
		{TaskMenuAnchor{X: 10, Y: 20}, 96, winPoint{X: 10, Y: 20}},
		{TaskMenuAnchor{X: 10, Y: 20}, 144, winPoint{X: 15, Y: 30}},
		{TaskMenuAnchor{X: 10.25, Y: -20.25}, 192, winPoint{X: 21, Y: -41}},
		{TaskMenuAnchor{X: 10, Y: -10}, 72, winPoint{X: 8, Y: -8}},
		{TaskMenuAnchor{X: maxTaskMenuAnchorCoordinate, Y: -maxTaskMenuAnchorCoordinate}, 480,
			winPoint{X: 5 * maxTaskMenuAnchorCoordinate, Y: -5 * maxTaskMenuAnchorCoordinate}},
	} {
		if got := taskMenuClientPoint(tc.anchor, tc.dpi); got != tc.want {
			t.Errorf("anchor %+v at DPI %d: got %+v, want %+v", tc.anchor, tc.dpi, got, tc.want)
		}
	}
}

func TestTaskMenuNilAnchorKeepsLegacyOwnerChecks(t *testing.T) {
	app := &App{}
	app.taskMenus.closed.Store(true)
	items := []TaskMenuItem{{ID: "edit", Label: "Edit"}}
	legacyID, legacyErr := app.ShowTaskContextMenu(items)
	anchoredID, anchoredErr := app.ShowTaskContextMenuAt(items, nil)
	if legacyID != anchoredID || legacyErr == nil || anchoredErr == nil || legacyErr.Error() != anchoredErr.Error() {
		t.Fatalf("nil anchor changed legacy behavior: (%q, %v) vs (%q, %v)", legacyID, legacyErr, anchoredID, anchoredErr)
	}
}
