$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dotnet = Join-Path $root '.tools\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet)) { $dotnet = (Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_CLI_HOME = Join-Path $root '.tools\dotnet-home'
$env:NUGET_PACKAGES = Join-Path $root '.tools\nuget'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
& $dotnet restore (Join-Path $PSScriptRoot 'signing-tools\SigningTools.csproj') --configfile (Join-Path $root 'NuGet.Config')
if ($LASTEXITCODE -ne 0) { throw 'Could not restore official signing tools.' }
$sdk = Join-Path $env:NUGET_PACKAGES 'microsoft.windows.sdk.buildtools\10.0.28000.2957'
$client = Join-Path $env:NUGET_PACKAGES 'microsoft.artifactsigning.client\1.0.151'
$signtool = @(Get-ChildItem -LiteralPath $sdk -Recurse -Filter signtool.exe | Where-Object { $_.Directory.Name -eq 'x64' })
$dlib = @(Get-ChildItem -LiteralPath $client -Recurse -Filter Azure.CodeSigning.Dlib.dll | Where-Object { $_.Directory.Name -eq 'x64' })
if ($signtool.Count -ne 1 -or $dlib.Count -ne 1) { throw 'Unexpected Microsoft signing package layout.' }
foreach ($file in @($signtool[0],$dlib[0])) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "Microsoft tool signature verification failed: $($file.Name)" }
}
New-Item -ItemType Directory -Force (Join-Path $root '.tools\signing') | Out-Null
$tools = @{SignToolPath=$signtool[0].FullName;DlibPath=$dlib[0].FullName}
$tools | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root '.tools\signing\tools.json') -Encoding utf8
$tools | ConvertTo-Json
