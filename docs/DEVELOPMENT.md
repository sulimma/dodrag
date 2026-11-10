# Entwicklungsumgebung

## Lokales Frontend
Der Workspace liegt auf Google Drive. `npm install` dort scheiterte mit EBADF/UNKNOWN; Junctions lösten das Problem ebenfalls nicht. `frontend.ps1` synchronisiert Quellen und Konfiguration einschließlich Löschungen nach `%LOCALAPPDATA%\dodrag_node_cache`. `scripts/frontend-cache.ps1` ist die einzige Synchronisierungsimplementierung. Quellen nur im Workspace ändern.

Der SHA256 von `frontend/package.json` invalidiert Dependencies. Es gibt bewusst keine versionierte npm-Lockdatei; nicht ungefragt zu `npm ci` wechseln. Ein vorhandenes node_modules allein garantiert keine passenden Dependencies. Frühere weitere Testmirrors sind keine Quellwahrheit.

## Kompilieren und Commitprüfung
`./build.ps1 -Version <MAJOR.MINOR.PATCH>` baut die Test-EXE. `-Test` schaltet die vollständige Commitprüfung hinzu. `./frontend.ps1 -Action Test -TestFiles <Dateien>` führt nur ausgewählte Frontendtests aus; ohne Dateien die normale Suite. `-Action LanguageAudit` startet die optionalen sprachlichen Heuristiken.

`build.ps1` injiziert Version und UTC-Buildzeit; keine aktuelle Produktversion in Quellen oder Dokumentation festschreiben. Ohne ldflags zeigt die App `dev`. Wails-Konfiguration erhält Windows-Dateimetadaten nur temporär. Ausgaben: `build/bin/dodrag.exe` und für amd64 zusätzlich `dodrag.exe` im Projektstamm.

Wails 2.9.2 benötigt hier beim Packaging `GOTOOLCHAIN=go1.23.12`, weil seine CLI-Abhängigkeit x/tools mit Go 1.27 inkompatibel war. Das Buildskript stellt die vorherige Umgebung wieder her. Der erste Download kann Netzwerkzugriff benötigen. Direktes `go build` ersetzt Ressourcen-/Manifest-Packaging nicht. `main.go` benötigt wegen go:embed zuerst ein gebautes `frontend/dist`.

Native Exitcodes auch unter PowerShell 5.1 ausdrücklich prüfen; ErrorActionPreference allein genügt nicht. Eine gesperrte Ziel-EXE melden; keine laufenden Anwendungen beenden.

## Grenzen und bekannte Werkzeugbefunde
DOM-Tests verwenden jsdom, nicht WebView2. Optionale Chromiumtests belegen keine Windows-/COM-/Registry-/DPI-/Clipboardintegration. Bei einschlägigen Änderungen die tatsächlich verbleibende native Testlücke benennen, nicht bei jeder Dokumentationsänderung eine vollständige Warnliste wiederholen.

`go test -race` war mit CGO_ENABLED=0 nicht verfügbar. `go vet` meldete drei bekannte unsafe.Pointer-Warnungen im nativen Windows-Code; bei einer erneuten Prüfung gegen den aktuellen Stand vergleichen.

Datumstests verwenden explizites Heute und bewusste Zeitzonen. Maschinen-Locale und Zeitzone sind verschieden. Sommerzeit und Jahresgrenzen gezielt abdecken.

## Native Fenstermodus-Abnahme

Die vorgesehene Taskleisten-Einzelklickfolge bringt ein Fenster im Hintergrund zunächst nach vorn und wechselt anschließend zwischen Mini, Taskleiste und normalem Fenster. Die sichtbaren Direktwahlen wechseln zwischen Mini und Fenster; `Ctrl+M` schaltet ebenfalls zwischen diesen beiden Modi.

Die echte Windows-Abnahme steht aus. Ein zusätzlich zu testender Ablauf umfasst Einzelklicks, Systemmenü, Alt+Tab sowie Mehrmonitor-/DPI-Wechsel und Monitortrennung. Für die Ereignisaufnahme kann `DODRAG_WINDOW_DIAGNOSTICS=1` beim Start einer eigenen Testinstanz gesetzt werden; die optionale stderr-Diagnose enthält keine Taskdaten.

## Manueller Markdown-Importregressionstest

Die DOM-Tests decken Zwischenablageformate, Markdown-Struktur, Importende, lokales Undo, Leseabbrüche und Taskwechsel ab; der Go-Test prüft das Lesen von UTF-8-Dateien. Echte Windows-Zwischenablage und Explorer/Wails-Drops bleiben manuell zu prüfen:

1. Ein Markdown-Dokument mit Überschrift, GitHub-Alert, Checkliste, Mermaid und fett gesetztem Inline-Code (z. B. **`§ 3` (Definition):**) aus VS Code kopieren und mit Ctrl+V sowie dem Editor-Kontextmenü einfügen. Auch mit zwei Leerzeichen eingerückte Überschriften und Listen sowie Einrückungen innerhalb eines Codeblocks prüfen. Zusätzlich nur `**fett**` kopieren: Auch ohne Überschrift muss Markdown Vorrang vor dem Syntaxfarben-HTML haben. Bei gewöhnlichem Text ohne Markdown bleibt mitgelieferte HTML-Formatierung erhalten. Die Blöcke müssen formatiert erscheinen; nur das Diagramm ist ein Mermaid-Block. In einem Codeblock und mit Ctrl+Shift+V bleibt Quelltext wörtlich.
2. Vorhandene Beschreibung bearbeiten, Cursor an den Anfang setzen, eine `.md`-Datei aus Explorer auf den Editor ziehen. Der Dateiinhalt steht formatiert am Ende; Ctrl+Z entfernt nur diesen Import.
3. Dieselbe Datei auf einen Task bzw. eine Auswahl ziehen. Der Inhalt wird an die jeweiligen aktuellen Beschreibungen angefügt. Auch einen gemischten Drop mit PDF prüfen: Markdown wird Inhalt, PDF bleibt Dateiverweis. Zu einem anderen Task wechseln und zurück: Inhalt bleibt gespeichert.
4. Über (?) die Markdown-Syntaxhilfe öffnen und „Markdown-Anleitung für KI kopieren“ betätigen. Der Textbutton bleibt beschriftet, wird kurz hervorgehoben und nach etwa 1,5 Sekunden wieder neutral; auch bei erneutem Klick. Hilfe schließen und erneut öffnen: keine alte Erfolgsanzeige. In einen Texteditor einfügen: KI-Hinweise enthalten Markdown-Beispiele und die Empfehlung ✅ ❌ ℹ️ ❓ ⛔; keine Ersetzungstabellen oder Mermaid-Typenliste. Die DOM-Tests prüfen Kopieren, Fehler und Zurücksetzen; die sichtbare Hervorhebung und die echte Windows-Zwischenablage bleiben manuell zu prüfen.

## Omni-Bar: gezielte Prüfung und native Abnahme

`frontend/src/domain/search.test.ts`, `App.search.test.tsx` und `hooks/useSearchHighlight.test.tsx` prüfen aktuelle Projektionen, entfernte/überschriebene Inhalte, Sonderzeichen, mehrzeilige Phrasen, Filterzustände, Tastatur, stabile Details und leere Gruppen. `domain/protocol.test.ts` sichert aktuelle Notiztexte sowie Löschen/Undo/Redo ab. Historische Quellen und Umbenennungshinweise bleiben als bewusste Protokolldarstellung erhalten; entfernte Quellen aus früheren Beschreibungssnapshots erzeugen keinen Filtertreffer.

Der optionale, auf diese Interaktion begrenzte Chromiumtest `node tests/omni-search.browser.mjs` läuft nach `./frontend.ps1 -Action Sync` im Frontendcache. Er prüft CSS-Highlight-Ranges in formatiertem Text/SVG, mehrzeilige Textarea-Spiegel, Bearbeiten/Scrollen, unveränderte Toolbar-Geometrie und Zurücksetzen. Das ersetzt keine WebView2-/DPI-Abnahme. Der Test startet die native App nicht.

Manueller Regressionsablauf in der bereitgestellten Test-EXE:

1. Zwei offene Tasks und einen erledigten Task vorbereiten. In Titel, ID, Markdown mit Checkliste und Log nach einer Phrase mit Sonderzeichen sowie mit einem Zeilenumbruch suchen. Ohne Filter bleiben alle Tasks sichtbar; Treffer erscheinen auch im geöffneten Detailpanel und in erledigten Tasks. Links, Textauswahl, Editor-Caret und lokale Rückgängig-Aktion bleiben benutzbar.
2. Filter per Trichter und Ctrl+F umschalten. Ctrl+F von außerhalb markiert den vorhandenen Suchtext; innerhalb bleibt die Caretposition erhalten. Liste, Netzplan, Gantt und Protokoll wechseln: tiefe Treffer bleiben, leere Tage und Kanten zu ausgeblendeten Tasks verschwinden. Der geöffnete Detailtask bleibt erhalten. Erledigte Tasks zeigen Treffer/Gesamt, auch bei leerem Suchtext.
3. Enter öffnet den obersten Treffer; ohne Treffer bleibt die Auswahl erhalten. Ein Klick auf Plus legt auch im Filtermodus an. Ohne Filter legt Enter an und leert die Suche. Escape leert die Suche, deaktiviert den Filter und verlässt das Eingabefeld.
4. Eine Notiz ändern und löschen, jeweils Undo/Redo ausführen. Nur der projizierte Notiztext darf gefunden werden. Eine Beschreibung und darin enthaltene Quelle ersetzen/entfernen: der alte Text darf keinen Task im Filter halten. Weiterhin sichtbare Umbenennungshinweise sind als Protokolltext durchsuchbar.
5. Bei aktivem Suchtext Detail- und Loggrößen ändern, lange Notizen bearbeiten und scrollen, zwischen Ansichten wechseln und Windows-Skalierung prüfen. Hervorhebungen müssen auf den sichtbaren Zeichen liegen und mit Escape vollständig verschwinden. Diese Darstellung in der nativen WebView2-Instanz ist durch DOM-/Chromiumtests nicht belegt.


## Dauer und Fortschritt: manuelle Darstellung in Windows

Die gezielten Tests in `domain/duration.test.ts`, `components/TaskTimingInput.test.tsx`, `components/GanttView.duration.test.tsx`, `App.details.test.tsx` sowie die Go-Tests `TestTaskTiming*` und `TestDefaultDurationSettings` prüfen Restzeitberechnung, Eingabe, Default-Übernahme, Pfeilanschluss, Persistenz und Undo/Redo. Die tatsächliche Strichdarstellung, unveränderte Itemhöhe und Bedienbarkeit bei Windows-Skalierung bleiben manuell zu prüfen:

1. In den Einstellungen die Standarddauer auf 45 Minuten setzen, einen Task anlegen und Details öffnen: Fortschritt leer, Dauer 45, Einheit Minuten. Danach den Default auf 2 Stunden ändern; nur weitere neue Tasks übernehmen ihn. App später manuell erneut öffnen und Defaults sowie Taskwerte kontrollieren.
2. Bei einem Task 3/5 Tage eintragen: In Liste, Protokoll, Mini, erledigter Liste und links im Gantt ist die dünne Linie zu 60 % grün und zu 40 % rot. Vorher/nachher die Itemhöhe vergleichen; Text, Datum und Checklistenbadge dürfen nicht verdeckt werden. Fortschritt leeren: Bei einer halb erledigten Checkliste erscheint 50 %, ohne Checkliste keine Linie. Explizit 0 ergibt 0 % unabhängig von der Checkliste.
3. Eine Abhängigkeit A → B → C anlegen; B auf 2/4 Tage setzen. B reicht zwei Tage links und zwei Tage rechts von seinem berechneten Start. Der Pfeil von A verläuft zwischen den Zeilen und schließt oben an dieser Startposition an. C beginnt nach der Restdauer von B. Ebenso einen Task mit einer Stunde Fortschritt, einen mit vollständigem Fortschritt und einen mit Fortschritt 0 prüfen; bei kurzen Dauern bleibt die ID lesbar. Aktivieren, Deaktivieren und Filterwechsel dürfen die Anschlüsse nicht lösen.
4. Werte ändern, Fortschritt leeren und Undo/Redo ausführen; auch über einen Datenbankwechsel und erneutes Öffnen prüfen. Ungültige Werte sowie ein fehlgeschlagener Speichervorgang dürfen die gespeicherten Werte nicht ersetzen. Dezimalwerte mit Komma, Enter, Tab und Escape benutzen. Detailpanel schmal ziehen und bei 100 %, 150 % und 200 % Windows-Skalierung prüfen: Titel und Eingaben bleiben erreichbar, Zeilen und Pfeile bleiben zugeordnet.

Gantt-/Fortschrittsregression: Mehrtägige Balken mit und ohne Fortschritt verketten. Pfeile müssen den Quellbalken nach rechts verlassen und im freigehaltenen Spaltenkanal senkrecht verlaufen; ein oberer Anschluss in der Balkenmitte benötigt keinen Umweg links um den Zielbalken. Bei deaktivierten/blockierten Tasks muss die gesamte Fortschrittslinie blasser sein. Den offenen Anteil als dezentes Grau mit Rotstich bei verschiedenen Windows-Skalierungen kontrollieren; DOM-Tests ersetzen diese Farbwahrnehmungsprüfung nicht.

Darstellungsabnahme: Erledigte Tasks zeigen auch mit erfasstem Fortschritt oder Checkliste keine Fortschrittslinie. Im Gantt sind abhängige und unabhängige Tasks gleich kräftig; Auswahl-/Aktivmarkierungen bleiben sichtbar. Die Wiedervorlage „+1 Tag“ mit Ctrl++ muss dieselbe Höhe wie ohne Shortcut-Hinweis behalten. Der Hinweis liegt außerhalb des Layoutflusses; tatsächliche Dropzielgeometrie und mögliche Textüberschneidungen bei Windows-Skalierung manuell prüfen.

## Fehlerdiagnose / Crashlogs

Ab Programmstart schreibt DoDrag nach `%APPDATA%\DoDrag\logs\dodrag.log`: Start mit Version/Build/PID, reguläres Ende, Wails-Warnungen und -Fehler, globale JavaScript-Fehler samt Stack (soweit verfügbar), unbehandelte Promise-Ablehnungen und fehlgeschlagene Taskmutationen. `crash.log` erfasst unbehandelte Go-Panics auch aus anderen Goroutines. Dateien werden beim Start ab 2 MiB auf `.previous` rotiert; innerhalb einer Sitzung können sie größer werden. Fehlertexte können Pfade oder Nutzerdaten enthalten; vor Weitergabe prüfen.

Fataler Go-Zustand wird nicht durch pauschales `recover` versteckt. WebView2-Prozessabstürze, externes Prozessbeenden und manche native Windows-Fehler können diese Protokollierung umgehen. Ohne abschließendes STOP ist ein unsauberes Ende möglich, aber nicht bewiesen (z. B. `os.Exit`). Bei erneutem Absturz beide Logs samt `.previous` und ungefährer Uhrzeit sichern; bei leerem Crashlog zusätzlich Windows-Zuverlässigkeitsverlauf prüfen.

Automatisiert: `diagnostics.test.ts` prüft globale Fehler, Promise-Ablehnungen, Größenbegrenzung und ausgefallene Diagnosebridge; `TestDiagnostic*`/`TestFrontendDiagnostic` prüfen Dateirotation, Fehlerausgabe und einen echten Go-Panic in einem Testunterprozess. Native Wails/WebView2-Übertragung bleibt manuell: Test-EXE starten, Task per Drag erledigen (auch Mehrfachauswahl und geöffnete Beschreibung), Undo und erneuten Drag prüfen, normal schließen und START/STOP im Log kontrollieren. In einer Entwicklungsinstanz über DevTools `setTimeout(() => { throw new Error('diagnostic manual test') }, 0)` sowie `Promise.reject(new Error('diagnostic promise test'))` auslösen und beide Meldungen im Log kontrollieren. Der ursprünglich gemeldete sporadische Drag-Absturz ist bisher nicht reproduziert.

## Abschluss von Eingaben und native Größenänderungen

Schließen, Datenbankwechsel und der Wechsel in Mini/Taskleiste verwenden eine gemeinsame Abschlussprüfung: angenommene Markdown-Importe einschließlich Lesen und Schreiben abwarten, Beschreibungen speichern, Schreibwarteschlange leeren und offene Titel-/Datumssitzungen prüfen. Fehlgeschlagene Inline-Eingaben bleiben erhalten und verhindern den Abschluss. Die Regressionen in `App.editor.test.tsx` und `hooks/useDescriptionDrafts.test.tsx` sind reguläre Tests, keine erwarteten Fehler mehr; sie prüfen auch Wiederholung nach Fehlern und Datenbankwechsel während eines Imports.

Native Größenänderungen lesen ihren Zustand unter `App.mu`, geben den Mutex vor synchronen Win32-Aufrufen frei und übernehmen anschließend das Ergebnis. `modeMu` serialisiert weiterhin Moduswechsel und Größenänderungen. Der zusätzliche boolesche Mini-Zustand und die unbenutzte Snap-Bridge sind entfernt.

Native Testlücke: Die tatsächliche Windows-Nachrichtenverarbeitung ist nicht durch DOM-Tests belegt. Manueller Regressionsablauf mit Testdaten: Miniansicht mit mehreren Tasks öffnen, durch Erledigen/Wiedervorlage die Zeilenzahl ändern und gleichzeitig über Alt+F4 schließen; ergänzend Monitor-/DPI-Wechsel während Schließen prüfen. Die App muss erreichbar bleiben, Einrasten und Moduswechsel müssen unverändert funktionieren. Bei einem Hang beide Thread-/Goroutine-Stacks erfassen, insbesondere `SetWindowPos`/`ShowWindow` gegenüber `requestEditorClose`/`Mutex.Lock`. Die App wird für automatisierte Prüfungen nicht gestartet.

## Datenbank nach verspätetem Google-Drive-Start

`TestDatabaseRecoveryAfterUnavailableStartup` prüft Wiederöffnen nach vorübergehend fehlender Datei einschließlich vorhandener Taskkopien, ohne Ersatzdatenbank anzulegen. `App.test.tsx` prüft den Wiederlade-Knopf, sichtbare Öffnungsfehler und erneuten Versuch bis zum geladenen Snapshot. Das echte Mounten durch DriveFS bleibt manuell:

1. Mit einer separaten Testdatenbank auf Google Drive als aktiver Datenbank die App schließen. Drive beenden bzw. das Laufwerk vorübergehend nicht bereitstellen und die App starten: Einstellungen erscheinen, Taskaktionen bleiben gesperrt.
2. „Aktive Datenbank erneut laden“ bei noch fehlendem Laufwerk klicken: Ein sichtbarer Fehler erscheint; keine neue Datenbank darf entstehen.
3. Drive vollständig verbinden und denselben Knopf erneut klicken: Vorhandene Tasks einschließlich Kopien erscheinen, „Fertig“ wird verfügbar. Eine Änderung speichern und nach erneutem Öffnen prüfen.
4. Mit einer nicht kompatiblen Testdatenbank wiederholen: Der Wiederlade-Knopf muss den Validierungsfehler anzeigen und weitere Versuche erlauben. Eine ältere App, die `copiedFromId` noch nicht kennt, kann Datenbanken mit Taskkopien nicht öffnen; hierfür eine aktuelle Version verwenden.

## Datenbankversionen: Prüfung und native Abnahme

`internal/eventstore/version_test.go` prüft persistierte Build-Angaben, Patch-Releases ohne Erhöhung der Mindestversion, numerische Versionsvergleiche ohne `rc`, ältere Dateien ohne Metadaten und unveränderte Ablehnung neuerer Formate. `TestDatabaseVersionBuildAndStartupError` prüft die echte Build-Übergabe sowie Updatehinweise in allen Sprachen bei Start und Datenbankwechsel. Der DOM-Test in `App.test.tsx` sichert die sichtbare Mindestversion beim Start und die Rückkehr zur Aufgabenansicht nach erfolgreichem Wiederladen ab.

Manuell mit einer separaten Testdatenbank: In der Tabelle `database_metadata` die `minimum_app_version` auf einen höheren Stand setzen. App mit dieser aktiven Datei starten und die Datei auch über „Verwenden“/Dateiauswahl öffnen: Es muss eine Updateaufforderung mit genau diesem Minimum erscheinen. Mit einem `rc`-Zusatz wiederholen; der Zusatz darf den Vergleich nicht ändern. Eine kompatible, bisher unversionierte Kopie öffnen: Tasks müssen erhalten bleiben und die Metadaten anschließend den aktuellen Build und das Datenformat-Minimum enthalten. Die echte Wails-Dateiauswahl und Windows-Darstellung bleiben manuell zu prüfen.

Update-Link: Bei aktiver kompatibler Datenbank eine weitere bekannte Testdatenbank mit höherem Minimum hinterlegen und Einstellungen öffnen. Neben der aktuellen Version muss „Update“ erscheinen. Beim Öffnen des Dialogs darf keine Online-Updateabfrage erfolgen. Erst der Klick öffnet `https://github.com/sulimma/dodrag/releases` im Standardbrowser und fordert reguläres Schließen an; bei nicht gespeicherten Eingaben bleibt der vorhandene Speicherschutz wirksam. Linkposition bei schmalem Fenster/Windows-Skalierung prüfen. Automatisiert prüfen `TestDatabaseKnownCompatibilityChecksInactive`, `TestDatabaseVersionInspectionIsReadOnly` und `SettingsModal.update.test.tsx` inaktive Datenbanken, unveränderte Metadaten, fehlende Dateien, Browser-vor-Schließen, Doppelklicks und Fehlerwiederholung. Echte Browseröffnung und Windows-Schließen bleiben manuell.


## Dauerhafte Beschreibungssicherung

Format 0.6.0 ergänzt `description_drafts`; der historische Rückfallwert für unversionierte Dateien bleibt 0.5.0. Die Tests `TestDescriptionDraft*` prüfen Prozessende ohne Close, Wiederherstellung, begrenzte Datenmenge, veraltete Revisionen, konkurrierende Änderungen, atomaren Rollback und No-op-Abschluss. `TestDescriptionCheckpointDatabaseIdentityAndWebViewReload` prüft native Datenbankzuordnung und einen frischen Frontend-Snapshot. Hook-/App-Tests prüfen die sofortige Sicherung, den jeweils neuesten wartenden Text, automatische Fehlerwiederholung, Speicherstatus, lokalen Undo und Abschlussgrenzen.

Native manuelle Abnahme mit einer separaten Testdatenbank: Beschreibung eingeben und im Editor bleiben. Erst nach „Beschreibung gespeichert“ die Testinstanz absichtlich beenden; nach Neustart muss der Text vorhanden sein. Beim Weiterarbeiten Taskwechsel, Miniansicht, lokales Undo und reguläres Schließen prüfen. Bei einem Schreibfehler muss „nicht gespeichert“ stehen bleiben, der Text erhalten bleiben und nach Behebung ohne weitere Eingabe gespeichert werden. Echte WebView2-/Windows-Abstürze und die sichtbare Darstellung wurden nicht automatisiert ausgelöst; der Prozessverlusttest verwendet einen separaten Go-Testprozess. Während „wird gespeichert“ kann die jüngste Eingabe bei einem abrupten Prozessverlust noch fehlen. Die Benutzer-Datenbank wird durch Tests nicht geöffnet oder migriert.
