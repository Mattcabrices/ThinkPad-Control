# Shared download/verification functions. Importing this file performs no actions.
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

# Caller supplies a fresh private staging path; this function never executes data.
function Save-VerifiedDriverInstaller($Prerequisite, $Path) {
    if ($Prerequisite.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Official driver installer hash pin is invalid.' }
    $releaseId = if ($Prerequisite.PSObject.Properties['releaseAssetId']) { $Prerequisite.releaseAssetId } else { $null }
    Get-DependencyDownload -Uri $Prerequisite.url -OutFile $Path -ReleaseAssetId $releaseId
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Prerequisite.sha256) { throw 'Official driver installer hash mismatch.' }
    if ((Get-AuthenticodeSignature -LiteralPath $Path).Status -ne 'Valid') { throw 'Official driver installer signature is not trusted by Windows.' }
}

# Called only by approved hardware setup after its protected-root/admin checks.
# Execution is never retried: network fallback happens before hash/signature gates.
function Invoke-VerifiedDriverSetup($Prerequisite, $Path) {
    Save-VerifiedDriverInstaller -Prerequisite $Prerequisite -Path $Path
    $process = Start-Process -FilePath $Path -ArgumentList '-install','-silent' -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -eq 3010) { throw 'PawnIO requires a Windows restart. Restart, then rerun setup to enable the fan engine.' }
    if ($process.ExitCode -ne 0) { throw "PawnIO setup failed ($($process.ExitCode))." }
}
