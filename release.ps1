param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
    [string]$Version
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Assert-NativeSuccess([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE)" }
}
function Assert-CleanTree {
    $changes = @(git status --porcelain --untracked-files=all)
    Assert-NativeSuccess 'Git status'
    if ($changes.Count) { throw "All changes must be committed before releasing:`n$($changes -join "`n")" }
}
if (-not (Test-Path -LiteralPath $PSScriptRoot)) { throw 'Project directory missing' }
Push-Location $PSScriptRoot
try {
    # This is deliberately the first check: no build, tag or network side effects on a dirty tree.
    Assert-CleanTree
    $branch = git symbolic-ref --quiet --short HEAD
    Assert-NativeSuccess 'Current branch (detached HEAD is unsupported)'
    $commit = git rev-parse HEAD
    Assert-NativeSuccess 'Release commit'
    $tag = "v$Version"
    $existing = @(git tag --list $tag)
    Assert-NativeSuccess 'Local tag check'
    if ($existing.Count) { throw "Tag $tag already exists locally" }
    $remoteTag = @(git ls-remote --tags origin "refs/tags/$tag")
    Assert-NativeSuccess 'Remote tag check'
    if ($remoteTag.Count) { throw "Tag $tag already exists on origin" }
    Assert-CleanTree
    $current = git rev-parse HEAD
    Assert-NativeSuccess 'Release commit recheck'
    if ($current -ne $commit) { throw 'HEAD changed during release preparation' }
    git tag -a $tag $commit -m "DoDrag $tag"
    Assert-NativeSuccess 'Tag creation'
    # Atomic push prevents publishing just the tag or just the branch; never force-push.
    git push --atomic origin "HEAD:refs/heads/$branch" "refs/tags/$tag"
    Assert-NativeSuccess 'Branch and tag push'
    Write-Host "Pushed $tag. The Build and release workflow builds all packages and handles gated publication."
} finally { Pop-Location }
