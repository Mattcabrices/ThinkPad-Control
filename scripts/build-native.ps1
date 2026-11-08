$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$dotnet = Join-Path $PWD '.tools\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet)) { $dotnet = (Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_CLI_HOME = Join-Path $PWD '.tools\dotnet-home'
$env:NUGET_PACKAGES = Join-Path $PWD '.tools\nuget'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
& $dotnet restore native --configfile (Join-Path $PWD 'NuGet.Config')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $dotnet publish native -c Release --no-restore -o artifacts/bridge
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $dotnet restore native-tests --configfile (Join-Path $PWD 'NuGet.Config')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $dotnet run --project native-tests -c Release --no-restore
exit $LASTEXITCODE
