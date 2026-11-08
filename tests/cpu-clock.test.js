import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCpuClock} from '../src/cpu-clock.js';
import {WindowsProvider,DemoProvider} from '../src/providers.js';
const clock=(name,value,extra={})=>({group:'CPU',type:'Clock',name,value,...extra});

test('boosted per-core maximum is distinct from average, effective and Windows-reported frequency',()=>{
  const sensors=[clock('Bus Speed',100),clock('Cores (Average)',2850),clock('Cores (Average Effective)',950),clock('Core #1',4200),clock('Core #2',1500),clock('Core #1 (Effective)',1200),clock('Core #2 (Effective)',700)];
  const result=selectCpuClock(sensors,{performance:{ProcessorFrequency:2300}});
  assert.equal(result.currentMhz,4200);assert.equal(result.averageMhz,2850);assert.equal(result.effectiveMhz,950);
  assert.equal(result.label,'Fastest core');assert.equal(result.sampledCoreCount,2);
  assert.equal(selectCpuClock([...sensors].reverse()).currentMhz,4200,'Sensor enumeration order must not change the readout');
});
test('Intel hybrid cores aggregate their raw clocks without using bus, uncore or GPU clocks',()=>{
  const result=selectCpuClock([clock('P-Core #1',4800),clock('E-Core #1',2700),clock('CPU Core #2',3500),clock('Bus Speed',100),clock('Ring',5000),clock('Core #1',9000,{group:'GPU'})]);
  assert.equal(result.currentMhz,4800);assert.equal(result.averageMhz,3667);assert.equal(result.sampledCoreCount,3);
  assert.deepEqual(result.perCore,[{name:'Core 2',mhz:3500},{name:'E-Core 1',mhz:2700},{name:'P-Core 1',mhz:4800}]);
});
test('average core speed is the arithmetic mean of reporting cores even when an aggregate sensor differs',()=>{
  const result=selectCpuClock([clock('Core #1',4200),clock('Core #2',2400),clock('Core #3',1800),clock('Cores (Average)',3900),clock('Cores (Average Effective)',600)]);
  assert.equal(result.averageMhz,(4200+2400+1800)/3);
  assert.equal(result.sampledCoreCount,3);
  assert.equal(result.effectiveMhz,600);
});
test('effective zero is valid and never replaces a raw-core measurement',()=>{
  const result=selectCpuClock([clock('Core #1',3000),clock('Core #1 (Effective)',0)]);
  assert.equal(result.currentMhz,3000);assert.equal(result.effectiveMhz,0);
  assert.equal(selectCpuClock([clock('Cores (Average Effective)',0)]).currentMhz,null);
  assert.deepEqual(selectCpuClock([]).perCore,[]);
});
test('fallbacks are labelled according to their actual measurement and never use rated inventory speed',()=>{
  assert.equal(selectCpuClock([clock('Cores (Average)',2800)]).label,'Average core clock');
  const windows=selectCpuClock([],{cpu:{CurrentClockSpeed:2300,MaxClockSpeed:2300},performance:{ProcessorFrequency:3100}});
  assert.equal(windows.currentMhz,3100);assert.equal(windows.label,'Windows estimate');
  assert.equal(selectCpuClock([],{cpu:{CurrentClockSpeed:2300,MaxClockSpeed:2300}}).currentMhz,null);
  assert.equal(selectCpuClock([clock('Core #1',NaN),clock('Core #2',Infinity),clock('Core #3',0),clock('Core #4',-10)]).source,'unavailable');
});
test('live CPU summary and policy panel use the same clock model',async()=>{
  const provider=new WindowsProvider({platform:'win32',runner:async file=>file.endsWith('powershell.exe')?JSON.stringify({cpu:{CurrentClockSpeed:2300},performance:{ProcessorFrequency:2100}}):''});
  provider.bridge={request:async()=>({sensors:[clock('Core #1',4100),clock('Core #2',1800),clock('Cores (Average Effective)',400)],fans:[]})};
  const snapshot=await provider.snapshot();
  assert.equal(snapshot.cpu.clock,4100);assert.equal(snapshot.cpuSteps.currentMhz,4100);
  assert.deepEqual(snapshot.cpu.clockDetails,snapshot.cpuSteps.clock);
  for(const profile of ['intel','ryzen']){const simulated=await new DemoProvider(profile).snapshot();assert.equal(simulated.cpu.clock,simulated.cpuSteps.currentMhz);}
});
