import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
test('first-install driver setup verifies bytes/trust before one hidden launch and always cleans private staging', {skip:process.platform!=='win32',timeout:20000},()=>{
  const root=mkdtempSync(join(tmpdir(),'thinkpad-driver-bootstrap-'));
  try {
    mkdirSync(join(root,'scripts'));cpSync('scripts/asset-download.ps1',join(root,'scripts/asset-download.ps1'));
    const source=readFileSync('scripts/hardware-support.ps1','utf8');
    const start=source.indexOf('if ($null -eq $driver) {'),end=source.indexOf('$driver = Get-Service -Name PawnIO -ErrorAction Stop',start);
    assert.ok(start>=0&&end>start,'Must exercise the real missing-driver branch');
    writeFileSync(join(root,'scripts/missing-driver.ps1'),source.slice(start,end));
    const hash=createHash('sha256').update('verified-driver').digest('hex');
    const command=`Set-StrictMode -Version Latest;$ErrorActionPreference='Stop';$root=[IO.Path]::GetFullPath('${root.replaceAll("'","''")}');
$global:requests=0;$global:signatures=0;$global:launches=0;$global:mode='import';$global:privateRoot='';$global:aclReady=$false
function Start-Sleep {param($Seconds)}
function Set-Acl {param($LiteralPath,$AclObject)
 if(![IO.Path]::GetFullPath($LiteralPath).StartsWith($appRoot+'\\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($LiteralPath) -notmatch '^Setup-[0-9a-f]{32}$'){throw 'Staging escaped protected installation parent'}
 $rules=@($AclObject.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));$ids=@($rules|ForEach-Object {$_.IdentityReference.Value})
 if(!$AclObject.AreAccessRulesProtected -or $rules.Count -ne 2 -or $ids -notcontains 'S-1-5-18' -or $ids -notcontains 'S-1-5-32-544' -or @($rules|Where-Object {$_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne 'FullControl'}).Count){throw 'Private staging ACL changed'}
 $global:privateRoot=$LiteralPath;$global:aclReady=$true
}
function Invoke-WebRequest {param([switch]$UseBasicParsing,$Uri,$OutFile,$TimeoutSec,$Headers)
 if(!$global:aclReady -or [IO.Path]::GetDirectoryName($OutFile) -ne $global:privateRoot){throw 'Download preceded private staging ACL'}
 $global:requests++;$api=([uri]$Uri).Host -eq 'api.github.com'
 if($api -and ([string]$Uri -ne 'https://api.github.com/repos/namazso/PawnIO.Setup/releases/assets/374375077' -or $Headers.Accept -ne 'application/octet-stream' -or $Headers.Keys.Count -ne 2)){throw 'Wrong driver fallback request'}
 if($global:mode -eq 'offline' -or ($global:mode -eq 'fallback' -and !$api)){[IO.File]::WriteAllText($OutFile,'partial');throw [Net.WebException]::new('simulated transport failure')}
 [IO.File]::WriteAllText($OutFile,$(if($global:mode -eq 'wrong-hash'){'corrupt'}else{'verified-driver'}))
}
function Get-AuthenticodeSignature {param($LiteralPath)
 $global:signatures++
 if($global:mode -eq 'signature-error'){throw 'Signature verification failed'}
 [pscustomobject]@{Status=$(if($global:mode -eq 'unsigned'){'NotSigned'}elseif($global:mode -eq 'untrusted'){'NotTrusted'}else{'Valid'})}
}
function Start-Process {param($FilePath,$ArgumentList,$WindowStyle,[switch]$Wait,[switch]$PassThru)
 $global:launches++
 if($global:signatures -ne 1 -or $global:mode -in @('wrong-hash','unsigned','untrusted','signature-error','offline','bad-pin')){throw 'Unverified installer reached launch'}
 if($FilePath -ne (Join-Path $global:privateRoot 'PawnIO_setup.exe') -or ($ArgumentList -join ' ') -ne '-install -silent' -or $WindowStyle -ne 'Hidden' -or !$Wait -or !$PassThru){throw 'Installer launch arguments changed'}
 if($global:mode -eq 'launch-denied'){throw 'Launch denied'}
 [pscustomobject]@{ExitCode=$(if($global:mode -eq 'restart'){3010}elseif($global:mode -eq 'failed-install'){23}else{0})}
}
function Get-Service {throw 'Unexpected service access'}
function Start-Service {throw 'Unexpected service mutation'}
function Register-ScheduledTask {throw 'Unexpected task mutation'}
function Restart-Computer {throw 'Never restart during driver test'}
. (Join-Path $root 'scripts/asset-download.ps1')
if($global:requests -or $global:signatures -or $global:launches){throw 'Import performed actions'}
$count=0
foreach($global:mode in @('success','fallback','wrong-hash','unsigned','untrusted','signature-error','offline','bad-pin','restart','failed-install','launch-denied')){
 $appRoot=Join-Path $root $global:mode;[void][IO.Directory]::CreateDirectory($appRoot)
 $lock=[pscustomobject]@{driverPrerequisite=[pscustomobject]@{url='https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe';releaseAssetId=374375077;sha256=$(if($global:mode -eq 'bad-pin'){'invalid'}else{'${hash}'})}}
 $driver=$null;$global:requests=0;$global:signatures=0;$global:launches=0;$global:privateRoot='';$global:aclReady=$false;$failed=$false;$message=''
 try{& (Join-Path $root 'scripts/missing-driver.ps1')}catch{$failed=$true;$message=$_.Exception.Message}
 if($failed -ne ($global:mode -notin @('success','fallback'))){throw "Unexpected result $global:mode : $message"}
 if(@(Get-ChildItem -LiteralPath $appRoot -Force).Count -ne 0){throw "Private staging was not cleaned: $global:mode"}
 $trusted=$global:mode -in @('success','fallback','restart','failed-install','launch-denied')
 if($global:launches -ne $(if($trusted){1}else{0})){throw 'Installer execution was retried or trust gates bypassed'}
 if($global:mode -eq 'fallback' -and $global:requests -ne 4){throw 'Driver fallback was not used after primary retries'}
 if($global:mode -eq 'offline' -and $global:requests -ne 6){throw 'Driver network retries are unbounded'}
 if($global:mode -eq 'wrong-hash' -and ($global:signatures -ne 0 -or $message -notmatch 'hash mismatch')){throw 'Hash must precede signature and launch'}
 if($global:mode -eq 'bad-pin' -and $global:requests -ne 0){throw 'Invalid pin made network requests'}
 if($global:mode -eq 'restart' -and $message -notmatch 'requires a Windows restart'){throw 'Reboot-required result was lost'}
 if($global:mode -eq 'failed-install' -and !$message.Contains('PawnIO setup failed (23).')){throw 'Installer failure result was lost'}
 $count++
}
Write-Output "Mocked driver setup cases passed: $count; real installer/service executions:0"
`;
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,env,timeout:15000});
    assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stdout,/Mocked driver setup cases passed: 11; real installer\/service executions:0/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
