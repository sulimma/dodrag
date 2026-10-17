# DoDrag – Architektur- & Implementierungsplan

Eine Drag-and-Drop-basierte TODO-App für kleine Aufgaben mit internen und externen Abhängigkeiten sowie einem schnellen Wiedervorlage-System.

## 1. Tech-Stack & Architektur

- **Backend**: **Wails v2 + Go + SQLite** (`modernc.org/sqlite`, CGO-frei unter Windows).
- **Event-Sourcing Store**: Zustandsänderungen werden als Events in SQLite (`events`-Tabelle) angehängt. Bei explizit gruppierten Titel-, Datums- und Aktivierungsedits darf der letzte passende Payload zusammengeführt werden. Undo/Redo markiert das letzte Event beziehungsweise seine Gruppe über `undone` und berechnet den Zustand deterministisch neu.
- **Frontend**: **React 18 + TypeScript + Tailwind CSS + Framer Motion** (für flüssige, stabile Layout-Animationen bei Listenänderungen).
- **Dual-Mode Laufzeit**: Läuft nativ als Wails-Desktop-App mit SQLite und besitzt zusätzlich eine Browser-Fallback-Brücke (`localStorage` Event-Log), damit das Frontend auch direkt mit `npm run dev` im Browser getestet werden kann.

### 1.1 Frontend-Zuständigkeiten und Interaktionsvertrag
- `App.tsx` verbindet Zustand, Hooks und Oberfläche. `hooks/` kapselt Auswahl, Drag, Mutationen, Editoren, Datenbanksnapshots und globale Tastenkürzel. `components/` enthält Toolbar, Seitenleiste, Kontext-/Hilfedialoge sowie Listen-, Netzplan- und Gantt-Ansicht.
- `components/taskInteractions.ts` definiert den typisierten Interaktionsvertrag, den alle drei Task-Ansichten verwenden. So teilen Auswahl, Dragstart/-ende, Abhängigkeitsaktionen und Kontextmenü dieselben Handler.
- `domain/` enthält Commands, Event-Schema, Projektion, Abhängigkeitspfade und Topologie; `bridge/eventBridge.ts` verbindet diese Befehle mit dem nativen Wails-Backend oder dem Browser-Fallback.
- Beim Replay werden Events zunächst in Reihenfolge angewandt und anschließend die finale Abhängigkeitstopologie einmal validiert; es gibt keine Zyklensuche pro historischem Event. Neue Kommandos werden vor dem Speichern auf dem replayten Zustand geprüft.

## 2. Datenmodell & Berechnungsregeln

### 2.1 Task-ID (`YY-N`)
- Format: Zweistelliges Jahr ohne Hunderter + Bindestrich + laufende Ganzzahl, z. B. `26-1`, `26-125`.

### 2.2 Konfiguriertes vs. Berechnetes Startdatum
- **Konfiguriertes Startdatum (`configuredStart`)**: Vom Nutzer per Drag-and-Drop auf ein Datum oder ein Wiedervorlage-Target gesetzt.
- **Berechnetes Startdatum (`calculatedStart`)**: Liegt **einen Tag (+1 Kalendertag)** nach dem spätesten effektiven Startdatum aller offenen Vorgänger:
  $$\text{calculatedStart}(T) = \max_{P \in \text{preds}(T)} \big(\text{effectiveStart}(P)\big) + 1\text{ Tag}$$
- **Effektives Startdatum (`effectiveStart`)**:
  $$\text{effectiveStart}(T) = \max\big(\text{configuredStart}(T),\ \text{calculatedStart}(T)\big)$$

### 2.3 Task-Sortierung, Netzplanlevels & Datums-Kollabierung
1. **Task-Reihenfolge**: Offene und erledigte Tasks werden nach `effectiveStart` aufsteigend, bei gleichem Zeitpunkt nach Task-ID aufsteigend sortiert.
2. **Netzplan**: Innerhalb jedes Tagesbands bestimmen alle gleichbandigen Vorgänger das topologische Level eines Tasks. Levels erscheinen nacheinander; innerhalb eines Levels bleibt die Task-Reihenfolge aus `effectiveStart` und Task-ID erhalten. Ein Level wird vor dem nächsten in verfügbare Spalten umgebrochen.
3. **Datums-Kollabierung**: Folgen mehrere Datumseinträge unmittelbar ohne dazwischenliegenden Task aufeinander, wird **nur der späteste** Datumseintrag angezeigt.

## 3. Bedienung & Visuelles System

- **Drag Task $\rightarrow$ Datum**: Setzt `configuredStart` auf dieses Datum.
- **Drag Task A $\rightarrow$ Task B**: Macht Zieltask B zum Vorgänger des gezogenen Tasks A. In der UI: den abhängigen Task auf seinen Vorgänger ziehen (A auf B ergibt B $\rightarrow$ A).
- **Shift-Drag Task A $\rightarrow$ Task B**: Löst an A gespeicherte Vorgänger- oder Nachfolgerkanten in Richtung B; der ganze Pfad wird nicht entfernt.
- **Drag Task $\rightarrow$ Seitenleisten-Targets**:
  - `+2 Stunden`, `+1 Tag`, `nächste Woche`, `+7 Tage`, `nächsten Monat`
  - `Erledigt` (schließt den Task ab und gibt abhängige Nachfolger frei)
- **Blasse Darstellung**: Tasks mit Startdatum in der Zukunft (`effectiveStart > jetzt`) oder mit offenen Vorgängern werden automatisch blasser dargestellt.
- **Transitives Highlighting bei Klick**:
  - **Ausgewählter Task**: Farbe 1 (Cyan/Blau)
  - **Alle Vorgänger (direkt & transitiv)**: Farbe 2 (Amber/Orange)
  - **Alle Nachfolger (direkt & transitiv)**: Farbe 3 (Violett/Fuchsia)
- **Aktivieren / Deaktivieren (für Tasks ohne Vorgänger)**:
  - Über **Rechtsklick-Kontextmenü** oder **Keyboard-Shortcut (`Space` / `A`)** dauerhaft deutlich hervorheben (Smaragd/Grün-Akzent).
- **In-Place Editing**: Task-Titel per Doppelklick oder mit `F2`/`E`/`Enter` bearbeiten; ein einfacher Klick startet keine Titelbearbeitung.
