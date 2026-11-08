import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Store } from './store.js';
import { DemoProvider, WindowsProvider, validateCommand } from './providers.js';
import { buildCompatibilityReport } from './compat-report.js';
import {TurboController} from './turbo.js';

const assets = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app.js', ['app.js','text/javascript; charset=utf-8']],
  ['/desktop.js', ['desktop.js','text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css','text/css; charset=utf-8']],
  ['/theme.css', ['theme.css','text/css; charset=utf-8']]
]);
export function createApp({ provider, store, interval = 3000, monotonicNow = () => performance.now(), turboStateFile = null } = {}) {
  if (!provider || !store) throw new Error('Provider and store are required.');
  const token = randomBytes(32).toString('hex');
  let snapshot = null, lastError = null, lastLease = null, timer, stopping = false, expectedHost, queued = 0, closingPromise;
  let tail = Promise.resolve();
  const turbo=new TurboController(provider,{file:turboStateFile,leaseAlive:()=>lastLease!==null&&monotonicNow()-lastLease<7500});
  const readSnapshot=async()=>{const s=await provider.snapshot();return {...s,turbo:turbo.view(s)};};
  const serialized = fn => {
    if (queued >= 32) return Promise.reject(new Error('Hardware command queue is full.'));
    queued++;
    const result = tail.then(fn);
    tail = result.catch(() => {}).finally(() => { queued--; });
    return result;
  };
  const poll = async () => {
    try {
      await provider.heartbeat(lastLease !== null && monotonicNow() - lastLease < 7500);
      snapshot = await readSnapshot();
      store.sample(snapshot); lastError = null;
    } catch (e) { lastError = e.message; }
  };
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(body));
  };
  const authorized = req => {
    const supplied = req.headers['x-control-token'];
    return typeof supplied === 'string' && supplied.length === token.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      if (req.headers.host !== expectedHost) return json(res,403,{ error:'Invalid host.' });
      if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) return json(res,403,{ error:'Cross-origin requests are forbidden.' });
      if (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) return json(res,403,{ error:'Cross-site requests are forbidden.' });
      const url = new URL(req.url,`http://${expectedHost}`);
      if (req.method === 'GET') {
        if (url.pathname === '/api/session') return json(res,200,{ token, mode: provider instanceof DemoProvider ? 'demo' : 'live' });
        if (url.pathname.startsWith('/api/') && !authorized(req)) return json(res,403,{ error:'Session token required.' });
        if (url.pathname === '/api/state') return json(res,200,{ snapshot, error:lastError, stale: !snapshot || Date.now()-Date.parse(snapshot.at)>15000 });
        if (url.pathname === '/api/history') {
          const minutes = Number(url.searchParams.get('minutes') || 10);
          if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) return json(res,400,{ error:'History window must be 1–60 minutes.' });
          return json(res,200,store.history(minutes));
        }
        if (url.pathname === '/api/activity') return json(res,200,store.activity());
        if (url.pathname === '/api/compatibility-report') {
          if (!snapshot) return json(res,503,{ error:'No hardware snapshot is available yet.' });
          const { version } = JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
          return json(res,200,buildCompatibilityReport(snapshot,{ appVersion:version }));
        }
        const asset = assets.get(url.pathname);
        if (asset) {
          const content = await readFile(new URL(`../public/${asset[0]}`,import.meta.url));
          res.writeHead(200,{ 'Content-Type':asset[1] }); return res.end(content);
        }
        return json(res,404,{ error:'Not found.' });
      }
      if (req.method !== 'POST') return json(res,405,{ error:'Method not allowed.' });
      if (!authorized(req)) return json(res,403,{ error:'Session token required.' });
      if (stopping) return json(res,503,{ error:'Application is shutting down.' });
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return json(res,415,{ error:'JSON required.' });
      let bytes = 0, chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 16384) return json(res,413,{ error:'Request too large.' });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return json(res,400,{ error:'Invalid JSON.' }); }
      if (url.pathname === '/api/lease') {
        if (!body || typeof body.active !== 'boolean' || Object.keys(body).length !== 1) return json(res,400,{error:'Expected an active boolean.'});
        lastLease = body.active ? monotonicNow() : null;
        if (!body.active) await serialized(()=>provider.heartbeat(false));
        return json(res,200,{ ok:true });
      }
      if (url.pathname === '/api/restore-fans') {
        if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length) return json(res,400,{error:'Expected an empty object.'});
        await serialized(async()=>{
          lastLease=null;await provider.heartbeat(false);
          const observed=await provider.snapshot();
          for (const fan of observed.fans.filter(f=>f.capability.available&&f.mode!=='auto')) {
            const c={type:'fan',id:fan.id,mode:'auto'},id=store.begin(c);
            try{const result=await provider.command(c);store.finish(id,'success',result);}
            catch(e){store.finish(id,'error',e.message);throw e;}
          }
          snapshot=await readSnapshot();store.sample(snapshot);
        });
        return json(res,200,{message:'Firmware control checked for available fan channels.'});
      }
      if (url.pathname === '/api/shutdown') {
        if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length) return json(res,400,{error:'Expected an empty object.'});
        stopping=true;
        json(res,200,{message:'Local service stopped. Firmware control requested for owned fans.'});
        setTimeout(()=>closeApplication().catch(e=>console.error(e.message)),25);
        return;
      }
      if (url.pathname !== '/api/commands') return json(res,404,{ error:'Not found.' });
      let command;
      try { command = validateCommand(body); } catch(e) { return json(res,400,{error:e.message}); }
      try {
        const result = await serialized(async () => {
          const id = store.begin(command);
          try {
            turbo.guard(command);
            if(command.type==='turbo'&&command.action==='enable')lastLease=monotonicNow();
            const message = command.type==='turbo'?await turbo.command(command.action):await provider.command(command);
            lastLease = monotonicNow();
            snapshot = await readSnapshot();
            store.sample(snapshot); lastError = null;
            store.finish(id,'success',message);
            return { message, snapshot };
          } catch(e) {
            let detail=e.message;
            if(command.type==='turbo'&&command.action==='enable'&&turbo.saved){
              try{detail+=' '+await turbo.command('restore');}
              catch(recovery){detail+=` Turbo restoration remains pending: ${recovery.message}`;}
            }
            if(command.type==='fan') {
              lastLease=null;
              try { await provider.heartbeat(false); }
              catch(recovery) { detail+=` Lease release failed: ${recovery.message}`; }
            }
            store.finish(id,'error',detail);await poll();throw new Error(detail);
          }
        });
        return json(res,200,result);
      } catch(e) { return json(res,409,{ error:e.message }); }
    } catch(e) { if (!res.headersSent) json(res,500,{ error:e.message }); else res.end(); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const closeApplication = () => {
    if (closingPromise) return closingPromise;
    closingPromise=(async()=>{
      stopping = true; clearTimeout(timer);
      server.closeIdleConnections();
      await new Promise(resolveClose => server.close(resolveClose));
      await tail; await provider.close(); store.close();
    })();
    return closingPromise;
  };
  return {
    server,
    async listen(port = 47831) {
      await new Promise((accept,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',accept); });
      expectedHost = `127.0.0.1:${server.address().port}`;
      await serialized(poll); store.prune();
      let ticks = 0;
      const schedule = () => {
        timer = setTimeout(async () => {
          if (stopping) return;
          await serialized(async () => { await poll(); if (++ticks % 100 === 0) store.prune(); });
          if (!stopping) schedule();
        },interval);
      };
      schedule();
      return `http://${expectedHost}`;
    },
    close: closeApplication,
    sessionToken: token
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const intelDemo=process.argv.includes('--demo-intel');
  const demo = process.argv.includes('--demo')||intelDemo;
  const port = Number(process.env.PORT || 47831);
  const desktop=process.argv.includes('--desktop');
  if (!Number.isInteger(port) || (port < 1024 && !(port===0&&desktop)) || port > 65535) throw new Error('PORT must be 1024–65535 (or 0 for desktop mode).');
  const store = new Store(resolve(process.env.THINKPAD_DATA_DIR || 'data',intelDemo ? 'demo-intel.sqlite' : demo ? 'demo.sqlite' : 'thinkpad.sqlite'));
  const builtBridge = resolve('artifacts/bridge/ThinkPad.Bridge.exe');
  const app = createApp({ provider:demo ? new DemoProvider(intelDemo?'intel':'ryzen') : new WindowsProvider({bridgePath:process.env.THINKPAD_BRIDGE || (existsSync(builtBridge)?builtBridge:undefined),boostStateFile:resolve(process.env.THINKPAD_DATA_DIR || 'data','max-boost-baseline.json'),fanProfileFile:resolve(process.env.THINKPAD_DATA_DIR || 'data','fan-profiles.json')}), store,
    turboStateFile:resolve(process.env.THINKPAD_DATA_DIR || 'data',demo?(intelDemo?'turbo-demo-intel.json':'turbo-demo.json'):'turbo-recovery.json') });
  try {
    const url = await app.listen(port);
    if(desktop)console.log('DESKTOP_READY '+JSON.stringify({url,token:app.sessionToken}));
    console.log(`ThinkPad Control · ${demo ? 'SIMULATED DEMO' : 'LIVE HARDWARE'}\nOpen ${url}\nPress Ctrl+C to stop and release fan leases.`);
    if (process.argv.includes('--open') && process.platform === 'win32') execFile('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true},()=>{});
    const shutdown = async () => { try { await app.close(); process.exit(0); } catch(e) { console.error(e.message); process.exit(1); } };
    process.once('SIGINT',shutdown); process.once('SIGTERM',shutdown);
    const parent=Number(process.env.THINKPAD_PARENT_PID);
    if(desktop&&Number.isInteger(parent)&&parent>0)setInterval(()=>{
      try{process.kill(parent,0);}catch(e){if(e.code==='ESRCH')void shutdown();}
    },2000).unref();
  } catch(e) { console.error(e.message); await app.close().catch(() => {}); process.exitCode = 1; }
}
