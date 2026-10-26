# Runnable offline regression check: untracked, staged and modified files must abort before any release work.
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
if (-not (Test-Path -LiteralPath ([IO.Path]::GetTempPath()))) { throw 'Temporary parent missing' }
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    Copy-Item -LiteralPath "$PSScriptRoot\release.ps1" -Destination "$testRoot\release.ps1"
    Push-Location $testRoot
    try {
        git init --quiet
        if ($LASTEXITCODE -ne 0) { throw 'Test repository initialization failed' }
        foreach ($state in @('untracked', 'staged', 'modified')) {
            if ($state -eq 'staged') { git add -- release.ps1 }
            if ($state -eq 'modified') { Add-Content -LiteralPath 'release.ps1' -Value '# test change' }
            # PowerShell 5.1 promotes redirected native stderr under Stop; failure is expected here.
            $ErrorActionPreference = 'Continue'
            $result = & powershell -NoProfile -ExecutionPolicy Bypass -File "$testRoot\release.ps1" 0.2.1 2>&1
            $ErrorActionPreference = 'Stop'
            if ($LASTEXITCODE -eq 0 -or "$result" -notmatch 'All changes must be committed') { throw "Dirty-tree guard failed for $state`: $result" }
            $tags = @(git tag --list)
            if ($tags.Count) { throw 'Dirty-tree check created a tag' }
        }
        'PASS: untracked, staged and modified changes abort before release side effects.'
    } finally { Pop-Location }
} finally { Remove-Item -LiteralPath $testRoot -Recurse -Force }
