# Cache/build contract: Google Drive cannot reliably host node_modules. All callers
# synchronize source/config here; package.json's SHA256 invalidates dependencies.
function Assert-NativeSuccess([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE)" }
}
function Sync-FrontendCache {
    $projectRoot = Split-Path $PSScriptRoot -Parent
    $cacheRoot = Join-Path $env:LOCALAPPDATA 'dodrag_node_cache'
    New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
    foreach ($name in @('src', 'tests')) {
        $source = Join-Path $projectRoot "frontend\$name"
        $target = [IO.Path]::GetFullPath((Join-Path $cacheRoot $name))
        if ($target -ne (Join-Path ([IO.Path]::GetFullPath($cacheRoot)) $name)) { throw 'Invalid cache target' }
        if (Test-Path -LiteralPath $source) {
            robocopy $source $target /MIR /NJH /NJS /NFL /NDL /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "Cache synchronization failed: $name" }
        } elseif (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }
    # Remove stale top-level configuration too; leave dependency/build artifacts alone.
    $sourceFrontend = Join-Path $projectRoot 'frontend'
    $configs = @(Get-ChildItem -LiteralPath $sourceFrontend -File | Where-Object { $_.Name -match '\.(json|[cm]?js|ts|html)$' -and $_.Name -ne 'package-lock.json' })
    foreach ($old in @(Get-ChildItem -LiteralPath $cacheRoot -File)) {
        if ($old.Name -match '\.(json|[cm]?js|ts|html)$' -and $old.Name -ne 'package-lock.json' -and $old.Name -notin $configs.Name) {
            Remove-Item -LiteralPath $old.FullName -Force
        }
    }
    foreach ($file in $configs) { Copy-Item -LiteralPath $file.FullName -Destination $cacheRoot -Force }
    $hash = (Get-FileHash -LiteralPath (Join-Path $sourceFrontend 'package.json') -Algorithm SHA256).Hash
    $marker = Join-Path $cacheRoot '.dependencies.sha256'
    $previous = if (Test-Path -LiteralPath $marker) { [IO.File]::ReadAllText($marker).Trim() } else { '' }
    if (-not (Test-Path -LiteralPath (Join-Path $cacheRoot 'node_modules')) -or $previous -ne $hash) {
        npm --prefix $cacheRoot install --package-lock=false --no-audit --no-fund | Out-Host
        Assert-NativeSuccess 'Dependency installation'
        [IO.File]::WriteAllText($marker, $hash)
    }
    return $cacheRoot
}
