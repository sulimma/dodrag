# Code-Karte

Diese Karte nennt Einstiegspunkte. Verhalten, Architekturentscheidungen und lokale Konventionen stehen in den genannten Quellen.

| Bereich | Einstieg |
| --- | --- |
| Zusammenspiel der Ansichten | `frontend/src/App.tsx` |
| Laden, Datenbankidentität, Schreibwarteschlange | `frontend/src/hooks/useDatabaseSnapshot.ts` |
| Taskaktionen, relative Datumsänderungen | `frontend/src/hooks/useTaskMutations.ts` |
| Titel-/Datumssitzungen | `frontend/src/hooks/useInlineEditors.ts`, `components/inlineEditor.ts` |
| Auswahl und Tastatur | `frontend/src/hooks/useTaskSelection.ts`, `useGlobalShortcuts.ts` |
| Dragablauf und Vorschau | `frontend/src/hooks/taskPointerDrag.ts`, `useTaskDrag.ts`, `taskDragPreview.ts` |
| Manuelle Reihenfolge und Uhrzeitmarker | `frontend/src/domain/{taskOrder,timeMarkers}.ts`, `frontend/src/hooks/useTimeMarkers.ts`, `frontend/src/components/{ListTimeRow,TimeMarkerDefaults}.tsx`, `internal/eventstore/time_markers.go` |
| Ereignisschema und Replay | `frontend/src/domain/eventSchema.ts`, `commands.ts` |
| Termine, Ansichtsprojektion, Abhängigkeiten | `frontend/src/domain/dates.ts`, `projector.ts`, `dependencyPaths.ts` |
| Wails-Schnittstelle | `frontend/src/bridge/eventBridge.ts` |
| Bundled plugins | `frontend/src/plugins/registry.ts`, `frontend/src/plugins/copy-task-summary/`, `app.go` (`supportedPluginIDs`, `SetPluginEnabled`) |
| Lokale Beschreibungsentwürfe und abschließendes Speichern | `frontend/src/hooks/useDescriptionDrafts.ts` |
| Natives Schließen nach Editorabschluss | `editor_session.go`, `frontend/src/App.tsx` |
| Beschreibung und Log | `frontend/src/components/TaskDetailPanel.tsx`, `editor/TaskDescriptionEditor.tsx`, `TaskLogSection.tsx` |
| Editor-Erweiterungen | `frontend/src/components/editor/` |
| Gemeinsame Taskdarstellung/-aktionen | `frontend/src/components/taskInteractions.ts`, `TaskTitle.tsx`, `TaskDate.tsx`, `TaskContextMenu.tsx` |
| Liste, Netzplan, Gantt, Protokoll, Mini | `frontend/src/components/{ListView,NetworkPlanView,GanttView,ProtocolView,MiniCornerView}.tsx` |
| Protokollprojektion und gemeinsame Listenzeilen | `frontend/src/domain/protocol.ts`, `frontend/src/components/ListRows.tsx` |
| Feste Datumstrenner in Liste, Netzplan und Protokoll | `frontend/src/components/DateScrollOverlay.tsx`, `DateLayerLine.tsx` |
| Sprache und Kataloge | `frontend/src/i18n/index.ts`, `locales/`, `glossary.json`; nativ `backend_i18n.go` |
| Native App, Datenbanken und Settings | `app.go` |
| SQLite, Commands und Cache | `internal/eventstore/{sqlite,commands,cache}.go` |
| Fenster/DPI und native Menüs | `desktop_windows.go`, `window_mode_windows.go`, `window_titlebar_windows.go`, `window_windows.go`, `task_context_menu_windows.go` |
| Linux-Fenster, Plattformfähigkeiten und App-Menüs | `desktop_linux.go`, `frontend/src/desktop.ts`, `frontend/src/components/ContextMenuPopup.tsx` |
| Dateipfade und Bildvorschau | `paths.go`, `paths_{linux,windows}.go`, `folders_{linux,windows}.go`, `image_preview.go` |
| Installation/Autostart | `install_windows.go`, `autostart_windows.go` |
| Cache, Tests, Packaging, Release | `frontend.ps1`, `scripts/frontend-cache.ps1`, `build.ps1`, `build-linux.sh`, `build/linux/`, `release.ps1`, `.github/workflows/release.yml` |

Tests liegen meist neben dem Modul. Für Interaktionsfehler zuerst die betreffenden `App.*.test.tsx` und Hooktests prüfen; Persistenzfehler in `internal/eventstore/*_test.go`.
