// CPU frequency telemetry: keep raw core clocks, effective clocks and Windows estimates distinct.
const valid = (value, zero = false) => Number.isFinite(value) && (zero ? value >= 0 : value > 0);
const mean = values => values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null;
const rounded = value => value === null ? null : Math.round(value);
const coreName = /^(?:[PE]-Core|(?:CPU\s+)?Core)(?:\s*#?\d+)?$/i;

export function selectCpuClock(sensors = [], probe = {}) {
  const clocks=sensors.filter(s=>s.group==='CPU'&&s.type==='Clock');
  const cores=clocks.filter(s=>coreName.test(s.name?.trim()??'')&&valid(s.value));
  const effective=clocks.filter(s=>/\(Effective\)$/i.test(s.name??'')&&coreName.test(s.name.replace(/\s*\(Effective\)$/i,''))&&valid(s.value,true));
  const averages=clocks.filter(s=>/^Cores?\s*\(Average\)$/i.test(s.name??'')&&valid(s.value));
  const effectiveAverages=clocks.filter(s=>/^Cores?\s*\(Average Effective\)$/i.test(s.name??'')&&valid(s.value,true));
  const maxima=clocks.filter(s=>/^Cores?\s*\(Max(?:imum)?\)$/i.test(s.name??'')&&valid(s.value));
  const average=cores.length?mean(cores.map(s=>s.value)):averages.length===1?averages[0].value:null;
  const effectiveAverage=effectiveAverages.length===1?effectiveAverages[0].value:mean(effective.map(s=>s.value));
  const windows=probe.performance?.ProcessorFrequency;
  const current=cores.length?Math.max(...cores.map(s=>s.value)):maxima.length?Math.max(...maxima.map(s=>s.value)):average??(valid(windows)?windows:null);
  const source=cores.length?'core-sensors':maxima.length?'core-max-sensor':average!==null?'core-average-sensor':valid(windows)?'windows-counter':'unavailable';
  const label=source==='core-sensors'||source==='core-max-sensor'?'Fastest core':source==='core-average-sensor'?'Average core clock':source==='windows-counter'?'Windows estimate':'Clock unavailable';
  const perCore=cores.map(s=>({name:s.name.trim().replace(/^CPU\s+/i,'').replace(/\s*#\s*/,' '),mhz:rounded(s.value)})).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  return {currentMhz:rounded(current),averageMhz:rounded(average),effectiveMhz:rounded(effectiveAverage),source,label,sampledCoreCount:cores.length,perCore};
}
