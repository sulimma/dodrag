# DriveFS can allow an in-place copy over an open executable. Publish a complete
# sibling file by rename so readers of the previous build keep its original bytes.
function Publish-StagedExecutable([string]$StagedPath, [string]$Destination) {
    if ([IO.File]::Exists($Destination)) {
        [IO.File]::Replace($StagedPath, $Destination, [System.Management.Automation.Language.NullString]::Value)
    } else {
        [IO.File]::Move($StagedPath, $Destination)
    }
}
