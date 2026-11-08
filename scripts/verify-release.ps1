param([string]$PackageRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\windows-x64'),[switch]$RequireTrustedSignatures,[string]$InstallerPath)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PackageRoot)
$manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'package-manifest.json') | ConvertFrom-Json
$actualFiles = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.FullName -ne (Join-Path $root 'package-manifest.json') })
if ($actualFiles.Count -ne @($manifest).Count) { throw 'Package contains missing or unmanifested files.' }
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($entry in $manifest) {
    $path = [IO.Path]::GetFullPath((Join-Path $root $entry.path))
    if (-not $path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest path escapes package' }
    if (-not $seen.Add($path)) { throw 'Manifest contains a duplicate file.' }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Package file modified: $($entry.path)" }
}
foreach ($required in @('LICENSE','engine\TPFanControl.exe','engine\LpcACPIEC.bin','engine\TPFanControl.ini','notices\fan-engine\TPFanCtrl2-source.zip','notices\fan-engine\TPFanCtrl2-patched-source.zip','notices\fan-engine\fan-engine-build.lock.json','notices\fan-engine\TPFanCtrl2-single-fan.patch','notices\fan-engine\PawnIO.Modules-source.zip','notices\fan-engine\PawnIO.Modules-LGPL-2.1.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $required))) { throw "Release component missing: $required" }
}
if ($RequireTrustedSignatures) {
    $signable = @($actualFiles | Where-Object { $_.Extension -in @('.exe','.dll','.ps1') })
    if ($InstallerPath) { $signable += Get-Item -LiteralPath $InstallerPath -ErrorAction Stop }
    foreach ($file in $signable) {
        if ($file.Extension -ne '.ps1') {
            $stream = [IO.File]::OpenRead($file.FullName)
            try { $pe = $stream.ReadByte() -eq 0x4D -and $stream.ReadByte() -eq 0x5A } finally { $stream.Dispose() }
            if (-not $pe) { continue }
        }
        $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
        if ($signature.Status -ne 'Valid') { throw "Public release blocked: $($file.Name) is not trusted by Windows ($($signature.Status))." }
        if ($null -eq $signature.TimeStamperCertificate) { throw "Public release blocked: $($file.Name) has no trusted timestamp." }
    }
}
Write-Output "Verified $($manifest.Count) package files. Trusted signature requirement: $RequireTrustedSignatures"

