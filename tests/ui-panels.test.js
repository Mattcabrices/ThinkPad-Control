import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DemoProvider} from '../src/providers.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function component(name,next){return source.slice(source.indexOf(`function ${name}()`),source.indexOf(`function ${next}()`));}
function node(tag,text){return {tag,text,children:[],classList:{add(){}},append(...children){this.children.push(...children);},setAttribute(){},addEventListener(){}};}

test('startup retries initialize desktop controls after an initial outage and never attach twice after token renewal',async()=>{
  const state={token:null,mode:'live',stopped:false},ticks=[];
  let sessions=0,attachments=0,refreshes=0,renders=0;
  const context=vm.createContext({state,el(){},button(){},exitApplication(){},
    api:async path=>{assert.equal(path,'session');if(++sessions===1)throw Error('Temporarily offline');return {token:`token-${sessions}`,mode:'demo'};},
    attachDesktop:args=>{assert.equal(args.state.mode,'demo','Know demo mode before creating hardware controls');assert.equal(args.state.token,'token-2');attachments++;},
    refresh:async()=>{refreshes++;},render(){renders++;},
    setTimeout(fn,delay){assert.equal(delay,3000);ticks.push(fn);}});
  vm.runInContext(source.slice(source.indexOf('async function start()'),source.indexOf('\nstart();')),context);
  await vm.runInContext('start()',context);
  assert.equal(attachments,0);assert.equal(renders,1);assert.equal(ticks.length,1);
  await ticks.shift()();assert.equal(attachments,1);assert.equal(refreshes,1);assert.equal(state.token,'token-2');
  state.token=null;await ticks.shift()();assert.equal(state.token,'token-3');assert.equal(attachments,1);assert.equal(refreshes,2);
  state.stopped=true;await ticks.shift()();assert.equal(ticks.length,0);assert.equal(sessions,3);
});

test('missing hardware views open Settings without issuing commands; an empty sensor search stays a search result',()=>{
  let opened=0;
  const state={snapshot:{fans:[],gpus:[],sensors:[]},search:'',drafts:new Map()};
  const context=vm.createContext({state,Map,Number,Math,fmt:String,trackSensorRanges(){},
    el:(tag,cls,text)=>node(tag,text),panel:()=>node('panel'),
    append:(parent,...children)=>{parent.append(...children);return parent;},
    button:(text,cls,action)=>({...node('button',text),action}),
    $:selector=>{assert.equal(selector,'#setup-dialog');return {showModal(){opened++;}};},
    command(){throw Error('Opening Settings must never change hardware');}});
  vm.runInContext(component('fanPanel','fanProfilesPanel')+
    source.slice(source.indexOf('function fanSpeedsPanel()'),source.indexOf('const SENSOR_CATEGORIES='))+
    component('sensorTable','sensorsPanel'),context);
  const walk=n=>[n,...n.children.flatMap(walk)];
  for(const expression of ['fanPanel()','fanSpeedsPanel()','gpuPanels()[0]','sensorTable()']){
    const buttons=walk(vm.runInContext(expression,context)).filter(n=>n.tag==='button');
    assert.equal(buttons.length,1,expression);assert.equal(buttons[0].text,'Open Settings');buttons[0].action();
  }
  assert.equal(opened,4);
  state.search='missing sensor';
  const nodes=walk(vm.runInContext('sensorTable()',context));
  assert.ok(nodes.some(n=>n.text==='No matching sensors.'));
  assert.equal(nodes.some(n=>n.tag==='button'),false,'A search miss must not suggest broken hardware');
  state.snapshot.fans=[{id:'fan',controlUnit:'level',capability:{available:true}}];
  const calibration=walk(vm.runInContext('fanSpeedsPanel()',context));
  assert.ok(calibration.some(n=>n.text==='Max fan (Level 10)'));
  assert.ok(calibration.some(n=>n.text==='Measure all levels'));
  assert.ok(calibration.some(n=>n.text?.includes('by changing the fan speed')));
});

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
  assert.equal(nodes.find(n=>n.text==='Delete profile').disabled,true,'The running profile cannot be deleted');
  const discard=nodes.find(n=>n.text==='Discard edits');assert.equal(discard.disabled,true);
  const initialSlider=nodes.filter(n=>n.type==='range')[7];initialSlider.value='82';initialSlider.events.input();
  assert.equal(discard.disabled,false);discard.action();assert.equal(state.drafts.has('fan-profile'),false);
  nodes=walk(vm.runInContext('fanProfilesPanel()',context));
  await nodes.find(n=>n.text==='Apply profile').action();assert.deepEqual(commands.map(c=>c.type),['fan-profile-apply']);
  commands.length=0;nodes=walk(vm.runInContext('fanProfilesPanel()',context));const apply=nodes.find(n=>n.text==='Apply profile');
  const slider=nodes.filter(n=>n.type==='range')[7];slider.value='84';slider.events.input();
  assert.equal(apply.textContent,'Save and apply');await apply.action();assert.deepEqual(commands.map(c=>c.type),['fan-profile-save','fan-profile-apply']);
  commands.length=0;nodes=walk(vm.runInContext('fanProfilesPanel()',context));const edited=nodes.filter(n=>n.type==='range')[7];edited.value='83';edited.events.input();fail=true;
  await nodes.find(n=>n.text==='Apply profile').action();assert.deepEqual(commands.map(c=>c.type),['fan-profile-save']);assert.equal(state.profileApplying,false);
});

test('fan safety disclosure stays open across telemetry renders without changing controls',async()=>{
  const snapshot=await new DemoProvider().snapshot(),state={snapshot,drafts:new Map(),busy:false,stale:false};
  const context=vm.createContext({state,Map,Number,Math,el:(tag,cls,text)=>({...node(tag,text),events:{},addEventListener(type,fn){this.events[type]=fn;}}),panel:()=>node('panel'),append:(p,...children)=>{p.append(...children.filter(Boolean));return p;},button:text=>node('button',text),fmt:String,command(){throw Error('Opening help must not change cooling');}});
  vm.runInContext(component('fanPanel','fanProfilesPanel'),context);
  const walk=n=>[n,...n.children.flatMap(walk)];let help=walk(vm.runInContext('fanPanel()',context)).find(n=>n.tag==='details');
  assert.equal(help.open,false);help.open=true;help.events.toggle();
  help=walk(vm.runInContext('fanPanel()',context)).find(n=>n.tag==='details');assert.equal(help.open,true);
});

test('activity uses descriptive fan profile actions instead of an undefined fan mode',()=>{
  const state={activity:['fan-profile-save','fan-profile-apply','fan-profile-delete','fan-profile-firmware'].map(type=>({command:{type,id:'default-2'},status:'applied',detail:'Verified',requested_at:new Date().toISOString()}))};
  const context=vm.createContext({state,Date,el:(tag,cls,text)=>node(tag,text),panel:()=>node('panel'),append:(p,...children)=>{p.append(...children);return p;}});
  vm.runInContext(component('activityPanel','compatibilityPanel'),context);
  const textOf=n=>[n.text??'',...n.children.map(textOf)].join(' '),text=textOf(vm.runInContext('activityPanel()',context));
  assert.match(text,/Save fan profile/);assert.match(text,/Apply fan profile/);assert.match(text,/Use firmware fan control/);assert.doesNotMatch(text,/undefined/);
});

test('sensor range reset covers filtered-out sensors and preserves recorded history without hardware writes',async()=>{
  const snapshot=await new DemoProvider().snapshot(),history=[{at:'earlier',cpu:{temperature:60}}];
  const state={snapshot,history,search:'CPU',sensorRanges:new Map(snapshot.sensors.map(s=>[s.id,{min:1,max:99}]))};
  const make=(tag,cls,text)=>({...node(tag,text),events:{},addEventListener(type,fn){this.events[type]=fn;},replaceChildren(...children){this.children=children;}});
  const context=vm.createContext({state,Map,Set,Number,Math,el:make,panel:(title,icon,subtitle,extra)=>{const p=node('panel',title);p.append(extra);return p;},append:(p,...children)=>{p.append(...children.filter(Boolean));return p;},button:(text,cls,action)=>({...node('button',text),action}),fmt:String,render(){},toast(){},command(){throw Error('Sensor tools must never write hardware');}});
  vm.runInContext(source.slice(source.indexOf('const SENSOR_CATEGORIES='),source.indexOf('function activityPanel()')),context);
  const walk=n=>[n,...n.children.flatMap(walk)],nodes=walk(vm.runInContext('sensorsPanel()',context));
  const textOf=n=>[n.text??'',...n.children.map(textOf)].join(' ');
  assert.match(textOf(nodes.find(n=>n.id==='sensor-readings')),/CPU package/);
  assert.doesNotMatch(textOf(nodes.find(n=>n.id==='sensor-readings')),/GPU core/);
  nodes.find(n=>n.text==='Reset Min/Max').action();
  for(const sensor of snapshot.sensors){const range=state.sensorRanges.get(sensor.id);assert.equal(range.min,sensor.value);assert.equal(range.max,sensor.value);}
  assert.equal(state.history,history);assert.equal(history.length,1);
});

test('telemetry refresh updates filtered sensor readings while search stays focused',async()=>{
  const snapshot=await new DemoProvider().snapshot();snapshot.sensors.find(s=>s.group==='CPU').value=73.4;
  const state={snapshot,view:'sensors',search:'CPU',stopped:false},readings={replaceChildren(tree){this.tree=tree;}};
  let renders=0;
  const context=vm.createContext({state,Map,Set,Number,Math,window:{thinkpadDesktop:true},document:{activeElement:{getAttribute:()=> 'Find a sensor'}},$:selector=>{assert.equal(selector,'#sensor-readings');return readings;},el:(tag,cls,text)=>node(tag,text),append:(p,...children)=>{p.append(...children.filter(Boolean));return p;},fmt:String,render(){renders++;},api:async path=>path==='state'?{snapshot,stale:false,error:null}:[]});
  vm.runInContext('let refreshPromise;'+source.slice(source.indexOf('const SENSOR_CATEGORIES='),source.indexOf('function sensorsPanel()'))+source.slice(source.indexOf('async function refresh()'),source.indexOf('async function start()')),context);
  await vm.runInContext('refresh()',context);
  const textOf=n=>[n.text??'',...n.children.map(textOf)].join(' ');
  assert.match(textOf(readings.tree),/73\.4/);assert.doesNotMatch(textOf(readings.tree),/GPU core/);assert.equal(state.search,'CPU');assert.equal(renders,1);
});

test('temperature cards use actual CPU limits and never invent GPU or board health thresholds',async()=>{
  const snapshot=await new DemoProvider().snapshot();snapshot.cpu.temperature=81;snapshot.ryzen.current.temperatureLimit=100;
  const context=vm.createContext({state:{snapshot},Number,fmt:String,el:(tag,cls,text)=>({...node(tag,text),className:cls}),icon:()=>node('svg'),sparkline:()=>node('svg'),append:(p,...children)=>{p.append(...children.filter(Boolean));return p;}});
  vm.runInContext(source.slice(source.indexOf('function metric('),source.indexOf('function chart(')),context);
  const walk=n=>[n,...n.children.flatMap(walk)],badges=()=>walk(vm.runInContext('metrics()',context)).filter(n=>n.className?.startsWith('metric-health'));
  assert.equal(badges().length,1);assert.equal(badges()[0].text,'100°C limit');
  snapshot.cpu.temperature=96;assert.equal(badges()[0].text,'Near CPU limit');
  snapshot.cpu.temperature=100;assert.equal(badges()[0].text,'At CPU limit');
  snapshot.ryzen.current.temperatureLimit=86;snapshot.cpu.temperature=82;assert.equal(badges()[0].text,'Near CPU limit');
  snapshot.ryzen={available:false};snapshot.cpuSteps.hardware.thermalTargetC=95;snapshot.cpu.temperature=80;assert.equal(badges()[0].text,'95°C limit');
  delete snapshot.cpuSteps.hardware.thermalTargetC;assert.equal(badges().length,0);
  snapshot.ryzen={current:{temperatureLimit:999}};assert.equal(badges().length,0);
  snapshot.ryzen.current.temperatureLimit=86;snapshot.cpu.temperature=null;assert.equal(badges().length,0);
});

test('sensor search matches trimmed source and units, reports counts, and Escape clears without writes or lost ranges',async()=>{
  const snapshot=await new DemoProvider().snapshot();
  snapshot.sensors=[{id:'cpu/temperature',name:'Package',group:'CPU',type:'Temperature',value:55,unit:'°C',source:'Fixture adapter'},
    {id:'cpu/power',name:'Package',group:'CPU',type:'Power',value:18,unit:'W',source:'Other adapter'}];
  const state={snapshot,search:'  FIXTURE adapter  ',sensorRanges:new Map([['cpu/temperature',{min:40,max:60}]]),history:[{at:'earlier'}]},history=state.history;
  const make=(tag,cls,text)=>({...node(tag,text),events:{},addEventListener(type,fn){this.events[type]=fn;},replaceChildren(...children){this.children=children;}});
  const context=vm.createContext({state,Map,Set,Number,Math,el:make,panel:(title,icon,subtitle,extra)=>{const p=node('panel',title);p.append(extra);return p;},append:(p,...children)=>{p.append(...children.filter(Boolean));return p;},button:(text,cls,action)=>({...node('button',text),action}),fmt:String,command(){throw Error('Searching must not change hardware');}});
  vm.runInContext(source.slice(source.indexOf('const SENSOR_CATEGORIES='),source.indexOf('function activityPanel()')),context);
  const walk=n=>[n,...n.children.flatMap(walk)],textOf=n=>walk(n).map(n=>n.text??'').join(' ');
  let tree=vm.runInContext('sensorsPanel()',context),nodes=walk(tree),wrapper=nodes.find(n=>n.id==='sensor-readings'),search=nodes.find(n=>n.tag==='input');
  assert.match(textOf(wrapper),/1 of 2 sensors match/);assert.match(textOf(wrapper),/55 °C/);assert.doesNotMatch(textOf(wrapper),/18 W/);
  search.value=' °c ';search.events.input();assert.match(textOf(wrapper),/1 of 2 sensors match/);
  search.value='missing';search.events.input();assert.match(textOf(wrapper),/0 of 2 sensors match/);assert.match(textOf(wrapper),/No matching sensors/);
  let prevented=false,stopped=false;search.events.keydown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(search.value,'');assert.equal(state.search,'');
  assert.match(textOf(wrapper),/55 °C/);assert.match(textOf(wrapper),/18 W/);assert.doesNotMatch(textOf(wrapper),/sensors match/);
  search.value='   ';search.events.input();assert.doesNotMatch(textOf(wrapper),/No matching sensors|sensors match/);
  search.events.keydown({key:'Enter',preventDefault(){throw Error('Other keys must keep their default behavior');}});
  assert.equal(state.sensorRanges.get('cpu/temperature').min,40);assert.equal(state.sensorRanges.get('cpu/temperature').max,60);assert.equal(state.history,history);
});

test('Turbo panel offers restore after interruption and displays read-only limits without promising more watts',()=>{
  const state={snapshot:{turbo:{available:true,source:'ac',targets:[{key:'fastWatts',value:40}],notes:['Sustained power: read-only or unavailable.']}},busy:false,stale:false},commands=[];
  const context=vm.createContext({state,el:(tag,cls,text)=>node(tag,text),panel:()=>node('panel'),append:(p,...children)=>{p.append(...children);return p;},button:(text,cls,action)=>({...node('button',text),action}),fmt:String,command:c=>commands.push(c)});
  vm.runInContext(source.slice(source.indexOf('function turboPanel()'),source.indexOf('function stepChoice(')),context);
  const walk=n=>[n,...n.children.flatMap(walk)],textOf=n=>[n.text??'',...n.children.map(textOf)].join(' ');
  let nodes=walk(vm.runInContext('turboPanel()',context));assert.equal(nodes.find(n=>n.text==='Enable Turbo').disabled,false);assert.equal(nodes.find(n=>n.text==='Restore previous settings').disabled,true);
  assert.match(textOf(vm.runInContext('turboPanel()',context)),/Sustained power: read-only/);assert.match(textOf(vm.runInContext('turboPanel()',context)),/temperature limit stays unchanged/);
  state.snapshot.turbo={available:false,source:'ac',active:false,recoveryPending:true,reason:'Turbo was interrupted.'};nodes=walk(vm.runInContext('turboPanel()',context));
  assert.equal(nodes.find(n=>n.text==='Enable Turbo').disabled,true);assert.equal(nodes.find(n=>n.text==='Restore previous settings').disabled,false);
  nodes.find(n=>n.text==='Restore previous settings').action();assert.deepEqual(JSON.parse(JSON.stringify(commands)),[{type:'turbo',action:'restore'}]);
});
