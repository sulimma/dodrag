# Projekthinweise fuer Agenten

Diese Hinweise beruhen auf tatsaechlichen Build-/Testerfahrungen vom 2026-10-17. Sie sind keine Garantie fuer andere Rechner oder Toolchain-Versionen. Historische Befunde und Nutzerentscheidungen stehen in `CODE_REVIEW_2026-10-17_12-46-19.md`.

## Versionierung

- Dieses Projekt verwendet SemVer (`MAJOR.MINOR.PATCH`). Aktueller Stand: `0.1.2`. Solange `MAJOR` 0 ist, ist die API als instabil zu behandeln.
- Version und Build-Zeitpunkt werden zur Buildzeit per `-ldflags "-X main.buildVersion=... -X main.buildTime=..."` in `app.go` gesetzt und ueber `GetSettings` an das Frontend geliefert. `build.ps1` setzt beide Werte beim Wails-Packaging. `main.buildVersion` faellt ohne ldflags auf `0.1.2` zurueck, `main.buildTime` bleibt dann leer. Der Settings-Dialog zeigt beides im Footer an; ohne ldflags also Version ohne Zeitpunkt.

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

## Frontend- und Browsertests

- Im aktuellen lokalen Frontend-Mirror: `npm test`, `npm exec -- tsc --noEmit`, `npm run build`. DOM-Tests nutzen jsdom, nicht WebView2.
- Der echte Dragtest ist `frontend/tests/drag.browser.mjs`, gestartet mit `npm run test:browser` aus dem Frontendverzeichnis. Er startet selbst einen Vite-Server und Headless-Chromium und raeumt beide wieder auf.
- `build.ps1` kopiert derzeit `src` und Konfigurationsdateien, aber nicht `frontend/tests`. Es fuehrt nur `npm test` und den Build aus, nicht `test:browser`. Fuer Browsertests daher auch das aktuelle `tests`-Verzeichnis in den lokalen Mirror kopieren. Ein erfolgreicher Buildskriptlauf belegt keine bestandenen Dragtests.
- Playwright benoetigt zusaetzlich zum npm-Paket ein installiertes Chromium. Falls es fehlt, im lokalen Testverzeichnis `npm exec -- playwright install chromium` ausfuehren. Der Testserver fordert Port 5197 an und die Testnavigation verwendet diesen Port fest; vor dem Lauf sicherstellen, dass er frei ist. Vites automatischer Portwechsel wuerde sonst auf den falschen Server fuehren.
- Der Browser-Fallback ist nicht die native SQLite-App. Browser-Datenbanken teilen derzeit weiterhin einen localStorage-Ereignisspeicher (offener Befund 1.7). Browsertests verwenden isolierte Testdaten/Browserkontexte; nicht mit echten Nutzerdaten testen. Eine gruene Browserpruefung verifiziert keine native DB-/Registry-/COM-Funktion.
- Urspruengliche Datumstests mischten UTC-Fixtures mit festen lokalen Datumserwartungen: Berlin/UTC bestanden, Pacific/Kiritimati nicht durchgehend. Neue Datumstests mit explizitem Heute und bewusster Zeitzone schreiben. Sommerzeit- und Jahresgrenzen separat pruefen; Maschinen-Locale und Zeitzone sind verschiedene Dinge.

## Native Drag- und SVG-Fallen

- Shift vor einem Drag direkt auf auswaehlbarem Titeltext startete in Chromium nicht zuverlaessig einen nativen Drag, auch nach temporaerem `user-select: none`. Die expliziten Nicht-Text-Draggriffe (`data-drag-handle`) funktionierten mit echten Mausereignissen in Liste, Netzplan und Gantt. Normale Text-/Inputauswahl bleibt absichtlich erhalten.
- Ein synthetisch ausgeloestes `dragstart` prueft nicht, ob Shift+Mousedown einen nativen Drag starten kann. Fuer diesen Fehler echte `mouse.down/move/up`-Ablaeufe verwenden, sowohl Shift vor als auch waehrend des Drags.
- Native Dragloops koennen normale Keyevents unterdruecken. Modifier auch aus Dragereignissen auswerten; die Shift-Freigabe aktualisiert die Vorschau gegebenenfalls erst beim naechsten `dragover`. Dragende und Escape-Abbruch separat testen.
- Shift-Loeschung ist quellbezogen, nicht "alle Kanten des Pfades": Bei A->B->C plus A->C entfernt Drag A auf C nur A->B/A->C; B->C bleibt. Vorschau und Commit muessen denselben berechneten Satz verwenden. Normalerweise transitiv ausgeblendete, aber real gespeicherte betroffene Kanten muessen in der Vorschau sichtbar werden.
- SVG-Marker skalieren standardmaessig mit der Strichbreite. Fuer konstante Pfeilkopfgeometrie `markerUnits="userSpaceOnUse"` beibehalten: Stammende an Dreiecksbasis, Spitze am Knotenrand, Endtangente senkrecht zur Zielseite. Nicht nur Markerorientierung pruefen; auch Bezier-Endtangente bei Hindernisrouting und rechtem Gantt-Eingang testen.
- Echte Chromiumtests ersetzen keine Windows-WebView2-, Mehrmonitor-/DPI-, WINDOWPLACEMENT-, COM-/Registry- oder OS-Clipboard-Pruefung. Diese Grenzen im Ergebnis ausdruecklich nennen, wenn kein solcher Lauf erfolgt ist.
