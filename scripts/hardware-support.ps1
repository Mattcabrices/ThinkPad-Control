param([ValidateSet('Inspect','Install','InstallWorker','Remove','StopOwned')][string]$Action = 'Inspect')
$workerTaskName = 'ThinkPad Control Hardware Worker'
function Set-OwnedEngineRecovery($AppRoot) {
    $process = Start-Process -FilePath (Join-Path $AppRoot 'bridge\ThinkPad.Bridge.exe') -ArgumentList '--configure-engine-recovery' -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw 'Owned engine crash recovery configuration failed.' }
}
# Lets the app start its worker without a UAC prompt each time. It runs only when the app starts it, exits when the
# app disconnects, and uninstall removes it. It is registered once, under the approval given to setup.
function Install-WorkerTask($AppRoot, [bool]$UseFanEngine) {
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $pipe = 'ThinkPadControl-' + [guid]::NewGuid().ToString('N')
    $arguments = "--pipe $pipe --owner $owner" + $(if ($UseFanEngine) { ' --tpfc' } else { '' })
    $taskAction = New-ScheduledTaskAction -Execute (Join-Path $AppRoot 'bridge\ThinkPad.Bridge.exe') -Argument $arguments
    $principal = New-ScheduledTaskPrincipal -UserId $owner -LogonType Interactive -RunLevel Highest
    # Task defaults would refuse to start, or stop the worker, on battery.
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable:$false
    Register-ScheduledTask -TaskName $workerTaskName -Action $taskAction -Principal $principal -Settings $settings -Description 'Starts the ThinkPad Control hardware worker when the app opens. Removed when ThinkPad Control is uninstalled.' -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $AppRoot 'worker-task.json'),(@{taskName=$workerTaskName;pipe=$pipe;owner=$owner} | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
}
function Remove-WorkerTask($AppRoot) {
    if (Get-ScheduledTask -TaskName $workerTaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $workerTaskName -Confirm:$false }
    foreach ($name in @('worker-task.json','hardware-setup-error.txt')) { $file = Join-Path $AppRoot $name; if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force } }
}
function Test-FanEngineEligibility($Manufacturer, $Model, $ProductName, $CpuManufacturer, $CpuName) {
    # This selects the existing primary-fan configuration; it never enables a second channel.
    $thinkpad = $Manufacturer -match '^LENOVO$' -and ($ProductName -match '^ThinkPad\b' -or $Model -match '^ThinkPad\b|^(20|21)[A-Z0-9]{2,}$')
    return $thinkpad -and ($CpuManufacturer -eq 'GenuineIntel' -or $CpuName -match '\bRyzen\b')
}
$ErrorActionPreference = 'Stop'
# Privileged setup loads only inbox modules, never inherited user module paths.
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$appRoot = Split-Path -Parent $PSScriptRoot
trap {
    $protectedLogRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'ThinkPad Control'
    if ($Action -ne 'Inspect' -and [string]::Equals($appRoot,$protectedLogRoot,[StringComparison]::OrdinalIgnoreCase)) {
        [IO.File]::WriteAllText((Join-Path $appRoot 'hardware-setup-error.txt'),($_.Exception.Message+"`r`n"),[Text.Encoding]::UTF8)
    }
    Write-Error $_ -ErrorAction Continue
    exit 1
}
$engine = Join-Path $appRoot 'engine\TPFanControl.exe'
$expectedImage = '"' + $engine + '" -s'
$protectedRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'ThinkPad Control'
if ($Action -ne 'Inspect' -and -not [string]::Equals([IO.Path]::GetFullPath($appRoot),$protectedRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Hardware support requires the Program Files installation.' }
$service = Get-CimInstance Win32_Service -Filter "Name='TPFanControl'"
$owned = $null -ne $service -and [string]::Equals($service.PathName,$expectedImage,[StringComparison]::OrdinalIgnoreCase)
if ($Action -eq 'Inspect') {
    [pscustomobject]@{serviceExists=($null -ne $service);owned=$owned;state=$service.State;imagePath=$service.PathName} | ConvertTo-Json
    exit 0
}
# A SYSTEM service must never load code/configuration from a user-writable portable folder.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Hardware setup requires administrator approval.' }
if ($Action -eq 'StopOwned') {
    if ($owned) { Stop-Service -Name TPFanControl -ErrorAction Stop }
    exit 0
}
if ($Action -eq 'InstallWorker') {
    if ($owned) {
        Set-OwnedEngineRecovery $appRoot
    }
    Install-WorkerTask $appRoot $owned
    exit 0
}
if ($Action -eq 'Remove') {
    Remove-WorkerTask $appRoot
    if ($owned) {
        Stop-Service -Name TPFanControl -ErrorAction Stop
        & "$env:SystemRoot\System32\sc.exe" delete TPFanControl
        if ($LASTEXITCODE -ne 0) { throw 'Could not remove the owned engine service.' }
    }
    # PawnIO is shared with other applications. Do not uninstall its driver.
    exit 0
}
if ($null -ne $service -and -not $owned) { throw 'An external TPFanControl service already exists. It has been left untouched. Remove or migrate it explicitly before installing this engine.' }
$computer = Get-CimInstance Win32_ComputerSystem
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
$product = Get-CimInstance Win32_ComputerSystemProduct
# The upstream EC interface supports Intel and AMD. Eligibility is not physical validation.
# Retain primary-fan-only access; other machines receive the sensor driver without an engine.
$fanEngineEligible = Test-FanEngineEligibility $computer.Manufacturer $computer.Model $product.Version $processor.Manufacturer $processor.Name
$lock = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'engine\dependencies.lock.json') | ConvertFrom-Json
$installed = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'engine\installed-artifacts.json') | ConvertFrom-Json
if ($installed.schemaVersion -ne 1 -or @($installed.assets).Count -ne 2) { throw 'Invalid installed engine manifest.' }
foreach ($name in @('TPFanControl.exe','LpcACPIEC.bin')) {
    $assetList = @($installed.assets | Where-Object file -eq $name)
    $sourceList = @($lock.assets | Where-Object file -eq $name)
    if ($assetList.Count -ne 1 -or $sourceList.Count -ne 1 -or $assetList[0].upstreamSha256 -ne $sourceList[0].sha256 -or $assetList[0].sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Installed engine provenance verification failed.' }
    $asset = $assetList[0]
    if ($name -eq 'LpcACPIEC.bin' -and $asset.sha256 -ne $asset.upstreamSha256) { throw 'The upstream signed EC module was modified.' }
    if ((Get-FileHash -LiteralPath (Join-Path $appRoot ('engine\'+$asset.file)) -Algorithm SHA256).Hash -ne $asset.sha256) { throw 'Bundled hardware engine verification failed.' }
}
$ini = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'engine\TPFanControl.ini')
if ($ini -notmatch '(?m)^Active=[12]\r?$' -or $ini -notmatch '(?m)^PortBackend=pawnio\r?$' -or $ini -notmatch '(?m)^SingleFan=1\r?$') { throw 'Engine must start in BIOS mode using PawnIO and primary-fan access.' }
$driver = Get-Service -Name PawnIO -ErrorAction SilentlyContinue
if ($null -eq $driver) {
    # Random private directory, no fixed reusable temp executable for an elevated launch.
    $downloadRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('ThinkPadControl\Setup-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $downloadRoot -AclObject $acl
    $setup = Join-Path $downloadRoot 'PawnIO_setup.exe'
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $lock.driverPrerequisite.url -OutFile $setup
        if ((Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash -ne $lock.driverPrerequisite.sha256) { throw 'Official driver installer hash mismatch.' }
        if ((Get-AuthenticodeSignature -LiteralPath $setup).Status -ne 'Valid') { throw 'Official driver installer signature is not trusted by Windows.' }
        $process = Start-Process -FilePath $setup -ArgumentList '-install','-silent' -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -eq 3010) { throw 'PawnIO requires a Windows restart. Restart, then rerun setup to enable the fan engine.' }
        if ($process.ExitCode -ne 0) { throw "PawnIO setup failed ($($process.ExitCode))." }
    } finally {
        # Only these known files; never recursively delete a computed elevated path.
        if (Test-Path -LiteralPath $setup) { Remove-Item -LiteralPath $setup -Force }
        Remove-Item -LiteralPath $downloadRoot -Force
    }
}
$driver = Get-Service -Name PawnIO -ErrorAction Stop
if ($driver.Status -ne 'Running') { Start-Service -Name PawnIO -ErrorAction Stop }
Install-WorkerTask $appRoot ([bool]$fanEngineEligible)
if (-not $fanEngineEligible) {
    Write-Output 'Sensor driver ready. The primary-fan engine is offered only on Intel or Ryzen Lenovo ThinkPads; this machine was not identified as eligible.'
    exit 0
}
if (-not $owned) {
    $process = Start-Process -FilePath $engine -ArgumentList '-i','-q' -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Engine service installation failed ($($process.ExitCode))." }
}
try {
    $installed = Get-CimInstance Win32_Service -Filter "Name='TPFanControl'"
    if ($null -eq $installed -or -not [string]::Equals($installed.PathName,$expectedImage,[StringComparison]::OrdinalIgnoreCase)) { throw 'Engine service ownership could not be verified.' }
    Set-OwnedEngineRecovery $appRoot
    Start-Service -Name TPFanControl -ErrorAction Stop
    (Get-Service -Name TPFanControl).WaitForStatus('Running',[TimeSpan]::FromSeconds(20))
} catch {
    # Roll back only the service this invocation created, never a pre-existing service.
    $rollback = Get-CimInstance Win32_Service -Filter "Name='TPFanControl'"
    if (-not $owned -and $null -ne $rollback -and [string]::Equals($rollback.PathName,$expectedImage,[StringComparison]::OrdinalIgnoreCase)) {
        Stop-Service -Name TPFanControl -ErrorAction Stop
        & "$env:SystemRoot\System32\sc.exe" delete TPFanControl | Out-Null
    }
    throw
}
Write-Output 'Bundled hardware support installed. Firmware retains automatic fan control.'
