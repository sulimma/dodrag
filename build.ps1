# Build and test with a local dependency cache; never stop or start user processes.
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
    [string]$Version,
    [ValidateSet('amd64', 'arm64')][string]$Architecture = 'amd64',
    [switch]$Test
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$env:PATH += ";C:\Program Files\Go\bin;$env:USERPROFILE\go\bin"
$localNodeDir = Join-Path $env:LOCALAPPDATA "dodrag_node_cache"
. "$PSScriptRoot\scripts\frontend-cache.ps1"
if (-not (Test-Path -LiteralPath $PSScriptRoot)) { throw "Project directory missing" }
if (-not (Test-Path -LiteralPath $env:LOCALAPPDATA)) { throw "Local cache parent missing" }
Push-Location $PSScriptRoot
try {
    $localNodeDir = Sync-FrontendCache
    Push-Location $localNodeDir
    try {
        if ($Test) { npm test; Assert-NativeSuccess 'Frontend tests' }
        npm run build
        Assert-NativeSuccess 'Frontend build'
    } finally { Pop-Location }
    if (-not (Test-Path -LiteralPath "$localNodeDir\dist\index.html")) { throw "Frontend artifact missing" }
    $distTarget = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'frontend\dist'))
    if ($distTarget -ne (Join-Path ([IO.Path]::GetFullPath($PSScriptRoot)) 'frontend\dist')) { throw 'Invalid frontend output path' }
    # DriveFS may reject recursive directory removal; mirror only this checked build output.
    robocopy "$localNodeDir\dist" $distTarget /MIR /NJH /NJS /NFL /NDL /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'Frontend artifact synchronization failed' }
    if ($Test) {
        go test ./...
        Assert-NativeSuccess 'Go tests'
        go test -tags 'desktop,production' ./...
        Assert-NativeSuccess 'Production Go tests'
        & powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\release.test.ps1"
        Assert-NativeSuccess 'Release guard tests'
    }
    # Wails embeds the Windows manifest and resources; -s skips the already checked frontend.
    $oldToolchain = $env:GOTOOLCHAIN
    try {
        # Wails 2.9.2's CLI dependency x/tools is incompatible with Go 1.27.
        $env:GOTOOLCHAIN = "go1.23.12"
        $buildVersion = $Version
        $buildTime = (Get-Date).ToUniversalTime().ToString("o")
        Copy-Item -LiteralPath "frontend\src\assets\app-icon.png" -Destination "build\appicon.png" -Force
        # Wails only generates ICO files when missing; never package an older cached icon.
        if (Test-Path -LiteralPath "build\windows\icon.ico") { Remove-Item -LiteralPath "build\windows\icon.ico" -Force }
        $wailsConfigPath = Join-Path $PSScriptRoot "wails.json"
        $wailsConfigBytes = [IO.File]::ReadAllBytes($wailsConfigPath)
        try {
            $wailsConfig = [Text.Encoding]::UTF8.GetString($wailsConfigBytes) | ConvertFrom-Json
            if (-not $wailsConfig.PSObject.Properties['info']) { $wailsConfig | Add-Member -MemberType NoteProperty -Name info -Value ([pscustomobject]@{}) }
            $wailsConfig.info | Add-Member -MemberType NoteProperty -Name productVersion -Value $Version -Force
            $wailsConfigJson = $wailsConfig | ConvertTo-Json -Depth 100
            [IO.File]::WriteAllText($wailsConfigPath, $wailsConfigJson, (New-Object System.Text.UTF8Encoding -ArgumentList $false))
            go run github.com/wailsapp/wails/v2/cmd/wails@v2.9.2 build -s -platform "windows/$Architecture" -ldflags "-X main.buildVersion=$buildVersion -X main.buildTime=$buildTime" -o dodrag.exe
            Assert-NativeSuccess "Wails packaging"
        } finally {
            [IO.File]::WriteAllBytes($wailsConfigPath, $wailsConfigBytes)
        }
    } finally { $env:GOTOOLCHAIN = $oldToolchain }
    if (-not (Test-Path -LiteralPath "build\bin\dodrag.exe")) { throw "Packaged executable missing" }
    if ($Architecture -eq 'amd64') { Copy-Item "build\bin\dodrag.exe" "dodrag.exe" -Force }
    Write-Host "Build completed. App was not started." -ForegroundColor Green
} finally { Pop-Location }
