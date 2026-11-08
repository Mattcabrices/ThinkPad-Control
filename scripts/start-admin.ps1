param([switch]$ThinkPadFan)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'start.ps1'
$arguments = @('-NoProfile','-File',('"' + $launcher + '"'))
if ($ThinkPadFan) { $arguments += '-ThinkPadFan' }
# The user initiates this launcher and handles Windows UAC. Never bypass the prompt.
Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -WorkingDirectory $root -ArgumentList $arguments | Out-Null
