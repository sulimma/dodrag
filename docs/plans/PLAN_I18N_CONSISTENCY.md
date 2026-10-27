# Plan zur Verbesserung der Übersetzungskonsistenz in allen 15 Sprachen

## 1. Ausgangslage und Problemstellung

DoDrag unterstützt 15 UI-Sprachen (`de`, `en`, `fr`, `es`, `zh-CN`, `uk`, `pt-BR`, `ja`, `zh-TW`, `ko`, `it`, `pl`, `tr`, `eo`, `tok`) mit jeweils einem Frontend-Katalog (`frontend/src/i18n/locales/<lang>.json`) und einem Backend-Katalog (`frontend/src/i18n/locales/backend-<lang>.json`).

Bisherige automatisierte Tests (`frontend/src/i18n/i18n.test.ts` und `backend_i18n_test.go`) prüfen strukturelle Parität:
- Vorhandensein aller Schlüssel in allen Katalogen
- Nicht-leere Übersetzungswerte
- Exakte Übereinstimmung von `{platzhalter}`-Parametern

Wie das Feedback aus der Toki-Pona-Community zeigt, verhindern reine Strukturprüfungen jedoch keine **semantische und terminologische Drift**, die bei KI-gestützten Übersetzungen ohne festes Priming typisch ist:
1. **Inkonsistente Fachbegriffe:** Zentrale Konzepte der App (z. B. *Task*, *Details*, *Beschreibung*, *Log*, *Vorgänger*, *Kante*, *Datenbank*, *Wiedervorlage*, *Kompaktansicht*, *Mermaid-Diagramm*) werden innerhalb derselben Sprache unterschiedlich übersetzt, je nachdem in welchem Satzkontext sie auftauchen.
2. **Schachtelsätze (Bandwurmsätze):** Komplexe deutsche Ausgangssätze (z. B. Tooltips für Drag-and-Drop, Hilfetexte oder mehrteilige Fehlermeldungen) werden Satzbau-getreu übernommen, was besonders in analytischen oder minimalistischen Sprachen (wie Toki Pona), aber auch auf kleinen UI-Flächen schwer verständlich ist.
3. **Fehlender UI-Kontext beim Übersetzen:** Ohne Hinweis, ob ein String ein kurzer Button, ein Tabellen-Header, ein Status-Badge oder ein erklärender Hilfetext ist, wählen Sprachmodelle teils nominale, teils verbale oder unnötig ausschweifende Formen.
4. **Komplizierte Quelltext-Formulierungen:** Wenn bereits der deutsche Ausgangstext unnötig bürokratisch oder verschachtelt formuliert ist, multipliziert sich diese Komplexität in allen 14 Zielsprachen.

---

## 2. Zielarchitektur für konsistente Lokalisierung

Um die Übersetzungsqualität dauerhaft und wartbar abzusichern, wird ein dreistufiges System eingeführt:

1. **Verbindliche Terminologie-Wörterbücher (Glossare) pro Sprache**
2. **Stil- und Satzbauregeln („Einfache Sprache“-Prinzip für UI-Texte)**
3. **Automatisierte Konsistenz- und Glossar-Prüfungen in der Test-Pipeline**

---

## 3. Maßnahmen im Detail

### 3.1 Aufbau eines zentralen Domänen-Glossars (`frontend/src/i18n/glossary.json`)

Für die rund 35–40 tragenden Kernbegriffe von DoDrag wird eine kanonische Begriffstabelle angelegt, die für jede der 15 Sprachen den exakt zu verwendenden Zielbegriff festlegt.

#### Kernbegriffe (Auszug)

| Konzept (DE) | Kontext / Bedeutung | Beispiel `en` | Beispiel `tok` |
|---|---|---|---|
| **Task / Aufgabe** | Einzelner Arbeitspunkt in Liste, Netzplan, Gantt | task | pali |
| **Vorgänger** | Vorbedingung eines Tasks (`B → A`) | predecessor | pali monsi |
| **Nachfolger** | Abhängiger Task | successor | pali sinpin |
| **Kante / Abhängigkeit** | Gerichtete Verbindung zwischen zwei Tasks | dependency / edge | linja |
| **Startdatum** | Konfiguriertes oder berechnetes Datum | start date | tenpo open |
| **Wiedervorlage** | Schnellauswahl für zukünftiges Startdatum | snooze / resubmit | tenpo sin |
| **Details / Task-Details** | Seitenpanel mit Metadaten, Beschreibung, Log | details | sona insa |
| **Beschreibung** | Markdown-Freitext zum Task | description | lipu sona pi pali |
| **Log / Aktivitäts-Log** | Zeitgestempelte Notizliste am Task | log | lipu pi tenpo pini |
| **Notiz** | Einzelner Eintrag im Log | note | toki lili |
| **Checkliste** | Abhakbare Teilaufgaben im Markdown | checklist | kulupu pi pali lili |
| **Datenbank** | Lokale SQLite-Datei (`.db`) | database | poki sona |
| **Speicherort / Ordner** | Dateisystem-Verzeichnis | folder / location | poki lipu |
| **Dateipfad** | Pfad zu Datei oder Ordner | file path | nasin lipu |
| **Vorschau-Cache** | Temporärer Speicher für skalierte Bilder | preview cache | poki awen pi sitelen lukin |
| **Einstellungen** | Konfigurationsdialog der App | settings | nasin ilo |
| **Kompaktansicht** | Angedocktes Mini-Fenster in Bildschirmecke | compact view / mini view | lukin lili |
| **Hauptansicht / Hauptfenster** | Normales Arbeitsfenster | main window / main view | lukin suli |
| **Liste (Ansicht)** | Tabellarische Task-Ansicht | list | kulupu lipu |
| **Netzplan (Ansicht)** | Knoten-Kanten-Ansicht | network plan | sitelen linja |
| **Gantt (Ansicht)** | Zeitleisten-Ansicht | Gantt | sitelen Gantt |
| **Mermaid-Diagramm** | Eingebettetes Diagramm im Editor | Mermaid diagram | sitelen Mermaid |
| **Editor** | Tiptap-Markdown-Editor | editor | ilo pi ante sitelen |
| **Kontextmenü** | Rechtsklick-Menü | context menu | lipu nena |
| **Tastenkürzel** | Keyboard-Shortcuts | keyboard shortcuts | nena ilo |
| **Rückgängig / Undo** | Letzte Aktion zurücknehmen | undo | o tawa monsi |
| **Wiederholen / Redo** | Zurückgenommene Aktion wiederherstellen | redo | o tawa sinpin |

#### Struktur der Glossar-Datei
Die Datei `frontend/src/i18n/glossary.json` speichert pro Domänenbegriff:
- `id`: Technischer Bezeichner (z. B. `term.details`, `term.description`, `term.log`, `term.database`)
- `sourceTerms`: Deutsche Wortformen im Schlüssel (z. B. `["Details", "Detailansicht"]`)
- `translations`: Objekt mit den 15 Sprachcodes und dem erlaubten kanonischen Ausdruck (bzw. erlaubten Wortstämmen bei flektierenden Sprachen wie `de`, `pl`, `uk`, `tr`).

### 3.2 Sprachspezifische Stilregeln (Style Guides)

Ergänzend zum Wörterbuch erhält jede Sprachgruppe verbindliche Übersetzungsregeln, die als System-Prompt-Priming bei KI-Übersetzungen und als Review-Checkliste dienen:

1. **Prinzip der Einfachen Sprache (alle Sprachen, besonders `tok`, `eo`):**
   - Maximal eine Aussage pro Satz.
   - Keine verschachtelten Nebensätze oder Partizipialkonstruktionen.
   - Ursache-Wirkung-Ketten chronologisch aufbauen (`Wenn X passiert, tut das Programm Y`).
2. **Grammatische Konsistenz bei UI-Elementen:**
   - **Buttons & Menüeinträge:** Einheitlich im Infinitiv (`de`, `fr`, `es`, `it`, `pt-BR`), Imperativ (`en`, `tok`: mit `o`) oder Verbalsubstantiv (`pl`, `uk`, `ja`, `ko`).
   - **Fehlermeldungen:** Einheitliches Muster für „X konnte nicht Y werden“ (z. B. in `tok` durchgängig `ilo li ken ala <Verb> e <Objekt>` statt wechselnder subjektloser Fragmente).
   - **Eigennamen in Toki Pona:** Marken- und Formatnamen nie isoliert als Nomen verwenden, sondern immer mit dem passenden Klassifikator-Kopfwort einleiten (`sitelen Mermaid`, `ilo DoDrag`, `ilo VS Code`, `nasin Markdown`, `linja URL`).
3. **Vereinfachung der deutschen Ausgangstexte:**
   - Vor einer Neuübersetzung werden überlange deutsche Schlüssel identifiziert (z. B. Strings > 90 Zeichen oder mit mehr als einem Semikolon/Klammerzusatz) und bereits im Deutschen sowie Englischen prägnanter gefasst.

### 3.3 Automatisierte Terminologie-Prüfung in `npm test`

Reine Dokumentation veraltet, wenn sie nicht durch Tests abgesichert wird. Deshalb wird `frontend/src/i18n/i18n.test.ts` um einen **Glossar-Konsistenztest** erweitert:

1. **Invariante Begriffspaare prüfen:**
   Für Sprachen ohne komplexe Wortbeugung (`tok`, `en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `eo`) kann direkt getestet werden: Wenn der deutsche Schlüssel einen geschützten Leitbegriff enthält (z. B. `Mermaid`, `Datenbank`, `Details`, `Vorgänger`, `Vorschau-Cache`), muss die Zielübersetzung den im Glossar hinterlegten Zielbegriff enthalten.
2. **Satzlängen- und Komplexitäts-Wächter (Linting):**
   Ein Test warnt oder schlägt fehl, wenn:
   - in `tok.json` / `backend-tok.json` ein einzelner Satz (getrennt durch `.`, `:`, `;`, `?`, `!`) eine kritische Wortanzahl überschreitet,
   - Eigennamen in `tok` ohne vorangestelltes kleines Toki-Pona-Kopfwort am Satzanfang oder nach Partikeln (`e`, `lon`, `tawa`, `tan`, `pi`) stehen.
3. **Fehlermeldungs-Musterprüfung:**
   Schlüssel nach dem Muster `"... konnte nicht ... werden"` werden darauf geprüft, dass sie innerhalb einer Sprache dieselbe grammatische Grundform verwenden.

---

## 4. Umsetzungsphasen (Roadmap)

### Phase 1: Toki Pona Überarbeitung & Referenz-Glossar (Abgeschlossen / Basis)
- Vereinheitlichung der Toki-Pona-Kataloge (`tok.json`, `backend-tok.json`):
  - *Details* → `sona insa`
  - *Beschreibung* → `lipu sona pi pali`
  - *Log* → `lipu pi tenpo pini`
  - *Datenbank* → `poki sona`
  - *Vorschau-Cache* → `poki awen pi sitelen lukin`
  - *Mermaid* & Diagrammtypen → durchgängig mit `sitelen ...` (`sitelen Mermaid`, `sitelen Kanban`, `sitelen Gantt` usw.)
  - *Datenschutzbeauftragter* → `jan lawa pi awen sona jan` (Schutz personenbezogener Daten statt allgemeines Wissensarchiv)
  - Aufteilung langer Erklär- und Hilfetexte in kurze, klare Einzelsätze.

### Phase 2: Erstellung von `glossary.json` für alle 15 Sprachen
- Extraktion aller ~40 Kernbegriffe aus `de.json` und `backend-de.json`.
- Festlegung der kanonischen Übersetzung pro Begriff in allen 15 Sprachen.
- Abgleich bestehender Kataloge gegen `glossary.json` mittels Analyse-Skript, um Abweichungen (z. B. verschiedene Wörter für „Vorgänger“ oder „Wiedervorlage“ zwischen Frontend und Backend) aufzudecken.

### Phase 3: Harmonisierung der übrigen 12 KI-übersetzten Sprachen
- Systematischer Durchlauf über `fr`, `es`, `zh-CN`, `uk`, `pt-BR`, `ja`, `zh-TW`, `ko`, `it`, `pl`, `tr`, `eo` unter strikter Vorgabe des jeweiligen Sprach-Glossars.
- Vereinheitlichung von Frontend- und Backend-Katalogen (identische Begriffe in beiden Dateien).

### Phase 4: Test-Integration & Pflege-Workflow
- Erweiterung von `frontend/src/i18n/i18n.test.ts` um den automatisierten Glossar-Check.
- Dokumentation des Workflows in `AGENTS.md`: Neue UI-Texte müssen zuerst die Begriffe aus `glossary.json` nutzen; neue Fachbegriffe werden zuerst im Glossar ergänzt, bevor sie in die 15 Sprachkataloge übernommen werden.
