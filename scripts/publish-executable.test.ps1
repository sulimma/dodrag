$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\publish-executable.ps1"

# Exercise the build volume itself, with a disposable file and no running app.
$directory = Join-Path (Split-Path $PSScriptRoot -Parent) 'build'
$destination = Join-Path $directory ("publish-test-{0}.exe" -f [Guid]::NewGuid())
$stage = "$destination.next"
try {
    [IO.File]::WriteAllText($stage, 'old')
    Publish-StagedExecutable $stage $destination
    $sharing = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    $reader = [IO.File]::Open($destination, 'Open', 'Read', $sharing)
    try {
        [IO.File]::WriteAllText($stage, 'new')
        Publish-StagedExecutable $stage $destination
        $buffer = New-Object byte[] 3
        if ($reader.Read($buffer, 0, 3) -ne 3 -or [Text.Encoding]::ASCII.GetString($buffer) -ne 'old') {
            throw 'Publishing changed the bytes of the previously opened executable.'
        }
        if ([IO.File]::ReadAllText($destination) -ne 'new') { throw 'New build was not published.' }
    } finally { $reader.Dispose() }
} finally {
    [IO.File]::Delete($stage)
    [IO.File]::Delete($destination)
}
