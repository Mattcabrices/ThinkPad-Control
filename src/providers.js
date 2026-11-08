import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { NativeBridge } from './bridge.js';
import { PipeBridge } from './pipe-bridge.js';
import { EcSlotWatch, FanProfiles, engineRows } from './fan-curves.js';
import { FanLevelSpeeds, FULL_SPEED_LEVEL } from './fan-levels.js';
import { buildCpuSteps, MIN_STEP_MHZ, MAX_STEP_MHZ, MAX_BOOST, STANDARD_BOOST, isMaxBoost } from './cpu-steps.js';
import { selectCpuClock } from './cpu-clock.js';

const execute = promisify(execFile);
// The EC's unregulated mode, above level 7. The engine runs level 7 first until the fan has spun up.
export { FULL_SPEED_LEVEL };
export async function run(file, args) {
  try { return (await execute(file, args, { timeout: 12000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })).stdout.trim(); }
  catch (e) { throw new Error(String(e.stderr || e.message).trim().slice(0, 600)); }
}
export const unsupported = reason => ({ available: false, reason });
const supported = () => ({ available: true, reason: '' });
const autoBoostState = value => /^(enabled|on|1)$/i.test(String(value).trim()) ? true : /^(disabled|off|0)$/i.test(String(value).trim()) ? false : null;
const num = value => value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export function parseNvidia(csv) {
  return csv.split(/\r?\n/).filter(Boolean).map(line => {
    const [id, name, temp, load, clock, watts, fan, memoryUsed, memoryTotal] = line.split(',').map(x => x.trim());
    if (!/^GPU-[a-zA-Z0-9-]+$/.test(id)) throw new Error('Unexpected GPU identifier.');
    return { id, name, temperature: num(temp), load: num(load), clock: num(clock), power: num(watts),
      fanRpm: null, fanPercent: num(fan), memoryUsed: num(memoryUsed), memoryTotal: num(memoryTotal), vendor: 'NVIDIA' };
  });
}
export function validateCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a command object.');
  const keys = Object.keys(value);
  if (value.type === 'ryzen-tune' && keys.every(k=>['type','setting','value','restore'].includes(k)) &&
      ['sustainedWatts','fastWatts','slowWatts','temperatureLimit'].includes(value.setting) && typeof value.restore==='boolean' &&
      (value.restore ? value.value===undefined : Number.isFinite(value.value) && value.value >= (value.setting==='temperatureLimit'?60:5) && value.value <= (value.setting==='temperatureLimit'?110:100) && Math.abs(value.value*10-Math.round(value.value*10))<0.001 && (value.setting!=='temperatureLimit'||Number.isInteger(value.value)))) return value;
  if (value.type === 'cpu-boost' && keys.every(k => ['type','source','enabled'].includes(k)) &&
      ['ac','dc','all'].includes(value.source) && typeof value.enabled === 'boolean') return value;
  if (value.type === 'cpu-max-boost' && keys.every(k => ['type','source','enabled'].includes(k)) && ['ac','dc','all'].includes(value.source) && typeof value.enabled === 'boolean') return value;
  if (value.type === 'cpu-step' && keys.every(k => ['type','source','mhz','restore'].includes(k)) && ['ac','dc','all'].includes(value.source) &&
      ((value.restore === true && value.mhz === undefined) || (value.restore === undefined && Number.isInteger(value.mhz) && (value.mhz === 0 || (value.mhz >= MIN_STEP_MHZ && value.mhz <= MAX_STEP_MHZ))))) return value;
  if (value.type === 'gpu-boost' && keys.every(k => ['type','id','enabled'].includes(k)) &&
      typeof value.id === 'string' && value.id.length <= 200 && typeof value.enabled === 'boolean') return value;
  if (value.type === 'fan-profile-save' && keys.every(k => ['type','id','name','fanOff','levels','maxTemp'].includes(k)) && (value.maxTemp === undefined || Number.isInteger(value.maxTemp)) && (value.id === undefined || (typeof value.id === 'string' && value.id.length <= 64)) &&
      typeof value.name === 'string' && typeof value.fanOff === 'boolean' && Array.isArray(value.levels)) return value;
  if (['fan-profile-apply','fan-profile-delete'].includes(value.type) && keys.every(k => ['type','id'].includes(k)) && typeof value.id === 'string' && value.id.length <= 64) return value;
  if (value.type === 'fan-profile-firmware' && keys.length === 1) return value;
  if (value.type === 'fan-manual-limit' && keys.length===2 && keys.includes('celsius') && (value.celsius===null || Number.isInteger(value.celsius)&&value.celsius>=60&&value.celsius<=110)) return value;
  if (value.type === 'fan' && keys.every(k => ['type','id','mode','percent','level'].includes(k)) &&
      typeof value.id === 'string' && value.id.length <= 200 && ['auto','manual'].includes(value.mode) &&
      (value.mode === 'auto' ? value.percent === undefined && value.level === undefined :
        (value.level === undefined && Number.isInteger(value.percent) && value.percent >= 30 && value.percent <= 100) ||
        (value.percent === undefined && Number.isInteger(value.level) && ((value.level >= 1 && value.level <= 7) || value.level === FULL_SPEED_LEVEL)))) return value;
  throw new Error('Invalid command. Manual fans require 30–100 percent or a supported discrete level 1–7.');
}

// Saving only stores a profile. Applying goes through the elevated worker and is confirmed by reading it back.
async function fanProfileCommand(profiles, c, state, applyRows, refresh) {
  const view = state.fanProfiles, limit = view?.limit?.celsius ?? null;
  if (c.type === 'fan-profile-delete') {
    if (c.id === view?.activeId) throw new Error('Switch to another profile or firmware control before deleting this one.');
    profiles.remove(c.id, limit); return 'Fan profile deleted.';
  }
  if (c.type === 'fan-profile-save') { const saved = profiles.save(c, limit); return `Fan profile "${saved.name}" saved. Apply it to use it.`; }
  if (!view?.available) throw new Error(view?.reason || 'Fan curves are unavailable.');
  if (c.type === 'fan-profile-firmware') {
    await applyRows(null, []);
    if ((await refresh()).fanProfiles?.curveSet !== false) throw new Error('Fan engine read-back mismatch.');
    return 'Firmware fan control set and verified. It stays in place after a restart.';
  }
  const profile = profiles.find(c.id, limit);
  if (!profile.valid) throw new Error(`Edit this profile first: ${profile.problem}`);
  const masks=view.recommendedMasks??[];
  await applyRows(engineRows(profile.levels, profile.fanOff, limit, profile.maxTemp), masks);
  const observed=(await refresh()).fanProfiles;
  if (observed?.activeId !== profile.id || JSON.stringify(observed.maskedSlots??[])!==JSON.stringify(masks)) throw new Error('Fan engine curve or sensor-offset read-back mismatch.');
  return `Fan profile "${profile.name}" applied and verified. It keeps running with the app closed and after a restart.`;
}
export class DemoProvider {
  constructor(profile='ryzen') {
    this.levelSpeeds=new FanLevelSpeeds();this.fanProfiles=new FanProfiles();this.fanCurve={active:1,rows:[[0,128]]};
    if(!['ryzen','intel'].includes(profile))throw new Error('Unknown simulated CPU profile.');
    this.profile=profile;this.class1Baseline={ac:2800,dc:2200};this.maxFrequencyClass1={...this.class1Baseline};this.eppClass1={ac:35,dc:75};
    this.ryzenLimits={sustainedWatts:15,fastWatts:25,slowWatts:20,temperatureLimit:85}; this.ryzenBaseline={...this.ryzenLimits}; this.boost = { ac: 1, dc: 0 }; this.maxFrequency = { ac: 0, dc: 0 }; this.epp = { ac: 60, dc: 60 }; this.demoBoostBefore = {}; this.fanMode = 'auto'; this.percent = 52; this.level = 4; this.gpuBoost = true;
    this.leaseUntil = 0;
  }
  async snapshot() {
    if (Date.now() > this.leaseUntil) this.fanMode = 'auto';
    const wave = Math.sin(Date.now() / 14000), t = 58 + wave * 8;
    const snapshot = {
      at: new Date().toISOString(), mode: 'demo', machine: { manufacturer: 'Lenovo', model: 'ThinkPad T14s Gen 2 · simulated' },
      admin: false, powerSource: 'Online',
      cpu: { name: 'AMD Ryzen 5 PRO 5650U · simulated', temperature: t, load: 31 + wave * 14, clock: 2900 + wave * 500, power: 17 + wave * 4 },
      ryzen:{available:true,reason:'',current:{...this.ryzenLimits},baseline:{...this.ryzenBaseline},status:'Simulated direct tuning',ranges:{sustainedWatts:{min:5,max:25},fastWatts:{min:5,max:40},slowWatts:{min:5,max:30},temperatureLimit:{min:60,max:90}}}, motherboard: { temperature: 42 + wave * 3 }, boost: { ...this.boost },
      cpuSteps: buildCpuSteps({ cpu: { MaxClockSpeed: 2301 }, performance: { ProcessorFrequency: 2100, PerformanceLimitFlags: 0 }, boost: { ...this.boost }, cpuPolicy: { scheme: 'demo', maxFrequency: { ...this.maxFrequency }, epp: { ...this.epp } } },
        { available: true, reason: '', vendor: 'AuthenticAMD', family: 0x19, source: 'Simulated', cppcEnabled: true, cppc: { highest: 186, nominal: 89, lowestNonlinear: 43, lowest: 16 }, states: [{ label: 'P0', mhz: 2300 }, { label: 'P1', mhz: 1800 }, { label: 'P2', mhz: 1400 }] },
        { scheme: 'demo', ac: 0, dc: 0 }),
      gpus: [{ id: 'demo-radeon', name: 'AMD Radeon Graphics · simulated', vendor: 'AMD', temperature: t - 6, load: 22 + wave * 9,
        clock: 1300 + wave * 150, power: null, memoryUsed: 630, memoryTotal: 2048, boost: null,
        boostCapability: unsupported('Radeon iGPU does not expose independent boost control. CPU/APU boost and shared cooling remain available.') }],
      fans: [{ id: 'demo-cooling', name: 'Shared CPU / GPU fan', rpm: Math.round((this.fanMode === 'manual' ? this.percent : 52 + wave * 8) * 52),
        mode: this.fanMode, percent: this.fanMode === 'manual' ? this.percent : 52, level:this.fanMode==='manual'?this.level:null,
        controlUnit:'level',min:1,max:7,capability: supported() }],
      sensors: [
        { id: 'cpu-temp', group: 'CPU', name: 'CPU package', type: 'Temperature', value: t, unit: '°C' },
        { id: 'gpu-temp', group: 'GPU', name: 'GPU core', type: 'Temperature', value: t - 6, unit: '°C' },
        { id: 'board-temp', group: 'Motherboard', name: 'System board', type: 'Temperature', value: 42 + wave * 3, unit: '°C' }
      ], capabilities: { cpuBoost: supported(), cpuStep: supported(), cpuMaxBoost: supported() },
      warnings: ['Demo mode: all readings and controls are simulated. No hardware writes occur.']
    };
    if(this.profile==='intel') {
      snapshot.machine.model='ThinkPad Intel hybrid · simulated';
      snapshot.cpu.name='Intel hybrid processor · simulated';
      snapshot.ryzen={available:false,reason:'Ryzen SMU controls do not apply to the simulated Intel processor.'};
      snapshot.cpuSteps=buildCpuSteps({cpu:{MaxClockSpeed:2400},boost:{...this.boost},cpuPolicy:{scheme:'demo',maxFrequency:{...this.maxFrequency},maxFrequencyClass1:{...this.maxFrequencyClass1},epp:{...this.epp},eppClass1:{...this.eppClass1}}},
        {available:true,vendor:'GenuineIntel',family:6,model:0xBA,hybrid:true,source:'Simulated Intel ratios',referenceClockMhz:100,boostMhz:4800,states:[{label:'Base',mhz:2400},{label:'Minimum',mhz:800}]},
        {scheme:'demo',ac:0,dc:0,class1:{...this.class1Baseline}});
      snapshot.gpus=[{...snapshot.gpus[0],id:'demo-intel',name:'Intel Graphics · simulated',vendor:'Intel',boostCapability:unsupported('Independent Intel GPU boost control is unavailable in this simulated profile.')}];
      snapshot.cpuSteps.hardware.powerLimits={available:true,readOnly:true,source:'Simulated Intel package limits',locked:true,pl1:{watts:15,enabled:true,clamp:true,windowSeconds:28},pl2:{watts:35,enabled:true,clamp:false,windowSeconds:1.25}};
    }
    const coreSensors=Array.from({length:this.profile==='intel'?8:6},(_,i)=>({group:'CPU',type:'Clock',name:this.profile==='intel'?`${i<4?'P':'E'}-Core #${i+1}`:`Core #${i+1}`,value:Math.max(800,snapshot.cpu.clock-i*137)}));
    const clock=selectCpuClock(coreSensors);
    snapshot.cpu.clock=clock.currentMhz;snapshot.cpu.clockDetails=clock;
    snapshot.cpuSteps.currentMhz=clock.currentMhz;snapshot.cpuSteps.clock=clock;
    snapshot.fanProfiles=this.fanProfiles.view(snapshot,this.fanCurve);
    this.levelSpeeds.observe(snapshot.fans);snapshot.fanLevels=this.levelSpeeds.view();
    return snapshot;
  }
  async command(c) {
    if(c.type==='fan-manual-limit') {
      if(this.fanMode==='manual')throw new Error('Return the fan to firmware before changing its temperature limit.');
      this.fanCurve.manualTemperatureAutomatic=c.celsius===null;
      this.fanCurve.manualTemperatureLimit=c.celsius??(await this.snapshot()).fanProfiles.manualTemperature.defaultCelsius;
      return 'Manual fan temperature limit saved. It does not change CPU thermal limits or fan curves.';
    }
    if (c.type.startsWith('fan-profile')) return await fanProfileCommand(this.fanProfiles,c,await this.snapshot(),async (rows,masks)=>{this.fanCurve=rows?{...this.fanCurve,active:2,rows,masks,dormantMasks:[]}:{...this.fanCurve,active:1,rows:[[0,128]],masks:[],dormantMasks:this.fanCurve.active===2?(this.fanCurve.masks??[]):(this.fanCurve.dormantMasks??[])};},()=>this.snapshot());
    if (c.type === 'ryzen-tune') {
      if(this.profile==='intel')throw new Error('Ryzen controls do not apply to Intel.');
      if (!c.restore && c.value > ({sustainedWatts:25,fastWatts:40,slowWatts:30,temperatureLimit:90})[c.setting]) throw new Error('This value is above the range for this machine.');
      this.ryzenLimits[c.setting]=c.restore?this.ryzenBaseline[c.setting]:c.value;
    } else if (c.type === 'cpu-boost') {
      for (const source of c.source === 'all' ? ['ac','dc'] : [c.source]) {
        const before=this.demoBoostBefore[source];if(before){this.epp[source]=before.epp;this.eppClass1[source]=before.eppClass1;delete this.demoBoostBefore[source];}
        this.boost[source] = c.enabled ? 1 : 0;
      }
    } else if (c.type === 'cpu-max-boost') {
      for (const source of c.source === 'all' ? ['ac','dc'] : [c.source]) {
        const active=isMaxBoost(this.boost[source],this.epp[source])&&(this.profile!=='intel'||this.eppClass1[source]===0);
        if (c.enabled) {
          if(!active)this.demoBoostBefore[source]={mode:this.boost[source],epp:this.epp[source],eppClass1:this.eppClass1[source]};
          this.boost[source]=MAX_BOOST.mode;this.epp[source]=MAX_BOOST.epp;if(this.profile==='intel')this.eppClass1[source]=0;
        } else if(active) {
          const before=this.demoBoostBefore[source]??{...STANDARD_BOOST,eppClass1:50};this.boost[source]=before.mode;this.epp[source]=before.epp;if(this.profile==='intel')this.eppClass1[source]=before.eppClass1;delete this.demoBoostBefore[source];
        }
      }
    } else if (c.type === 'cpu-step') {
      for (const source of c.source === 'all' ? ['ac','dc'] : [c.source]) {
        this.maxFrequency[source] = c.restore ? 0 : c.mhz;
        if(this.profile==='intel')this.maxFrequencyClass1[source]=c.restore?this.class1Baseline[source]:c.mhz;
      }
    } else if (c.type === 'gpu-boost') {
      if (c.id !== 'demo-radeon') throw new Error('GPU no longer available.');
      this.gpuBoost = c.enabled;
    } else {
      if (c.id !== 'demo-cooling') throw new Error('Fan no longer available.');
      this.fanMode = c.mode; this.level = c.level ?? 4; this.percent = c.level!==undefined?Math.min(c.level,7)/7*100:c.percent??52; this.leaseUntil = Date.now() + 10_000;
    }
    return 'Simulated command applied.';
  }
  async heartbeat(active) { if (active) this.leaseUntil = Date.now() + 10_000; else this.fanMode = 'auto'; }
  async close() { this.fanMode = 'auto'; }
}

export class WindowsProvider {
  constructor({ runner = run, bridgePath = process.env.THINKPAD_BRIDGE, pipeName = process.env.THINKPAD_BRIDGE_PIPE, platform = process.platform, monotonicNow = () => performance.now(), boostStateFile = null, fanProfileFile = null } = {}) {
    this.fanProfiles = new FanProfiles(fanProfileFile); this.slotWatch = new EcSlotWatch(fanProfileFile ? `${fanProfileFile}.slots` : null); this.levelSpeeds = new FanLevelSpeeds(fanProfileFile ? `${fanProfileFile}.levels` : null);
    this.boostStateFile = boostStateFile; this.boostMemory = {};
    this.monotonicNow = monotonicNow; this.run = runner; this.platform = platform; this.bridge = pipeName ? new PipeBridge(pipeName) : bridgePath ? new NativeBridge(bridgePath) : null;
    this.powercfg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'powercfg.exe');
    this.powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    this.smi = process.env.THINKPAD_NVIDIA_SMI || 'nvidia-smi.exe';
  }
  async snapshot() {
    if (this.platform !== 'win32') throw new Error('Live hardware mode requires Windows. Use npm run demo on other platforms.');
    const warnings = [];
    const [probe, native, nvidia] = await Promise.allSettled([
      this.run(this.powershell, ['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',fileURLToPath(new URL('../scripts/probe.ps1', import.meta.url))]).then(JSON.parse),
      this.bridge ? Promise.resolve().then(()=>this.bridge.request('snapshot')) : Promise.resolve(null),
      this.run(this.smi, ['--query-gpu=uuid,name,temperature.gpu,utilization.gpu,clocks.gr,power.draw,fan.speed,memory.used,memory.total','--format=csv,noheader,nounits']).then(parseNvidia)
    ]);
    const p = probe.status === 'fulfilled' ? probe.value : {};
    if (probe.status === 'rejected') warnings.push(`Windows probe: ${probe.reason.message}`);
    warnings.push(...(p.warnings || []));
    const n = native.status === 'fulfilled' ? native.value : null;
    if (native.status === 'rejected') warnings.push(native.reason.message);
    if (n?.warnings) warnings.push(...n.warnings);
    if (!this.bridge) warnings.push('Native sensor bridge is not configured. CPU, Radeon and board temperatures may be unavailable. See Setup.');
    const sensors = n?.sensors || [];
    if (n?.driver && !n.driver.deviceAccessible)
      warnings.push(`PawnIO driver access failed: ${n.driver.message} (Windows error ${n.driver.errorCode}). ${n.driver.errorCode===5?'Enable hardware access in the desktop app, or launch as administrator.':'Check the installed PawnIO driver.'}`);
    if (n && !sensors.some(s=>s.group==='CPU'&&s.type==='Temperature'&&s.value>0))
      warnings.push(p.admin ? 'CPU temperature is unavailable. Check hardware-driver compatibility.' : 'CPU temperature is unavailable. Try an administrator launch with a compatible sensor driver.');
    const metric = (group, type, prefer = /package|core|total/i) => {
      const candidates = sensors.filter(s => s.group === group && s.type === type && s.value !== null);
      return (candidates.find(s => prefer.test(s.name)) || candidates[0])?.value ?? null;
    };
    const gpus = nvidia.status === 'fulfilled' ? nvidia.value : [];
    for (const gpu of gpus) {
      try {
        const raw = await this.run(this.smi, ['-i',gpu.id,'--query-gpu=auto_boost.default','--format=csv,noheader,nounits']);
        gpu.boost = /^(enabled|on|1)$/i.test(raw) ? true : /^(disabled|off|0)$/i.test(raw) ? false : null;
        gpu.boostCapability = gpu.boost === null ? unsupported('Driver does not expose independent auto-boost control.') : supported();
      } catch { gpu.boost = null; gpu.boostCapability = unsupported('Independent GPU auto-boost is not supported by this driver.'); }
    }
    const nativeGpus = n?.gpus || [];
    for (const gpu of nativeGpus) {
      if (gpu.vendor === 'NVIDIA' && gpus.length) continue;
      gpus.push({ ...gpu, boost: null, boostCapability: unsupported(gpu.vendor === 'Intel' ? 'Independent Intel GPU boost control is not exposed. Graphics clocks remain managed by the driver and firmware.' : gpu.vendor === 'AMD' ? 'Independent AMD GPU boost control is not exposed. APU boost is managed through CPU policy and firmware.' : 'Independent GPU auto-boost requires a compatible NVIDIA driver interface.') });
    }
    const gpuName = name => String(name ?? '').replace(/\((?:R|TM)\)/gi,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
    for (const gpu of p.gpus || []) {
      if (!gpus.some(g => gpuName(g.name) === gpuName(gpu.Name) || (g.vendor === 'NVIDIA' && /nvidia/i.test(gpu.Name)) || (g.vendor === 'AMD' && /radeon|amd/i.test(gpu.Name))))
        gpus.push({ id: gpu.PNPDeviceID, name: gpu.Name, vendor: /intel/i.test(gpu.Name) ? 'Intel' : /nvidia/i.test(gpu.Name) ? 'NVIDIA' : /amd|radeon/i.test(gpu.Name) ? 'AMD' : 'Unknown', temperature: null, load: null,
          clock: null, power: null, boost: null, boostCapability: unsupported('No supported independent GPU boost interface detected.') });
    }
    // The connection baseline restores a pre-existing cap, which is not necessarily "no limit".
    const frequency = p.cpuPolicy?.maxFrequency;
    if (frequency && this.stepBaseline?.scheme !== p.cpuPolicy.scheme) this.stepBaseline = { scheme: p.cpuPolicy.scheme, ac: frequency.ac, dc: frequency.dc, class1:p.cpuPolicy.maxFrequencyClass1 ? {...p.cpuPolicy.maxFrequencyClass1} : null };
    const clock=selectCpuClock(sensors,p);
    const steps=buildCpuSteps(p,n?.cpuStates,this.stepBaseline,clock);
    const recovery=this.readBoostMemory()[steps.policy?.scheme]??{};
    steps.maxBoostRecovery=Object.fromEntries(['ac','dc'].map(source=>[source,recovery[source]?.recoveryPending===true]));
    const intelInventory=n?.cpuStates?.vendor==='GenuineIntel'||/intel/i.test(p.cpu?.Manufacturer??'')||/\bIntel\b/i.test(p.cpu?.Name??'');
    const classIdentityUnavailable=intelInventory&&!(n?.cpuStates?.vendor==='GenuineIntel'&&typeof n.cpuStates.hybrid==='boolean');
    const identityReason='Native Intel processor identity is unavailable. Class-aware controls require a working bridge; standard boost policy remains separate.';
    return {
      at: new Date().toISOString(), mode: 'live', admin: p.admin ?? false, cpuSteps: steps,
      fanLevels: (this.levelSpeeds.observe(n?.fans), this.levelSpeeds.view()),
      fanProfiles: (n?.fanCurve && n.fans?.some(f=>f.id==='tpfc/cooling-system'&&f.capability?.available)
        ? this.slotWatch.observe(sensors, metric('CPU','Temperature'), n.fanCurve.masks, n.fanCurve) : this.slotWatch.invalidate(),
        this.fanProfiles.view({ ryzen: n?.ryzen, cpuSteps: steps }, n?.fanCurve ?? null, this.slotWatch.flat(), this.slotWatch.moving())),
      driver: n?.driver || null, sensorMonitor:n?.sensorMonitor??null, ryzen:n?.ryzen || {available:false,reason:'Enable hardware access to discover direct Ryzen tuning.'},
      fanEngine:p.fanEngine || null,
      machine: { manufacturer: p.machine?.Manufacturer || 'Unknown', model: p.machine?.Model || 'ThinkPad · inventory unavailable', productName: p.product?.Version || null, biosVersion: p.bios?.SMBIOSBIOSVersion || null },
      powerSource: p.powerSource || 'Unknown',
      cpu: { name: p.cpu?.Name || n?.cpuName || 'CPU unavailable', temperature: metric('CPU','Temperature'), load: metric('CPU','Load',/total/i) ?? p.cpu?.LoadPercentage ?? null,
        clock: clock.currentMhz, clockDetails:clock, power: metric('CPU','Power',/package/i) },
      motherboard: { temperature: metric('Motherboard','Temperature') }, firmware: { temperature: metric('Firmware','Temperature'), zone: sensors.find(s=>s.group==='Firmware'&&s.type==='Temperature'&&Number.isFinite(s.value))?.name ?? null }, boost: p.boost || null,
      gpus, fans: n?.fans || [], sensors, capabilities: {
        cpuBoost:p.boost?supported():unsupported('Windows boost policy could not be read.'),
        cpuStep:classIdentityUnavailable?unsupported(identityReason):frequency&&(!n?.cpuStates?.hybrid||p.cpuPolicy?.maxFrequencyClass1)?supported():unsupported('Windows does not expose every processor-class frequency policy needed on this system.'),
        cpuMaxBoost:classIdentityUnavailable?unsupported(identityReason):p.boost&&p.cpuPolicy?.epp&&(!n?.cpuStates?.hybrid||p.cpuPolicy?.eppClass1)?supported():unsupported('Windows does not expose all processor energy-preference settings needed for maximum boost.')
      }, warnings
    };
  }
  // Earlier values are saved before the first write, so turning this off also works after a restart.
  readBoostMemory() {
    if (!this.boostStateFile) return this.boostMemory;
    if (!existsSync(this.boostStateFile)) return {};
    try { const value = JSON.parse(readFileSync(this.boostStateFile,'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch { return {}; }
  }
  writeBoostMemory(value) {
    if (!this.boostStateFile) { this.boostMemory = value; return; }
    mkdirSync(dirname(this.boostStateFile),{recursive:true});
    const temporary = this.boostStateFile+'.tmp'; writeFileSync(temporary,JSON.stringify(value)); renameSync(temporary,this.boostStateFile);
  }
  async verifyPolicyRollback(scheme, schemeOf, matches) {
    const current=await this.snapshot();
    if(schemeOf(current)!==scheme)throw new Error('Active power plan changed; original policy restoration is unverified.');
    await this.run(this.powercfg,['/setactive',scheme]);
    const restored=await this.snapshot();
    if(schemeOf(restored)!==scheme||!matches(restored))throw new Error('Restoration read-back mismatch or active power plan changed.');
  }
  async setMaxBoost(requested, enabled, state) {
    // Turning off what is already off must never replace the owner's own values.
    const policy = state.cpuSteps.policy, scheme = policy.scheme, memory = this.readBoostMemory(), remembered = memory[scheme] ?? {};
    if(enabled&&requested.some(s=>remembered[s]?.recoveryPending===true))throw new Error('Finish the pending boost recovery before enabling Maximum boost again. Nothing changed.');
    const sources = enabled ? requested.filter(s=>!state.cpuSteps.maxBoost?.[s]) : requested.filter(s => state.cpuSteps.maxBoost?.[s] || remembered[s]?.recoveryPending === true);
    if (!sources.length) return enabled?'Maximum boost is already on. Nothing changed. Firmware still limits actual speed.':'Maximum boost is already off. Nothing changed.';
    const valid = n => Number.isInteger(n) && n >= 0 && n <= 100;
    const hybrid = state.cpuSteps.hardware?.hybrid === true;
    if (hybrid && !sources.every(s => valid(policy.eppClass1?.[s]))) throw new Error('Hybrid processor class-1 energy preference is unavailable. No settings changed.');
    const before = Object.fromEntries(sources.map(s => [s,{ mode:state.boost[s], epp:policy.epp[s], ...(hybrid ? { eppClass1:policy.eppClass1[s] } : {}) }]));
    if(enabled&&sources.some(s=>!valid(before[s].mode)||before[s].mode>6||!valid(before[s].epp)))throw new Error('Current boost preferences cannot be captured as a supported recovery target. Nothing changed.');
    const savedValid = s => valid(remembered[s]?.mode) && remembered[s].mode <= 6 && valid(remembered[s]?.epp) && (!hybrid || valid(remembered[s]?.eppClass1) || remembered[s]?.eppClass1 === undefined);
    const unknown = !enabled && sources.some(s => !savedValid(s)||remembered[s]?.baselineKnown===false);
    const target = s => enabled ? { ...MAX_BOOST, eppClass1:0 } : (savedValid(s) ? { ...remembered[s], eppClass1:remembered[s].eppClass1 ?? before[s].eppClass1 } : { ...STANDARD_BOOST, eppClass1:50 });
    const write = async (source, value) => {
      await this.run(this.powercfg, [`/set${source}valueindex`,scheme,'SUB_PROCESSOR','PERFBOOSTMODE',String(value.mode)]);
      await this.run(this.powercfg, [`/set${source}valueindex`,scheme,'SUB_PROCESSOR','PERFEPP',String(value.epp)]);
      if (hybrid) await this.run(this.powercfg, [`/set${source}valueindex`,scheme,'SUB_PROCESSOR','PERFEPP1',String(value.eppClass1)]);
    };
    const next = { ...remembered };
    for (const s of sources) {
      if(enabled&&!state.cpuSteps.maxBoost?.[s]) {
        // Older builds saved only the first class and never changed class 1.
        // Preserve that original baseline when upgrading a hybrid machine.
        const legacy = hybrid && state.boost[s] === MAX_BOOST.mode && policy.epp[s] === MAX_BOOST.epp &&
          valid(remembered[s]?.mode) && remembered[s].mode <= 6 && valid(remembered[s]?.epp) && remembered[s]?.eppClass1 === undefined;
        next[s] = legacy ? { mode:remembered[s].mode, epp:remembered[s].epp, eppClass1:before[s].eppClass1 } : before[s];
      }
      if(!enabled)next[s]={...target(s),baselineKnown:savedValid(s)&&remembered[s]?.baselineKnown!==false};
      next[s]={...next[s],recoveryPending:true};
    }
    // Persist the recovery target BEFORE either applying or restoring. A failed
    // attempt (or process exit) must not erase the only original preference copy.
    this.writeBoostMemory({ ...memory, [scheme]:next });
    const attempted = [];
    try {
      for (const s of sources) { attempted.push(s); await write(s,target(s)); }
      await this.run(this.powercfg, ['/setactive',scheme]);
      const after = await this.snapshot();
      if (after.boost?.scheme !== scheme || after.cpuSteps?.policy?.scheme !== scheme || sources.some(s => after.boost[s] !== target(s).mode || after.cpuSteps.policy.epp?.[s] !== target(s).epp || (hybrid && after.cpuSteps.policy.eppClass1?.[s] !== target(s).eppClass1))) throw new Error('Boost policy read-back mismatch or active plan changed.');
    } catch (error) {
      const rollback = [];
      for (const s of attempted) { try { await write(s,before[s]); } catch (e) { rollback.push(e.message); } }
      try { await this.verifyPolicyRollback(scheme,s=>s.boost?.scheme,s=>s.cpuSteps?.policy?.scheme===scheme&&attempted.every(source=>s.boost?.[source]===before[source].mode&&s.cpuSteps.policy.epp?.[source]===before[source].epp&&(!hybrid||s.cpuSteps.policy.eppClass1?.[source]===before[source].eppClass1))); }
      catch (e) { rollback.push(e.message); }
      if(!rollback.length)try{this.writeBoostMemory(memory);}catch(e){rollback.push('Recovery metadata: '+e.message);}
      const restoredMessage=sources.some(s=>remembered[s]?.recoveryPending===true)?'Pre-attempt boost settings restored and verified. The saved recovery target is still pending.':'Original boost settings restored and verified.';
      throw new Error(`${error.message} ${rollback.length ? 'Rollback incomplete or unverified: '+rollback.join('; ') : restoredMessage}`);
    }
    let metadataWarning='';
    if (!enabled) {
      for (const s of sources) delete next[s];
      const rest = { ...memory, [scheme]:next }; if (!Object.keys(next).length) delete rest[scheme];
      try{this.writeBoostMemory(rest);}catch{metadataWarning=' Saved recovery state could not be cleared; the verified settings are in effect.';}
    } else {
      for(const s of sources)next[s]={...next[s],recoveryPending:false};
      try{this.writeBoostMemory({...memory,[scheme]:next});}catch{metadataWarning=' Saved recovery state remains pending; the verified settings are in effect.';}
    }
    if (enabled) return 'Maximum boost set and verified in Windows policy. Firmware still limits actual speed.'+metadataWarning;
    return (unknown ? 'Maximum boost off. Earlier settings were unknown, so standard boost was set and verified.' : 'Maximum boost off. Earlier settings restored and verified.')+metadataWarning;
  }
  async setManualFanLimit(celsius,state) {
    const policy=state.fanProfiles?.manualTemperature;
    if(!this.bridge||!policy||!state.fans.some(f=>f.id==='tpfc/cooling-system'&&f.capability.available))throw new Error('Manual temperature settings require the bundled ThinkPad fan engine.');
    if(state.fans.some(f=>f.id==='tpfc/cooling-system'&&f.mode==='manual'))throw new Error('Return the fan to firmware before changing its temperature limit.');
    const resolved=celsius??policy.defaultCelsius;
    this.slotWatch.invalidate();
    try{await this.bridge.request('fan-manual-policy',{celsius:resolved,automatic:celsius===null});}
    finally{this.slotWatch.invalidate();}
    const after=await this.snapshot(),observed=after.fanProfiles?.manualTemperature;
    if(observed?.engineCelsius!==resolved||observed?.automatic!==(celsius===null))throw new Error('Manual fan temperature policy read-back mismatch.');
    return after;
  }
  async command(c) {
    let state = await this.snapshot(); // Always authorize against a fresh hardware inventory.
    if(c.type==='fan-manual-limit') {
      await this.setManualFanLimit(c.celsius,state);
      return 'Manual fan temperature limit saved and verified. CPU thermal limits and fan curves are unchanged.';
    }
    if (c.type.startsWith('fan-profile')) return await fanProfileCommand(this.fanProfiles, c, state, async (rows, masks) => {
      this.slotWatch.invalidate();
      try { return await this.bridge.request('fan-curve', { rows, masks }); }
      finally { this.slotWatch.invalidate(); }
    }, () => this.snapshot());
    if (c.type === 'ryzen-tune') {
      if (!state.ryzen?.available) throw new Error(state.ryzen?.reason || 'Direct Ryzen tuning is unavailable.');
      const field=state.ryzen.fields?.[c.setting]; if (field && (c.restore ? field.restoreAvailable===false : field.available===false)) throw new Error(field.reason || 'This Ryzen limit is read-only.');
      // The schema only holds absolute bounds. This machine's range comes from the worker, which enforces it again.
      const range=state.ryzen.ranges?.[c.setting]; if (!c.restore && range && (c.value < range.min || c.value > range.max)) throw new Error(`Choose a value from ${range.min} to ${range.max} on this machine.`);
      if (!this.bridge) throw new Error('Hardware worker is required.');
      return await this.bridge.request('ryzen-tune',{setting:c.setting,restore:c.restore,...(!c.restore?{value:c.value}:{})});
    } else if (c.type === 'cpu-boost') {
      if (!state.capabilities.cpuBoost.available) throw new Error(state.capabilities.cpuBoost.reason);
      // The plain toggle replaces the boost mode, so leave Maximum boost first or its preference would stay behind.
      const recovery=this.readBoostMemory()[state.cpuSteps?.policy?.scheme]??{};
      const maximized = (c.source === 'all' ? ['ac','dc'] : [c.source]).filter(s => state.cpuSteps?.maxBoost?.[s]||recovery[s]?.recoveryPending===true);
      if (maximized.length) { await this.setMaxBoost(maximized, false, state); state = await this.snapshot(); }
      if (!state.capabilities.cpuBoost.available) throw new Error(state.capabilities.cpuBoost.reason);
      if (this.bridge instanceof PipeBridge) return await this.bridge.request('cpu-boost',{source:c.source,enabled:c.enabled});
      const before = state.boost, sources = c.source === 'all' ? ['ac','dc'] : [c.source];
      // Record all attempted indices: a failed process can still have written a setting.
      const attempted = [];
      try {
        for (const source of sources) {
          attempted.push(source);
          await this.run(this.powercfg, [`/set${source}valueindex`, before.scheme, 'SUB_PROCESSOR','PERFBOOSTMODE', c.enabled ? '1' : '0']);
        }
        await this.run(this.powercfg, ['/setactive',before.scheme]);
        const after = await this.snapshot();
        if (after.boost?.scheme !== before.scheme || sources.some(s => after.boost?.[s] !== (c.enabled ? 1 : 0))) throw new Error('Boost policy read-back mismatch or active plan changed.');
      } catch (error) {
        const rollback = [];
        for (const source of attempted) {
          try { await this.run(this.powercfg, [`/set${source}valueindex`,before.scheme,'SUB_PROCESSOR','PERFBOOSTMODE',String(before[source])]); }
          catch (e) { rollback.push(e.message); }
        }
        // Do not switch plans if another application changed the active plan in the meantime.
        try { await this.verifyPolicyRollback(before.scheme,s=>s.boost?.scheme,s=>attempted.every(source=>s.boost?.[source]===before[source])); }
        catch (e) { rollback.push(e.message); }
        throw new Error(`${error.message} ${rollback.length ? 'Rollback incomplete or unverified: ' + rollback.join('; ') : 'Original boost indices restored and verified.'}`);
      }
      return 'Windows processor boost policy applied and verified.';
    }
    if (c.type === 'cpu-max-boost') {
      if (!state.capabilities.cpuMaxBoost?.available) throw new Error(state.capabilities.cpuMaxBoost?.reason || 'Maximum boost is unavailable.');
      return await this.setMaxBoost(c.source === 'all' ? ['ac','dc'] : [c.source], c.enabled, state);
    }
    if (c.type === 'cpu-step') {
      if (!state.capabilities.cpuStep?.available) throw new Error(state.capabilities.cpuStep?.reason || 'Maximum-frequency policy is unavailable.');
      const before = state.cpuSteps.policy, sources = c.source === 'all' ? ['ac','dc'] : [c.source];
      if (state.cpuSteps.hardware?.hybrid && !before.class1) throw new Error('Hybrid processor class-1 frequency policy is unavailable. No settings changed.');
      // Intel hybrid CPUs keep a separate cap for efficiency class 1; other CPUs leave that setting untouched.
      const targets = [{ setting:'PROCFREQMAX', values:before }];
      if (state.cpuSteps.hardware?.hybrid && before.class1) targets.push({ setting:'PROCFREQMAX1', values:before.class1 });
      const baseline=state.cpuSteps.baseline;
      const desired=(source,target)=>c.restore ? (target.setting==='PROCFREQMAX1'?baseline?.class1:baseline)?.[source] : c.mhz;
      if (targets.some(target=>sources.some(source=>!Number.isInteger(desired(source,target)) || desired(source,target)<0 || desired(source,target)>0xFFFFFFFF))) throw new Error('No valid frequency baseline is available for every processor class. Nothing changed.');
      const write = (source, target, value) => this.run(this.powercfg, [`/set${source}valueindex`, before.scheme, 'SUB_PROCESSOR', target.setting, String(value)]);
      const attempted = [];
      try {
        for (const target of targets) for (const source of sources) { attempted.push([source,target]); await write(source, target, desired(source,target)); }
        await this.run(this.powercfg, ['/setactive',before.scheme]);
        const after = (await this.snapshot()).cpuSteps?.policy;
        const reads = target => target.setting === 'PROCFREQMAX' ? after : after?.class1;
        if (after?.scheme !== before.scheme || targets.some(t => sources.some(s => reads(t)?.[s] !== desired(s,t)))) throw new Error('Frequency policy read-back mismatch or active plan changed.');
      } catch (error) {
        const rollback = [];
        for (const [source,target] of attempted) { try { await write(source, target, target.values[source]); } catch (e) { rollback.push(e.message); } }
        try { await this.verifyPolicyRollback(before.scheme,s=>s.cpuSteps?.policy?.scheme,s=>attempted.every(([source,target])=>(target.setting==='PROCFREQMAX1'?s.cpuSteps.policy.class1:s.cpuSteps.policy)?.[source]===target.values[source])); }
        catch (e) { rollback.push(e.message); }
        throw new Error(`${error.message} ${rollback.length ? 'Rollback incomplete or unverified: ' + rollback.join('; ') : 'Original frequency policy restored and verified.'}`);
      }
      return c.restore ? 'Earlier frequency limits restored for each processor class and verified in Windows policy.' : c.mhz ? `Maximum frequency set to ${c.mhz} MHz and verified in Windows policy.` : 'Maximum-frequency limit removed and verified in Windows policy.';
    }
    if (c.type === 'gpu-boost') {
      const gpu = state.gpus.find(g => g.id === c.id);
      if (!gpu?.boostCapability.available) throw new Error(gpu?.boostCapability.reason || 'GPU unavailable.');
      if (this.bridge instanceof PipeBridge) return await this.bridge.request('gpu-boost',{gpuId:gpu.id,enabled:c.enabled});
      const query = async () => autoBoostState(await this.run(this.smi,['-i',gpu.id,'--query-gpu=auto_boost.default','--format=csv,noheader,nounits']));
      const write = enabled => this.run(this.smi,['-i',gpu.id,`--auto-boost-default=${enabled?1:0}`]);
      const before=await query();
      if(before===null)throw new Error('GPU default auto-boost state is unavailable. Nothing changed.');
      try {
        await write(c.enabled);
        if(await query()!==c.enabled)throw new Error('GPU boost default read-back mismatch.');
      } catch(error) {
        const rollback=[];
        try{await write(before);}catch(e){rollback.push(e.message);}
        try{if(await query()!==before)rollback.push('GPU restoration read-back mismatch.');}catch(e){rollback.push(e.message);}
        throw new Error(`${error.message} ${rollback.length?'Rollback incomplete or unverified: '+rollback.join('; '):'Original GPU default restored and verified.'}`);
      }
      return 'GPU default auto-boost policy applied and verified.';
    }
    const fan = state.fans.find(f => f.id === c.id);
    if (!this.bridge || !fan?.capability.available) throw new Error(fan?.capability.reason || 'No supported writable fan control detected.');
    if ((fan.controlUnit === 'level' && c.mode === 'manual' && c.level === undefined) ||
        (fan.controlUnit !== 'level' && c.mode === 'manual' && c.percent === undefined)) throw new Error('Command unit does not match this fan controller.');
    const policy=state.fanProfiles?.manualTemperature;
    if(c.mode==='manual'&&c.id==='tpfc/cooling-system'&&policy&&policy.engineCelsius!==policy.celsius) {
      state=await this.setManualFanLimit(policy.automatic?null:policy.celsius,state);
    }
    try {
      await this.bridge.request('fan', { fanId: c.id, mode: c.mode, percent: c.percent, level: c.level });
      let verified = false;
      // Full speed takes longer: the engine reaches it through level 7 over more than one five-second cycle.
      const deadline = this.monotonicNow() + (c.level === FULL_SPEED_LEVEL ? 30000 : fan.controlUnit === 'level' ? 16000 : 0);
      do {
        await this.bridge.request('lease',{active:true});
        const after = await this.bridge.request('snapshot');
        const actual = after.fans.find(f => f.id === c.id);
        verified = actual?.mode === c.mode && (c.mode === 'auto' || (c.level !== undefined ? actual.level === c.level : Math.abs(actual.percent - c.percent) <= 1));
        if (verified || this.monotonicNow() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve,500));
      } while (true);
      if (!verified) throw new Error('Fan read-back mismatch.');
      return `Fan ${c.mode === 'auto' ? 'returned to firmware' : 'software control applied'} and verified.`;
    } catch (error) {
      // A transport/read error can occur after the physical write succeeded.
      let recoverySent = false;
      try { await this.bridge.request('fan',{fanId:c.id,mode:'auto'}); recoverySent = true; } catch {}
      throw new Error(`${error.message} ${recoverySent ? 'Firmware recovery requested; inspect engine state.' : 'Firmware recovery could not be sent; inspect hardware and watchdog state.'}`);
    }
  }
  async heartbeat(active) { if (this.bridge?.child) await this.bridge.request('lease', { active }); }
  async close() { this.bridge?.close(); }
}



