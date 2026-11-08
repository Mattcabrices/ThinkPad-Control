import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { PipeBridge } from '../src/pipe-bridge.js';
import { pathToFileURL } from 'node:url';

test('hardware pipe names must be private per-session identifiers',()=>{
  for(const name of ['server','\\\\remote\\pipe\\test','ThinkPadControl-..','ThinkPadControl-'])assert.throws(()=>new PipeBridge(name));
});
for(const intel of [false,true])test(`desktop ${intel?'Intel':'Ryzen'} demo uses an allocated port, separate writable data and ready handshake`, {timeout:20000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),'thinkpad-desktop-'));
  const child=spawn(process.execPath,['src/server.js','--desktop',intel?'--demo-intel':'--demo'],{cwd:resolve('.'),windowsHide:true,
    env:{...process.env,PORT:'0',THINKPAD_DATA_DIR:directory,THINKPAD_PARENT_PID:String(process.pid)},stdio:['ignore','pipe','pipe']});
  const exit=once(child,'exit');let error='';child.stderr.on('data',chunk=>{error+=chunk;});
  try {
    const ready=await new Promise((accept,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Desktop backend readiness timed out: '+error)),10000);
      createInterface({input:child.stdout}).on('line',line=>{if(line.startsWith('DESKTOP_READY ')){clearTimeout(timer);accept(JSON.parse(line.slice(14)));}});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('Early backend exit: '+error));});
    });
    assert.match(ready.url,/^http:\/\/127\.0\.0\.1:\d+$/);assert.equal(ready.token.length,64);
    assert.ok(existsSync(join(directory,intel?'demo-intel.sqlite':'demo.sqlite')));
    const response=await fetch(ready.url+'/api/state',{headers:{'X-Control-Token':ready.token}});
    const snapshot=(await response.json()).snapshot;
    assert.equal(snapshot.mode,'demo');
    assert.equal(snapshot.cpuSteps.vendor,intel?'GenuineIntel':'AuthenticAMD');
    if(intel){assert.equal(snapshot.ryzen.available,false);assert.equal(snapshot.gpus[0].vendor,'Intel');assert.equal(snapshot.cpuSteps.hardware.hybrid,true);}
    await fetch(ready.url+'/api/shutdown',{method:'POST',headers:{'X-Control-Token':ready.token,'Content-Type':'application/json'},body:'{}'});
    assert.equal((await exit)[0],0);
  } finally {if(child.exitCode===null)child.kill();await exit;rmSync(directory,{recursive:true,force:true});}
});
const bridgeExe=resolve('artifacts/windows-x64/bridge/ThinkPad.Bridge.exe');
test('native private pipe connects only through reviewed protocol and exits on disconnect', {
  skip:process.platform!=='win32'||!existsSync(bridgeExe),timeout:40000
},async()=>{
  const sid=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true}).trim();
  const name='ThinkPadControl-'+randomBytes(16).toString('hex');
  const child=spawn(bridgeExe,['--pipe',name,'--owner',sid],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let error='';child.stderr.on('data',chunk=>{error+=chunk;});const exit=once(child,'exit');
  const bridge=new PipeBridge(name);
  try {
    // The production worker deliberately rejects this system-node test process.
    await assert.rejects(bridge.request('snapshot'),/disconnected/);
    bridge.close();
    const timeout=setTimeout(()=>child.kill(),10000);
    const [code]=await exit;clearTimeout(timeout);assert.notEqual(code,0,'An untrusted client runtime must be rejected before sensor initialization');
  } finally {bridge.close();if(child.exitCode===null)child.kill();await exit;}
  const bundledNode=resolve('artifacts/windows-x64/runtime/node.exe');
  const clientCode=`
    import assert from 'node:assert/strict';
    import {spawn} from 'node:child_process';
    import {once} from 'node:events';
    import {PipeBridge} from ${JSON.stringify(pathToFileURL(resolve('src/pipe-bridge.js')).href)};
    const worker=spawn(${JSON.stringify(bridgeExe)},['--pipe',${JSON.stringify(name)},'--owner',${JSON.stringify(sid)}],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    const exit=once(worker,'exit');let error='';worker.stderr.on('data',chunk=>error+=chunk);
    const bridge=new PipeBridge(${JSON.stringify(name)});
    try {
      const snapshot=await bridge.request('snapshot');assert.ok(Array.isArray(snapshot.sensors));assert.equal(typeof snapshot.driver.administrator,'boolean');
      await assert.rejects(bridge.request('cpu-boost',{source:'arbitrary-command',enabled:true}),/Invalid boost power source/);
      await assert.rejects(bridge.request('gpu-boost',{gpuId:'--shell',enabled:true}),/Invalid GPU UUID/);
      await assert.rejects(bridge.request('shell',{command:'whoami'}),/Unknown bridge operation/);
      await bridge.request('lease',{active:false});bridge.close();
      const timer=setTimeout(()=>worker.kill(),10000);
      try{assert.equal((await exit)[0],0,error);}finally{clearTimeout(timer);}
    } finally{bridge.close();if(worker.exitCode===null)worker.kill();await exit;}
  `;
  const approved=spawn(bundledNode,['--input-type=module','--eval',clientCode],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let approvedError='';approved.stderr.on('data',chunk=>approvedError+=chunk);
  const approvedTimeout=setTimeout(()=>approved.kill(),30000);
  try{assert.equal((await once(approved,'exit'))[0],0,approvedError);}finally{clearTimeout(approvedTimeout);}
});
test('desktop release manifest includes executable, runtimes, UI and bridge without data or build tools',{
  skip:!existsSync('artifacts/windows-x64/package-manifest.json')
},()=>{
  const manifest=JSON.parse(readFileSync('artifacts/windows-x64/package-manifest.json','utf8').replace(/^\uFEFF/,''));
  const files=manifest.map(x=>x.path.replaceAll('\\','/'));
  for(const path of ['ThinkPad Control.exe','runtime/node.exe','bridge/ThinkPad.Bridge.exe','bridge/MonoPosixHelper.dll','bridge/libMonoPosixHelper.dll','app/src/server.js','app/src/cpu-steps.js','app/public/index.html','app/public/desktop.js','notices/NODE-LICENSE.txt'])assert.ok(files.includes(path),path);
  assert.ok(files.every(p=>!p.startsWith('data/')&&!p.startsWith('.tools/')&&!p.endsWith('.sqlite')));
});
