import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityReport } from '../src/compat-report.js';
import { createApp } from '../src/server.js';
import { DemoProvider } from '../src/providers.js';
import { Store } from '../src/store.js';

const base={mode:'live',machine:{manufacturer:'LENOVO',model:'21XX',productName:'ThinkPad Test',biosVersion:'R1'},cpu:{name:'AMD Ryzen'},driver:{deviceAccessible:true},fans:[],sensors:[{type:'Temperature',name:'secret-sensor'},{type:'Temperature'},{type:'Fan'}]};
const report=ryzen=>buildCompatibilityReport({...base,ryzen});

test('firmware maximum export is read-only, allowlisted, and drops stale values',()=>{
  const data={available:true,status:'reported',source:'Lenovo firmware',serial:'private-serial',limits:[{field:'cpuBurstWatts',profile:'Custom',profileId:255,minimumWatts:15,defaultWatts:45,maximumWatts:80,stepWatts:1,privateAddress:'secret'},{field:'secret-field',maximumWatts:400}]};
  let result=buildCompatibilityReport({...base,firmwarePowerLimits:data}).firmwarePowerLimits;
  assert.equal(result.readOnly,true);assert.equal(result.limits.length,1);assert.equal(result.limits[0].maximumWatts,80);
  assert.doesNotMatch(JSON.stringify(result),/private-serial|privateAddress|secret/);
  data.available=false;result=buildCompatibilityReport({...base,firmwarePowerLimits:data}).firmwarePowerLimits;
  assert.deepEqual(result.limits,[]);
});

test('supported host reports family, table and field availability',()=>{
  const r=report({available:true,current:{fastWatts:25},baseline:{fastWatts:25},model:'20XGS09A00 · Cezanne / Barcelo · table 0x00400005',fields:{sustainedWatts:{available:false,reason:'Read-only'},fastWatts:{available:true,reason:''}}}).ryzen;
  assert.equal(r.status,'supported');assert.equal(r.family,'Cezanne / Barcelo');assert.equal(r.tableVersion,'0x00400005');
  assert.deepEqual(r.fields.sustainedWatts,{available:false,reason:'Read-only'});
});
test('a supported layout reports its codename and the route a sustained write took',()=>{
  const r=report({available:true,current:{fastWatts:28},codeName:10,sustainedRoute:'MP1 acknowledged',model:'21CGS01R02 · Rembrandt · table 0x00450005',fields:{}}).ryzen;
  assert.equal(r.codename,10);assert.equal(r.sustainedRoute,'MP1 acknowledged');
});
test('fields are not reported as available while the adapter is unavailable',()=>{
  const r=report({available:false,reason:'Power source changed.',codeName:10,fields:{fastWatts:{available:true,reason:''}}}).ryzen;
  assert.equal(r.status,'unavailable');assert.equal(r.fields.fastWatts.available,false);
});
test('a refused layout still captures the codename and table needed to review it',()=>{
  const r=report({available:false,reason:'No reviewed Ryzen layout for codename 23, table 0x004C0005. Monitoring through other adapters remains available.'}).ryzen;
  assert.equal(r.status,'unreviewed-layout');assert.equal(r.codename,23);assert.equal(r.tableVersion,'0x004C0005');
});
test('missing hardware access is not reported as unsupported',()=>{
  assert.equal(report({available:false,reason:'Enable hardware access to discover direct Ryzen tuning.'}).ryzen.status,'no-hardware-access');
});
test('stale read after a power change is not reported as supported',()=>{
  assert.equal(report({available:false,reason:'Ryzen tuning unavailable: timeout'}).ryzen.status,'unavailable');
});
test('allowlist drops unlisted data and scrubs user paths',()=>{
  const r=buildCompatibilityReport({...base,machine:{...base.machine,serialNumber:'SERIAL123'},hostname:'MY-PC',warnings:['private warning'],ryzen:{available:false,reason:'Failed at C:\\Users\\alex\\app from 192.168.1.5'}});
  const text=JSON.stringify(r);
  for(const secret of ['SERIAL123','MY-PC','private warning','alex','192.168.1.5','secret-sensor'])assert.ok(!text.includes(secret),secret);
  assert.deepEqual(r.sensorCounts,{Temperature:2,Fan:1});
});
test('sensor monitor status reports completeness without exposing private provider errors',()=>{
  const r=buildCompatibilityReport({...base,sensorMonitor:{initialized:true,complete:false,warningCount:1,warnings:['private provider path'],internalPath:'secret'}});
  assert.deepEqual(r.sensorMonitor,{initialized:true,complete:false,warningCount:1});
  assert.ok(!JSON.stringify(r).includes('private provider path'));
  assert.ok(!JSON.stringify(r).includes('secret'));
});
test('demo data is labeled simulated, and the endpoint needs the session token',async t=>{
  const app=createApp({store:new Store(':memory:'),provider:new DemoProvider(),interval:60000});
  const url=await app.listen(0);t.after(()=>app.close());
  assert.equal((await fetch(url+'/api/compatibility-report')).status,403);
  const {token}=await fetch(url+'/api/session').then(r=>r.json());
  const response=await fetch(url+'/api/compatibility-report',{headers:{'X-Control-Token':token}});
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.ryzen.status,'simulated');assert.match(body.appVersion,/^\d+\.\d+\.\d+/);
});
