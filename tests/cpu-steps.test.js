import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stepLadder, buildCpuSteps } from '../src/cpu-steps.js';
import { validateCommand, DemoProvider, WindowsProvider } from '../src/providers.js';
import { buildCompatibilityReport } from '../src/compat-report.js';

const hardware = (states, extra = {}) => ({ available: true, states: states.map((mhz, i) => ({ label: 'P' + i, mhz })), ...extra });

test('three or more hardware states are used exactly, fastest first', () => {
  assert.deepEqual(stepLadder(hardware([1400, 2300, 1800]), 2301), [2300, 1800, 1400]);
});
test('Intel base and minimum are interpolated without inventing a value outside them', () => {
  const ladder = stepLadder(hardware([2600, 800]), 2600);
  assert.equal(ladder[0], 2600); assert.equal(ladder.at(-1), 800); assert.ok(ladder.length >= 3);
});
test('without hardware access, steps still come from the rated base on any vendor', () => {
  const ladder = stepLadder({ available: false, reason: 'Enable hardware access' }, 2100);
  assert.equal(ladder[0], 2100); assert.ok(ladder.every(mhz => mhz >= 800 && mhz <= 2100)); assert.ok(ladder.length >= 3);
});
test('no usable frequency gives no steps rather than a guess', () => {
  assert.deepEqual(stepLadder(null, null), []);
  assert.deepEqual(stepLadder(hardware([100, 90000]), 0), []);
});
test('AMD CPPC values add boost limits but never offer the unreliable calculated top', () => {
  const ladder = stepLadder(hardware([2300, 1800, 1600], { cppc: { highest: 186, nominal: 89, lowestNonlinear: 43, lowest: 16 } }), 2301);
  assert.deepEqual(ladder, [4000, 3100, 2300, 1800, 1600], 'Matches the 5650U reading; 4807 must not appear');
});
test('a real reported ceiling, as on Intel, adds evenly spaced limits and itself', () => {
  assert.deepEqual(stepLadder(hardware([2300, 1800, 1600], { boostMhz: 4200 }), 2301), [4200, 3600, 2900, 2300, 1800, 1600]);
  assert.deepEqual(stepLadder(hardware([2600, 800], { boostMhz: 4400 }), 2600).slice(0, 4), [4400, 3800, 3200, 2600]);
});
test('a missing, implausible or too-low ceiling adds nothing', () => {
  const base = [2300, 1800, 1600];
  for (const boostMhz of [undefined, null, 0, 90000, 2300, 2000, '4200']) assert.deepEqual(stepLadder(hardware(base, { boostMhz }), 2301), base);
  assert.deepEqual(stepLadder({ available: false, boostMhz: 4200, states: [] }, 2100)[0], 2100, 'An unavailable hardware read is not trusted');
});
test('the report carries the boost ceiling and its raw inputs for review', () => {
  const steps = buildCpuSteps({ cpu: { MaxClockSpeed: 2301 }, cpuPolicy: { scheme: 'a', maxFrequency: { ac: 0, dc: 0 } } }, hardware([2300, 1800, 1600], { boostMhz: 4200, cppc: { highest: 183, nominal: 100, lowestNonlinear: 41, lowest: 17, extra: 'private' }, turboByActiveCores: [] }));
  const h = buildCompatibilityReport({ mode: 'live', cpuSteps: steps }).cpuSteps.hardware;
  assert.equal(h.boostMhz, 4200); assert.deepEqual(h.cppc, { highest: 183, nominal: 100, lowestNonlinear: 41, lowest: 17 });
  assert.ok(!JSON.stringify(h).includes('private'));
});
test('step commands accept no limit or a bounded integer and reject everything else', () => {
  assert.deepEqual(validateCommand({ type: 'cpu-step', source: 'all', mhz: 0 }), { type: 'cpu-step', source: 'all', mhz: 0 });
  assert.doesNotThrow(() => validateCommand({ type: 'cpu-step', source: 'dc', mhz: 1800 }));
  for (const bad of [{ type: 'cpu-step', source: 'ac', mhz: 799 }, { type: 'cpu-step', source: 'ac', mhz: 8001 }, { type: 'cpu-step', source: 'ac', mhz: 1800.5 },
    { type: 'cpu-step', source: 'ac', mhz: '1800' }, { type: 'cpu-step', source: 'other', mhz: 1800 }, { type: 'cpu-step', source: 'ac', mhz: 1800, vid: 40 }, { type: 'cpu-step', source: 'ac' }])
    assert.throws(() => validateCommand(bad));
});

function provider({ failDc = false, mismatch = false, hybrid = false, absent = false, class1 = {ac:0,dc:0} } = {}) {
  const scheme = '3ee21118-1234-4321-9876-0a1b2c3d4e5f', calls = [];
  const policy = { PROCFREQMAX: { ac: 0, dc: 3500 }, PROCFREQMAX1: {...class1} };
  const baseline={...policy.PROCFREQMAX,class1:{...class1}};
  let failed = false;
  const p = new WindowsProvider({ runner: async (file, args) => {
    calls.push(args);
    if (args[0] === '/setacvalueindex' || args[0] === '/setdcvalueindex') {
      const source = args[0] === '/setacvalueindex' ? 'ac' : 'dc';
      if (source === 'dc' && failDc && !failed) { failed = true; throw new Error('Simulated second write failure'); }
      if (!mismatch) policy[args[3]][source] = Number(args[4]);
    }
    return '';
  } });
  p.snapshot = async () => ({ capabilities: { cpuStep: absent ? { available: false, reason: 'No policy here' } : { available: true } }, gpus: [], fans: [],
    cpuSteps: { hardware: { hybrid }, baseline, policy: { scheme, ...policy.PROCFREQMAX, class1: { ...policy.PROCFREQMAX1 } } } });
  return { p, policy, calls };
}

test('a step writes only the requested source and leaves a pre-existing battery cap alone', async () => {
  const { p, policy, calls } = provider();
  assert.match(await p.command({ type: 'cpu-step', source: 'ac', mhz: 1600 }), /1600 MHz/);
  assert.deepEqual(policy.PROCFREQMAX, { ac: 1600, dc: 3500 });
  assert.deepEqual(policy.PROCFREQMAX1, { ac: 0, dc: 0 }, 'Non-hybrid CPUs keep efficiency class 1 untouched');
  assert.deepEqual(calls.map(x => x[0]), ['/setacvalueindex', '/setactive']);
});

test('hybrid undo restores differing original class limits rather than applying the class-0 value twice',async()=>{
  const {p,policy}=provider({hybrid:true,class1:{ac:2800,dc:2200}});
  await p.command({type:'cpu-step',source:'all',mhz:1600});
  await p.command(validateCommand({type:'cpu-step',source:'all',restore:true}));
  assert.deepEqual(policy.PROCFREQMAX,{ac:0,dc:3500});
  assert.deepEqual(policy.PROCFREQMAX1,{ac:2800,dc:2200});
});

test('frequency restore requires a complete baseline and rejects mixed restore/set payloads',async()=>{
  for(const command of [{type:'cpu-step',source:'ac',restore:true,mhz:1600},{type:'cpu-step',source:'ac',restore:false}])assert.throws(()=>validateCommand(command));
  const {p,calls}=provider({hybrid:true});const snapshot=p.snapshot;
  p.snapshot=async()=>{const state=await snapshot();delete state.cpuSteps.baseline.class1;return state;};
  await assert.rejects(p.command({type:'cpu-step',source:'ac',restore:true}),/baseline/);
  assert.equal(calls.length,0);
});

test('hybrid frequency changes refuse before any write when Windows lacks the second class',async()=>{
  const {p,calls}=provider({hybrid:true});const snapshot=p.snapshot;
  p.snapshot=async()=>{const state=await snapshot();state.cpuSteps.policy.class1=null;return state;};
  await assert.rejects(p.command({type:'cpu-step',source:'all',mhz:1600}),/class-1 frequency policy is unavailable/);
  assert.equal(calls.length,0);
});
test('Intel hybrid CPUs cap both efficiency classes', async () => {
  const { p, policy } = provider({ hybrid: true });
  await p.command({ type: 'cpu-step', source: 'all', mhz: 2000 });
  assert.deepEqual(policy.PROCFREQMAX, { ac: 2000, dc: 2000 }); assert.deepEqual(policy.PROCFREQMAX1, { ac: 2000, dc: 2000 });
});
test('a failed second write restores the captured values, not zero', async () => {
  const { p, policy } = provider({ failDc: true });
  await assert.rejects(p.command({ type: 'cpu-step', source: 'all', mhz: 1600 }), /Original frequency policy restored/);
  assert.deepEqual(policy.PROCFREQMAX, { ac: 0, dc: 3500 });
});
test('Windows read-back mismatch is an error even when powercfg succeeds', async () => {
  await assert.rejects(provider({ mismatch: true }).p.command({ type: 'cpu-step', source: 'ac', mhz: 1600 }), /read-back mismatch/);
});
test('an unavailable policy refuses before any write', async () => {
  const { p, calls } = provider({ absent: true });
  await assert.rejects(p.command({ type: 'cpu-step', source: 'ac', mhz: 1600 }), /No policy here/);
  assert.equal(calls.length, 0);
});
test('baseline only applies to the plan it was captured from', () => {
  const probe = { cpu: { MaxClockSpeed: 2301 }, cpuPolicy: { scheme: 'a', maxFrequency: { ac: 0, dc: 3500 } } };
  assert.deepEqual(buildCpuSteps(probe, null, { scheme: 'a', ac: 0, dc: 3500 }).baseline, { ac: 0, dc: 3500 });
  assert.equal(buildCpuSteps(probe, null, { scheme: 'b', ac: 0, dc: 0 }).baseline, null);
});
test('demo steps change one source and stay simulated', async () => {
  const p = new DemoProvider(); await p.command({ type: 'cpu-step', source: 'dc', mhz: 1800 });
  const { policy, ladder } = (await p.snapshot()).cpuSteps;
  assert.equal(policy.dc, 1800); assert.equal(policy.ac, 0); assert.deepEqual(ladder, [4000, 3100, 2300, 1800, 1400]);
});
test('the compatibility report carries hardware states and refusals without unlisted data', () => {
  const steps = buildCpuSteps({ cpu: { MaxClockSpeed: 2301, Manufacturer: 'AuthenticAMD' }, cpuPolicy: { scheme: 'secret-scheme', maxFrequency: { ac: 0, dc: 3500 } } }, hardware([2300, 1800, 1400], { source: 'AMD P-state MSRs', family: 0x19, model: 80, cppcEnabled: true, vendor: 'AuthenticAMD', rawRegister: 'private' }));
  const r = buildCompatibilityReport({ mode: 'live', cpuSteps: steps, capabilities: { cpuStep: { available: true } } });
  assert.deepEqual(r.cpuSteps.policyMaxMhz, { ac: 0, dc: 3500 }); assert.equal(r.cpuSteps.hardware.family, 0x19);
  assert.deepEqual(r.cpuSteps.hardware.states.map(s => s.mhz), [2300, 1800, 1400]); assert.equal(r.cpuSteps.controlAvailable, true);
  const text = JSON.stringify(r); assert.ok(!text.includes('secret-scheme')); assert.ok(!text.includes('private'));
  const refused = buildCompatibilityReport({ mode: 'live', cpuSteps: { hardware: { available: false, reason: 'No reviewed P-state layout for AMD family 0x15.' } } });
  assert.match(refused.cpuSteps.hardware.reason, /0x15/); assert.equal(refused.cpuSteps.hardware.status, 'unavailable');
});

test('the report records GPU temperature availability without assuming a value exists', () => {
  const r = buildCompatibilityReport({ mode: 'live', gpus: [{ name: 'AMD Radeon', vendor: 'AMD', temperature: 55, serial: 'private' }, { name: 'Other', vendor: 'AMD', temperature: null }] });
  assert.deepEqual(r.gpus, [{ name: 'AMD Radeon', vendor: 'AMD', temperatureAvailable: true }, { name: 'Other', vendor: 'AMD', temperatureAvailable: false }]);
});

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
test('advanced Ryzen tuning appears only with AMD identity and a Ryzen CPU, never Intel or unknown CPUs', () => {
  const context=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function showRyzenTuning('),source.indexOf('function advancedCpuTuning(')),context);
  const visible=(vendor,name)=>context.showRyzenTuning({cpuSteps:{vendor},cpu:{name}});
  assert.equal(visible('AuthenticAMD','AMD Ryzen 5 PRO 5650U'),true);
  assert.equal(visible('Advanced Micro Devices, Inc.','AMD Ryzen 7 PRO'),true);
  assert.equal(visible('GenuineIntel','Intel Core Ultra 7'),false);
  assert.equal(visible('AuthenticAMD','AMD A10'),false);
  assert.equal(visible(null,'Unknown processor'),false);
  assert.equal(visible(null,'AMD Ryzen 5'),false);
  assert.equal(context.showCpuTuning({cpuSteps:{vendor:'GenuineIntel'}}),true);
  assert.equal(context.showCpuTuning({cpuSteps:{vendor:'AuthenticAMD'},cpu:{name:'AMD Ryzen 5'}}),true);
  assert.equal(context.showCpuTuning({cpuSteps:{vendor:'AuthenticAMD'},cpu:{name:'AMD A10'}}),false);
  assert.match(source,/showCpuTuning\(s\)\?\[advancedCpuTuning\(\)\]:\[\]/);
});
function node(tag, text) { return { tag, text, children: [], value: '', disabled: false, classList: { add() {} }, append(...children) { this.children.push(...children); }, setAttribute() {}, addEventListener() {} }; }
test('the steps panel renders with hardware states, without them, and when unavailable', async () => {
  const snapshot = await new DemoProvider().snapshot();
  const context = vm.createContext({ state: { snapshot, busy: false, stale: false }, Map, Set, Number, String, Boolean, Math,
    el: (tag, cls, text) => node(tag, text), panel: () => node('panel'), append: (parent, ...children) => { parent.append(...children.filter(Boolean)); return parent; },
    button: text => node('button', text), command: () => { throw new Error('Rendering must not issue commands'); } });
  vm.runInContext(source.slice(source.indexOf('function stepChoice('), source.indexOf('function ryzenPanel()')), context);
  assert.ok(vm.runInContext('stepsPanel().children.length', context) >= 4);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(stepChoice(1800,state.snapshot.cpuSteps.hardware))', context)), { title: 'P1', detail: '1800 MHz' }, 'A hardware step shows its real P-state label');
  assert.equal(vm.runInContext('stepChoice(1234,state.snapshot.cpuSteps.hardware).title', context), '1234 MHz', 'An interpolated step must not claim a P-state label');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(stepChoice(3100,state.snapshot.cpuSteps.hardware))', context)), { title: 'Boost', detail: 'Up to 3100 MHz' });
  assert.equal(snapshot.cpuSteps.hardware.boostMhz, undefined, 'AMD reports no ceiling');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(stepChoice(4400,{available:true,boostMhz:4400,states:[{label:\'Base\',mhz:2600}]}))', context)), { title: 'Max boost', detail: '4400 MHz' });
  snapshot.cpu.power = 18; snapshot.ryzen.current.slowWatts = 18; snapshot.cpu.temperature = 50;
  const atLimit = () => { const panelNodes = vm.runInContext('stepsPanel()', context); return panelNodes.children.map(n => n.text).filter(Boolean).join(' '); };
  assert.match(atLimit(), /18 W average power limit/);
  snapshot.cpu.power = 5; assert.doesNotMatch(atLimit(), /power limit/);
  snapshot.cpu.temperature = 86; snapshot.ryzen.current.temperatureLimit = 86; assert.match(atLimit(), /86 °C temperature limit/);
  snapshot.cpu.temperature = 50;
  const text = code => { const words = []; const walk = n => { if (n?.text) words.push(n.text); n?.children?.forEach(walk); }; walk(vm.runInContext(code, context)); return words.join(' '); };
  snapshot.cpuSteps.policy.dc = 3500; snapshot.boost.dc = 0;
  const panelText = text('stepsPanel()');
  assert.match(panelText, /Custom 3500 MHz/); assert.doesNotMatch(panelText, /already in your Windows power plan|no effect right now/);
  snapshot.cpuSteps.policy.dc = 0;
  snapshot.cpuSteps.hardware={available:true,vendor:'GenuineIntel',hybrid:true,source:'Intel PLATFORM_INFO',states:[{label:'Base',mhz:2600},{label:'Minimum',mhz:800}]};
  snapshot.cpuSteps.policy.class1={ac:2800,dc:2200};
  snapshot.cpuSteps.baseline={ac:0,dc:0,class1:{ac:2800,dc:2200}};
  assert.match(text('stepsPanel()'),/classes currently have different limits/);
  assert.match(text('stepsPanel()'),/class 1 2800 MHz/);
  snapshot.cpuSteps.hardware = { available: false, reason: 'Enable hardware access to read hardware P-states.' };
  assert.ok(vm.runInContext('stepsPanel().children.length', context) >= 4);
  snapshot.capabilities.cpuStep = { available: false, reason: 'No policy' };
  assert.equal(vm.runInContext('stepsPanel().children.length', context), 1);
});
