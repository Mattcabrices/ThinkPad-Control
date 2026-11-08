param([Parameter(Mandatory=$true)][string]$Config,[string]$Path,[switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$localDotnet = Join-Path (Split-Path -Parent $PSScriptRoot) '.tools\dotnet'
if (Test-Path -LiteralPath (Join-Path $localDotnet 'shared\Microsoft.NETCore.App')) { $env:DOTNET_ROOT = $localDotnet }
$settings = Get-Content -Raw -LiteralPath $Config | ConvertFrom-Json
$allowed = @('Provider','SignToolPath','DlibPath','MetadataFilePath','CertificateThumbprint','MachineStore','TimestampUrl')
foreach ($property in $settings.PSObject.Properties.Name) { if ($property -notin $allowed) { throw "Unknown signing setting: $property. Never put credentials in this file." } }
if ($settings.Provider -notin @('ArtifactSigning','CertificateStore')) { throw 'Choose ArtifactSigning or CertificateStore.' }
if (-not (Test-Path -LiteralPath $settings.SignToolPath -PathType Leaf)) { throw 'SignTool is missing. Run scripts/get-signing-tools.ps1 and configure its path.' }
$toolSignature = Get-AuthenticodeSignature -LiteralPath $settings.SignToolPath
if ($toolSignature.Status -ne 'Valid' -or $toolSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'SignTool must have a valid Microsoft signature.' }
$timestamp = $null
if (-not [Uri]::TryCreate($settings.TimestampUrl,[UriKind]::Absolute,[ref]$timestamp) -or $timestamp.Scheme -notin @('https','http') -or $timestamp.UserInfo) { throw 'Configure an RFC3161 timestamp URL without credentials.' }
$arguments = @('sign','/fd','SHA256','/td','SHA256','/tr',$timestamp.AbsoluteUri,'/d','ThinkPad Control')
if ($settings.Provider -eq 'ArtifactSigning') {
    if (-not (Test-Path -LiteralPath $settings.DlibPath -PathType Leaf)) { throw 'Microsoft Artifact Signing dlib is missing.' }
    $clientSignature = Get-AuthenticodeSignature -LiteralPath $settings.DlibPath
    if ($clientSignature.Status -ne 'Valid' -or $clientSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Artifact Signing client must have a valid Microsoft signature.' }
    $metadata = Get-Content -Raw -LiteralPath $settings.MetadataFilePath | ConvertFrom-Json
    if ($metadata.Endpoint -notmatch '^https://[a-z0-9-]+\.codesigning\.azure\.net/?$' -or
        $metadata.CodeSigningAccountName -notmatch '^[a-zA-Z0-9-]+$' -or $metadata.CertificateProfileName -notmatch '^[a-zA-Z0-9-]+$' -or
        $metadata.CodeSigningAccountName -match 'REPLACE' -or $metadata.CertificateProfileName -match 'REPLACE') { throw 'Configure the actual Azure endpoint, account and Public Trust certificate profile first.' }
    $arguments += @('/dlib',$settings.DlibPath,'/dmdf',$settings.MetadataFilePath)
} else {
    if ($settings.CertificateThumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Use an explicit code-signing certificate thumbprint.' }
    $store = if ($settings.MachineStore) { 'LocalMachine' } else { 'CurrentUser' }
    $certificate = Get-Item -LiteralPath ("Cert:\$store\My\"+$settings.CertificateThumbprint) -ErrorAction Stop
    if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date)) { throw 'Code-signing certificate has no accessible private key or has expired.' }
    $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        $chain.ChainPolicy.ApplicationPolicy.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
        if (-not $chain.Build($certificate)) { throw 'Code-signing certificate does not chain to a trusted root for code signing.' }
    } finally { $chain.Dispose() }
    $arguments += @('/sha1',$settings.CertificateThumbprint,'/s','My')
    if ($settings.MachineStore) { $arguments += '/sm' }
}
$file = $null
if ($Path) {
    $file = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($file.Extension -eq '.bin') { throw 'Do not alter the signed PawnIO module.' }
    if ($file.Extension -ne '.ps1') {
        # Inno signs temporary PE files such as uninst.e32.tmp before renaming them.
        $stream = [IO.File]::OpenRead($file.FullName)
        try { $pe = $stream.ReadByte() -eq 0x4D -and $stream.ReadByte() -eq 0x5A } finally { $stream.Dispose() }
        if (-not $pe) { throw 'Only Windows PE files and PowerShell scripts may be signed.' }
    }
} elseif (-not $CheckOnly) { throw 'A file path is required.' }
if ($CheckOnly) { Write-Output 'Signing configuration and Microsoft tools checked. No signing request sent; cloud authentication/profile permissions are not yet proven.'; exit 0 }
$before = Get-AuthenticodeSignature -LiteralPath $file.FullName
if ($before.Status -eq 'Valid') { Write-Output "Preserved existing trusted signature: $($file.Name)"; exit 0 }
if ($before.Status -ne 'NotSigned') { throw "Refusing to replace an invalid/untrusted signature: $($file.Name)" }
& $settings.SignToolPath @arguments $file.FullName
if ($LASTEXITCODE -ne 0) { throw "Signing failed: $($file.Name). Check account identity, profile role and timestamp availability." }
$after = Get-AuthenticodeSignature -LiteralPath $file.FullName
if ($after.Status -ne 'Valid' -or $null -eq $after.TimeStamperCertificate) { throw "Signed file lacks trusted Authenticode or timestamp: $($file.Name)" }
& $settings.SignToolPath verify /pa /all $file.FullName
if ($LASTEXITCODE -ne 0) { throw "SignTool verification failed: $($file.Name)" }

