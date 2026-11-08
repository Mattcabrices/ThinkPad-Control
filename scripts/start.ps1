param([switch]$Demo,[switch]$ThinkPadFan)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24+ before launching ThinkPad Control.' }
if ($ThinkPadFan) { $env:THINKPAD_TPFC = '1' }
if ($Demo) { & node src/server.js --demo --open } else { & node src/server.js --open }
exit $LASTEXITCODE
