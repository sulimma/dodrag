# DoDrag plugin integration

Status: design only. The pilot below is a proposal, not an enabled DoDrag feature.

## Scope

Ship first-party, build-time plugins with DoDrag on Windows and Linux. Each plugin has its own source folder and a stable ID. A per-user enabled flag controls its functionality immediately after a successful settings save. Missing flags mean off, including in old settings files. The choice follows the user across database switches and restarts; it is not stored in a task database.

V1 has one contribution point and one proposed pilot: **Copy task summary** (`copy-task-summary`) in the expanded task detail panel. No plugin marketplace, dynamic code loading, third-party code, plugin SDK, plugin commands, or task event/schema changes. A built-in plugin is trusted app code, not a security sandbox.

## Source layout and ownership

- `frontend/src/plugins/copy-task-summary/`: the pilot action, plain-text formatter, and plugin-specific tests. Future plugins get sibling folders; if one needs Go logic, use `internal/plugins/<plugin>/` with typed host integration.
- `frontend/src/plugins/registry.ts`: explicit imports and static UI descriptors (ID, localized label/description, and task detail action). `App.tsx` selects eligible contributions and passes the action into a narrow optional slot in `components/TaskDetailPanel.tsx`. `components/SettingsModal.tsx` consumes settings rows, not plugin implementations.
- Go owns the supported IDs and all persisted values. In `app.go`, add the flag map to `persistedSettings` and expose the effective flags via `AppSettings`; keep the Go allowlist next to the settings integration. A cross-stack test must catch mismatched IDs. Do not put plugin code in `app.go` or `main.go`.

## Settings contract

Store `"pluginEnabled": { "copy-task-summary": true }` in the existing local `settings.json`. Save via `saveSettingsLocked` and return an `AppSettings` snapshot via a typed `SetPluginEnabled(id, enabled)` Wails method. Under `App.mu`, validate the ID, save using the existing atomic settings path, and roll back the in-memory change on failure. Clone maps crossing the snapshot boundary. Unknown persisted IDs never activate code; preserve their values on settings round trips so an older build with plugin support does not erase newer preferences. Reject unknown IDs in the setter. The backend catalog should expose registered flags even when false so the frontend can distinguish an off plugin from an unsupported one.

Add the wrapper in `frontend/src/bridge/eventBridge.ts` and route the returned state through `hooks/useDatabaseSnapshot.ts`, as with other preference setters. A plugin update neither reloads the task snapshot nor enters the task mutation queue. Serialize the toggle with other settings actions that replace the settings snapshot; an older refresh must not undo a newer confirmed toggle.

## UX and lifecycle

- Add **Plugins** to the existing Settings modal. Give each available plugin a labeled switch and brief description, using the existing Settings switch pattern. Space and Enter toggle it. Keep the current checked value until the backend confirms the save, block repeat or conflicting actions while saving or refreshing settings, and announce failures using the existing settings error pattern. Keep focus on the setting and allow retry. Settings remain usable without a ready task database.
- Mount the pilot action only when its confirmed flag is on, the current task snapshot is ready, and a task is visible in the expanded normal-mode detail panel. Do not put it in the mini window, native context menu, shortcut map, or shell integrations. Keep it noninteractive while a modal blocks the panel. Verify the current plugin, selected task, and database before dispatch; an action from an invalidated view must do nothing. No background activity or work at startup.
- Copy only the visible task ID, title, localized status, and effective date as plain text, using DoDrag’s existing clipboard pattern. Pass a read-only projection of the task shown in the panel, excluding descriptions, drafts, logs, and database paths. The action does not flush or change the draft, append events, or send data over the network. Announce success and clipboard errors accessibly; ignore late feedback after the task or database changes. Disabling removes the action but does not clear text already copied. Implement new UI strings in DoDrag’s existing i18n catalogs.
- If a later plugin needs native operations, check the enabled flag at every Go entry point as well as in the UI. If it writes tasks, use existing validated commands and mutation/database-switch handling. Define cancellation and cleanup when there is a real plugin that needs them; do not add a general lifecycle API for this pilot.

## Acceptance checks

1. **Go:** old settings default off; enable/disable persists across restart and DB switch; unrelated preferences survive; unknown IDs cannot activate; save failure rolls back; snapshots do not alias the mutable flag map.
2. **Frontend:** keyboard toggles the control; only confirmed state changes the contribution; failure announces an error and retains the old state; stale settings or task/database changes cannot resurrect or invoke a disabled action. No action in mini mode, collapsed or project details, or with no visible task. Verify toggling does not remount the detail editor or discard drafts. Assert the clipboard payload and no task mutation.
3. **Native smoke:** on Windows WebView2 and Kubuntu WebKitGTK, enable from Settings, copy a summary and paste into a text editor, disable, switch databases, and restart. Verify both switch state and action visibility, and confirm existing task/close flows still work.

Implement the settings contract and the pilot together. Add more contribution points only when a second concrete plugin needs one.
