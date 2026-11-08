# Original MIT code. Read-only diagnostics for the reviewed TPFC shared-state layout.
[CmdletBinding()]
param(
    [ValidateRange(2,120)][int]$Samples=12,
    [ValidateRange(100,5000)][int]$IntervalMilliseconds=2000,
    [string]$OutputPath
)
$ErrorActionPreference='Stop'
$mapping=$null
$view=$null
$timer=[Diagnostics.Stopwatch]::StartNew()
$lastSequence=$null
$lastChange=0L
$observedUpdate=$false
try {
    # Read access only: this tool cannot submit commands, fan levels or EC writes.
    $mapping=[IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('Global\TPFanControl_State',[IO.MemoryMappedFiles.MemoryMappedFileRights]::Read)
    $view=$mapping.CreateViewAccessor(0,7796,[IO.MemoryMappedFiles.MemoryMappedFileAccess]::Read)
    $observations=@(for($index=0;$index -lt $Samples;$index++) {
        $stable=$false
        for($attempt=0;$attempt -lt 4;$attempt++) {
            $sequence=$view.ReadInt32(0)
            $command=$view.ReadInt32(4)
            $acknowledged=$view.ReadInt32(8)
            $mode=$view.ReadInt32(12)
            $level=$view.ReadInt32(20)
            $low=$view.ReadInt32(24)
            $high=$view.ReadInt32(28)
            $temperature=$view.ReadInt32(40)
            [Threading.Thread]::MemoryBarrier()
            if($sequence -eq $view.ReadInt32(0)){$stable=$true;break}
        }
        if(!$stable){throw 'The engine changed state during each read; retry this capture.'}
        if($mode -lt 1 -or $mode -gt 3){throw 'The shared-state layout is uninitialized or incompatible.'}
        if($null -ne $lastSequence -and $sequence -ne $lastSequence){$lastChange=$timer.ElapsedMilliseconds;$observedUpdate=$true}
        $lastSequence=$sequence
        $fresh=$observedUpdate -and ($timer.ElapsedMilliseconds-$lastChange -lt 12000)
        $rawRpm=$null
        if($low -ge 0 -and $low -le 255 -and $high -ge 0 -and $high -le 255 -and ($high*256+$low) -lt 20000){$rawRpm=$high*256+$low}
        [pscustomobject]@{
            elapsedMilliseconds=$timer.ElapsedMilliseconds
            sequence=$sequence
            commandSequence=$command
            acknowledgedSequence=$acknowledged
            rawMode=$mode
            rawLevel=$level
            rawTachLow=$low
            rawTachHigh=$high
            rawRpm=$rawRpm
            fresh=$fresh
            currentRpm=$(if($fresh){$rawRpm}else{$null})
            ecSlot1=$temperature
        }
        if($index+1 -lt $Samples){Start-Sleep -Milliseconds $IntervalMilliseconds}
    })
    $report=[pscustomobject]@{
        schemaVersion=1
        capturedAtUtc=[DateTime]::UtcNow.ToString('o')
        readOnly=$true
        interpretation='Zero tachometer bytes do not establish whether the fan is stopped. EC slot 1 is not a named motherboard component. Freshness requires observing a sequence change; captures are best-effort because the upstream protocol has no begin/end write transaction.'
        samples=$observations
    }
    $json=$report|ConvertTo-Json -Depth 5
    if($OutputPath){$json|Set-Content -LiteralPath $OutputPath -Encoding UTF8}else{$json}
} catch {
    throw ('Fan capture unavailable: '+$_.Exception.Message+' This tool does not install, start or elevate an engine.')
} finally {
    if($view){$view.Dispose()}
    if($mapping){$mapping.Dispose()}
    $timer.Stop()
}
