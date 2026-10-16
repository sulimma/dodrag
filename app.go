package main

import (
	"context"
	"dodrag/internal/eventstore"
	"os"
	"path/filepath"
)

// App struct binds Go methods to the Wails frontend.
type App struct {
	ctx   context.Context
	store *eventstore.Store
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	dbPath := "dodrag.db"
	if configDir, err := os.UserConfigDir(); err == nil {
		appDir := filepath.Join(configDir, "DoDrag")
		if mkErr := os.MkdirAll(appDir, 0755); mkErr == nil {
			dbPath = filepath.Join(appDir, "dodrag.db")
		}
	}

	store, err := eventstore.NewStore(dbPath)
	if err != nil {
		// Fallback to local directory db if user config dir fails
		store, _ = eventstore.NewStore("dodrag.db")
	}
	a.store = store
}

// shutdown is called when the app terminates.
func (a *App) shutdown(ctx context.Context) {
	if a.store != nil {
		_ = a.store.Close()
	}
}

// GetEvents returns the full event history from SQLite.
func (a *App) GetEvents() ([]eventstore.Event, error) {
	if a.store == nil {
		return []eventstore.Event{}, nil
	}
	return a.store.GetEvents()
}

// AppendEvent appends a new domain event to the SQLite event store and returns the updated list.
func (a *App) AppendEvent(id string, eventType string, payloadJSON string) ([]eventstore.Event, error) {
	return a.store.AppendEvent(id, eventType, payloadJSON)
}

// Undo reverts the most recent active event.
func (a *App) Undo() ([]eventstore.Event, error) {
	return a.store.Undo()
}

// Redo re-applies the most recently undone event.
func (a *App) Redo() ([]eventstore.Event, error) {
	return a.store.Redo()
}

// ResetDemoData resets the database to the default demo state.
func (a *App) ResetDemoData() ([]eventstore.Event, error) {
	return a.store.ResetDemoData()
}
