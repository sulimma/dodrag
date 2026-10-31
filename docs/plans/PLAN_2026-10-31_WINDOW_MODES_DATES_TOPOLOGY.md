# Implementierungsplan: Fenstermodi, Datumsanzeige und aktive Tasks

Datum: **2026-10-31**  
Status: Implementierungshistorie. Die Fensteranforderungen wurden am 2026-10-31 im Chat geändert: Einzelklick statt Doppelklick; normales Fenster im Hintergrund → unverändert nach vorne/fokussieren → Mini → Taskleistenbutton → normales Fenster vorne. Vollbild entfällt. Maßgebliche Umsetzung in `window_mode.go`, `window_windows.go` und `App.tsx`; die ursprünglichen Fensterabschnitte unten sind damit überholt.
  
Geprüfter Ausgangspunkt: Commit `9d63799`. Beim Sitzungsstart den dann aktuellen Stand und `AGENTS.md` prüfen.

## 1. Ziel und Abgrenzung

Die nächste Sitzung implementiert gemeinsam:

1. Einen zuverlässig wiederholbaren Doppelklick auf den **DoDrag-Button in der Windows-Taskleiste**.
2. Vier Fenstermodi mit einer gemeinsamen nativen Zustandssteuerung.
3. Ausschließlich Datumsanzeigen ohne Uhrzeit.
4. Aktive Tasks untereinander in einer aus der globalen Topologie abgeleiteten Reihenfolge.
5. Mini-Titel als direkten Zugang zum ausgewählten Task im normalen Fenster; keine Titelbearbeitung in Mini.

Taskleistenbutton und Infobereich-/Tray-Icon sind unterschiedliche Dinge. Gemeint ist der vorhandene Taskleistenbutton. Kein neues Tray-Icon und keine zweite App-Instanz einführen.

Die Fenstermodi sind unabhängig von den vorhandenen Inhaltsansichten Liste, Netzplan und Gantt. Fenster/Vollbild behalten die gewählte Inhaltsansicht und den App-Zustand. Die Datumsautomatik einschließlich Rückfall auf heute bleibt erhalten. Keine Migration gespeicherter Zeitstempel, keine neue Aufgabenplanung und kein Browserbetrieb.

## 2. Verbindliches Zielverhalten und Planungsannahmen

### 2.1 Vier Modi

| Interner Name, vorläufig | Darstellung | Topmost | Geometrie |
| --- | --- | --- | --- |
| `taskbar` | Nur Taskleistenbutton; kein sichtbares App-Fenster | nein | Nativ minimiertes Fenster mit erreichbarem Taskleistenbutton |
| `mini` | Bestehende Miniaturansicht | ja | Kompakte Größe und Andockecke in der Arbeitsfläche eines Monitors |
| `window` | Normales verschiebbares Fenster | nein | Wiederhergestellte normale Fensterposition und Größe |
| `fullscreen` | Vollbild auf genau einem Monitor | kein dauerhaftes Topmost | Gesamter Zielmonitor; gemeinsame Modusbedienung bleibt sichtbar |

**Zyklus:** `taskbar → mini → window → fullscreen → taskbar`.

Jeder erkannte Taskleisten-Doppelklick führt genau einen Schritt aus. Ausgangspunkt ist der Zustand vor der gesamten Geste, nicht ein durch deren ersten Klick eventuell ausgelöster Zwischenzustand. Insbesondere darf ein Doppelklick nicht zwei Stufen überspringen. Der neue Viererzyklus ersetzt die bisherige unvollständige Fenster/Mini-Umschaltung; aus `window` führt er daher nach `fullscreen`.

In allen drei sichtbaren Modi enthält die Titelzeile dieselben drei Direktwahltasten: Mini, Fenster, Vollbild. Der aktuelle Modus ist sichtbar und semantisch, z. B. mit `aria-pressed`, gekennzeichnet. Die Direktwahl des schon aktiven Modus ist wirkungslos. Für Taskbar-only bleibt normales Minimieren erreichbar; keine vierte sichtbare Moduswahltaste ist gefordert.

### 2.2 Annahmen für die Umsetzung

- Vollbild bedeutet echtes monitorfüllendes Vollbild, nicht lediglich ein maximiertes normales Fenster. Eine eventuell weiterhin erlaubte native Maximierung gehört zur Fenstergeometrie des Modus `window`, nicht zu einem fünften Modus.
- Ein einfacher Taskleistenklick behält soweit möglich Windows-typische Aktivierungs-/Minimierungssemantik. Die Doppelklickerkennung darf dadurch nicht zwei Moduswechsel auslösen. Ob dafür eine merkliche Verzögerung des Einzelklicks nötig wäre, im nativen Vorversuch klären und als Bedienentscheidung zurückmelden.
- Direkte Moduswechsel bleiben auf dem Monitor des zuletzt sichtbaren App-Fensters. Der Monitor der angeklickten Taskleiste erzwingt keinen unerwarteten Sprung.
- Ohne ausdrücklichen Zusatzauftrag keinen neuen persistierten Startmodus einführen. Bestehende Startparameter und Autostart bleiben kompatibel; `--minimized`/`--minimize` bedeuten weiterhin Mini, `--restore` weiterhin normales Fenster.
- Die bestehende Zehnminuten-Auto-Mini-Regel nicht beiläufig entfernen. Sie darf weder Taskbar-only noch Vollbild überschreiben und keine offenen Dialoge oder laufende Bearbeitung unerwartet verdrängen. Zu Sitzungsbeginn kurz entscheiden, ob die bisherige Automatik für ein inaktives normales Fenster erhalten bleiben soll; Empfehlung: zunächst erhalten, auf diesen Fall begrenzen.

### 2.3 Festgelegte Bedienung der Mini-Einträge

**Entscheidung: Variante a.** Die Miniaturansicht dient dem Überblick und schnellen Taskaktionen. Ein Klick auf den Titel öffnet direkt den Modus `window`, wählt genau diesen Task aus und öffnet dessen Detailansicht. Dafür ist kein Doppelklick erforderlich. Das ist eine Direktwahl, kein Schritt im Taskleisten-Viererzyklus.

- Titel sind in Mini nicht in-place editierbar. Titelbearbeitung in Liste, Netzplan, Gantt und Detailpanel im normalen Fenster/Vollbild bleibt unverändert.
- Enter auf einem ausgewählten oder fokussierten Mini-Eintrag führt denselben Öffnungsablauf aus. Erst eine weitere bewusste Aktion im normalen Fenster startet die Titelbearbeitung; der Wechsel selbst startet keinen Editor.
- Die vorhandenen Mini-Aktionsknöpfe für Aktivieren, Zurückstellen und Erledigen führen nur ihre jeweilige Aktion aus. Ihr Klick darf nicht gleichzeitig den Task im normalen Fenster öffnen.
- Keinen zusätzlichen Hover-Öffnen-Button einführen. Die Titelfläche selbst ist der große, dauerhaft erreichbare Einstieg; die übrigen Hover-Aktionen bleiben erhalten.
- Die Moduswahl „Fenster“ in der Titelzeile bleibt eine allgemeine Moduswahl. Das Öffnen eines konkreten Mini-Tasks ergänzt diese um Taskauswahl und offene Details.
- Diese bewusst gewählte Ausnahme von der ansichtsübergreifenden Titelbearbeitung direkt in `MiniCornerView.tsx` dokumentieren. Sie ist kein Anlass für abweichende Kontextmenüs oder neue Taskaktionsregeln.
## 3. Ausgangslage und konkrete Einstiegspunkte

| Bereich | Heutiger Befund | Dateien |
| --- | --- | --- |
| Native Modi | `isMiniMode`, `savedRect`, `savedStyle`, `savedPlacement`; mehrere Einstiegswege | `app.go` |
| Taskleisten-/Systembefehle | `WM_SYSCOMMAND` fängt Minimieren ab; im Mini-Modus wird Minimieren geschluckt. Wiederherstellen läuft über einen getrennten Pfad. | `window_windows.go`, `triggerMinimizeFromNative`, `triggerRestoreFromNative` |
| Hintergrundkorrektur | `watchNativeMinimize` prüft alle 200 ms und verwandelt Minimierung wieder in Mini | `app.go` |
| Frontendmodus | Lokales `isMiniMode`, getrennte Ereignisse `window:minimized`/`window:restored`, teilweise optimistische Umschaltung | `frontend/src/App.tsx`, `bridge/eventBridge.ts` |
| Bedienung | Getrennte Mini-/Restore-Knöpfe und `Ctrl+M`; Mini hat bereits eine eigene ziehbare Titelleiste | `AppToolbar.tsx`, `MiniCornerView.tsx`, `useGlobalShortcuts.ts` |
| Editorpersistenz | Lokale Sitzungen, abschließendes Flush, nativer Close-Handshake | `useDescriptionDrafts.ts`, `App.tsx`, `editor_session.go` |
| Globaler Graph | `ReplayState.orderedTasks` enthält bereits eine globale topologische Reihenfolge. Ein globales Level ist noch nicht exponiert. | `domain/commands.ts` |
| Ansichtsreihenfolge | Aktive Tasks werden aktuell nach Aktivstatus und Datum/ID priorisiert; Mini sortiert nochmals. | `domain/projector.ts` |
| Netzplan | Lokale Level für inaktive Tagesgruppen; aktive Tasks werden separat nebeneinander umgebrochen. | `components/NetworkPlanView.tsx` |
| Gantt | Übernimmt Listenpriorität und gruppiert aktive Zeilen nochmals vor inaktiven Zeilen. | `components/GanttView.tsx` |
| Datum/Uhrzeit | `formatDate` unterstützt Zeitoptionen; `formatIso8601Display` liefert teils Uhrzeiten und wird auch für Eingabe-/Mutationslogik benutzt. | `i18n/index.ts`, `domain/projector.ts`, `useInlineEditors.ts`, `useTaskMutations.ts` |
| Weitere Uhrzeiten | Log inklusive Kopiertext und Build-Footer zeigen Uhrzeiten. | `TaskLogSection.tsx`, `SettingsModal.tsx` |

## 4. Arbeitspaket A: Taskleistenverhalten zuerst nativ klären

Dies ist der erste technische Prüfpunkt, bevor die vier Modi großflächig verdrahtet werden.

1. Bestehenden Fehler mit einer eigens gestarteten Testinstanz reproduzieren: Fenster → Mini und erneuter Taskleisten-Doppelklick. Eine bereits laufende Nutzerinstanz nicht beenden.
2. Eine kleine, temporär aktivierbare native Ereignisdiagnose an den bestehenden Window-Subclass anschließen. Pro Ereignis nur Zeitpunkt, relevante Nachricht/Systembefehl, aktuellen Modus und Aktivierungszustand protokollieren; keine Nutzerdaten.
3. Mindestens folgende echte Abläufe gegenüberstellen: Taskleisten-Einzelklick, Doppelklick, Systemmenü, Minimierknopf, Alt+Tab, Tastatur-Wiederherstellen sowie Direktwahl in der App. Den ursprünglichen Fehler erst nach dieser Gegenprobe einem konkreten Nachrichtenpfad zuordnen.
4. Nicht unterstellen, dass die Taskleiste ein `WM_LBUTTONDBLCLK` an das App-Fenster liefert. Ebenso ist ein `SC_MINIMIZE`/`SC_RESTORE` allein kein eindeutiger Beleg für einen Taskleisten-Doppelklick: `WM_SYSCOMMAND` bedient auch andere Systemaktionen. [Microsoft-Dokumentation](https://learn.microsoft.com/en-us/windows/win32/menurc/wm-syscommand)
5. Aus den belegten Ereignissen eine kleine native Erkennung ableiten. Falls ein eigener Zeitabgleich erforderlich ist, die Windows-Einstellung über `GetDoubleClickTime` berücksichtigen, nicht eine beliebige feste Millisekundenzahl. Zeitnähe allein beweist aber keine Taskleistenquelle. [Microsoft-Dokumentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdoubleclicktime)
6. Den Zustand vor dem ersten Klick festhalten und die erkannte gesamte Geste nur einmal an den Moduscontroller übergeben. Zugehörige Aktivierungs-/Restore-/Minimize-Nachrichten dürfen denselben Wechsel nicht nochmals ausführen.
7. Wenn die vorhandenen Nachrichten keine zuverlässige Quellunterscheidung erlauben, eine kleine, appbezogene Alternative zunächst nativ belegen. Keine globale Mausüberwachung, Explorer-Manipulation oder Bildschirmkoordinaten-Heuristik als stillschweigende Voraussetzung einbauen. Eine verbleibende technische Einschränkung gezielt melden, statt einen beliebigen Doppelklick oder zwei Systembefehle als Taskleisten-Doppelklick auszugeben.

Ergebnis: reproduzierbarer nativer Eingabeadapter plus dokumentierter tatsächlicher Ereignisablauf. Kommentare und Begründungen gehören an diese Implementierung; Diagnoseausgaben anschließend entfernen oder ausdrücklich optional halten.

## 5. Arbeitspaket B: Ein gemeinsamer Fenstermoduscontroller

### 5.1 Zustand und API

- Eine zentrale native Repräsentation der vier Modi einführen, vorzugsweise in einer kleinen `window_mode.go` mit Windows-Anwendung in `window_windows.go` oder einer gezielt abgetrennten Windows-Datei.
- Eine Direktwahl wie `SetWindowMode(mode)` und einen Zyklusbefehl wie `CycleWindowMode()` vorsehen. Namen sind Vorschläge, keine zusätzliche Parallel-API neben alten Handlern.
- Alle Eingänge darauf führen: Taskleistengeste, Titelzeilentasten, native Systembefehle, Mini-Wiederherstellung, `Ctrl+M`, Startparameter und Jump-List-Aktionen.
- Vorhandene `EnterMiniMode`/`ExitMiniMode` nur kurzzeitig als delegierende Übergangswrapper behalten; nach Umstellung der Aufrufer tote APIs entfernen.
- Native Zustandsantwort und ein gemeinsames Ereignis, z. B. `window:mode-changed`, mit bestätigtem Modus und nötigen Monitor-/Dockinformationen liefern. Beim Start den aktuellen Modus abfragen, um verpasste Frühereignisse abzufangen.
- Frontendzustand folgt der bestätigten nativen Antwort. Ein Win32-Fehler darf keine Mini-UI in einem normalen Fenster oder eine Vollbildmarkierung ohne Vollbild hinterlassen.
- Wechsel serialisieren. Ein Doppelklick ist ein Zyklusauftrag; wiederholte echte Gesten nicht durch ein pauschales Busy-Flag verschlucken. Ein System-Folgeereignis ist hingegen keine neue Geste. Direktwahl ist idempotent.
- Wails-Aufrufe und UI-Thread-Nachrichten nicht unter einem Mutex ausführen, auf den ein synchroner nativer Callback erneut warten muss. Das vorhandene asynchrone Subclass-Muster berücksichtigen.

### 5.2 Geometrie und Betriebssystemzustand

- `taskbar`: wirklich minimieren und den Shell-/Taskleisteneintrag erhalten. Nicht einfach das Fenster verstecken. Den bisherigen Watchdog so ändern, dass er diesen beabsichtigten Zustand nicht unmittelbar in Mini zurückverwandelt.
- `mini`: vorhandene Dock-/DPI-Funktionen wiederverwenden; Topmost zuverlässig setzen. Beim Verlassen Topmost und Mini-spezifische Mindestgrößen/Styles wieder zurücksetzen.
- `window`: normale Platzierung einschließlich nativer Maximierungsinformation sinnvoll wiederherstellen. Die normale Platzierung nur beim Verlassen des normalen Fensters sichern; Mini-/Vollbildrechtecke dürfen sie nicht überschreiben.
- `fullscreen`: lokal vorhandene Wails-2.9.2-APIs `WindowFullscreen`/`WindowUnfullscreen` zuerst gegen bestehende Style-/Placement-Helfer prüfen. Eine Strategie wählen; keine zwei unabhängig verwalteten Fullscreenzustände in Wails und eigener Win32-Logik aufbauen.
- Rückkehr aus Vollbild stellt zuerst den passenden Fensterstil wieder her und wendet dann Zielmodus und Zielgeometrie an. Vollbild darf Topmost aus Mini nicht erben.
- Native Maximieren-/Wiederherstellen-/Minimieren-Befehle explizit zuordnen; sie dürfen nicht als unbeabsichtigte zusätzliche Zyklusschritte wirken. Unbehandelte Systembefehle regulär weiterreichen.
- Den 200-ms-Watcher auf notwendige Beobachtung/Monitorreparatur beschränken. Er ist keine zweite Zustandsmaschine neben Controller und Window-Subclass.

### 5.3 Sitzungen, Dialoge und vorhandene Tastaturbedienung

- Wechsel, die den Editor entfernen oder das Fenster minimieren, beenden die Beschreibungssitzung. Den vorhandenen Draft-/Flushmechanismus wiederverwenden; keine neue Autosave- oder Close-Implementierung.
- Bei fehlgeschlagenem Flush einen noch nicht ausgeführten App-Moduswechsel nicht als erfolgreich melden; Entwurf und erreichbare Oberfläche erhalten. Bereits vom OS ausgelöste Zwischenzustände mit dem Controller kontrolliert korrigieren.
- Fenster ↔ Vollbild soll Komponenten und lokale Editorhistorie möglichst erhalten, weil nur die Geometrie wechselt. Dafür nicht unnötig die gesamte App neu mounten.
- Einstellungen/Hilfe dürfen nach einem Wechsel nicht unsichtbar aktiv bleiben und globale Shortcuts blockieren. Bei Bedarf zuerst im normalen Fenster anzeigen; Dialogzustand explizit behandeln.
- `Ctrl+M` als bestehende Mini/Window-Abkürzung erhalten und auf den Controller führen; der Viererzyklus ist an die Taskleistengeste gebunden. Explizite Vollbild-Direktwahl über Titelzeile; optionales F11 nur bei bewusstem Zusatzentscheid, nicht nebenbei einführen.
- Schließen verwendet weiterhin `editor_session.go`. Minimieren ist kein Schließen, und Vollbild verlassen darf keinen Close-Handshake auslösen.

## 6. Arbeitspaket C: Gemeinsame Titelzeile und Mehrmonitorbetrieb

### 6.1 Titelzeile

- Eine gemeinsame Moduswahlkomponente für Mini, Fenster und Vollbild erstellen. Gleiche Aktionen, Labels und Kennzeichnung in allen drei Darstellungen; keine drei kopierten Button-/Handlerlisten.
- Die Moduswahl in einer tatsächlich oberen gemeinsamen App-Titelzeile unterbringen. Für Vollbild muss sie auch ohne native Caption erreichbar bleiben; Mini verwendet den vorhandenen ziehbaren Titelstreifen als Ausgangspunkt.
- Native Caption-Integration versus eigene Client-Titelzeile früh konkret festlegen. Bevorzugt eine gemeinsame eigene Titelzeile, falls native Buttons nicht sauber erweiterbar sind. Bei Wegfall der nativen Caption müssen Verschieben, Resize, Systemmenü, Minimieren und Schließen erhalten bleiben. Keine vollständige neue Fensterrahmenbibliothek bauen.
- Buttons sind keine Dragflächen. Tastaturbedienung, Tooltips, Fokus und aktueller Modus müssen funktionieren. Die Miniansicht muss trotz der drei Modustasten noch bedienbar bleiben; reine Gestaltung entscheidet der Nutzer im manuellen Lauf.
- Neue UI-Begriffe und Texte in allen 15 Katalogsprachen pflegen. Bei neuen wiederkehrenden Begriffen das Glossar ergänzen. Kein verpflichtender sprachlicher Heuristiklauf.

### 6.1a Mini-Titel öffnet den Task statt einen Editor

- In `MiniCornerView.tsx` den vorhandenen Ablauf `onSelectAndRestore(task.id)` für den Titel-Einzelklick und die Tastaturaktivierung nutzen und in den gemeinsamen Fenstermoduscontroller integrieren. Die bisherige Abhängigkeit von freier Fläche neben dem Titel entfällt.
- Für den Öffnungsvorgang dieselbe Task-ID bis zum bestätigten Wechsel behalten: Modus `window`, Task ausgewählt, Details geöffnet. Fehler nicht durch eine vorzeitig umgeschaltete React-Ansicht verdecken. Es wird keine zweite App-Instanz geöffnet.
- Die Titelfläche als zugängliches interaktives Element mit sinnvoller Tastaturbedienung ausführen. Aktionsknöpfe bleiben getrennte Geschwister; keine Buttons in einen umschließenden Zeilen-Button verschachteln.
- `TaskTitle.tsx` startet derzeit über Fokus/Klick/Input eine Bearbeitung und stoppt Klickweitergabe. Deshalb Mini nicht lediglich einen äußeren Clickhandler hinzufügen. Falls die gemeinsame Titelkomponente weiterverwendet wird, muss ihr expliziter Nur-Lesen-/Öffnen-Modus auch `contentEditable` und sämtliche Editierhandler abschalten. Einen Task dafür keinesfalls künstlich als erledigt kennzeichnen.
- Bestehende Einzel-/Doppelklickhandler der Mini-Zeile auf denselben Öffnungsweg reduzieren. Ein normales Öffnen startet keinen Titel-Editor und wird durch nachlaufende Handler derselben Aktivierung nicht nochmals ausgeführt.
- In `useGlobalShortcuts.ts` Enter in Mini vor dem allgemeinen Titel-Editierpfad behandeln. F2/E dürfen in Mini keinen unsichtbaren Editorzustand eröffnen; sie können denselben Wechsel ins normale Fenster auslösen, ohne dort automatisch die Bearbeitung zu starten. Passende Hilfetexte nach den Sprachregeln anpassen.
- Beim Wechsel dürfen weder Mini-Topmost noch Mini-Fokus-/Editierzustände im normalen Fenster hängenbleiben. Vorhandene gemeinsame Auswahl-, Detail- und Modushandler wiederverwenden.
### 6.2 Monitor- und DPI-Regeln

- Vor jedem Wechsel den Monitor des aktuell sichtbaren Fensters ermitteln. In Taskbar-only den zuletzt sichtbaren App-Monitor verwenden; eine minimierte Sentinelposition ist keine echte Nutzerplatzierung.
- Mini bleibt in der Arbeitsfläche einschließlich Taskleistenabzug. Vollbild nutzt den gesamten einzelnen Monitor, niemals den gesamten virtuellen Desktop.
- Normale Größe/Position erhalten. Wenn die gespeicherte normale Position auf einem anderen als dem aktuellen Zielmonitor liegt, das Fenster auf dem Zielmonitor sichtbar platzieren und an dessen Arbeitsfläche begrenzen. Dafür zunächst kein komplexes persistiertes Placement pro Monitor einführen.
- Logische Größen und physische Bildschirmkoordinaten klar trennen; bestehende DPI-Helfer nutzen. Rechtecke aus `WINDOWPLACEMENT` und `GetWindowRect` nicht ohne Prüfung der Koordinatensysteme vermischen.
- Monitore links/oberhalb des Primärmonitors mit negativen Koordinaten unterstützen. Negative Koordinaten sind nicht pauschal „unsichtbar“.
- Nach Monitortrennung: noch angeschlossenen letzten Monitor verwenden, sonst Primärmonitor; Fenster sichtbar begrenzen, Mini neu andocken, Vollbild auf genau einem verfügbaren Monitor neu anwenden.
- `WM_DPICHANGED` und `WM_DISPLAYCHANGE` nach Modus behandeln. Im Taskbar-Modus nicht ungefragt ein sichtbares Fenster herstellen. Geometriekorrekturen nicht als Nutzer-Zyklusereignis behandeln.
- Mini-Dockecke und Monitorpräferenz wie bisher speichern. Neue Laufzeit-Modusinformationen sind ohne gesonderten Bedarf keine Settings-/Datenbankmigration.

## 7. Arbeitspaket D: Anzeigen ausschließlich als Datum

### 7.1 Geltungsbereich

Alle von DoDrag erzeugten Datumsanzeigen sind `YYYY-MM-DD`, ohne Uhrzeit: Tasks, Detailpanel, Datumstooltips, Statusmeldungen, Log-/Lifecyclezeilen, vom Tool erzeugte Log-Kopiertexte und Build-Footer. Vorbelegte Datumseditorwerte ebenfalls ohne Uhrzeit.

Nutzertexte in Titeln, Beschreibungen, Notizen, Dateinamen und URLs nicht umschreiben. Gespeicherte ISO-Zeitpunkte, Eventreihenfolge, Zeitzonenbehandlung und fachliche Terminberechnung bleiben erhalten. Kein Abschneiden von Datenbankwerten und keine automatische Umwandlung aller Zeitstempel auf Mitternacht oder 09:00.

### 7.2 Umsetzung

1. Anzeigeformatierung und technische Eingabe-/Zeitstempelformatierung voneinander entkoppeln. `formatIso8601Display(...).isoText` wird derzeit auch von `useInlineEditors` und `useTaskMutations` benutzt; es darf nicht blind global auf ein Datum gekürzt werden.
2. Einen gemeinsamen date-only Anzeigeweg verwenden. `formatDate` so vereinfachen, dass UI-Aufrufer keine Uhrzeiten mehr anfordern können, oder die bisherige Zeitoption vollständig aus den Aufrufern entfernen und ihren späteren Rückfall strukturell verhindern.
3. `TaskDate`, `TaskLogSection.dateLine`, `SettingsModal.formatBuildTime`, Tooltips und Toasts umstellen. Bei ungültiger Buildzeit einen vorhandenen übersetzten Ersatz verwenden; nicht als versteckte Uhrzeitanzeige wieder den rohen Timestamp ausgeben.
4. Datumseingabe date-only vorbelegen. Öffnen und unverändertes Bestätigen darf einen gespeicherten Wert mit z. B. 14:30:12 nicht auf 09:00 überschreiben. Den Vergleich mit dem ursprünglichen sichtbaren Datum vor der Normalisierung durchführen.
5. Absolute ISO-Ziele von Drag/Mutationen direkt als technische Werte behandeln; nicht durch einen gekürzten UI-Formatter zurückparsen. Bestehende optionale Zeitangaben im Parser müssen wegen dieser reinen Anzeigeänderung nicht aus gespeicherten Daten oder technischen Eingabewegen entfernt werden; die UI bewirbt sie nicht mehr.
6. Lokales Kalenderdatum weiterhin korrekt aus dem gespeicherten Instant ableiten. Kein allgemeines `timestamp.slice(0, 10)`, das nahe UTC-Mitternacht das falsche lokale Datum anzeigen kann.
7. Datumsanzeigen dürfen gleich aussehen, ohne Daten zusammenzufassen: Logs bleiben in ihrer bestehenden Ereignisreihenfolge. Keine Sortierung nach der nun verkürzten Anzeige einführen.
8. Kommentare und zugehörige Katalogwerte mit Uhrzeitversprechen aktualisieren. Technische historische Übersetzungsschlüssel können stabil bleiben; Werte/Platzhalter in allen Sprachen konsistent halten.

## 8. Arbeitspaket E: Aktive Tasks aus globalen Topologieleveln ordnen

### 8.1 Regel

Aktive offene Tasks bleiben vor inaktiven Tasks. Innerhalb der aktiven Gruppe stehen Vorgänger vor ihren Nachfolgern, auch wenn dazwischen inaktive oder erledigte Tasks liegen. Aktive Tasks werden **untereinander** dargestellt; im Netzplan darf die aktive Gruppe nicht mehr abhängig von der Fensterbreite nebeneinander umbrechen.

Ein globales Level nach `level(task) = 0` für Wurzeln, sonst `1 + max(level(vorgänger))`, ordnet jede Kante streng aufsteigend. Das gilt auch für gefilterte aktive Teilmengen. Gleiche Level erhalten einen deterministischen Tie-Breaker aus vorhandener `creationOrder` und ID.

### 8.2 Ableitung ohne neue Teilgraphsortierung

1. `ReplayState.orderedTasks` als vorhandene globale topologische Reihenfolge nutzen. Level während des bereits existierenden globalen Graphdurchlaufs berechnen und als abgeleitete Cachemetadaten aufbewahren.
2. Heute existiert dieses globale Level-Feld noch nicht. Es ergänzen, statt fälschlich die lokalen Netzplan-Tageslevel als globale Level wiederzuverwenden. Beispielsweise `topologyLevels` in `ReplayState` und `topologyLevel` in `TaskState`; genaue Namen in der Implementierung festlegen.
3. Level auf dem vollständigen gespeicherten Abhängigkeitsgraphen berechnen. Dafür die konfigurierten Vorgänger aus dem Replay verwenden, nicht erst die nach Aktivstatus/Erledigung gefilterten sichtbaren Kanten. Zwischenknoten dürfen die Reihenfolge der aktiven Endpunkte nicht zerstören.
4. Keine zweite Kahn-/DFS-/`stableTopology`-Sortierung für aktive Tasks aufrufen. Das Sortieren nach bereits berechneten numerischen Leveln ist eine normale Darstellungssortierung, kein erneuter Graphalgorithmus.
5. Cachepfade vollständig pflegen: neue Wurzel erhält Level 0; Abhängigkeit hinzufügen/entfernen sowie Undo/Redo mit Graphänderung aktualisieren die Metadaten. Umbenennen, Beschreibung, Aktivstatus und Zeit-/Sprachwechsel erfordern keine neue globale Topologiesortierung. Bestehende Snapshot-/Replay-Immutabilität bewahren.
6. Einen gemeinsamen Vergleich für aktive Tasks verwenden. `projectEvents` und `computeMiniWindowTasks` dürfen nicht mit verschiedenen Datums-/ID-Sortierungen wieder auseinanderlaufen. Inaktive Reihenfolge und Mini-Auswahlregeln bleiben erhalten.
7. Liste und Gantt übernehmen die gemeinsame aktive Reihenfolge. Die bestehende Gantt-Nachsortierung nach Aktivstatus auf stabile Weitergabe prüfen; keine abweichende zweite Priorisierung einführen.
8. Im Netzplan die aktive Gruppe aus der gemeinsamen Reihenfolge in Einzelzeilen übernehmen. Die vorhandenen lokalen Tageslevel für die inaktive Netzplangeometrie sind ein anderes Konzept und dürfen bestehen bleiben; für die neue aktive Reihenfolge werden sie nicht erneut berechnet.
9. Pfeilrouting, Auswahl, Tastaturnavigation und eingefrorene Draggruppen müssen die geänderte Reihenfolge mittragen. Keine Änderung an Aktivierungsregeln, Startdatumsberechnung oder Alt-Kantenlöschung.

## 9. Prüfplan mit begrenztem Aufwand

### 9.1 Während der Umsetzung

Zuerst kompilieren; danach nur Tests für tatsächlich geändertes Verhalten. Gemeinsamen Cache über `frontend.ps1` verwenden. Keine Tests auf Farben, Iconsizes, Abstände oder exakte CSS-Klassen ergänzen.

**Native Controller-/Adaptertests:**
- Vollständiger Viererzyklus und idempotente Direktwahl; mehrere schnelle echte Gesten bleiben mehrere Schritte.
- Ein erkannter Doppelklick führt nur einen Übergang aus; Einzelklick/Systemmenü/Alt+Tab erzeugen keinen versehentlichen Doppelzyklus.
- Beabsichtigtes `taskbar` wird vom Watcher nicht in Mini zurückgesetzt.
- Topmost wird beim Verlassen von Mini entfernt; normale Fensterplatzierung wird nicht mit Mini/Vollbild überschrieben.
- Ein veraltetes natives Folgeereignis kann keinen neueren bestätigten Modus zurücksetzen.
- Monitorverlust/negative Koordinaten und modellierte DPI-Wechsel; tatsächliches Win32-Verhalten zusätzlich manuell.

**Frontend-/Integrationstests:**
- Drei gemeinsame Moduswahltasten in jeder sichtbaren Darstellung; aktueller Modus semantisch markiert; jede Taste ruft den gleichen Controller auf.
- Startabfrage und native Mode-Events synchronisieren UI; ein abgelehnter Wechsel täuscht keinen Erfolg vor.
- Mini-Titelklick und Enter öffnen genau den gewählten Task im normalen Fenster mit offener Detailansicht. Mini enthält keinen editierbaren Titel; beim Öffnen startet keine Bearbeitung automatisch. Aktivieren-/Zurückstellen-/Erledigen-Knöpfe lösen keinen zusätzlichen Fensterwechsel aus. Die Titelbearbeitung in den anderen Darstellungen bleibt funktional erhalten.
- Editorentwurf bei Wechsel/Fehler erhalten; reguläres Schließen nutzt weiterhin den bestehenden Flush-Handshake.
- Geöffnete Einstellungen/Hilfe hinterlassen nach Mini/Taskbar-Wechsel keine unsichtbare Tastatursperre.

**Datumsfälle:**
- Gespeicherte Uhrzeiten mit Minuten/Sekunden erscheinen nirgends in App-Datumsanzeigen, Tooltips und erzeugtem Log-Kopiertext.
- Datumseditor öffnen und ohne Änderung verlassen erzeugt keinen Schreibvorgang und erhält den ursprünglichen Timestamp.
- Datumsautomatik, Rückfall auf heute und technische ISO-Ziele bleiben unverändert funktionsfähig.
- UTC-/Ortsdatumsgrenze, Sommerzeit und Jahreswechsel mit expliziter Testzeit.

**Topologiefälle:**
- Absichtlich gegen ID-/Erstellreihenfolge gerichtete aktive Kette `C → A → B` wird als `C, A, B` angezeigt.
- `A aktiv → B inaktiv → C aktiv` ergibt in der aktiven Teilmenge `A, C`; zusätzlich mit erledigtem Zwischenknoten.
- Verzweigung/Raute, gleiche Level und unabhängige Tasks bleiben deterministisch; Aktivieren/Deaktivieren und Undo/Redo stimmen in Liste, Mini und Gantt überein.
- Netzplan zeigt aktive Tasks bei schmalem und breitem Fenster als Einzelzeilen; nur funktionale Reihenfolge/Erreichbarkeit prüfen, keine Pixelgestaltung festschreiben.
- Vorhandene tiefe Graph-/inkrementelle Replaytests weiterverwenden; keine neuen Benchmarks ohne konkreten Befund.

### 9.2 Manuelle native Abnahme

Die Taskleistengeste muss in der echten Windows-App geprüft werden; DOM-/Chromiumsimulation belegt sie nicht.

1. Alle vier Zustände mindestens zweimal mit echten Taskleisten-Doppelklicks durchlaufen, jeweils auch aus nicht fokussierter App. Langsame getrennte Klicks, schneller Doppelklick und wiederholte Gesten vergleichen.
2. Direktwahl aller drei sichtbaren Modi, normales Minimieren, Wiederherstellen, Alt+Tab, Systemmenü und zweite Instanz/Jump List ausprobieren.
3. Zwei Monitore mit unterschiedlicher Skalierung; App jeweils auf Primär-/Sekundärmonitor, auch links/oberhalb des Primärmonitors. Wechsel bleiben auf dem erwarteten Monitor und Topmost endet nach Mini.
4. Mini an einer Ecke mit Taskleistenabzug; Vollbild über genau einen Monitor; anschließend normale Fenstergröße wiederherstellen.
5. Zielmonitor während Mini, Fenster, Vollbild und Taskbar-only trennen. Keine verlorenen Fenster und kein ungefragtes Aufpoppen aus Taskbar-only.
6. Mit offenem Beschreibungsentwurf, Einstellungen und Hilfe wechseln; Speichern/Fehlerwiederholung und reguläres Schließen testen.
7. In Mini direkt auf einen langen, die Zeile ausfüllenden Titel klicken und per Enter öffnen. Taskauswahl, offene Details und anschließende bewusste Titelbearbeitung im normalen Fenster prüfen. Die benachbarten Aktionsknöpfe dürfen dabei nicht versehentlich öffnen.
8. Datum ohne Zeit und aktive Abhängigkeitskette in allen Inhaltsansichten kontrollieren.

Eine manuelle Runde kann durch den Nutzer erfolgen. Wenn der Implementierungsagent sie nicht durchführen kann, die konkrete verbleibende native Abnahme offen benennen; die Taskleisten-Doppelklickanforderung nicht allein aufgrund grüner Unit-Tests als nativ bestätigt ausgeben.

## 10. Reihenfolge und Sitzungsabschluss

1. Aktuellen Arbeitsbaum/Anweisungen prüfen; offene Annahmen aus Abschnitt 2 kurz festlegen. Keine Nutzeränderungen überschreiben.
2. Taskleisten-Vorversuch durchführen und Eingabeadapter belegen. Dieser Punkt hat Vorrang vor zusätzlicher UI-Arbeit.
3. Vierermoduscontroller und Monitor-/DPI-Übergänge implementieren; dann gemeinsame Titelzeile und Frontendsynchronisierung anschließen.
4. Datumsanzeige entkoppeln und Uhrzeitdarstellung entfernen.
5. Globale Topologielevel ableiten, aktive Reihenfolge zentralisieren und aktive Netzplan-Einzelzeilen herstellen. Dieses Paket kann nach stabiler Metadatenschnittstelle unabhängig von der nativen Fensterarbeit bearbeitet werden.
6. Währenddessen nur passende gezielte Prüfungen und Kompilierungen. Falls Subagenten verwendet werden, reine Datums-/Topologiepakete mit klaren Dateigrenzen delegieren; Fenstermodus und dessen UI-Vertrag gemeinsam verantworten. Keinen gleichzeitigen Schreib-/Testbetrieb auf demselben Frontendcache.
7. Nach dem letzten App-Patch die vollständige Prüfung einmal ausführen: `./build.ps1 -Version <SemVer> -Test`. Version explizit bereitstellen, keine Produktversion in Dateien festschreiben. Native Test-EXE im Projektstamm aktualisieren, App nicht ungefragt starten oder bestehende Prozesse beenden.
8. Vor einem ausdrücklich beauftragten Commit muss die vollständige Prüfung grün sein. Dieser Plan selbst erteilt keinen Auftrag für Commit, Push oder Release.
9. Datei-spezifische Entscheidungen in den betroffenen Quellen dokumentieren, Code-Karte nur bei neuen Einstiegspunkten ergänzen. README/Sprachhinweise auf geänderte Bedienung aktualisieren; den Plan nicht als dauerhafte zweite Spezifikation neben dem Code weiterführen.
10. Abschlussmeldung: umgesetzte Modi/Datums-/Sortierregeln, Ergebnisse der Prüfungen, Pfad der aktuellen Test-EXE und tatsächlich noch ausstehende native Abnahme. Bei Build-/Kopierfehler ausdrücklich melden, dass die EXE nicht aktualisiert wurde.

## 11. Fertigkriterien

- Der Taskleisten-Doppelklick führt wiederholt und in allen Ausgangszuständen genau durch den Viererzyklus.
- Jeder sichtbare Modus bietet die gemeinsame Direktwahl und zeigt den bestätigten aktuellen Modus.
- Mini-Titelklick und Enter öffnen den ausgewählten Task im normalen Fenster mit Details; Mini selbst bietet keine Titelbearbeitung und keinen zusätzlichen Öffnen-Button.
- Taskbar-only bleibt unsichtbar und erreichbar; nur Mini ist dauerhaft topmost; Vollbild und Rückkehr funktionieren monitor- und DPI-gerecht.
- Alle App-Datumsanzeigen sind date-only, ohne Verlust gespeicherter Zeitinformationen und ohne unbeabsichtigte Schreibvorgänge beim bloßen Öffnen des Editors.
- Aktive Tasks stehen untereinander topologisch korrekt; die aktive Teilmenge löst keine eigene topologische Sortierung aus.
- Editorentwürfe, native Kontextmenüs, vorhandene Taskaktionen und reguläres Schließen bleiben konsistent.
- Vollständige Commitprüfung und natives Packaging sind erfolgreich; die Windows-Abnahme ist durchgeführt oder als konkreter offener Abnahmepunkt gekennzeichnet.
