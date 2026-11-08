import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCommand, DemoProvider, WindowsProvider } from '../src/providers.js';
import { buildCpuSteps, isMaxBoost } from '../src/cpu-steps.js';
import { buildCompatibilityReport } from '../src/compat-report.js';

const scheme = '3ee21118-1234-4321-9876-0a1b2c3d4e5f';
function provider({ failDc = false, mismatch = false, boostStateFile = null, available = true, hybrid = false, missingClass1 = false, missingFrequency = false, failClass1 = false, ignoreClass1 = false, mode = { ac: 0, dc: 0 }, epp = { ac: 60, dc: 60 }, eppClass1 = { ac: 35, dc: 75 } } = {}) {
  const policy = { PERFBOOSTMODE: { ...mode }, PERFEPP: { ...epp }, PERFEPP1: { ...eppClass1 }, PROCFREQMAX: { ac: 0, dc: 3500 } }, calls = [];
  let failed = false;
  const p = new WindowsProvider({ boostStateFile, runner: async (file, args) => {
    calls.push(args);
    if (args[0] === '/setacvalueindex' || args[0] === '/setdcvalueindex') {
      const source = args[0] === '/setacvalueindex' ? 'ac' : 'dc';
      if (source === 'dc' && failDc && !failed) { failed = true; throw new Error('Simulated write failure'); }
      if (args[3] === 'PERFEPP1' && failClass1 && !failed) { failed = true; throw new Error('Class-1 write refused'); }
      if (!mismatch && !(ignoreClass1 && args[3] === 'PERFEPP1')) policy[args[3]][source] = Number(args[4]);
    }
    return '';
  } });
  p.snapshot = async () => {
    const probe = { boost: { scheme, ...policy.PERFBOOSTMODE }, cpuPolicy: { scheme, maxFrequency: missingFrequency ? null : { ...policy.PROCFREQMAX }, epp: { ...policy.PERFEPP }, eppClass1: missingClass1 ? null : { ...policy.PERFEPP1 } } };
    return { capabilities: { cpuBoost: { available: true }, cpuMaxBoost: available ? { available: true } : { available: false, reason: 'Not exposed here' } }, boost: probe.boost, cpuSteps: buildCpuSteps(probe, { available:false, vendor:'GenuineIntel', hybrid }, null), gpus: [], fans: [] };
  };
  return { p, policy, calls };
}
const on = source => ({ type: 'cpu-max-boost', source, enabled: true }), off = source => ({ type: 'cpu-max-boost', source, enabled: false });

test('the command accepts only a source and a boolean', () => {
  assert.deepEqual(validateCommand(on('all')), on('all'));
  for (const bad of [{ type: 'cpu-max-boost', source: 'ac' }, { type: 'cpu-max-boost', source: 'ac', enabled: 1 }, { type: 'cpu-max-boost', source: 'other', enabled: true }, { ...on('ac'), epp: 0 }, { ...on('ac'), mode: 5 }])
    assert.throws(() => validateCommand(bad));
});
test('on sets aggressive mode and full performance for one source only', async () => {
  const { p, policy, calls } = provider();
  assert.match(await p.command(on('ac')), /Firmware still limits/);
  assert.deepEqual(policy.PERFBOOSTMODE, { ac: 2, dc: 0 }); assert.deepEqual(policy.PERFEPP, { ac: 0, dc: 60 });
  assert.deepEqual(policy.PROCFREQMAX, { ac: 0, dc: 3500 }, 'A speed limit must stay in force');
  assert.ok(!calls.some(a => a.includes('PROCTHROTTLEMIN')), 'The always-fast minimum state is deliberately never written');
  assert.ok((await p.snapshot()).cpuSteps.maxBoost.ac);
});

test('on while already on is a no-op and does not invent an earlier baseline',async()=>{
  const {p,calls}=provider({mode:{ac:2,dc:0},epp:{ac:0,dc:60}});
  assert.match(await p.command(on('ac')),/already on/);assert.equal(calls.length,0);assert.deepEqual(p.readBoostMemory(),{});
});

test('maximum boost does not depend on exposing an unrelated frequency-cap policy',async()=>{
  const {p,policy}=provider({missingFrequency:true});
  await p.command(on('ac'));assert.equal(policy.PERFBOOSTMODE.ac,2);assert.equal(policy.PERFEPP.ac,0);
  await p.command(off('ac'));assert.equal(policy.PERFBOOSTMODE.ac,0);assert.equal(policy.PERFEPP.ac,60);
});

test('unreviewed current boost indices refuse before saving or changing preferences',async()=>{
  const {p,calls}=provider({mode:{ac:99,dc:0}});
  await assert.rejects(p.command(on('ac')),/cannot be captured/);assert.equal(calls.length,0);assert.deepEqual(p.readBoostMemory(),{});
});
test('off restores the earlier values, including boost off', async () => {
  const { p, policy } = provider();
  await p.command(on('ac'));
  assert.match(await p.command(off('ac')), /Earlier settings restored/);
  assert.deepEqual(policy.PERFBOOSTMODE, { ac: 0, dc: 0 }); assert.deepEqual(policy.PERFEPP, { ac: 60, dc: 60 });
});
test('off while already off changes nothing, even with no saved values', async () => {
  const { p, policy, calls } = provider({ mode: { ac: 2, dc: 2 }, epp: { ac: 25, dc: 60 } });
  assert.match(await p.command(off('ac')), /already off/);
  assert.deepEqual(policy.PERFBOOSTMODE, { ac: 2, dc: 2 }); assert.deepEqual(policy.PERFEPP, { ac: 25, dc: 60 });
  assert.equal(calls.length, 0);
});
test('off for both sources leaves alone the one that is already off', async () => {
  const { p, policy } = provider({ mode: { ac: 1, dc: 2 }, epp: { ac: 40, dc: 25 } });
  await p.command(on('ac'));
  assert.match(await p.command(off('all')), /Earlier settings restored/);
  assert.deepEqual(policy.PERFBOOSTMODE, { ac: 1, dc: 2 }); assert.deepEqual(policy.PERFEPP, { ac: 40, dc: 25 });
});
test('turning on twice does not overwrite the saved values with maximum ones', async () => {
  const { p, policy } = provider();
  await p.command(on('ac')); await p.command(on('ac')); await p.command(off('ac'));
  assert.equal(policy.PERFBOOSTMODE.ac, 0); assert.equal(policy.PERFEPP.ac, 60);
});
test('earlier values survive an app restart through the saved file', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'thinkpad-boost-')), boostStateFile = join(dir, 'nested', 'state.json'); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = provider({ boostStateFile }); await first.p.command(on('dc'));
  const second = provider({ boostStateFile, mode: first.policy.PERFBOOSTMODE, epp: first.policy.PERFEPP });
  assert.match(await second.p.command(off('dc')), /Earlier settings restored/);
  assert.deepEqual(second.policy.PERFBOOSTMODE, { ac: 0, dc: 0 }); assert.deepEqual(second.policy.PERFEPP, { ac: 60, dc: 60 });
  assert.deepEqual(JSON.parse(readFileSync(boostStateFile, 'utf8')), {}, 'A restored value must not be reused later');
});
test('unknown or corrupt saved values fall back to standard boost and say so', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'thinkpad-boost-')), boostStateFile = join(dir, 'state.json'); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(boostStateFile, JSON.stringify({ [scheme]: { ac: { mode: 'x; whoami', epp: 999 } } }));
  const { p, policy } = provider({ boostStateFile, mode: { ac: 2, dc: 0 }, epp: { ac: 0, dc: 60 } });
  assert.match(await p.command(off('ac')), /standard boost/);
  assert.equal(policy.PERFBOOSTMODE.ac, 1); assert.equal(policy.PERFEPP.ac, 50);
});
test('a failed save refuses the change before any Windows write', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'thinkpad-boost-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'file'), 'x');
  const { p, policy, calls } = provider({ boostStateFile: join(dir, 'file', 'state.json') });
  await assert.rejects(p.command(on('ac')));
  assert.equal(policy.PERFBOOSTMODE.ac, 0); assert.equal(calls.length, 0);
});
test('a failed write restores every attempted source', async () => {
  const { p, policy } = provider({ failDc: true });
  await assert.rejects(p.command(on('all')), /Original boost settings restored/);
  assert.deepEqual(policy.PERFBOOSTMODE, { ac: 0, dc: 0 }); assert.deepEqual(policy.PERFEPP, { ac: 60, dc: 60 });
});
test('Windows read-back mismatch is an error', async () => {
  await assert.rejects(provider({ mismatch: true }).p.command(on('ac')), /read-back mismatch/);
});
test('an unavailable capability refuses before any write', async () => {
  const { p, calls } = provider({ available: false });
  await assert.rejects(p.command(on('ac')), /Not exposed here/); assert.equal(calls.length, 0);
});
test('the plain boost toggle leaves maximum boost first, so no preference stays behind', async () => {
  const { p, policy } = provider({ mode: { ac: 1, dc: 0 } });
  await p.command(on('ac'));
  await p.command({ type: 'cpu-boost', source: 'ac', enabled: false });
  assert.equal(policy.PERFBOOSTMODE.ac, 0); assert.equal(policy.PERFEPP.ac, 60);
});
test('both settings are needed to count as maximum boost', () => {
  assert.ok(isMaxBoost(2, 0)); assert.ok(!isMaxBoost(2, 60)); assert.ok(!isMaxBoost(1, 0));
});
test('demo mode simulates the toggle and restores boost off', async () => {
  const p = new DemoProvider(); await p.command(on('dc'));
  assert.equal((await p.snapshot()).cpuSteps.maxBoost.dc, true);
  await p.command(off('dc'));
  const s = await p.snapshot(); assert.equal(s.cpuSteps.maxBoost.dc, false); assert.equal(s.boost.dc, 0);
});
test('the compatibility report shows the state', async () => {
  const s = await new DemoProvider().snapshot();
  assert.deepEqual(buildCompatibilityReport(s).cpuSteps.maxBoost, { ac: false, dc: false });
});

test('hybrid Intel maximum boost changes both EPP classes and restores distinct AC/DC preferences', async () => {
  const {p, policy}=provider({hybrid:true});
  await p.command(on('all'));
  assert.deepEqual(policy.PERFEPP1,{ac:0,dc:0});
  assert.deepEqual((await p.snapshot()).cpuSteps.maxBoost,{ac:true,dc:true});
  await p.command(off('all'));
  assert.deepEqual(policy.PERFEPP1,{ac:35,dc:75});
  assert.deepEqual(policy.PERFEPP,{ac:60,dc:60});
  assert.deepEqual(policy.PERFBOOSTMODE,{ac:0,dc:0});
});

test('non-hybrid maximum boost never writes class-1 policy', async () => {
  const {p,calls,policy}=provider(); await p.command(on('ac')); await p.command(off('ac'));
  assert.ok(!calls.some(args=>args.includes('PERFEPP1')));
  assert.deepEqual(policy.PERFEPP1,{ac:35,dc:75});
});

test('missing hybrid EPP refuses before any write and partial maximum settings are not shown as enabled', async () => {
  const {p,calls}=provider({hybrid:true,missingClass1:true,mode:{ac:2,dc:0},epp:{ac:0,dc:60}});
  assert.equal((await p.snapshot()).cpuSteps.maxBoost.ac,false);
  await assert.rejects(p.command(on('ac')),/class-1.*unavailable/);
  assert.equal(calls.length,0);
});

test('hybrid class-1 refusal or ignored write rolls all attempted settings back', async () => {
  for(const options of [{failClass1:true},{ignoreClass1:true}]) {
    const {p,policy}=provider({hybrid:true,...options});
    await assert.rejects(p.command(on('all')),/Class-1 write refused|read-back mismatch/);
    assert.deepEqual(policy.PERFBOOSTMODE,{ac:0,dc:0});
    assert.deepEqual(policy.PERFEPP,{ac:60,dc:60});
    assert.deepEqual(policy.PERFEPP1,{ac:35,dc:75});
  }
});

test('hybrid preference baseline survives restart and stays in the compatibility report', async t => {
  const dir=mkdtempSync(join(tmpdir(),'thinkpad-hybrid-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const boostStateFile=join(dir,'state.json');
  const first=provider({hybrid:true,boostStateFile});await first.p.command(on('ac'));
  const second=provider({hybrid:true,boostStateFile,mode:first.policy.PERFBOOSTMODE,epp:first.policy.PERFEPP,eppClass1:first.policy.PERFEPP1});
  await second.p.command(off('ac'));
  assert.deepEqual(second.policy.PERFEPP1,{ac:35,dc:75});
  const report=buildCompatibilityReport(await second.p.snapshot());
  assert.deepEqual(report.cpuSteps.energyPreferenceClass1,{ac:35,dc:75});
});

test('upgrading a hybrid baseline from the older build preserves original boost/EPP values',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'thinkpad-hybrid-upgrade-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const boostStateFile=join(dir,'state.json');
  writeFileSync(boostStateFile,JSON.stringify({[scheme]:{ac:{mode:0,epp:60}}}));
  const {p,policy}=provider({hybrid:true,boostStateFile,mode:{ac:2,dc:0},epp:{ac:0,dc:60}});
  await p.command(on('ac')); await p.command(off('ac'));
  assert.equal(policy.PERFBOOSTMODE.ac,0);assert.equal(policy.PERFEPP.ac,60);assert.equal(policy.PERFEPP1.ac,35);
});

test('turning maximum off immediately after a legacy hybrid upgrade retains the original policy',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'thinkpad-hybrid-off-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const boostStateFile=join(dir,'state.json');
  writeFileSync(boostStateFile,JSON.stringify({[scheme]:{ac:{mode:0,epp:60}}}));
  const {p,policy}=provider({hybrid:true,boostStateFile,mode:{ac:2,dc:0},epp:{ac:0,dc:60},eppClass1:{ac:0,dc:75}});
  await p.command(off('ac'));
  assert.equal(policy.PERFBOOSTMODE.ac,0);assert.equal(policy.PERFEPP.ac,60);assert.deepEqual(policy.PERFEPP1,{ac:0,dc:75});
});
