# Arbeiten an DoDrag

## Produkt und Zusammenarbeit
- Native Windows-App für schnelles Zurückstellen und Wiederaufnehmen kleiner Aufgaben; exakte Terminplanung ist nachrangig.
- Bestehende Bedienregeln erhalten. Ansichten verwenden gemeinsame Taskaktionen und Editoren. Produktentscheidungen nicht als Fehler behandeln.
- Datei-spezifische Designentscheidungen, Architektur und Konventionen direkt in der jeweiligen Quelldatei dokumentieren. Übergreifende Regeln gehören hierher; die [Code-Karte](docs/CODE_MAP.md) dient nur der Navigation.
- Nur im Workspace editieren. Pfade auf Google Drive immer quoten. Keine App starten oder Nutzerprozesse beenden, um Builds zu ermöglichen.

## Datenformat und Versionierung
- Die Mindest-App-Version für das geschriebene Datenformat wird im Code in `internal/eventstore/version.go` (`MinimumAppVersion`) gepflegt. Bei Datenformatänderungen erhöhen; bei allen anderen Änderungen unverändert lassen. Der historische Rückfallwert für Dateien ohne Versionsangabe bleibt `0.5.0`.
- SemVer `x.y.z`: Bei Änderungen am Datenbankformat `y` erhöhen und `z` auf 0 setzen; bei sonstigen Änderungen `z` erhöhen. `x` wird ausschließlich auf ausdrückliche Entscheidung des Entwicklers geändert. Dies gilt auch für Änderungen am gespeicherten Ereignis-/Payloadformat, nicht nur am SQL-Schema.
- Der Zusatz `rc` zählt beim Versionsvergleich und bei Datenbank-Mindestversionen nicht mit. Der aktuelle Datenformatstand beginnt mit `0.5.0`; der zugehörige aktuelle Vorab-Build ist `0.5.0rc`.
- Aus Datenschutzgründen keine automatischen Online-Updateprüfungen. Updatehinweise stammen ausschließlich aus den lokalen Versionsmetadaten bekannter Datenbanken. Erst ein ausdrücklicher Klick öffnet die GitHub-Releases; danach regulär mit Speicherschutz schließen.
- Datenbanken speichern App-Version, Build-Datum und erforderliche Mindest-App-Version. Mindestversion vor Schema-/Datenänderungen prüfen, niemals herabsetzen und beim erfolgreichen Öffnen die Build-Angaben aktualisieren. Inkompatible Dateien mit klarer Updateaufforderung und Mindestversion ablehnen; ohne Versionsangabe `0.5.0` nennen.

## Prüfungen und Abschluss
- Der Nutzer arbeitet als Entwickler interaktiv mit und prüft die App manuell. Nach kleinen Änderungen zuerst kompilieren; bei Bedarf nur gezielte, zur Änderung passende Tests ausführen. Nicht nach jeder Änderung die vollständige Testsuite starten.
- Test-Ergänzung und Test-Ausführung sind getrennte Entscheidungen: Für jedes neu entdeckte Problem einen Regressionstest ergänzen, der das fehlerhafte Verhalten erfasst und die Korrektur absichert. Das gilt auch für Probleme mit visueller Rückmeldung oder Interaktionen. Ist eine aussagekräftige automatisierte Prüfung mit den vorhandenen Mitteln nicht möglich, die Testlücke benennen und einen konkreten manuellen Regressionsablauf dokumentieren; keine Scheintests auf Implementierungsdetails als Ersatz hinzufügen.
- Tests prüfen stabile, beobachtbare Fähigkeiten, Fehlerfälle und Zustandswechsel statt veränderlicher Detailspezifikationen. Beispiel: „F1 öffnet die Hilfe“ prüfen, nicht den exakten Hilfetext. Wortlaut, CSS-Klassen, Farben, Abstände und interne Implementierung nicht festschreiben, sofern sie nicht selbst Gegenstand einer ausdrücklich festgelegten Anforderung sind. Funktionale Geometrie wie Dropziele und zutreffende Bedienhinweise sind Verhalten. Bewusste Designänderungen allein erfordern keine neuen Tests.
- Die vollständige Testsuite nach einem Satz von Änderungen auf ausdrückliches Kommando des Nutzers sowie vor jedem Commit einmal ausführen: `./build.ps1 -Version <SemVer> -Test`. Das umfasst Frontendtests, Typecheck/Frontendbuild, Go-Tests, Release-Guard und natives Wails-Packaging. Erfolgreiche Prüfungen ohne neue relevante Änderung nicht wiederholen.
- Während der Entwicklung: `./build.ps1 -Version <SemVer>` kompiliert und aktualisiert die Test-EXE ohne Testsuite.
- Gezielte Frontendprüfung: `./frontend.ps1 -Action Test -TestFiles src/domain/dates.test.ts`. Weitere Aktionen: `Build`, `Typecheck`, `Sync`, `LanguageAudit`.
- Nach App-Änderungen eine aktuelle `dodrag.exe` im Projektstamm bereitstellen. Build-/Kopierfehler melden; alte Artefakte nicht als neu ausgeben. Dokumentationsänderungen und reine Reviews brauchen keinen App-Build.
- Testgrenzen beachten: DOM-Tests prüfen keine native Windows-Integration.
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
- Erst Code-Karte und relevante Dateien lesen, dann gezielt vertiefen. Auch bei Reviews die vollständige Testsuite nur auf ausdrückliches Kommando des Nutzers ausführen; gezielte Prüfungen an konkreten Fragestellungen ausrichten.
