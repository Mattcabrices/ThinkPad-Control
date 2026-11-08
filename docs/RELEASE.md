# Public release preparation

0.4.0-alpha.29 is an **unsigned development alpha**, not a claim of universal
ThinkPad support. Original code is MIT. The package now includes the pinned
TPFanCtrl2 2.5.1 engine rebuilt from pinned source with a documented
fan-selector patch (original and modified sources, patch and build lock ship
under notices/fan-engine), BIOS-mode configuration, signed LpcACPIEC module,
upstream licenses, credits and matching source archives.

## User installation flow

### Unreleased UX fixes

Successful Ryzen baseline restores replace the corresponding input with the
verified firmware read-back. Baselines come from the laptop when the hardware
worker connects; they are not hardcoded factory wattages. Failed restores retain
the edit, and other inputs keep their unsaved values.

Applying a fan profile now verifies release of manual ownership before changing
the engine configuration. Unedited profiles apply directly; edited profiles use
Save and apply. Failed saves never proceed to activation. Applying progress spans
the full operation, and the display distinguishes actual firmware/manual control
from a stored curve. Saving alone does not activate a curve. These changes require
the matching updated worker and UI in a future package; alpha.28 remains installed
until a separate upgrade is requested.

Alpha.27 adds a configurable manual fan temperature cutoff, defaulting to the
reported Ryzen firmware limit or Intel thermal target (85 C fallback if unknown).
Users may select 60–110 C. Before manual control begins, worker and engine use the
same selected cutoff. At that temperature the worker requests firmware, including
for manual Max. Curves independently reach Max at their configured threshold.
The preference survives upgrades; changing it reconnects the engine and requires
firmware or curve mode. CPU thermal limits, curves and offsets are unchanged.
High-temperature boundary tests use isolated telemetry, with no induced physical
overheating. Installed validation of this new control remains pending.

Returning from a saved curve to firmware removes active sensor corrections but
retains the earlier valid offsets as inert comments in the same protected engine
configuration. Applying a curve restores those offsets only when fresh settled
sensor movement has not revoked them. Read-back checks both the curve and its
offsets. Firmware readings remain unadjusted; this metadata does not control the
fan in firmware mode. Alpha.25 could forget offsets on this round-trip; alpha.26
contains the fix and requires its own installed validation.

The installer requests administrator approval and installs under Program Files.
Setup always installs hardware support. It registers the on-demand hardware worker task and downloads the official PawnIO
2.2.0 installer only when the driver is absent, checks its SHA256 and trusted
signature, then installs the engine service. The package never includes the
legacy TVicPort backend. The engine starts in BIOS mode; manual fan control and
boost changes require explicit actions in the GUI. Hardware access connects
through the installed task when the app opens; a separate UAC reconnect is a
fallback when that task is unavailable, not a required step on each launch.

An existing external TPFanControl service is a setup conflict; it is not stopped,
deleted or replaced. Uninstall removes only an engine service pointing to this
app's engine executable. Shared PawnIO and user history remain installed.
Hardware setup errors are written to `hardware-setup-error.txt` in the installed
application directory. A driver return code 3010 requires restart and rerunning
setup. Offline installation works for the GUI; a missing driver needs network.
Microsoft WebView2 remains a prerequisite with an official download link.

Upgrades validate and migrate supported fan configuration onto new engine defaults,
then stop a previously running owned engine before replacing files and restart it
in its preserved firmware/curve mode. A stopped or disabled engine stays stopped.
Malformed/manual configurations and unreadable service transitions block replacement.
Interrupted configuration commits retain an exact rollback backup. See [upgrades](UPGRADES.md).
The older 0.2 per-user install should be uninstalled before installing this
machine-wide version; user data remains under LocalAppData/ThinkPadControl.
Portable packages do not install a privileged service from a writable folder.

## Build requirements

`scripts/build-fan-engine.ps1` requires PowerShell 7 (`pwsh`): it sets the MSBuild
environment through `ProcessStartInfo.Environment`, which Windows PowerShell 5.1
does not provide. It also needs Microsoft C++ Build Tools v143 and Windows SDK
10.0.26100. `scripts/build-desktop.ps1` and the staging scripts run under either
shell and take the release version from `package.json`.

## Release gates

Alpha.3 adds Intel primary-fan eligibility and hybrid policy handling. Intel paths
have isolated tests only; see [Intel support](INTEL-SUPPORT.md). Local installed
build and hardware observations are tracked separately from release artifacts.

Alpha.5 adds verified CPU/GPU rollback and a persisted Maximum boost recovery
target with explicit UI repair. No startup policy application is added. These
paths have isolated failure-injection coverage; physical driver/crash tests remain
pending. See [policy recovery](POLICY-RECOVERY.md).

| Gate | State |
| --- | --- |
| MIT license and upstream attribution | Implemented |
| Pinned engine, module, hashes and source archives | Implemented |
| Program Files installer and service ownership checks | Installation exercised on both target machines; owned-service upgrade exercised on T14s; clean-device/uninstall matrix pending |
| Driver hash and trusted signature verification | Implemented; elevated device access works on both targets; fresh-driver install/reboot matrix pending |
| Windows build CI and source archive | Verified: [alpha.23 hosted build](https://github.com/Mattcabrices/ThinkPad-Control/actions/runs/42442764365) passed; portable and source archives verified locally |
| Pinned dependency license/source review | Recorded; matching sources and licenses included; recheck before final signed release |
| Trusted signing integration | Implemented; account/identity and end-to-end signed release pending |
| T14s Gen 2 Ryzen 5 telemetry and physical fan validation | Selected controls and telemetry exercised on hardware; audible zero-RPM correlation and full matrix pending |
| T14 Gen 3 Ryzen 5 telemetry and physical fan validation | Alpha.1 results recorded; alpha.2 retest and full matrix pending |
| Clean install, upgrade, uninstall, sleep/resume and crash recovery | Alpha.22/23 curve-preserving upgrades verified on T14s; remaining clean-device, independent uninstall and recovery matrix pending |

See the isolated test suite for the latest automated checks and the boundary between isolated tests and physical validation. The current installer remains unsigned; package integrity checks do not establish trusted signing.

For each target device, verify actual CPU/GPU temperatures and tachometers,
manual levels 1–7, firmware return, AC/DC boost read-back, stale sensor fallback,
UI exit, worker/API/service crash, suspend/resume and reboot. Capture results
without serial numbers. Do not advertise a model as supported before this pass.

The signing integration is implemented; see [SIGNING.md](SIGNING.md) for exact
ordering, provider options, cost, prerequisites and one-month signing/deletion.
The engine is signed before worker compilation so the final engine hash is baked
into the worker; upstream provenance hashes remain separate. Payloads, scripts,
installer, temporary setup copies and uninstaller are covered by the signed-build
path. Local preflight and refusal tests pass, but no signing identity/account is
provisioned and no cloud signing request has been submitted. Hosted unsigned CI is verified. End-to-end trusted
signing and clean-device policy acceptance remain pending.

Dependency review now includes the four MPL source archives, Mono's full official
license, and matching LGPL source versions for all embedded sensor modules. See
[DEPENDENCY-REVIEW.md](DEPENDENCY-REVIEW.md). Recheck after dependency upgrades.

Run scripts/package-source.ps1 for an allowlisted source ZIP that excludes local
tools, build outputs, telemetry and private keys. Generate SHA256 checksums only
after all signing and packaging. Publish source, installer, portable ZIP and
checksums together as a GitHub prerelease. Publish no Reddit announcement until
the actual repository/release links and tested model list are available.

## Current evidence and remaining decisions

Alpha.25 source fixes fan-status ownership: an old LHM disconnect reason is no longer reported merely because TPFanCtrl2 owns a manual fan. Watchdog and control behavior are unchanged. Alpha.24 remains the latest installed and physically checked build; its tag is pinned to ec637b91d0eaf3483f3c7971943a458d108987e9.

The public source is [Mattcabrices/ThinkPad-Control](https://github.com/Mattcabrices/ThinkPad-Control). Alpha.23 adds configurable Max fan-curve thresholds and native background manual-fan renewal. Focused API/UI tests and a native desktop simulation pass. Installed payload hashes and automatic hardware reconnection were verified on the T14s, with the saved curve and CPU settings preserved. On the T14s on AC, a normal executable reopen followed by minimizing retained manual level 7 for a timed 12 seconds at about 3,800 RPM; closing returned the EC to firmware control and the original saved curve was restored. A separate direct hidden-window restoration path exposed a renewal issue. Alpha.24 adds a visibility hook and a passing native regression covering minimize, close, direct restore and renewed manual control. Longer sessions, other devices and suspend/crash behavior remain unverified.

No public binary release or Reddit announcement has been published. Signing identity, clean-device policy acceptance, physical suspend/crash recovery and validation on Intel and additional Ryzen devices remain release gates. A development prerelease must clearly retain the unsigned, experimental status; it must not be labelled production-ready.

## Announcement draft

Title: ThinkPad Control alpha: desktop telemetry, RPM and direct fan levels for Ryzen ThinkPads

I am building an open-source Windows ThinkPad controller with CPU/GPU telemetry,
measured fan RPM, direct fan levels and AC/battery CPU boost controls. It bundles
TPFanCtrl2 rather than asking users to assemble a separate fan engine. Huge thanks
to original author troubadix and the TPFanCtrl2 maintainers, namazso and the
LibreHardwareMonitor contributors.

Original app code is MIT; bundled components retain their licenses. This is an
alpha: sensor availability varies and integrated Radeon has no independent
boost toggle. Insert actual tested model/results, signing status and GitHub
source/release URLs here before posting. Please report machine type, CPU/GPU and
BIOS/driver versions, without serial numbers.


### Owned fan-engine crash recovery

The installer configures the verified bundled TPFanControl service for two crash
restart attempts, delayed by 5 and 15 seconds, followed by no further action.
The policy resets its failure counter after one day without a failure. No reboot
or recovery command is configured. Existing startup type and running state are
unchanged by this configuration step; normal installation still starts its owned
engine. Windows repeats the final action, which is explicitly NONE here.

Configuration requires the exact protected service path and reviewed engine/module
hashes. The helper checks actual policy read-back and attempts verified rollback
on failure, reporting an unverified rollback explicitly. It does not change the
failure-actions flag or configure an external fan service. Windows may retain an
already queued restart after a manual stop; disabling the service prevents that
restart. See [Microsoft's service configuration documentation](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-changeserviceconfig2w).

Isolated transaction tests cover rejected ownership, initial read failure,
idempotence, ignored/partial writes, rollback failure and lost ownership. These
tests do not certify live engine crash recovery: an approved installed upgrade
and a separate controlled hardware test are still required.
