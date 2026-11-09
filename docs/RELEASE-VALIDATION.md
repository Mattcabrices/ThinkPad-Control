# Release validation

## Current evidence — alpha.33, November 9, 2026

The tested application is `0.4.0-alpha.33+7f36286f25a6a5ffc0c19c2b0abd2ef2436bce00`.
Later documentation-only commits do not change that binary's identity. Older
sections below are historical results, not additional current-device certification.

| Check | Result | Evidence/scope |
| --- | --- | --- |
| JavaScript regressions | 233 pass; zero failures/skips | [Hosted Windows run](https://github.com/Mattcabrices/ThinkPad-Control/actions/runs/42682162143) |
| Isolated native assertions | 293 pass | Same hosted run; no hardware writes |
| GUI | 40 actual Ryzen/Intel demo captures pass | Wide/compact views and Settings; native menu overlap checked; simulated readings |
| Build and archive integrity | Pass | 114 staged payload, 115 portable and 144 public source files verified |
| Installed upgrade/hardware setup | Pass; no reboot | Owner-approved T14s Gen 2 Ryzen 5 PRO 5650U; 113 immutable installed files matched, mutable INI checked separately |
| Installation preservation | Pass | Policies, Ryzen limits, profiles, manual cutoff, fan mode and exact INI compared with immediate pre-upgrade capture |
| Installed Turbo activation | **Not passed** | One owner-approved attempt, described below; no automatic retry |
| Turbo rollback/restoration | Pass for this attempt | Automatic rollback plus independent final comparison; no recovery pending |
| Trusted signing | Open | Current binaries remain unsigned |
| Broad hardware/recovery support | Open | Clean-device, Intel/other Ryzen and full physical recovery matrix still required |

### Installed Turbo attempt, 16:15–16:16 ET

The owner approved a short Turbo → Restore check without a stress workload.
A fresh preflight verified hardware access, no pending recovery, no manual fan
owner and Turbo availability. The app proposed Max fan, current-source boost/speed
policy changes, PPT fast 40 W and PPT slow 30 W; STAPM remained read-only.
These wattages are app ceilings, not hardware-rated maxima.

The single enable request returned HTTP 409. Activity recorded:
“The app connection was lost during Turbo activation. Previous settings restored
and verified.” Turbo never reached verified-active state. The cause of the lease
loss needs investigation; this result does not establish whether firmware would
accept the higher wattage requests. No activation was replayed.

The independent final comparison passed for the complete AC/DC policy (including
caps/EPP and processor-class fields), boost recovery metadata, all four Ryzen
limits, saved profiles, manual cutoff, exact curve/masks, original firmware fan
mode and fan INI bytes. No manual fan remained owned, Turbo was off, and no
recovery was pending. No stress, suspend or reboot was performed.

Raw machine snapshots remain private. Their evidence identifiers are
`turbo-physical-20261109-161556/result.json`, `activity.json`, `before.json`,
`final.json` and `before.ini`; they are excluded from public source archives.
The failed activation must be investigated and successfully retested before
claiming installed Turbo support. Rollback success alone is not an activation pass.

## Alpha.30 installed check — November 9, 2026

The owner approved upgrading the T14s Gen 2 Ryzen 5 PRO 5650U to
`0.4.0-alpha.30+b65740cbe6f31962b30bce5033633d5cd4f4513a` and a short fan check.
Setup and automatic hardware setup returned success, with no reboot. All 113
immutable installed payload files matched the tested manifest; the fan INI was
preserved exactly. CPU/APU temperatures and measured RPM connected automatically.

Manual Max remained owned and reported approximately 4,800 RPM after 12 seconds.
Handover to the saved curve released manual ownership. The original custom curve,
saved profiles, manual cutoff and starting firmware fan mode were then restored.
Final INI bytes, boost policies, CPU speed caps and Ryzen limits matched the
starting capture. No Turbo, CPU tuning, stress, suspend or reboot test was run.

The owner then reported clipped Overview navigation. A native-window regression
reproduced a menu bottom at 36 pixels with the WebView starting at zero. Alpha.31
corrects docking order; isolated Ryzen/Intel checks passed 40 demo captures with
native menu/viewport overlap assertions. This is not a claim of installed
alpha.31 validation or broader model compatibility.

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
