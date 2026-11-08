import test from 'node:test';
import assert from 'node:assert/strict';
import { WindowsProvider } from '../src/providers.js';
import { buildCpuSteps } from '../src/cpu-steps.js';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildCompatibilityReport} from '../src/compat-report.js';

const scheme='3ee21118-1234-4321-9876-0a1b2c3d4e5f', other='11111111-1234-4321-9876-0a1b2c3d4e5f';
const commands=[
  [{type:'cpu-boost',source:'ac',enabled:true},'PERFBOOSTMODE'],
  [{type:'cpu-max-boost',source:'ac',enabled:true},'PERFEPP1'],
  [{type:'cpu-step',source:'ac',mhz:1600},'PROCFREQMAX1']
];
function fixture(critical,{ignored=false,changedPlan=false,unreadable=false,failActivationAt=1,boostStateFile=null,initialPolicy=null}={}) {
  const policy=structuredClone(initialPolicy??{PERFBOOSTMODE:{ac:0,dc:0},PERFEPP:{ac:60,dc:60},PERFEPP1:{ac:35,dc:75},PROCFREQMAX:{ac:0,dc:3500},PROCFREQMAX1:{ac:2800,dc:2200}});
  let failed=false,active=scheme,activations=0;
  const calls=[];
  const provider=new WindowsProvider({boostStateFile,runner:async(file,args)=>{
    calls.push(args);
    if(args[0]==='/setactive') {
      activations++;
      if(!failed&&activations===failActivationAt){failed=true;if(changedPlan)active=other;throw new Error('Activation failure after writes');}
      active=args[1];return '';
    }
    if(args[0]==='/setacvalueindex'||args[0]==='/setdcvalueindex') {
      if(!(failed&&ignored&&args[3]===critical))policy[args[3]][args[0]==='/setacvalueindex'?'ac':'dc']=Number(args[4]);
    }
    return '';
  }});
  provider.snapshot=async()=>{
    if(failed&&unreadable)throw new Error('Policy read unavailable');
    const probe={boost:{scheme:active,...policy.PERFBOOSTMODE},cpuPolicy:{scheme:active,maxFrequency:{...policy.PROCFREQMAX},maxFrequencyClass1:{...policy.PROCFREQMAX1},epp:{...policy.PERFEPP},eppClass1:{...policy.PERFEPP1}}};
    return {boost:probe.boost,cpuSteps:buildCpuSteps(probe,{available:false,vendor:'GenuineIntel',hybrid:true}),capabilities:{cpuBoost:{available:true},cpuStep:{available:true},cpuMaxBoost:{available:true}},gpus:[],fans:[]};
  };
  return {provider,policy,calls,allowRecovery(){ignored=false;unreadable=false;active=scheme;}};
}

test('unverified maximum-boost recovery preserves the original preferences and refuses re-enable until repaired',async()=>{
  const {provider,policy,calls,allowRecovery}=fixture('PERFEPP1',{ignored:true});
  await assert.rejects(provider.command({type:'cpu-max-boost',source:'ac',enabled:true}),/unverified/);
  assert.equal(provider.readBoostMemory()[scheme].ac.eppClass1,35);
  assert.equal(provider.readBoostMemory()[scheme].ac.recoveryPending,true);
  const beforeCalls=calls.length;
  await assert.rejects(provider.command({type:'cpu-max-boost',source:'ac',enabled:true}),/Finish the pending boost recovery/);
  assert.equal(calls.length,beforeCalls,'Retry must not overwrite the original preference or issue writes');
  allowRecovery();
  assert.match(await provider.command({type:'cpu-max-boost',source:'ac',enabled:false}),/restored and verified/);
  assert.deepEqual(policy.PERFEPP1,{ac:35,dc:75});assert.equal(policy.PERFBOOSTMODE.ac,0);
  assert.deepEqual(provider.readBoostMemory(),{});
});

test('a failed off transition remains recoverable even when the combined maximum state is already false',async()=>{
  const {provider,policy,allowRecovery}=fixture('PERFEPP1',{ignored:true,failActivationAt:2});
  await provider.command({type:'cpu-max-boost',source:'ac',enabled:true});
  await assert.rejects(provider.command({type:'cpu-max-boost',source:'ac',enabled:false}),/unverified/);
  assert.equal((await provider.snapshot()).cpuSteps.maxBoost.ac,false);
  assert.equal(provider.readBoostMemory()[scheme].ac.recoveryPending,true);
  allowRecovery();
  await provider.command({type:'cpu-max-boost',source:'ac',enabled:false});
  assert.deepEqual(policy.PERFEPP1,{ac:35,dc:75});assert.equal(policy.PERFBOOSTMODE.ac,0);
  assert.deepEqual(provider.readBoostMemory(),{});
});

test('unavailable basic boost refuses before attempting a pending preference recovery',async()=>{
  const {provider,calls}=fixture('PERFEPP1',{ignored:true});
  await assert.rejects(provider.command({type:'cpu-max-boost',source:'ac',enabled:true}),/unverified/);
  const snapshot=provider.snapshot;
  provider.snapshot=async()=>{const state=await snapshot();state.capabilities.cpuBoost={available:false,reason:'Policy access unavailable'};return state;};
  const before=calls.length;
  await assert.rejects(provider.command({type:'cpu-boost',source:'ac',enabled:false}),/Policy access unavailable/);
  assert.equal(calls.length,before);
  assert.equal(provider.readBoostMemory()[scheme].ac.recoveryPending,true);
});

test('plain boost finishes pending preference recovery before applying the requested mode',async()=>{
  const {provider,policy,allowRecovery}=fixture('PERFEPP1',{ignored:true});
  await assert.rejects(provider.command({type:'cpu-max-boost',source:'ac',enabled:true}),/unverified/);
  allowRecovery();await provider.command({type:'cpu-boost',source:'ac',enabled:false});
  assert.equal(policy.PERFBOOSTMODE.ac,0);assert.deepEqual(policy.PERFEPP1,{ac:35,dc:75});
  assert.deepEqual(provider.readBoostMemory(),{});
});

test('failed repair distinguishes a verified rollback to the partial state from finishing the saved recovery',async()=>{
  const {provider,allowRecovery}=fixture('PERFEPP1',{ignored:true});
  await assert.rejects(provider.command({type:'cpu-max-boost',source:'ac',enabled:true}),/unverified/);
  allowRecovery();const run=provider.run;let refused=false;
  provider.run=async(file,args)=>{
    if(!refused&&args[0]==='/setacvalueindex'&&args[3]==='PERFEPP1'&&args[4]==='35'){refused=true;throw new Error('Recovery write refused');}
    return run(file,args);
  };
  await assert.rejects(provider.command({type:'cpu-max-boost',source:'ac',enabled:false}),/Pre-attempt.*saved recovery target is still pending/);
  assert.equal(provider.readBoostMemory()[scheme].ac.recoveryPending,true);
  assert.equal(provider.readBoostMemory()[scheme].ac.eppClass1,35);
  await provider.command({type:'cpu-max-boost',source:'ac',enabled:false});
  assert.deepEqual(provider.readBoostMemory(),{});
});

test('pending boost recovery survives restart with the original class preference intact',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'thinkpad-boost-recovery-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const boostStateFile=join(directory,'baseline.json');
  const first=fixture('PERFEPP1',{ignored:true,boostStateFile});
  await assert.rejects(first.provider.command({type:'cpu-max-boost',source:'ac',enabled:true}),/unverified/);
  const saved=JSON.parse(readFileSync(boostStateFile,'utf8'));
  assert.equal(saved[scheme].ac.eppClass1,35);assert.equal(saved[scheme].ac.recoveryPending,true);
  const second=fixture('PERFEPP1',{boostStateFile,initialPolicy:first.policy,failActivationAt:100});
  await second.provider.command({type:'cpu-max-boost',source:'ac',enabled:false});
  assert.equal(second.policy.PERFEPP1.ac,35);assert.deepEqual(JSON.parse(readFileSync(boostStateFile,'utf8')),{});
});

test('recovery is visible in the live snapshot/report even without a maximum-frequency setting',async()=>{
  const provider=new WindowsProvider({platform:'win32',runner:async(file,args)=>{
    if(args.includes('-File'))return JSON.stringify({boost:{scheme,ac:0,dc:0},cpuPolicy:{scheme,epp:{ac:60,dc:60}},cpu:{Manufacturer:'GenuineIntel'},warnings:[]});
    throw new Error('No NVIDIA driver');
  }});
  provider.bridge={request:async()=>({cpuStates:{available:false,vendor:'GenuineIntel',hybrid:false},sensors:[],fans:[]})};
  provider.writeBoostMemory({[scheme]:{ac:{mode:0,epp:60,recoveryPending:true,private:'never report this'}}});
  const snapshot=await provider.snapshot();
  assert.equal(snapshot.capabilities.cpuStep.available,false);assert.equal(snapshot.capabilities.cpuMaxBoost.available,true);
  assert.deepEqual(snapshot.cpuSteps.maxBoostRecovery,{ac:true,dc:false});
  const report=buildCompatibilityReport(snapshot);
  assert.deepEqual(report.cpuSteps.maxBoostRecovery,{ac:true,dc:false});assert.ok(!JSON.stringify(report).includes('never report this'));
});

for(const [command,critical] of commands) {
  test(`${command.type}: ignored restoration must not claim the original policy was restored`,async()=>{
    const {provider}=fixture(critical,{ignored:true});
    await assert.rejects(provider.command(command),error=>{
      assert.match(error.message,/Rollback incomplete or unverified:.*read-back mismatch/);
      assert.doesNotMatch(error.message,/Original .* restored/);return true;
    });
  });
  test(`${command.type}: changed power plan is retained and rollback is labelled unverified`,async()=>{
    const {provider,calls}=fixture(critical,{changedPlan:true});
    await assert.rejects(provider.command(command),/Rollback incomplete or unverified:.*power plan changed/);
    assert.equal(calls.filter(args=>args[0]==='/setactive').length,1,'Recovery must not reactivate the old plan after a detected plan change');
  });
  test(`${command.type}: failed read after restoration remains explicit`,async()=>{
    const {provider}=fixture(critical,{unreadable:true});
    await assert.rejects(provider.command(command),/Rollback incomplete or unverified: Policy read unavailable/);
  });
  test(`${command.type}: successful restoration is read back and leaves battery settings alone`,async()=>{
    const {provider,policy}=fixture(critical);
    const before=structuredClone(policy);
    await assert.rejects(provider.command(command),/Original .* restored and verified/);
    assert.deepEqual(policy,before);
  });
}

function gpuFixture(scenario) {
  let enabled=false,queries=0;const writes=[],calls=[];
  const provider=new WindowsProvider({runner:async(file,args)=>{
    calls.push(args);assert.equal(args[1],'GPU-a123');
    if(args.includes('--query-gpu=auto_boost.default')) {
      queries++;
      if(scenario==='unsupported')return '[N/A]';
      if((scenario==='unreadable'&&queries>1)||(['restored','ignored'].includes(scenario)&&queries===2))throw new Error('Driver query failed');
      return enabled?'Enabled':'Disabled';
    }
    const value=args.at(-1).endsWith('=1');writes.push(value);
    if(!(scenario==='ignored'&&writes.length>1))enabled=value;
    if(scenario==='partial'&&writes.length===1)throw new Error('Driver failed after writing');
    return '';
  }});
  provider.snapshot=async()=>({gpus:[{id:'GPU-a123',boost:false,boostCapability:{available:true}}]});
  return {provider,writes,calls,state:()=>enabled};
}
for(const scenario of ['success','restored','ignored','unreadable','partial','unsupported']) {
  test(`NVIDIA default policy recovery: ${scenario}`,async()=>{
    const {provider,writes,state}=gpuFixture(scenario);
    const command={type:'gpu-boost',id:'GPU-a123',enabled:true};
    if(scenario==='success'){assert.match(await provider.command(command),/applied and verified/);assert.equal(state(),true);return;}
    if(scenario==='unsupported'){await assert.rejects(provider.command(command),/unavailable. Nothing changed/);assert.deepEqual(writes,[]);return;}
    await assert.rejects(provider.command(command),scenario==='restored'||scenario==='partial'?/Original GPU default restored and verified/:/Rollback incomplete or unverified/);
    assert.deepEqual(writes,[true,false]);assert.equal(state(),scenario==='ignored');
  });
}
