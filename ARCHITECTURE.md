# Architecture

DoDrag is a native Windows desktop application with a Go/Wails host and a React/TypeScript frontend. The frontend is embedded into the packaged application. A `localStorage` fallback exists only as an internal development aid; browser operation is not a product target or regular test target.

## Runtime and data flow

1. **UI and interactions — `frontend/src/App.tsx`, `components/`, `hooks/`:** `App` coordinates state and the active list, network, Gantt, or compact corner view. Hooks isolate selection, pointer drag operations, edits, database snapshots, mutations, and keyboard shortcuts; shared task handlers and menu definitions keep behavior consistent across views. The compact title strip is React-rendered, with a separate non-draggable task-creation input using the same creation handler as the main toolbar.
2. **Domain — `frontend/src/domain/`:** validated commands and events are replayed into task state. Projection derives effective dates, actionable tasks, dependency relationships, date layers, and view metadata. Dependency/topology helpers enforce valid acyclic task relationships.
3. **Bridge — `frontend/src/bridge/eventBridge.ts`:** sends typed commands and translated context-menu items to Wails in the desktop app. Native menu calls return an action ID or an empty string on cancellation; frontend handlers perform the mutation. A `localStorage` event-log fallback exists for limited frontend development/testing only; it does not emulate native popups.
4. **Native host — `main.go`, `app.go`, `window_windows.go`, `task_context_menu*.go`, `autostart_windows.go`:** Wails embeds `frontend/dist`, exposes application/database operations, and handles Windows window behavior and autostart. A cancellable 200-ms watcher detects native minimization and switches the main window to compact mode after ten minutes continuously outside the foreground. Foreground return and mode changes reset the timer; automatic entry and passive compact-window adjustments do not activate the window.
5. **Persistence — `internal/eventstore/`:** SQLite stores task changes as an append-oriented event history. Undo/redo changes event status and state is reconstructed by replay; SQLite is provided by the pure-Go `modernc.org/sqlite` driver.

## Native context menus

Task menus in all views and path menus in settings use the same native popup bridge, not parallel HTML and Win32 renderers. `TaskContextMenu.tsx` defines task actions and dispatches the returned ID; completed tasks offer only reopening, which emits `TASK_REOPENED` without changing the configured start date. Title editing remains separate from the context menu. New menu labels and errors are translated in all fifteen frontend catalogs.

The host validates menu items, dispatches numeric request tokens to the existing window subclass, and runs `TrackPopupMenuEx` on the HWND's UI thread at the native cursor position. Windows controls placement, including outside the compact window and at screen edges. No application mutex is held during the modal menu loop. Cancellation, window destruction, and shutdown clean up pending requests and native menu resources; frontend request lifetimes prevent stale responses from acting on another database.

DOM tests verify menu definitions and action routing, and Go tests verify validation and request cleanup. They do not verify interactive WebView2 behavior, native keyboard navigation, or multi-monitor DPI placement; these require Windows app testing. The foreground watcher can miss focus intervals shorter than its 200-ms sampling period.

## Source tree

```text
.
├── app.go                         # Wails-bound application, settings, and database lifecycle
├── main.go                        # Desktop entry point; embeds frontend/dist
├── window_windows.go              # Windows window placement, docking, and native behavior
├── task_context_menu*.go           # Popup validation, UI-thread dispatch, and cleanup/tests
├── autostart_windows.go           # Windows startup registration
├── internal/eventstore/           # SQLite schema, event commands, and tests
├── build.ps1                      # Frontend checks/build, Go tests, and Wails packaging
├── frontend/
│   ├── src/App.tsx                # UI composition and application state coordination
│   ├── src/bridge/                # Wails persistence boundary and limited dev fallback
│   ├── src/domain/                # Event schema, replay, projection, dates, topology
│   ├── src/hooks/                 # Selection, drag, editing, mutations, shortcuts
│   ├── src/components/            # Toolbar, sidebar, dialogs, and task views
│   ├── src/i18n/                  # Fifteen frontend/native language catalogs and checks
│   └── tests/                     # Optional, narrowly scoped browser interaction checks
├── docs/screenshots/              # README feature screenshots
├── README.md
└── ARCHITECTURE.md
```

The packaged Go application requires the frontend build output at `frontend/dist`; generated output, dependencies, and executable binaries are not source-controlled.

`build.ps1` synchronizes frontend sources into a local dependency cache, runs frontend tests and the TypeScript/Vite build, runs Go tests, and packages with Wails 2.9.2 using Go 1.23.12. It injects version/build-time metadata and copies the packaged executable to `dodrag.exe` in the project root without starting the app or stopping user processes. Browser tests are not part of this standard build.
