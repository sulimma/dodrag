# Arbeiten an DoDrag

## Produkt und Zusammenarbeit
- Native Windows-App für schnelles Zurückstellen und Wiederaufnehmen kleiner Aufgaben; exakte Terminplanung ist nachrangig.
- Bestehende Bedienregeln erhalten. Ansichten verwenden gemeinsame Taskaktionen und Editoren. Produktentscheidungen nicht als Fehler behandeln.
- Datei-spezifische Designentscheidungen, Architektur und Konventionen direkt in der jeweiligen Quelldatei dokumentieren. Übergreifende Regeln gehören hierher; die [Code-Karte](docs/CODE_MAP.md) dient nur der Navigation.
- Nur im Workspace editieren. Pfade auf Google Drive immer quoten. Keine App starten oder Nutzerprozesse beenden, um Builds zu ermöglichen.

## Prüfungen und Abschluss
- Während der Entwicklung zuerst kompilieren und bei Bedarf gezielte Verhaltenstests ausführen. Der Nutzer prüft die App manuell.
- Reine Designänderungen ohne Funktionsänderung werden nicht getestet. Keine Tests auf CSS-Klassen, Farben, Abstände oder andere rein visuelle Details hinzufügen. Funktionale Geometrie wie Dropziele bleibt Verhalten.
- Vor jedem Commit einmal vollständig prüfen: `./build.ps1 -Version <SemVer> -Test`. Das umfasst Frontendtests, Typecheck/Frontendbuild, Go-Tests, Release-Guard und natives Wails-Packaging. Erfolgreiche Prüfungen ohne neue relevante Änderung nicht wiederholen.
- Während der Entwicklung: `./build.ps1 -Version <SemVer>` kompiliert und aktualisiert die Test-EXE ohne Testsuite.
- Gezielte Frontendprüfung: `./frontend.ps1 -Action Test -TestFiles src/domain/dates.test.ts`. Weitere Aktionen: `Build`, `Typecheck`, `Sync`, `LanguageAudit`.
- Nach App-Änderungen eine aktuelle `dodrag.exe` im Projektstamm bereitstellen. Build-/Kopierfehler melden; alte Artefakte nicht als neu ausgeben. Dokumentationsänderungen und reine Reviews brauchen keinen App-Build.
- Tests bevorzugen beobachtbares Verhalten, Fehlerfälle und Zustandswechsel. Keine Tests nur zur Abbildung der Implementierung hinzufügen. DOM-Tests prüfen keine native Windows-Integration.
- Browser-/Chromiumtests sind kein regulärer Testumfang; nur für einen konkret begründeten Interaktionstest verwenden.
- Binaries, `dist` und Dependencies nicht committen. Keine Commits/Pushes/Releases ohne Auftrag.

## Orientierung nach Bedarf
- [Code-Karte](docs/CODE_MAP.md): Einstiegspunkte für Reviews und Änderungen.
- [Entwicklungsumgebung](docs/DEVELOPMENT.md): Cache, Toolchain, Build und Testgrenzen.
- [Sprachen](frontend/src/i18n/AGENTS.md): bei UI-Texten/Katalogänderungen lesen; alle 15 Sprachen erhalten. Sprachliche Heuristiken sind ein optionaler Audit, keine Commit-Voraussetzung.
- Historisches Review: `docs/reviews/CODE_REVIEW_2026-10-17_12-46-19.md`; kein aktueller Fehlerkatalog und keine zusätzliche Pflichtprüfung.

## Reviews
- Zuerst Datenverlust, Blockierungen und inkonsistente Bedienzustände untersuchen. Fehlerpfade und Kombinationen vorhandener Funktionen sind wichtiger als zusätzliche Layoutprüfungen.
- Reproduzierte Fehler, aus dem Code abgeleitete Risiken und Produktvorschläge klar unterscheiden.
- Vereinfachungen benennen konkret die entfallenden Zustände, Verzweigungen oder doppelten Implementierungen. Weniger unterstützte Listeneinträge allein sind kein Strukturgewinn.
- Erst Code-Karte und relevante Dateien lesen, dann gezielt vertiefen. Keine vollständigen Tests ohne konkrete Fragestellung wiederholen; bei einem umfassenden Review ist ein einmaliger Basislauf sinnvoll.
