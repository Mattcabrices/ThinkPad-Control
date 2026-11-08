# Public release preparation

0.4.0-alpha.22 is an **unsigned development alpha**, not a claim of universal
ThinkPad support. Original code is MIT. The package now includes the pinned
TPFanCtrl2 2.5.1 engine rebuilt from pinned source with a documented
fan-selector patch (original and modified sources, patch and build lock ship
under notices/fan-engine), BIOS-mode configuration, signed LpcACPIEC module,
upstream licenses, credits and matching source archives.

## User installation flow

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
| Windows build CI and source archive | Added; first hosted CI run pending |
| Pinned dependency license/source review | Recorded; matching sources and licenses included; recheck before final signed release |
| Trusted signing integration | Implemented; account/identity and end-to-end signed release pending |
| T14s Gen 2 Ryzen 5 telemetry and physical fan validation | Selected controls and telemetry exercised on hardware; audible zero-RPM correlation and full matrix pending |
| T14 Gen 3 Ryzen 5 telemetry and physical fan validation | Alpha.1 results recorded; alpha.2 retest and full matrix pending |
| Clean install, upgrade, uninstall, sleep/resume and crash recovery | Pending |

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
provisioned and no cloud signing request has been submitted. End-to-end trusted
signing, hosted CI and clean-device policy acceptance remain pending.

Dependency review now includes the four MPL source archives, Mono's full official
license, and matching LGPL source versions for all embedded sensor modules. See
[DEPENDENCY-REVIEW.md](DEPENDENCY-REVIEW.md). Recheck after dependency upgrades.

Run scripts/package-source.ps1 for an allowlisted source ZIP that excludes local
tools, build outputs, telemetry and private keys. Generate SHA256 checksums only
after all signing and packaging. Publish source, installer, portable ZIP and
checksums together as a GitHub prerelease. Publish no Reddit announcement until
the actual repository/release links and tested model list are available.

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


