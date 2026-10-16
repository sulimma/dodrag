# Projekt-Build & Test Skript für DoDrag (kompatibel mit Google Drive G:\)
$ErrorActionPreference = "Stop"

$env:PATH += ";C:\Program Files\Go\bin;$env:USERPROFILE\go\bin"
$localNodeDir = "$env:LOCALAPPDATA\dodrag_node_cache"

Write-Host "==> 1. Synchronisiere Frontend-Dateien in lokalen Build-Cache..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $localNodeDir | Out-Null
Copy-Item "frontend\package.json" "$localNodeDir\package.json" -Force
Copy-Item "frontend\index.html", "frontend\tsconfig.json", "frontend\vite.config.ts", "frontend\tailwind.config.js", "frontend\postcss.config.js" $localNodeDir -Force
Remove-Item "$localNodeDir\src" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "frontend\src" "$localNodeDir\src" -Recurse -Force

if (-not (Test-Path "$localNodeDir\node_modules")) {
    Write-Host "==> Installiere Frontend-Abhängigkeiten..." -ForegroundColor Cyan
    npm --prefix $localNodeDir install
}

Write-Host "==> 2. Führe Frontend Unit-Tests aus..." -ForegroundColor Cyan
npm --prefix $localNodeDir test

Write-Host "==> 3. Baue Frontend (Vite + Tailwind)..." -ForegroundColor Cyan
npm --prefix $localNodeDir run build
Remove-Item "frontend\dist" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$localNodeDir\dist" "frontend\dist" -Recurse -Force

Write-Host "==> 4. Führe Go SQLite Event-Store Tests aus..." -ForegroundColor Cyan
go test ./... -v

Write-Host "==> 5. Baue native Wails Desktop-App..." -ForegroundColor Cyan
Get-Process dodrag* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
go build -tags "desktop,production" -ldflags "-w -s -H windowsgui" -o "$localNodeDir\dodrag.exe" .
try { Copy-Item "$localNodeDir\dodrag.exe" "dodrag.exe" -Force -ErrorAction Stop } catch {}
try { Copy-Item "$localNodeDir\dodrag.exe" "dodrag_app.exe" -Force -ErrorAction Stop } catch {}

Write-Host "==> Fertig! Starte App..." -ForegroundColor Green
Start-Process "$localNodeDir\dodrag.exe"
