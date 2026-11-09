param(
    [string]$PackageRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\windows-x64'),
    [string]$PortablePath,
    [string]$SourcePath
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version
if (-not $PortablePath) { $PortablePath = Join-Path $projectRoot "artifacts\releases\ThinkPad-Control-$version-win-x64.zip" }
if (-not $SourcePath) { $SourcePath = Join-Path $projectRoot "artifacts\releases\ThinkPad-Control-$version-source.zip" }
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem

function Assert-ArchivePath([string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Name) -or $Name.StartsWith('/') -or
        $Name -match '[\x00-\x1f<>:"\\|?*]' -or $Name.Contains('//') -or
        $Name -match '(^|/)\.{1,2}(/|$)') { throw "Unsafe archive path: $Name" }
}

# Compare with the exact build inputs without extracting or executing archive bytes.
function Test-Archive([string]$Path,[string]$Root,[string[]]$Files,[string]$Label) {
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $expected = [Collections.Generic.Dictionary[string,IO.FileInfo]]::new([StringComparer]::OrdinalIgnoreCase)
    $directories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $Files) {
        $item = Get-Item -LiteralPath $file
        if (-not $item.FullName.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Archive input escapes its root.' }
        $relative = $item.FullName.Substring($prefix.Length).Replace('\','/')
        Assert-ArchivePath $relative
        $expected.Add($relative,$item)
        $parent = $relative
        while ($parent.Contains('/')) { $parent=$parent.Substring(0,$parent.LastIndexOf('/')); [void]$directories.Add($parent+'/') }
    }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $archive = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Path))
    $filesVerified = 0
    try {
        if ($archive.Entries.Count -gt $expected.Count+$directories.Count) { throw "$Label archive has unexpected entries." }
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName
            Assert-ArchivePath $name
            if (-not $seen.Add($name)) { throw "Duplicate archive entry: $name" }
            if ((($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000) { throw "Symlink archive entry: $name" }
            if ($name.EndsWith('/')) {
                if (-not $directories.Contains($name)) { throw "Unexpected archive directory: $name" }
                if ($entry.Length -ne 0) { throw "Archive directory contains data: $name" }
                continue
            }
            if (-not $expected.ContainsKey($name)) { throw "Unexpected archive file: $name" }
            $item = $expected[$name]
            if ($entry.Length -ne $item.Length) { throw "Archive size mismatch: $name" }
            $stream = $entry.Open()
            $hash = [Security.Cryptography.SHA256]::Create()
            try {
                $buffer = New-Object byte[] 65536
                [long]$length = 0
                while (($read = $stream.Read($buffer,0,$buffer.Length)) -gt 0) {
                    $length += $read
                    if ($length -gt $item.Length) { throw "Archive expands beyond expected size: $name" }
                    [void]$hash.TransformBlock($buffer,0,$read,$buffer,0)
                }
                [void]$hash.TransformFinalBlock([byte[]]@(),0,0)
                $actualHash = [BitConverter]::ToString($hash.Hash).Replace('-','')
                if ($length -ne $item.Length -or $actualHash -ne (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash) { throw "Archive content mismatch: $name" }
            } finally { $hash.Dispose(); $stream.Dispose() }
            $filesVerified++
        }
        if ($filesVerified -ne $expected.Count) { throw "$Label archive is missing expected files." }
    } finally { $archive.Dispose() }
    Write-Output "$Label archive verified: $filesVerified files"
}

# The payload manifest must first agree with the complete staged folder.
& (Join-Path $PSScriptRoot 'verify-release.ps1') -PackageRoot $PackageRoot
$payload = @(Get-ChildItem -LiteralPath $PackageRoot -File -Recurse | ForEach-Object { $_.FullName })
$publicSource = @(& (Join-Path $PSScriptRoot 'package-source.ps1') -ListFiles)
Test-Archive -Path $PortablePath -Root $PackageRoot -Files $payload -Label 'Portable'
Test-Archive -Path $SourcePath -Root $projectRoot -Files $publicSource -Label 'Source'
Write-Output 'Archive integrity matches these local build inputs. This does not establish publisher trust or validate hardware.'
