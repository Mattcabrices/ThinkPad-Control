param(
    [ValidateSet('Prepare','Commit','Restore','Finalize')][string]$Action='Prepare',
    [string]$PreviousPath,[string]$TemplatePath,[string]$OutputPath,[string]$DestinationPath
)
$ErrorActionPreference='Stop'

function Merge-FanConfiguration([string]$Template,[string]$Previous) {
    foreach($required in @('Active=1','PortBackend=pawnio','SingleFan=1','Hotkeys=0','Level=0 128 0 0','Level2=0 128 0 0')) {
        if([regex]::Matches($Template,'(?m)^'+[regex]::Escape($required)+'\r?$').Count -ne 1){throw "Invalid new engine template: $required"}
    }
    if([string]::IsNullOrEmpty($Previous)){return $Template}
    $modes=[regex]::Matches($Previous,'(?m)^Active=([^\r\n]*)\r?$')
    if($modes.Count -ne 1 -or $modes[0].Groups[1].Value.Trim() -notmatch '^[12]$'){throw 'Existing fan mode is invalid or manual. Return to firmware or a saved curve before upgrading.'}
    $mode=$modes[0].Groups[1].Value.Trim()
    # Firmware retains only validated inert restoration metadata; active offsets
    # and all operating settings still come from the new firmware defaults.
    if($mode -eq '1'){
        $dormant=[regex]::Matches($Previous,'(?m)^// ThinkPadControlDormantAdjustment([^=\r\n]*)=([^\r\n]*)\r?$')
        if($dormant.Count -gt 6){throw 'Too many dormant sensor adjustments.'}
        $seen=@{};$saved=@()
        foreach($offset in $dormant){
            $slotText=$offset.Groups[1].Value;$shiftText=$offset.Groups[2].Value.Trim()
            if($slotText -notmatch '^\d{1,2}$' -or $shiftText -notmatch '^\d{1,2}$'){throw 'Dormant sensor adjustment is malformed.'}
            $slot=[int]$slotText;$shift=[int]$shiftText
            if($slot -lt 2 -or $slot -gt 12 -or $shift -lt 1 -or $shift -gt 70 -or $seen.ContainsKey($slot)){throw 'Dormant sensor adjustment is outside supported ranges or duplicated.'}
            $seen[$slot]=$true;$saved+=,"// ThinkPadControlDormantAdjustment$slot=$shift"
        }
        if(!$saved.Count){return $Template}
        return $Template.TrimEnd("`r","`n")+"`r`n"+($saved -join "`r`n")+"`r`n"
    }
    $levels=[regex]::Matches($Previous,'(?m)^Level=([^\r\n]*)\r?$')
    if($levels.Count -lt 2 -or $levels.Count -gt 16){throw 'Existing curve row count is invalid.'}
    $rows=@();$lastTemp=-1;$lastLevel=-1
    foreach($level in $levels){
        $values=$level.Groups[1].Value.Trim() -split '\s+'
        if($values.Count -ne 4 -or $values[0] -notmatch '^\d{1,3}$' -or $values[1] -notmatch '^\d{1,3}$' -or $values[2] -ne '0' -or $values[3] -ne '0'){throw 'Existing curve row is malformed.'}
        $temp=[int]$values[0];$speed=[int]$values[1]
        if($temp -gt 115 -or ($speed -notin 0..7 -and $speed -ne 64) -or $temp -le $lastTemp -or $speed -le $lastLevel){throw 'Existing curve temperatures and levels must rise within supported ranges.'}
        $rows+=,@($temp,$speed);$lastTemp=$temp;$lastLevel=$speed
    }
    if($rows[-1][1] -ne 64 -or $rows[-2][1] -ne 7){throw 'Existing curve must reach level 7 followed by maximum fan speed.'}
    $offsets=[regex]::Matches($Previous,'(?m)^SensorOffset([^=\r\n]*)=([^\r\n]*)\r?$')
    if($offsets.Count -gt 6){throw 'Too many sensor adjustments.'}
    $seen=@{};$masks=@()
    foreach($offset in $offsets){
        $slotText=$offset.Groups[1].Value;$values=$offset.Groups[2].Value.Trim() -split '\s+'
        if($slotText -notmatch '^\d{1,2}$' -or $values.Count -ne 3 -or $values[0] -notmatch '^\d{1,2}$' -or $values[1] -ne '-128' -or $values[2] -ne '127'){throw 'Existing sensor adjustment is malformed.'}
        $slot=[int]$slotText;$shift=[int]$values[0]
        if($slot -lt 2 -or $slot -gt 12 -or $shift -lt 1 -or $shift -gt 70 -or $seen.ContainsKey($slot)){throw 'Existing sensor adjustment is outside supported ranges or duplicated.'}
        $seen[$slot]=$true;$masks+=,"SensorOffset$slot=$shift -128 127"
    }
    # Only these numeric settings cross the upgrade boundary. Paths, hotkeys,
    # manual watchdogs, fallback tables and backend settings always come from the new build.
    $merged=[regex]::Replace($Template,'(?m)^Level=.*(?:\r?\n|$)','')
    $merged=[regex]::Replace($merged,'(?m)^SensorOffset\d+=.*(?:\r?\n|$)','')
    $merged=[regex]::Replace($merged,'(?m)^Active=1\r?$',"Active=2`r")
    $curve=@($rows|ForEach-Object{"Level=$($_[0]) $($_[1]) 0 0"})+$masks
    return $merged.TrimEnd("`r","`n")+"`r`n"+($curve -join "`r`n")+"`r`n"
}

function Install-FanConfiguration([string]$Candidate,[string]$Destination) {
    $backup=$Destination+'.upgrade-backup';$staged=$Destination+'.upgrade-new'
    if(Test-Path -LiteralPath $backup){throw 'An unfinished fan configuration backup exists. Resolve the previous upgrade before retrying.'}
    if(Test-Path -LiteralPath $staged){throw 'An unfinished fan configuration candidate exists. Resolve the previous upgrade before retrying.'}
    try {
        [IO.File]::Copy($Candidate,$staged,$false)
        if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($staged,$Destination,$backup)}
        else{[IO.File]::Move($staged,$Destination)}
    } finally {if(Test-Path -LiteralPath $staged){[IO.File]::Delete($staged)}}
}
function Restore-FanConfiguration([string]$Destination) {
    $backup=$Destination+'.upgrade-backup'
    if(Test-Path -LiteralPath $backup){
        if(Test-Path -LiteralPath $Destination){[IO.File]::Replace($backup,$Destination,[NullString]::Value)}else{[IO.File]::Move($backup,$Destination)}
    }
}
if($MyInvocation.InvocationName -ne '.') {
    switch($Action){
        'Prepare' {
            if(!$TemplatePath -or !$OutputPath){throw 'TemplatePath and OutputPath are required.'}
            $previous=if($PreviousPath){[IO.File]::ReadAllText($PreviousPath,[Text.Encoding]::GetEncoding(28591))}else{''}
            if($PreviousPath -and [string]::IsNullOrWhiteSpace($previous)){throw 'The existing owned configuration is empty.'}
            $result=Merge-FanConfiguration ([IO.File]::ReadAllText($TemplatePath,[Text.Encoding]::GetEncoding(28591))) $previous
            [IO.File]::WriteAllText($OutputPath,$result,[Text.Encoding]::GetEncoding(28591))
        }
        'Commit' {if(!$OutputPath -or !$DestinationPath){throw 'Candidate and destination required.'};Install-FanConfiguration $OutputPath $DestinationPath}
        'Restore' {if(!$DestinationPath){throw 'Destination required.'};Restore-FanConfiguration $DestinationPath}
        'Finalize' {if(!$DestinationPath){throw 'Destination required.'};$backup=$DestinationPath+'.upgrade-backup';if(Test-Path -LiteralPath $backup){[IO.File]::Delete($backup)}}
    }
}
