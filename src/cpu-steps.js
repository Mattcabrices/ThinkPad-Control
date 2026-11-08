// Vendor-neutral CPU speed steps. A step is a Windows maximum-frequency policy value; 0 means no limit.
import { selectCpuClock } from './cpu-clock.js';
export const MIN_STEP_MHZ = 800, MAX_STEP_MHZ = 8000;

// Maximum boost: Windows Aggressive boost mode with the performance preference fully toward speed.
export const MAX_BOOST = Object.freeze({ mode: 2, epp: 0 });
// Used only when the earlier values are unknown: Windows Enabled mode and a balanced preference.
export const STANDARD_BOOST = Object.freeze({ mode: 1, epp: 50 });
export const isMaxBoost = (mode, epp) => mode === MAX_BOOST.mode && epp === MAX_BOOST.epp;

const roundStep = mhz => Math.round(mhz / 100) * 100;
const usable = mhz => Number.isFinite(mhz) && mhz >= MIN_STEP_MHZ && mhz <= MAX_STEP_MHZ;

// Real hardware states are used as they are. With fewer than three, intermediate
// steps are interpolated between the fastest known frequency and the lowest.
export function stepLadder(hardware, baseMhz) {
  const available = hardware?.available ? hardware : null;
  const known = (available?.states ?? []).map(s => s.mhz).filter(usable);
  const withBoost = steps => {
    // Boost has no list of states, so limits above the top state are evenly spaced.
    // Intel reports a real ceiling, which becomes a step. AMD's CPPC values only suggest the range:
    // a 5650U's scale to 4807 MHz against a rated 4.2 GHz, so that figure is never offered or shown.
    const top = Math.max(...steps, 0), ceiling = available?.boostMhz;
    const caps = available?.cppc, hint = caps?.nominal > 0 && available?.states?.length ? available.states[0].mhz * caps.highest / caps.nominal : null;
    const upper = usable(ceiling) ? ceiling : usable(hint) ? hint : 0;
    if (!top || upper <= top) return steps;
    const between = [1 / 3, 2 / 3].map(f => roundStep(top + (upper - top) * f)).filter(mhz => mhz > top && mhz < upper);
    return [...new Set([...(usable(ceiling) ? [ceiling] : []), ...between, ...steps])].sort((a, b) => b - a);
  };
  if (known.length >= 3) return withBoost([...new Set(known)].sort((a, b) => b - a));
  const top = Math.max(...known, usable(baseMhz) ? baseMhz : 0);
  if (!top) return [];
  const bottom = known.length > 1 ? Math.max(Math.min(...known), MIN_STEP_MHZ) : Math.max(top * 0.4, MIN_STEP_MHZ);
  const steps = [top, ...[0.75, 0.5, 0.25].map(f => roundStep(bottom + (top - bottom) * f)), roundStep(bottom)];
  return withBoost([...new Set([...steps, ...known])].filter(usable).sort((a, b) => b - a));
}

export function buildCpuSteps(probe, hardware, baseline, clock = selectCpuClock([],probe)) {
  const policy = probe.cpuPolicy?.scheme ? {
    scheme: probe.cpuPolicy.scheme, ac: probe.cpuPolicy.maxFrequency?.ac ?? null, dc: probe.cpuPolicy.maxFrequency?.dc ?? null,
    class1: probe.cpuPolicy.maxFrequencyClass1 ?? null, epp: probe.cpuPolicy.epp ?? null,
    eppClass1: probe.cpuPolicy.eppClass1 ?? null
  } : null;
  const epp = probe.cpuPolicy?.epp, boost = probe.boost;
  const hybrid = hardware?.hybrid === true;
  const class1 = probe.cpuPolicy?.eppClass1;
  const maxBoost = epp && boost ? Object.fromEntries(['ac','dc'].map(source => [source,
    isMaxBoost(boost[source], epp[source]) && (!hybrid || class1?.[source] === MAX_BOOST.epp)])) : null;
  const baseMhz = Number(probe.cpu?.MaxClockSpeed) || null;
  return {
    vendor: hardware?.vendor ?? probe.cpu?.Manufacturer ?? null,
    baseMhz,
    currentMhz: clock.currentMhz,
    clock,
    limitFlags: probe.performance?.PerformanceLimitFlags ?? null,
    policy,
    maxBoost,
    baseline: policy && baseline?.scheme === policy.scheme ? { ac: baseline.ac, dc: baseline.dc, ...(baseline.class1 ? {class1:{...baseline.class1}} : {}) } : null,
    ladder: stepLadder(hardware, baseMhz),
    hardware: hardware ?? { available: false, reason: 'Enable hardware access to read hardware P-states.' }
  };
}
