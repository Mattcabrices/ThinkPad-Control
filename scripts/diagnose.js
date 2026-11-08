import { WindowsProvider } from '../src/providers.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
// Diagnose the current desktop package before considering older developer builds.
const built=['artifacts/windows-x64/bridge/ThinkPad.Bridge.exe','artifacts/native/ThinkPad.Bridge.exe','artifacts/bridge/ThinkPad.Bridge.exe'].map(path=>resolve(path)).find(existsSync);
const bridgePath=process.env.THINKPAD_BRIDGE||built;
// Never attach this diagnostic to another app session's private worker pipe.
const provider=new WindowsProvider({bridgePath,pipeName:null});
try {
  const s=await provider.snapshot();
  console.log(JSON.stringify({readOnly:true,bridgePath,machine:s.machine,cpu:s.cpu,motherboard:s.motherboard,boost:s.boost,admin:s.admin,powerSource:s.powerSource,
    gpus:s.gpus,fans:s.fans,fanEngine:s.fanEngine,driver:s.driver,capabilities:s.capabilities,sensorCount:s.sensors.length,warnings:s.warnings},null,2));
} finally { await provider.close(); }
