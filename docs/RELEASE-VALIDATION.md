# Release validation

## Alpha.36 firmware power ranges — isolated checks

The optional Lenovo WMI capability collector reads CPU/APU minimum, default,
maximum and step metadata with the firmware profile retained. It does not query
or change the active profile, write firmware, modify app bounds or grant power
control. Invalid class yields Not reported; access denial and stale data remain
distinct. The collector runs outside fan/sensor locks. Positive range decoding,
invalid/conflicting data, exact expiry and read-only GUI/export paths are covered
by isolated fixtures. A stale expected engine hash in the native test fixture
was updated to match the already-reviewed alpha.35 engine; no engine change was
made for this feature.

The T14s Gen 2's read-only capability query returned Invalid class. Positive
reporting still requires a supporting device; alpha.35 hardware observations
below do not certify this detector. No alpha.36 upgrade or hardware tuning was
performed as part of implementing detection.

## Alpha.35 bounded hot run — November 10, 2026

By **Matt Cabrices**.

On the T14s Gen 2 Ryzen 5 PRO 5650U, one Turbo activation succeeded, followed by
a six-worker CPU workload bounded to 60 seconds. Max stayed at level 64 across
all 19 observations (12 distinct telemetry samples). CPU temperature peaked at
87.125°C, above the configured 86°C CPU target; fan readings stayed between
5,100 and 5,356 RPM. All observations remained verified active. Package power
read 22.9–32.7 W; requested limits are not guaranteed delivered power.

The workload stopped, and a single Restore succeeded without the previous
read-only-field error. Independent checks verified the complete original CPU
policy/boost, all Ryzen limits, saved profiles, manual cutoff, exact fan INI,
curve/masks, boost-recovery metadata and starting firmware fan mode. Turbo was
off, no recovery remained pending, and no workload process remained running.

The CPU target stayed 86°C and manual fan cutoff stayed 90°C throughout. This
verifies Max cooling above the CPU target, not physical crossing of the 90°C
manual cutoff. Native isolated tests cover that exception. No thermal limits
were raised; this short run does not establish long-term or other-model support.

Private evidence: `turbo-hot-20261110-012504/{result,summary,activity}.json`,
`enabled.json`, sample snapshots, `restore-response.json`, `final.json` and
`before.ini`. Earlier pending-check statements below are historical.

## Alpha.35 installed upgrade — November 10, 2026

The owner approved the unsigned alpha.35 installer. Setup, hardware support and
fan-configuration finalization succeeded without a reboot. All 113 immutable
installed files matched the prepared manifest, including the new worker and
patched fan engine; fresh telemetry and fan-engine access connected on reopening.
CPU policies/boost, Ryzen limits, profiles, manual cutoff and exact fan INI were
preserved. The starting firmware fan mode was restored and verified. Turbo was
off with no pending recovery. No hot-run, Turbo activation or stress workload was
performed after this upgrade; physical threshold-crossing and one-pass Restore
validation remain open.

Private evidence: `alpha35-installed-validation.json`, `alpha35-final-state.json`,
`alpha35-before-upgrade.json`, `alpha35-before-upgrade.ini`, `alpha35-install.log`.

## Alpha.35 Max-cooling thermal fix — isolated checks

The previous native regression reproduces Max returning to firmware at the
manual temperature cutoff. Alpha.35 exempts explicitly requested TPFanCtrl2 Max
cooling from temperature-only handoff in both the worker and the engine's two
thermal-exit sites. The engine uses the requested level, preserving Max during
its temporary level-7 spin-up stage. Lower manual levels retain their cutoff.
Lease expiry, stale/missing real temperature readings, closing, explicit firmware
return and processor thermal limits remain unchanged. LHM percentage controls
keep their existing thermal policy.

All 238 application tests and 297 isolated native assertions pass. Native cases
cover Max at/above the cutoff, hot spin-up, exact lease expiry, stale and missing
readings, plus the existing lower-level thermal exits. The modified fan engine
builds from pinned upstream source; matching original/modified sources and build
provenance are packaged. These checks make no hardware writes. Installed Max
behavior across a temperature threshold still needs verification on this build.

## Alpha.34 physical Turbo check — November 10, 2026

One owner-approved activation on the T14s Gen 2 Ryzen 5 PRO 5650U passed.
Read-back showed PPT fast 40 W, PPT slow approximately 30 W, Maximum boost,
current-source frequency cap removed and Max fan level 64 at about 4,900 RPM.
Three short samples remained verified active. CPU package power measured about
24.8–27 W and temperature reached 86.25°C; accepted limits are not proof of 40 W
sustained delivery. No stress workload, sleep or reboot was added.

The read-only sustained-limit reading followed the writable fast limit to 40 W.
The first Restore reported a read-only sustained-power error, although restoring
the writable limits returned every actual limit to baseline. Recovery correctly
remained pending. One Restore-only retry passed; independent comparisons then
verified the full CPU policy/boost, all Ryzen limits, profiles, cutoff, exact fan
INI, curve/masks and starting firmware fan mode. Turbo was off with no pending
recovery. The initial test's boost-recovery metadata comparison also passed.

Source now restores attempted writable power fields before checking collateral
readings. The coupled-field regression fails on the previous code and passes on
the fix; an independent read-only mismatch still retains recovery. All 238
application tests pass. This follow-up change is not installed or included in
the existing alpha.34 installer; a new build and installed check remain necessary
before claiming a one-pass Turbo/Restore result.

Private evidence: `turbo-physical-20261110-005557/{result,enabled,activity}.json`,
three sample snapshots, `restore-retry-response.json`, `final-after-retry.json`
and `recovery-retry-verification.json`. Earlier entries below are historical.

## Alpha.34 installed upgrade — November 10, 2026

The owner approved the unsigned alpha.34 installer. Setup, hardware support and
fan-configuration finalization returned success, with no reboot. All 113
immutable installed files matched the prepared manifest; the fan INI was checked
separately and remained byte-identical. Hardware access and fresh telemetry
connected after reopening.

The full CPU policy and boost settings, Ryzen limits, saved profiles and manual
temperature cutoff matched the immediate pre-upgrade capture. Startup resumed
the stored curve; the starting firmware fan mode was restored and verified.
Turbo remained off, with no pending recovery. No Turbo activation or stress test
was run; higher-wattage acceptance remains unverified.

Private evidence: `alpha34-installed-validation.json`, `alpha34-final-state.json`,
`alpha34-before-upgrade.json`, `alpha34-before-upgrade.ini`, `alpha34-install.log`.

## Alpha.34 Turbo fix — isolated checks

The cached dashboard snapshot previously remained unchanged throughout Turbo's
serialized activation, even as the controller obtained new worker readings.
Regression tests reproduce the resulting stale-state lease withdrawal. Alpha.34
publishes those real intermediate readings, without altering their timestamps or
extending the UI lease. Connected-client activation and disconnected-client
rollback are covered; loss during a reading refuses the next write. Independent
native watchdogs and temperature cutoffs are unchanged.

This is a software regression fix, not a successful installed Turbo test. The
alpha.33 physical result below remains the latest installed Turbo evidence until
the new build's Turbo activation is checked. Higher firmware wattage acceptance remains
unknown.

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
