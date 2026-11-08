param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $projectRoot '.tools\dependencies'
$lockPath = Join-Path $projectRoot 'third-party\dependencies.lock.json'
$lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
foreach ($asset in $lock.assets) {
    $path = Join-Path $cache $asset.file
    if (-not (Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $asset.sha256) {
        throw "Missing/unverified dependency $($asset.file). Run scripts/fetch-dependencies.ps1 first."
    }
}
$engine = Join-Path $Destination 'engine'
$notices = Join-Path $Destination 'notices\fan-engine'
New-Item -ItemType Directory -Force $engine,$notices | Out-Null
foreach ($name in @('TPFanControl.exe','LpcACPIEC.bin')) { Copy-Item -LiteralPath (Join-Path $cache $name) -Destination $engine }
$buildLockPath=Join-Path $projectRoot 'third-party\fan-engine-build.lock.json'
if(!(Test-Path -LiteralPath $buildLockPath)){throw 'Build the reviewed patched fan engine first: scripts/build-fan-engine.ps1'}
$buildLock=Get-Content -Raw $buildLockPath|ConvertFrom-Json
$patchedEngine=Join-Path $cache 'TPFanControl-patched.exe';$patchedSource=Join-Path $cache 'TPFanCtrl2-patched-source.zip'
if((Get-FileHash $patchedEngine).Hash -ne $buildLock.engineSha256 -or (Get-FileHash $patchedSource).Hash -ne $buildLock.modifiedSourceSha256 -or (Get-FileHash (Join-Path $projectRoot 'third-party\patches\TPFanCtrl2-single-fan.patch')).Hash -ne $buildLock.patchSha256){throw 'Patched engine/source provenance verification failed.'}
Copy-Item -LiteralPath $patchedEngine -Destination (Join-Path $engine 'TPFanControl.exe') -Force
Copy-Item -LiteralPath $patchedSource,$buildLockPath,(Join-Path $projectRoot 'third-party\patches\TPFanCtrl2-single-fan.patch') -Destination $notices
Copy-Item -LiteralPath $lockPath -Destination $engine
Copy-Item -LiteralPath (Join-Path $projectRoot 'third-party\README.md') -Destination (Join-Path $notices 'CREDITS.md')
foreach ($name in @('TPFanCtrl2-source.zip','PawnIO.Modules-source.zip','TPFanControl.upstream.ini')) {
    Copy-Item -LiteralPath (Join-Path $cache $name) -Destination $notices
}
# Retain upstream defaults except startup, backend, hotkeys and firmware-only fallback.
# TPFanCtrl2 mode 1 = BIOS. Never start its default smart curve or fan-off mode.
$ini = Get-Content -Raw -LiteralPath (Join-Path $cache 'TPFanControl.upstream.ini')
foreach ($pair in @(@('Active','1'),@('ManFanSpeed','4'),@('PortBackend','pawnio'),@('Hotkeys','0'))) {
    $pattern = '(?m)^' + $pair[0] + '=.*$'
    if ([regex]::Matches($ini,$pattern).Count -ne 1) { throw "Unexpected upstream configuration: $($pair[0])" }
    $ini = [regex]::Replace($ini,$pattern,($pair[0]+'='+$pair[1]+"`r"))
}
# Default to primary-fan access. Never assume that every ThinkPad has two fans.
# This also matches the validated configuration of the initial T14s Gen 2 host.
$singleFanPattern = '(?m)^//SingleFan=0\r?$'
if ([regex]::Matches($ini,$singleFanPattern).Count -ne 1) { throw 'Unexpected upstream SingleFan default.' }
$ini = [regex]::Replace($ini,$singleFanPattern,"SingleFan=1`r")
# The reviewed engine exits manual mode into Smart at ManModeExit (78 C in this
# upstream INI). SmartControl accepts 128 as the firmware-control register value.
# Replace both legacy curves so that this independent engine fallback returns
# cooling to the firmware, including when our worker is no longer running.
# No default T61 fan-off/low-speed curve is suitable for all supported ThinkPads.
$ini = [regex]::Replace($ini,'(?m)^Level2?=.*(?:\r?\n|$)','')
$ini += "`r`n// ThinkPad Control: both emergency fallback tables return to firmware.`r`nLevel=0 128 0 0`r`nLevel2=0 128 0 0`r`n"
[IO.File]::WriteAllText((Join-Path $engine 'TPFanControl.ini'),$ini,[Text.Encoding]::ASCII)
# Extract licenses for immediate access without having to unpack source archives.
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($entry in @(@('TPFanCtrl2-source.zip','/LICENSE','TPFanCtrl2-UNLICENSE.txt'),@('PawnIO.Modules-source.zip','/COPYING','PawnIO.Modules-LGPL-2.1.txt'))) {
    $zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $cache $entry[0]))
    try {
        $file = @($zip.Entries | Where-Object { $_.FullName -eq ($zip.Entries[0].FullName.Split('/')[0]+$entry[1]) })
        if ($file.Count -ne 1) { throw 'Expected upstream root license missing' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($file[0],(Join-Path $notices $entry[2]),$true)
    } finally { $zip.Dispose() }
}
& (Join-Path $PSScriptRoot 'write-engine-manifest.ps1') -PackageRoot $Destination

