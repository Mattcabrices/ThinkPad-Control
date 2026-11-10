import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,statSync} from 'node:fs';
import {dirname} from 'node:path';
import {engineRows} from './fan-curves.js';

const powerFields=['sustainedWatts','fastWatts','slowWatts'];
const identity=s=>JSON.stringify([s.machine?.manufacturer,s.machine?.model,s.cpu?.name,s.cpuSteps?.vendor]);
const sourceOf=s=>s.powerSource==='Online'?'ac':s.powerSource==='Offline'?'dc':null;
const equal=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=0.11;
const integer=(v,max)=>Number.isInteger(v)&&v>=0&&v<=max;
const sourcePolicy=(s,source)=>({scheme:s.cpuSteps?.policy?.scheme,source,hybrid:s.cpuSteps?.hardware?.hybrid===true,
  frequency:s.cpuSteps?.policy?.[source],frequencyClass1:s.cpuSteps?.policy?.class1?.[source]??null,
  mode:s.boost?.[source],epp:s.cpuSteps?.policy?.epp?.[source],eppClass1:s.cpuSteps?.policy?.eppClass1?.[source]??null});
export function validateTurboPolicy(b) {
  if(!b||!['ac','dc'].includes(b.source)||typeof b.scheme!=='string'||!(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.scheme)||b.scheme==='demo')||
    typeof b.hybrid!=='boolean'||!integer(b.frequency,8000)||!integer(b.mode,6)||!integer(b.epp,100)||
    b.hybrid&&(!integer(b.frequencyClass1,8000)||!integer(b.eppClass1,100)))throw Error('The previous CPU policy cannot be captured safely.');
}
function validateJournal(j) {
  if(j===null)return;
  if(!j||j.schemaVersion!==1||typeof j.identity!=='string'||j.identity.length>2048||!Array.isArray(j.attempted)||
    j.attempted.some(v=>!['fan','frequency','boost',...powerFields].includes(v)))throw Error('Invalid Turbo recovery record.');
  validateTurboPolicy(j.before?.policy);
  const f=j.before.fan;
  if(!f||typeof f.id!=='string'||!['auto','curve'].includes(f.mode)||f.id.length>200)throw Error('Invalid fan recovery record.');
  if(f.mode==='curve'&&(!f.profile||typeof f.profile.id!=='string'||!Array.isArray(f.profile.levels)||f.profile.levels.length!==7||
    !f.profile.levels.every(v=>integer(v,110))||typeof f.profile.fanOff!=='boolean'||!integer(f.limit,110)||
    !Array.isArray(f.masks)||f.masks.some(m=>!Array.isArray(m)||m.length!==2||!integer(m[0],11)||m[0]<1||!integer(m[1],70)||m[1]<1)))throw Error('Invalid curve recovery record.');
  if(j.before.ryzen!==null&&(!j.before.ryzen||[...powerFields,'temperatureLimit'].some(k=>!Number.isFinite(j.before.ryzen[k])||j.before.ryzen[k]<1||j.before.ryzen[k]>(k==='temperatureLimit'?110:100))))throw Error('Invalid Ryzen recovery values.');
  if(f.mode==='curve')engineRows(f.profile.levels,f.profile.fanOff,f.limit,f.profile.maxTemp);
  if(!Array.isArray(j.targets)||j.targets.length>3||j.targets.some(t=>!powerFields.includes(t.key)||!Number.isFinite(t.value)||t.value<5||t.value>100)||
    !Array.isArray(j.notes)||!j.notes.every(n=>typeof n==='string'&&n.length<=1000))throw Error('Invalid Turbo targets.');
  const recovery=j.before.boostRecovery;
  if(recovery!==null&&(!recovery||!integer(recovery.mode,6)||!integer(recovery.epp,100)||recovery.eppClass1!==undefined&&!integer(recovery.eppClass1,100)||recovery.recoveryPending===true))throw Error('Invalid previous boost recovery state.');
}
export function planTurbo(s) {
  const source=sourceOf(s),fan=s.fans?.find(f=>f.controlUnit==='level'&&f.capability?.available&&['tpfc/cooling-system','demo-cooling'].includes(f.id));
  if(!source)throw Error('AC/battery status is unavailable. Turbo cannot choose a power source.');
  if(!s.capabilities?.cpuMaxBoost?.available||!s.capabilities?.cpuStep?.available)throw Error('Turbo needs verified Maximum boost and CPU speed-limit controls.');
  if(!fan||fan.manualOwned===true||!['auto','curve'].includes(fan.mode))throw Error('Return the fan to firmware or a saved curve before enabling Turbo. A writable Max fan control is required.');
  if(s.cpuSteps?.maxBoostRecovery?.[source])throw Error('Finish boost recovery before enabling Turbo.');
  const policy=sourcePolicy(s,source);validateTurboPolicy(policy);
  const cutoff=s.fanProfiles?.manualTemperature?.celsius;
  if(!Number.isFinite(cutoff)||!Number.isFinite(s.cpu?.temperature)||s.cpu.temperature>=cutoff||
    s.gpus?.some(g=>Number.isFinite(g.temperature)&&g.temperature>=cutoff))throw Error('Turbo requires fresh temperatures below the manual fan cutoff.');
  const profile=s.fanProfiles?.profiles?.find(p=>p.id===s.fanProfiles.activeId)??
    (s.fanProfiles?.currentCurve?{id:'captured-curve',...structuredClone(s.fanProfiles.currentCurve),valid:true}:null);
  if(fan.mode==='curve'&&(!profile?.valid||s.fanProfiles.reapply))throw Error('The running fan curve cannot be captured safely. Apply a supported curve or return to firmware before enabling Turbo.');
  const targets=[],notes=[];
  if(s.ryzen?.available){
    for(const key of powerFields){
      const r=s.ryzen.ranges?.[key],field=s.ryzen.fields?.[key],current=s.ryzen.current?.[key];
      if(field?.available!==true||!r||!Number.isFinite(r.max)||r.max<5||r.max>100||!Number.isFinite(current)){
        notes.push(`${({sustainedWatts:'Sustained power',fastWatts:'Burst power',slowWatts:'Average power'})[key]}: read-only or unavailable.`);continue;
      }
      const value=Math.floor(r.max*10)/10;
      if(value>current+0.11)targets.push({key,value});
    }
  }else notes.push(s.cpuSteps?.vendor==='GenuineIntel'?'Intel wattage limits remain read-only.':'Direct wattage tuning is unavailable.');
  const ryzen=s.ryzen?.available?structuredClone(s.ryzen.current):null;
  return {schemaVersion:1,identity:identity(s),createdAt:new Date().toISOString(),attempted:[],targets,notes,
    before:{policy,ryzen,fan:{id:fan.id,mode:fan.mode,...(profile&&fan.mode==='curve'?{profile:structuredClone(profile),limit:s.fanProfiles.limit.celsius,masks:structuredClone(s.fanProfiles.maskedSlots??[])}:{})},boostRecovery:null}};
}

// One journal per backend/data directory. Never resumes Turbo automatically.
export class TurboController {
  constructor(provider,{file=null,leaseAlive=()=>true,onSnapshot=()=>{}}={}) {
    this.provider=provider;this.file=file;this.leaseAlive=leaseAlive;this.onSnapshot=onSnapshot;this.saved=null;this.error=null;this.startedHere=false;
    try{if(file&&existsSync(file)){if(statSync(file).size>65536)throw Error('Turbo recovery file is too large.');this.saved=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));validateJournal(this.saved);}}
    catch(e){this.saved=null;this.error=`Turbo recovery record could not be read: ${e.message}`;}
  }
  async snapshot(){
    const s=await this.provider.snapshot();
    // Publish actual worker readings during the serialized transaction. Never
    // synthesize a timestamp or renew the requesting UI's independent lease.
    this.onSnapshot({...s,turbo:this.view(s)});return s;
  }
  persist(value){
    validateJournal(value);
    if(this.file){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(value));renameSync(this.file+'.tmp',this.file);}
    this.saved=value;
  }
  view(s){
    if(this.error)return {available:false,reason:this.error,recoveryPending:false,active:false};
    if(!this.saved){try{const p=planTurbo(s);return {available:true,active:false,recoveryPending:false,source:p.before.policy.source,targets:p.targets,notes:p.notes};}catch(e){return {available:false,active:false,recoveryPending:false,reason:e.message};}}
    const j=this.saved,b=j.before.policy,fan=s.fans?.find(f=>f.id===j.before.fan.id),p=s.cpuSteps?.policy;
    const active=this.startedHere&&identity(s)===j.identity&&sourceOf(s)===b.source&&p?.scheme===b.scheme&&
      s.cpuSteps?.maxBoost?.[b.source]===true&&p[b.source]===0&&(!b.hybrid||p.class1?.[b.source]===0)&&
      fan?.mode==='manual'&&fan.level===64&&j.targets.every(t=>equal(s.ryzen?.current?.[t.key],t.value))&&
      (!j.before.ryzen||equal(s.ryzen?.current?.temperatureLimit,j.before.ryzen.temperatureLimit));
    return {available:false,active,recoveryPending:true,source:b.source,targets:j.targets,notes:j.notes,
      reason:active?'Turbo settings verified.':this.restoreError||'Turbo was interrupted or settings changed. Restore previous settings before enabling it again.'};
  }
  guard(c){
    if(this.saved&&c.type!=='turbo'&&!(c.type==='fan'&&c.mode==='auto'))throw Error('Restore previous Turbo settings before changing other controls. Return to firmware remains available.');
  }
  async command(action){
    if(action==='restore')return this.restore();
    if(this.saved||this.error)throw Error(this.error||'Restore previous Turbo settings before enabling it again.');
    const initial=await this.snapshot(),j=planTurbo(initial);
    j.before.boostRecovery=this.provider.turboBoostRecovery?.(j.before.policy)??null;
    this.persist(j);this.startedHere=false;
    const requireLease=()=>{if(!this.leaseAlive())throw Error('The app connection was lost during Turbo activation.');};
    const attempt=async(key,c)=>{requireLease();
      const s=await this.snapshot();requireLease();
      if(identity(s)!==j.identity||sourceOf(s)!==j.before.policy.source||s.cpuSteps?.policy?.scheme!==j.before.policy.scheme)throw Error('Power source, device or power plan changed during Turbo activation.');
      j.attempted.push(key);this.persist(j);await this.provider.command(c);};
    // Keep the worker's existing watchdog alive only while the requesting UI has
    // a fresh lease. A missing UI still releases the fan independently.
    let renewing=false;
    const timer=setInterval(async()=>{if(renewing||!this.leaseAlive())return;renewing=true;try{await this.provider.heartbeat(true);}catch{}finally{renewing=false;}},2000);
    try{
      await attempt('fan',{type:'fan',id:j.before.fan.id,mode:'manual',level:64});
      const b=j.before.policy;
      if(b.frequency!==0||b.hybrid&&b.frequencyClass1!==0)await attempt('frequency',{type:'cpu-step',source:b.source,mhz:0});
      if(!initial.cpuSteps.maxBoost?.[b.source])await attempt('boost',{type:'cpu-max-boost',source:b.source,enabled:true});
      for(const target of j.targets)await attempt(target.key,{type:'ryzen-tune',setting:target.key,value:target.value,restore:false});
      this.startedHere=true;
      const after=await this.snapshot();if(!this.view(after).active||!this.leaseAlive())throw Error('Turbo read-back did not match all requested settings.');
      return `Turbo verified for ${b.source==='ac'?'AC power':'battery'}. ${j.notes.join(' ')} Firmware still governs actual clocks and sustained wattage.`;
    }catch(e){
      clearInterval(timer);
      try{await this.restore();throw Error(`${e.message} Previous settings restored and verified.`);}
      catch(recovery){if(!this.saved)throw recovery;throw Error(`${e.message} Restoration is incomplete: ${recovery.message}`);}
    }finally{clearInterval(timer);}
  }
  async restore(){
    if(!this.saved)throw Error(this.error||'No previous Turbo settings are saved.');
    const j=this.saved,errors=[];this.startedHere=false;
    const s=await this.provider.snapshot();if(identity(s)!==j.identity)throw Error('The connected device differs from the Turbo recovery record. No recovery writes were made.');
    const tryRestore=async(fn)=>{try{await fn();}catch(e){errors.push(e.message);}};
    const groups=['frequency','boost'].filter(k=>j.attempted.includes(k));
    if(groups.length)await tryRestore(()=>this.provider.restoreTurboPolicy(j.before.policy,groups,j.before.boostRecovery));
    if(j.before.ryzen&&j.attempted.some(k=>powerFields.includes(k))){
      // Some firmware reports a read-only sustained limit coupled to PPT fast.
      // Restore the controls we actually attempted first, then check collateral
      // readings. A genuinely unrestored read-only value still retains recovery.
      const restoreFields=[...new Set([...j.attempted.filter(k=>powerFields.includes(k)),...powerFields,'temperatureLimit'])];
      for(const key of restoreFields)await tryRestore(async()=>{
        const now=await this.provider.snapshot(),value=j.before.ryzen[key];if(equal(now.ryzen?.current?.[key],value))return;
        const field=now.ryzen?.fields?.[key],baseline=now.ryzen?.baseline?.[key];
        await this.provider.command(field?.available===false&&field.restoreAvailable!==false&&equal(baseline,value)?
          {type:'ryzen-tune',setting:key,restore:true}:{type:'ryzen-tune',setting:key,value:Math.round(value*10)/10,restore:false});
      });
    }
    // Release manual control even if policy restoration failed. Never leave an
    // unattended manual fan just because another restoration step was refused.
    if(j.attempted.includes('fan'))await tryRestore(async()=>{
      await this.provider.command({type:'fan',id:j.before.fan.id,mode:'auto'});
      if(j.before.fan.mode==='curve')await this.provider.restoreTurboCurve(j.before.fan);
    });
    await tryRestore(async()=>{
      const after=await this.provider.snapshot(),p=sourcePolicy(after,j.before.policy.source),b=j.before.policy;
      for(const key of ['scheme',...(groups.includes('frequency')?['frequency',...(b.hybrid?['frequencyClass1']:[])]:[]),...(groups.includes('boost')?['mode','epp',...(b.hybrid?['eppClass1']:[])]:[])])if(p[key]!==b[key])throw Error(`Previous CPU ${key} could not be verified.`);
      if(j.before.ryzen&&j.attempted.some(k=>powerFields.includes(k))&&[...powerFields,'temperatureLimit'].some(k=>!equal(after.ryzen?.current?.[k],j.before.ryzen[k])))throw Error('Previous Ryzen limits could not be verified.');
      if(j.attempted.includes('fan')&&after.fans?.find(f=>f.id===j.before.fan.id)?.mode!==j.before.fan.mode)throw Error('Previous fan mode could not be verified.');
      if(j.attempted.includes('fan')&&j.before.fan.mode==='curve'&&!turboCurveMatches(j.before.fan,after))throw Error('Previous fan curve could not be verified.');
    });
    if(errors.length){this.restoreError=`Restoration incomplete: ${errors.join(' ')}`;throw Error(this.restoreError);}
    this.persist(null);this.restoreError=null;return 'Previous CPU, wattage and fan settings restored and verified.';
  }
}

export function turboCurveRows(saved){return engineRows(saved.profile.levels,saved.profile.fanOff,saved.limit,saved.profile.maxTemp);}
export function turboCurveMatches(saved,snapshot){
  const view=snapshot.fanProfiles,current=view?.currentCurve;
  if(!current||!view.curveSet)return false;
  try{return JSON.stringify(engineRows(current.levels,current.fanOff,view.limit?.celsius,current.maxTemp))===JSON.stringify(turboCurveRows(saved))&&
    JSON.stringify(view.maskedSlots??[])===JSON.stringify(saved.masks);}
  catch{return false;}
}
