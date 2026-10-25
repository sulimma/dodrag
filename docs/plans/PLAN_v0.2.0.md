# Architektur- und Implementierungsplan: DoDrag v0.2.0
**(Task-Detail-Container, Tiptap-WYSIWYM-Editor & Aktivitäts-Log)**

---

## 1. Übersicht & Versionssprung (`0.1.5` → `0.2.0`)
* **Version:** `0.2.0` in `wails.json`, `build/windows/info.json`, `build.ps1` (Fallback) und `AGENTS.md`.
* **Neue Kernfunktion:** Ein ein- und ausblendbarer **Task-Detail-Container** (`TaskDetailPanel.tsx`) links neben dem zentralen Arbeitsbereich (`main`), der den aktuell ausgewählten Task (`selectedTaskId`) im Detail darstellt, als vollwertige Task-Drag-Source und Task-Drop-Target agiert, einen **Tiptap-WYSIWYM-Editor** (GFM-Markdown, Checklisten, Mermaid, Inline-Bilder, URL-/Pfad-Erkennung) sowie ein **zeitgestempeltes Kommentar-/Notiz-Log** enthält.

---

## 2. Event-Sourcing & Domain-Architektur (Go + TypeScript)

Da DoDrag konsequent Event-Sourcing über SQLite (`internal/eventstore`) nutzt, benötigt `events` **keine Tabellen-Schemamigration**. Alle Erweiterungen erfolgen über zwei neue Event-Typen, die synchron in Go (`internal/eventstore/commands.go`) und TypeScript (`frontend/src/domain/eventSchema.ts`, `commands.ts`, `projector.ts`, `types.ts`) ergänzt werden:

### 2.1 Neue Event-Typen
1. **`TASK_DESCRIPTION_SET`**
   * **Payload:** `{ taskId: string, description: string }` (`description` darf leerer String `""` sein, max. z. B. 256 KB UTF-8).
   * **Coalescing:** In `isCoalescableEventType` (`sqlite.go` & `eventBridge.ts`) aufnehmen. Wenn der Benutzer im Tiptap-Editor tippt oder Checklisten abhakt, werden aufeinanderfolgende Änderungen über eine stabile `groupId` (z. B. `desc-${taskId}-${sessionMount}`) zu einem einzigen Event verschmolzen, damit `Ctrl+Z` auf App-Ebene nicht jeden einzelnen Buchstaben rückgängig macht.
2. **`TASK_LOG_ADDED`**
   * **Payload:** `{ taskId: string, entryId: string, text: string, createdAt: string }` (`entryId` validiert über `checkID`, `text` getrimmt nicht-leer, `createdAt` RFC3339-Timestamp).
   * **Replay:** Fügt dem Task in chronologischer Reihenfolge einen Log-Eintrag hinzu. Über das bestehende `Undo`/`Redo` von DoDrag lässt sich auch das Hinzufügen eines Log-Eintrags nahtlos rückgängig machen.

### 2.2 Erweiterung von `TaskState` & Checklisten-Fortschritt (`3/7`)
In `frontend/src/domain/types.ts` und `projector.ts`:
```ts
export interface TaskLogEntry {
  id: string;
  text: string;
  createdAt: string; // ISO-8601
}

export interface ChecklistProgress {
  checked: number;
  total: number;
}
```
* `TaskState` erhält:
  * `description: string` (Default `""`)
  * `logEntries: TaskLogEntry[]` (Default `[]`)
  * `checklistProgress: ChecklistProgress | null` (berechnet im Projector aus `description`)
* **Checklisten-Parser (`computeChecklistProgress(markdown: string)`):**
  * Ignoriert Fenced-Code-Blöcke (` ```...``` `), damit `- [ ]` innerhalb eines Codebeispiels nicht gezählt wird.
  * Zählt alle GFM-Task-List-Items: `/^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+/gm`.
  * Gibt `null` zurück, wenn `total === 0`, sonst `{ checked, total }`.
* **Anzeige in den anderen Ansichten (`3/7`):**
  * Gemeinsame kleine Badge-Komponente `<TaskChecklistBadge progress={task.checklistProgress} />` (Icon `CheckSquare` + Text `{checked}/{total}`, bei `checked === total` grün eingefärbt).
  * Wird eingebunden in:
    1. `ListView.tsx` (rechts neben dem Titel / vor den Vorgänger-Chips)
    2. `NetworkPlanView.tsx` (kompakt in der oberen Zeile des Knotens neben dem Datum)
    3. `GanttView.tsx` (in der linken Task-Namensspalte `data-gantt-list`)
    4. `MiniCornerView.tsx` (kompakt rechts vor den Hover-Action-Buttons)
    5. `TaskDetailPanel.tsx` (im Header des Containers)

---

## 3. Native Host-Erweiterungen (Go / Wails / Win32)

### 3.1 Windows-Explorer Drag & Drop von Dateien und Ordnern (`wails.json` & `main.go`)
WebView2 liefert bei einem HTML5-Drop aus dem Windows-Explorer aus Sicherheitsgründen **keine vollen Dateisystempfade** (`File.path` ist leer) und lässt Ordner-Drops im Standard-DOM oft scheitern.
* **Lösung über Wails v2 Native File Drop:**
  1. In `main.go` in `&options.App{...}` aktivieren:
     ```go
     DragAndDrop: &options.DragAndDrop{
         EnableFileDrop:     true,
         DisableWebViewDrop: false,
         CSSDropProperty:    "--wails-drop-target",
         CSSDropValue:       "drop",
     },
     ```
  2. Im Frontend (`TaskDetailPanel.tsx`) den Container bzw. Editor mit `style={{ '--wails-drop-target': 'drop' } as React.CSSProperties}` markieren und `window.runtime.OnFileDrop((x, y, paths) => ...)` abonnieren.
  3. Wenn Dateien/Verzeichnisse auf den Detail-Container/Editor gezogen werden, liefert Wails die exakten Windows-Pfade (`C:\...` bzw. `\\Server\...`), die an der Drop-Position in Tiptap (oder das Log-Eingabefeld) eingefügt werden.

### 3.2 Native Aktionen für URLs, Dateien und Verzeichnisse (`folders_windows.go` / `app.go`)
Bestehende Methoden (`OpenFolderInExplorer`, `OpenFolderInVSCode`) sind aktuell auf Datenbank-Ordner ausgelegt (`folderToOpen` erzwingt `info.IsDir()`). Für beliebige Pfade im Editor/Log erweitern wir `folders_windows.go` sauber:
* **`OpenPathInExplorer(targetPath string) error`:**
  * Prüft per `os.Stat(cleanPath)`:
    * Ist es ein **Verzeichnis** (`info.IsDir()`): Öffnet das Verzeichnis direkt (`explorer.exe <folder>`).
    * Ist es eine **existierende Datei**: Öffnet den Explorer und markiert die Datei (`explorer.exe /select,<file>`) oder öffnet bei Linksklick auf Verzeichnispfade den Ordner.
* **`OpenPathInVSCode(targetPath string) error`:**
  * Übergibt `cleanPath` (egal ob Datei oder Ordner) an `vscodeCommand(codePath, cleanPath)`.
* **`OpenExternalURL(rawURL string) error`:**
  * Validiert das Schema (`http://` oder `https://`, keine `javascript:`/`file:`/`cmd:`-Injektion) und ruft `runtime.BrowserOpenURL(a.ctx, rawURL)` auf.

### 3.3 Bild-Einbindung, AppData-Temp-Vorschau-Generator & Cache-Lifecycle (`image_preview.go` + AssetServer Middleware)
Anforderung: *„Pfade zu Bilddateien (inkl. SVG) werden inline als Bild angezeigt. Bei großen Dateien wird in einem AppData-Temp-Verzeichnis eine kleinere Vorschau erstellt. Wenn ein Task geschlossen wird, werden die Vorschaubilder im Cache gelöscht. Im Einstellungsmenü gibt es eine Aktion 'Cache löschen'. Das Kontextmenü davon enthält 'Cache-Ordner im File-Explorer öffnen'.“*
* **Problem:** WebView2 blockiert `<img src="file:///C:/...">`. Zudem würden 20-MB-JPGs beim Scrollen ruckeln.
* **Lösung (Go HTTP-Asset-Middleware + Task-bezogener Thumbnail-Cache):**
  1. **Cache-Verzeichnis:** `filepath.Join(os.TempDir(), "DoDrag", "previews")` (auf Windows: `%LOCALAPPDATA%\Temp\DoDrag\previews`), wird in `AppSettings` als `PreviewCacheDir string` (`json:"previewCacheDir,omitempty"`) an das Frontend übergeben.
  2. **Go-Methode & Asset-Route `/dodrag-media?taskId=<id>&path=<urlencoded>`** (eingehängt über `AssetServer.Middleware` in `main.go`):
     * Erlaubte Endungen: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`.
     * **SVG-Dateien (`.svg`):** Werden direkt mit `Content-Type: image/svg+xml` und `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` (verhindert eingebettete Skripte) ausgeliefert.
     * **Kleine Rasterbilder (z. B. Dateigröße ≤ 512 KB und Auflösung ≤ 1280px):** Werden direkt gestreamt.
     * **Große Rasterbilder (> 512 KB oder Breite/Höhe > 1280px):**
       * Dateiname im Cache enthält das Task-Präfix: `<sanitizedTaskId>__<SHA256(cleanPath + "|" + mtime + "|" + size)>.jpg` (oder liegt im Unterordner `previews/<sanitizedTaskId>/`).
       * Liegt die Datei noch nicht im Temp-Cache, dekodiert Go das Bild (`image/jpeg`, `image/png`, `image/gif`), skaliert es proportional auf max. `1280x1280` herunter (reines Go ohne schwere C-Abhängigkeiten) und speichert es als komprimiertes JPEG (`Quality: 82`) im Temp-Cache.
       * Liefert die kleine Vorschaudatei aus.
  3. **Automatisches Löschen beim Abschließen eines Tasks (`TASK_COMPLETED`):**
     * Sobald ein Task (oder ein Batch von Tasks) über `AppendEvent` / `AppendBatch` (oder `Redo` eines `TASK_COMPLETED`) als erledigt markiert wird, ruft der Go-Host automatisch `a.clearTaskPreviewCache(taskId)` auf und entfernt alle gecachten Vorschaubilder dieses Tasks aus `%LOCALAPPDATA%\Temp\DoDrag\previews`.
  4. **Einstellungsmenü (`SettingsModal.tsx`): „Cache löschen“ & Kontextmenü:**
     * Neue Go-Methoden auf `App`:
       * `ClearPreviewCache() error`: Löscht sämtliche Dateien/Unterordner in `%LOCALAPPDATA%\Temp\DoDrag\previews` (und legt den leeren Ordner wieder an).
       * `OpenPreviewCacheInExplorer() error`: Stellt sicher, dass `%LOCALAPPDATA%\Temp\DoDrag\previews` existiert (`os.MkdirAll`), und öffnet ihn über `OpenFolderInExplorer(cacheDir, false)`.
     * In `SettingsModal.tsx` wird ein neuer Einstellungsbereich / Button **„Cache löschen“** ergänzt:
       * **Linksklick auf „Cache löschen“:** Ruft `eventBridge.clearPreviewCache()` auf und bestätigt per Toast/Statusmeldung.
       * **Rechtsklick (Kontextmenü) auf den „Cache löschen“-Button / Bereich:** Öffnet das native Win32-Popup (`eventBridge.showTaskContextMenu([{ id: 'open-cache-explorer', label: t('Cache-Ordner im File-Explorer öffnen'), disabled: false }])`) und führt bei Auswahl `eventBridge.openPreviewCacheInExplorer()` aus.

### 3.4 Natives Kontextmenü mit Separator-Unterstützung (`task_context_menu.go` & `task_context_menu_windows.go`)
Anforderung: *„Im Kontextmenü sind im Container und Editor die Menüpunkte für den aktuellen Task. Im Editor sind zusätzlich hinter einem Separator die Menüpunkte des Editors.“* + *„Kontextmenü auf Pfade zeigt 'Im File-Explorer öffnen' und 'In VSCode öffnen'. Bei URLs zeigt es 'Im Browser öffnen'“*.
* **Erweiterung `TaskMenuItem`:**
  * Aktuell verbietet `validateTaskMenuItems` leere Labels und `trackTaskContextMenu` nutzt immer `mfString`.
  * Wir führen ein optionales Feld `Separator bool` (`json:"separator,omitempty"`) in `TaskMenuItem` ein.
  * In `trackTaskContextMenu` (`task_context_menu_windows.go`): Wenn `item.Separator == true`, wird `procAppendMenuW.Call(menu, mfSeparator, 0, 0)` aufgerufen.
* **Menü-Aufbau im Detail-Container & Editor:**
  1. **Außerhalb des Editors im Detail-Container:** Exakt `taskMenuItems(task)` (wie in Liste/Netzplan/Gantt).
  2. **Innerhalb des Editors (oder auf einem Log-Eintrag):**
     * **Sektion 1:** `taskMenuItems(task)` (Task aktivieren/deaktivieren, Heute, Erledigen, Vorgänger lösen / Erneut öffnen).
     * **Separator 1** (`mfSeparator`), falls Link/Pfad unter dem Mauszeiger liegt:
       * Bei **Pfad** (`data-target-kind="path"`):
         * `path:explorer` → *„Im File-Explorer öffnen“*
         * `path:vscode` → *„In VSCode öffnen“*
       * Bei **URL** (`data-target-kind="url"`):
         * `url:open` → *„Im Browser öffnen“*
     * **Separator 2** (`mfSeparator`) + **Sektion Editor** (wenn Rechtsklick im Tiptap-Editor):
       * `editor:cut` → *„Ausschneiden“* (`Ctrl+X`)
       * `editor:copy` → *„Kopieren“* (`Ctrl+C`)
       * `editor:paste` → *„Einfügen“* (`Ctrl+V`)
       * `editor:toggleChecklist` → *„Checkliste ein-/ausschalten“*
       * `editor:insertMermaid` → *„Mermaid-Diagramm einfügen“*

---

## 4. Layout & Container-Interaktionen (`TaskDetailPanel.tsx`)

### 4.1 Platzierung & Ein-/Ausblenden
* In `App.tsx` (unterhalb der `AppToolbar`, innerhalb von `<div className="flex-1 flex overflow-hidden">`):
  * **Links:** `<TaskDetailPanel />` (Breite z. B. `w-[420px] xl:w-[480px]`, `border-r border-slate-200 bg-white/95 flex flex-col shrink-0`).
  * **Mitte:** `<main>` (Liste / Netzplan / Gantt).
  * **Rechts:** `<TaskSidebar />` (Wiedervorlage & Erledigte Tasks).
* **Ein-/Ausblend-Steuerung:**
  * Toggle-Button in der `AppToolbar` (links neben dem View-Switcher, Icon `PanelLeftClose` / `PanelLeftOpen`) + Schließen-Button im Header des Containers.
  * Zustand `isDetailPanelOpen: boolean` in `App.tsx`. Ist kein Task ausgewählt (`selectedTaskId === null`), zeigt das geöffnete Panel einen dezenten Platzhalter (*„Task auswählen, um Details, Beschreibung und Log anzuzeigen“*).

### 4.2 Aufbau des Containers (von oben nach unten)
1. **Header-Bar (Task-Steuerung & Drag-Zone):**
   * `TaskDragHandle` + Task-ID-Badge (`26-101`).
   * **Kleine Icon-Buttons:**
     * **Aktivieren/Deaktivieren:** `<Flame />`-Button (identisch zur `ListView`, bei erledigten Tasks ausgeblendet/deaktiviert).
     * **Erledigen / Erneut öffnen:** `<Check />`-Button (markiert offenen Task als erledigt) bzw. `<RotateCcw />`-Button (öffnet erledigten Task wieder).
   * **Task-Titel** (`TaskTitle` inline editierbar) + `<TaskChecklistBadge />` (falls Checklisten vorhanden).
   * **Datums-Zeile:**
     * **Konfiguriertes Startdatum:** `<TaskDate task={task} editor={dateEditor} />` (direkt per Klick editierbar).
     * **Berechnetes / Effektives Datum:** Anzeige von `task.calculatedStart` (falls durch Vorgänger/Aktiv-Status verschoben) bzw. `task.effectiveStart` mit Label (*„Konfiguriert: ... | Berechnet: ...“* in ISO-8601).
2. **Mittelteil (Flex-1, scrollbar): Tiptap-WYSIWYM-Editor (`TaskDescriptionEditor.tsx`):**
   * Nimmt den Hauptplatz ein.
   * Vollständiger Markdown-/HTML-Editor mit Checklisten, Mermaid-Live-Blöcken, Inline-Bildvorschau und anklickbaren URLs/Pfaden.
3. **Unterteil (feste/teilbare Höhe, z. B. `h-56`, scrollbar): Zeitgestempeltes Task-Log (`TaskLogSection.tsx`):**
   * Chronologische Liste der Log-Einträge (`YYYY-MM-DD HH:mm` in ISO-8601 + formatierter Text mit denselben URL-, Pfad- und Bild-Regeln wie im Editor).
   * Eingabezeile am unteren Rand (`Textarea`/`Input` + Senden-Button, `Enter` speichert neuen Log-Eintrag via `TASK_LOG_ADDED`, `Shift+Enter` für Zeilenumbruch).

### 4.3 Drag-Source & Drop-Target Verhalten des Containers
* **Drop-Target für andere Tasks:**
  * Das äußere Wurzel-Element von `TaskDetailPanel` erhält `...taskDragDropInteractions(task.id, 'detail-task:' + task.id, interactions)`.
  * Zieht man einen anderen Task `A` auf den Detail-Container des aktuellen Tasks `B`:
    * Normaler Drop → `onAddPredecessor(A, B)` (genau wie Drop auf den Listeneintrag von `B`).
    * `Alt`+Drop → `onRemoveDependencyBetween(A, B)` (inklusive `deletionPreview`-Highlighting).
    * Visuelles Feedback: Der Detail-Container zeigt denselben `amber`-Ring (`appearance === 'drop'`) wie ein Listeneintrag.
* **Drag-Source für den aktuellen Task (außerhalb des Editors):**
  * Da `taskDragDropInteractions` auch `data-task-drag={task.id}` setzt, startet ein Pointer-Drag auf allen freien Flächen, dem Header, der Datumszeile und dem Rahmen des Containers den gewohnten `taskPointerDrag` für den aktuellen Task.
  * Damit kann der aktuelle Task direkt aus dem Detail-Container heraus auf andere Tasks (Vorgänger setzen), auf Datumszeilen, auf die Wiedervorlage (`+1 Tag` etc.) oder in „Erledigte Tasks“ gezogen werden.
* **Schutz des Editors & Logs vor Task-Drag:**
  * Der Tiptap-Editor-Wrapper und der Log-Bereich erhalten das Attribut `data-task-selectable-text="true"`.
  * `taskPointerDrag.ts` prüft bereits in Zeile 93:
    `if (origin.closest('input,textarea,button,a,select,[contenteditable="true"],[data-task-selectable-text]')) return;`
  * Dadurch startet im Editor und im Log niemals versehentlich ein Task-Drag; Textauswahl und Cursor-Platzierung funktionieren flüssig.

---

## 5. Fokus- & Hotkey-Architektur (`useGlobalShortcuts.ts`)

Anforderung: *„Alle Hotkeys müssen weiterhin funktionieren, wenn der Container den Fokus hat. Wenn der Editor den Fokus hat, führen die Tastendrücke aber natürlich zu Texteingaben.“*

1. **Container hat Fokus (z. B. Klick auf Header, freien Bereich, Datum oder Rahmen):**
   * Das Wurzel-Element von `TaskDetailPanel` erhält `tabIndex={-1}` (oder `0`) und behält `selectedTaskId` aktiv.
   * In `useGlobalShortcuts.ts` gilt dort `isTextEntryFocused === false`.
   * Damit funktionieren **alle** globalen Hotkeys unverändert (`Space`/`A` = Aktivieren, `T` = Heute, `D`/`Del` = Erledigen, `F2`/`E`/`Enter` = Titel bearbeiten, `O` = Wieder öffnen, `ArrowUp`/`ArrowDown` = Task wechseln, `N` = Neuer Task, `Ctrl+Z`/`Ctrl+Y` = Global Undo/Redo, `Ctrl+M` = Mini-Modus).
2. **Editor (oder Log-Eingabefeld) hat Fokus:**
   * Tiptap rendert ein `<div contenteditable="true">`.
   * In `useGlobalShortcuts.ts` erkennt Zeile 90 (`target.isContentEditable`) automatisch `isTextEntryFocused === true`.
   * **Folge:** Buchstaben (`a`, `t`, `d`, `e`, `n`, `o`), `Space`, `Enter`, `Delete`, `Backspace`, `ArrowUp`/`ArrowDown`, `Home`/`End` und `Ctrl+Z`/`Ctrl+Y` werden von `useGlobalShortcuts` durchgelassen und führen im Tiptap-Editor zu normalen Texteingaben bzw. Editor-eigenem Undo/Redo.
   * **Escape im Editor:** Drückt der Nutzer im Editor `Escape`, ruft der Editor `editor.commands.blur()` auf und fokussiert den umgebenden Detail-Container (`panelRef.current?.focus()`), sodass sofort wieder alle Task-Hotkeys bereitstehen.

---

## 6. Tiptap-Editor-Architektur im Detail (`frontend/src/components/editor/`)

### 6.1 Neue NPM-Abhängigkeiten (minimal & gezielt)
In `frontend/package.json`:
* `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`
* `@tiptap/extension-task-list`, `@tiptap/extension-task-item`
* `@tiptap/extension-link`
* `tiptap-markdown` (für nahtlose Markdown-Serialisierung und Paste)
* `mermaid` (wird per `import('mermaid')` **lazy** geladen, damit der initiale App-Start schnell bleibt)

### 6.2 Copy & Paste: Markdown und HTML (`Strg+C` / `Strg+V`)
Anforderung: *„Markdown und HTML lässt sich ein- und auskopieren. HTML lässt sich einkopieren.“*
* **Strg+C (Kopieren aus dem Editor):**
  * ProseMirror schreibt bei `Strg+C` automatisch `text/html` (für Rich-Text-Ziele wie Word, E-Mail, Browser) in das Clipboard.
  * Über `editorProps.clipboardTextSerializer` überschreiben wir den `text/plain`-Kanal mit `editor.storage.markdown.serializer.serialize(slice.content)`.
  * Ergebnis: Fügt man in einen Rich-Text-Editor ein, erhält man formatiertes HTML; fügt man in einen Text-/Markdown-Editor (VS Code, Obsidian, Notepad) ein, erhält man sauberes GFM-Markdown.
* **Strg+V (Einfügen in den Editor):**
  * Enthält die Zwischenablage `text/html` (z. B. von einer Webseite oder aus Word), parst Tiptap das HTML direkt in das ProseMirror-Schema.
  * Enthält die Zwischenablage reinen Text (`text/plain`) mit Markdown-Syntax (`# `, `- [ ]`, ` ```mermaid `, `[Link](...)`), wandelt `tiptap-markdown` (`transformPastedText: true`) den Text beim Einfügen in formatierte Blöcke um.

### 6.3 Mermaid-Integration im Editor (`MermaidCodeBlockView.tsx`)
* Erweiterung des Standard-`CodeBlock`-Nodes über `ReactNodeViewRenderer`:
  * Ist `node.attrs.language === 'mermaid'`, rendert die NodeView standardmäßig das SVG-Diagramm (via dynamischem `import('mermaid')`, `securityLevel: 'strict'`).
  * Ein Klick auf den „Bearbeiten“-Button (oder Doppelklick auf das Diagramm) klappt direkt im Editor den Quelltext-Editor (oder eine Split-Ansicht Code + Live-Vorschau) auf.
  * Verlässt der Fokus den Mermaid-Block (`onBlur` / `Escape`), schließt sich der Quelltext-Bereich und das aktualisierte Diagramm wird angezeigt.

### 6.4 URLs, Dateipfade & Inline-Bildvorschau (`PathAndUrlExtension.ts`)
Für den Editor **und** die Log-Einträge wird ein gemeinsamer Tokenizer/Decorator genutzt:
1. **Erkennung (Regex / Link-Mark):**
   * **URLs:** `https?:\/\/[^\s<>"]+`
   * **Windows-Pfade:** `(?:[a-zA-Z]:\\|\\\\[^\s\\/:*?"<>|]+\\[^\s\\/:*?"<>|]+\\)(?:[^\s\\/:*?"<>|]+\\)*[^\s\\/:*?"<>|]*` (unterstützt auch Pfade in Anführungszeichen `"C:\Meine Ablage\..."` für Pfade mit Leerzeichen wie Google Drive).
2. **Interaktion & Attribute:**
   * Erkannte URLs erhalten `data-target-kind="url"` und `data-target-value={url}`.
     * **Linksklick:** Öffnet die URL im Standardbrowser (`eventBridge.openExternalURL(url)`).
     * **Rechtsklick:** Öffnet das kombinierte native Kontextmenü (Task-Aktionen + Separator + *„Im Browser öffnen“* + Editor-Aktionen).
   * Erkannte Windows-Pfade erhalten `data-target-kind="path"` und `data-target-value={path}`.
     * **Linksklick:** Öffnet den Pfad im Windows-Explorer (`eventBridge.openPathInExplorer(path)`).
     * **Rechtsklick:** Öffnet das kombinierte native Kontextmenü (Task-Aktionen + Separator + *„Im File-Explorer öffnen“*, *„In VSCode öffnen“* + Editor-Aktionen).
3. **Inline-Bilder für Bilddateipfade (`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`):**
   * Endet ein erkannter lokaler Dateipfad (oder ein Markdown-Bild `![](pfad)`) auf eine Bild-Endung, rendert ein Widget/NodeView direkt unterhalb bzw. inline ein `<img src={'/dodrag-media?taskId=' + encodeURIComponent(taskId) + '&path=' + encodeURIComponent(path)} loading="lazy" className="max-h-64 rounded-lg border border-slate-200 my-1.5 object-contain" />`.
   * Auch auf dem Inline-Bild selbst funktionieren Klick (öffnet Datei/Ordner im Explorer) und Rechtsklick (natives Kontextmenü mit Explorer/VSCode).

---

## 7. Geplante Dateistruktur (Neu & Geändert)

| Datei | Änderung |
| :--- | :--- |
| `wails.json`, `build/windows/info.json`, `build.ps1`, `AGENTS.md` | Version auf `0.2.0` anheben; `DragAndDrop.EnableFileDrop` aktivieren. |
| `main.go`, `app.go` | `EnableFileDrop: true` und `AssetServer.Middleware` für `/dodrag-media` registrieren; bei `TASK_COMPLETED` (inkl. Batch/Redo) Task-Vorschaubilder im Cache löschen; `ClearPreviewCache` & `OpenPreviewCacheInExplorer` bereitstellen. |
| `image_preview.go`, `image_preview_test.go` *(neu)* | HTTP-Handler `/dodrag-media`, SVG-Streaming, Task-bezogener Thumbnail-Generator in `%LOCALAPPDATA%\Temp\DoDrag\previews` sowie Cache-Bereinigung pro Task und gesamt. |
| `folders_windows.go`, `folders_windows_test.go` | `OpenPathInExplorer`, `OpenPathInVSCode`, `OpenExternalURL` für beliebige Datei-/Ordnerpfade & URLs. |
| `task_context_menu.go`, `task_context_menu_windows.go` | `Separator bool` in `TaskMenuItem` + `mfSeparator` in `trackTaskContextMenu`. |
| `internal/eventstore/commands.go`, `sqlite.go` | `TASK_DESCRIPTION_SET` (coalescable) und `TASK_LOG_ADDED` validieren und anwenden. |
| `frontend/package.json` | `@tiptap/*`, `tiptap-markdown`, `mermaid` ergänzen. |
| `frontend/src/domain/eventSchema.ts`, `commands.ts`, `projector.ts`, `types.ts` | Neue Events, `description`, `logEntries`, `checklistProgress` (`computeChecklistProgress`). |
| `frontend/src/bridge/eventBridge.ts` | Wails-Bindings für `openPathInExplorer`, `openPathInVSCode`, `openExternalURL`, `clearPreviewCache`, `openPreviewCacheInExplorer`, `onFileDrop`. |
| `frontend/src/components/SettingsModal.tsx` | Aktion „Cache löschen“ inkl. nativem Rechtsklick-Kontextmenü „Cache-Ordner im File-Explorer öffnen“. |
| `frontend/src/components/TaskChecklistBadge.tsx` *(neu)* | Fortschrittsanzeige `3/7` für `ListView`, `NetworkPlanView`, `GanttView`, `MiniCornerView`. |
| `frontend/src/components/TaskDetailPanel.tsx` *(neu)* | Ein-/ausblendbarer linker Detail-Container (Drag-Source, Drop-Target, Header-Icons, Datum, Editor, Log). |
| `frontend/src/components/editor/TaskDescriptionEditor.tsx` *(neu)* | Tiptap-Editor inkl. Markdown/HTML Copy-Paste, Checklisten, URL/Pfad-Decorator, Inline-Bilder. |
| `frontend/src/components/editor/MermaidBlockView.tsx` *(neu)* | Interaktive NodeView zum Rendern und In-Place-Bearbeiten von Mermaid-Diagrammen. |
| `frontend/src/components/TaskLogSection.tsx` *(neu)* | Zeitgestempeltes Kommentar-/Notiz-Log mit identischer URL-/Pfad-/Bild-Darstellung. |
| `frontend/src/i18n/locales/*.json` (alle 15 Sprachen) | Alle neuen UI-Texte, Tooltips und Kontextmenü-Einträge in allen 15 Frontend- & Backend-Katalogen. |

---

## 8. Verifikations- und Testplan für die Implementierungs-Session

1. **Go-Unit-Tests (`go test ./...`):**
   * Event-Replay & Coalescing für `TASK_DESCRIPTION_SET` und Undo/Redo für `TASK_LOG_ADDED`.
   * `validateTaskMenuItems` mit Separator-Einträgen.
   * Thumbnail-Generierung im Temp-Ordner für große JPG/PNG-Bilder, direktes Durchreichen kleiner Bilder/SVGs, automatische Bereinigung bei `TASK_COMPLETED` (`clearTaskPreviewCache`) sowie komplettes Leeren über `ClearPreviewCache`.
2. **Frontend-Unit-/DOM-Tests (`npm test` im lokalen Mirror):**
   * `computeChecklistProgress` (einzelne/mehrere Checklisten, Codeblock-Ignorierung, `3/7`-Badge in allen Ansichten).
   * URL- und Windows-Pfad-Parser (inkl. Laufwerksbuchstaben `C:\`, `G:\Meine Ablage\...` und UNC-Pfaden `\\Server\Share`).
   * Fokus-Wechsel zwischen Detail-Container (Hotkeys aktiv) und Tiptap-Editor (Tastendrücke geben Text ein).
   * Drag & Drop von Tasks auf den Detail-Container (Vorgänger setzen / Alt-Löschen) und Ziehen des aktuellen Tasks aus dem Detail-Container heraus.
   * Einstellungsdialog (`SettingsModal`): Klick auf „Cache löschen“ und Rechtsklick-Kontextmenü „Cache-Ordner im File-Explorer öffnen“.
   * i18n-Vollständigkeitstest über alle 15 Sprachkataloge.
3. **Packaging (`./build.ps1`):**
   * Vollständiger Build mit `GOTOOLCHAIN=go1.23.12` und Bereitstellung der aktuellen `dodrag.exe` im Projektstamm.
