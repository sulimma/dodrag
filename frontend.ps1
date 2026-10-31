# One entry point for synchronized local frontend work. Edit only workspace sources.
param(
    [ValidateSet('Sync', 'Build', 'Typecheck', 'Test', 'LanguageAudit')][string]$Action = 'Build',
    [string[]]$TestFiles = @()
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. "$PSScriptRoot\scripts\frontend-cache.ps1"
$cache = Sync-FrontendCache
Push-Location $cache
try {
    switch ($Action) {
        'Sync' { Write-Host "Frontend synchronized: $cache" }
        'Build' { npm run build; Assert-NativeSuccess 'Frontend build' }
        'Typecheck' { npm exec -- tsc --noEmit; Assert-NativeSuccess 'Frontend typecheck' }
        'Test' { npm test -- @TestFiles; Assert-NativeSuccess 'Frontend tests' }
        'LanguageAudit' { npm run test:language; Assert-NativeSuccess 'Optional language audit' }
    }
} finally { Pop-Location }
