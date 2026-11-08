import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('fan configuration migration validates numeric settings and commits/rolls back transactionally',{skip:process.platform!=='win32'},()=>{
  const output=execFileSync(`${process.env.SystemRoot}/System32/WindowsPowerShell/v1.0/powershell.exe`,['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',fileURLToPath(new URL('./engine-config-migration.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.match(output,/migration assertions passed/);
});
