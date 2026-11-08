import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DemoProvider, WindowsProvider, validateCommand } from '../src/providers.js';
import { EcSlotWatch, FanProfiles, defaultProfiles, engineRows, firmwareThermalLimit, validateCurve } from '../src/fan-curves.js';

const ryzen = limit => ({ ryzen: { available: true, current: { temperatureLimit: limit }, baseline: { temperatureLimit: limit } } });
const levels = [55, 61, 66, 71, 76, 81, 85];

test('manual fan cutoff defaults to each laptop target and custom policy survives curve changes',async()=>{
  const profiles=new FanProfiles();
  assert.equal(profiles.view(ryzen(86),{active:1,rows:[[0,128]],manualTemperatureLimit:78}).manualTemperature.celsius,86);
  assert.equal(profiles.view({cpuSteps:{hardware:{thermalTargetC:95}}},{active:1,rows:[[0,128]]}).manualTemperature.celsius,95);
  const fresh=new FanProfiles();assert.equal(fresh.view({},null).manualTemperature.defaultCelsius,85);
  const provider=new DemoProvider();
  await provider.command(validateCommand({type:'fan-manual-limit',celsius:90}));
  await provider.command({type:'fan-profile-apply',id:'default-2'});
  await provider.command({type:'fan-profile-firmware'});
  assert.deepEqual((await provider.snapshot()).fanProfiles.manualTemperature,{automatic:false,celsius:90,defaultCelsius:85,engineCelsius:90});
  await provider.command({type:'fan-manual-limit',celsius:null});
  assert.equal((await provider.snapshot()).fanProfiles.manualTemperature.automatic,true);
  for(const value of [59,111,85.5,'90',undefined])assert.throws(()=>validateCommand({type:'fan-manual-limit',celsius:value}));
  assert.throws(()=>validateCommand({type:'fan-manual-limit',celsius:90,extra:true}));
});

test('live manual policy requires exact native read-back and cannot change an owned manual fan',async()=>{
  const provider=new WindowsProvider({platform:'win32',runner:async()=> '{}'});
  const curve={active:1,rows:[[0,128]],manualTemperatureLimit:78,manualTemperatureAutomatic:true};
  let mode='auto',ignore=false;const writes=[];
  provider.bridge={request:async(op,args)=>{
    if(op==='fan-manual-policy'){writes.push(args);if(!ignore){curve.manualTemperatureLimit=args.celsius;curve.manualTemperatureAutomatic=args.automatic;}return 'applied';}
    assert.equal(op,'snapshot');return {...ryzen(86),fanCurve:curve,fans:[{id:'tpfc/cooling-system',mode,capability:{available:true}}],sensors:[]};
  }};
  await provider.command({type:'fan-manual-limit',celsius:null});
  assert.deepEqual(writes,[{celsius:86,automatic:true}]);
  mode='manual';await assert.rejects(provider.command({type:'fan-manual-limit',celsius:90}),/Return the fan to firmware/);assert.equal(writes.length,1);
  mode='auto';ignore=true;await assert.rejects(provider.command({type:'fan-manual-limit',celsius:90}),/read-back mismatch/);
});

test('manual fan request synchronizes the machine cutoff before writing a fan level',async()=>{
  const provider=new WindowsProvider({platform:'win32',runner:async()=> '{}'});
  const calls=[],curve={active:1,rows:[[0,128]],manualTemperatureLimit:78,manualTemperatureAutomatic:true};
  let mode='auto',level=null;
  provider.bridge={request:async(op,args)=>{
    calls.push(op);
    if(op==='fan-manual-policy'){curve.manualTemperatureLimit=args.celsius;curve.manualTemperatureAutomatic=args.automatic;return 'applied';}
    if(op==='fan'){mode=args.mode;level=args.level;return {};}
    if(op==='lease')return {};
    assert.equal(op,'snapshot');return {...ryzen(86),fanCurve:curve,fans:[{id:'tpfc/cooling-system',controlUnit:'level',mode,level,capability:{available:true}}],sensors:[]};
  }};
  await provider.command({type:'fan',id:'tpfc/cooling-system',mode:'manual',level:64});
  assert.ok(calls.indexOf('fan-manual-policy')<calls.indexOf('fan'));
  await provider.command({type:'fan',id:'tpfc/cooling-system',mode:'manual',level:7});
  assert.equal(calls.filter(op=>op==='fan-manual-policy').length,1,'No engine restart while changing levels under an already synchronized policy');
});

test('the limit comes from each machine, and nothing is assumed without a reading', () => {
  assert.equal(firmwareThermalLimit(ryzen(86)).celsius, 86);
  assert.equal(firmwareThermalLimit(ryzen(95)).celsius, 95);
  assert.equal(firmwareThermalLimit({ ryzen: { available: true, current: { temperatureLimit: 90 }, baseline: { temperatureLimit: 86 } } }).celsius, 86, 'Raising a limit through tuning does not raise the firmware figure');
  assert.equal(firmwareThermalLimit({ ryzen: { available: false }, cpuSteps: { hardware: { thermalTargetC: 95 } } }).celsius, 95);
  assert.equal(firmwareThermalLimit({ ryzen: { available: false } }), null);
  assert.equal(firmwareThermalLimit(ryzen(20)), null, 'An implausible reading is not a limit');
});
test('default profiles fit every plausible limit', () => {
  for (let limit = 60; limit <= 110; limit++) for (const p of defaultProfiles(limit)) {
    validateCurve(p.levels, p.fanOff, limit);
    assert.ok(p.levels[6] < limit, 'The limit itself is maximum fan speed');
  }
  const [active, server] = defaultProfiles(86);
  assert.deepEqual([active.name, server.name], ['Computer active', 'Server inactive']);
  assert.equal(active.levels[6], 85, 'Level 7 starts just below the firmware limit by default');
  assert.ok(server.levels.every((temp, i) => temp < active.levels[i]), 'The server profile runs the fan sooner');
});
test('curves that are unsafe or malformed are refused', () => {
  assert.throws(() => validateCurve([55, 61, 66, 71, 76, 81, 86], true, 86), /firmware limit of 86/);
  assert.throws(() => validateCurve([55, 55, 66, 71, 76, 81, 85], true, 86), /higher temperature/);
  assert.throws(() => validateCurve([66, 67, 68, 71, 76, 81, 85], true, 86), /must start by 65/);
  assert.throws(() => validateCurve([20, 61, 66, 71, 76, 81, 85], true, 86), /below 30/);
  assert.throws(() => validateCurve(levels.slice(1), true, 86), /each of levels/);
  assert.throws(() => validateCurve(levels, true, null), /limit is unavailable/);
  validateCurve([66, 67, 68, 71, 76, 81, 85], false, 86);
});
test('engine rows rise to level 7, then maximum fan speed at the firmware limit', () => {
  assert.deepEqual(engineRows(levels, true, 86), [[50, 0], [55, 1], [61, 2], [66, 3], [71, 4], [76, 5], [81, 6], [85, 7], [86, 64]]);
  assert.deepEqual(engineRows(levels, false, 86)[0], [0, 1], 'With no stopping, level 1 applies from the bottom');
});
test('profiles can be created, renamed and deleted, and survive a restart', t => {
  const dir = mkdtempSync(join(tmpdir(), 'thinkpad-fan-')), file = join(dir, 'nested', 'profiles.json'); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = new FanProfiles(file);
  const made = first.save({ name: ' Night ', fanOff: true, levels }, 86);
  assert.equal(made.name, 'Night');
  first.save({ id: made.id, name: 'Overnight', fanOff: false, levels }, 86);
  const again = new FanProfiles(file);
  assert.deepEqual(again.list(86).map(p => p.name), ['Computer active', 'Server inactive', 'Overnight']);
  assert.throws(() => again.save({ name: 'overnight', fanOff: true, levels }, 86), /already uses/);
  assert.throws(() => again.save({ name: '', fanOff: true, levels }, 86), /name/);
  again.remove(made.id, 86);
  assert.equal(new FanProfiles(file).list(86).length, 2);
});
test('a saved profile above a lowered limit is flagged, not applied', async () => {
  const p = new DemoProvider(), before = (await p.snapshot()).fanProfiles, limit = before.limit.celsius;
  const saved = before.profiles[0];
  await p.command({ type: 'fan-profile-save', id: saved.id, name: saved.name, fanOff: saved.fanOff, levels: saved.levels });
  p.ryzenLimits.temperatureLimit = limit - 5;
  const view = (await p.snapshot()).fanProfiles;
  assert.equal(view.profiles[0].valid, false);
  await assert.rejects(p.command({ type: 'fan-profile-apply', id: saved.id }), /Edit this profile/);
});
test('commands apply, report and return to firmware', async () => {
  const p = new DemoProvider();
  let view = (await p.snapshot()).fanProfiles;
  assert.equal(view.available, true); assert.equal(view.curveSet, false); assert.equal(view.activeId, null);
  assert.match(await p.command({ type: 'fan-profile-apply', id: view.profiles[1].id }), /after a restart/);
  view = (await p.snapshot()).fanProfiles;
  assert.equal(view.activeId, view.profiles[1].id);
  await assert.rejects(p.command({ type: 'fan-profile-delete', id: view.activeId }), /Switch to another/);
  assert.match(await p.command({ type: 'fan-profile-firmware' }), /Firmware fan control/);
  assert.equal((await p.snapshot()).fanProfiles.curveSet, false);
});
test('a brief firmware read failure keeps the limit and the active profile', () => {
  const profiles = new FanProfiles(), engine = { active: 2, rows: engineRows(defaultProfiles(86)[0].levels, true, 86) };
  const good = profiles.view(ryzen(86), engine);
  assert.equal(good.activeId, 'default-1');
  const failed = profiles.view({ ryzen: { available: false, reason: 'Ryzen tuning unavailable: SMU operation failed' } }, engine);
  assert.equal(failed.available, true); assert.equal(failed.limit.celsius, 86); assert.equal(failed.activeId, 'default-1');
  assert.equal(new FanProfiles().view({ ryzen: { available: false } }, engine).available, false, 'With no reading yet, nothing is assumed');
});
test('without a readable limit, curves stay off', async () => {
  const p = new DemoProvider('intel'); const view = (await p.snapshot()).fanProfiles;
  assert.equal(view.available, false); assert.match(view.reason, /stay off/);
  await assert.rejects(p.command({ type: 'fan-profile-firmware' }), /stay off/);
});
test('the command schema accepts only these fields', () => {
  assert.ok(validateCommand({ type: 'fan-profile-firmware' }));
  assert.ok(validateCommand({ type: 'fan-profile-apply', id: 'a' }));
  assert.ok(validateCommand({ type: 'fan-profile-save', name: 'x', fanOff: true, levels }));
  for (const bad of [{ type: 'fan-profile-firmware', rows: [] }, { type: 'fan-profile-apply', id: 'a', rows: [] }, { type: 'fan-profile-save', name: 'x', fanOff: 1, levels }, { type: 'fan-profile-save', name: 'x', fanOff: true, levels, rows: [] }])
    assert.throws(() => validateCommand(bad));
});

const slots = (a, b) => [{ id: 'tpfc/ec/temperature/0', value: a }, { id: 'tpfc/ec/temperature/10', value: b }];
function watched(pairs, masks = []) {
  let time = 0; const watch = new EcSlotWatch(null, () => time);
  watch.observe([],null,masks);time=15000;
  for (const [cpu, slot0, slot10] of pairs) { watch.observe(slots(slot0, slot10), cpu, masks); time += 60000; }
  return watch;
}
test('a slot that stays flat while the CPU moves is lowered to below the curve', () => {
  const flat = watched([[70, 69, 65], [66, 65, 65], [62, 61, 65]]).flat();
  assert.deepEqual(flat, [{ slot: 10, value: 65, shift: 30 }]);
});
test('a slot is not called flat without enough evidence', () => {
  assert.deepEqual(watched([[66, 66, 65], [65, 65, 65], [64, 66, 65]]).flat(), [], 'The CPU has not moved enough');
  let time = 0; const quick = new EcSlotWatch(null, () => time);
  quick.observe(slots(69, 65), 70); time = 60000; quick.observe(slots(61, 65), 62);
  assert.deepEqual(quick.flat(), [], 'Too little time');
  assert.deepEqual(watched([[70, 65, 65], [62, 65, 65], [62, 65, 65]]).flat(), [], 'Nothing moves, so the readings prove nothing');
  assert.deepEqual(watched([[70, 69, 1], [62, 61, 1], [62, 61, 1]]).flat(), [], 'A low flat slot cannot hold the curve up');
  assert.deepEqual(watched([[70, 69, 65], [62, 61, 66], [62, 61, 68]]).flat(), [], 'A slot that moved is a real reading');
});
test('the CPU reference slot is never treated as flat', () => {
  const flat = watched([[70, 65, 69], [62, 65, 61], [62, 65, 61]]).flat();
  assert.deepEqual(flat, []);
});
test('history stays in real readings once the engine lowers a slot', () => {
  const masks = [[10, 30]], watch = watched([[70, 69, 35], [62, 61, 35], [62, 61, 35]], masks);
  assert.deepEqual(watch.flat(), [{ slot: 10, value: 65, shift: 30 }]);
  watch.observe(slots(61, 45), 62, masks);
  assert.deepEqual(watch.flat(), [], 'A lowered slot that heats up stops counting as flat');
});
test('the panel is told when the curve needs applying again', () => {
  const rows = engineRows(defaultProfiles(86)[0].levels, true, 86), p = new FanProfiles();
  const flat = [{ slot: 10, value: 65, shift: 30 }];
  assert.equal(p.view(ryzen(86), { active: 2, rows, masks: [] }, flat).reapply, true);
  assert.equal(p.view(ryzen(86), { active: 2, rows, masks: [[10, 30]] }, flat).reapply, false);
  assert.equal(p.view(ryzen(86), { active: 2, rows, masks: [[10, 30]] }, []).reapply, false, 'Missing learning evidence must preserve an existing adjustment');
  const moving=p.view(ryzen(86), { active: 2, rows, masks: [[10, 30]] }, [], [10]);
  assert.equal(moving.reapply,true,'Actual movement in fresh measurements recommends removal');
  assert.deepEqual(moving.recommendedMasks,[]);
  assert.equal(p.view(ryzen(86), { active: 1, rows: [[0, 128]], masks: [] }, flat).reapply, false);
  assert.equal(p.view(ryzen(86), { active: 2, rows, masks: [] }, flat).activeId, 'default-1', 'The profile is still running');
});

test('reopening with legacy mixed slot data does not recommend removing an installed adjustment',t=>{
  const directory=mkdtempSync(join(tmpdir(),'thinkpad-slot-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=join(directory,'slots');
  writeFileSync(file,JSON.stringify({10:{min:20,max:65,cpuMin:48,cpuMax:86,firstAt:0}}));
  let time=0;const watch=new EcSlotWatch(file,()=>time);
  const profiles=new FanProfiles(),engine={active:2,rows:engineRows(levels,true,86),masks:[[10,30]]};
  watch.observe(slots(60,35),61,engine.masks,engine);
  const view=profiles.view(ryzen(86),engine,watch.flat(),watch.moving());
  assert.equal(view.reapply,false);assert.deepEqual(view.recommendedMasks,[[10,30]]);
  assert.deepEqual(watch.flat(),[]);assert.deepEqual(watch.moving(),[]);
});

test('engine changes discard earlier measurements and wait for publication to settle',()=>{
  let time=0;const watch=new EcSlotWatch(null,()=>time);
  const original={active:2,rows:[[40,0],[78,7],[86,64]],masks:[[10,30]]};
  watch.observe(slots(69,35),70,original.masks,original);
  time=15000;watch.observe(slots(69,35),70,original.masks,original);
  time=75000;watch.observe(slots(61,35),62,original.masks,original);
  time=135000;watch.observe(slots(61,35),62,original.masks,original);
  assert.equal(watch.flat()[0].value,65);
  const firmware={active:1,rows:[[0,128]],masks:[]};
  watch.observe(slots(61,35),62,firmware.masks,firmware);
  assert.deepEqual(watch.flat(),[]);assert.deepEqual(watch.moving(),[]);
  time=149999;watch.observe(slots(60,20),61,firmware.masks,firmware);
  assert.deepEqual(watch.moving(),[],'Stale adjusted samples must not enter the new epoch');
  time=150000;watch.observe(slots(60,65),61,firmware.masks,firmware);
  time=210000;watch.observe(slots(54,65),55,firmware.masks,firmware);
  time=270000;watch.observe(slots(54,65),55,firmware.masks,firmware);
  assert.deepEqual(watch.flat(),[{slot:10,value:65,shift:30}]);
  watch.invalidate();assert.deepEqual(watch.flat(),[]);assert.deepEqual(watch.moving(),[]);
});

test('an adjusted sensor that really moves still recommends removal after a settled observation window',()=>{
  let time=0;const watch=new EcSlotWatch(null,()=>time),masks=[[10,30]];
  watch.observe([],null,masks);time=15000;watch.observe(slots(61,35),62,masks);
  time=75000;watch.observe(slots(65,39),66,masks);
  assert.deepEqual(watch.moving(),[],'Early differences are not a completed observation window');
  time=135000;watch.observe(slots(68,42),69,masks);
  assert.ok(watch.moving().includes(10));
  const view=new FanProfiles().view(ryzen(86),{active:2,rows:engineRows(levels,true,86),masks},watch.flat(),watch.moving());
  assert.equal(view.reapply,true);assert.deepEqual(view.removedSlots,[10]);assert.deepEqual(view.recommendedMasks,[]);
});

test('applying a profile keeps existing adjustments when a fresh learning epoch has no conclusion',async()=>{
  const provider=new DemoProvider();
  provider.fanCurve={active:2,rows:engineRows(levels,true,86),masks:[[10,30]]};
  await provider.command({type:'fan-profile-apply',id:'default-2'});
  assert.deepEqual(provider.fanCurve.masks,[[10,30]]);
  const changed=new FanProfiles().view(ryzen(86),{active:2,rows:engineRows(levels,true,86),masks:[[10,30]]},[{slot:10,value:66,shift:31}]);
  assert.equal(changed.reapply,true,'A changed adjustment amount must be compared as well as slot IDs');
});

test('firmware round-trip restores offsets after a provider restart without adjusting firmware readings',async()=>{
  const first=new DemoProvider();
  first.fanCurve={active:2,rows:engineRows(levels,true,86),masks:[[10,30]]};
  await first.command({type:'fan-profile-firmware'});
  assert.deepEqual(first.fanCurve.masks,[],'Firmware readings have no active correction');
  assert.deepEqual(first.fanCurve.dormantMasks,[[10,30]]);
  await first.command({type:'fan-profile-firmware'});
  const restarted=new DemoProvider();restarted.fanCurve=JSON.parse(JSON.stringify(first.fanCurve));
  await restarted.command({type:'fan-profile-apply',id:'default-2'});
  assert.deepEqual(restarted.fanCurve.masks,[[10,30]]);
  assert.deepEqual(restarted.fanCurve.dormantMasks,[]);
});

test('dormant offset restoration rejects invalid data and respects settled movement',()=>{
  const profiles=new FanProfiles(),engine={active:1,rows:[[0,128]],masks:[],dormantMasks:[[10,30],[0,30],[11,71],['2',20]]};
  assert.deepEqual(profiles.view(ryzen(86),engine).recommendedMasks,[[10,30]]);
  assert.deepEqual(profiles.view(ryzen(86),engine,[],[10]).recommendedMasks,[],'Fresh movement evidence still revokes a dormant offset');
});

test('profile application refuses success when the engine drops requested offsets',async()=>{
  const provider=new WindowsProvider({platform:'win32',runner:async()=> '{}'});
  let curve={active:1,rows:[[0,128]],masks:[],dormantMasks:[[10,30]]};
  provider.bridge={request:async(op,args)=>{
    if(op==='fan-curve'){curve={active:2,rows:args.rows,masks:[],dormantMasks:[]};return 'applied';}
    return {...ryzen(86),fanCurve:curve,fans:[{id:'tpfc/cooling-system',mode:curve.active===2?'curve':'auto',rpm:3000,capability:{available:true}}],sensors:[]};
  }};
  await assert.rejects(provider.command({type:'fan-profile-apply',id:'default-2'}),/sensor-offset read-back mismatch/);
});

test('live profile application retains the native adjustment and invalidates learning around worker writes',async()=>{
  const calls=[],curve={active:2,rows:engineRows(levels,true,86),masks:[[10,30]]};
  const provider=new WindowsProvider({platform:'win32',runner:async(file)=>file.endsWith('powershell.exe')?'{}':''});
  provider.bridge={request:async(op,args)=>{
    calls.push({op,args});
    if(op==='fan-curve'){
      assert.deepEqual(args.masks,[[10,30]]);
      assert.deepEqual(provider.slotWatch.slots,{},'No old measurements survive a configuration write');
      curve.rows=args.rows;curve.masks=args.masks;
      return 'applied';
    }
    assert.equal(op,'snapshot');
    return {...ryzen(86),fanCurve:curve,fans:[{id:'tpfc/cooling-system',mode:'curve',rpm:3000,capability:{available:true}}],sensors:[{group:'CPU',type:'Temperature',value:55},...slots(54,35)]};
  }};
  assert.equal((await provider.snapshot()).fanProfiles.reapply,false);
  await provider.command({type:'fan-profile-apply',id:'default-2'});
  assert.equal(calls.filter(c=>c.op==='fan-curve').length,1);
  assert.deepEqual((await provider.snapshot()).fanProfiles.recommendedMasks,[[10,30]]);
});
test('full speed is the only accepted level above 7', () => {
  assert.ok(validateCommand({ type: 'fan', id: 'f', mode: 'manual', level: 64 }));
  assert.ok(validateCommand({ type: 'fan', id: 'f', mode: 'manual', level: 7 }));
  for (const level of [0, 8, 63, 65, 128]) assert.throws(() => validateCommand({ type: 'fan', id: 'f', mode: 'manual', level }));
});

test('Max threshold persists, applies and reads back without changing legacy profiles', async () => {
  const provider=new DemoProvider(), initial=(await provider.snapshot()).fanProfiles;
  const levels=[40,45,50,55,60,65,70];
  const command={type:'fan-profile-save',name:'Earlier Max',fanOff:true,levels,maxTemp:75};
  validateCommand(command);await provider.command(command);
  const saved=(await provider.snapshot()).fanProfiles.profiles.find(p=>p.name==='Earlier Max');
  assert.equal(saved.maxTemp,75);
  await provider.command({type:'fan-profile-apply',id:saved.id});
  assert.deepEqual(provider.fanCurve.rows.at(-1),[75,64]);
  assert.equal((await provider.snapshot()).fanProfiles.activeId,saved.id);
  assert.deepEqual(engineRows(levels,true,85).at(-1),[85,64]);
  assert.throws(()=>validateCurve(levels,true,85,70),/Max fan mode/);
  assert.throws(()=>validateCurve(levels,true,85,86),/Max fan mode/);
  assert.throws(()=>validateCommand({...command,maxTemp:'75'}));
  const dir=mkdtempSync(join(tmpdir(),'thinkpad-max-'));
  try {const file=join(dir,'profiles.json');new FanProfiles(file).save(command,85);assert.equal(new FanProfiles(file).list(85).find(p=>p.name===command.name).maxTemp,75);}
  finally {rmSync(dir,{recursive:true,force:true});}
});
