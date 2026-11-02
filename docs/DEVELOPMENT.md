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
4. Neben (?) das Kopiericon betätigen und in einen Texteditor einfügen: KI-Hinweise enthalten Markdown-Beispiele und die Empfehlung ✅ ❌ ℹ️ ❓ ⛔; keine Ersetzungstabellen oder Mermaid-Typenliste.

## Omni-Bar: gezielte Prüfung und native Abnahme

`frontend/src/domain/search.test.ts`, `App.search.test.tsx` und `hooks/useSearchHighlight.test.tsx` prüfen aktuelle Projektionen, entfernte/überschriebene Inhalte, Sonderzeichen, mehrzeilige Phrasen, Filterzustände, Tastatur, stabile Details und leere Gruppen. `domain/protocol.test.ts` sichert aktuelle Notiztexte sowie Löschen/Undo/Redo ab. Historische Quellen und Umbenennungshinweise bleiben als bewusste Protokolldarstellung erhalten; entfernte Quellen aus früheren Beschreibungssnapshots erzeugen keinen Filtertreffer.

Der optionale, auf diese Interaktion begrenzte Chromiumtest `node tests/omni-search.browser.mjs` läuft nach `./frontend.ps1 -Action Sync` im Frontendcache. Er prüft CSS-Highlight-Ranges in formatiertem Text/SVG, mehrzeilige Textarea-Spiegel, Bearbeiten/Scrollen, unveränderte Toolbar-Geometrie und Zurücksetzen. Das ersetzt keine WebView2-/DPI-Abnahme. Der Test startet die native App nicht.

Manueller Regressionsablauf in der bereitgestellten Test-EXE:

1. Zwei offene Tasks und einen erledigten Task vorbereiten. In Titel, ID, Markdown mit Checkliste und Log nach einer Phrase mit Sonderzeichen sowie mit einem Zeilenumbruch suchen. Ohne Filter bleiben alle Tasks sichtbar; Treffer erscheinen auch im geöffneten Detailpanel und in erledigten Tasks. Links, Textauswahl, Editor-Caret und lokale Rückgängig-Aktion bleiben benutzbar.
2. Filter per Trichter und Ctrl+F umschalten. Ctrl+F von außerhalb markiert den vorhandenen Suchtext; innerhalb bleibt die Caretposition erhalten. Liste, Netzplan, Gantt und Protokoll wechseln: tiefe Treffer bleiben, leere Tage und Kanten zu ausgeblendeten Tasks verschwinden. Der geöffnete Detailtask bleibt erhalten. Erledigte Tasks zeigen Treffer/Gesamt, auch bei leerem Suchtext.
3. Enter öffnet den obersten Treffer; ohne Treffer bleibt die Auswahl erhalten. Ein Klick auf Plus legt auch im Filtermodus an. Ohne Filter legt Enter an und leert die Suche. Escape leert die Suche, deaktiviert den Filter und verlässt das Eingabefeld.
4. Eine Notiz ändern und löschen, jeweils Undo/Redo ausführen. Nur der projizierte Notiztext darf gefunden werden. Eine Beschreibung und darin enthaltene Quelle ersetzen/entfernen: der alte Text darf keinen Task im Filter halten. Weiterhin sichtbare Umbenennungshinweise sind als Protokolltext durchsuchbar.
5. Bei aktivem Suchtext Detail- und Loggrößen ändern, lange Notizen bearbeiten und scrollen, zwischen Ansichten wechseln und Windows-Skalierung prüfen. Hervorhebungen müssen auf den sichtbaren Zeichen liegen und mit Escape vollständig verschwinden. Diese Darstellung in der nativen WebView2-Instanz ist durch DOM-/Chromiumtests nicht belegt.
