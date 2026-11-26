package main

import (
	"database/sql"
	"path/filepath"
	"testing"

	timemeasurement "dodrag/internal/plugins/time-measurement"
)

func timeMeasurementApp(t *testing.T) (*App, AppSettings, AppSettings) {
	t.Helper()
	a := testApp(t)
	second, err := a.CreateDatabase("", "second", false)
	if err != nil {
		t.Fatal(err)
	}
	first, err := a.CreateDatabase("", "first", false)
	if err != nil {
		t.Fatal(err)
	}
	if first.DatabaseGeneration == 0 || first.DatabaseGeneration == second.DatabaseGeneration {
		t.Fatal("missing distinct database generations")
	}
	if _, err := a.AppendEvent("create-a", "TASK_CREATED", `{"taskId":"a","title":"Task","configuredStart":"2026-11-26T09:00:00Z","createdAt":"2026-11-26T09:00:00Z"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := a.StartTimeMeasurement(first.DatabaseGeneration, "a", "create-a"); err == nil {
		t.Fatal("plugin started while disabled")
	}
	if _, err := a.SetPluginEnabled(timemeasurement.ID, true); err != nil {
		t.Fatal(err)
	}
	return a, first, second
}

func nativeTimerStart(t *testing.T, a *App, generation uint64) *timemeasurement.Session {
	t.Helper()
	state, err := a.StartTimeMeasurement(generation, "a", "create-a")
	if err != nil || state.Running == nil {
		t.Fatalf("start: %+v %v", state, err)
	}
	return state.Running
}

func timeMeasurementDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func failNativeStop(t *testing.T, db *sql.DB) func() {
	t.Helper()
	if _, err := db.Exec(`CREATE TRIGGER fail_stop_update BEFORE UPDATE ON plugin_time_measurement_sessions BEGIN SELECT RAISE(ABORT,'stop failed'); END;
 CREATE TRIGGER fail_stop_delete BEFORE DELETE ON plugin_time_measurement_sessions BEGIN SELECT RAISE(ABORT,'stop failed'); END;`); err != nil {
		t.Fatal(err)
	}
	return func() {
		t.Helper()
		if _, err := db.Exec(`DROP TRIGGER fail_stop_update; DROP TRIGGER fail_stop_delete`); err != nil {
			t.Fatal(err)
		}
	}
}

func TestTimeMeasurementCloseFailureAllowsRetry(t *testing.T) {
	a, first, _ := timeMeasurementApp(t)
	open := nativeTimerStart(t, a, first.DatabaseGeneration)
	clear := failNativeStop(t, timeMeasurementDB(t, first.ActiveDatabasePath))
	a.SetEditorReady(true)
	if prevent, notify, _ := a.requestEditorClose(); !prevent || !notify {
		t.Fatal("close did not request flush")
	}
	if err := a.FinishClose(false); err != nil {
		t.Fatal(err)
	}
	state, err := a.GetTimeMeasurement(first.DatabaseGeneration)
	if err != nil || state.Running == nil || state.Running.ID != open.ID {
		t.Fatal("failed flush stopped the timer", state, err)
	}
	a.requestEditorClose()
	if err := a.FinishClose(true); err == nil || a.closeApproved || a.closePending {
		t.Fatal("failed stop approved or trapped close", err)
	}
	state, err = a.GetTimeMeasurement(first.DatabaseGeneration)
	if err != nil || state.Running == nil || state.Running.ID != open.ID {
		t.Fatal("failed close stopped timer", state, err)
	}
	clear()
	if prevent, notify, _ := a.requestEditorClose(); !prevent || !notify {
		t.Fatal("close cannot retry")
	}
	if err := a.FinishClose(true); err != nil || !a.closeApproved {
		t.Fatal("retry did not approve close", err)
	}
	state, err = a.store.TimeMeasurement()
	if err != nil || state.Running != nil || state.Interrupted != nil || len(state.Sessions) != 0 {
		t.Fatalf("close did not discard short run: %+v %v", state, err)
	}
}

func TestTimeMeasurementCloseWithoutFrontendStopsOwnedTimer(t *testing.T) {
	a, first, _ := timeMeasurementApp(t)
	nativeTimerStart(t, a, first.DatabaseGeneration)
	clear := failNativeStop(t, timeMeasurementDB(t, first.ActiveDatabasePath))
	if prevent, notify, err := a.requestEditorClose(); !prevent || notify || err == nil {
		t.Fatal("missing frontend allowed failed stop to close", err)
	}
	clear()
	if prevent, notify, err := a.requestEditorClose(); prevent || notify || err != nil {
		t.Fatal("missing frontend prevented successful close", err)
	}
	if state, err := a.store.TimeMeasurement(); err != nil || state.Running != nil || state.Interrupted != nil {
		t.Fatal("close with no frontend left an open timer", state, err)
	}
}

func TestTimeMeasurementSwitchFailureAndStaleGeneration(t *testing.T) {
	a, first, second := timeMeasurementApp(t)
	open := nativeTimerStart(t, a, first.DatabaseGeneration)
	if same, err := a.SwitchDatabase(first.ActiveDatabasePath); err != nil || same.DatabaseGeneration != first.DatabaseGeneration {
		t.Fatal("same database was reopened", same, err)
	}
	if same, err := a.OpenExistingDatabaseDialog(); err != nil || same.DatabaseGeneration != first.DatabaseGeneration {
		t.Fatal("cancelled picker changed generation", same, err)
	}
	clear := failNativeStop(t, timeMeasurementDB(t, first.ActiveDatabasePath))
	if got, err := a.SwitchDatabase(second.ActiveDatabasePath); err == nil || got.ActiveDatabasePath != first.ActiveDatabasePath || got.DatabaseGeneration != first.DatabaseGeneration {
		t.Fatal("switch did not keep active database", got, err)
	}
	state, err := a.GetTimeMeasurement(first.DatabaseGeneration)
	if err != nil || state.Running == nil || state.Running.ID != open.ID {
		t.Fatal("no-op switch or failed stop changed timer", state, err)
	}
	clear()
	settingsPath := a.settingsPath
	a.settingsPath = filepath.Join(a.appDir, "missing", "settings.json")
	if got, err := a.SwitchDatabase(second.ActiveDatabasePath); err == nil || got.ActiveDatabasePath != first.ActiveDatabasePath {
		t.Fatal("settings failure activated replacement", got, err)
	}
	if confirmed, err := a.GetSettings(); err != nil || confirmed.DatabaseGeneration != first.DatabaseGeneration || !confirmed.DatabaseReady {
		t.Fatal("switch error prevented reading the confirmed snapshot", confirmed, err)
	}
	if state, err := a.GetTimeMeasurement(first.DatabaseGeneration); err != nil || state.Running != nil || state.Interrupted != nil {
		t.Fatal("settings failure reverted committed stop", state, err)
	}
	a.settingsPath = settingsPath
	nativeTimerStart(t, a, first.DatabaseGeneration)
	if _, err := a.SwitchDatabase(second.ActiveDatabasePath); err != nil {
		t.Fatal(err)
	}
	reopened, err := a.SwitchDatabase(first.ActiveDatabasePath)
	if err != nil || reopened.DatabaseGeneration == first.DatabaseGeneration {
		t.Fatal("reopening reused generation", err)
	}
	if state, err := a.GetTimeMeasurement(reopened.DatabaseGeneration); err != nil || state.Interrupted != nil || len(state.Sessions) != 0 {
		t.Fatal("switch did not discard short run", state, err)
	}
	if _, err := a.StartTimeMeasurement(first.DatabaseGeneration, "a", "create-a"); err == nil {
		t.Fatal("stale start reached reopened database")
	}
}

func TestTimeMeasurementActiveRemovalStopsBeforeClosingDatabase(t *testing.T) {
	a, first, second := timeMeasurementApp(t)
	run := nativeTimerStart(t, a, first.DatabaseGeneration)
	if _, err := a.DeleteDatabase(second.ActiveDatabasePath, false); err != nil {
		t.Fatal(err)
	}
	if state, err := a.GetTimeMeasurement(first.DatabaseGeneration); err != nil || state.Running == nil || state.Running.ID != run.ID {
		t.Fatal("inactive removal stopped active run", state, err)
	}
	db := timeMeasurementDB(t, first.ActiveDatabasePath)
	clear := failNativeStop(t, db)
	if state, err := a.DeleteDatabase(first.ActiveDatabasePath, false); err == nil || !state.DatabaseReady || state.DatabaseGeneration != first.DatabaseGeneration {
		t.Fatal("failed stop removed active database", state, err)
	}
	clear()
	if state, err := a.DeleteDatabase(first.ActiveDatabasePath, false); err != nil || state.DatabaseReady {
		t.Fatal("active removal failed", state, err)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM plugin_time_measurement_sessions`).Scan(&count); err != nil || count != 0 {
		t.Fatal("active removal did not discard short run", count, err)
	}
}

func TestTimeMeasurementDisableFailureAndCommittedStop(t *testing.T) {
	a, first, _ := timeMeasurementApp(t)
	open := nativeTimerStart(t, a, first.DatabaseGeneration)
	db := timeMeasurementDB(t, first.ActiveDatabasePath)
	if _, err := db.Exec(`UPDATE plugin_time_measurement_sessions SET start_utc_ms=start_utc_ms-60000`); err != nil {
		t.Fatal(err)
	}
	clear := failNativeStop(t, db)
	if got, err := a.SetPluginEnabled(timemeasurement.ID, false); err == nil || !got.PluginEnabled[timemeasurement.ID] {
		t.Fatal("disable ignored stop failure", got, err)
	}
	state, err := a.GetTimeMeasurement(first.DatabaseGeneration)
	if err != nil || state.Running == nil || state.Running.ID != open.ID {
		t.Fatal("failed disable changed timer", state, err)
	}
	clear()
	settingsPath := a.settingsPath
	a.settingsPath = filepath.Join(a.appDir, "missing", "settings.json")
	if got, err := a.SetPluginEnabled(timemeasurement.ID, false); err == nil || !got.PluginEnabled[timemeasurement.ID] {
		t.Fatal("failed settings save disabled plugin", got, err)
	}
	state, err = a.GetTimeMeasurement(first.DatabaseGeneration)
	if err != nil || state.Running != nil || len(state.Sessions) != 1 || state.Sessions[0].ID != open.ID {
		t.Fatal("settings failure reverted committed stop", state, err)
	}
	a.settingsPath = settingsPath
	if _, err := a.SetPluginEnabled(timemeasurement.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GetTimeMeasurement(first.DatabaseGeneration); err == nil {
		t.Fatal("disabled plugin allowed database access")
	}
	if _, err := a.SetPluginEnabled(timemeasurement.ID, true); err != nil {
		t.Fatal(err)
	}
	if state, err := a.GetTimeMeasurement(first.DatabaseGeneration); err != nil || len(state.Sessions) != 1 {
		t.Fatal("disable removed history", state, err)
	}
}
