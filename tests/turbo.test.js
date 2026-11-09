import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DemoProvider,WindowsProvider,validateCommand} from '../src/providers.js';
import {TurboController,planTurbo} from '../src/turbo.js';
import {createApp} from '../src/server.js';
import {Store} from '../src/store.js';
import {engineRows,decodeEngineCurve} from '../src/fan-curves.js';

function fixture(profile='ryzen'){
  const p=new DemoProvider(profile);p.maxFrequency.ac=2300;p.maxFrequencyClass1.ac=1700;
  const commands=[],original=p.command.bind(p);p.command=async c=>{commands.push(c);return original(c);};
  return {p,commands,turbo:new TurboController(p)};
}
const captured=s=>({boost:s.boost,policy:s.cpuSteps.policy,ryzen:s.ryzen.current??null,mode:s.fans[0].mode,profile:s.fanProfiles.activeId});

test('Turbo command exposes only enable and restore; target values cannot be supplied by callers',()=>{
  for(const action of ['enable','restore'])assert.deepEqual(validateCommand({type:'turbo',action}),{type:'turbo',action});
  for(const c of [{type:'turbo'},{type:'turbo',action:'shell'},{type:'turbo',action:'enable',watts:100},{type:'turbo',enabled:true}])assert.throws(()=>validateCommand(c));
});

for(const profile of ['ryzen','intel'])test(`${profile} Turbo verifies available settings and restores exact policy including hybrid class limits`,async()=>{
  const {p,turbo,commands}=fixture(profile),before=captured(await p.snapshot());
  await turbo.command('enable');let s=await p.snapshot();assert.equal(turbo.view(s).active,true);assert.equal(s.cpuSteps.policy.ac,0);
  assert.equal(s.boost.ac,2);assert.equal(s.cpuSteps.policy.epp.ac,0);assert.equal(s.fans[0].level,64);
  assert.equal(s.boost.dc,before.boost.dc);assert.equal(s.cpuSteps.policy.dc,before.policy.dc);
  if(profile==='ryzen'){assert.equal(s.ryzen.current.fastWatts,40);assert.equal(s.ryzen.current.slowWatts,30);assert.equal(s.ryzen.current.temperatureLimit,before.ryzen.temperatureLimit);}
  else {assert.equal(s.cpuSteps.policy.class1.ac,0);assert.ok(!commands.some(c=>c.type==='ryzen-tune'));assert.match(turbo.view(s).notes.join(' '),/Intel.*read-only/);}
  assert.throws(()=>turbo.guard({type:'cpu-boost'}),/Restore previous/);assert.doesNotThrow(()=>turbo.guard({type:'fan',mode:'auto'}));
  await turbo.command('restore');assert.deepEqual(captured(await p.snapshot()),before);assert.equal(turbo.view(await p.snapshot()).recoveryPending,false);
});

test('battery Turbo affects only battery policy and a read-only wattage field is skipped honestly',async()=>{
  const {p,turbo,commands}=fixture(),snapshot=p.snapshot.bind(p);p.snapshot=async()=>{const s=await snapshot();s.powerSource='Offline';s.ryzen.fields.sustainedWatts={available:false,restoreAvailable:false};return s;};
  const before=captured(await p.snapshot());await turbo.command('enable');const after=await p.snapshot();
  assert.equal(after.boost.ac,before.boost.ac);assert.equal(after.cpuSteps.policy.ac,before.policy.ac);assert.equal(after.boost.dc,2);
  assert.ok(!commands.some(c=>c.setting==='sustainedWatts'));assert.match(turbo.view(after).notes.join(' '),/Sustained power: read-only/);
  await turbo.command('restore');assert.deepEqual(captured(await p.snapshot()),before);
});

test('already-max boost retains its existing recovery target and does not get switched off on Restore',async()=>{
  const {p,turbo}=fixture();await p.command({type:'cpu-max-boost',source:'ac',enabled:true});
  const memory=structuredClone(p.demoBoostBefore),before=captured(await p.snapshot());await turbo.command('enable');await turbo.command('restore');
  assert.deepEqual(captured(await p.snapshot()),before);assert.deepEqual(p.demoBoostBefore,memory);
});

test('a saved curve and its thresholds return after Turbo without modifying saved profiles',async()=>{
  const {p,turbo}=fixture();await p.command({type:'fan-profile-apply',id:'default-2'});
  const before=captured(await p.snapshot()),profiles=structuredClone((await p.snapshot()).fanProfiles.profiles);
  await turbo.command('enable');await turbo.command('restore');assert.deepEqual(captured(await p.snapshot()),before);
  assert.deepEqual((await p.snapshot()).fanProfiles.profiles,profiles);
});

for(const where of ['fan','frequency','boost','fastWatts'])test(`partial ${where} activation failure rolls back attempted writes and does not leave Turbo active`,async()=>{
  const {p,turbo}=fixture(),before=captured(await p.snapshot()),command=p.command.bind(p);let failed=false;
  p.command=async c=>{const result=await command(c);if(!failed&&((where==='fan'&&c.type==='fan'&&c.mode==='manual')||(where==='frequency'&&c.type==='cpu-step')||(where==='boost'&&c.type==='cpu-max-boost')||c.setting===where)){failed=true;throw Error('Injected post-write failure');}return result;};
  await assert.rejects(turbo.command('enable'),/Previous settings restored and verified/);
  assert.deepEqual(captured(await p.snapshot()),before);assert.equal(turbo.saved,null);
});

test('ignored wattage writes fail final read-back and restore all earlier settings',async()=>{
  const {p,turbo}=fixture(),before=captured(await p.snapshot()),command=p.command.bind(p);
  p.command=c=>c.setting==='fastWatts'&&c.value===40?'Ignored':command(c);
  await assert.rejects(turbo.command('enable'),/read-back/);assert.deepEqual(captured(await p.snapshot()),before);assert.equal(turbo.saved,null);
});

test('partial restoration retains recovery and permits a verified retry instead of clearing the baseline',async()=>{
  const {p,turbo}=fixture(),before=captured(await p.snapshot());await turbo.command('enable');
  const restore=p.restoreTurboPolicy.bind(p);p.restoreTurboPolicy=async()=>{throw Error('Policy write denied');};
  await assert.rejects(turbo.command('restore'),/incomplete/);assert.ok(turbo.saved);assert.equal((await p.snapshot()).fans[0].mode,'auto');
  p.restoreTurboPolicy=restore;await turbo.command('restore');assert.deepEqual(captured(await p.snapshot()),before);assert.equal(turbo.saved,null);
});

test('power-source changes, firmware overrides, and released fans stop the verified-active claim without automatic reapplication',async()=>{
  const {p,turbo,commands}=fixture();await turbo.command('enable');const count=commands.length,s=await p.snapshot();
  s.powerSource='Offline';assert.equal(turbo.view(s).active,false);s.powerSource='Online';s.ryzen.current.fastWatts=20;assert.equal(turbo.view(s).active,false);
  const fresh=await p.snapshot();fresh.fans[0].mode='auto';assert.equal(turbo.view(fresh).active,false);assert.equal(commands.length,count);
  await turbo.command('restore');
});

test('lost requesting UI lease aborts activation and restores settings',async()=>{
  const {p}=fixture(),before=captured(await p.snapshot());let alive=true;const original=p.command.bind(p);
  p.command=async c=>{const result=await original(c);if(c.type==='cpu-step')alive=false;return result;};
  const turbo=new TurboController(p,{leaseAlive:()=>alive});await assert.rejects(turbo.command('enable'),/connection was lost/);assert.deepEqual(captured(await p.snapshot()),before);
});

test('restart exposes persisted recovery without automatically applying Turbo; corrupt recovery refuses new activation',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'thinkpad-turbo-'));try{
    const {p}=fixture(),file=join(dir,'turbo.json'),before=captured(await p.snapshot()),first=new TurboController(p,{file});await first.command('enable');
    const restarted=new TurboController(p,{file});assert.equal(restarted.view(await p.snapshot()).active,false);assert.equal(restarted.view(await p.snapshot()).recoveryPending,true);
    await restarted.command('restore');assert.deepEqual(captured(await p.snapshot()),before);assert.equal(JSON.parse(readFileSync(file,'utf8')),null);
    writeFileSync(file,'{"schemaVersion":1}');const bad=new TurboController(p,{file});await assert.rejects(bad.command('enable'),/could not be read/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a different device cannot consume another recovery record',async()=>{
  const {p,turbo,commands}=fixture();await turbo.command('enable');const original=p.snapshot.bind(p),count=commands.length;
  p.snapshot=async()=>{const s=await original();s.cpu.name='Different CPU';return s;};await assert.rejects(turbo.command('restore'),/device differs/);assert.equal(commands.length,count);
});

test('unavailable policy, unknown source, high temperatures, unrecognized curves and manual ownership refuse before writes',async()=>{
  for(const change of [s=>s.capabilities.cpuMaxBoost.available=false,s=>s.powerSource='Unknown',s=>s.cpu.temperature=100,s=>s.fans[0].mode='manual',s=>{s.fans[0].mode='curve';s.fanProfiles.activeId=null;},s=>s.cpuSteps.policy.epp.ac=null,s=>s.cpuSteps.maxBoostRecovery={ac:true}]){
    const {p,turbo,commands}=fixture(),snapshot=p.snapshot.bind(p);p.snapshot=async()=>{const s=await snapshot();change(s);return s;};await assert.rejects(turbo.command('enable'));assert.equal(commands.length,0);
  }
});

function customCurveFixture(){
  const f=fixture(),levels=[45,51,56,61,66,72,78];
  f.p.ryzenLimits.temperatureLimit=86;
  f.p.ryzenBaseline.temperatureLimit=86;
  f.p.fanProfiles.save({id:'default-2',name:'Server inactive',levels,fanOff:true,maxTemp:85},86);
  f.p.fanCurve={active:2,rows:engineRows(levels,true,86,86),masks:[[11,30]]};f.p.fanMode='curve';
  return f;
}
test('an unmatched custom curve survives Turbo and restart recovery without editing saved profiles',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'thinkpad-custom-turbo-'));
  try{
    const {p,commands}=customCurveFixture(),before=await p.snapshot(),rows=structuredClone(p.fanCurve.rows),profiles=structuredClone(before.fanProfiles.profiles);
    assert.equal(before.fanProfiles.activeId,null);assert.equal(before.fanProfiles.customCurve,true);
    const file=join(dir,'recovery.json'),turbo=new TurboController(p,{file});
    assert.equal(turbo.view(before).available,true);await turbo.command('enable');
    const restarted=new TurboController(p,{file});await restarted.command('restore');
    const after=await p.snapshot();assert.deepEqual(p.fanCurve.rows,rows);assert.deepEqual(p.fanCurve.masks,[[11,30]]);
    assert.deepEqual(after.fanProfiles.profiles,profiles);assert.equal(after.fanProfiles.activeId,null);assert.equal(after.fans[0].mode,'curve');
    assert.deepEqual(captured(after),captured(before));assert.equal(restarted.saved,null);
    assert.ok(!commands.some(c=>c.type.startsWith('fan-profile')),'Recovery must not create or edit saved profiles');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('custom curve rollback restores exact rows after activation failure; wrong curve read-back retains recovery for retry',async()=>{
  const {p,turbo}=customCurveFixture(),rows=structuredClone(p.fanCurve.rows),originalCommand=p.command.bind(p);
  p.command=async c=>{const r=await originalCommand(c);if(c.setting==='fastWatts'&&c.value===40)throw Error('Injected wattage failure');return r;};
  await assert.rejects(turbo.command('enable'),/Previous settings restored/);assert.deepEqual(p.fanCurve.rows,rows);assert.equal(turbo.saved,null);
  p.command=originalCommand;await turbo.command('enable');const restore=p.restoreTurboCurve.bind(p);
  p.restoreTurboCurve=async saved=>{await restore(saved);p.fanCurve.rows.at(-1)[0]--;};
  await assert.rejects(turbo.command('restore'),/curve could not be verified/);assert.ok(turbo.saved);
  p.restoreTurboCurve=restore;await turbo.command('restore');assert.deepEqual(p.fanCurve.rows,rows);assert.equal(turbo.saved,null);
});
test('Windows custom curve recovery verifies actual worker thresholds instead of requiring a saved profile ID',async()=>{
  const rows=engineRows([45,51,56,61,66,72,78],true,86,86),masks=[[11,30]],p=new WindowsProvider({platform:'win32',runner:async()=> '{}'});
  let observed=rows;
  p.bridge={request:async(op,args)=>{assert.equal(op,'fan-curve');assert.deepEqual(args.rows,rows);assert.deepEqual(args.masks,masks);}};
  p.snapshot=async()=>({fans:[{id:'tpfc/cooling-system',mode:'curve'}],fanProfiles:{activeId:null,curveSet:true,limit:{celsius:86},currentCurve:decodeEngineCurve(observed,86),maskedSlots:masks}});
  const saved={id:'tpfc/cooling-system',mode:'curve',profile:{id:'captured-curve',...decodeEngineCurve(rows,86)},limit:86,masks};
  await p.restoreTurboCurve(saved);
  observed=engineRows([45,51,56,61,66,72,78],true,86,85);
  await assert.rejects(p.restoreTurboCurve(saved),/read-back did not match/);
});

test('authenticated Turbo API audits activation/restoration and blocks conflicting controls while retaining emergency firmware release',async t=>{
  const p=new DemoProvider(),store=new Store(':memory:'),app=createApp({provider:p,store,interval:60000});t.after(()=>app.close());const url=await app.listen(0);
  const command=body=>fetch(url+'/api/commands',{method:'POST',headers:{'X-Control-Token':app.sessionToken,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await command({type:'turbo',action:'enable'});assert.equal(response.status,200);assert.equal((await response.json()).snapshot.turbo.active,true);
  assert.equal((await command({type:'cpu-boost',source:'ac',enabled:false})).status,409);
  assert.equal((await command({type:'fan',id:'demo-cooling',mode:'auto'})).status,200);
  const restored=await command({type:'turbo',action:'restore'});assert.equal(restored.status,200);assert.equal((await restored.json()).snapshot.turbo.recoveryPending,false);
  const audit=store.activity();assert.ok(audit.some(e=>e.command.type==='turbo'&&e.status==='success'));assert.ok(audit.some(e=>e.command.type==='cpu-boost'&&e.status==='error'));
});

test('Windows restoration writes only fixed captured-source keys, preserves hybrid differences and refuses a changed plan',async()=>{
  const scheme='3ee21118-1234-4321-9876-0a1b2c3d4e5f',policy={scheme,ac:0,dc:3500,class1:{ac:0,dc:2200},epp:{ac:0,dc:60},eppClass1:{ac:0,dc:75}},boost={ac:2,dc:1},calls=[];
  const p=new WindowsProvider({runner:async(_,args)=>{calls.push(args);const key=args[3],value=Number(args[4]);if(args[0]==='/setacvalueindex'){if(key==='PROCFREQMAX')policy.ac=value;if(key==='PROCFREQMAX1')policy.class1.ac=value;if(key==='PERFBOOSTMODE')boost.ac=value;if(key==='PERFEPP')policy.epp.ac=value;if(key==='PERFEPP1')policy.eppClass1.ac=value;}return '';}});
  p.snapshot=async()=>({cpuSteps:{policy},boost});const b={scheme,source:'ac',hybrid:true,frequency:2300,frequencyClass1:1700,mode:0,epp:60,eppClass1:35};
  await p.restoreTurboPolicy(b,['frequency','boost'],null);assert.equal(policy.ac,2300);assert.equal(policy.class1.ac,1700);assert.equal(boost.ac,0);assert.equal(policy.eppClass1.ac,35);
  assert.ok(calls.every(a=>a[0]==='/setactive'||a[0]==='/setacvalueindex'));calls.length=0;policy.scheme='other-plan';await assert.rejects(p.restoreTurboPolicy(b,['frequency'],null),/original Windows power plan/);assert.equal(calls.length,0);
});

test('a failed API snapshot after successful Turbo activation rolls back the completed activation',async t=>{
  const p=new DemoProvider(),before=captured(await p.snapshot()),snapshot=p.snapshot.bind(p),command=p.command.bind(p);let armed=false,reads=0;
  p.command=async c=>{const result=await command(c);if(c.type==='ryzen-tune'&&c.setting==='slowWatts'&&c.value===30){armed=true;reads=0;}return result;};
  p.snapshot=async()=>{if(armed&&++reads===2)throw Error('Post-activation snapshot failed');return snapshot();};
  const app=createApp({provider:p,store:new Store(':memory:'),interval:60000});t.after(()=>app.close());const url=await app.listen(0);
  const response=await fetch(url+'/api/commands',{method:'POST',headers:{'X-Control-Token':app.sessionToken,'Content-Type':'application/json'},body:JSON.stringify({type:'turbo',action:'enable'})});
  assert.equal(response.status,409);assert.match((await response.json()).error,/restored and verified/);assert.deepEqual(captured(await p.snapshot()),before);
});

test('journal write failure refuses activation before changing hardware',async()=>{
  const {turbo,commands}=fixture();turbo.persist=()=>{throw Error('Recovery storage unavailable');};
  await assert.rejects(turbo.command('enable'),/storage unavailable/);assert.equal(commands.length,0);
});

test('a long activation renews cooling only while the requesting UI lease is alive',async()=>{
  const {p,turbo}=fixture(),command=p.command.bind(p),heartbeat=p.heartbeat.bind(p);let renewals=0;
  p.heartbeat=async active=>{if(active)renewals++;return heartbeat(active);};
  p.command=async c=>{const result=await command(c);if(c.type==='fan'&&c.mode==='manual')await new Promise(r=>setTimeout(r,2200));return result;};
  await turbo.command('enable');assert.ok(renewals>=1);await turbo.command('restore');
});
