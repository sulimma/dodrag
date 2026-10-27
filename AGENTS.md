# Projekthinweise fuer Agenten

Diese Hinweise beruhen auf tatsaechlichen Build-/Testerfahrungen vom 2026-10-17. Sie sind keine Garantie fuer andere Rechner oder Toolchain-Versionen. Historische Befunde und Nutzerentscheidungen stehen in `docs/reviews/CODE_REVIEW_2026-10-17_12-46-19.md`.

## Produktziel und Testumfang

- DoDrag ist eine native Windows-Desktop-App. Browserbetrieb ist kein Produktziel und kein regulärer Testumfang.
- Konsistenz zwischen Ansichten steuert die Erwartungen der Nutzer: Dieselben Tasks muessen auch bei anderem Erscheinungsbild dieselben Kontextmenues und Aktionsregeln haben, einschliesslich der Miniaturansicht. Gemeinsame Komponenten und Handler wiederverwenden und ansichtsuebergreifend testen; Abweichungen nicht stillschweigend einfuehren.
- In-place-Bearbeitung bleibt in der vorhandenen Textflaeche, ohne zusaetzliche Bearbeiten-/Speichern-Buttons oder Layoutwechsel. Enter und Fokusverlust bestaetigen, Escape verwirft. Vor neuen Implementierungen vorhandene Editorfunktionen pruefen und gemeinsame Handler wiederverwenden (DRY); keine parallelen Bedienregeln fuer Titel und Log einfuehren.
- Kontextmenues einheitlich als native Windows-Popups anzeigen, damit sie auch ueber die Grenzen des Mini-Fensters hinausreichen. Gemeinsame Menue- und Aktionsdefinitionen statt paralleler HTML-/Win32-Varianten verwenden. Erledigte Tasks bieten ausschliesslich erneutes Oeffnen; Titelbearbeitung gehoert nicht ins Task-Kontextmenue.
- Standardtests sind Frontend-Unit-/DOM-Tests, Typecheck, Go-Tests und der native Wails-Build. Browser-/Chromiumtests nicht routinemaessig ausfuehren.
- Browser-Tests sind nur zulaessig, wenn ein konkreter App-Test damit deutlich einfacher oder zuverlässiger ist als im nativen Umfeld. Den Browserlauf dann als begrenzten Test kennzeichnen; er verifiziert keine WebView2-, Windows-, Registry-, COM-, DPI- oder OS-Integration.

## Versionierung

- Dieses Projekt verwendet SemVer (`MAJOR.MINOR.PATCH`). Aktueller Stand: `0.2.2`. Solange `MAJOR` 0 ist, ist die API als instabil zu behandeln.
- Version und Build-Zeitpunkt werden zur Buildzeit per `-ldflags "-X main.buildVersion=... -X main.buildTime=..."` in `app.go` gesetzt und ueber `GetSettings` an das Frontend geliefert. `build.ps1` setzt beide Werte beim Wails-Packaging. `main.buildVersion` faellt ohne ldflags auf `dev` zurueck, `main.buildTime` bleibt dann leer. Der Settings-Dialog zeigt beides im Footer an; ohne ldflags also `dev` ohne Zeitpunkt.

## Internationalisierung

- Neue Features und geaenderte Texte immer in **allen fünfzehn Sprachen** uebersetzen: `de`, `en`, `fr`, `es`, `zh-CN`, `uk`, `pt-BR`, `ja`, `zh-TW`, `ko`, `it`, `pl`, `tr`, `eo`, `tok`. Keine neuen fest codierten UI-Texte, Tooltips, Platzhalter, ARIA-Labels, Dialogtitel oder nutzersichtbaren App-Fehlermeldungen einfuehren.
- Kataloge liegen unter `frontend/src/i18n/locales`: `<sprache>.json` fuer das Frontend, `backend-<sprache>.json` fuer native Go-Texte. Schluessel und `{platzhalter}` muessen in allen Sprachen identisch sein; Werte duerfen nicht leer sein. Nutzerdaten und technische Fremdfehler sind keine UI-Uebersetzungsschluessel.
- Frontend-Texte ueber `t(...)`, native Texte ueber den Go-Katalog beziehen. Datums-/Zeitformat ist immer ISO-8601 unabhängig von der Locale; Zahlenanzeigen mit der ausgewaehlten Sprache formatieren; gespeicherte ISO-Daten unveraendert lassen. Gespeicherte Aufgabentitel und Datenbanknamen beim Sprachwechsel niemals umschreiben.
- `npm test` prueft Katalogvollstaendigkeit, Platzhalter und statisch erkennbare unuebersetzte UI-Texte; Go-Tests pruefen die native Sprachverwaltung. Neue Rendering-Helfer muessen im AST-Check oder einem Laufzeit-UI-Test abgedeckt werden. Ein gruener Strukturtest beweist keine sprachliche Korrektheit.
- Verbindliche Fachbegriffe stehen in `frontend/src/i18n/glossary.json` fuer alle 15 Sprachen und beide Katalogtypen. Vor neuen UI-Texten zuerst das Glossar lesen; neue Konzepte zuerst dort mit Bedeutung/UI-Kontext, Schluessel-Aliasen und allen 15 Uebersetzungen ergaenzen. `translations` enthaelt kanonische Ausdruecke und begruendete vollstaendige Flexionsformen, keine beliebig breiten Wortstaemme. `keys` waehlt bei mehrdeutigen Begriffen exakte Kontexte; `excludeKeys` braucht eine Begruendung in `context`. Historische technische Schluessel bleiben stabil, deutsche/englische Werte duerfen vereinfacht werden.
- Uebersetzungs-Priming und Review: Glossarbegriffe samt Kontext vorgeben. Eine Aussage pro Satz, kurze Hauptsaetze, keine verschachtelten Nebensaetze; Bedingungen vor Folgen nennen. Buttons/Menueaktionen konsistent: Infinitiv in de/fr/es/it/pt-BR, Imperativ in en und tok (mit `o`), sprachuebliches Verbalsubstantiv in pl/uk/ja/ko; tr/eo innerhalb eines UI-Kontexts einheitlich. Statuslabels bleiben nominal, Fehlermeldungen verwenden innerhalb jeder Sprache dieselbe Grundform. Ueberlange deutsche/englische Ausgangswerte (>90 Zeichen oder mehrere Klammer-/Semikolon-Zusaetze) vor der Uebersetzung auf Teilbarkeit pruefen; Zeichenlaenge ist ein Review-Hinweis, kein universeller Grammatiktest.
- Toki Pona: Eigennamen mit passendem Kopfwort schreiben, z. B. `ilo DoDrag`, `ilo VS Code`, `sitelen Mermaid`, `nasin Markdown`, `linja URL`. Technische Pfade, Tastencodes und Platzhalter sind keine Eigennamen im Satz. Referenzkataloge nicht mechanisch Wort fuer Wort umbauen.
- Pflege-Check: `npm test` (im synchronisierten lokalen Cache, siehe unten) prueft auch Glossarparitaet, Terminologie in Frontend/Backend und Toki-Pona-Stilheurstiken. Fuer einen schnellen Terminologie-Audit: `npm test -- src/i18n/i18n.test.ts`. Bei Befunden zuerst den ganzen Satz und UI-Kontext pruefen; korrekte Flexion im Glossar ergaenzen statt Begriffe sinnlos anzuhaengen oder Bedeutungen zu streichen. Satzlaengen-/Eigennamen-Heuristiken ersetzen keine sprachliche Pruefung durch Muttersprachler.
- Die Uebersetzungen sind KI-erstellt; nur Deutsch und Englisch sind verifiziert. Diesen Hinweis und die Sprachliste im README aktuell halten.

## Workspace und lokale Dependencies

- Der Workspace liegt auf Google Drive unter `G:\Meine Ablage\...`, nicht auf einem normalen lokalen NTFS-Arbeitsverzeichnis. Pfade immer quoten.
- `npm install` direkt im Frontend auf G: scheiterte wiederholt mit `EBADF` und `UNKNOWN`. Junctions/Symlinks fuer ein lokales `node_modules` funktionierten auf diesem Laufwerk ebenfalls nicht. Nicht endlos dieselbe Installation wiederholen.
- `build.ps1` kopiert Frontendquellen und Konfiguration nach `%LOCALAPPDATA%\dodrag_node_cache`, installiert dort und kopiert das gebaute `dist` zurueck. Der Cache wird anhand des SHA256 von `frontend/package.json` aktualisiert. Ein vorhandenes `node_modules` allein bedeutet nicht, dass Dependencies aktuell sind.
- Fuer isolierte Validierung wurde zusaetzlich `C:\Users\Kolja\AppData\Local\Temp\kilo\dodrag-validation` als lokaler Frontend-Mirror verwendet. Dieser Pfad ist ein wegwerfbarer Testcache, keine zweite Quellwahrheit und keine Voraussetzung auf anderen Rechnern.
- Vor jedem Test im Mirror die aktuellen Quellen und Konfiguration synchronisieren, einschliesslich neuer oder geloeschter Dateien. Nur im Workspace editieren; keine Fixes ausschliesslich im Mirror vornehmen. Veraltete Mirrorquellen koennen einen falschen gruenen Testlauf liefern.
- `frontend/node_modules` kann im Workspace absichtlich fehlen. `npm test` dort scheiterte deshalb mit "vitest nicht gefunden"; auch `tsc` war nicht global installiert. Tests/Typecheck im vorbereiteten lokalen Frontendverzeichnis ausfuehren.
- Derzeit existiert keine versionierte npm-Lockdatei. Die beauftragte Strategie ist Dependencycache-Invalidierung, nicht ein stiller Wechsel zu `npm ci`.

## Build und Go-Toolchain

- Nach jeder Aenderung an der App immer `build.ps1` ausfuehren und eine aktuelle `dodrag.exe` im Projektstamm bereitstellen, damit der Nutzer direkt im Workspace testen kann. Reine Quellcodeaenderungen oder Frontendtests reichen nicht als Abschluss. Bei Build- oder Kopierfehlern ausdruecklich melden, dass die Test-EXE nicht aktualisiert wurde; keine alte EXE als neuen Build ausgeben.
- Wails ist auf Version 2.9.2. Dessen CLI-Abhaengigkeit `x/tools` war hier mit Go 1.27 inkompatibel. Echtes Wails-Packaging gelang mit `GOTOOLCHAIN=go1.23.12`; `build.ps1` setzt diese Version nur fuer den Packaging-Schritt und stellt die vorherige Umgebung wieder her. Ein erstmaliger Toolchain-Download kann Netzwerkzugriff benoetigen.
- Ein direkter `go build` ersetzt das Wails-Packaging nicht: Er bindet die erforderlichen Windows-Ressourcen und das Per-Monitor-DPI-Manifest nicht automatisch ein. Fuer die verteilbare EXE den Wails-Schritt in `build.ps1` verwenden.
- `main.go` bettet `frontend/dist` per `go:embed` ein. Dieses Verzeichnis ist nicht versioniert. In einem frischen Checkout muss zuerst das Frontend gebaut werden, bevor Go-Befehle fuer das Hauptpaket erfolgreich sein koennen.
- Unter Windows PowerShell 5.1 stoppt `$ErrorActionPreference = "Stop"` nicht bei einem nativen npm-/go-Fehlercode. Nach jedem nativen Build-/Testprozess `$LASTEXITCODE` pruefen. `build.ps1` verwendet dafuer `Assert-NativeSuccess`. Keine alten Artefakte nach einem Fehler als erfolgreichen Neubuild behandeln.
- Das Buildskript startet keine App und beendet keine Benutzerprozesse. Dieses Verhalten erhalten. Gesperrte Ziel-EXEs/Kopierfehler melden, nicht durch ungefragtes Beenden laufender Anwendungen umgehen.
- Ausgaben liegen unter `build/bin/dodrag.exe`; das Skript kopiert sie zusaetzlich nach `dodrag.exe` im Projektstamm. Binaries, `dist` und Dependencies nicht committen.
- `go test ./...` und `go test -tags "desktop,production" ./...` wurden erfolgreich ausgefuehrt. `go test -race` war mit `CGO_ENABLED=0` nicht verfuegbar; normale Tests ersetzen keine Race-Pruefung.
- `go vet` meldete drei bestehende `unsafe.Pointer`-Warnungen im nativen Windows-Code (WM_MOVING/COM-vtable). Diese weder als bestanden verschweigen noch ohne Analyse als neue Regression ausgeben; Zeilennummern koennen sich verschieben.

## Frontend- und optionale Browser-Tests

- Im aktuellen lokalen Frontend-Mirror: `npm test`, `npm exec -- tsc --noEmit`, `npm run build`. DOM-Tests nutzen jsdom, nicht WebView2; sie pruefen UI-/Domainlogik, nicht den nativen Host.
- `frontend/tests/*.browser.mjs` und `npm run test:browser` sind optionale Browserhilfen fuer konkrete App-Verhalten, die dort leichter zu pruefen sind. Nicht standardmaessig ausfuehren. `build.ps1` fuehrt sie bewusst nicht aus.
- Nur wenn ein solcher Test fuer die konkrete Aenderung gerechtfertigt ist: aktuelles `frontend/tests`-Verzeichnis in den lokalen Mirror kopieren; Playwright benoetigt installiertes Chromium. Tests starten eigene Vite-/Chromium-Prozesse, die der Test selbst wieder aufraeumt.
- Browser-Fallback und Browser-Tests verifizieren nicht die native SQLite-App. Browser-Datenbanken teilen derzeit weiterhin einen localStorage-Ereignisspeicher (offener Befund 1.7); keine echten Nutzerdaten verwenden. Browserlaeufe belegen keine WebView2-, Windows-, Registry-, COM-, DPI- oder OS-Clipboard-Funktion.
- Urspruengliche Datumstests mischten UTC-Fixtures mit festen lokalen Datumserwartungen: Berlin/UTC bestanden, Pacific/Kiritimati nicht durchgehend. Neue Datumstests mit explizitem Heute und bewusster Zeitzone schreiben. Sommerzeit- und Jahresgrenzen separat pruefen; Maschinen-Locale und Zeitzone sind verschiedene Dinge.

## Native Drag- und SVG-Fallen

- Pointer-Drag (`taskPointerDrag.ts`) steuert das Ziehen von Tasks in Liste, Netzplan und Gantt; nicht-textuelle Bereiche und die expliziten Draggriffe (`data-drag-handle`) starten das Ziehen, waehrend normale Text-/Inputauswahl (`data-task-selectable-text`) erhalten bleibt.
- Ein synthetisch ausgeloestes `dragstart` prueft keinen vollstaendigen Pointer-Ablauf. Fuer Interaktionstests echte Pointer-/Maus-Ablaeufe verwenden, sowohl Alt vor als auch waehrend des Drags.
- Modifier auch waehrend des Drags auswerten (`altKey`); Dragende, Blur und Escape-Abbruch separat testen.
- Alt-Loeschung ist quellbezogen, nicht "alle Kanten des Pfades": Bei A->B->C plus A->C entfernt Alt-Drag A auf C nur A->B/A->C; B->C bleibt. Vorschau und Commit muessen denselben berechneten Satz verwenden. Normalerweise transitiv ausgeblendete, aber real gespeicherte betroffene Kanten muessen in der Vorschau sichtbar werden.
- SVG-Marker skalieren standardmaessig mit der Strichbreite. Fuer konstante Pfeilkopfgeometrie `markerUnits="userSpaceOnUse"` beibehalten: Stammende an Dreiecksbasis, Spitze am Knotenrand, Endtangente senkrecht zur Zielseite. Nicht nur Markerorientierung pruefen; auch Bezier-Endtangente bei Hindernisrouting und rechtem Gantt-Eingang testen.
- Echte Chromiumtests ersetzen keine Windows-WebView2-, Mehrmonitor-/DPI-, WINDOWPLACEMENT-, COM-/Registry- oder OS-Clipboard-Pruefung. Diese Grenzen im Ergebnis ausdruecklich nennen, wenn kein solcher Lauf erfolgt ist.
