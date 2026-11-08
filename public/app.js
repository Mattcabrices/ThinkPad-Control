import {attachDesktop,hardwareAccessState} from './desktop.js';
const $ = selector => document.querySelector(selector);
const NS = 'http://www.w3.org/2000/svg';
const paths = {
  overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  cpu:'M7 7h10v10H7z M9 10h6v4H9z M8 3v4 M12 3v4 M16 3v4 M8 17v4 M12 17v4 M16 17v4 M3 8h4 M3 12h4 M3 16h4 M17 8h4 M17 12h4 M17 16h4',
  gpu:'M3 6h18v12H3z M7 18v3 M11 18v3 M15 18v3 M8 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M16 9v6 M19 9v6',
  fan:'M12 10c-7-8 4-12 4-5 0 2-2 3-4 5 M14 12c8-7 12 4 5 4-2 0-3-2-5-4 M12 14c7 8-4 12-4 5 0-2 2-3 4-5 M10 12C2 19-2 8 5 8c2 0 3 2 5 4 M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  sensors:'M3 12h4l3-8 4 16 3-8h4',
  advanced:'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  activity:'M4 12a8 8 0 1 0 2-5 M4 3v5h5 M12 7v5l3 2',
  temperature:'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0 M12 9v9',
  power:'M13 2L4 14h7l-1 8 10-13h-8z',
  board:'M4 3h16v18H4z M8 7h8v7H8z M8 17h1 M12 17h1 M16 17h1'
};
function icon(name) {
  const svg = document.createElementNS(NS,'svg');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','1.4'); svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round'); svg.setAttribute('aria-hidden','true');
  const path = document.createElementNS(NS,'path'); path.setAttribute('d',paths[name] || paths.sensors); svg.append(path); return svg;
}
function el(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text; return node;
}
function button(text, className, action) { const b = el('button',className,text); b.addEventListener('click',action); return b; }
function append(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function svgEl(tag, attributes) { const node = document.createElementNS(NS,tag); for (const [k,v] of Object.entries(attributes)) node.setAttribute(k,v); return node; }
const fmt = (value, decimals = 0) => value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined,{ maximumFractionDigits:decimals });
const views = [ ['overview','Overview'],['cpu','CPU & power'],['gpu','GPU'],['fan','Cooling'],['sensors','All sensors'],['activity','Activity'],['advanced','Advanced'] ];
const headings = {
  overview:['System overview','A clear view of your ThinkPad, with control where it counts.'],
  cpu:['CPU & power','Tune processor boost for plugged-in work and life on battery.'],
  gpu:['Graphics','GPU telemetry and the controls your driver actually supports.'],
  fan:['Cooling','Direct fan control, with firmware always within reach.'],
  sensors:['All sensors','Every exposed sensor. Real readings, without the guesswork.'],
  advanced:['Advanced','Optional extras. Nothing here is needed for normal use.'],
  activity:['Activity','A local record of requested changes and verified results.']
};
const state = { token:null, mode:'live', snapshot:null, history:[], activity:[], view:'overview', minutes:10, busy:false, stale:true, error:null, drafts:new Map(), search:'', stopped:false };
let toastTimer, refreshPromise;
async function api(path, body) {
  const timeout=path==='commands'&&(body?.type?.startsWith('fan-profile')||body?.type==='fan-manual-limit')?90000:45000;
  const response = await fetch(`/api/${path}`,{ method:body === undefined ? 'GET' : 'POST',
    headers:{'X-Control-Token':state.token || '',...(body === undefined ? {} : {'Content-Type':'application/json'})},
    body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(timeout) });
  const result = await response.json();
  if (!response.ok) { if(response.status===403&&path!=='session') state.token=null; throw new Error(result.error || 'Request failed.'); }
  return result;
}
function toast(message, error = false) {
  const box = $('#toast'); clearTimeout(toastTimer); box.textContent = message; box.className = error ? 'error' : ''; box.hidden = false;
  toastTimer = setTimeout(() => { box.hidden = true; },error ? 13000 : 6000);
}
async function command(value) {
  if (state.busy || state.stale) return null;
  state.busy = true; render();
  try {
    const result = await api('commands',value); state.snapshot = result.snapshot;
    if (value.type === 'ryzen-tune' && value.restore) {
      const restored = result.snapshot?.ryzen?.current?.[value.setting];
      if (Number.isFinite(restored)) {
        state.ryzenDrafts ||= new Map();
        state.ryzenDrafts.set(value.setting,String(Number(restored.toFixed(1))));
      }
    }
    if (value.type === 'fan') state.drafts.delete(value.id);
    if (value.type === 'fan-manual-limit') state.drafts.delete('manual-temperature');
    if (value.type === 'fan-profile-save' || value.type === 'fan-profile-delete') state.drafts.delete('fan-profile');
    toast(result.message);
    try { state.activity = await api('activity'); } catch { /* Verified control succeeded; history refresh can retry. */ }
    return result;
  } catch(e) { toast(e.message,true); return null; }
  finally { state.busy = false; await refresh(); }
}
function switchControl(title, description, value, capability, action) {
  const row = el('div','control-row');
  append(row,append(el('div'),el('span','control-name',title),el('div','control-description',description)));
  const toggle = button('',`switch${value === true ? ' on' : value === 'mixed' ? ' mixed' : ''}`,action);
  toggle.setAttribute('role','switch'); toggle.setAttribute('aria-checked',String(value === true));
  toggle.setAttribute('aria-label',`${title}${value === 'mixed' ? ' (AC and battery differ)' : ''}`);
  toggle.disabled = state.busy || state.stale || !capability?.available;
  toggle.title = capability?.available ? `Turn ${value === true ? 'off' : 'on'}` : capability?.reason || 'Unavailable';
  row.append(toggle);
  if (!capability?.available) row.firstChild.append(el('div','control-description warning-inline',capability?.reason || 'Unavailable'));
  return row;
}
function panel(title, iconName, subtitle, extra) {
  const box = el('section','panel'); const heading = el('div','panel-heading');
  const titleWrapper = el('div'); append(titleWrapper,append(el('div','panel-title'),icon(iconName),el('span','',title)),subtitle ? el('div','panel-subtitle',subtitle) : null);
  append(heading,titleWrapper,extra); box.append(heading); return box;
}
function sparkline(select) {
  const values = state.history.slice(-28).map(select).filter(v => Number.isFinite(v));
  const svg = svgEl('svg',{viewBox:'0 0 80 30',class:'spark','aria-hidden':'true'});
  if (values.length < 2) return svg;
  const low = Math.min(...values)-3, high = Math.max(...values)+3;
  const d = values.map((value,i) => `${i ? 'L' : 'M'}${(i/(values.length-1)*80).toFixed(1)},${(26-(value-low)/(high-low)*21).toFixed(1)}`).join(' ');
  svg.append(svgEl('path',{d,fill:'none',stroke:'currentColor','stroke-width':1.6})); return svg;
}
function metric(title, iconName, value, unit, detail, select, thermal = false, formatValue = fmt) {
  const box = el('article','metric'); const head = append(el('div','metric-header'),icon(iconName),el('span','',title));
  if (thermal && Number.isFinite(value)) head.append(el('span',`metric-health${value >= 80 ? ' warm' : ''}`,value >= 80 ? 'Warm' : 'Normal'));
  box.append(head);
  const number = append(el('div','metric-number'),el('strong',Number.isFinite(value) ? '' : 'metric-unknown',formatValue(value)),el('span','',unit));
  append(box,number,el('div','metric-detail',detail),select ? sparkline(select) : null); return box;
}
function systemThermal(s) { return s.motherboard?.temperature ?? s.firmware?.temperature ?? null; }
function metrics() {
  const s = state.snapshot, gpu = s.gpus[0], fan = s.fans[0];
  return append(el('div','metrics-grid'),
    metric('CPU temperature','cpu',s.cpu.temperature,'°C',s.cpu.temperature === null ? 'Sensor not exposed' : 'CPU package',h=>h.cpu.temperature,true),
    metric('GPU temperature','gpu',gpu?.temperature,'°C',gpu?.temperature == null ? 'Sensor not exposed' : 'GPU core',h=>h.gpus[0]?.temperature,true),
    metric(s.motherboard.temperature == null && s.firmware?.temperature != null ? 'Firmware thermal zone' : 'Motherboard','board',systemThermal(s),'°C',s.motherboard.temperature != null ? 'System temperature' : s.firmware?.temperature != null ? (s.firmware.zone + ' · ACPI') : 'Sensor not exposed',systemThermal,true),
    metric('Fan speed','fan',fan?.rpm,'RPM',fan ? fan.rpm === 0 ? 'Tachometer reports zero · rotation unconfirmed' : fan.mode === 'auto' ? 'Firmware controlled' : fan.mode === 'manual' ? 'Manual control' : fan.mode === 'curve' ? 'Fan curve' : 'Read-only tachometer' : 'No fan sensor exposed',h=>h.fans[0]?.rpm));
}
function chart() {
  const toolbar = el('div','chart-toolbar'), legend = el('div','legend');
  for (const [name,cls] of [['CPU','cpu'],['GPU','gpu'],[state.snapshot.motherboard.temperature == null ? 'Firmware zone' : 'Board','board']]) append(legend,append(el('span'),el('i',cls),document.createTextNode(name)));
  const segments = el('div','segments');
  for (const minutes of [1,10,30]) {
    const b = button(`${minutes}m`,state.minutes === minutes ? 'active' : '',async () => {
      state.minutes = minutes; state.history = await api(`history?minutes=${minutes}`).catch(() => []); render();
    }); b.setAttribute('aria-pressed',String(state.minutes === minutes)); segments.append(b);
  }
  append(toolbar,legend,segments);
  const box = panel('Thermal history','sensors','Temperatures over time',toolbar), wrap = el('div','chart-wrap');
  const svg = svgEl('svg',{viewBox:'0 0 900 205',preserveAspectRatio:'none',role:'img','aria-label':`CPU, GPU and system thermal-zone temperatures during the last ${state.minutes} minutes`});
  const left=40,right=886,top=12,bottom=171;
  for (const temp of [20,40,60,80,100]) {
    const y=bottom-(temp-20)/80*(bottom-top);
    svg.append(svgEl('line',{x1:left,y1:y,x2:right,y2:y,class:'chart-grid'}));
    const label=svgEl('text',{x:0,y:y+3,class:'chart-label'}); label.textContent=`${temp}°`; svg.append(label);
  }
  const end = Date.now(), start = end-state.minutes*60000;
  const samples = state.history.filter(s => Date.parse(s.at)>=start && Date.parse(s.at)<=end);
  for (let i=0;i<5;i++) {
    const label = svgEl('text',{x:left+(right-left)*i/4,y:197,class:'chart-label','text-anchor':i===0?'start':i===4?'end':'middle'});
    label.textContent = i===4 ? 'Now' : `${fmt(state.minutes*(1-i/4),1)}m ago`; svg.append(label);
  }
  for (const [name,selector] of [['cpu',s=>s.cpu.temperature],['gpu',s=>s.gpus[0]?.temperature],['board',systemThermal]]) {
    let d='', previousTime = null;
    for (const sample of samples) {
      const value=selector(sample), time=Date.parse(sample.at);
      if (!Number.isFinite(value)) { previousTime=null; continue; }
      const x=left+(time-start)/(end-start)*(right-left), y=bottom-(Math.max(20,Math.min(100,value))-20)/80*(bottom-top);
      d+=`${previousTime !== null && time-previousTime<16000 ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)} `; previousTime=time;
    }
    if (d) svg.append(svgEl('path',{d,class:`chart-line chart-${name}`}));
  }
  if (!samples.some(s=>Number.isFinite(s.cpu.temperature)||Number.isFinite(s.gpus[0]?.temperature)||Number.isFinite(systemThermal(s)))) {
    const label=svgEl('text',{x:470,y:95,'text-anchor':'middle',class:'chart-label'}); label.textContent='Temperature history appears when sensor readings arrive'; svg.append(label);
  }
  wrap.append(svg); box.append(wrap);
  append(box,append(el('div','chart-caption'),el('span','',`${state.mode==='demo' ? 'Simulated data' : 'Local history'} · sampled every 3 seconds`),el('span','','24-hour retention'))); return box;
}
function boostPanel(detailed=false) {
  const box=panel('Processor boost','power','Lets the CPU run above its rated speed when needed: faster, but hotter and louder.'); box.classList.add('control-panel');
  box.append(el('p','step-note','Processor boost on Overview and CPU & power controls the same setting. Turning it off in either place disables boost for that power source. CPU speed limit caps the requested frequency; No limit removes the cap but does not enable boost. Firmware power and temperature limits also constrain boost.'));
  const s=state.snapshot, cap=s.capabilities.cpuBoost, ac=s.boost ? s.boost.ac!==0 : null, dc=s.boost ? s.boost.dc!==0 : null;
  const all=ac===null ? null : ac===dc ? ac : 'mixed';
  append(box,
    switchControl('Everywhere','Turn boost on or off for both plugged-in and battery use.',all,cap,()=>command({type:'cpu-boost',source:'all',enabled:all!==true})),
    switchControl('Plugged in','Allow boost while on AC power.',ac,cap,()=>command({type:'cpu-boost',source:'ac',enabled:!ac})),
    switchControl('On battery','Allow boost while on battery.',dc,cap,()=>command({type:'cpu-boost',source:'dc',enabled:!dc})));
  if(detailed) {
    const maxCap=s.capabilities.cpuMaxBoost, max=s.cpuSteps?.maxBoost;
    const recovery=source=>s.cpuSteps?.maxBoostRecovery?.[source]===true;
    const maxSourceCap=source=>recovery(source)?{available:false,reason:'Finish boost recovery before enabling Maximum boost again.'}:maxCap;
    const limited=source=>{const limit=s.cpuSteps?.policy?.[source];return limit&&s.cpuSteps.baseMhz&&limit<=s.cpuSteps.baseMhz?` Your ${limit} MHz speed limit stays in force.`:'';};
    box.append(el('div','boost-section-label','Maximum boost enables Processor boost and sets Windows to favor performance over efficiency for the selected power source. It aims to keep boost active whenever workload and available headroom allow, including sustained workloads. It cannot hold a fixed boost clock continuously: idle time, CPU speed limit, power, temperature and firmware still govern actual speed.'));
    append(box,
      switchControl('Maximum boost: plugged in',`Enable boost and favor sustained performance on AC power. Keeps your CPU speed limit and firmware power limits.${limited('ac')}`,max?.ac??null,maxSourceCap('ac'),()=>command({type:'cpu-max-boost',source:'ac',enabled:!max?.ac})),
      switchControl('Maximum boost: on battery',`Enable boost and favor sustained performance on battery. Keeps your CPU speed limit and firmware power limits.${limited('dc')}`,max?.dc??null,maxSourceCap('dc'),()=>command({type:'cpu-max-boost',source:'dc',enabled:!max?.dc})));
    for(const [source,label] of [['ac','plugged in'],['dc','on battery']])if(recovery(source)) {
      const restore=button(`Finish boost recovery: ${label}`,'text-button',()=>command({type:'cpu-max-boost',source,enabled:false}));
      restore.disabled=state.busy||state.stale||!maxCap?.available;
      box.append(el('p','step-note',`A previous boost change ${label} could not be fully verified. Restore the saved recovery target before enabling Maximum boost again.`),restore);
    }
  }
  return box;
}
function stepChoice(mhz,hardware) {
  if(mhz===0)return {title:'No limit',detail:'Full speed'};
  const known=hardware?.available?hardware.states?.find(x=>x.mhz===mhz):null;
  if(known)return {title:known.label,detail:`${mhz} MHz`};
  const top=hardware?.available?Math.max(0,...(hardware.states??[]).map(x=>x.mhz)):0;
  if(hardware?.available&&mhz===hardware.boostMhz)return {title:'Max boost',detail:`${mhz} MHz`};
  return top&&mhz>top?{title:'Boost',detail:`Up to ${mhz} MHz`}:{title:`${mhz} MHz`,detail:'Speed limit'};
}
function clockGhz(mhz) { return Number.isFinite(mhz)?(mhz/1000).toFixed(2):'—'; }
function clockCaption(clock) {
  return clock?.source==='core-sensors'||clock?.source==='core-max-sensor'?'Highest current core clock':clock?.label??'Clock unavailable';
}
function stepsPanel() {
  const snapshot=state.snapshot, s=snapshot.cpuSteps, cap=snapshot.capabilities.cpuStep, box=panel('CPU speed limit','cpu','Choose how fast the CPU may run. Lower steps run cooler and quieter, and use less power.'); box.classList.add('control-panel');
  if (!s?.policy||!cap?.available) {box.append(el('p','big-info',cap?.reason||'Speed limits are unavailable on this system.'));return box;}
  const disabled=state.busy||state.stale, h=s.hardware;
  box.append(append(el('div','step-summary'),append(el('div'),el('span','clock-heading','CPU speed'),el('span','step-now',Number.isFinite(s.currentMhz)?`${clockGhz(s.currentMhz)} GHz`:'Speed not reported'),el('span','clock-caption',clockCaption(s.clock))),el('span','step-base',[s.baseMhz?`Rated speed ${clockGhz(s.baseMhz)} GHz`:'',h?.available&&h.boostMhz?`boost up to ${clockGhz(h.boostMhz)} GHz`:''].filter(Boolean).join(' · '))));
  const cores=el('ul','core-clocks');cores.setAttribute('aria-label','Current speed of each reporting CPU core');
  for(const core of s.clock?.perCore??[])cores.append(append(el('li'),el('span','',core.name),el('strong','',`${clockGhz(core.mhz)} GHz`)));
  if(cores.children.length)box.append(cores);
  else box.append(el('p','step-footnote','Individual core speeds are unavailable.'));
  const averages=[Number.isFinite(s.clock?.averageMhz)?`Average core speed${s.clock.sampledCoreCount?` (${s.clock.sampledCoreCount} reporting cores)`:''}: ${clockGhz(s.clock.averageMhz)} GHz`:null,Number.isFinite(s.clock?.effectiveMhz)?`Idle-adjusted speed (effective): ${clockGhz(s.clock.effectiveMhz)} GHz`:null].filter(Boolean);
  if(averages.length){
    const details=el('details','clock-details');details.open=!!state.clockDetailsOpen;
    details.addEventListener('toggle',()=>{state.clockDetailsOpen=details.open;});
    details.append(el('summary','','Clock details'),el('p','',averages.join(' · ')));
    if(s.clock?.sampledCoreCount)details.append(el('p','','Average core speed adds the reported core speeds and divides by the number of reporting cores.'));
    if(Number.isFinite(s.clock?.effectiveMhz))details.append(el('p','','Effective speed includes time spent resting. A core running at 3.00 GHz for half the sample and sleeping for the other half averages about 1.50 GHz effective. A low value is normal when the CPU has little to do.'));
    box.append(details);
  }
  const limits=snapshot.ryzen?.current, power=snapshot.cpu?.power, temperature=snapshot.cpu?.temperature;
  const atPower=Number.isFinite(power)&&limits?.slowWatts&&power>=limits.slowWatts-0.5, atHeat=Number.isFinite(temperature)&&limits?.temperatureLimit&&temperature>=limits.temperatureLimit-1;
  if(atPower||atHeat)box.append(el('p','step-status',atHeat?`At the ${Math.round(limits.temperatureLimit)} °C temperature limit, which can hold back boost.`:`At the ${Number(limits.slowWatts.toFixed(1))} W average power limit, which can hold back boost.`));
  for (const [source,name] of [['ac','Plugged in'],['dc','On battery']]) {
    const current=s.policy[source], baseline=s.baseline?.[source], class1=h?.hybrid?s.policy.class1?.[source]:null, mixed=class1!=null&&class1!==current, custom=current!==0&&!s.ladder.includes(current);
    const row=el('div','step-source'), chips=el('div','step-chips');
    chips.setAttribute('role','group'); chips.setAttribute('aria-label',`${name} speed limit`);
    if(custom){const chip=button('',`step-chip${mixed?'':' active'}`,()=>{});append(chip,el('strong','','Custom'),el('span','',`${current} MHz`));chip.setAttribute('aria-pressed',String(!mixed));chip.disabled=disabled;chips.append(chip);}
    for (const mhz of [0,...s.ladder]) {
      const choice=stepChoice(mhz,h), active=mhz===current&&!mixed, chip=button('',`step-chip${active?' active':''}`,()=>{if(!active)command({type:'cpu-step',source,mhz});});
      append(chip,el('strong','',choice.title),el('span','',choice.detail)); chip.setAttribute('aria-pressed',String(active)); chip.setAttribute('aria-label',`${name}: ${choice.title}, ${choice.detail}`); chip.disabled=disabled; chips.append(chip);
    }
    const head=append(el('div','step-head'),el('strong','',name));
    if(baseline!=null&&(baseline!==current||(h?.hybrid&&s.baseline?.class1?.[source]!==class1))){const undo=button('Undo: restore earlier limits','text-button',()=>command({type:'cpu-step',source,restore:true}));undo.disabled=disabled;head.append(undo);}
    append(row,head,chips);
    if(mixed)row.append(el('p','step-note',`Processor classes currently have different limits: class 0 ${current||'unlimited'}${current?' MHz':''}, class 1 ${class1||'unlimited'}${class1?' MHz':''}. Choosing a speed applies it to both classes; Undo restores their earlier individual limits.`));
    box.append(row);
  }
  box.append(el('p','step-footnote',h?.available?`P-states are read directly from your processor (${h.source}).${h.boostMhz||h.cppc?' Boost steps are limits, not states: firmware picks the actual speed from power, temperature and busy cores.':h.cppcEnabled?' Firmware may also choose speeds between them.':''}`:(h?.reason||'Hardware P-states are unavailable.')));
  box.append(el('p','step-footnote',"A limit stays on after you close this app, through the active Windows power plan. Voltage isn't changed, and firmware still makes the final decision."));
  return box;
}
function showRyzenTuning(snapshot) {
  return /^(?:AuthenticAMD|AMD|Advanced Micro Devices(?:,?\s*Inc\.?)?)$/i.test(snapshot.cpuSteps?.vendor??'')&&/\bRyzen\b/i.test(snapshot.cpu?.name??'');
}
function showCpuTuning(snapshot) { return snapshot.cpuSteps?.vendor==='GenuineIntel'||showRyzenTuning(snapshot); }
function intelTuningPanel() {
  const box=panel('Intel tuning capabilities','cpu',null,el('span','panel-pill','WINDOWS POLICY'));
  const limits=state.snapshot.cpuSteps?.hardware?.powerLimits;
  if(limits?.available){
    box.append(el('p','big-info','Package power-limit settings · read-only · captured when hardware access connected. These are configured limits, not live power consumption; other firmware limits may also apply. Reconnect hardware access to refresh.'));
    for(const [key,label] of [['pl1','Sustained power · PL1'],['pl2','Burst power · PL2']]){
      const limit=limits[key];
      if(limit)box.append(append(el('div','ryzen-row'),el('strong','',label),el('span','',`${fmt(limit.watts,2)} W · ${limit.enabled?'Enabled':'Disabled'} · window ${fmt(limit.windowSeconds,4)} s · clamping ${limit.clamp?'on':'off'}`)));
    }
    box.append(el('p','metric-detail',`Firmware register lock: ${limits.locked===true?'locked':limits.locked===false?'unlocked':'unknown'}. ${limits.locked===false?'An unlocked register does not mean this app can edit it.':''}`));
  }else box.append(el('p','big-info',limits?.reason||'Package power-limit readings are unavailable. Supported Intel models require working hardware access.'));
  box.append(el('p','big-info','Use Processor boost, Maximum boost and CPU speed limit above to control Windows performance policy on AC power or battery. Supported hybrid processors apply the relevant policies to both processor classes.'));
  box.append(el('p','metric-detail','Direct Intel sustained and burst power-limit adjustments (PL1/PL2) are not implemented. The current hardware backend reads supported Intel registers but cannot write these limits. Voltage and multiplier tuning are also unavailable.'));
  box.append(el('p','metric-detail','Maximum boost favors performance whenever workload, power, cooling and firmware allow. It does not remove the CPU speed limit or override firmware power limits.'));
  return box;
}
function advancedCpuTuning() {
  const ryzen=showRyzenTuning(state.snapshot);
  const details=el('details','advanced-panel'); details.open=!!state.ryzenOpen;
  details.setAttribute('data-tuning-vendor',ryzen?'amd-ryzen':'intel');
  details.addEventListener('toggle',()=>{state.ryzenOpen=details.open;});
  const summary=el('summary'); append(summary,el('strong','','Advanced: CPU tuning'),el('span','',ryzen?'Set sustained power, burst power and CPU temperature limits directly in Ryzen firmware. Works together with Processor boost and CPU speed limit.':'Intel performance controls and direct power-tuning availability. Works together with Processor boost and CPU speed limit.'));
  return append(details,summary,ryzen?ryzenPanel():intelTuningPanel());
}
function ryzenPanel() {
  const r=state.snapshot.ryzen, box=panel('Advanced Ryzen tuning','cpu',null,el('span','panel-pill','DIRECT SMU · EXPERIMENTAL'));
  if (!r?.current) {box.append(el('p','big-info',r?.reason||'Enable hardware access to discover compatible Ryzen controls.'));return box;}
  box.append(el('p','big-info','Control the power budget for sustained and short workloads, plus the CPU temperature ceiling, directly in Ryzen firmware. These limits set the headroom available for boost; they do not enable Processor boost or remove the CPU speed limit.'));
  box.append(el('p','metric-detail','Every change must match firmware read-back. Raising a requested limit does not guarantee higher sustained wattage or faster clocks. Unsupported settings are read-only.'));
  box.append(el('p','metric-detail','For sustained boosting under load, use Maximum boost for the intended power source and choose a CPU speed limit that permits boost, or No limit. Turning Processor boost off on Overview or CPU & power prevents boosting even with higher Ryzen power limits. Actual clocks still depend on workload, cooling and firmware. Changes here are manual and Lenovo firmware may overwrite them; the app does not automatically reapply them.'));
  for(const [source,label] of [['ac','Plugged in'],['dc','On battery']]){
    const mode=state.snapshot.boost?.[source],limit=state.snapshot.cpuSteps?.policy?.[source];
    const boost=Number.isFinite(mode)?mode===0?'Processor boost is off; raising these limits will not enable it.':'Processor boost is enabled.':'Processor boost status is unavailable.';
    box.append(el('p','metric-detail',`${label}: ${boost}${Number.isFinite(limit)?limit===0?' CPU speed limit: No limit.':` CPU speed limit: ${limit} MHz; it remains in force.`:''}`));
  }
  box.append(el('p','metric-detail',r.status||''));
  if(!r.available)box.append(el('p','big-info',r.reason));
  state.ryzenDrafts ||= new Map();
  for(const [key,label,unit] of [['sustainedWatts','Sustained power · STAPM','W'],['fastWatts','Burst power · PPT fast','W'],['slowWatts','Average power · PPT slow','W'],['temperatureLimit','CPU temperature limit','°C']]) {
    const field=r.fields?.[key], blocked=field?.available===false, readOnly=blocked&&field?.restoreAvailable===false;
    const range=r.ranges[key], input=el('input','ryzen-input');input.type='number';input.min=range.min;input.max=range.max;input.step=key==='temperatureLimit'?'1':'0.1';input.value=blocked?Number(r.current[key].toFixed(1)):state.ryzenDrafts.get(key)??Math.max(range.min,Math.min(range.max,Number(r.current[key].toFixed(1))));input.setAttribute('aria-label',label);input.disabled=state.busy||state.stale||!r.available||blocked;
    if(blocked)input.title=field.reason||'Firmware changes are unavailable for this setting.';
    input.addEventListener('input',()=>state.ryzenDrafts.set(key,input.value));
    const apply=button('Apply','button primary',()=>{if(input.reportValidity())command({type:'ryzen-tune',setting:key,value:Number(input.value),restore:false});});apply.disabled=input.disabled;
    const restore=button('Restore baseline','button',()=>command({type:'ryzen-tune',setting:key,restore:true}));restore.disabled=state.busy||state.stale||!r.available||r.baseline?.[key]==null||r.fields?.[key]?.restoreAvailable===false;
    const row=el('div',`ryzen-row${blocked?' ryzen-read-only':''}`), name=append(el('div'),el('strong','',label));
    if(blocked)name.append(el('span','tuning-readonly',readOnly?'Read-only':'Custom changes unavailable'));
    name.append(el('div','metric-detail',`Current ${fmt(r.current[key],1)} ${unit} · connection baseline ${fmt(r.baseline?.[key],1)} ${unit}`));
    append(row,name,append(el('div','fan-actions'),input,el('span','',unit),apply,restore));
    if(blocked)row.append(el('p','metric-detail',field.reason||'Firmware changes are unavailable for this setting.'));
    if(blocked&&!readOnly&&!restore.disabled)row.append(el('p','metric-detail','New values are disabled. Restore baseline remains available for recovery.'));
    box.append(row);
  }
  box.append(el('p','fan-explanation','Restore baseline uses the value observed when this hardware worker connected; it is not a factory reset. Limits may remain active after closing the app until firmware replaces them. After changing AC/battery source, reconnect hardware access before tuning. Voltage, multipliers and unsupported GPU controls are not exposed.'));
  return box;
}

// Each level is held long enough for a settled reading. Closing the window or returning
// to firmware ends measurement. Minimizing preserves control. The earlier curve is put back.
async function measureFanLevels(id) {
  if(state.measuring) return;
  const curve=state.snapshot.fanProfiles?.activeId; state.measuring=true; render(true);
  const held=level=>{ const fan=state.snapshot.fans.find(f=>f.id===id); return fan?.mode==='manual'&&fan.level===level; };
  let finished=true;
  try {
    for(const level of [1,2,3,4,5,6,7,64]) {
      await command({type:'fan',id,mode:'manual',level});
      const until=Date.now()+(state.snapshot.fanLevels?.settleSeconds??15)*1000+6000;
      while(Date.now()<until&&held(level)) await new Promise(resolve=>setTimeout(resolve,1000));
      if(!held(level)){ finished=false; break; }
    }
  } finally {
    state.measuring=false;
    await command({type:'fan',id,mode:'auto'});
    if(curve) await command({type:'fan-profile-apply',id:curve});
    toast(finished?'Fan levels measured.':'Measuring stopped early. Readings so far are kept.',!finished);
  }
}
function fanPanel() {
  const box=panel('Fan control','fan',null,el('span','panel-pill','DIRECT CONTROL')); box.classList.add('control-panel');
  if (!state.snapshot.fans.length) {
    box.append(append(el('div','empty-state'),el('strong','','No writable fan interface detected'),el('span','','The native bridge can expose supported fan controls and tachometers. ThinkPad EC fan support still needs a validated model adapter.'),button('Open setup ↗','text-button',()=>$('#setup-dialog').showModal()))); return box;
  }
  for (const fan of state.snapshot.fans) {
    const row=el('div','fan-control'), top=el('div','fan-top');
    const info=append(el('div'),el('div','fan-name',fan.name),el('div','fan-rpm',`${fan.secondaryRpm!=null?'Fan 1: ':''}${fmt(fan.rpm)} RPM${fan.secondaryRpm!=null?' · Fan 2: '+fmt(fan.secondaryRpm)+' RPM':''} · ${fan.mode==='auto'?'Firmware automatic':fan.mode==='manual'?'Manual control':fan.mode==='curve'?'Fan curve':'Mode unavailable'}`));
    if(fan.rpm===0) info.append(el('div','metric-detail','EC tachometer reports zero; this does not confirm the fan is stopped.'));
    const select=el('select','mode-select'); select.setAttribute('aria-label',`${fan.name} mode`);
    // A running curve is shown as it is. It is set from Fan curves and profiles, so it isn't a mode to apply here.
    for (const [value,label] of [...(fan.mode==='curve'?[['curve','Fan curve']]:[]),['auto','Firmware / automatic'],['manual','Manual control']]) { const option=el('option','',label); option.value=value; select.append(option); }
    const isLevel=fan.controlUnit==='level';
    const draft=state.drafts.get(fan.id) || {mode:fan.mode==='manual'?'manual':fan.mode==='curve'?'curve':'auto',percent:isLevel?Math.min(fan.level??4,7):Math.max(30,Math.round(fan.percent??50))};
    select.value=draft.mode; select.disabled=state.busy||state.stale||!fan.capability.available;
    select.addEventListener('change',()=>{ state.drafts.set(fan.id,{...draft,mode:select.value}); render(true); });
    append(top,info,select); row.append(top);
    const range=el('input'); range.type='range'; range.min=isLevel?'1':'30'; range.max=isLevel?'7':'100'; range.step='1'; range.value=String(draft.percent);
    range.setAttribute('aria-label',`${fan.name} manual speed`); range.disabled=select.disabled||draft.mode!=='manual';
    const output=el('output','slider-output',`${draft.percent}${isLevel?' / 7':'%'}`);
    range.addEventListener('input',()=>{ output.textContent=`${range.value}${isLevel?' / 7':'%'}`; state.drafts.set(fan.id,{...draft,percent:Number(range.value)}); });
    append(row,append(el('div','slider-row'),range,output),append(el('div','slider-marks'),el('span','',isLevel?'Level 1 · low':'30% · minimum'),el('span','',isLevel?'Level 7 · high':'100%')));
    const apply=button('Apply change','button primary',()=>{
      const value=state.drafts.get(fan.id)||draft;
      command({type:'fan',id:fan.id,mode:value.mode,...(value.mode==='manual'?(isLevel?{level:value.percent}:{percent:value.percent}):{})});
    }); apply.disabled=select.disabled||draft.mode==='curve';
    const restore=button('Return to firmware','button',()=>command({type:'fan',id:fan.id,mode:'auto'})); restore.disabled=select.disabled;
    const fullSpeed=isLevel?button(fan.level===64?'Level 10 is on':'Level 10 · Boost mode','button',()=>command({type:'fan',id:fan.id,mode:'manual',level:64})):null;
    if(fullSpeed) fullSpeed.disabled=select.disabled||fan.level===64;
    if(fan.level===64) info.append(el('div','metric-detail','Max fan mode: highest, unregulated speed.'));
    const policy=state.snapshot.fanProfiles?.manualTemperature;
    append(row,append(el('div','fan-actions'),apply,fullSpeed,restore),isLevel?el('p','fan-explanation curve-notice','Max fan mode (Level 10) runs the fan at its highest, unregulated speed. Expect more noise and wear with extended use.'):null,isLevel?el('p','fan-explanation','Manual Max mode takes about 10 seconds to spin up. Minimizing keeps manual control active. Closing the window returns manual control to firmware. A saved fan curve continues in either case. Fan Max mode does not enable CPU boost or raise CPU power limits.'):null,el('p','fan-explanation',fan.capability.available ? `Manual control returns to firmware if the connection expires for 10 seconds, readings become unavailable, or monitored temperatures reach ${isLevel?policy?.celsius??85:85}°C. This includes manual Max mode.` : fan.capability.reason));
    if(isLevel&&policy) {
      const saved=state.drafts.get('manual-temperature')??{automatic:policy.automatic,celsius:policy.celsius};
      const automatic=el('input');automatic.type='checkbox';automatic.checked=saved.automatic;automatic.setAttribute('aria-label','Use laptop thermal limit for manual fan control');
      const temperature=el('input','mode-select');temperature.type='number';temperature.min='60';temperature.max='110';temperature.step='1';temperature.value=String(saved.celsius);temperature.setAttribute('aria-label','Manual fan temperature limit in Celsius');temperature.disabled=saved.automatic;
      const remember=()=>state.drafts.set('manual-temperature',{automatic:automatic.checked,celsius:Number(temperature.value)});
      automatic.addEventListener('change',()=>{temperature.disabled=automatic.checked;remember();});temperature.addEventListener('input',remember);
      const save=button('Save temperature limit','button',()=>{const draft=state.drafts.get('manual-temperature')??saved;command({type:'fan-manual-limit',celsius:draft.automatic?null:draft.celsius});});
      automatic.disabled=save.disabled=state.busy||state.stale||!fan.capability.available||fan.mode==='manual';temperature.disabled=automatic.disabled||saved.automatic;
      row.append(el('h3','','Manual fan temperature limit'),append(el('label','fan-explanation'),automatic,el('span','',` Use laptop thermal limit (${policy.defaultCelsius}°C)`)),append(el('div','fan-actions'),temperature,el('span','','°C'),save),el('p','fan-explanation','Choose 60–110°C. Applies to manual levels and manual Max; at the cutoff the worker requests firmware control. This does not raise CPU thermal limits. Return to firmware before changing this setting.'));
    }
    box.append(row);
  }
  const snapshot=state.snapshot, firmware=snapshot.fanProfiles?.limit;
  const intelTarget=snapshot.cpuSteps?.hardware?.thermalTargetC;
  const reported=firmware??(Number.isFinite(intelTarget)?{celsius:intelTarget,source:'Intel thermal target'}:null);
  box.append(el('p','fan-explanation',`${snapshot.cpu.name}: ${reported?`reported ${reported.source} is ${reported.celsius} \u00b0C.`:'A firmware thermal target is unavailable; the default manual cutoff is 85°C.'} This is not a verified thermal-junction maximum. Saved curves reach Max at their own Max temperature, independently of the manual cutoff. Manual mode has no fixed total run-time limit while the connection and temperature checks pass.`));
  return box;
}
function fanProfilesPanel() {
  const fp=state.snapshot.fanProfiles, actual=state.snapshot.fans?.find(f=>f.id==='tpfc/cooling-system')??state.snapshot.fans?.find(f=>f.controlUnit==='level');
  const running=actual?.mode==='curve';
  const box=panel('Fan curves and profiles','fan',null,el('span','panel-pill',running?'CURVE ACTIVE':actual?.mode==='manual'?'MANUAL CONTROL':actual?.mode==='auto'?'FIRMWARE CONTROL':'STATE UNAVAILABLE')); box.classList.add('control-panel','fan-profiles');
  if(!fp?.available){ box.append(append(el('div','empty-state'),el('strong','','Fan curves are unavailable'),el('span','',fp?.reason||'Enable hardware access to read this laptop\'s firmware limit.'))); return box; }
  const limit=fp.limit.celsius, profiles=fp.profiles, disabled=state.busy||state.stale||state.profileApplying;
  const stored=state.drafts.get('fan-profile'), selected=profiles.find(p=>p.id===(stored?.id??fp.activeId))??(stored?.id===null?null:profiles[0]);
  const draft=stored??{id:selected?.id??null,name:selected?.name??'',fanOff:selected?.fanOff??true,levels:[...(selected?.levels??profiles[0]?.levels??[])],maxTemp:selected?.maxTemp??limit};
  draft.maxTemp??=limit;
  let refreshActions=()=>{};
  const keep=()=>{state.drafts.set('fan-profile',draft);refreshActions();};
  const current=fp.activeId?profiles.find(p=>p.id===fp.activeId)?.name:null;
  box.append(el('p','fan-explanation',`${running?(current?`Running "${current}".`:'Running a curve that differs from the saved profiles.'):actual?.mode==='manual'?'Manual fan control is active. Applying a profile will switch to its curve.':actual?.mode==='auto'?'Firmware currently controls the fan. Apply a profile to activate its curve.':'Current fan mode is unavailable.'} Applied curves keep running with the app closed and after a restart.`));
  box.append(el('p','fan-explanation curve-notice',`Max mode (Level 10) is the fan's highest, unregulated speed. Set its start temperature below or at the firmware thermal limit of ${limit} \u00b0C (${fp.limit.source}). Level 7 must start below Max. Unlike manual mode, the service runs this curve while the window is minimized or closed.`));
  const slotName=slot=>`EC temperature ${slot+1}`;
  if(fp.maskedSlots?.length) box.append(el('p','fan-explanation',`Adjusted for this curve: ${fp.maskedSlots.map(([slot,shift])=>`${slotName(slot)} reads ${shift} °C lower`).join(', ')}, because it stayed flat while the CPU temperature moved. If it heats up, it can still raise the fan, but later.`));
  if(fp.reapply) {
    const changedFlat=(fp.flatSlots??[]).filter(f=>!(fp.maskedSlots??[]).some(([slot,shift])=>slot===f.slot&&shift===f.shift));
    if(changedFlat.length) box.append(el('p','fan-explanation curve-notice',`${changedFlat.map(f=>`${slotName(f.slot)} has stayed at ${f.value} °C`).join(', ')} while the CPU temperature moved, which can stop the fan stepping down. Apply the profile again to account for this.`));
    if(fp.removedSlots?.length) box.append(el('p','fan-explanation curve-notice',`Fresh measurements show ${fp.removedSlots.map(slotName).join(', ')} changing. Apply the profile again to remove those adjustments and count their real readings.`));
  }
  const picker=el('select','mode-select'); picker.setAttribute('aria-label','Fan profile'); picker.disabled=disabled;
  for(const p of profiles){ const option=el('option','',p.valid?p.name:`${p.name} (needs editing)`); option.value=p.id; picker.append(option); }
  const fresh=el('option','','New profile'); fresh.value=''; picker.append(fresh); picker.value=draft.id??'';
  picker.addEventListener('change',()=>{ const p=profiles.find(x=>x.id===picker.value); state.drafts.set('fan-profile',p?{id:p.id,name:p.name,fanOff:p.fanOff,levels:[...p.levels],maxTemp:p.maxTemp??limit}:{...draft,id:null,name:''}); render(true); });
  const name=el('input','profile-name'); name.type='text'; name.maxLength=40; name.value=draft.name; name.placeholder='Profile name'; name.setAttribute('aria-label','Profile name'); name.disabled=disabled;
  name.addEventListener('input',()=>{ draft.name=name.value; keep(); });
  box.append(append(el('div','profile-top'),picker,name));
  const steps=el('div','curve-steps'); steps.setAttribute('aria-hidden','true');
  const span=Math.max(limit-fp.minTemp,1), bars=[], outputs=[], ranges=[];
  const redraw=()=>draft.levels.forEach((temp,i)=>{ const next=draft.levels[i+1]??draft.maxTemp; bars[i].style.setProperty('left',`${(temp-fp.minTemp)/span*100}%`); bars[i].style.setProperty('width',`${(next-temp)/span*100}%`); bars[i].style.setProperty('height',`${(i+1)/8*100}%`); outputs[i].textContent=`${temp} °C`; ranges[i].value=String(temp); });
  const rows=el('div','curve-rows');
  draft.levels.forEach((temp,i)=>{
    const bar=el('span','curve-bar'); bars.push(bar); steps.append(bar);
    const range=el('input'); range.type='range'; range.min=String(fp.minTemp+i); range.max=String(draft.maxTemp-(7-i)); range.step='1'; range.value=String(temp); range.disabled=disabled; range.setAttribute('aria-label',`Level ${i+1} start temperature`); ranges.push(range);
    const output=el('output','slider-output',`${temp} °C`); outputs.push(output);
    // Neighbouring levels move out of the way, so levels always rise with temperature.
    range.addEventListener('input',()=>{ const value=Number(range.value); draft.levels[i]=value; for(let k=i+1;k<7;k++)draft.levels[k]=Math.max(draft.levels[k],value+(k-i)); for(let k=i-1;k>=0;k--)draft.levels[k]=Math.min(draft.levels[k],value-(i-k)); keep(); redraw(); });
    rows.append(append(el('div','slider-row curve-row'),el('span','curve-label',`Level ${i+1} starts`),range,output));
  });
  const maxBar=el('span','curve-bar'); steps.append(maxBar);
  const maxRange=el('input'); maxRange.type='range'; maxRange.min=String(fp.minTemp+7); maxRange.max=String(limit); maxRange.step='1'; maxRange.value=String(draft.maxTemp); maxRange.disabled=disabled; maxRange.setAttribute('aria-label','Max mode start temperature');
  const maxOutput=el('output','slider-output',`${draft.maxTemp} °C`);
  const redrawMax=()=>{ maxOutput.textContent=`${draft.maxTemp} °C`; maxRange.value=String(draft.maxTemp); maxBar.style.setProperty('left',`${(draft.maxTemp-fp.minTemp)/span*100}%`); maxBar.style.setProperty('width',`${(limit-draft.maxTemp)/span*100}%`); maxBar.style.setProperty('height','100%'); ranges.forEach((r,i)=>r.max=String(draft.maxTemp-(7-i))); redraw(); };
  maxRange.addEventListener('input',()=>{ draft.maxTemp=Number(maxRange.value); for(let i=6;i>=0;i--)draft.levels[i]=Math.min(draft.levels[i],draft.maxTemp-(7-i)); keep(); redrawMax(); });
  rows.append(append(el('div','slider-row curve-row'),el('span','curve-label','Max mode starts'),maxRange,maxOutput));
  const axis=append(el('div','curve-axis'),el('span','',`${fp.minTemp} °C`),el('span','',`Thermal limit ${limit} °C`));
  box.append(steps,axis,rows); redrawMax();
  const stopLabel=el('label','curve-check'), stop=el('input'); stop.type='checkbox'; stop.checked=draft.fanOff; stop.disabled=disabled;
  stop.addEventListener('change',()=>{ draft.fanOff=stop.checked; keep(); }); append(stopLabel,stop,el('span','','Let the fan stop below level 1')); box.append(stopLabel);
  const saveDraft=async()=>{
    const edits={name:draft.name.trim(),fanOff:draft.fanOff,levels:[...draft.levels],maxTemp:draft.maxTemp};
    const result=await command({type:'fan-profile-save',...(draft.id?{id:draft.id}:{}),...edits});
    if(!result)return null;
    const kept=result.snapshot.fanProfiles.profiles.find(p=>p.name===edits.name);
    if(kept){state.drafts.set('fan-profile',{id:kept.id,...edits});render(true);}
    return kept??null;
  };
  const save=button('Save profile','button',saveDraft);
  const isUnchanged=()=>selected?.id===draft.id&&selected?.name===draft.name.trim()&&selected?.fanOff===draft.fanOff&&JSON.stringify(selected?.levels)===JSON.stringify(draft.levels)&&(selected?.maxTemp??limit)===draft.maxTemp;
  const apply=button(state.profileApplying?'Applying…':isUnchanged()?'Apply profile':'Save and apply','button primary',async()=>{
    if(state.profileApplying||state.busy||state.stale)return;
    state.profileApplying=true;render(true);
    try { const saved=isUnchanged()?selected:await saveDraft(); if(saved)await command({type:'fan-profile-apply',id:saved.id}); }
    finally {state.profileApplying=false;render(true);}
  }); apply.disabled=disabled;
  const remove=button('Delete','button',()=>command({type:'fan-profile-delete',id:draft.id})); remove.disabled=disabled||!draft.id;
  const firmware=button('Use firmware control','button',()=>command({type:'fan-profile-firmware'})); firmware.disabled=disabled||!fp.curveSet; save.disabled=disabled;
  const progress=el('p','fan-explanation');progress.setAttribute('role','status');
  refreshActions=()=>{
    apply.textContent=state.profileApplying?'Applying…':isUnchanged()?'Apply profile':'Save and apply';
    progress.textContent=state.profileApplying?'Applying profile: handing cooling to firmware, reconnecting the engine, and checking the running curve…':!isUnchanged()?'Edits are not active yet. Save profile stores them; Save and apply also activates them.':'Apply profile activates this saved curve. Firmware controls cooling briefly while the engine reconnects.';
  };
  refreshActions();append(box,append(el('div','fan-actions'),apply,save,remove,firmware),progress);
  return box;
}
// Optional. Everything else works without it.
function fanSpeedsPanel() {
  const box=panel('Measured fan speeds','fan',null,el('span','panel-pill','OPTIONAL')); box.classList.add('control-panel','fan-speeds');
  const fan=state.snapshot.fans.find(f=>f.controlUnit==='level');
  if(!fan){ box.append(append(el('div','empty-state'),el('strong','','No fan with levels detected'),el('span','','This needs the bundled fan engine and hardware access.'))); return box; }
  const learned=state.snapshot.fanLevels??{speeds:{}}, levels=[1,2,3,4,5,6,7,64];
  box.append(el('p','fan-explanation','You don\'t need this for normal use. The app notes what each level really does on this laptop whenever a level runs for a while. Measuring just fills in the rest. Speeds come from this laptop\'s own readings and aren\'t estimates.'));
  const list=el('div','speed-list');
  for(const level of levels) list.append(append(el('div','speed-row'),el('span','',level===64?'Level 10 / Boost mode':`Level ${level}`),el('strong','',learned.speeds[level]?`About ${fmt(learned.speeds[level])} RPM`:'Not measured yet')));
  box.append(list);
  const same=levels.filter(level=>level<=7&&learned.speeds[level]&&learned.speeds[level]===learned.speeds[7]);
  const notes=[];
  if(same.length>1) notes.push(`Levels ${same[0]} to 7 read the same speed here, so the higher ones may not add cooling.`);
  if(learned.firmwarePeak) notes.push(`The highest firmware reading seen here is ${fmt(learned.firmwarePeak)} RPM.`);
  if(notes.length) box.append(el('p','fan-explanation',notes.join(' ')));
  const measure=button(state.measuring?'Measuring…':'Measure all levels','button',()=>measureFanLevels(fan.id)); measure.disabled=state.busy||state.stale||!fan.capability.available||!!state.measuring;
  append(box,append(el('div','fan-actions'),measure),el('p','fan-explanation','Runs each level for about 25 seconds. It takes about 4 minutes and gets loud. To stop it, use Return to firmware on the Cooling page. Minimizing keeps the test running; closing the window stops manual control.'));
  return box;
}
function gpuPanels() {
  const boxes=[];
  for (const gpu of state.snapshot.gpus) {
    const box=panel(gpu.name,'gpu',`${gpu.vendor} · ${gpu.id}`);
    const grid=el('div','detail-grid');
    append(grid,metric('GPU temperature','temperature',gpu.temperature,'°C','Core temperature',null,true),metric('GPU utilization','gpu',gpu.load,'%','Graphics load'),metric('Core clock','sensors',gpu.clock,'MHz','Current frequency'));
    const inside=el('div','big-info'); inside.append(grid); box.append(inside);
    append(box,switchControl('Independent GPU boost','Driver default auto-boost policy. Availability depends on the GPU and driver.',gpu.boost,gpu.boostCapability,()=>command({type:'gpu-boost',id:gpu.id,enabled:!gpu.boost})));
    if (gpu.memoryTotal!=null) box.append(el('div','big-info',`Video memory: ${fmt(gpu.memoryUsed)} / ${fmt(gpu.memoryTotal)} MB${gpu.power!=null ? ` · GPU power: ${fmt(gpu.power,1)} W` : ''}`));
    boxes.push(box);
  }
  if (!boxes.length) boxes.push(append(panel('Graphics','gpu'),el('div','empty-state','No GPU inventory available. Configure the native bridge or check Windows inventory permissions.')));
  return boxes;
}
// Device, then category, then readings, with the lowest and highest seen since the app opened.
const SENSOR_CATEGORIES=[['Temperature','Temperatures'],['Fan','Fans'],['Control','Fan controls'],['Voltage','Voltages'],['Current','Currents'],['Power','Powers'],['Clock','Clocks'],['Load','Utilization'],['Factor','Multipliers'],['Data','Data'],['SmallData','Memory']];
const SENSOR_DEVICE_ORDER=['Firmware','Motherboard','CPU','APU','Memory','GPU','EC'];
function trackSensorRanges() {
  state.sensorRanges??=new Map();
  for(const sensor of state.snapshot?.sensors??[]) {
    if(!Number.isFinite(sensor.value)) continue;
    const range=state.sensorRanges.get(sensor.id);
    state.sensorRanges.set(sensor.id,range?{min:Math.min(range.min,sensor.value),max:Math.max(range.max,sensor.value)}:{min:sensor.value,max:sensor.value});
  }
}
function sensorDeviceName(sensor) {
  const snap=state.snapshot, machine=[snap.machine?.manufacturer,snap.machine?.model].filter(Boolean).join(' ');
  if(sensor.group==='CPU') return snap.cpu?.name||'Processor';
  if(sensor.group==='GPU') return snap.gpus?.find(g=>g.id===sensor.hardwareId)?.name||'Graphics';
  if(sensor.group==='APU') return 'Integrated graphics';
  if(sensor.group==='EC') return 'Embedded controller';
  if(sensor.group==='Firmware'||sensor.group==='Motherboard') return machine||sensor.group;
  return sensor.group||'Other';
}
function sensorValue(value,unit) { return Number.isFinite(value)?`${fmt(value,1)} ${unit}`:'—'; }
function sensorRow(sensor,cls='') {
  const range=state.sensorRanges?.get(sensor.id), row=append(el('div',`sensor-row ${cls}`.trim()),el('span','sensor-name',sensor.source?`${sensor.name} · ${sensor.source}`:sensor.name),el('span','sensor-number',sensorValue(sensor.value,sensor.unit)),el('span','sensor-number',sensorValue(range?.min,sensor.unit)),el('span','sensor-number',sensorValue(range?.max,sensor.unit)));
  row.title=sensor.id; return row;
}
// A section stays as the viewer left it when readings refresh.
function sensorSection(key,cls,open,summaryContent) {
  const section=el('details',cls); section.open=open&&!state.sensorClosed?.has(key);
  const summary=el('summary'); append(summary,...summaryContent); section.append(summary);
  section.addEventListener('toggle',()=>{ state.sensorClosed??=new Set(); if(section.open) state.sensorClosed.delete(key); else state.sensorClosed.add(key); });
  return section;
}
// Numbered repeats, such as each core, fold into one row showing the highest reading.
function foldSensors(key,sensors,forceOpen) {
  const groups=new Map(), output=[];
  for(const sensor of sensors) { const match=/^(.*?)\s*#\d+(.*)$/.exec(sensor.name), name=match?`${match[1]}${match[2]}`:null; if(name) groups.set(name,[...(groups.get(name)??[]),sensor]); }
  const used=new Set();
  for(const sensor of sensors) {
    if(used.has(sensor)) continue;
    const match=/^(.*?)\s*#\d+(.*)$/.exec(sensor.name), name=match?`${match[1]}${match[2]}`:null, members=name?groups.get(name):null;
    if(!members||members.length<3){ output.push(sensorRow(sensor)); continue; }
    members.forEach(member=>used.add(member));
    const pick=values=>{ const finite=values.filter(Number.isFinite); return finite.length?Math.max(...finite):null; }, ranges=members.map(member=>state.sensorRanges?.get(member.id)), unit=members[0].unit;
    const rowKey=`${key}/${name}`, open=forceOpen||state.sensorOpen?.has(rowKey), section=el('details','sensor-fold'); section.open=open;
    const summary=append(el('summary','sensor-row'),el('span','sensor-name',`${name} (highest of ${members.length})`),el('span','sensor-number',sensorValue(pick(members.map(m=>m.value)),unit)),el('span','sensor-number',sensorValue(pick(ranges.map(r=>r?.min)),unit)),el('span','sensor-number',sensorValue(pick(ranges.map(r=>r?.max)),unit)));
    section.append(summary);
    section.addEventListener('toggle',()=>{ state.sensorOpen??=new Set(); if(section.open) state.sensorOpen.add(rowKey); else state.sensorOpen.delete(rowKey); });
    for(const member of members) section.append(sensorRow(member,'sensor-child'));
    output.push(section);
  }
  return output;
}
function sensorTable() {
  trackSensorRanges();
  const root=el('div','sensor-tree'), filter=state.search.toLowerCase();
  const sensors=state.snapshot.sensors.filter(s=>`${s.name} ${s.group} ${s.id} ${sensorDeviceName(s)} ${s.type}`.toLowerCase().includes(filter));
  if(!sensors.length){ root.append(el('p','empty-note',filter?'No matching sensors.':'No sensor bridge readings yet. Open Setup to connect the native bridge.')); return root; }
  root.append(append(el('div','sensor-row sensor-head'),el('span','','Sensor'),el('span','sensor-number','Value'),el('span','sensor-number','Min'),el('span','sensor-number','Max')));
  const devices=new Map();
  for(const sensor of sensors){ const name=sensorDeviceName(sensor), device=devices.get(name)??{group:sensor.group,sensors:[]}; device.sensors.push(sensor); devices.set(name,device); }
  const rank=group=>{ const index=SENSOR_DEVICE_ORDER.indexOf(group); return index<0?SENSOR_DEVICE_ORDER.length:index; };
  for(const [name,device] of [...devices].sort((a,b)=>rank(a[1].group)-rank(b[1].group))) {
    const deviceSection=sensorSection(`device/${name}`,'sensor-device',true,[el('span','',name)]);
    const types=[...SENSOR_CATEGORIES,...[...new Set(device.sensors.map(s=>s.type))].filter(type=>!SENSOR_CATEGORIES.some(c=>c[0]===type)).map(type=>[type,type])];
    for(const [type,title] of types) {
      const members=device.sensors.filter(s=>s.type===type); if(!members.length) continue;
      const key=`device/${name}/${type}`, category=sensorSection(key,'sensor-category',true,[el('span','',title)]);
      if(filter) category.open=true;
      append(category,...foldSensors(key,members,!!filter)); deviceSection.append(category);
    }
    if(filter) deviceSection.open=true;
    root.append(deviceSection);
  }
  return root;
}
function sensorsPanel() {
  const search=el('input','search'); search.type='search'; search.placeholder='Find a sensor…'; search.value=state.search; search.setAttribute('aria-label','Find a sensor');
  const box=panel('Sensor explorer','sensors',`${state.snapshot.sensors.length} exposed sensors`,search), wrapper=el('div','table-scroll');
  search.addEventListener('input',()=>{state.search=search.value; wrapper.replaceChildren(sensorTable());});
  wrapper.append(sensorTable()); box.append(wrapper); return box;
}
function activityPanel() {
  const box=panel('Control history','activity','Requested changes, read-back results and errors · stored locally');
  if (!state.activity.length) box.append(el('div','empty-state','Your control changes will appear here. No settings are applied automatically at startup.'));
  for (const event of state.activity) {
    const c=event.command, title=c.type==='fan-manual-limit'?('Manual fan cutoff · '+(c.celsius===null?'Laptop default':c.celsius+' °C')):c.type==='ryzen-tune'?('Ryzen SMU · '+c.setting+' · '+(c.restore?'restore baseline':c.value)):c.type==='cpu-boost'?`CPU boost · ${c.source.toUpperCase()} · ${c.enabled?'enabled':'disabled'}`:c.type==='cpu-max-boost'?`Maximum boost · ${c.source.toUpperCase()} · ${c.enabled?'on':'off'}`:c.type==='cpu-step'?`CPU speed step · ${c.source.toUpperCase()} · ${c.restore?'restore earlier limits':c.mhz?c.mhz+' MHz':'no limit'}`:c.type==='gpu-boost'?`GPU boost · ${c.enabled?'enabled':'disabled'}`:`Fan control · ${c.mode}${c.mode==='manual'?` · ${c.level!==undefined?'level '+c.level:c.percent+'%'}`:''}`;
    append(box,append(el('div',`event ${event.status}`),el('span','event-indicator'),append(el('div','event-info'),el('div','event-title',title),el('div','event-detail',`${event.status.toUpperCase()} · ${event.detail||'Awaiting verification'}`)),el('time','',new Date(event.requested_at).toLocaleTimeString())));
  }
  return box;
}
function compatibilityPanel() {
  const box=panel('Compatibility report','sensors','Read-only summary you can review and share · no serial numbers or user names');
  box.append(button(state.report?'Refresh report':'Generate report','text-button',async()=>{
    try { state.report=JSON.stringify(await api('compatibility-report'),null,2); render(true); } catch(e) { toast(e.message,true); }
  }));
  if (state.report) {
    box.append(button('Copy to clipboard','text-button',async()=>{
      try { await navigator.clipboard.writeText(state.report); toast('Report copied.'); } catch { toast('Could not copy. Select the text below instead.',true); }
    }));
    box.append(el('pre','compat-report',state.report));
  }
  return box;
}
function render(force=false) {
  const s=state.snapshot;
  $('#mode-badge').textContent=state.mode==='demo'?'SIMULATED DEMO':'LIVE HARDWARE'; $('#mode-badge').classList.toggle('demo',state.mode==='demo');
  $('#connection').replaceChildren(el('span','status-dot'),document.createTextNode(state.error?'Disconnected':state.stale?'Waiting for data':'Connected'));
  $('#connection').classList.toggle('status-failed',!!state.error||state.stale);
  $('#notice').classList.toggle('live',state.mode==='live'&&!state.error);
  $('#notice').textContent=state.error?`Hardware service: ${state.error}${s?' · Displaying the last snapshot.':''}`:state.mode==='demo'?'DEMO MODE · Readings and controls are simulated. No hardware writes occur.':s?.warnings.filter(Boolean).join(' · ')||'Live local hardware. Controls are enabled only where a supported interface is detected.';
  if (!s) { $('#content').replaceChildren(el('div','panel empty-state',state.error?'No live snapshot available. Verify setup and refresh.':'Reading hardware capabilities…')); return; }
  $('#machine-name').textContent=s.machine.model;
  $('#driver-status').textContent=s.driver?`Driver diagnosis: ${s.driver.deviceAccessible?'PawnIO device accessible':s.driver.message+' (error '+s.driver.errorCode+')'} · ${s.driver.administrator?'Administrator':'Not elevated'}`:'Driver diagnosis is available in live mode with the native bridge.';
  $('#power-source').textContent=`${s.powerSource==='Online'?'AC power connected':s.powerSource==='Offline'?'On battery':'Power source unknown'} · ${s.driver?.administrator?'Hardware worker elevated':s.admin?'Administrator':'Standard permissions'}`;
  const engineStatus=$('#engine-status');if(engineStatus)engineStatus.textContent=`ThinkPad fan engine: ${s.fanEngine?.status||'Not detected'}`;
  const hardwareButton=$('#enable-hardware');if(hardwareButton){const control=hardwareAccessState(state.mode,state.desktopHardware);hardwareButton.disabled=control.disabled;hardwareButton.textContent=control.label;}
  $('#sample-time').textContent=`Last sample ${new Date(s.at).toLocaleTimeString()}${state.stale?' · stale':''}`;
  if (!force && !state.stale && !state.busy && $('#content').contains(document.activeElement) && ['INPUT','SELECT'].includes(document.activeElement.tagName)) return;
  const content=$('#content'), parts=[];
  if (state.view==='overview') {
    parts.push(metrics(),chart(),append(el('div','controls-grid'),boostPanel(),fanPanel()));
    parts.push(append(el('section','panel device-summary'),append(el('div','device-icon'),icon('cpu')),append(el('div'),el('h3','',s.cpu.name),el('p','',`${fmt(s.cpu.load)}% CPU load · ${clockGhz(s.cpu.clock)} GHz (${clockCaption(s.cpu.clockDetails)}) · ${fmt(s.cpu.power,1)} W package power`)),button('View all sensors →','text-button',()=>navigate('sensors'))));
  } else if(state.view==='cpu') {
    parts.push(append(el('div','detail-grid'),metric('CPU utilization','cpu',s.cpu.load,'%','Total processor load'),metric('CPU speed','sensors',s.cpu.clock,'GHz',clockCaption(s.cpu.clockDetails),undefined,false,clockGhz),metric('Package power','power',s.cpu.power,'W','CPU package power')),
      stepsPanel(),boostPanel(true),...(showCpuTuning(s)?[advancedCpuTuning()]:[]),chart());
  } else if(state.view==='gpu') { parts.push(...gpuPanels(),chart()); }
  else if(state.view==='advanced') parts.push(fanSpeedsPanel());
  else if(state.view==='fan') { parts.push(metrics(),fanPanel(),fanProfilesPanel(),append(panel('Cooling behavior','fan'),el('div','big-info','CPU and integrated GPU may share a physical fan. Only exposed fan channels appear; an independent GPU fan is never invented. TPFanCtrl2 uses direct levels 1–7; LibreHardwareMonitor controllers use percentages. RPM is read from the hardware tachometer, never estimated from the requested speed. Enable the optional TPFanCtrl2 service adapter in Setup for supported ThinkPads.'))); }
  else if(state.view==='sensors') parts.push(sensorsPanel());
  else parts.push(activityPanel(),compatibilityPanel());
  const focusLabel=content.contains(document.activeElement)?document.activeElement.getAttribute('aria-label'):null;
  content.classList.toggle('cpu-page',state.view==='cpu');content.replaceChildren(...parts);
  if(focusLabel) content.querySelector(`[aria-label="${CSS.escape(focusLabel)}"]:not(:disabled)`)?.focus();
}
function navigate(view) {
  state.view=view; $('#page-title').textContent=headings[view][0]; $('#page-subtitle').textContent=headings[view][1];
  $('#breadcrumb-current').textContent=views.find(v=>v[0]===view)[1];
  for (const node of $('#navigation').querySelectorAll('button')) { node.classList.toggle('active',node.dataset.view===view); if(node.dataset.view===view) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current'); }
  render(true);
}
for (const [view,label] of views) {
  if(view==='sensors') $('#navigation').append(el('div','nav-separator'));
  const b=button('',`nav-button${view==='overview'?' active':''}`,()=>navigate(view)); b.dataset.view=view; b.title=label;
  if(view==='overview') b.setAttribute('aria-current','page'); append(b,icon(view),el('span','',label)); $('#navigation').append(b);
}
$('#setup-button').addEventListener('click',()=>$('#setup-dialog').showModal());
for(const id of ['close-setup','setup-done']) $(`#${id}`).addEventListener('click',()=>$('#setup-dialog').close());
$('#refresh-button').addEventListener('click',()=>refresh());
const exitApplication=async()=>{
  if(window.thinkpadDesktop===true&&window.chrome?.webview){window.chrome.webview.postMessage({type:'exit'});return;}
  try {
    await api('shutdown',{}); state.stopped=true;state.stale=true;
    $('#setup-dialog').close(); state.error='Local service stopped. Restart the launcher to reconnect.';render(true);
    toast('Service stopped. Firmware control requested for owned fans.');
  } catch(e) { toast(e.message,true); }
};
$('#stop-service').addEventListener('click',exitApplication);
async function refresh() {
  if(state.stopped) return;
  if (refreshPromise) return refreshPromise;
  refreshPromise=(async()=>{
    try {
      const results=await Promise.all([api('state'),api(`history?minutes=${state.minutes}`),api('activity')]);
      state.snapshot=results[0].snapshot; trackSensorRanges(); state.error=results[0].error; state.stale=results[0].stale||!!results[0].error;
      state.history=results[1]; state.activity=results[2];
      // Only a successfully connected UI can renew the manual fan lease.
      if(window.thinkpadDesktop!==true)await api('lease',{active:!state.stale});
    } catch(e) { state.error=e.message; state.stale=true; }
    finally { refreshPromise=null; render(); }
  })(); return refreshPromise;
}
async function start() {
  try { const session=await api('session'); state.token=session.token; state.mode=session.mode; attachDesktop({el,button,state,onExit:exitApplication});await refresh(); }
  catch(e) { state.error=e.message; render(); }
  const tick=async()=>{ if(state.stopped)return; if(!state.token) { try { const session=await api('session'); state.token=session.token; state.mode=session.mode; } catch{} } await refresh(); setTimeout(tick,3000); }; setTimeout(tick,3000);
}
start();








