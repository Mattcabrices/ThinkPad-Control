$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$items = @(
    @('LHM-LICENSE.txt','https://raw.githubusercontent.com/LibreHardwareMonitor/LibreHardwareMonitor/v0.9.6/LICENSE','1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5'),
    @('LHM-THIRD-PARTY-NOTICES.txt','https://raw.githubusercontent.com/LibreHardwareMonitor/LibreHardwareMonitor/v0.9.6/THIRD-PARTY-NOTICES.txt','a60d5ee62f4d700caff38566f42874d554b8b530437c72804fb28b958cfbda9b'),
    @('node-v24.19.0-LICENSE.txt','https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE','148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5')
)
New-Item -ItemType Directory -Force (Join-Path $projectRoot '.tools') | Out-Null
foreach ($item in $items) {
    $target = Join-Path $projectRoot ('.tools\'+$item[0])
    if (-not (Test-Path -LiteralPath $target)) { Invoke-WebRequest -UseBasicParsing -Uri $item[1] -OutFile $target }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $item[2]) { throw "Build notice hash mismatch: $($item[0])" }
}
