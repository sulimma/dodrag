package main

import "testing"

func TestEditorCloseProtocol(t *testing.T) {
	app := &App{}
	if prevent, _ := app.requestEditorClose(); prevent {
		t.Fatal("close before frontend readiness must pass")
	}
	app.SetEditorReady(true)
	if prevent, notify := app.requestEditorClose(); !prevent || !notify {
		t.Fatal("ready frontend must flush before closing")
	}
	if prevent, notify := app.requestEditorClose(); !prevent || notify {
		t.Fatal("duplicate close must wait without another flush")
	}
	app.FinishClose(false)
	if prevent, notify := app.requestEditorClose(); !prevent || !notify {
		t.Fatal("failed save must allow a later retry")
	}
	app.FinishClose(true)
	if prevent, _ := app.requestEditorClose(); prevent {
		t.Fatal("successful flush must allow native close")
	}
}

func TestRemovedEditorCloseHandlerDoesNotTrapWindow(t *testing.T) {
	app := &App{}
	app.SetEditorReady(true)
	app.requestEditorClose()
	app.SetEditorReady(false)
	if prevent, _ := app.requestEditorClose(); prevent {
		t.Fatal("unsubscribed frontend must not trap close")
	}
	app.FinishClose(true)
	if app.closeApproved {
		t.Fatal("stale acknowledgement must not approve another close")
	}
}
