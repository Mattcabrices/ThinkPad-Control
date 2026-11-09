import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const ready=process.platform==='win32'&&existsSync('.tools/dependencies/TPFanControl.exe');
// Windows PowerShell must discover its own inbox modules rather than inherit pwsh paths.
const psEnv={...process.env};
for(const key of Object.keys(psEnv))if(key.toLowerCase()==='psmodulepath')delete psEnv[key];
test('dependency downloads retry transient failures but never accept partial or hash-mismatched data', {skip:process.platform!=='win32',timeout:20000},()=>{
  const root=mkdtempSync(join(tmpdir(),'thinkpad-download-fixture-'));
  try {
    const hash=createHash('sha256').update('verified').digest('hex');
    for(const mode of ['transient','permanent','corrupt']) {
      const fixture=join(root,mode);mkdirSync(join(fixture,'scripts'),{recursive:true});mkdirSync(join(fixture,'third-party'));
      cpSync('scripts/fetch-dependencies.ps1',join(fixture,'scripts/fetch-dependencies.ps1'));
      writeFileSync(join(fixture,'third-party/dependencies.lock.json'),JSON.stringify({assets:[{file:'asset.bin',url:'https://invalid.example/never-contacted',sha256:hash}]}));
      const command=`$ErrorActionPreference='Stop';$global:attempts=0;$global:delays=@();
function Start-Sleep {param($Seconds) $global:delays+= $Seconds}
function Invoke-WebRequest {param([switch]$UseBasicParsing,$Uri,$OutFile,$TimeoutSec)
 $global:attempts++
 if('${mode}' -eq 'permanent' -or ('${mode}' -eq 'transient' -and $global:attempts -eq 1)){[IO.File]::WriteAllText($OutFile,'partial');throw [Net.WebException]::new('simulated transport timeout')}
 [IO.File]::WriteAllText($OutFile,$(if('${mode}' -eq 'corrupt'){'corrupt'}else{'verified'}))
}
$failed=$false;try{& '${join(fixture,'scripts/fetch-dependencies.ps1').replaceAll("'","''")}'}catch{$failed=$true}
$target='${join(fixture,'.tools/dependencies/asset.bin').replaceAll("'","''")}';
if('${mode}' -eq 'transient') {if($failed -or $global:attempts -ne 2 -or !(Test-Path -LiteralPath $target) -or $global:delays.Count -ne 1){throw 'Transient download did not recover'}}
else {if(!$failed -or (Test-Path -LiteralPath $target)){throw 'Failed download entered verified cache'};if($global:attempts -ne $(if('${mode}' -eq 'corrupt'){1}else{3})){throw 'Incorrect retry bound'}}
if(Test-Path -LiteralPath ($target+'.download')){throw 'Partial download was not cleaned up'}
`;
      const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,env:psEnv});
      assert.equal(result.status,0,`${mode}: ${result.stderr}`);
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
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
    assert.match(ini,/^ManModeExit=85\b/m,'Unknown machines start with an independent conservative fallback before resolving their own manual limit');
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

test('public source archive excludes local credentials, runtime recovery and private journals but retains documented source', {skip:process.platform!=='win32',timeout:20000},()=>{
  const root=mkdtempSync(join(tmpdir(),'thinkpad-source-privacy-'));
  try {
    const directories=['src','public','native','native-tests','desktop','installer','scripts','tests','docs','third-party','.github','signing'];
    for(const directory of directories)mkdirSync(join(root,directory),{recursive:true});
    const fixed=['README.md','LICENSE','THIRD-PARTY-NOTICES.md','SECURITY.md','CONTRIBUTING.md','NuGet.Config','.gitignore','signing/artifact-signing.example.json','signing/metadata.example.json','signing/certificate-store.example.json'];
    for(const file of fixed)writeFileSync(join(root,file),'Public fixture');
    writeFileSync(join(root,'package.json'),JSON.stringify({version:'0.0.0-fixture'}));
    cpSync('scripts/package-source.ps1',join(root,'scripts/package-source.ps1'));
    const excluded=['docs/publisher.p12','docs/Publisher.PFX','docs/config.local.json','docs/CONFIG.LOCAL.JSON','docs/.env','docs/.env.production','docs/history.sqlite-wal','docs/history.db-shm','docs/turbo-recovery.json','docs/turbo-demo-intel.json','docs/HANDOFF.md','docs/HOST-VALIDATION.md','docs/nested/.aws/credentials','src/data/settings.json','native/obj/build.json'];
    const included=['src/example.js','docs/SIGNING.md','docs/ANNOUNCEMENT.md','docs/images/demo.png','tests/fixtures/valid.json','third-party/build.lock.json'];
    for(const file of [...excluded,...included]){mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),file);}
    const script=join(root,'scripts/package-source.ps1').replaceAll("'","''"),archive=join(root,'artifacts/releases/ThinkPad-Control-0.0.0-fixture-source.zip').replaceAll("'","''");
    const command=`$ErrorActionPreference='Stop'; & '${script}' | Out-Null; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[IO.Compression.ZipFile]::OpenRead('${archive}'); try { @($zip.Entries | ForEach-Object { $_.FullName }) | ConvertTo-Json -Compress } finally { $zip.Dispose() }`;
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,env:psEnv});
    assert.equal(result.status,0,result.stderr);
    const entries=JSON.parse(result.stdout.trim());
    for(const file of excluded)assert.ok(!entries.includes(file),`Private file leaked: ${file}`);
    for(const file of [...fixed,...included,'package.json','scripts/package-source.ps1'])assert.ok(entries.includes(file),`Public source missing: ${file}`);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('pinned release API fallback handles transport outages without accepting wrong bytes, hosts or credentials', {skip:process.platform!=='win32',timeout:25000},()=>{
  const root=mkdtempSync(join(tmpdir(),'thinkpad-api-fallback-'));
  try {
    const expected=createHash('sha256').update('verified').digest('hex');
    for(const mode of ['primary','fallback','api-corrupt','both-fail','primary-corrupt','not-found','bad-id','wrong-host','http','credentials','query','bad-cache']){
      const fixture=join(root,mode);mkdirSync(join(fixture,'scripts'),{recursive:true});mkdirSync(join(fixture,'third-party'));
      cpSync('scripts/fetch-dependencies.ps1',join(fixture,'scripts/fetch-dependencies.ps1'));
      const url=mode==='wrong-host'?'https://other.example/owner/repo/releases/download/v1/asset.bin':mode==='http'?'http://github.com/owner/repo/releases/download/v1/asset.bin':mode==='credentials'?'https://user:secret@github.com/owner/repo/releases/download/v1/asset.bin':mode==='query'?'https://github.com/owner/repo/releases/download/v1/asset.bin?token=fixture':'https://github.com/owner/repo/releases/download/v1/asset.bin';
      writeFileSync(join(fixture,'third-party/dependencies.lock.json'),JSON.stringify({assets:[{file:'asset.bin',url,releaseAssetId:mode==='bad-id'?'1;invalid':123,sha256:expected}]}));
      if(mode==='bad-cache'){mkdirSync(join(fixture,'.tools/dependencies'),{recursive:true});writeFileSync(join(fixture,'.tools/dependencies/asset.bin'),'tampered');}
    }
    const command=`$ErrorActionPreference='Stop'; $root='${root.replaceAll("'","''")}';
function Start-Sleep {param($Seconds)}
function Invoke-WebRequest {param([switch]$UseBasicParsing,$Uri,$OutFile,$TimeoutSec,$Headers)
 $global:calls.Add([string]$Uri)
 $api=([uri]$Uri).Host -eq 'api.github.com'
 if($api){
  if([string]$Uri -ne 'https://api.github.com/repos/owner/repo/releases/assets/123' -or $Headers.Accept -ne 'application/octet-stream' -or $Headers['X-GitHub-Api-Version'] -ne '2022-11-28' -or $Headers.Keys.Count -ne 2){throw 'Invalid API request headers or repository'}
  if($global:mode -eq 'both-fail'){[IO.File]::WriteAllText($OutFile,'partial');throw [Net.WebException]::new('API transport failed')}
  [IO.File]::WriteAllText($OutFile,$(if($global:mode -eq 'api-corrupt'){'corrupt'}else{'verified'}));return
 }
 if($Headers){throw 'Primary must not inherit API credentials or headers'}
 if($global:mode -eq 'not-found'){
  $error=New-Object Exception 'HTTP404';$error|Add-Member NoteProperty Response ([pscustomobject]@{StatusCode=404});throw $error
 }
 if($global:mode -notin @('primary','primary-corrupt')){[IO.File]::WriteAllText($OutFile,'partial');throw [Net.WebException]::new('Primary transport failed')}
 [IO.File]::WriteAllText($OutFile,$(if($global:mode -eq 'primary-corrupt'){'corrupt'}else{'verified'}))
}
$count=0
foreach($global:mode in @('primary','fallback','api-corrupt','both-fail','primary-corrupt','not-found','bad-id','wrong-host','http','credentials','query','bad-cache')){
 $global:calls=[Collections.Generic.List[string]]::new();$failed=$false
 $directory=Join-Path $root $global:mode
 try{& (Join-Path $directory 'scripts/fetch-dependencies.ps1')|Out-Null}catch{$failed=$true;$message=$_.Exception.Message}
 $target=Join-Path $directory '.tools/dependencies/asset.bin'
 $primary=@($global:calls|Where-Object {([uri]$_).Host -ne 'api.github.com'}).Count
 $api=@($global:calls|Where-Object {([uri]$_).Host -eq 'api.github.com'}).Count
 if($global:mode -in @('primary','fallback')){
  if($failed -or !(Test-Path -LiteralPath $target) -or [IO.File]::ReadAllText($target) -ne 'verified'){throw "Verified download did not succeed: $global:mode $message"}
 }else{
  if(!$failed){throw "Invalid download accepted: $global:mode"}
  if($global:mode -ne 'bad-cache' -and (Test-Path -LiteralPath $target)){throw 'Unverified bytes entered cache'}
 }
 switch($global:mode){
  'primary'{if($primary -ne 1 -or $api -ne 0){throw 'Unnecessary fallback'}}
  'fallback'{if($primary -ne 3 -or $api -ne 1){throw 'Fallback did not follow bounded primary retries'}}
  'api-corrupt'{if($primary -ne 3 -or $api -ne 1 -or $message -notmatch 'hash mismatch'){throw 'Corrupt API result was not rejected by hash'}}
  'both-fail'{if($primary -ne 3 -or $api -ne 3){throw 'Unbounded transport retries'}}
  'primary-corrupt'{if($primary -ne 1 -or $api -ne 0 -or $message -notmatch 'hash mismatch'){throw 'Hash mismatch must never trigger fallback'}}
  'not-found'{if($primary -ne 1 -or $api -ne 0){throw 'Permanent HTTP errors must not retry/fallback'}}
  default{if($global:calls.Count -ne 0){throw 'Invalid configuration/cache contacted network'}}
 }
 if(Test-Path -LiteralPath ($target+'.download')){throw 'Partial download was not removed'}
 $count++
}
Write-Output "Pinned fallback cases passed: $count"
`;
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,env:psEnv,timeout:20000});
    assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stdout,/Pinned fallback cases passed: 12/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
