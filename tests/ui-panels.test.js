import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DemoProvider} from '../src/providers.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function component(name,next){return source.slice(source.indexOf(`function ${name}()`),source.indexOf(`function ${next}()`));}
function node(tag,text){return {tag,text,children:[],classList:{add(){}},append(...children){this.children.push(...children);},setAttribute(){},addEventListener(){}};}

test('successful baseline restore replaces only its textbox draft with firmware read-back; failure keeps edits',async()=>{
  const snapshot=await new DemoProvider().snapshot();snapshot.ryzen.current.fastWatts=24.7;
  const state={snapshot,busy:false,stale:false,ryzenDrafts:new Map([['fastWatts','39'],['slowWatts','28']])};
  let fail=false;
  const context=vm.createContext({state,Number,Math,Map,api:async path=>{if(path==='commands'&&fail)throw Error('Restore rejected');return path==='commands'?{snapshot,message:'Restored'}:[];},render(){},toast(){},refresh:async()=>{},
    el:(tag,cls,text)=>node(tag,text),panel:()=>node('panel'),append:(p,...children)=>{p.append(...children);return p;},button:text=>node('button',text),fmt:String});
  vm.runInContext(source.slice(source.indexOf('async function command('),source.indexOf('function switchControl('))+component('ryzenPanel','fanPanel'),context);
  await vm.runInContext("command({type:'ryzen-tune',setting:'fastWatts',restore:true})",context);
  const walk=n=>[n,...n.children.flatMap(walk)];
  assert.equal(walk(vm.runInContext('ryzenPanel()',context)).filter(n=>n.tag==='input')[1].value,'24.7');
  assert.equal(state.ryzenDrafts.get('slowWatts'),'28');
  state.ryzenDrafts.set('fastWatts','37');fail=true;
  await vm.runInContext("command({type:'ryzen-tune',setting:'fastWatts',restore:true})",context);
  assert.equal(state.ryzenDrafts.get('fastWatts'),'37');
});

test('CPU clock presentation shows per-core GHz, honest fallbacks and collapsed details without writing settings',async()=>{
  const snapshot=await new DemoProvider('intel').snapshot();
  const state={snapshot,busy:false,stale:false};
  const context=vm.createContext({state,Number,Math,el:(tag,cls,text)=>node(tag,text),panel:()=>node('panel'),append:(parent,...children)=>{parent.append(...children);return parent;},button:text=>node('button',text),command:()=>{throw Error('Readings must not issue commands');}});
  vm.runInContext(source.slice(source.indexOf('function stepChoice('),source.indexOf('function advancedCpuTuning(')),context);
  const walk=n=>[n,...n.children.flatMap(walk)];
  let nodes=walk(vm.runInContext('stepsPanel()',context));
  let text=nodes.map(n=>n.text??'').join(' ');
  assert.match(text,/Highest current core clock/);assert.match(text,/P-Core 1/);assert.match(text,/E-Core 8/);
  assert.equal(nodes.find(n=>n.tag==='ul').children.length,8);
  assert.equal(nodes.find(n=>n.tag==='details').open,false);
  assert.match(text,/\d\.\d{2} GHz/);assert.match(text,/Average core speed \(8 reporting cores\)/);
  state.clockDetailsOpen=true;
  assert.equal(walk(vm.runInContext('stepsPanel()',context)).find(n=>n.tag==='details').open,true);
  snapshot.cpuSteps.clock={source:'windows-counter',label:'Windows estimate',perCore:[]};
  nodes=walk(vm.runInContext('stepsPanel()',context));text=nodes.map(n=>n.text??'').join(' ');
  assert.match(text,/Windows estimate/);assert.match(text,/Individual core speeds are unavailable/);assert.doesNotMatch(text,/Highest current core clock/);
});
test('live control panels render supported and unavailable fields without runtime failures',async()=>{
  const snapshot=await new DemoProvider().snapshot();
  const context=vm.createContext({state:{snapshot,drafts:new Map(),busy:false,stale:false},Map,Number,Math,
    el:(tag,cls,text)=>node(tag,text),panel:()=>node('panel'),append:(parent,...children)=>{parent.append(...children.filter(Boolean));return parent;},
    button:(text)=>node('button',text),fmt:value=>String(value),command:()=>{throw new Error('Rendering must not issue commands');},$(){throw new Error('Unexpected setup request');}});
  vm.runInContext(component('ryzenPanel','fanPanel')+component('fanPanel','gpuPanels'),context);
  assert.ok(vm.runInContext('ryzenPanel().children.length',context)>4);
  assert.equal(vm.runInContext('fanPanel().children.length',context),2);
  snapshot.fans[0].rpm=0;assert.equal(vm.runInContext('fanPanel().children.length',context),2);
  snapshot.ryzen.fields={sustainedWatts:{available:false,reason:'Firmware rejected setting'}};
  assert.ok(vm.runInContext('ryzenPanel().children.length',context)>4);
  snapshot.ryzen={available:false,reason:'Unsupported model'};
  assert.equal(vm.runInContext('ryzenPanel().children.length',context),1);
});

test('manual cutoff UI exposes machine default and custom value without confusing curve Max',async()=>{
  const snapshot=await new DemoProvider().snapshot(),commands=[];
  const state={snapshot,drafts:new Map(),busy:false,stale:false};
  const make=(tag,cls,text)=>({...node(tag,text),events:{},addEventListener(name,fn){this.events[name]=fn;}});
  const context=vm.createContext({state,Map,Number,Math,el:make,panel:()=>node('panel'),append:(p,...children)=>{p.append(...children.filter(Boolean));return p;},button:(text,cls,action)=>({...node('button',text),action}),fmt:String,command:c=>commands.push(c)});
  vm.runInContext(component('fanPanel','fanProfilesPanel'),context);
  const walk=n=>[n,...n.children.flatMap(walk)];let nodes=walk(vm.runInContext('fanPanel()',context));
  assert.ok(nodes.some(n=>n.text==='Manual fan temperature limit'));
  assert.match(nodes.map(n=>n.text??'').join(' '),/This includes manual Max mode/);
  const checkbox=nodes.find(n=>n.type==='checkbox'),input=nodes.find(n=>n.type==='number');
  assert.equal(checkbox.checked,true);assert.equal(input.disabled,true);
  checkbox.checked=false;checkbox.events.change();input.value='90';input.events.input();
  nodes.find(n=>n.text==='Save temperature limit').action();
  assert.deepEqual(JSON.parse(JSON.stringify(commands)),[{type:'fan-manual-limit',celsius:90}]);
  snapshot.fans[0].mode='manual';nodes=walk(vm.runInContext('fanPanel()',context));
  assert.equal(nodes.find(n=>n.text==='Save temperature limit').disabled,true);
});

test('pending boost recovery renders an explicit restore action even when maximum boost reads off',async()=>{
  const snapshot=await new DemoProvider().snapshot();snapshot.cpuSteps.maxBoostRecovery={ac:true,dc:false};
  const commands=[],switches=[];
  const context=vm.createContext({state:{snapshot,busy:false,stale:false},Number,
    el:(tag,cls,text)=>node(tag,text),panel:()=>node('panel'),append:(parent,...children)=>{parent.append(...children);return parent;},
    button:(text,cls,action)=>({...node('button',text),action}),command:value=>commands.push(value),
    switchControl:(label,description,value,cap)=>{switches.push({label,cap});return node('switch',label);}});
  vm.runInContext(source.slice(source.indexOf('function boostPanel('),source.indexOf('function stepChoice(')),context);
  const panel=vm.runInContext('boostPanel(true)',context);
  const action=panel.children.find(n=>n.tag==='button'&&n.text==='Finish boost recovery: plugged in');
  assert.ok(action);assert.equal(action.disabled,false);assert.equal(commands.length,0,'Rendering may not write policies');
  assert.equal(switches.find(s=>s.label==='Maximum boost: plugged in').cap.available,false);
  action.action();assert.deepEqual(JSON.parse(JSON.stringify(commands)),[{type:'cpu-max-boost',source:'ac',enabled:false}]);
  snapshot.cpuSteps.maxBoostRecovery.ac=false;
  assert.ok(!vm.runInContext('boostPanel(true)',context).children.some(n=>n.text==='Finish boost recovery: plugged in'));
});

test('Ryzen tuning explains linked boost controls and reflects each power-source policy without changing it',async()=>{
  const snapshot=await new DemoProvider().snapshot();snapshot.boost={ac:0,dc:1};snapshot.cpuSteps.policy={ac:2300,dc:0};
  const context=vm.createContext({state:{snapshot,busy:false,stale:false},Map,Number,Math,
    el:(tag,cls,text)=>node(tag,text),panel:()=>node('panel'),append:(parent,...children)=>{parent.append(...children);return parent;},
    button:text=>node('button',text),fmt:value=>String(value),command:()=>{throw Error('Explaining settings must not change them');}});
  vm.runInContext(source.slice(source.indexOf('function showRyzenTuning('),source.indexOf('function fanPanel()')),context);
  const textOf=n=>[n.text??'',...(n.children??[]).map(textOf)].join(' ');
  let text=textOf(vm.runInContext('advancedCpuTuning()',context));
  assert.doesNotMatch(text,/Most people can leave/);
  assert.match(text,/Set sustained power, burst power and CPU temperature limits/);
  assert.match(text,/Plugged in: Processor boost is off; raising these limits will not enable it/);
  assert.match(text,/CPU speed limit: 2300 MHz; it remains in force/);
  assert.match(text,/On battery: Processor boost is enabled. CPU speed limit: No limit/);
  snapshot.boost.ac=1;
  text=textOf(vm.runInContext('ryzenPanel()',context));
  assert.match(text,/Plugged in: Processor boost is enabled/);
  assert.doesNotMatch(text,/Plugged in: Processor boost is off/);
});

test('Intel advanced tuning shows honest capabilities without constructing Ryzen controls',async()=>{
  const snapshot=await new DemoProvider('intel').snapshot();
  const context=vm.createContext({state:{snapshot},fmt:value=>value==null?'—':String(value),el:(tag,cls,text)=>node(tag,text),panel:title=>node('panel',title),append:(parent,...children)=>{parent.append(...children);return parent;}});
  vm.runInContext(source.slice(source.indexOf('function showRyzenTuning('),source.indexOf('function ryzenPanel()')),context);
  vm.runInContext('function ryzenPanel(){throw Error("Intel must not construct Ryzen controls");}',context);
  const tree=vm.runInContext('advancedCpuTuning()',context);
  const textOf=n=>[n.text??'',...n.children.map(textOf)].join(' ');
  assert.match(textOf(tree),/Advanced: CPU tuning/);
  assert.match(textOf(tree),/Intel tuning capabilities/);
  assert.match(textOf(tree),/PL1\/PL2\) are not implemented/);
  assert.match(textOf(tree),/15 W.*28 s/);
  assert.match(textOf(tree),/35 W.*1.25 s/);
  assert.match(textOf(tree),/Firmware register lock: locked/);
  assert.doesNotMatch(textOf(tree),/DIRECT SMU|Set sustained power/);
  assert.equal(tree.open,false);
  snapshot.cpuSteps.hardware.powerLimits={available:false,reason:'Register access denied'};
  const missing=textOf(vm.runInContext('advancedCpuTuning()',context));
  assert.match(missing,/Register access denied/);assert.doesNotMatch(missing,/15 W|35 W/);
});

test('unsupported Ryzen settings are visibly read-only and disabled without hiding actual readings or recovery',async()=>{
  const snapshot=await new DemoProvider().snapshot();
  snapshot.ryzen.fields={sustainedWatts:{available:false,restoreAvailable:false,reason:'Sustained power is read-only on this hardware.'}};
  const context=vm.createContext({state:{snapshot,busy:false,stale:false,ryzenDrafts:new Map([['sustainedWatts','30']])},Map,Number,Math,
    el:(tag,cls,text)=>({...node(tag,text),className:cls}),panel:()=>node('panel'),append:(parent,...children)=>{parent.append(...children);return parent;},
    button:text=>node('button',text),fmt:value=>String(value),command:()=>{throw Error('Rendering cannot tune hardware');}});
  vm.runInContext(component('ryzenPanel','fanPanel'),context);
  const walk=n=>[n,...n.children.flatMap(walk)],textOf=n=>walk(n).map(x=>x.text??'').join(' ');
  const rows=()=>vm.runInContext('ryzenPanel()',context).children.filter(n=>n.className?.includes('ryzen-row'));
  let row=rows().find(n=>textOf(n).includes('Sustained power · STAPM'));
  assert.match(row.className,/ryzen-read-only/);assert.match(textOf(row),/Read-only/);
  assert.match(textOf(row),/Sustained power is read-only on this hardware/);
  assert.equal(walk(row).find(n=>n.tag==='input').value,snapshot.ryzen.current.sustainedWatts);
  assert.ok(walk(row).filter(n=>n.tag==='input'||n.tag==='button').every(n=>n.disabled));
  const fast=rows().find(n=>textOf(n).includes('Burst power'));
  assert.equal(walk(fast).find(n=>n.tag==='input').disabled,false,'Unsupported STAPM must not disable accepted controls');
  snapshot.ryzen.fields.sustainedWatts={available:false,restoreAvailable:true,reason:'Firmware did not accept a verified change.'};
  row=rows().find(n=>textOf(n).includes('Sustained power · STAPM'));
  assert.match(textOf(row),/Custom changes unavailable/);assert.match(textOf(row),/Restore baseline remains available for recovery/);
  assert.equal(walk(row).find(n=>n.tag==='button'&&n.text==='Restore baseline').disabled,false);
});

test('CPU controls show a custom limit without claiming its provenance or embedding one-machine benchmark notes',async()=>{
  const snapshot=await new DemoProvider().snapshot();snapshot.cpuSteps.policy.dc=3500;snapshot.boost={ac:0,dc:0};
  const context=vm.createContext({state:{snapshot,busy:false,stale:false},Number,Math,
    el:(tag,cls,text)=>node(tag,text),panel:()=>node('panel'),append:(parent,...children)=>{parent.append(...children);return parent;},
    button:text=>node('button',text),command:()=>{throw new Error('Rendering must not change settings');},
    switchControl:(label,description)=>node('switch',label+' '+description)});
  vm.runInContext(source.slice(source.indexOf('function boostPanel('),source.indexOf('function advancedCpuTuning(')),context);
  const controls=vm.runInContext('[boostPanel(true),stepsPanel()]',context);
  const textOf=n=>[n.text??'',...(n.children??[]).map(textOf)].join(' ');
  const text=controls.map(textOf).join(' ');
  assert.ok(text.includes('3500 MHz'),'Current configuration remains visible');
  assert.ok(!text.includes('5650U'));
  assert.ok(!text.includes('measured no faster'));
  assert.ok(!text.includes('was already in your Windows power plan'));
  assert.ok(!text.includes("wasn't set by this app"));
  assert.ok(!text.includes('has no effect right now'));
});

test('Max fan curve row moves higher steps down and saves the selected threshold',async()=>{
  const snapshot=await new DemoProvider().snapshot(), commands=[];
  const make=(tag,text)=>({...node(tag,text),style:{setProperty(){}},events:{},addEventListener(type,fn){this.events[type]=fn;}});
  const state={snapshot,drafts:new Map(),busy:false,stale:false};
  const context=vm.createContext({state,Map,Number,Math,el:(tag,cls,text)=>make(tag,text),panel:()=>make('panel'),append:(p,...c)=>{p.append(...c.filter(Boolean));return p;},button:(text,cls,action)=>({...make('button',text),action}),command:c=>{commands.push(c);},fmt:String});
  vm.runInContext(component('fanProfilesPanel','fanSpeedsPanel'),context);
  const walk=n=>[n,...n.children.flatMap(walk)], nodes=walk(vm.runInContext('fanProfilesPanel()',context));
  assert.ok(nodes.some(n=>n.text==='Max mode starts'));
  const sliders=nodes.filter(n=>n.tag==='input'&&n.type==='range');assert.equal(sliders.length,8);
  sliders[7].value='70';sliders[7].events.input();
  const draft=state.drafts.get('fan-profile');assert.equal(draft.maxTemp,70);assert.equal(draft.levels[6],69);
  await nodes.find(n=>n.text==='Save profile').action();
  assert.equal(commands[0].maxTemp,70);assert.equal(commands[0].levels[6],69);
});

test('profile Apply skips redundant saves, saves edits first, and never applies after a failed save',async()=>{
  const provider=new DemoProvider();await provider.command({type:'fan-profile-apply',id:'default-2'});
  const state={snapshot:await provider.snapshot(),drafts:new Map(),busy:false,stale:false},commands=[];
  let fail=false;
  const make=(tag,text)=>({...node(tag,text),style:{setProperty(){}},events:{},addEventListener(type,fn){this.events[type]=fn;}});
  const context=vm.createContext({state,Number,Math,JSON,render(){},el:(tag,cls,text)=>make(tag,text),panel:()=>make('panel'),append:(p,...children)=>{p.append(...children.filter(Boolean));return p;},button:(text,cls,action)=>({...make('button',text),action}),fmt:String,command:async c=>{
    commands.push(c);if(fail)return null;await provider.command(c);state.snapshot=await provider.snapshot();state.drafts.delete('fan-profile');return {snapshot:state.snapshot};
  }});
  vm.runInContext(component('fanProfilesPanel','fanSpeedsPanel'),context);
  const walk=n=>[n,...n.children.flatMap(walk)];let nodes=walk(vm.runInContext('fanProfilesPanel()',context));
  state.snapshot.fans[0].mode='auto';
  const firmwareNodes=walk(vm.runInContext('fanProfilesPanel()',context));
  assert.match(firmwareNodes.map(n=>n.text??'').join(' '),/Firmware currently controls the fan/);
  assert.doesNotMatch(firmwareNodes.map(n=>n.text??'').join(' '),/Running "Server inactive"/);
  state.snapshot.fans[0].mode='curve';
  await nodes.find(n=>n.text==='Apply profile').action();assert.deepEqual(commands.map(c=>c.type),['fan-profile-apply']);
  commands.length=0;nodes=walk(vm.runInContext('fanProfilesPanel()',context));const apply=nodes.find(n=>n.text==='Apply profile');
  const slider=nodes.filter(n=>n.type==='range')[7];slider.value='84';slider.events.input();
  assert.equal(apply.textContent,'Save and apply');await apply.action();assert.deepEqual(commands.map(c=>c.type),['fan-profile-save','fan-profile-apply']);
  commands.length=0;nodes=walk(vm.runInContext('fanProfilesPanel()',context));const edited=nodes.filter(n=>n.type==='range')[7];edited.value='83';edited.events.input();fail=true;
  await nodes.find(n=>n.text==='Apply profile').action();assert.deepEqual(commands.map(c=>c.type),['fan-profile-save']);assert.equal(state.profileApplying,false);
});
