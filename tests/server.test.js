import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { DemoProvider } from '../src/providers.js';
import { Store } from '../src/store.js';

async function fixture(t,provider=new DemoProvider()) {
  const store=new Store(':memory:'), app=createApp({store,provider,interval:60000});
  const url=await app.listen(0); t.after(()=>app.close());
  const {token}=await fetch(url+'/api/session').then(r=>r.json());
  const request=(path,body,headers={})=>fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'X-Control-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {app,store,url,request,provider};
}
test('API requires per-session tokens and enforces same origin',async t=>{
  const {request,url}=await fixture(t);
  assert.equal((await fetch(url+'/api/state')).status,403);
  assert.equal((await request('/api/state',undefined,{'X-Control-Token':'wrong'})).status,403);
  assert.equal((await request('/api/state',undefined,{Origin:'https://attacker.example'})).status,403);
  const good=await request('/api/state'); assert.equal(good.status,200);
  assert.equal((await good.json()).snapshot.mode,'demo');
});
test('DNS rebinding Host is rejected',async t=>{
  const {url}=await fixture(t);
  const status=await new Promise((resolve,reject)=>{
    const r=http.get(url,{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);}); r.on('error',reject);
  }); assert.equal(status,403);
});
test('static assets have CSP and traversal cannot read source or database',async t=>{
  const {url,request}=await fixture(t);
  const page=await fetch(url); assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.ok((await page.text()).includes('ThinkPad Control'));
  assert.equal((await request('/src/server.js')).status,404);
  assert.equal((await request('/data/demo.sqlite')).status,404);
});
test('control success is read back and audit intent becomes success',async t=>{
  const {request}=await fixture(t);
  const response=await request('/api/commands',{type:'cpu-boost',source:'ac',enabled:false});
  assert.equal(response.status,200); assert.equal((await response.json()).snapshot.boost.ac,0);
  const audit=await request('/api/activity').then(r=>r.json()); assert.equal(audit[0].status,'success');
  assert.equal(audit[0].command.source,'ac');
});
test('write failures are audited, surfaced and do not look successful',async t=>{
  const p=new DemoProvider(); p.command=async()=>{throw new Error('Driver refused the write');};
  const {request}=await fixture(t,p);
  const response=await request('/api/commands',{type:'cpu-boost',source:'all',enabled:false});
  assert.equal(response.status,409); assert.match((await response.json()).error,/refused/);
  assert.equal((await request('/api/activity').then(r=>r.json()))[0].status,'error');
});
test('commands serialize hardware access during concurrent requests',async t=>{
  const p=new DemoProvider(); let active=0,peak=0;
  const original=p.command.bind(p);
  p.command=async c=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,20));await original(c);active--;return 'Verified';};
  const {request}=await fixture(t,p);
  const responses=await Promise.all([true,false,true].map(enabled=>request('/api/commands',{type:'cpu-boost',source:'ac',enabled})));
  assert.ok(responses.every(r=>r.status===200)); assert.equal(peak,1);
});
test('request schema, content type, size and history windows are bounded',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('/api/commands',{type:'cpu-boost',source:'ac',enabled:1})).status,400);
  assert.equal((await request('/api/commands',{}, {'Content-Type':'text/plain'})).status,415);
  assert.equal((await request('/api/commands',{payload:'x'.repeat(17000)})).status,413);
  assert.equal((await request('/api/history?minutes=Infinity')).status,400);
  assert.equal((await request('/api/history?minutes=61')).status,400);
  assert.equal((await request('/api/history?minutes=10')).status,200);
});
test('read failures preserve the previous snapshot and expose an error',async t=>{
  const p=new DemoProvider(), {request}=await fixture(t,p);
  p.snapshot=async()=>{throw new Error('sensor disappeared');};
  await request('/api/commands',{type:'cpu-boost',source:'all',enabled:false});
  const result=await request('/api/state').then(r=>r.json());
  assert.ok(result.snapshot); assert.match(result.error,/sensor disappeared/);
});
test('shutdown is authenticated, validates the request, and releases the provider once',async t=>{
  const p=new DemoProvider();let closed=0;p.close=async()=>{closed++;};
  const {request,url,app}=await fixture(t,p);
  assert.equal((await fetch(url+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await request('/api/shutdown',{unexpected:true})).status,400);
  assert.equal((await request('/api/shutdown',{})).status,200);
  await app.close();await app.close();assert.equal(closed,1);
});
test('closing/minimizing client releases an active manual fan immediately',async t=>{
  const {request,provider}=await fixture(t);
  await provider.command({type:'fan',id:'demo-cooling',mode:'manual',level:4});
  assert.equal((await provider.snapshot()).fans[0].mode,'manual');
  assert.equal((await request('/api/lease',{active:false})).status,200);
  assert.equal((await provider.snapshot()).fans[0].mode,'auto');
});
test('tray firmware action validates input and restores the fan',async t=>{
  const {request,provider}=await fixture(t);
  await provider.command({type:'fan',id:'demo-cooling',mode:'manual',level:6});
  assert.equal((await request('/api/restore-fans',{extra:true})).status,400);
  assert.equal((await request('/api/restore-fans',{})).status,200);
  assert.equal((await provider.snapshot()).fans[0].mode,'auto');
});

test('fan leases expire by elapsed time through wall-clock rollback and stay released', {timeout:5000},async t=>{
  let elapsed=0,nextHeartbeat;
  const heartbeatStates=[];
  const provider=new DemoProvider();
  provider.heartbeat=async active=>{heartbeatStates.push(active);if(nextHeartbeat){const accept=nextHeartbeat;nextHeartbeat=null;accept(active);}};
  const app=createApp({provider,store:new Store(':memory:'),interval:10,monotonicNow:()=>elapsed});
  t.after(()=>app.close());
  const url=await app.listen(0);
  assert.equal(heartbeatStates[0],false,'Startup at elapsed time zero must not create a lease');
  const lease=active=>fetch(url+'/api/lease',{method:'POST',headers:{'X-Control-Token':app.sessionToken,'Content-Type':'application/json'},body:JSON.stringify({active})});
  const poll=()=>new Promise(resolve=>{nextHeartbeat=resolve;});
  assert.equal((await lease(true)).status,200);
  assert.equal(await poll(),true,'An explicit lease beginning at elapsed zero is valid');
  const originalWallTime=Date.now();
  t.mock.method(Date,'now',()=>originalWallTime-86400000);
  elapsed=7500;
  assert.equal(await poll(),false,'A day of clock rollback must not extend the fan lease');
  assert.equal((await lease(false)).status,200);
  assert.equal(await poll(),false,'Polling must not resurrect a released lease');
});
test('failed post-command snapshot releases a possibly applied manual fan',async t=>{
  const p=new DemoProvider();let failSnapshot=false;
  const originalCommand=p.command.bind(p),originalSnapshot=p.snapshot.bind(p);
  p.command=async command=>{const result=await originalCommand(command);failSnapshot=true;return result;};
  p.snapshot=async()=>{if(failSnapshot){failSnapshot=false;throw new Error('Post-write snapshot failed');}return originalSnapshot();};
  const {request}=await fixture(t,p);
  const response=await request('/api/commands',{type:'fan',id:'demo-cooling',mode:'manual',level:5});
  assert.equal(response.status,409);assert.match((await response.json()).error,/Post-write snapshot failed/);
  assert.equal(p.fanMode,'auto','Failure must release fan ownership before error recovery polling');
  assert.equal((await request('/api/activity').then(r=>r.json()))[0].status,'error');
});