# Architecture

DoDrag is a Windows desktop application with a Go/Wails host and a React/TypeScript frontend. The frontend is embedded into the packaged application; its bridge also provides a `localStorage` event-log fallback for browser development and UI tests.

## Runtime and data flow

1. **UI and interactions — `frontend/src/App.tsx`, `components/`, `hooks/`:** `App` coordinates state and the active list, network, or Gantt view. Hooks isolate selection, drag operations, edits, database snapshots, mutations, and keyboard shortcuts; the shared task-interaction contract keeps behavior consistent across views.
2. **Domain — `frontend/src/domain/`:** validated commands and events are replayed into task state. Projection derives effective dates, actionable tasks, dependency relationships, date layers, and view metadata. Dependency/topology helpers enforce valid acyclic task relationships.
3. **Bridge — `frontend/src/bridge/eventBridge.ts`:** sends typed commands to Wails in the desktop app or persists an event log in browser development mode.
4. **Native host — `main.go`, `app.go`, `window_windows.go`, `autostart_windows.go`:** Wails embeds `frontend/dist`, exposes application/database operations, and handles Windows window behavior and autostart.
5. **Persistence — `internal/eventstore/`:** SQLite stores task changes as an append-oriented event history. Undo/redo changes event status and state is reconstructed by replay; SQLite is provided by the pure-Go `modernc.org/sqlite` driver.

## Source tree

```text
.
├── app.go                         # Wails-bound application, settings, and database lifecycle
├── main.go                        # Desktop entry point; embeds frontend/dist
├── window_windows.go              # Windows window placement, docking, and native behavior
├── autostart_windows.go           # Windows startup registration
├── internal/eventstore/           # SQLite schema, event commands, and tests
├── build.ps1                      # Frontend checks/build, Go tests, and Wails packaging
├── frontend/
│   ├── src/App.tsx                # UI composition and application state coordination
│   ├── src/bridge/                # Wails/browser persistence boundary
│   ├── src/domain/                # Event schema, replay, projection, dates, topology
│   ├── src/hooks/                 # Selection, drag, editing, mutations, shortcuts
│   ├── src/components/            # Toolbar, sidebar, dialogs, and task views
│   └── tests/                     # Browser-level interaction checks
├── docs/screenshots/              # README feature screenshots
├── README.md
└── ARCHITECTURE.md
```

The packaged Go application requires the frontend build output at `frontend/dist`; generated output, dependencies, and executable binaries are not source-controlled.
