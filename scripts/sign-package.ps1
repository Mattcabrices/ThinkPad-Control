param([Parameter(Mandatory=$true)][string]$PackageRoot,[Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'
foreach ($file in Get-ChildItem -LiteralPath $PackageRoot -Recurse -File | Sort-Object FullName) {
    if ($file.Extension -notin @('.exe','.dll','.ps1')) { continue }
    if ($file.Extension -ne '.ps1') {
        $stream = [IO.File]::OpenRead($file.FullName)
        try { $pe = $stream.ReadByte() -eq 0x4D -and $stream.ReadByte() -eq 0x5A } finally { $stream.Dispose() }
        if (-not $pe) { Write-Output "Not a Windows PE file; preserved unchanged: $($file.Name)"; continue }
    }
    & (Join-Path $PSScriptRoot 'sign-file.ps1') -Config $Config -Path $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "Package signing failed: $($file.Name)" }
}
