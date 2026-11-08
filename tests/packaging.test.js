import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ready=process.platform==='win32'&&existsSync('.tools/dependencies/TPFanControl.exe');
// Windows PowerShell must discover its own inbox modules rather than inherit pwsh paths.
const psEnv={...process.env};
for(const key of Object.keys(psEnv))if(key.toLowerCase()==='psmodulepath')delete psEnv[key];
test('fan-engine package preserves licenses/source and starts in firmware mode', {skip:!ready,timeout:30000},()=>{
  const root=mkdtempSync(join(tmpdir(),'thinkpad-package-'));
  try {
    mkdirSync(join(root,'scripts'));mkdirSync(join(root,'third-party'));mkdirSync(join(root,'.tools'));
    cpSync('scripts/stage-fan-engine.ps1',join(root,'scripts/stage-fan-engine.ps1'));
    cpSync('scripts/write-engine-manifest.ps1',join(root,'scripts/write-engine-manifest.ps1'));
    cpSync('third-party',join(root,'third-party'),{recursive:true});
    cpSync('.tools/dependencies',join(root,'.tools/dependencies'),{recursive:true});
    const args=['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',join(root,'scripts/stage-fan-engine.ps1'),'-Destination',join(root,'stage')];
    const run=()=>spawnSync('powershell.exe',args,{encoding:'utf8',windowsHide:true,env:psEnv});
    const result=run();assert.equal(result.status,0,result.stderr);
    const ini=readFileSync(join(root,'stage/engine/TPFanControl.ini'),'utf8');
    for(const value of ['Active=1','ManFanSpeed=4','PortBackend=pawnio','Hotkeys=0','SingleFan=1'])assert.match(ini,new RegExp('^'+value+'\\r?$','m'));
    for(const table of ['Level','Level2']) {
      const levels=[...ini.matchAll(new RegExp('^'+table+'=(.*)$','gm'))].map(row=>row[1].trim().split(/\s+/).map(Number));
      assert.deepEqual(levels,[[0,128,0,0]],'Engine thermal fallback must select firmware for every nonnegative temperature');
    }
    assert.match(ini,/^ManModeExit=78\b/m,'Retain the upstream independent manual-mode thermal exit');
    for(const name of ['TPFanCtrl2-source.zip','TPFanCtrl2-patched-source.zip','fan-engine-build.lock.json','TPFanCtrl2-single-fan.patch','PawnIO.Modules-source.zip','TPFanCtrl2-UNLICENSE.txt','PawnIO.Modules-LGPL-2.1.txt'])assert.ok(existsSync(join(root,'stage/notices/fan-engine',name)));
    const build=JSON.parse(readFileSync(join(root,'third-party/fan-engine-build.lock.json'),'utf8').replace(/^\uFEFF/,''));
    const manifest=JSON.parse(readFileSync(join(root,'stage/engine/installed-artifacts.json'),'utf8').replace(/^\uFEFF/,''));
    assert.equal(manifest.assets.find(a=>a.file==='TPFanControl.exe').sha256,build.engineSha256,'The installed manifest must bind the exact patched engine');
    const patched=join(root,'.tools/dependencies/TPFanControl-patched.exe'),saved=readFileSync(patched);writeFileSync(patched,'tampered');
    const badPatch=run();assert.notEqual(badPatch.status,0);assert.match(badPatch.stderr,/provenance verification failed/);writeFileSync(patched,saved);
    for(const companion of ['.tools/dependencies/TPFanCtrl2-patched-source.zip','third-party/patches/TPFanCtrl2-single-fan.patch']) {
      const path=join(root,companion),original=readFileSync(path);writeFileSync(path,'tampered');
      const refused=run();assert.notEqual(refused.status,0,companion);assert.match(refused.stderr,/provenance verification failed/);writeFileSync(path,original);
    }
    assert.equal(run().status,0,'Restored provenance inputs must stage again');
    const executable=join(root,'.tools/dependencies/TPFanControl.exe');
    writeFileSync(executable,'tampered');
    const denied=run();assert.notEqual(denied.status,0);assert.match(denied.stderr,/Missing\/unverified dependency/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('desktop and installer version defaults match package.json', ()=>{
  const {version}=JSON.parse(readFileSync('package.json','utf8'));
  assert.equal(readFileSync('desktop/ThinkPad.Desktop.csproj','utf8').match(/<Version>([^<]+)<\/Version>/)[1],version);
  assert.equal(readFileSync('installer/ThinkPadControl.iss','utf8').match(/#define AppVersion "([^"]+)"/)[1],version);
  assert.equal(readFileSync('public/index.html','utf8').match(/class="version">[^<]*<span>v([^<]+)<\/span>/)[1],version);
  assert.match(readFileSync('scripts/build-desktop.ps1','utf8'),/-p:Version=\$version/,'Release publish must stamp the package version');
});

test('other machines get the sensor driver before the ThinkPad primary-fan eligibility gate', ()=>{
  const script=readFileSync('scripts/hardware-support.ps1','utf8').replace(/\r\n/g,'\n');
  assert.match(script,/fanEngineEligible = Test-FanEngineEligibility/);
  const gate=script.indexOf('if (-not $fanEngineEligible)'),driver=script.indexOf("Get-Service -Name PawnIO -ErrorAction Stop"),service=script.indexOf("'-i','-q'");
  assert.ok(driver>=0&&driver<gate&&gate<service,'The driver is set up first, and ineligible machines leave before the engine service is installed');
});

test('primary-fan eligibility includes Intel and Ryzen ThinkPads but excludes other Lenovo products and vendors', {skip:process.platform!=='win32'},()=>{
  const source=readFileSync('scripts/hardware-support.ps1','utf8');
  const fn=source.slice(source.indexOf('function Test-FanEngineEligibility'),source.indexOf("$ErrorActionPreference"));
  const cases=[['LENOVO','21BN0000US','ThinkPad X13 Gen 3','GenuineIntel','12th Gen Intel Core i5',true],
    ['LENOVO','20XGS09A00','ThinkPad T14s Gen 2a','AuthenticAMD','AMD Ryzen 5 PRO 5650U',true],
    ['LENOVO','21CGS01R02','','AuthenticAMD','AMD Ryzen 5 PRO 6650U',true],
    ['LENOVO','82XX','IdeaPad 5','GenuineIntel','Intel Core i5',false],
    ['Dell','21BN0000US','ThinkPad X13','GenuineIntel','Intel Core i5',false],
    ['LENOVO','21BN0000US','ThinkPad X13','Qualcomm','Snapdragon',false],
    ['LENOVO','Unknown','','GenuineIntel','Intel Core i5',false]];
  const command=fn+'\n'+cases.map(([...row])=>{const expected=row.pop();return `if ((Test-FanEngineEligibility ${row.map(x=>"'"+x.replaceAll("'","''")+"'").join(' ')}) -ne $${expected}) { throw 'Eligibility case failed' }`;}).join('\n');
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,env:psEnv});
  assert.equal(result.status,0,result.stderr);
});

test('portable hardware support refuses service installation outside Program Files', {skip:process.platform!=='win32',timeout:20000},()=>{
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','RemoteSigned','-File',resolve('scripts/hardware-support.ps1'),'-Action','Install'],{encoding:'utf8',windowsHide:true,env:psEnv});
  assert.notEqual(result.status,0);assert.match(result.stderr,/requires the Program Files\s+installation/);
});

test('automatic hardware task setup supports battery use and stays on-demand',{skip:process.platform!=='win32',timeout:20000},()=>{
  const root=mkdtempSync(join(tmpdir(),'thinkpad-task-fixture-'));
  try{
    const source=readFileSync('scripts/hardware-support.ps1','utf8');
    const fn=source.slice(source.indexOf('function Install-WorkerTask'),source.indexOf('function Remove-WorkerTask'));
    const mock=`$ErrorActionPreference='Stop'; $workerTaskName='ThinkPad Control Hardware Worker';
function New-ScheduledTaskAction {param($Execute,$Argument) @{Execute=$Execute;Argument=$Argument}}
function New-ScheduledTaskPrincipal {param($UserId,$LogonType,$RunLevel) @{UserId=$UserId;LogonType=$LogonType;RunLevel=$RunLevel}}
function New-ScheduledTaskSettingsSet {param([switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries,$ExecutionTimeLimit,$MultipleInstances,[switch]$StartWhenAvailable) @{AllowBattery=[bool]$AllowStartIfOnBatteries;KeepBattery=[bool]$DontStopIfGoingOnBatteries;Deadline=$ExecutionTimeLimit;Instances=$MultipleInstances;StartWhenAvailable=[bool]$StartWhenAvailable}}
function Register-ScheduledTask {param($TaskName,$Action,$Principal,$Settings,$Description,[switch]$Force) $script:captured=@{Name=$TaskName;Action=$Action;Principal=$Principal;Settings=$Settings;Force=[bool]$Force}}
${fn}
$root='${root.replaceAll("'","''")}';
foreach($fan in @($true,$false)){
 Install-WorkerTask $root $fan
 $task=$script:captured;$saved=Get-Content -LiteralPath (Join-Path $root 'worker-task.json') -Raw|ConvertFrom-Json
 if($task.Name -ne $workerTaskName -or $saved.taskName -ne $workerTaskName -or !$task.Force){throw 'Task registration missing'}
 if($task.Principal.RunLevel -ne 'Highest' -or $task.Principal.LogonType -ne 'Interactive'){throw 'Worker principal incorrect'}
 if(!$task.Settings.AllowBattery -or !$task.Settings.KeepBattery -or $task.Settings.Deadline -ne [TimeSpan]::Zero -or $task.Settings.StartWhenAvailable -or $task.Settings.Instances -ne 'IgnoreNew'){throw 'Battery/on-demand settings incorrect'}
 if(($task.Action.Argument.Contains('--tpfc')) -ne $fan -or !$task.Action.Argument.Contains($saved.pipe)){throw 'Worker capability/pipe mismatch'}
 if($task.Action.Execute -ne (Join-Path $root 'bridge\\ThinkPad.Bridge.exe')){throw 'Wrong worker executable'}
}
`;
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',mock],{encoding:'utf8',windowsHide:true,env:psEnv});
    assert.equal(result.status,0,result.stderr);
  }finally{rmSync(root,{recursive:true,force:true});}
});


test('upgrade service-state query distinguishes stopped engines and fails closed during transitions', {skip:process.platform!=='win32',timeout:20000},()=>{
  const installer=readFileSync('installer/ThinkPadControl.iss','utf8');
  const encoded=installer.match(/Query := '((?:''|[^'])*)';/);
  assert.ok(encoded,'Installer must contain its read-only service query');
  const query=encoded[1].replaceAll("''", "'");
  const command=query.match(/^-NoProfile -NonInteractive -Command "(.*)"$/)[1];
  for(const [status,exitCode] of [['Running',0],['Stopped',10],['StartPending',11],['Paused',11]]) {
    const fixture=`function Get-Service { [CmdletBinding()]param([string]$Name) if($Name -ne 'TPFanControl'){throw 'Wrong service'}; [pscustomobject]@{Status='${status}'} }; `;
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',fixture+command],{encoding:'utf8',windowsHide:true,env:psEnv});
    assert.equal(result.status,exitCode,result.stderr);
  }
  const failed=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"function Get-Service { throw 'Service read denied' }; "+command],{encoding:'utf8',windowsHide:true,env:psEnv});
  assert.equal(failed.status,1,'A failed service read must not be treated as an engine that should restart');
});
