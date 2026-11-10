// Builds a shareable compatibility report from an existing snapshot. It reads no hardware and
// writes nothing. Every field is allowlisted, so new snapshot data is never shared by accident.
const scrub = value => typeof value === 'string'
  ? value.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/gi,'<user-folder>').replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,'<address>').slice(0,500)
  : null;

function ryzenStatus(ryzen, mode) {
  if (mode === 'demo') return 'simulated';
  if (ryzen?.current && ryzen.available) return 'supported';
  const reason = ryzen?.reason || '';
  if (/No reviewed Ryzen layout/i.test(reason)) return 'unreviewed-layout';
  if (/Enable hardware access/i.test(reason)) return 'no-hardware-access';
  return 'unavailable';
}

function cpuStepDetails(steps, control) {
  const hardware = steps?.hardware;
  return {
    vendor: scrub(steps?.vendor),
    baseMhz: steps?.baseMhz ?? null,
    policyMaxMhz: steps?.policy ? { ac: steps.policy.ac ?? null, dc: steps.policy.dc ?? null } : null,
    policyClass1MaxMhz: steps?.policy?.class1 ? { ac: steps.policy.class1.ac ?? null, dc: steps.policy.class1.dc ?? null } : null,
    energyPreference: steps?.policy?.epp ? { ac: steps.policy.epp.ac ?? null, dc: steps.policy.epp.dc ?? null } : null,
    energyPreferenceClass1: steps?.policy?.eppClass1 ? { ac: steps.policy.eppClass1.ac ?? null, dc: steps.policy.eppClass1.dc ?? null } : null,
    controlAvailable: !!control?.available,
    controlReason: control?.available ? null : scrub(control?.reason),
    ladderMhz: steps?.ladder ?? [],
    maxBoost: steps?.maxBoost ? { ac: !!steps.maxBoost.ac, dc: !!steps.maxBoost.dc } : null,
    maxBoostRecovery: { ac: !!steps?.maxBoostRecovery?.ac, dc: !!steps?.maxBoostRecovery?.dc },
    hardware: {
      status: hardware?.available ? 'read' : 'unavailable',
      reason: hardware?.available ? null : scrub(hardware?.reason),
      source: scrub(hardware?.source),
      family: hardware?.family ?? null,
      model: hardware?.model ?? null,
      hybrid: !!hardware?.hybrid,
      cppcEnabled: hardware?.cppcEnabled ?? null,
      boostMhz: hardware?.boostMhz ?? null,
      referenceClockMhz: hardware?.referenceClockMhz ?? null,
      cppc: hardware?.cppc ? { highest: hardware.cppc.highest ?? null, nominal: hardware.cppc.nominal ?? null, lowestNonlinear: hardware.cppc.lowestNonlinear ?? null, lowest: hardware.cppc.lowest ?? null } : null,
      turboByActiveCores: Array.isArray(hardware?.turboByActiveCores) ? hardware.turboByActiveCores : [],
      states: (hardware?.states ?? []).map(state => ({ label: scrub(state.label), mhz: state.mhz ?? null }))
    }
  };
}

function ryzenDetails(ryzen = {}, mode) {
  const texts = `${ryzen.model || ''} ${ryzen.reason || ''}`;
  const modelParts = (ryzen.model || '').split(' · ');
  const refused = /codename (\d+), table (0x[0-9a-f]+)/i.exec(texts);
  const table = refused?.[2] ?? /table (0x[0-9a-f]+)/i.exec(texts)?.[1] ?? null;
  return {
    status: ryzenStatus(ryzen, mode),
    family: modelParts.length === 3 ? modelParts[1] : null,
    codename: Number.isInteger(ryzen.codeName) ? ryzen.codeName : refused ? Number(refused[1]) : null,
    tableVersion: table,
    reason: scrub(ryzen.reason) || null,
    current: ryzen.current ?? null,
    baseline: ryzen.baseline ?? null,
    sustainedRoute: scrub(ryzen.sustainedRoute) || null,
    // A field can't be written while the whole adapter is unavailable, so don't report it as available.
    fields: Object.fromEntries(Object.entries(ryzen.fields ?? {}).map(([key, field]) => [key, { available: !!ryzen.available && !!field.available, reason: scrub(field.reason) || null }]))
  };
}

export function buildCompatibilityReport(snapshot, { appVersion = null, now = () => new Date() } = {}) {
  if (!snapshot) throw new Error('No hardware snapshot is available yet.');
  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    appVersion,
    mode: snapshot.mode,
    note: 'Read-only report. No serial numbers, user names or network details are included. Setter availability is not proof that firmware honors a write.',
    machine: {
      manufacturer: snapshot.machine?.manufacturer ?? null,
      model: snapshot.machine?.model ?? null,
      productName: snapshot.machine?.productName ?? null,
      biosVersion: snapshot.machine?.biosVersion ?? null
    },
    cpu: snapshot.cpu?.name ?? null,
    powerSource: snapshot.powerSource ?? null,
    hardwareAccess: !!snapshot.driver?.deviceAccessible,
    sensorMonitor: snapshot.sensorMonitor?{initialized:!!snapshot.sensorMonitor.initialized,complete:!!snapshot.sensorMonitor.complete,warningCount:snapshot.sensorMonitor.warningCount??0}:null,
    ryzen: ryzenDetails(snapshot.ryzen, snapshot.mode),
    firmwarePowerLimits: {
      available:!!snapshot.firmwarePowerLimits?.available,
      status:scrub(snapshot.firmwarePowerLimits?.status)||'not-reported',
      reason:scrub(snapshot.firmwarePowerLimits?.reason),readOnly:true,
      source:scrub(snapshot.firmwarePowerLimits?.source),
      limits:(snapshot.firmwarePowerLimits?.available?snapshot.firmwarePowerLimits?.limits??[]:[])
        .filter(row=>['cpuSustainedWatts','apuSustainedWatts','cpuAverageWatts','cpuBurstWatts'].includes(row.field)&&Number.isFinite(row.maximumWatts)&&row.maximumWatts>0&&row.maximumWatts<=500)
        .slice(0,256).map(row=>({field:row.field,profile:scrub(row.profile),profileId:Number.isInteger(row.profileId)&&row.profileId>=0&&row.profileId<=255?row.profileId:null,
          minimumWatts:Number.isFinite(row.minimumWatts)?row.minimumWatts:null,defaultWatts:Number.isFinite(row.defaultWatts)?row.defaultWatts:null,
          maximumWatts:row.maximumWatts,stepWatts:Number.isFinite(row.stepWatts)?row.stepWatts:null}))
    },
    cpuSteps: cpuStepDetails(snapshot.cpuSteps, snapshot.capabilities?.cpuStep),
    gpus: (snapshot.gpus ?? []).map(gpu => ({ name: scrub(gpu.name), vendor: scrub(gpu.vendor), temperatureAvailable: Number.isFinite(gpu.temperature) })),
    fans: (snapshot.fans ?? []).map(fan => ({ name: scrub(fan.name), rpm: fan.rpm ?? null, secondaryRpm: fan.secondaryRpm ?? null, mode: fan.mode ?? null, controlAvailable: !!fan.capability?.available })),
    fanEnginePresent: !!snapshot.fanEngine,
    fanCurves: { available: !!snapshot.fanProfiles?.available, firmwareLimitC: snapshot.fanProfiles?.limit?.celsius ?? null, limitSource: scrub(snapshot.fanProfiles?.limit?.source) },
    sensorCounts: (snapshot.sensors ?? []).reduce((counts, sensor) => { counts[sensor.type] = (counts[sensor.type] ?? 0) + 1; return counts; }, {})
  };
}
