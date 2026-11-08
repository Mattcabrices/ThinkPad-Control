// What each fan level really does on this laptop, learned from its own tachometer. No ThinkPad reports this
// and it differs by model, so a level with no settled reading stays "not measured" instead of being estimated.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const SETTLE_MS = 15000, FULL_SPEED_LEVEL = 64;

export class FanLevelSpeeds {
  constructor(file = null, now = () => Date.now()) { this.file = file; this.now = now; this.current = null; this.data = this.load(); }
  load() {
    const empty = { speeds: {}, firmwarePeak: null };
    if (!this.file || !existsSync(this.file)) return empty;
    try { const value = JSON.parse(readFileSync(this.file, 'utf8')); return value && typeof value.speeds === 'object' ? { firmwarePeak: value.firmwarePeak ?? null, speeds: value.speeds } : empty; } catch { return empty; }
  }
  save() {
    if (!this.file) return;
    try { mkdirSync(dirname(this.file), { recursive: true }); const temporary = `${this.file}.tmp`; writeFileSync(temporary, JSON.stringify(this.data)); renameSync(temporary, this.file); } catch { /* Readings are learned again if they can't be kept. */ }
  }
  observe(fans) {
    const fan = (fans ?? []).find(f => f.controlUnit === 'level');
    if (!fan) return;
    const valid = Number.isFinite(fan.rpm) && fan.rpm > 0;
    if (fan.mode === 'auto' && valid && fan.rpm > (this.data.firmwarePeak ?? 0)) { this.data.firmwarePeak = fan.rpm; this.save(); }
    const level = ['manual', 'curve'].includes(fan.mode) ? fan.level : null;
    if (!Number.isInteger(level) || level < 1) { this.current = null; return; }
    if (this.current?.level !== level) { this.current = { level, since: this.now() }; return; }
    // The fan takes seconds to change speed. A zero reading can be wrong, so it is never recorded as a speed.
    if (!valid || this.now() - this.current.since < SETTLE_MS) return;
    const old = this.data.speeds[level];
    const next = level === FULL_SPEED_LEVEL ? Math.max(old ?? 0, fan.rpm) : fan.rpm;
    if (next !== old) { this.data.speeds[level] = next; this.save(); }
  }
  view() { return { speeds: { ...this.data.speeds }, firmwarePeak: this.data.firmwarePeak, settleSeconds: SETTLE_MS / 1000 }; }
}
