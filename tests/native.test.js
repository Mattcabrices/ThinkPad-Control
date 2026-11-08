import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NativeBridge } from '../src/bridge.js';

const executable=resolve('artifacts/windows-x64/bridge/ThinkPad.Bridge.exe');
test('published native bridge: snapshot, invalid control rejection and private protocol', {skip:process.platform!=='win32'||!existsSync(executable),timeout:30000},async()=>{
  const bridge=new NativeBridge(executable);
  try {
    const state=await bridge.request('snapshot');
    assert.ok(Array.isArray(state.sensors));assert.ok(Array.isArray(state.fans));
    assert.ok(state.sensors.filter(s=>s.type==='Temperature').every(s=>s.value===null||s.value>0));
    await assert.rejects(bridge.request('fan',{fanId:'__nonexistent_test_control__',mode:'manual',percent:75}),/not detected or allowlisted/);
    await assert.rejects(bridge.request('shell',{command:'whoami'}),/Unknown bridge operation/);
    assert.equal((await bridge.request('lease',{active:false})).ok,true);
  } finally { bridge.close(); }
});
