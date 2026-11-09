# Downloads data only. Never executes an upstream executable or installs a driver.
function Get-DependencyHttpStatus($Exception) {
    $directCode = $Exception.PSObject.Properties['StatusCode']
    if ($directCode -and $null -ne $directCode.Value) { return [int]$directCode.Value }
    $response = $Exception.PSObject.Properties['Response']
    if ($response -and $null -ne $response.Value) {
        $code = $response.Value.PSObject.Properties['StatusCode']
        if ($code -and $null -ne $code.Value) { return [int]$code.Value }
    }
    return 0
}

function Get-DependencyTransport($Uri, $OutFile, $Headers = $null) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $request = @{UseBasicParsing=$true;Uri=$Uri;OutFile=$OutFile;TimeoutSec=60}
            if ($Headers) { $request.Headers=$Headers }
            Invoke-WebRequest @request
            return
        } catch {
            $status = Get-DependencyHttpStatus $_.Exception
            # Retry transport failures, throttling and temporary server failures only.
            if ($attempt -eq 3 -or ($status -ne 0 -and $status -ne 408 -and $status -ne 429 -and $status -lt 500)) { throw }
            Write-Warning "Dependency download attempt $attempt failed; retrying."
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

function Get-DependencyDownload($Uri, $OutFile, $ReleaseAssetId = $null) {
    $apiUri = $null
    if ($null -ne $ReleaseAssetId) {
        [long]$assetNumber = 0
        if ([string]$ReleaseAssetId -notmatch '^[1-9][0-9]{0,18}$' -or -not [long]::TryParse([string]$ReleaseAssetId,[ref]$assetNumber)) { throw 'Invalid release asset ID' }
        $sourceUri = [uri]$Uri
        $releasePath = [regex]::Match($sourceUri.AbsolutePath,'^/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/releases/download/[^/]+/[^/]+$')
        if ($sourceUri.Scheme -ne 'https' -or $sourceUri.Host -ne 'github.com' -or -not $sourceUri.IsDefaultPort -or $sourceUri.UserInfo -or $sourceUri.Query -or $sourceUri.Fragment -or -not $releasePath.Success) { throw 'Release fallback requires an official GitHub release URL' }
        $apiUri = 'https://api.github.com/repos/'+$releasePath.Groups[1].Value+'/'+$releasePath.Groups[2].Value+'/releases/assets/'+$assetNumber
    }
    try { Get-DependencyTransport -Uri $Uri -OutFile $OutFile }
    catch {
        $status = Get-DependencyHttpStatus $_.Exception
        if (-not $apiUri -or ($status -ne 0 -and $status -ne 408 -and $status -ne 429 -and $status -lt 500)) { throw }
        Write-Warning 'Release download unavailable; trying the pinned official GitHub API asset.'
        # Public data only: no tokens/credentials. The caller still requires the same SHA256.
        Get-DependencyTransport -Uri $apiUri -OutFile $OutFile -Headers @{Accept='application/octet-stream';'X-GitHub-Api-Version'='2022-11-28'}
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
            Write-Output "Downloading $($asset.file)"
            $releaseId = if ($asset.PSObject.Properties['releaseAssetId']) { $asset.releaseAssetId } else { $null }
            Get-DependencyDownload -Uri $asset.url -OutFile $temporary -ReleaseAssetId $releaseId
            if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $asset.sha256) { throw "Dependency hash mismatch: $($asset.file)" }
            Move-Item -LiteralPath $temporary -Destination $target -Force
        } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
    }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $asset.sha256) { throw "Cached dependency hash mismatch: $($asset.file)" }
    Write-Output "Verified $($asset.file)"
}

