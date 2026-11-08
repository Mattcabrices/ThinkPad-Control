param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference = 'Stop'
$engine = Join-Path $PackageRoot 'engine'
$lock = Get-Content -Raw -LiteralPath (Join-Path $engine 'dependencies.lock.json') | ConvertFrom-Json
$assets = @()
foreach ($name in @('TPFanControl.exe','LpcACPIEC.bin')) {
    $source = @($lock.assets | Where-Object file -eq $name)
    if ($source.Count -ne 1) { throw 'Unexpected upstream engine lock.' }
    $hash = (Get-FileHash -LiteralPath (Join-Path $engine $name) -Algorithm SHA256).Hash
    if ($name -eq 'LpcACPIEC.bin' -and $hash -ne $source[0].sha256) { throw 'Do not modify the upstream signed EC module.' }
    $assets += @{file=$name;sha256=$hash;upstreamSha256=$source[0].sha256}
}
@{schemaVersion=1;assets=$assets} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $engine 'installed-artifacts.json') -Encoding utf8
