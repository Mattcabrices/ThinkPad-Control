param(
    [string]$PackageRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\windows-x64'),
    [ValidateSet('All','Ryzen','Intel')][string]$DemoProfile = 'All'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path ([IO.Path]::GetFullPath($PackageRoot)) 'ThinkPad Control.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the desktop package before running its GUI checks.' }
$output = Join-Path $projectRoot ('artifacts\desktop-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $output | Out-Null
$profiles = if ($DemoProfile -eq 'All') { @('Ryzen','Intel') } else { @($DemoProfile) }
$results = @()
foreach ($item in $profiles) {
    $directory = Join-Path $output $item.ToLowerInvariant()
    New-Item -ItemType Directory -Path $directory | Out-Null
    $previousData = $env:THINKPAD_DESKTOP_DATA
    $child = $null
    try {
        $env:THINKPAD_DESKTOP_DATA = $directory
        $demoFlag = if ($item -eq 'Intel') { '--demo-intel' } else { '--demo' }
        # These flags cannot enter live mode. No UAC, driver, service or power-setting changes.
        $child = Start-Process -FilePath $executable -ArgumentList $demoFlag,'--smoke-test' -WindowStyle Hidden -PassThru
        if (-not $child.WaitForExit(60000)) { throw 'The demo exceeded its independent 55-second process deadline.' }
        $report = Get-Content -Raw -LiteralPath (Join-Path $directory 'desktop-smoke.json') | ConvertFrom-Json
        if ($child.ExitCode -ne 0 -or $report.schemaVersion -ne 2 -or -not $report.passed -or
            $report.profile -ne $item.ToLowerInvariant() -or -not $report.checks.desktop -or
            $report.checks.metrics -lt 4 -or -not $report.checks.hardwareDisabled -or -not $report.checks.setupDisabled -or -not $report.checks.navigationReadable) {
            throw "Desktop $item check failed. Inspect $directory for the stage trace and result."
        }
        if ($item -eq 'Intel' -and (-not $report.views.cpuPage -or -not $report.views.ryzenPanelAbsent -or -not $report.views.intelTuningShown -or
            -not $report.views.mixedClassesShown -or -not $report.views.intelGpuShown)) {
            throw 'Intel demo did not render all expected capability-specific views.'
        }
        $results += [pscustomobject]@{ profile=$report.profile; passed=$true; stage=$report.stage }
    } finally {
        $env:THINKPAD_DESKTOP_DATA = $previousData
        # Cleanup only this script's known demo executable if its own deadline failed.
        # Never terminate any installed live app or hardware watchdog.
        if ($null -ne $child) {
            if (-not $child.HasExited -and [string]::Equals($child.Path,$executable,[StringComparison]::OrdinalIgnoreCase)) {
                $child.Kill(); $child.WaitForExit(5000) | Out-Null
            }
            $child.Dispose()
        }
    }
}
$results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'summary.json') -Encoding UTF8
$results | Format-Table
Write-Output "Desktop evidence: $output"
