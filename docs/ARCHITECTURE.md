# ThinkPad Control — MVP architecture

Turbo is coordinated by `src/turbo.js` inside the API's serialized command queue.
It composes existing provider operations, verifies their combined result, and
stores an atomic per-data-directory recovery journal before writes. The journal
preserves pre-Turbo values across API restarts without automatically reapplying
Turbo. Provider restoration uses fixed policy keys and the captured active plan;
the elevated worker's capability, lease, thermal and fan-ownership gates remain
unchanged. See [Turbo behavior and recovery](TURBO.md).

## Product and scope

A single-user, local-first Windows desktop utility for ThinkPad power users. Primary target: T14s Gen 2 AMD and T14 Gen 3 AMD; support elsewhere is discovered, never inferred from the ThinkPad brand. No cloud account or remote hardware endpoint. The desktop package ships the client in a native WinForms/WebView2 window, with tray controls, isolated renderer profile and bundled Node/.NET runtimes. Developer browser mode remains available.

CPU AC boost and battery boost use Windows PERFBOOSTMODE. Overall boost sets both power sources transactionally and reactivates the same power plan. This changes the OS request for turbo, not firmware settings or Ryzen SMU limits. Integrated Radeon shares the APU power/thermal envelope: no universal independent AMD GPU boost toggle exists in this implementation. GPU telemetry and independently detected fan controls still appear. NVIDIA telemetry and legacy auto-boost control are available only when reported by nvidia-smi; modern laptop GPUs often do not expose that switch.

A separate experimental direct-SMU registry now selects reviewed family/table layouts across Ryzen ThinkPads. It monitors four power/thermal limits and discovers per-field write acceptance; only the tested T14s/5650U STAPM failure remains narrowly read-only. It uses the existing signed PawnIO module, fixed Cezanne MP1 commands, fresh PM-table read-back, bounded writes and verified per-field rollback. Connection baselines are explicit and are not factory defaults. No automatic tuning occurs. See RYZEN-TUNING.md for exact support, bounds, source provenance and persistence semantics.

## Boundaries

Native WebView UI → authenticated random-port loopback API → serialized command service → typed hardware providers → private Windows named pipe → optionally elevated per-session hardware worker.

The desktop launcher owns the API process, random endpoint and readiness token. It discovers its bundled files relative to the executable, stores data in LocalAppData and watches backend exit. A per-user mutex makes repeated launches activate the existing window. Minimizing hides to the tray and preserves manual controls with a native two-second heartbeat that requires fresh backend telemetry. Closing the window releases manual controls; Exit gracefully closes the API and worker. A parent-PID monitor shuts down a leftover backend if the desktop process crashes. Fan leases remain independent in the worker. The worker exits on pipe EOF; there is no persistent SYSTEM service registration. The machine-wide installer requires administrator approval and installs under Program Files. Its optional TPFanCtrl2 SYSTEM service is separate from the per-session worker.

An explicit UI action invokes UAC for the worker; the UI/API do not elevate. The pipe has a random 128-bit name, explicit same-user SID DACL, medium mandatory-integrity label (applied separately using WRITE_OWNER without requesting audit privilege) and client identity verification after the initial read. Only fixed sensor/fan/power-policy operations exist. CPU/GPU policies in worker mode use fixed executable paths and argument lists, with validation and read-back. The WebView blocks navigation away from its own endpoint, new windows, downloads, permissions and developer tools. Only origin-checked messages can invoke desktop lifecycle actions. No remote URL or shell command is accepted from the renderer.

The command service owns validation, audit intent/results, persistence, fresh capability checks and error reporting. Providers own detection, read-back and hardware semantics. UI never supplies shell commands, executable paths or register addresses. One process holds the SQLite lock and hardware writer role. Windows powercfg is invoked with argument arrays; PowerShell scripts are fixed, repository-owned files. SQLite uses WAL, prepared statements, bounded retention, schema migrations and a separate database for demo data.

The optional persistent .NET bridge speaks newline-delimited JSON over private parent/child stdio. LHM IControl objects require explicit sensor-ID allowlisting and use a 30% manual floor. An optional TPFanCtrl2 shared-memory client provides discrete ThinkPad levels 1–7, actual tachometer RPM and EC temperatures through the bundled pinned engine. The production connection checks its service image path and engine/module hashes before opening shared memory. The engine alone owns the EC. Its reviewed unversioned FCSHARED layout is pinned by Git blob in the adapter source; no raw EC access is implemented here. LHM fan writes are disabled while that adapter is connected. A writable RPM sensor is never inferred from model branding or CPU temperature support.

Both paths use a 10-second lease, an 85°C fail-safe and firmware-return requests on EOF, timeout, stale/missing temperature, command error and shutdown. The LHM path uses CPU/GPU/board sensors. The TPFanCtrl2 path uses valid EC slots and requires recent state-sequence updates; anonymous EC slots stay unmapped in the UI. The Node supervisor normally sends keepalives while the browser lease is alive, and renews during a bounded fan-command read-back window. TPFanCtrl2 uses asynchronous acknowledgement plus actual mode/raw-level verification, not an optimistic command response. Hardware/engine failure may prevent firmware return; it cannot be guaranteed by user-space software.

## UI architecture

Small dependency-free ES-module client: centralized snapshot state, safe DOM construction, reusable metric cards, SVG time-series chart, capability-gated boost switches and fan sliders. Views: overview, CPU, GPU, cooling, all sensors and activity. Polling is sequential with timeout, visible connection/staleness state, and no optimistic hardware success. Controls display observed state after read-back. Keyboard-accessible navigation and controls, responsive layouts, reduced-motion support. Demo mode is unmistakable and cannot issue hardware writes.

## Data model

See schema.sql. Telemetry retains 24 hours (one snapshot / 3 seconds); audit retains 30 days. Audit records the requested command before execution, records success/error afterwards, and marks interrupted commands unknown on next startup. Unknown means hardware must be inspected, never assumed unchanged. Settings hold UI preferences only; manual hardware state is never automatically reapplied at startup. Telemetry tables contain complete structured snapshots so adding sensors does not require schema churn; scalar timestamp indices support bounded history queries. For fleet/cloud use, a separate authenticated read-only collector can ingest snapshots later; hardware writes must remain local.

## Security and lifecycle

Bind to 127.0.0.1 only, validate Host and same-origin requests, per-start 256-bit CSRF token, JSON-only commands, strict payload schemas and a 16 KiB request limit. No CORS. CSP prohibits external scripts and assets. UI has no remote dependencies. Desktop UAC is explicit and scoped to the worker; developer browser mode can inherit elevation at launch. Local administrator attackers and same-account binary tampering are outside this boundary. Binaries are not code-signed yet.

Automatic manual fan recovery lives in the native process, independently of UI/Node polling. OS termination of that native process or kernel/driver failure cannot be made safe by a user-space lease: do not distribute manual mode as validated until model-specific suspend/crash testing is completed. The optional installer hardware task downloads and verifies the official PawnIO driver prerequisite and installs the pinned TPFanCtrl2 service in BIOS mode. No overclocking, undervolting or GPU clock lock is performed.

## Repository layout

```
public/                 Browser UI, CSS and client module
desktop/                Native Windows shell and backend/worker lifecycle
installer/              Windows installer source
src/server.js           HTTP boundary, poll lifecycle, command queue
src/providers.js        Demo and Windows hardware adapters
src/bridge.js           Native stdio process supervisor
src/store.js            SQLite repositories and migration
src/schema.sql          Initial schema
scripts/probe.ps1       Read-only Windows inventory/power policy
native/                 LHM bridge, TPFanCtrl2 client and fan watchdogs (.NET 8)
native-tests/           Isolated fake-engine protocol and safety assertions
tests/                  Contracts, fault paths, HTTP and persistence tests
docs/                   Architecture and compatibility/release criteria
```

## Release gates

The runnable application is an MVP, not a hardware-certified production release. The native bridge compiles and its read-only protocol has been exercised; isolated fake-engine tests cover fan safety and IPC. Required before broad release: signed installer and binaries, signed compatible driver distribution and license review, service/ACL separation, T14s Gen 2 and T14 Gen 3 physical tests, exact fan mappings, suspend/resume tests, competing-controller detection and power-loss/native-crash validation. TPFanCtrl2 2.5.1 and matching module/source are bundled; its installer hardware task is opt-in pending physical validation. See docs/RELEASE.md for current signing and deployment gates. Tests on mock adapters establish software behavior, not physical hardware compatibility.

## References

- https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/options-for-perf-state-engine-perfboostmode
- https://github.com/LibreHardwareMonitor/LibreHardwareMonitor
- https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LibreHardwareMonitorLib/Hardware/IControl.cs
- https://github.com/Shuzhengz/TPFanCtrl2 (reference only, no code or driver copied)
- https://docs.nvidia.com/deploy/nvidia-smi/index.html






