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
