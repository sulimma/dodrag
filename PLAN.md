# DoDrag – Architektur- & Implementierungsplan

Eine Drag-and-Drop-basierte TODO-App für kleine Aufgaben mit internen und externen Abhängigkeiten sowie einem schnellen Wiedervorlage-System.

## 1. Tech-Stack & Architektur

- **Backend**: **Wails v2 + Go + SQLite** (`modernc.org/sqlite`, CGO-frei unter Windows).
- **Event-Sourcing Store**: Alle Zustandsänderungen werden als unveränderliche Events in SQLite (`events`-Tabelle) gespeichert. Undo/Redo toggelt das `undone`-Flag des jeweils letzten Events und berechnet den Zustand deterministisch neu.
- **Frontend**: **React 18 + TypeScript + Tailwind CSS + Framer Motion** (für flüssige, stabile Layout-Animationen bei Listenänderungen).
- **Dual-Mode Laufzeit**: Läuft nativ als Wails-Desktop-App mit SQLite und besitzt zusätzlich eine Browser-Fallback-Brücke (`localStorage` Event-Log), damit das Frontend auch direkt mit `npm run dev` im Browser getestet werden kann.

## 2. Datenmodell & Berechnungsregeln

### 2.1 Task-ID (`YY-N`)
- Format: Zweistelliges Jahr ohne Hunderter + Bindestrich + laufende Ganzzahl, z. B. `26-1`, `26-125`.

### 2.2 Konfiguriertes vs. Berechnetes Startdatum
- **Konfiguriertes Startdatum (`configuredStart`)**: Vom Nutzer per Drag-and-Drop auf ein Datum oder ein Wiedervorlage-Target gesetzt.
- **Berechnetes Startdatum (`calculatedStart`)**: Liegt **einen Tag (+1 Kalendertag)** nach dem spätesten effektiven Startdatum aller offenen Vorgänger:
  $$\text{calculatedStart}(T) = \max_{P \in \text{preds}(T)} \big(\text{effectiveStart}(P)\big) + 1\text{ Tag}$$
- **Effektives Startdatum (`effectiveStart`)**:
  $$\text{effectiveStart}(T) = \max\big(\text{configuredStart}(T),\ \text{calculatedStart}(T)\big)$$

### 2.3 Stabile Topologische Sortierung & Datums-Kollabierung
1. **Topologische Reihenfolge**: Jeder Task erscheint nach all seinen offenen Vorgängern und nach dem Datums-Marker seines effektiven Startdatums.
2. **Stabilität**: Nicht betroffene Tasks behalten bei Änderungen garantiert ihre relative Reihenfolge (Tie-Breaker über ursprüngliche Sequenznummer).
3. **Datums-Kollabierung**: Folgen mehrere Datumseinträge unmittelbar ohne dazwischenliegenden Task aufeinander, wird **nur der späteste** Datumseintrag angezeigt.

## 3. Bedienung & Visuelles System

- **Drag Task $\rightarrow$ Datum**: Setzt `configuredStart` auf dieses Datum.
- **Drag Task A $\rightarrow$ Task B**: Macht Zieltask B zum Vorgänger des gezogenen Tasks A (mit automatischer Zyklus-Prüfung).
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
- **In-Place Editing**: Direktes Bearbeiten des Task-Titels per Klick auf das Textfeld, Doppelklick oder `F2`/`Enter`.
