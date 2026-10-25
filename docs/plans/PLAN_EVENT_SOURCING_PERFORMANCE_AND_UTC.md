# Architektur- und Implementierungsplan: Event-Sourcing Performance (B1 & B2), Striktes UTC & `seq`-basierte Log-Reihenfolge

Dieser Plan beschreibt vier eng verzahnte Verbesserungen am Event-Store (`internal/eventstore`) und an der Frontend-Domain (`frontend/src/domain`, `frontend/src/bridge`):

1. **Log-Einträge strikt in Erzeugungsreihenfolge (`seq`) statt Uhrzeit-Sortierung** ($O(1)$ beim Anhängen, immun gegen verstellte Systemuhren).
2. **Striktes UTC (`Z`) für Erfassungszeitstempel (`createdAt`, `completedAt`, `event.Timestamp`) in der Datenbank**, während die Umrechnung in die lokale Zeitzone ausschließlich bei der Anzeige (`formatDate`) erfolgt.
3. **Performance B1: In-Memory-Projektion im Go-Store & inkrementelles Replay / Delta-Transport** (vermeidet $O(E)$-Voll-Replays und Voll-Serialisierung über Wails bei jedem Schreibvorgang).
4. **Performance B2: Persistente Snapshots (Checkpoints) in SQLite** (beschleunigt Kaltstart, Datenbankwechsel und tiefe `Undo`/`Redo`-Operationen bei großen Event-Historien auf $O(\Delta E)$).

---

## 1. Log-Reihenfolge nach Event-Sequenz (`seq`) statt `createdAt`-Sortierung

### 1.1 Fachliche Regel
* Log-Einträge (`TASK_LOG_ADDED`) werden in genau der Reihenfolge angezeigt, in der sie als Events erzeugt wurden (`ORDER BY seq ASC`).
* Das Feld `payload.createdAt` dient ausschließlich zur Anzeige des Zeitpunkts in der UI (`TaskLogSection.tsx`), niemals als Sortierschlüssel. Selbst wenn die Systemuhr zwischen zwei Einträgen verstellt wurde, bleibt die Reihenfolge der Erstellung erhalten.

### 1.2 Änderungen im Code
* **Go (`internal/eventstore/commands.go`):**
  * In `applyValidatedCommand` (Case `"TASK_LOG_ADDED"`, Zeilen 144–156) den `sort.SliceStable`-Block ersatzlos entfernen.
  * Neuen Eintrag nach der Duplikatprüfung (`entry.id == entryID`) direkt per `t.logEntries = append(t.logEntries, ...)` anhängen ($O(1)$).
  * Den nicht mehr benötigten `"sort"`-Import in `internal/eventstore/commands.go` entfernen.
* **TypeScript (`frontend/src/domain/commands.ts`):**
  * In `applyCommand` (Case `'TASK_LOG_ADDED'`, Zeilen 106–119) den `task.logEntries.sort(...)`-Aufruf samt Regex-Sub-Millisekunden-Parser ersatzlos entfernen.
  * Neuen Eintrag direkt per `task.logEntries.push({ id: entryId, text, createdAt })` anhängen ($O(1)$).
* **Tests anpassen:**
  * `internal/eventstore/details_test.go` (`TestTaskDetailsReplayCoalescingAndHistory`): Erwartete Reihenfolge auf Einfügereihenfolge (`want := notes`, nach `Undo` `notes[:3]`) umstellen.
  * `frontend/src/domain/details.test.ts`: Erwartete ID-Reihenfolge auf Einfügereihenfolge (`['late', 'nano2', 'nano1', 'tie']` bzw. nach `Undo` `['late', 'nano2', 'nano1']`) umstellen.

---

## 2. Striktes UTC (`Z`) in der Datenbank und lokale Zeitzone nur bei der Anzeige

### 2.1 Fachliche Regel
* **Erfassungszeitpunkte (`createdAt`, `completedAt`, `event.Timestamp`)** sind echte Zeitpunkte (Instants) und werden in SQLite ausnahmslos in **UTC mit Suffix `Z`** gespeichert (z. B. `2026-10-25T17:10:00Z` oder `2026-10-25T17:10:00.123456789Z`). Gemischte Zeitzonen-Offsets (`+02:00`, `-05:00`) werden für diese Felder nicht mehr in die Datenbank geschrieben.
* **Geplante Starttermine (`configuredStart`)** repräsentieren vom Nutzer gewählte lokale Kalendertage/Uhrzeiten (`localDate(y, m, d, 9, 0)` $\rightarrow$ `.toISOString()` im Frontend bzw. `today.Format(time.RFC3339)` beim Seeding). Damit bestehende Datenbanken und Kalendertests kompatibel bleiben, darf `configuredStart` weiterhin RFC3339 (bzw. UTC-ISO aus `.toISOString()`) verwenden, während für `createdAt`, `completedAt` und `event.Timestamp` striktes UTC (`Z`) gilt.
* **Anzeige im UI:** Unverändert über `formatDate(entry.createdAt, { hour: '2-digit', minute: '2-digit' })` in `frontend/src/i18n/index.ts` und `TaskLogSection.tsx`, welches den UTC-String via `new Date(value)` in die aktuelle lokale Zeitzone des Betriebssystems umrechnet.

### 2.2 Änderungen im Code
* **Go-Seeding (`internal/eventstore/sqlite.go`):**
  * In `seedIfEmpty` (Zeilen 374, 392, 410, 420, 430, 440) alle `createdAt`-Werte mit `.UTC().Format(time.RFC3339)` erzeugen (analog zu `ts := now.Add(...).UTC().Format(time.RFC3339Nano)` in Zeile 466).
* **Go-Validierung (`internal/eventstore/sqlite.go` & `commands.go`):**
  * Neue Hilfsfunktion `parseUTCEventTime(ts string) (time.Time, error)`:
    * Prüft `parseEventTime(ts)` **und** verlangt `strings.HasSuffix(ts, "Z")`.
  * In `readEvents` (`sqlite.go:230`): `ev.Timestamp` mit `parseUTCEventTime` (oder bei Bestandsdatenbanken durch Normalisierung beim Lesen/Schreiben, sofern Alt-DBs unterstützt werden sollen; bei strikter Validierung über `parseUTCEventTime`) prüfen.
  * In `validatePayload` (`commands.go:106-110`):
    * Für `field == "createdAt"` und `field == "completedAt"` zwingend `parseUTCEventTime(value)` (Endung `Z`) verlangen.
    * Für `field == "configuredStart"` weiterhin `parseEventTime(value)` nutzen.
* **TypeScript-Schema (`frontend/src/domain/eventSchema.ts`):**
  * Zusätzlich zu `timestamp` einen Validator `utcTimestamp` definieren:
    ```ts
    const utcTimestamp = v.pipe(
      timestamp,
      v.check(value => value.endsWith('Z'))
    );
    ```
  * In `CommandSchema` für `TASK_CREATED.payload.createdAt`, `TASK_LOG_ADDED.payload.createdAt`, `TASK_COMPLETED.payload.completedAt` sowie in `parseStoredEvent` für `metadata.timestamp` `utcTimestamp` verwenden.
* **Tests anpassen:**
  * In `internal/eventstore/details_test.go` und `frontend/src/domain/details.test.ts`:
    * Expliziten Negativtest aufnehmen, dass `TASK_LOG_ADDED` und `TASK_CREATED` mit `+02:00` in `createdAt` abgelehnt werden.
    * In den Positivtests für `TASK_LOG_ADDED` ausschließlich `Z`-Zeitstempel verwenden.
  * In `internal/eventstore/commands_test.go` (`TestPersistedTimestampConformance`) und `frontend/src/domain/commands.test.ts`:
    * Zwischen `configuredStart` (allgemeiner RFC3339-Timestamp) und `createdAt` / `event.timestamp` (striktes UTC `Z`) unterscheiden.

---

## 3. Performance B1: In-Memory-State im Go-Store & Inkrementelles Replay

### 3.1 Problemstellung im Ist-Zustand
1. **Go-Backend (`internal/eventstore/commands.go`):**
   * `AppendBatch` ruft vor jedem Schreiben `s.readReplay(s.db)` auf (liest und parst alle $E$ Events aus SQLite) und ruft nach dem `COMMIT` erneut `s.readEvents(s.db)` auf.
   * `Undo` und `Redo` (`sqlite.go:310, 328`) rufen `readReplay` zweimal pro Transaktion auf.
2. **Frontend & Bridge (`frontend/src/bridge/eventBridge.ts`, `frontend/src/domain/commands.ts`):**
   * Bei jeder Mutation wird das komplette `[]Event`-Array von Go nach JS serialisiert.
   * `normalizeEvents` und `replayCommands` iterieren im Frontend jedes Mal wieder bei Index 0 über alle $E$ Events, weil das zurückgegebene Array eine neue Referenz hat (`WeakMap`-Cache greift nur bei identischer Array-Referenz während des Minuten-Ticks).

### 3.2 Zielarchitektur B1 (Go-Backend)
`Store` (`internal/eventstore/sqlite.go`) hält den bereits verifizierten Zustand im Speicher (da `App` den Zugriff über `a.mu` serialisiert und SQLite exklusiv pro Store-Instanz genutzt wird):

```go
type Store struct {
	db      *sql.DB
	groupID string
	// Gecachter verifizierter Zustand:
	events []Event
	tasks  map[string]*task
	ids    map[string]bool
}
```

1. **Initialisierung (`NewStoreWithOptions`):**
   * Lädt einmalig beim Öffnen über `readReplay` (bzw. ab Snapshot aus B2) `s.events`, `s.tasks` und `s.ids`.
2. **Schnelles `GetEvents()`:**
   * Gibt eine flache Kopie von `s.events` zurück ($O(E)$ Slice-Copy ohne SQLite-I/O, ohne JSON-Decoding, ohne Regex-Parsing).
3. **Inkrementelles `AppendBatch(commands []Command)` ($O(\text{len(commands)})$ statt $O(E)$):**
   * Arbeitet auf einer Arbeitskopie `workingTasks := cloneTasks(s.tasks)` (oder klont nur die von `commands` berührten Tasks per Copy-on-Write).
   * Prüft `s.ids[command.ID]` in $O(1)$.
   * Validiert und wendet nur die neuen `commands` auf `workingTasks` an (`applyCommand` inkl. Zyklusprüfung bei `DEPENDENCY_ADDED`).
   * Schreibt in der SQLite-Transaktion:
     * Falls `s.hasUndoneEvents()` wahr ist: `DELETE FROM events WHERE undone = 1` und Kürzen der `undone`-Einträge aus dem gecachten Slice.
     * Bei Coalescing (`UPDATE events SET payload = ?, timestamp = ? WHERE seq = ?`): Aktualisiert das letzte Element in `s.events` direkt im Speicher.
     * Bei `INSERT INTO events ...`: Ermittelt `seq` über `res.LastInsertId()` und hängt das neue `Event` direkt an `s.events` an.
   * Nach erfolgreichem `tx.Commit()`: Übernimmt `s.tasks = workingTasks`, aktualisiert `s.ids` und `s.groupID`. Kein erneutes `s.readEvents(s.db)` nötig.

### 3.3 Zielarchitektur B1 (Frontend-Inkremental-Cache & optionaler Delta-Transport)
* **Stufe 1 (Inkrementelles `replayCommands` im Frontend ohne Wails-API-Bruch):**
  * In `frontend/src/domain/commands.ts` speichert ein Modul-Cache das letzte `(events, ReplayState)`-Paar inkl. der letzten aktiven Sequenznummer `lastActiveSeq`.
  * Wenn `normalizeEvents` / `replayCommands` mit einem neuen Array aufgerufen wird, das ein Präfix-Erweiterung (Append) oder eine Coalescing-Änderung des letzten Events ist:
    * Nur die neuen Events ab `prevEvents.length` mit `parseStoredEvent` parsen (bestehende Event-Objekte über `seq`/`id`/`timestamp` wiederverwenden).
    * Bei reinem Append (und keinem neuen `undone`-Flag in älteren Events) `copyReplayTasks(prevState)` nutzen und `applyCommand` nur für die neu hinzugekommenen Events ausführen.
* **Stufe 2 (Delta-API über Wails-Bridge für große Historien):**
  * Neue Go-Methode `AppendBatchDelta(afterSeq int64, commands []eventstore.Command) (EventDelta, error)`:
    ```go
    type EventDelta struct {
        Reset         bool    `json:"reset,omitempty"` // true falls Fallback/DB-Wechsel
        PrunedUndone  bool    `json:"prunedUndone,omitempty"`
        CoalescedLast *Event  `json:"coalescedLast,omitempty"`
        Appended      []Event `json:"appended,omitempty"`
    }
    ```
  * Dadurch schickt Go bei einer Tiptap-Beschreibungsänderung (`256 KB`) oder einem neuen Task nur noch **1 einziges Event** über die Wails-IPC-Bridge statt der gesamten Datenbankhistorie.

---

## 4. Performance B2: Persistente Snapshots (Checkpoints) in SQLite

### 4.1 Wann greift B2?
Während B1 alle laufenden `AppendBatch`-Operationen auf $O(1)$ bzw. $O(\text{Batch})$ beschleunigt, benötigt das System weiterhin ein Replay, wenn:
1. Die App neu startet oder die Datenbank gewechselt wird (`NewStoreWithOptions`).
2. Ein `Undo` oder `Redo` ausgeführt wird (da DoDrag kein inverses Command-Log führt, sondern den Zustand bis zum Zielpunkt abspielt).

Mit einer Snapshot-Tabelle in SQLite muss bei beiden Vorgängen nicht mehr ab `seq = 1`, sondern nur noch ab dem letzten gültigen Snapshot vor dem Zielpunkt abgespielt werden.

### 4.2 Datenbankschema (abwärtskompatibel & additiv)
In `internal/eventstore/sqlite.go` (`NewStoreWithOptions` / `validateSchema`):
```sql
CREATE TABLE IF NOT EXISTS event_snapshots (
    seq INTEGER PRIMARY KEY,
    state_json TEXT NOT NULL
);
```
* **Keine Änderung an der bestehenden `events`-Tabelle:** Ältere oder extern geprüfte `events`-Tabellen bleiben zu 100 % kompatibel; `event_snapshots` ist ein reiner abgeleiteter Cache in derselben SQLite-Datei.
* `state_json` serialisiert `map[string]*task` (inkl. `title`, `start`, `description`, `logEntries`, `active`, `completed`, `predecessors`).

### 4.3 Snapshot-Lebenszyklus
1. **Schwellenwert (`snapshotInterval = 500` aktive Events):**
   * Sobald in `AppendBatch` die Anzahl aktiver Events seit dem letzten Snapshot `>= 500` erreicht (und keine `undone`-Events vor `lastSeq` liegen), wird innerhalb derselben Transaktion ein Snapshot für `lastSeq` geschrieben:
     `INSERT OR REPLACE INTO event_snapshots (seq, state_json) VALUES (?, ?)`.
   * Um den Speicherplatz zu begrenzen, werden alte Snapshots ausgedünnt (z. B. nur die letzten 5 Snapshots + jeder 5.000ste Snapshot behalten).
2. **Invalidierung bei `Undo` und Coalescing:**
   * Wird bei Coalescing das Event mit `seq = S` überschrieben oder werden bei `Undo` Events ab `seq = S` auf `undone = 1` gesetzt, löscht die Transaktion alle Snapshots ab diesem Punkt:
     `DELETE FROM event_snapshots WHERE seq >= ?` (`S`).
3. **Schnelles Replay mit Snapshot (`readReplayFromSnapshot`):**
   * Ermittelt die kleinste Sequenznummer eines `undone = 1`-Events (`firstUndoneSeq`).
   * Existiert kein `undone = 1`-Event, wird der neueste Snapshot `SELECT seq, state_json FROM event_snapshots ORDER BY seq DESC LIMIT 1` geladen.
   * Existiert ein `undone = 1`-Event (z. B. während `Undo`/`Redo`), wird der neueste Snapshot geladen, dessen `seq < firstUndoneSeq` ist (`WHERE seq < ? ORDER BY seq DESC LIMIT 1`), da sich vor dem ersten `undone`-Event nur aktive Events befinden.
   * Anschließend werden für die Zustandsberechnung (`tasks`) nur noch die Events mit `seq > snapshot.seq` angewendet ($O(\Delta E)$ statt $O(E)$).

---

## 5. Betroffene Dateien im Überblick

| Datei | Geplante Änderung |
| :--- | :--- |
| `internal/eventstore/sqlite.go` | 1. `seedIfEmpty`: `createdAt` mit `.UTC().Format(time.RFC3339)` erzeugen.<br>2. `parseUTCEventTime`: UTC-Zwang (`Z`) für `event.Timestamp`, `createdAt`, `completedAt`.<br>3. **B1:** In-Memory-Cache (`events`, `tasks`, `ids`) im `Store`-Struct verwalten.<br>4. **B2:** Tabelle `event_snapshots` anlegen, beim Replay jüngsten Snapshot vor dem ersten `undone`-Event nutzen, bei `Undo`/Coalescing Snapshots mit `seq >= targetSeq` invalidieren. |
| `internal/eventstore/commands.go` | 1. `"TASK_LOG_ADDED"`: `sort.SliceStable` entfernen, reines `append` ($O(1)$).<br>2. `validatePayload`: `createdAt` und `completedAt` via `parseUTCEventTime` auf Suffix `Z` prüfen.<br>3. **B1:** `AppendBatch` nutzt den gecachten Zustand aus `Store`, wendet nur neue Commands an und schreibt alle periodischen Snapshots (**B2**). |
| `internal/eventstore/details_test.go` | Log-Tests auf Einfügereihenfolge (`seq`) und striktes UTC (`Z`) umstellen; Negativtest für Nicht-UTC-`createdAt` ergänzen. |
| `internal/eventstore/commands_test.go` | `TestPersistedTimestampConformance` für UTC-Pflicht bei `createdAt`/`timestamp` vs. `configuredStart` anpassen. |
| `internal/eventstore/benchmark_test.go` *(neu)* | Benchmarks für `AppendBatch`, `Undo`/`Redo` und `NewStoreWithOptions` bei 10.000+ Events (inkl. `TASK_DESCRIPTION_SET` und `TASK_LOG_ADDED`) mit und ohne Snapshot. |
| `frontend/src/domain/eventSchema.ts` | `utcTimestamp` (`endsWith('Z')`) für `createdAt`, `completedAt` und `StoredEvent.timestamp` einführen. |
| `frontend/src/domain/commands.ts` | 1. `'TASK_LOG_ADDED'`: `task.logEntries.sort(...)` entfernen, reines `push` ($O(1)$).<br>2. **B1:** Inkrementelles Replay bei Append/Coalescing auf Basis des vorherigen `ReplayState`. |
| `frontend/src/bridge/eventBridge.ts` | **B1:** Wiederverwendung bereits geparster `StoredEvent`-Instanzen bei inkrementellen Updates (optional `AppendBatchDelta`-Anbindung). |
| `frontend/src/domain/details.test.ts` | Log-Reihenfolge auf `seq` umstellen; Negativtest für Nicht-UTC-`createdAt` ergänzen. |
| `frontend/src/domain/commands.test.ts` | Timestamp-Konformitätstest auf `utcTimestamp` für `createdAt`/`timestamp` aktualisieren. |

---

## 6. Empfohlene Umsetzungsreihenfolge (nach Abschluss des laufenden Tasks)

1. **Schritt 1 (Fachlogik & Datenformat):**
   * `seq`-Reihenfolge für `TASK_LOG_ADDED` (Sortierung in `commands.go` & `commands.ts` entfernen).
   * Striktes UTC (`Z`) für `createdAt`, `completedAt` und `event.Timestamp` in `sqlite.go`, `commands.go` und `eventSchema.ts` aktivieren und Unit-Tests (`details_test.go`, `commands_test.go`, `details.test.ts`, `commands.test.ts`) aktualisieren.
2. **Schritt 2 (Performance B1 – In-Memory-State & Inkrementelles Replay):**
   * Gecachten Zustand (`events`, `tasks`, `ids`) in `internal/eventstore` und inkrementelles Replay in `frontend/src/domain/commands.ts` implementieren.
   * Sicherstellen, dass alle bestehenden Fehler- und Rollback-Tests (`TestValidatedMutations`, `TestMixedEditGroupBoundaries`, `TestReplayFinalTopologyAndHistoryTargets`) unverändert grün bleiben (ein fehlgeschlagener Batch darf den In-Memory-Cache niemals mutieren).
3. **Schritt 3 (Performance B2 – SQLite-Snapshots):**
   * `event_snapshots`-Tabelle und Snapshot-Replay/Invalidierung in `sqlite.go` ergänzen.
   * Dedizierten Test schreiben, der verifiziert, dass `readReplay` mit Snapshot bei 5.000 Events (inkl. `Undo`, `Redo`, Coalescing und Beschreibungen) bitgenau denselben `tasks`-Zustand liefert wie ein Replay ohne Snapshot.
4. **Schritt 4 (Build & End-to-End-Verifikation):**
   * Frontend-Mirror synchronisieren, `npm test` und `tsc --noEmit` ausführen, `go test ./...` inkl. Benchmarks prüfen und abschließend `./build.ps1` für die aktuelle `dodrag.exe` durchlaufen lassen.
