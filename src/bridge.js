import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Executable path is operator configuration, never accepted over HTTP.
export class NativeBridge {
  constructor(executable) { this.executable = executable; this.pending = new Map(); this.sequence = 0; }
  start() {
    if (this.child) return;
    let child;
    try { child = spawn(this.executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch(e) { throw new Error(['UNKNOWN','EACCES'].includes(e.code) ? 'Windows could not start the hardware worker. Application Control or code-signing policy may require a trusted signed build.' : e.message); }
    this.child = child;
    this.lastError = '';
    const fail = message => {
      this.lastError = message;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); }
      this.pending.clear();
      if (this.child === child) this.child = null;
    };
    child.on('error', e => fail(`Native bridge: ${e.message}`));
    child.on('exit', () => fail('Native sensor bridge exited. Manual fans must return to firmware.'));
    child.stdin.on('error', () => {});
    child.stderr.on('data', chunk => { this.lastError = String(chunk).slice(-1000); });
    createInterface({ input: child.stdout }).on('line', line => {
      try {
        const reply = JSON.parse(line), p = this.pending.get(reply.id);
        if (!p) return;
        clearTimeout(p.timer); this.pending.delete(reply.id);
        if (reply.error) p.reject(new Error(reply.error)); else p.resolve(reply.result);
      } catch { fail('Invalid native bridge reply.'); child.stdin.end(); }
    });
  }
  request(op, args = {}) {
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Close stdin to trigger firmware restoration; do not kill the native watchdog.
        this.child?.stdin.end();
        reject(new Error('Native bridge timed out; manual fan lease released.'));
      }, op === 'fan-curve' ? 60000 : 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, op, ...args }) + '\n', e => {
        if (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
      });
    });
  }
  close() { this.child?.stdin.end(); }
}
