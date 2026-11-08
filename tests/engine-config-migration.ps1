$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/migrate-engine-config.ps1')
$script:assertions=0
function Check($condition,$message){if(!$condition){throw $message};$script:assertions++}
function Reject([scriptblock]$action){$failed=$false;try{&$action|Out-Null}catch{$failed=$true};Check $failed 'Malformed configuration was accepted.'}
$template="Active=1`r`nPortBackend=pawnio`r`nSingleFan=1`r`nHotkeys=0`r`nManModeExit=78`r`nLevel=0 128 0 0`r`nLevel2=0 128 0 0`r`nNewSafetyDefault=1`r`n"
$previous="Active=2`nPortBackend=unsafe`nHotkeys=1`nManModeExit=120`nArbitraryPath=C:\untrusted`nLevel=40 0 0 0`nLevel=45 1 0 0`nLevel=78 7 0 0`nLevel=86 64 0 0`nLevel2=99 0 0 0`nSensorOffset11=30 -128 127`n"
Check ((Merge-FanConfiguration $template '') -ceq $template) 'Clean install defaults changed.'
$merged=Merge-FanConfiguration $template $previous
foreach($expected in @('Active=2','Level=40 0 0 0','Level=45 1 0 0','Level=78 7 0 0','Level=86 64 0 0','SensorOffset11=30 -128 127','PortBackend=pawnio','Hotkeys=0','ManModeExit=78','Level2=0 128 0 0','NewSafetyDefault=1')){Check ($merged.Contains($expected)) "Missing setting: $expected"}
Check (!$merged.Contains('ArbitraryPath')) 'Unexpected path migrated.'
Check ((Merge-FanConfiguration $template ($previous.Replace('Active=2','Active=1'))) -ceq $template) 'Firmware mode retained curve/masks.'
foreach($invalid in @(
    $previous.Replace('Active=2','Active=3'),
    ($previous+"Active=2`n"),
    $previous.Replace('Level=86 64','Level=86 7'),
    $previous.Replace('Level=45 1','Level=39 1'),
    $previous.Replace('Level=45 1','Level=45 9'),
    $previous.Replace('Level=45 1 0 0','Level=45 1 1 0'),
    $previous.Replace('SensorOffset11=30','SensorOffset1=30'),
    $previous.Replace('SensorOffset11=30','SensorOffset11=71'),
    ($previous+"SensorOffset11=20 -128 127`n"),
    $previous.Replace('SensorOffset11=30 -128 127','SensorOffset11=30 -1 1')
)){Reject {Merge-FanConfiguration $template $invalid}}
Reject {Merge-FanConfiguration ($template.Replace('SingleFan=1','SingleFan=0')) $previous}
$directory=Join-Path ([IO.Path]::GetTempPath()) ('ThinkPad-config-migration-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($directory)|Out-Null
try{
    $candidate=Join-Path $directory 'candidate.ini';$destination=Join-Path $directory 'TPFanControl.ini'
    [IO.File]::WriteAllText($candidate,$merged);[IO.File]::WriteAllText($destination,$previous)
    Install-FanConfiguration $candidate $destination
    Check ([IO.File]::ReadAllText($destination) -ceq $merged) 'Commit failed.'
    Check ([IO.File]::ReadAllText($destination+'.upgrade-backup') -ceq $previous) 'Backup not exact.'
    Reject {Install-FanConfiguration $candidate $destination}
    Restore-FanConfiguration $destination
    Check ([IO.File]::ReadAllText($destination) -ceq $previous) 'Rollback not exact.'
    Check (!(Test-Path -LiteralPath ($destination+'.upgrade-backup'))) 'Rollback left backup.'
    [IO.File]::WriteAllText($destination+'.upgrade-new','prior interrupted candidate')
    Reject {Install-FanConfiguration $candidate $destination}
    Check ([IO.File]::ReadAllText($destination+'.upgrade-new') -ceq 'prior interrupted candidate') 'Failed commit deleted earlier recovery data.'
    [IO.File]::Delete($destination+'.upgrade-new')
    Reject {Install-FanConfiguration (Join-Path $directory 'missing.ini') $destination}
    Check ([IO.File]::ReadAllText($destination) -ceq $previous) 'Failed commit changed original.'
    [IO.File]::Delete($destination)
    Install-FanConfiguration $candidate $destination
    Check ([IO.File]::ReadAllText($destination) -ceq $merged) 'Clean commit failed.'
    [IO.File]::WriteAllText($destination,$previous)
    Install-FanConfiguration $candidate $destination
    [IO.File]::Delete($destination)
    Restore-FanConfiguration $destination
    Check ([IO.File]::ReadAllText($destination) -ceq $previous) 'Rollback must recover a missing destination.'
}finally{Remove-Item -LiteralPath $directory -Recurse -Force}
Write-Output "$script:assertions migration assertions passed; no services or hardware touched."
