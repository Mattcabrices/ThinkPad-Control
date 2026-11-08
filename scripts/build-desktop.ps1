param([switch]$SkipRestore,[switch]$SkipInstaller,[string]$SigningConfig)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version
Set-Location -LiteralPath $projectRoot
foreach ($source in @('public/app.js','public/desktop.js','src/providers.js','src/server.js')) {
  & node --check (Join-Path $projectRoot $source)
  if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax validation failed: $source" }
}
& (Join-Path $PSScriptRoot 'make-icon.ps1')
$dotnet = Join-Path $projectRoot '.tools\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet)) { $dotnet = (Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_CLI_HOME = Join-Path $projectRoot '.tools\dotnet-home'
$env:NUGET_PACKAGES = Join-Path $projectRoot '.tools\nuget'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$patchedEngine = Join-Path $projectRoot '.tools\dependencies\TPFanControl-patched.exe'
$engineBuildLock=Get-Content -Raw (Join-Path $projectRoot 'third-party\fan-engine-build.lock.json')|ConvertFrom-Json
$engineSha256=(Get-FileHash -LiteralPath $patchedEngine -Algorithm SHA256).Hash
if($engineSha256 -ne $engineBuildLock.engineSha256){throw 'Build the reviewed fan engine before publishing.'}
$signedEngine = $null
if ($SigningConfig) {
  $SigningConfig = (Resolve-Path -LiteralPath $SigningConfig).Path
  & (Join-Path $PSScriptRoot 'sign-file.ps1') -Config $SigningConfig -CheckOnly
  if ($LASTEXITCODE -ne 0) { throw 'Signing preflight failed.' }
  # Sign the reviewed upstream engine first, then bake its final hash into the worker.
  $signingInput = Join-Path $projectRoot ('artifacts\signing-input\'+[guid]::NewGuid().ToString('N'))
  & (Join-Path $PSScriptRoot 'stage-fan-engine.ps1') -Destination $signingInput
  $signedEngine = Join-Path $signingInput 'engine\TPFanControl.exe'
  & (Join-Path $PSScriptRoot 'sign-file.ps1') -Config $SigningConfig -Path $signedEngine
  if ($LASTEXITCODE -ne 0) { throw 'Upstream engine signing failed.' }
  $engineSha256 = (Get-FileHash -LiteralPath $signedEngine -Algorithm SHA256).Hash
}
foreach ($project in @('native','desktop')) {
  # Publish into an empty folder: incremental publishing can leave out unchanged runtime files.
  $publishOutput = Join-Path $projectRoot "artifacts\$project"
  if (Test-Path -LiteralPath $publishOutput) { Remove-Item -LiteralPath $publishOutput -Recurse -Force }
  if (-not $SkipRestore) {
    & $dotnet restore $project --configfile (Join-Path $projectRoot 'NuGet.Config')
    if ($LASTEXITCODE -ne 0) { throw "Restore failed: $project" }
  }
  $publishArguments = @('publish',$project,'-c','Release','--no-restore','-o',(Join-Path $projectRoot "artifacts\$project"),"-p:Version=$version")
  if ($project -eq 'native' -and $engineSha256) { $publishArguments += "-p:TpfcEngineSha256=$engineSha256" }
  & $dotnet @publishArguments
  if ($LASTEXITCODE -ne 0) { throw "Publish failed: $project" }
}
$stage = [IO.Path]::GetFullPath((Join-Path $projectRoot 'artifacts\windows-x64'))
$expectedStage = [IO.Path]::GetFullPath((Join-Path $projectRoot 'artifacts\windows-x64'))
if ($stage -ne $expectedStage -or -not $stage.StartsWith([IO.Path]::GetFullPath($projectRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging path' }
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage,(Join-Path $stage 'runtime'),(Join-Path $stage 'bridge'),(Join-Path $stage 'app\src'),(Join-Path $stage 'app\public'),(Join-Path $stage 'app\scripts'),(Join-Path $stage 'notices') | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'artifacts\desktop') -File | Where-Object Extension -ne '.pdb' | Copy-Item -Destination $stage
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'artifacts\native') -File | Where-Object Extension -ne '.pdb' | Copy-Item -Destination (Join-Path $stage 'bridge')
$nodePath = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = (& $nodePath --version).Trim()
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Node.js 24+ required' }
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $stage 'runtime\node.exe')
$nodeNotice = Join-Path $projectRoot ".tools\node-$nodeVersion-LICENSE.txt"
if (-not (Test-Path -LiteralPath $nodeNotice)) { throw "Missing Node distribution license. Download https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE to $nodeNotice" }
Copy-Item -LiteralPath $nodeNotice -Destination (Join-Path $stage 'notices\NODE-LICENSE.txt')
Copy-Item -Path (Join-Path $projectRoot 'src\*.js'),(Join-Path $projectRoot 'src\*.sql') -Destination (Join-Path $stage 'app\src')
Copy-Item -Path (Join-Path $projectRoot 'public\*') -Destination (Join-Path $stage 'app\public')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\probe.ps1') -Destination (Join-Path $stage 'app\scripts')
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination (Join-Path $stage 'app')
Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD-PARTY-NOTICES.md') -Destination (Join-Path $stage 'notices')
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination $stage
New-Item -ItemType Directory -Force (Join-Path $stage 'scripts') | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'hardware-support.ps1') -Destination (Join-Path $stage 'scripts')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'migrate-engine-config.ps1') -Destination (Join-Path $stage 'scripts')
& (Join-Path $PSScriptRoot 'stage-fan-engine.ps1') -Destination $stage
Copy-Item -LiteralPath (Join-Path $projectRoot 'third-party\nuget-inventory.json') -Destination (Join-Path $stage 'notices')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\DEPENDENCY-REVIEW.md') -Destination (Join-Path $stage 'notices')
$sourceLock = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'third-party\source-dependencies.lock.json') | ConvertFrom-Json
$sourceNotices = Join-Path $stage 'notices\dependency-sources'
New-Item -ItemType Directory -Force $sourceNotices | Out-Null
foreach ($source in $sourceLock.assets) {
  $archive = Join-Path $projectRoot ('.tools\dependencies\'+$source.file)
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $source.sha256) { throw "Dependency source verification failed: $($source.file)" }
  Copy-Item -LiteralPath $archive -Destination $sourceNotices
}
# Retain the resolved dependency metadata and any license files carried by NuGet.
$inventory = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'third-party\nuget-inventory.json') | ConvertFrom-Json
foreach ($dependency in $inventory) {
  $package = Join-Path $env:NUGET_PACKAGES $dependency.package
  $noticeDirectory = Join-Path $stage ('notices\nuget\'+$dependency.package)
  New-Item -ItemType Directory -Force $noticeDirectory | Out-Null
  Get-ChildItem -LiteralPath $package -File | Where-Object { $_.Name -match '\.nuspec$|LICENSE|COPYING|NOTICE' } | Copy-Item -Destination $noticeDirectory
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\DESKTOP.md') -Destination (Join-Path $stage 'README.txt')
# Include licenses shipped by the bundled .NET SDK/runtime and the native NuGet dependencies.
$dotnetRoot = Split-Path -Parent $dotnet
Get-ChildItem -LiteralPath $dotnetRoot -Filter '*LICENSE*' -File | Copy-Item -Destination (Join-Path $stage 'notices')
Get-ChildItem -LiteralPath $dotnetRoot -Filter '*ThirdParty*' -File | Copy-Item -Destination (Join-Path $stage 'notices')
Get-ChildItem -LiteralPath (Join-Path $projectRoot '.tools\nuget\librehardwaremonitorlib\0.9.6') -File | Where-Object { $_.Name -match 'LICENSE|NOTICE' } | Copy-Item -Destination (Join-Path $stage 'notices')
Copy-Item -LiteralPath (Join-Path $projectRoot '.tools\nuget\microsoft.web.webview2\1.0.4022.49\LICENSE.txt') -Destination (Join-Path $stage 'notices\WEBVIEW2-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $projectRoot '.tools\nuget\microsoft.web.webview2\1.0.4022.49\NOTICE.txt') -Destination (Join-Path $stage 'notices\WEBVIEW2-NOTICE.txt')
foreach ($name in @('LHM-LICENSE.txt','LHM-THIRD-PARTY-NOTICES.txt')) {
  $notice=Join-Path $projectRoot ".tools\$name"
  if (-not (Test-Path -LiteralPath $notice)) { throw "Required third-party notice missing: $notice" }
  Copy-Item -LiteralPath $notice -Destination (Join-Path $stage 'notices')
}
if ($SigningConfig) {
  Copy-Item -LiteralPath $signedEngine -Destination (Join-Path $stage 'engine\TPFanControl.exe') -Force
  & (Join-Path $PSScriptRoot 'write-engine-manifest.ps1') -PackageRoot $stage
  & (Join-Path $PSScriptRoot 'sign-package.ps1') -PackageRoot $stage -Config $SigningConfig
}
& (Join-Path $PSScriptRoot 'write-package-manifest.ps1') -PackageRoot $stage
& (Join-Path $PSScriptRoot 'verify-release.ps1') -PackageRoot $stage -RequireTrustedSignatures:([bool]$SigningConfig)
$releases = Join-Path $projectRoot 'artifacts\releases'
New-Item -ItemType Directory -Force $releases | Out-Null
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $releases "ThinkPad-Control-$version-win-x64.zip") -Force
if (-not $SkipInstaller) {
  $compiler = Join-Path $projectRoot '.tools\inno\ISCC.exe'
  if (-not (Test-Path -LiteralPath $compiler)) { throw 'Install the official Inno Setup compiler under .tools\inno, or use -SkipInstaller.' }
  $compilerArguments = @("/DAppVersion=$version","/DSourceRoot=$stage","/DReleaseRoot=$releases")
  if ($SigningConfig) {
    $shellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $signScript = Join-Path $PSScriptRoot 'sign-file.ps1'
    $signCommand = '$q'+$shellPath.Replace('$','$$')+'$q -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $q'+$signScript.Replace('$','$$')+'$q -Config $q'+$SigningConfig.Replace('$','$$')+'$q -Path $f'
    $compilerArguments += @('/DSignedBuild=1',('/SThinkPadRelease='+$signCommand))
  }
  $compilerArguments += (Join-Path $projectRoot 'installer\ThinkPadControl.iss')
  & $compiler @compilerArguments
  if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
  if ($SigningConfig) {
    & (Join-Path $PSScriptRoot 'verify-release.ps1') -PackageRoot $stage -RequireTrustedSignatures -InstallerPath (Join-Path $releases "ThinkPad-Control-Setup-$version-x64.exe")
  }
}
Get-ChildItem -LiteralPath $releases -File | Select-Object Name,Length


