# Build and test with a local dependency cache; never stop or start user processes.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$env:PATH += ";C:\Program Files\Go\bin;$env:USERPROFILE\go\bin"
$localNodeDir = Join-Path $env:LOCALAPPDATA "dodrag_node_cache"
function Assert-NativeSuccess([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "$step failed (exit $LASTEXITCODE)" }
}
if (-not (Test-Path -LiteralPath $PSScriptRoot)) { throw "Project directory missing" }
if (-not (Test-Path -LiteralPath $env:LOCALAPPDATA)) { throw "Local cache parent missing" }
Push-Location $PSScriptRoot
try {
    New-Item -ItemType Directory -Force -Path $localNodeDir | Out-Null
    $definitionHash = (Get-FileHash -LiteralPath "frontend\package.json" -Algorithm SHA256).Hash
    $marker = Join-Path $localNodeDir ".dependencies.sha256"
    $previousHash = if (Test-Path -LiteralPath $marker) { [IO.File]::ReadAllText($marker).Trim() } else { "" }
    Copy-Item "frontend\package.json", "frontend\index.html", "frontend\tsconfig.json", "frontend\vite.config.ts", "frontend\tailwind.config.js", "frontend\postcss.config.js" $localNodeDir -Force
    if (Test-Path -LiteralPath "$localNodeDir\src") { Remove-Item -LiteralPath "$localNodeDir\src" -Recurse -Force }
    Copy-Item "frontend\src" "$localNodeDir\src" -Recurse -Force
    if (-not (Test-Path -LiteralPath "$localNodeDir\node_modules") -or $previousHash -ne $definitionHash) {
        npm --prefix $localNodeDir install --package-lock=false --no-audit --no-fund
        Assert-NativeSuccess "Dependency installation"
        [IO.File]::WriteAllText($marker, $definitionHash)
    }
    npm --prefix $localNodeDir test
    Assert-NativeSuccess "Frontend tests"
    npm --prefix $localNodeDir run build
    Assert-NativeSuccess "Frontend build"
    if (-not (Test-Path -LiteralPath "$localNodeDir\dist\index.html")) { throw "Frontend artifact missing" }
    if (Test-Path -LiteralPath "frontend\dist") { Remove-Item -LiteralPath "frontend\dist" -Recurse -Force }
    Copy-Item "$localNodeDir\dist" "frontend\dist" -Recurse -Force
    go test ./...
    Assert-NativeSuccess "Go tests"
    # Wails embeds the Windows manifest and resources; -s skips the already checked frontend.
    $oldToolchain = $env:GOTOOLCHAIN
    try {
        # Wails 2.9.2's CLI dependency x/tools is incompatible with Go 1.27.
        $env:GOTOOLCHAIN = "go1.23.12"
        $buildVersion = "0.1.4rc2"
        $buildTime = (Get-Date).ToUniversalTime().ToString("o")
        Copy-Item -LiteralPath "frontend\src\assets\app-icon.png" -Destination "build\appicon.png" -Force
        # Wails only generates ICO files when missing; never package an older cached icon.
        if (Test-Path -LiteralPath "build\windows\icon.ico") { Remove-Item -LiteralPath "build\windows\icon.ico" -Force }
        go run github.com/wailsapp/wails/v2/cmd/wails@v2.9.2 build -s -ldflags "-X main.buildVersion=$buildVersion -X main.buildTime=$buildTime" -o dodrag.exe
        Assert-NativeSuccess "Wails packaging"
    } finally { $env:GOTOOLCHAIN = $oldToolchain }
    if (-not (Test-Path -LiteralPath "build\bin\dodrag.exe")) { throw "Packaged executable missing" }
    Copy-Item "build\bin\dodrag.exe" "dodrag.exe" -Force
    Write-Host "Build and tests completed. App was not started." -ForegroundColor Green
} finally { Pop-Location }
