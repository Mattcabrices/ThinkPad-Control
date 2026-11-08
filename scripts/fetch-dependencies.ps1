# Downloads data only. Never executes an upstream executable or installs a driver.
function Get-DependencyDownload($Uri, $OutFile) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile -TimeoutSec 60
            return
        } catch {
            $status = if ($null -ne $_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            # Retry transport failures, throttling and temporary server failures only.
            if ($attempt -eq 3 -or ($status -ne 0 -and $status -ne 408 -and $status -ne 429 -and $status -lt 500)) { throw }
            Write-Warning "Dependency download attempt $attempt failed; retrying."
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$lock = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'third-party\dependencies.lock.json') | ConvertFrom-Json
$cache = Join-Path $projectRoot '.tools\dependencies'
New-Item -ItemType Directory -Force $cache | Out-Null
$assets = @($lock.assets)
$sourceLock = Join-Path $projectRoot 'third-party\source-dependencies.lock.json'
if (Test-Path -LiteralPath $sourceLock) { $assets += @((Get-Content -Raw -LiteralPath $sourceLock | ConvertFrom-Json).assets) }
foreach ($asset in $assets) {
    if ([IO.Path]::GetFileName($asset.file) -ne $asset.file) { throw 'Invalid dependency filename' }
    $target = Join-Path $cache $asset.file
    if (-not (Test-Path -LiteralPath $target)) {
        $temporary = "$target.download"
        try {
            Get-DependencyDownload -Uri $asset.url -OutFile $temporary
            if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $asset.sha256) { throw "Dependency hash mismatch: $($asset.file)" }
            Move-Item -LiteralPath $temporary -Destination $target -Force
        } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
    }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $asset.sha256) { throw "Cached dependency hash mismatch: $($asset.file)" }
    Write-Output "Verified $($asset.file)"
}

