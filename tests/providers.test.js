import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoProvider, WindowsProvider, parseNvidia, validateCommand } from '../src/providers.js';

test('command schema rejects shell-shaped payloads, unknown fields, unsafe fan speeds and missing booleans',()=>{
  for(const value of [null,[],{}, {type:'cpu-boost',source:'all',enabled:'true'}, {type:'cpu-boost',source:'ac',enabled:true,shell:'whoami'},
    {type:'fan',id:'cpu',mode:'manual',percent:0},{type:'fan',id:'cpu',mode:'manual',percent:70.5},
    {type:'fan',id:'cpu',mode:'auto',percent:100},{type:'gpu-boost',id:'x',enabled:null}]) assert.throws(()=>validateCommand(value));
  assert.deepEqual(validateCommand({type:'cpu-boost',source:'all',enabled:false}),{type:'cpu-boost',source:'all',enabled:false});
  assert.doesNotThrow(()=>validateCommand({type:'fan',id:'/gpu/0/control/0',mode:'manual',percent:30}));
  assert.doesNotThrow(()=>validateCommand({type:'fan',id:'tpfc/cooling-system',mode:'manual',level:7}));
  assert.throws(()=>validateCommand({type:'fan',id:'tpfc/cooling-system',mode:'manual',level:4,percent:50}));
});
test('NVIDIA parser preserves separate GPUs and missing readings',()=>{
  const result=parseNvidia('GPU-a123, NVIDIA RTX, 65, 20, 1600, 45.2, [N/A], 1234, 8192\nGPU-b456, NVIDIA RTX 2, [N/A], 0, 0, [N/A], 40, 0, 8192');
  assert.equal(result.length,2); assert.equal(result[0].fanPercent,null); assert.equal(result[1].temperature,null);
  assert.equal(result[0].power,45.2); assert.throws(()=>parseNvidia('-i;bad, GPU, 0'));
});
test('demo changes only requested power source and expires fan lease',async()=>{
  const p=new DemoProvider(); await p.command({type:'cpu-boost',source:'dc',enabled:true});
  assert.deepEqual((await p.snapshot()).boost,{ac:1,dc:1});
  await p.command({type:'cpu-boost',source:'all',enabled:false}); assert.deepEqual((await p.snapshot()).boost,{ac:0,dc:0});
  await p.command({type:'fan',id:'demo-cooling',mode:'manual',percent:75});
  assert.equal((await p.snapshot()).fans[0].mode,'manual'); p.leaseUntil=0;
  assert.equal((await p.snapshot()).fans[0].mode,'auto');
  await assert.rejects(p.command({type:'gpu-boost',id:'missing',enabled:true}));
});

test('Intel demo is explicitly simulated, has separate class policies and refuses Ryzen controls',async()=>{
  const p=new DemoProvider('intel');const before=await p.snapshot();
  assert.equal(before.mode,'demo');assert.equal(before.cpuSteps.vendor,'GenuineIntel');assert.equal(before.cpuSteps.hardware.hybrid,true);
  assert.deepEqual(before.cpuSteps.policy.class1,{ac:2800,dc:2200});assert.equal(before.gpus[0].vendor,'Intel');assert.match(before.cpu.name,/simulated/);
  await assert.rejects(p.command({type:'ryzen-tune',setting:'fastWatts',restore:false,value:20}),/do not apply/);
  await p.command({type:'cpu-step',source:'all',mhz:1600});assert.deepEqual((await p.snapshot()).cpuSteps.policy.class1,{ac:1600,dc:1600});
  await p.command({type:'cpu-step',source:'all',restore:true});assert.deepEqual((await p.snapshot()).cpuSteps.policy.class1,{ac:2800,dc:2200});
  await p.command({type:'cpu-max-boost',source:'ac',enabled:true});assert.equal((await p.snapshot()).cpuSteps.policy.eppClass1.ac,0);
  await p.command({type:'cpu-max-boost',source:'ac',enabled:false});assert.deepEqual((await p.snapshot()).cpuSteps.policy.eppClass1,{ac:35,dc:75});
  assert.throws(()=>new DemoProvider('unknown'));
});
function powerProvider({failDc=false,mismatch=false}={}) {
  const calls=[], boost={scheme:'3ee21118-1234-4321-9876-0a1b2c3d4e5f',ac:2,dc:4};
  let dcFailed=false;
  const p=new WindowsProvider({runner:async(file,args)=>{
    calls.push(args);
    if(args[0]?.startsWith('/set')&&args[0]!=='/setactive') {
      const source=args[0]==='/setacvalueindex'?'ac':'dc';
      if(source==='dc'&&failDc&&!dcFailed) { dcFailed=true; throw new Error('Simulated second write failure'); }
      if(!mismatch) boost[source]=Number(args.at(-1));
    }
    return '';
  }});
  p.snapshot=async()=>({capabilities:{cpuBoost:{available:true}},boost:{...boost},gpus:[],fans:[]});
  return {p,boost,calls};
}
test('overall CPU boost writes and verifies both sources using the same explicit plan',async()=>{
  const {p,boost,calls}=powerProvider();
  await p.command({type:'cpu-boost',source:'all',enabled:false});
  assert.equal(boost.ac,0); assert.equal(boost.dc,0);
  assert.deepEqual(calls.map(x=>x[0]),['/setacvalueindex','/setdcvalueindex','/setactive']);
  assert.ok(calls.every(x=>x[1]===boost.scheme));
});
test('second-write failure restores original numeric policy indices, including aggressive modes',async()=>{
  const {p,boost}=powerProvider({failDc:true});
  await assert.rejects(p.command({type:'cpu-boost',source:'all',enabled:false}),/Original boost indices restored/);
  assert.equal(boost.ac,2); assert.equal(boost.dc,4);
});
test('CPU read-back mismatch is an error even if command process succeeds',async()=>{
  const {p}=powerProvider({mismatch:true});
  await assert.rejects(p.command({type:'cpu-boost',source:'ac',enabled:false}),/read-back mismatch/);
});
test('unavailable GPU and fan reject without executing writes',async()=>{
  let writes=0;
  const p=new WindowsProvider({runner:async()=>{writes++;}});
  p.snapshot=async()=>({gpus:[{id:'amd',boostCapability:{available:false,reason:'unsupported APU'}}],fans:[]});
  await assert.rejects(p.command({type:'gpu-boost',id:'amd',enabled:true}),/unsupported APU/);
  await assert.rejects(p.command({type:'fan',id:'missing',mode:'auto'}),/No supported/);
  assert.equal(writes,0);
});

test('Intel inventory preserves integrated/discrete identity and does not duplicate trademark variants',async()=>{
  const p=new WindowsProvider({platform:'win32',runner:async(file,args)=>{
    if(args.includes('-File'))return JSON.stringify({cpu:{Name:'Intel Core Ultra',Manufacturer:'GenuineIntel'},gpus:[
      {Name:'Intel(R) Iris(R) Xe Graphics',PNPDeviceID:'PCI-integrated'},
      {Name:'Intel Arc A370M',PNPDeviceID:'PCI-discrete'}],warnings:[]});
    throw new Error('No NVIDIA driver');
  }});
  p.bridge={request:async()=>({cpuStates:{available:false,vendor:'GenuineIntel',hybrid:true},gpus:[{id:'intel-integrated',name:'Intel Iris Xe Graphics',vendor:'Intel',temperature:48}],fans:[],sensors:[]})};
  const snapshot=await p.snapshot();
  assert.equal(snapshot.gpus.length,2);
  assert.deepEqual(snapshot.gpus.map(g=>g.vendor),['Intel','Intel']);
  assert.equal(snapshot.gpus[0].temperature,48);
  assert.equal(snapshot.gpus[1].temperature,null);
  assert.match(snapshot.gpus[0].boostCapability.reason,/Intel GPU/);
  assert.equal(snapshot.cpuSteps.vendor,'GenuineIntel');
  assert.equal(snapshot.capabilities.cpuMaxBoost.available,false);
});
test('live Windows adapter degrades gracefully when inventory and drivers are absent',async()=>{
  const p=new WindowsProvider({platform:'win32',runner:async()=>{throw new Error('access denied');}});
  const s=await p.snapshot(); assert.equal(s.mode,'live'); assert.equal(s.cpu.temperature,null);
  assert.equal(s.boost,null); assert.equal(s.capabilities.cpuBoost.available,false); assert.equal(s.fans.length,0); assert.ok(s.warnings.length);
});
test('synchronous worker launch denial preserves Windows inventory and available power policy',async()=>{
  const p=new WindowsProvider({platform:'win32',runner:async(file,args)=>{
    if(args.includes('-File'))return JSON.stringify({machine:{Manufacturer:'LENOVO',Model:'T14s'},cpu:{Name:'Ryzen',LoadPercentage:12},gpus:[],boost:{scheme:'plan',ac:0,dc:2},warnings:[]});
    throw new Error('No NVIDIA driver');
  }});
  p.bridge={request(){throw new Error('Application Control blocked the hardware worker');}};
  const s=await p.snapshot();assert.equal(s.machine.model,'T14s');assert.equal(s.cpu.load,12);
  assert.equal(s.capabilities.cpuBoost.available,true);assert.equal(s.cpu.temperature,null);
  assert.ok(s.warnings.some(w=>w.includes('Application Control')));
});

test('missing Intel identity keeps standard boost available without pretending class-aware controls are complete',async()=>{
  const p=new WindowsProvider({platform:'win32',runner:async(file,args)=>{
    if(args.includes('-File'))return JSON.stringify({cpu:{Name:'Intel Core',Manufacturer:'GenuineIntel'},boost:{scheme:'plan',ac:0,dc:0},cpuPolicy:{scheme:'plan',maxFrequency:{ac:0,dc:3500},maxFrequencyClass1:{ac:2800,dc:2200},epp:{ac:60,dc:60},eppClass1:{ac:35,dc:75}},warnings:[]});
    throw new Error('No NVIDIA driver');
  }});
  let snapshot=await p.snapshot();assert.equal(snapshot.capabilities.cpuBoost.available,true);
  assert.equal(snapshot.capabilities.cpuStep.available,false);assert.equal(snapshot.capabilities.cpuMaxBoost.available,false);
  assert.match(snapshot.capabilities.cpuMaxBoost.reason,/processor identity/);
  p.bridge={request:async()=>({cpuStates:{available:false,vendor:'GenuineIntel',hybrid:true},sensors:[],fans:[]})};
  snapshot=await p.snapshot();assert.equal(snapshot.capabilities.cpuStep.available,true);assert.equal(snapshot.capabilities.cpuMaxBoost.available,true);
});
test('GPU write targets a stable UUID and verifies the default policy',async()=>{
  const calls=[]; const p=new WindowsProvider({runner:async(f,args)=>{calls.push(args);return 'Disabled';}});
  p.snapshot=async()=>({gpus:[{id:'GPU-a123',boostCapability:{available:true}}]});
  await p.command({type:'gpu-boost',id:'GPU-a123',enabled:false});
  assert.ok(calls[0].includes('--query-gpu=auto_boost.default'));
  assert.deepEqual(calls[1],['-i','GPU-a123','--auto-boost-default=0']);
  assert.ok(calls[2].includes('--query-gpu=auto_boost.default'));
});
test('TPFanCtrl2 commands use discrete levels and verify observed level, not a percentage',async()=>{
  const p=new WindowsProvider({runner:async()=>''});let mode='auto',level=null;
  p.snapshot=async()=>({fans:[{id:'tpfc/cooling-system',controlUnit:'level',capability:{available:true}}]});
  const requests=[];
  p.bridge={request:async(op,args)=>{
    requests.push({op,args});if(op==='fan'){mode=args.mode;level=args.level??null;}
    return {fans:[{id:'tpfc/cooling-system',mode,level}]};
  }};
  await p.command({type:'fan',id:'tpfc/cooling-system',mode:'manual',level:5});
  assert.equal(requests.find(r=>r.op==='fan').args.level,5);
  await assert.rejects(p.command({type:'fan',id:'tpfc/cooling-system',mode:'manual',percent:50}),/unit does not match/);
});

function fanFailureProvider({readback,clock=()=>performance.now(),failRecovery=false,failWrite=false}) {
  const requests=[];
  const p=new WindowsProvider({runner:async()=>'',monotonicNow:clock});
  p.snapshot=async()=>({fans:[{id:'tpfc/cooling-system',controlUnit:'level',capability:{available:true}}]});
  p.bridge={request:async(op,args)=>{
    requests.push({op,args});
    if(op==='fan'&&args.mode==='manual'&&failWrite)throw new Error('Write transport failed');
    if(op==='fan'&&args.mode==='auto'&&failRecovery)throw new Error('Recovery pipe closed');
    if(op==='snapshot')return readback();
    return {ok:true};
  }};
  return {p,requests};
}
const manualFan={type:'fan',id:'tpfc/cooling-system',mode:'manual',level:5};

test('fan read-back failure requests firmware after a possibly successful manual write',async()=>{
  const {p,requests}=fanFailureProvider({readback:()=>{throw new Error('Sensor refresh failed');}});
  await assert.rejects(p.command(manualFan),/Sensor refresh failed.*Firmware recovery requested/);
  assert.deepEqual(requests.filter(r=>r.op==='fan').map(r=>r.args.mode),['manual','auto']);
});

test('ambiguous fan write failure also attempts firmware recovery',async()=>{
  const {p,requests}=fanFailureProvider({failWrite:true});
  await assert.rejects(p.command(manualFan),/Write transport failed.*Firmware recovery requested/);
  assert.deepEqual(requests.filter(r=>r.op==='fan').map(r=>r.args.mode),['manual','auto']);
});

test('failed fan recovery is surfaced without claiming a successful firmware request',async()=>{
  const {p}=fanFailureProvider({readback:()=>{throw new Error('Sensor refresh failed');},failRecovery:true});
  await assert.rejects(p.command(manualFan),/Sensor refresh failed.*Firmware recovery could not be sent/);
});

test('fan verification deadline survives a backward civil-clock adjustment',async t=>{
  let elapsed=0;
  const wall=Date.now();
  const {p,requests}=fanFailureProvider({clock:()=>elapsed,readback:()=>{
    elapsed=16000;t.mock.method(Date,'now',()=>wall-86400000);
    return {fans:[{id:manualFan.id,mode:'manual',level:2}]};
  }});
  await assert.rejects(p.command(manualFan),/Fan read-back mismatch.*Firmware recovery requested/);
  assert.deepEqual(requests.filter(r=>r.op==='fan').map(r=>r.args.mode),['manual','auto']);
});
test('firmware zones remain separate from motherboard sensors and preserve GPU identity',async()=>{
  const p=new WindowsProvider({platform:'win32',runner:async(file,args)=>{
    if(args.includes('-File'))return JSON.stringify({machine:{Model:'T14s'},cpu:{Name:'Ryzen'},gpus:[],warnings:[]});
    throw new Error('No NVIDIA driver');
  }});
  const sensors=[{group:'Firmware',type:'Temperature',name:'ACPI\\ThermalZone\\TZ01_0',value:67.05},
    {group:'APU',type:'Temperature',name:'GFX temperature',value:61.25}];
  p.bridge={request:async()=>({sensors,gpus:[{id:'apu',vendor:'AMD',name:'Radeon',temperature:61.25},{id:'discrete',vendor:'AMD',name:'RX',temperature:null}]})};
  let s=await p.snapshot();assert.equal(s.motherboard.temperature,null);assert.equal(s.firmware.temperature,67.05);
  assert.equal(s.firmware.zone,'ACPI\\ThermalZone\\TZ01_0');assert.equal(s.gpus[0].temperature,61.25);assert.equal(s.gpus[1].temperature,null);
  sensors[0].value=null;s=await p.snapshot();assert.equal(s.firmware.temperature,null);assert.equal(s.firmware.zone,null);
});

test('Ryzen command schema bounds settings and never accepts raw mailbox payloads',()=>{
  for(const setting of ['sustainedWatts','fastWatts','slowWatts','temperatureLimit'])assert.doesNotThrow(()=>validateCommand({type:'ryzen-tune',setting,restore:true}));
  assert.doesNotThrow(()=>validateCommand({type:'ryzen-tune',setting:'sustainedWatts',value:18.5,restore:false}));
  for(const c of [{setting:'raw',value:1},{setting:'fastWatts',value:101},{setting:'temperatureLimit',value:111},{setting:'temperatureLimit',value:80.5},{setting:'slowWatts',value:12.34},{setting:'fastWatts',value:NaN},{setting:'slowWatts',value:20,command:0x16}])assert.throws(()=>validateCommand({type:'ryzen-tune',restore:false,...c}));
  assert.throws(()=>validateCommand({type:'ryzen-tune',setting:'fastWatts',restore:true,value:20}));
});
test('Ryzen demo changes and restores one field only',async()=>{
  const p=new DemoProvider();await p.command({type:'ryzen-tune',setting:'fastWatts',value:30,restore:false});let s=await p.snapshot();assert.equal(s.ryzen.current.fastWatts,30);assert.equal(s.ryzen.current.sustainedWatts,15);
  await p.command({type:'ryzen-tune',setting:'fastWatts',restore:true});assert.equal((await p.snapshot()).ryzen.current.fastWatts,25);
});
test('Ryzen live provider refuses unsupported hardware and forwards only structured supported changes',async()=>{
  const p=new WindowsProvider();let writes=[];p.bridge={request:async(...args)=>{writes.push(args);return 'verified';}};
  p.snapshot=async()=>({ryzen:{available:false,reason:'Unsupported model'}});await assert.rejects(p.command({type:'ryzen-tune',setting:'fastWatts',value:25,restore:false}),/Unsupported model/);assert.equal(writes.length,0);
  p.snapshot=async()=>({ryzen:{available:true}});await p.command({type:'ryzen-tune',setting:'fastWatts',value:25,restore:false});assert.deepEqual(writes,[['ryzen-tune',{setting:'fastWatts',restore:false,value:25}]]);
  p.snapshot=async()=>({ryzen:{available:true,ranges:{fastWatts:{min:5,max:40}}}});await assert.rejects(p.command({type:'ryzen-tune',setting:'fastWatts',value:41,restore:false}),/from 5 to 40/);assert.equal(writes.length,1,'A value above this machine range must not reach the worker');
  p.snapshot=async()=>({ryzen:{available:true,ranges:{fastWatts:{min:5,max:65}}}});await p.command({type:'ryzen-tune',setting:'fastWatts',value:60,restore:false});assert.equal(writes.length,2,'A higher-power machine may use its own higher range');
});

test('read-only Ryzen fields reject both custom and baseline requests before contacting firmware',async()=>{
  let calls=0;const p=new WindowsProvider();p.bridge={request:async()=>{calls++;}};
  p.snapshot=async()=>({ryzen:{available:true,fields:{sustainedWatts:{available:false,restoreAvailable:false,reason:'STAPM read-only'}}}});
  await assert.rejects(p.command({type:'ryzen-tune',setting:'sustainedWatts',value:24,restore:false}),/read-only/);
  await assert.rejects(p.command({type:'ryzen-tune',setting:'sustainedWatts',restore:true}),/read-only/);assert.equal(calls,0);
});
