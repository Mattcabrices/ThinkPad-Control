import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';

const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
test('archive verifier accepts complete builds and rejects missing, changed, private, duplicate and unsafe ZIP entries', {skip:process.platform!=='win32',timeout:30000},()=>{
  const root=mkdtempSync(join(tmpdir(),'thinkpad-archive-fixture-'));
  try {
    const write=(path,data='fixture')=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),data);};
    for(const directory of ['src','public','native','native-tests','desktop','installer','scripts','tests','docs','third-party','.github','signing'])mkdirSync(join(root,directory),{recursive:true});
    for(const file of ['README.md','LICENSE','THIRD-PARTY-NOTICES.md','SECURITY.md','CONTRIBUTING.md','NuGet.Config','.gitignore','signing/artifact-signing.example.json','signing/metadata.example.json','signing/certificate-store.example.json'])write(file);
    write('package.json',JSON.stringify({version:'0.0.0-fixture'}));
    for(const script of ['package-source.ps1','verify-archives.ps1','verify-release.ps1'])cpSync(join('scripts',script),join(root,'scripts',script));
    const payload=['LICENSE','engine/TPFanControl.exe','engine/LpcACPIEC.bin','engine/TPFanControl.ini','notices/fan-engine/TPFanCtrl2-source.zip','notices/fan-engine/TPFanCtrl2-patched-source.zip','notices/fan-engine/fan-engine-build.lock.json','notices/fan-engine/TPFanCtrl2-single-fan.patch','notices/fan-engine/PawnIO.Modules-source.zip','notices/fan-engine/PawnIO.Modules-LGPL-2.1.txt'];
    for(const file of payload)write('stage/'+file);
    write('stage/package-manifest.json',JSON.stringify(payload.map(path=>({path,sha256:createHash('sha256').update('fixture').digest('hex')}))));
    const command=`$ErrorActionPreference='Stop'; $root=[IO.Path]::GetFullPath('${root.replaceAll("'","''")}');
Add-Type -AssemblyName System.IO.Compression.FileSystem
$pack=Join-Path $root 'scripts/package-source.ps1'; $verify=Join-Path $root 'scripts/verify-archives.ps1'; $stage=Join-Path $root 'stage'
$list=@(& $pack -ListFiles)
if($list.Count -lt 10 -or (Test-Path -LiteralPath (Join-Path $root 'artifacts'))){throw 'Listing source files must not create build outputs'}
$source=& $pack; $portable=Join-Path $root 'portable.zip'
$zip=[IO.Compression.ZipFile]::Open($portable,[IO.Compression.ZipArchiveMode]::Create)
try {Get-ChildItem -LiteralPath $stage -File -Recurse|ForEach-Object{[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$_.FullName,$_.FullName.Substring($stage.Length+1).Replace('\\','/'))}}finally{$zip.Dispose()}
& $verify -PackageRoot $stage -PortablePath $portable -SourcePath $source | Out-Null
$fileSystem=New-Object -ComObject Scripting.FileSystemObject
$shortStage=$fileSystem.GetFolder($stage).ShortPath
& $verify -PackageRoot $shortStage -PortablePath $portable -SourcePath $source | Out-Null
$count=0
foreach($kind in @('portable','source')){
 foreach($mode in @('missing','changed','size','extra','private','duplicate','case','traversal','absolute','backslash','symlink','directory','directory-data')){
  $bad=Join-Path $root ($kind+'-'+$mode+'.zip'); Copy-Item -LiteralPath $(if($kind -eq 'portable'){$portable}else{$source}) -Destination $bad
  $zip=[IO.Compression.ZipFile]::Open($bad,[IO.Compression.ZipArchiveMode]::Update)
  try {
   $name=if($kind -eq 'portable'){'LICENSE'}else{'README.md'}
   if($mode -eq 'symlink'){$zip.GetEntry($name).ExternalAttributes=(0xa1ff -shl 16)}
   elseif($mode -eq 'missing'){$zip.GetEntry($name).Delete()}
   else {
    if($mode -in @('changed','size')){$zip.GetEntry($name).Delete()}
    $entryName=switch($mode){'extra'{'unexpected.txt'} 'private'{'.env.production'} 'case'{$name.ToLowerInvariant()} 'traversal'{'../outside.txt'} 'absolute'{'/outside.txt'} 'backslash'{'..\\outside.txt'} 'directory'{'unexpected/'} 'directory-data'{$(if($kind -eq 'portable'){'engine/'}else{'scripts/'})} default{$name}}
    $entry=$zip.CreateEntry($entryName)
    if($mode -ne 'directory'){$writer=[IO.StreamWriter]::new($entry.Open());try{$writer.Write($(if($mode -eq 'size'){'too-many-bytes'}elseif($mode -eq 'changed'){'changed'}else{'fixture'}))}finally{$writer.Dispose()}}
   }
  }finally{$zip.Dispose()}
  $failed=$false
  try{& $verify -PackageRoot $stage -PortablePath $(if($kind -eq 'portable'){$bad}else{$portable}) -SourcePath $(if($kind -eq 'source'){$bad}else{$source}) | Out-Null}catch{$failed=$true;$message=$_.Exception.Message}
  if(!$failed){throw "$kind/$mode archive was accepted"}
  if($message -notmatch 'Unsafe archive|Duplicate archive|Symlink archive|Unexpected archive|unexpected entries|Archive (content|size) mismatch|missing expected files|Archive directory contains data'){throw "Wrong failure for $kind/$mode : $message"}
  $count++
 }
}
[IO.File]::WriteAllText((Join-Path $stage 'LICENSE'),'changed')
$failed=$false;try{& $verify -PackageRoot $stage -PortablePath $portable -SourcePath $source | Out-Null}catch{$failed=$_.Exception.Message -match 'Package file modified'}
if(!$failed){throw 'Changed staged payload was accepted'}
Write-Output "Damaged archive cases rejected: $count"
`;
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,env,timeout:25000});
    assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stdout,/Damaged archive cases rejected: 26/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
