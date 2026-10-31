# Internationalisierung

Diese Hinweise bei neuen oder geaenderten UI-Texten lesen. Fuer reine Logik- oder Designaenderungen ist kein Sprachaudit erforderlich.

## Verbindliche Schnittstellen

- Alle 15 Sprachen pflegen: `de`, `en`, `fr`, `es`, `zh-CN`, `uk`, `pt-BR`, `ja`, `zh-TW`, `ko`, `it`, `pl`, `tr`, `eo`, `tok`.
- Frontendkataloge: `locales/<sprache>.json`; native Kataloge: `locales/backend-<sprache>.json`. Schluessel und `{platzhalter}` muessen in allen Sprachen identisch sein; Werte duerfen nicht leer sein.
- Frontendtexte ueber `t(...)`, native Texte ueber `backend_i18n.go` beziehen. Das gilt auch fuer Tooltips, ARIA-Labels und App-Fehlermeldungen. Nutzerdaten und technische Fremdfehler sind keine Uebersetzungsschluessel.
- Datum/Zeit immer ISO-8601 anzeigen; Zahlen mit der ausgewaehlten Sprache formatieren. Gespeicherte ISO-Daten, Aufgabentitel und Datenbanknamen beim Sprachwechsel unveraendert lassen.
- Historische technische Schluessel bleiben stabil. Die Referenzwerte in Deutsch/Englisch duerfen verstaendlicher formuliert werden.
- Uebersetzungen sind KI-erstellt; nur Deutsch und Englisch sind verifiziert. Hinweis und Sprachliste im README aktuell halten.

## Sprachliche Orientierung

- Bei neuen UI-Begriffen passende Eintraege in `glossary.json` lesen. Wiederkehrende oder mehrdeutige neue Fachbegriffe dort mit Bedeutung, Kontext und Uebersetzungen ergaenzen. Nicht jede neue Formulierung braucht einen Glossareintrag.
- `translations` enthaelt vollstaendige Ausdruecke und begruendete Flexionsformen, keine breiten Wortstaemme. `keys` waehlt exakte Kontexte; `excludeKeys` im `context` begruenden.
- Kurze Saetze bevorzugen, Bedingungen vor Folgen nennen. Buttons/Menueaktionen je Sprache konsistent halten: Infinitiv in de/fr/es/it/pt-BR, Imperativ in en und tok (mit `o`), sprachuebliches Verbalsubstantiv in pl/uk/ja/ko; tr/eo innerhalb eines UI-Kontexts einheitlich. Statuslabels bleiben nominal.
- In Toki Pona Eigennamen mit passendem Kopfwort, z. B. `ilo DoDrag`, `ilo VS Code`, `sitelen Mermaid`, `nasin Markdown`, `linja URL`. Technische Pfade, Tastencodes und Platzhalter nicht mechanisch umformulieren.
- Korrekte Saetze nicht veraendern, nur um eine Heuristik zu erfuellen. Bei Terminologiebefunden den ganzen Satz pruefen; bei Bedarf korrekte Flexion im Glossar ergaenzen.

## Pruefungen

- Pflicht: `i18n.test.ts` prueft Katalog-/Glossarstruktur, Platzhalter, Sprachumschaltung, Formatierung und statisch erkennbare unuebersetzte UI-Texte. Neue Rendering-Helfer im AST-Check oder einem funktionalen Laufzeittest erfassen.
- Optional: `npm run test:language` fuehrt `i18n.audit.ts` mit separater Vitest-Konfiguration aus. Es prueft Terminologieanwendung, Fehlerformulierungen sowie Toki-Pona-Satzlaengen/Eigennamen. Dieser Audit ist weder Build- noch Commitvoraussetzung.
- Weder strukturelle Tests noch sprachliche Heuristiken beweisen sprachliche Korrektheit. Muttersprachliche Pruefung bleibt davon unabhaengig.
