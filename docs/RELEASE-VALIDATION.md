# Release validation

## Alpha.30 software verification — November 9, 2026

Application and bootstrap code at `dec460929a2ba61b02648c2ef64cc6e12dfbc6f6`
passed the checks below. Subsequent documentation edits do not change runtime
behavior. The installed app remains alpha.29; no alpha.30 hardware activation,
fresh-driver installation or production certification is claimed.

| Area | Evidence | Result |
| --- | --- | --- |
| Scoped JavaScript regression suite | Hosted Windows CI | 226 pass, no failures or skips |
| Isolated native protocols and safety logic | Hosted Windows CI | 293 assertions pass |
| Build and archive verification | Hosted Windows CI | 114 payload, 115 portable and 144 source files verified |
| Packaged Ryzen/Intel desktop | Isolated demo lifecycle checks | Pass; no real hardware writes |
| GUI layout | 36 actual WebView2 demo captures across two profiles and window sizes | Reviewed; simulated data only |
| Missing-driver setup branch | 11 mocked success/failure cases | Trust-before-launch, single execution and cleanup verified in isolation |
| Official driver download | Data-only download and forced transport fallback | Exact pinned SHA256 and valid Windows signature; installer never executed |

Hosted evidence: [Windows build and tests](https://github.com/Mattcabrices/ThinkPad-Control/actions/runs/42578336326).

These tests cover software behavior. They do not replace clean-device installation,
physical Intel/other Ryzen validation, installed Turbo activation/restoration,
longer thermal/recovery checks or trusted publisher signing. See the gate matrix
in [release preparation](RELEASE.md). Public source and demo images are available;
a reviewed binary release and announcement remain separate publication steps.

## Historical alpha.29 verification — November 8, 2026

The application code in `e5dabd7677d4ce6a5d64430a724aa0a6ddd29277` passed
the checks below. Additional sensor-view regression tests accompany this report.
These results support a limited experimental prerelease; they do not establish
universal compatibility or a stable production release.

| Area | Verification | Result |
| --- | --- | --- |
| JavaScript syntax | `npm run check` | Pass |
| Application regression suite | `npm test`, scoped serial tests only | 197 pass; no failures or skips |
| Native protocols and safety logic | Isolated `native-tests` executable | 285 assertions pass; no hardware writes |
| Windows build | Hosted build for the application commit | Pass |
| Worker and desktop publishing | Local .NET Release build, self-contained x64 | Pass |
| Packaged Ryzen desktop | WebView rendering, navigation, disabled demo hardware setup, minimize/close/direct-restore lease behavior | Pass in simulation |
| Packaged Intel desktop | Hybrid policy presentation, Intel GPU/tuning views, no Ryzen tuning panel | Pass in simulation |
| Package integrity | Manifest, bundled engine/module and notices | 112 hashed payload files verified |
| Portable distribution | Each ZIP member compared with staged bytes | 113 files verified |
| Source distribution | Each ZIP member compared with source bytes; privacy/path checks | Pass; regenerate after source changes |
| Windows installation | Approved upgrade from alpha.28 on T14s Gen 2 Ryzen 5 PRO 5650U | Pass; no reboot required |
| Installed immutable payload | Compare installed files with tested manifest, excluding mutable fan INI | 111 files verified |
| Hardware connection | Automatic elevated-worker connection, CPU/APU temperatures, clocks, exposed sensors, tachometer | Pass on the tested T14s |
| Fan handover | Physical manual Max → saved curve, verified mode and ownership release | Pass on the tested T14s; approximately 5,500 RPM in Max |
| Settings restoration | Compare final policies, Ryzen limits, saved profiles and effective fan INI with pre-test capture; verify firmware mode | Pass |

The scoped suite covers command validation, local API tokens/origin/Host checks,
request limits, serialized writes, SQLite persistence/retention, failure auditing,
stale telemetry, read-back failures, rollback/recovery, CPU clock selection,
Windows AC/DC and hybrid policies, capability-gated Ryzen/Intel controls, curve
validation, ownership handover, thermal/lease boundaries, installer migration,
task/service ownership, tampered payload refusal, and signing refusal/preflight.

GUI regression checks include firmware read-back replacing the restored textbox,
preservation of unrelated drafts, Save/Apply failure handling, profile discard,
active-profile deletion guards, disclosure state, filtered sensor refresh, and
session range reset without deleting history or writing hardware.

The installed check did not change CPU boost, CPU speed caps, power preferences,
Ryzen wattages or the CPU temperature limit. Fan settings are captured before the
check and restored afterwards; restoration must be verified before accepting a
run. No deliberate overheating, stress workload, suspend or reboot is included.
Temperatures and RPM are observed readings, not guarantees for other devices.

Hosted evidence: [Windows build and tests for the application commit](https://github.com/Mattcabrices/ThinkPad-Control/actions/runs/42510446740).

## Stable release gates still open

- Clean-device installation and independent uninstall verification, including
  scheduled-task/service cleanup and fresh driver installation behavior.
- Physical AC/battery transitions and current-build validation on Intel and the
  other Ryzen target. Simulations verify routing, not device compatibility.
- Longer thermal sessions, sensor/worker/service loss, repeated-crash exhaustion,
  suspend/resume and reboot recovery across supported devices. Earlier isolated
  and short hardware checks cover only part of this matrix.
- Trusted signing and validation on a clean Windows policy configuration. The
  current installer is unsigned. Hash checks establish integrity, not publisher
  trust or Windows application-control acceptance.

Intel direct package-power writes, independent AMD/Intel GPU boost, and
firmware-rejected Ryzen fields remain unavailable/read-only. A higher requested
wattage does not demonstrate higher sustained power or performance. Missing
sensors stay unavailable, and a zero tachometer reading does not prove a stopped
fan. Keep these capability boundaries in the UI and release description.

Before publication, verify the final source/portable/installer set again, generate
SHA256SUMS after all signing and packaging, retain matching upstream licenses and
sources, and publish only the tested scope. Do not publish an older draft binary
as the current candidate.
