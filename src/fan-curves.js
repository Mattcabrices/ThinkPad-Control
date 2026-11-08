// Named fan profiles for the bundled engine's temperature curve. Each profile holds the temperature
// at which fan levels 1-7 start. This file holds the rules; the elevated worker checks them again.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const FAN_LEVELS = 7, MIN_CURVE_TEMP = 30, MAX_FAN_OFF_TEMP = 65, MAX_PROFILES = 12;
const MAXIMUM_LEVEL = 64; // Level 10 / Boost mode: the EC's unregulated top speed.
const validLimit = value => Number.isFinite(value) && value >= 60 && value <= 110;

// Each laptop's own limit, read from its firmware. Nothing is assumed when it can't be read.
export function firmwareThermalLimit(snapshot) {
  const ryzen = snapshot?.ryzen;
  // A limit raised through tuning doesn't raise the temperature firmware reported as its own.
  const readings = [ryzen?.current?.temperatureLimit, ryzen?.baseline?.temperatureLimit].filter(validLimit);
  if (ryzen?.available && readings.length) return { celsius: Math.round(Math.min(...readings)), source: 'Ryzen firmware limit' };
  const intel = snapshot?.cpuSteps?.hardware?.thermalTargetC;
  if (validLimit(intel)) return { celsius: Math.round(intel), source: 'Intel thermal target' };
  return null;
}

// Offsets below the limit. The limit itself is maximum fan speed, so level 7 always starts below it.
const TEMPLATES = [
  { name: 'Computer active', fanOff: true, offsets: [31, 25, 20, 15, 10, 5, 1] },
  { name: 'Server inactive', fanOff: true, offsets: [41, 35, 30, 25, 20, 14, 8] }
];
function levelsFromOffsets(offsets, limit) {
  const levels = [];
  // A high firmware limit must not leave the fan stopped for longer: level 1 still starts by the same temperature.
  for (const [index, offset] of offsets.entries()) levels.push(Math.max(index ? limit - offset : Math.min(limit - offset, MAX_FAN_OFF_TEMP), MIN_CURVE_TEMP + index, (levels[index - 1] ?? 0) + 1));
  return levels;
}
export function recommendedLevels(limit, name) {
  return levelsFromOffsets((TEMPLATES.find(t => t.name === name) ?? TEMPLATES[0]).offsets, limit);
}
export function defaultProfiles(limit) {
  return TEMPLATES.map((t, index) => ({ id: `default-${index + 1}`, name: t.name, fanOff: t.fanOff, levels: levelsFromOffsets(t.offsets, limit) }));
}

export function cleanName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value || value.length > 40 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Give the profile a name of 1 to 40 characters.');
  return value;
}
export function validateCurve(levels, fanOff, limit) {
  if (!validLimit(limit)) throw new Error('This laptop\'s firmware temperature limit is unavailable, so a fan curve can\'t be checked.');
  if (!Array.isArray(levels) || levels.length !== FAN_LEVELS || !levels.every(Number.isInteger)) throw new Error('A fan curve needs a whole-degree start temperature for each of levels 1 to 7.');
  if (typeof fanOff !== 'boolean') throw new Error('Choose whether the fan may stop.');
  levels.forEach((temp, index) => { if (index && temp <= levels[index - 1]) throw new Error('Each fan level must start at a higher temperature than the one before it.'); });
  if (levels[0] < MIN_CURVE_TEMP) throw new Error(`Fan levels can't start below ${MIN_CURVE_TEMP} °C.`);
  if (levels[FAN_LEVELS - 1] >= limit) throw new Error(`Level 7 must start below this laptop's firmware limit of ${limit} °C, where the fan runs at maximum speed.`);
  if (fanOff && levels[0] > MAX_FAN_OFF_TEMP) throw new Error(`If the fan may stop, level 1 must start by ${MAX_FAN_OFF_TEMP} °C.`);
}

// In the engine, each row applies from its temperature going up, and at or below it going down.
// At the firmware thermal limit, not the higher junction limit, the fan runs at maximum speed to protect the CPU.
export function engineRows(levels, fanOff, limit) {
  validateCurve(levels, fanOff, limit);
  const rows = levels.map((temp, index) => [temp, index + 1]);
  if (fanOff) rows.unshift([levels[0] - 5, 0]); else rows[0] = [0, 1];
  rows.push([limit, MAXIMUM_LEVEL]);
  return rows;
}
const sameRows = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((row, i) => row[0] === b[i][0] && row[1] === b[i][1]);

// The engine follows its hottest sensor slot, and some slots hold one value while the CPU moves. T14s Gen 2
// slot 11 read 65 C and T14 Gen 3 read 66 C, so a curve could never fall below that temperature's level.
// Slots stay monitored: a flat slot's reading is lowered by a fixed amount, so real heating still raises the fan.
export const FLAT_SLOT = Object.freeze({ maxRange: 1, cpuRange: 5, minValue: 40, minMs: 120000, target: 35, movingRange: 3, settleMs: 15000 });
export class EcSlotWatch {
  constructor(file = null, now = () => performance.now()) {
    this.file = file; this.now = now; this.invalidate();
    // Measurements belong to this running engine/configuration epoch. Old files
    // can mix raw and adjusted readings; never infer new evidence from them.
  }
  invalidate() { this.slots = {}; this.context = null; this.settleUntil = Infinity; }
  // masks are what the engine already subtracts, so history is always kept in real readings.
  observe(sensors, cpuTemperature, masks = [], configuration = masks) {
    const context = JSON.stringify(configuration);
    if (context !== this.context) {
      this.slots = {}; this.context = context; this.settleUntil = this.now() + FLAT_SLOT.settleMs;
    }
    // A service restart can leave its previous sample in shared memory briefly.
    // Wait longer than the adapter's 12-second freshness window before learning.
    if (this.now() < this.settleUntil) return;
    if (!Number.isFinite(cpuTemperature)) return;
    let changed = false;
    const shift = new Map((masks ?? []).map(([slot, amount]) => [slot, amount]));
    for (const sensor of sensors ?? []) {
      const match = /^tpfc\/ec\/temperature\/(\d+)$/.exec(sensor.id ?? '');
      if (!match || !Number.isFinite(sensor.value)) continue;
      const slot = Number(match[1]), value = sensor.value + (shift.get(slot) ?? 0), old = this.slots[slot];
      const next = old ? { ...old, min: Math.min(old.min, value), max: Math.max(old.max, value), cpuMin: Math.min(old.cpuMin, cpuTemperature), cpuMax: Math.max(old.cpuMax, cpuTemperature) }
        : { min: value, max: value, cpuMin: cpuTemperature, cpuMax: cpuTemperature, firstAt: this.now() };
      if (!old || next.min !== old.min || next.max !== old.max || Math.round(next.cpuMin) !== Math.round(old.cpuMin) || Math.round(next.cpuMax) !== Math.round(old.cpuMax)) changed = true;
      this.slots[slot] = next;
    }
    if (changed && this.file) {
      try { mkdirSync(dirname(this.file), { recursive: true }); const temporary = `${this.file}.tmp`; writeFileSync(temporary, JSON.stringify({schemaVersion:2,context:this.context,slots:this.slots})); renameSync(temporary, this.file); } catch { /* Evidence is rebuilt if it can't be kept. */ }
    }
  }
  flat() {
    const entries = Object.entries(this.slots).map(([slot, data]) => [Number(slot), data]);
    // Without a slot that does move, the engine's readings can't be trusted as evidence.
    if (!entries.some(([, d]) => d.max - d.min >= FLAT_SLOT.movingRange)) return [];
    return entries.filter(([slot, d]) => slot !== 0 && d.max - d.min <= FLAT_SLOT.maxRange && d.max >= FLAT_SLOT.minValue
      && d.cpuMax - d.cpuMin >= FLAT_SLOT.cpuRange && this.now() - d.firstAt >= FLAT_SLOT.minMs)
      .map(([slot, d]) => ({ slot, value: d.max, shift: d.max - FLAT_SLOT.target })).sort((a, b) => a.slot - b.slot);
  }
  moving() {
    return Object.entries(this.slots).filter(([, d]) => this.now() - d.firstAt >= FLAT_SLOT.minMs && d.max - d.min >= FLAT_SLOT.movingRange).map(([slot]) => Number(slot));
  }
}
const sortedMasks = masks => masks.map(m => [...m]).sort((a,b) => a[0]-b[0]);

export class FanProfiles {
  constructor(file = null) { this.file = file; this.memory = null; }
  stored() {
    if (!this.file) return this.memory;
    if (!existsSync(this.file)) return null;
    try { const value = JSON.parse(readFileSync(this.file, 'utf8')); return Array.isArray(value) ? value : null; } catch { return null; }
  }
  list(limit) {
    const items = (this.stored() ?? (limit ? defaultProfiles(limit) : [])).filter(p => p && typeof p.id === 'string');
    return items.map(p => { try { cleanName(p.name); validateCurve(p.levels, p.fanOff, limit); return { ...p, valid: true }; } catch (e) { return { ...p, valid: false, problem: e.message }; } });
  }
  write(items) {
    const clean = items.map(({ id, name, fanOff, levels }) => ({ id, name, fanOff, levels }));
    if (!this.file) { this.memory = clean; return; }
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`; writeFileSync(temporary, JSON.stringify(clean)); renameSync(temporary, this.file);
  }
  save(c, limit) {
    const name = cleanName(c.name); validateCurve(c.levels, c.fanOff, limit);
    const items = this.list(limit), index = items.findIndex(p => p.id === c.id);
    if (c.id && index < 0) throw new Error('That fan profile no longer exists.');
    if (items.some(p => p.id !== c.id && p.name.toLowerCase() === name.toLowerCase())) throw new Error('Another fan profile already uses that name.');
    if (!c.id && items.length >= MAX_PROFILES) throw new Error(`Keep to ${MAX_PROFILES} fan profiles or fewer.`);
    const profile = { id: c.id ?? randomUUID(), name, fanOff: c.fanOff, levels: c.levels };
    if (index >= 0) items[index] = profile; else items.push(profile);
    this.write(items);
    return profile;
  }
  remove(id, limit) {
    const items = this.list(limit);
    if (!items.some(p => p.id === id)) throw new Error('That fan profile no longer exists.');
    this.write(items.filter(p => p.id !== id));
  }
  find(id, limit) {
    const profile = this.list(limit).find(p => p.id === id);
    if (!profile) throw new Error('That fan profile no longer exists.');
    return profile;
  }
  // engine is what the worker read from the engine's own configuration, so this reports what is really set.
  view(snapshot, engine, flatSlots = [], movingSlots = []) {
    // Firmware table reads fail briefly at times. The limit doesn't change with them, and the curve keeps running.
    const limit = firmwareThermalLimit(snapshot) ?? this.lastLimit ?? null; this.lastLimit = limit;
    const profiles = this.list(limit?.celsius ?? null);
    const reason = !engine ? 'Fan curves need the bundled fan engine and hardware access.'
      : !limit ? 'This laptop\'s firmware temperature limit can\'t be read, so fan curves stay off and firmware keeps control.' : '';
    const curveSet = engine?.active === 2;
    const active = curveSet && limit ? profiles.find(p => p.valid && sameRows(engineRows(p.levels, p.fanOff, limit.celsius), engine.rows)) : null;
    const maskedSlots = engine?.masks ?? [];
    // Lack of evidence never revokes a configured adjustment. Only measurements
    // from a settled epoch showing real movement can recommend its removal.
    const recommended = new Map(maskedSlots.filter(([slot]) => !movingSlots.includes(slot)));
    for (const flat of flatSlots) recommended.set(flat.slot,flat.shift);
    const recommendedMasks = sortedMasks([...recommended]);
    const removedSlots = maskedSlots.filter(([slot]) => movingSlots.includes(slot)).map(([slot])=>slot);
    return { available: !reason, reason, limit, profiles, activeId: active?.id ?? null, curveSet, customCurve: curveSet && !active, minTemp: MIN_CURVE_TEMP,
      flatSlots, maskedSlots, recommendedMasks, removedSlots, reapply: curveSet && JSON.stringify(sortedMasks(maskedSlots)) !== JSON.stringify(recommendedMasks) };
  }
}
