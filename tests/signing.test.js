import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const windows=process.platform==='win32';
const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
const ps=(script,args=[])=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',resolve(script),...args],{env,encoding:'utf8',windowsHide:true,timeout:20000});

test('release verification rejects changed and unmanifested package files', {skip:!windows},()=>{
  const root=mkdtempSync(join(tmpdir(),'thinkpad-release-'));
  try {
    const paths=['scripts/asset-download.ps1','LICENSE','engine/TPFanControl.exe','engine/LpcACPIEC.bin','engine/TPFanControl.ini','notices/fan-engine/TPFanCtrl2-source.zip','notices/fan-engine/TPFanCtrl2-patched-source.zip','notices/fan-engine/fan-engine-build.lock.json','notices/fan-engine/TPFanCtrl2-single-fan.patch','notices/fan-engine/PawnIO.Modules-source.zip','notices/fan-engine/PawnIO.Modules-LGPL-2.1.txt'];
    const manifest=paths.map(path=>{
      mkdirSync(dirname(join(root,path)),{recursive:true});const data=Buffer.from('fixture');writeFileSync(join(root,path),data);
      return {path,sha256:createHash('sha256').update(data).digest('hex')};
    });
    writeFileSync(join(root,'package-manifest.json'),JSON.stringify(manifest));
    assert.equal(ps('scripts/verify-release.ps1',['-PackageRoot',root]).status,0);
    writeFileSync(join(root,'extra.txt'),'unexpected');
    const extra=ps('scripts/verify-release.ps1',['-PackageRoot',root]);assert.notEqual(extra.status,0);assert.match(extra.stderr,/unmanifested/);
    rmSync(join(root,'extra.txt'));writeFileSync(join(root,'LICENSE'),'modified');
    const changed=ps('scripts/verify-release.ps1',['-PackageRoot',root]);assert.notEqual(changed.status,0);assert.match(changed.stderr,/Package file modified/);
    writeFileSync(join(root,'LICENSE'),'fixture');rmSync(join(root,'scripts/asset-download.ps1'));
    writeFileSync(join(root,'package-manifest.json'),JSON.stringify(manifest.filter(entry=>entry.path!=='scripts/asset-download.ps1')));
    const missingHelper=ps('scripts/verify-release.ps1',['-PackageRoot',root]);assert.notEqual(missingHelper.status,0);assert.match(missingHelper.stderr,/Release component missing:.*asset-download/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

const toolsPath=resolve('.tools/signing/tools.json');
test('signing preflight makes no cloud request and refuses changing the signed EC module', {skip:!windows||!existsSync(toolsPath),timeout:40000},()=>{
  const root=mkdtempSync(join(tmpdir(),'thinkpad-signing-'));
  try {
    const tools=JSON.parse(readFileSync(toolsPath,'utf8').replace(/^\uFEFF/,''));
    const metadata=join(root,'metadata.json'),config=join(root,'config.json');
    writeFileSync(metadata,JSON.stringify({Endpoint:'https://eus.codesigning.azure.net',CodeSigningAccountName:'not-provisioned',CertificateProfileName:'not-provisioned'}));
    writeFileSync(config,JSON.stringify({Provider:'ArtifactSigning',...tools,MetadataFilePath:metadata,TimestampUrl:'http://timestamp.acs.microsoft.com'}));
    const preflight=ps('scripts/sign-file.ps1',['-Config',config,'-CheckOnly']);
    assert.equal(preflight.status,0,preflight.stderr);assert.match(preflight.stdout,/No signing request sent/);
    const temporaryExe=join(root,'uninst.e32.tmp');writeFileSync(temporaryExe,Buffer.from('MZtemporary-PE-fixture'));
    const temporaryCheck=ps('scripts/sign-file.ps1',['-Config',config,'-Path',temporaryExe,'-CheckOnly']);
    assert.equal(temporaryCheck.status,0,temporaryCheck.stderr);assert.match(temporaryCheck.stdout,/No signing request sent/);
    const module=join(root,'LpcACPIEC.bin');writeFileSync(module,'fixture');
    const denied=ps('scripts/sign-file.ps1',['-Config',config,'-Path',module]);
    assert.notEqual(denied.status,0);assert.match(denied.stderr,/Do not alter the signed PawnIO module/);
    const value=JSON.parse(readFileSync(config));value.ClientSecret='not-a-secret-test-fixture';writeFileSync(config,JSON.stringify(value));
    const secret=ps('scripts/sign-file.ps1',['-Config',config,'-CheckOnly']);
    assert.notEqual(secret.status,0);assert.match(secret.stderr,/Unknown signing setting: ClientSecret/);
  } finally {rmSync(root,{recursive:true,force:true});}
});


