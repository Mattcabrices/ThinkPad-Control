# Release preparation

By **Matt Cabrices**.

The current source is **0.4.0-alpha.35**, an unsigned development preview.
The latest installed check is alpha.35: a bounded CPU hot run held Max cooling
through 87.125°C, and Restore succeeded in one attempt. The unchanged 90°C manual
cutoff was not crossed. Automated tests and
simulated screenshots do not establish production hardware compatibility.

Source: [Mattcabrices/ThinkPad-Control](https://github.com/Mattcabrices/ThinkPad-Control).
Use [release validation](RELEASE-VALIDATION.md) for evidence and the
[announcement draft](ANNOUNCEMENT.md) for the reviewable Reddit post. No public
binary release is published at the time of this November 9, 2026 audit.

## What the candidate includes

- A native WinForms/WebView2 desktop window, tray controls and bundled Node/.NET
  runtimes. WebView2 is a prerequisite; initial acquisition needs internet.
- CPU/GPU telemetry where exposed, per-core clock details, measured RPM, sensor
  Min/Max and local SQLite history/audit. Missing sensors stay unavailable.
- Separate AC/battery boost and speed policies with read-back/recovery; reviewed
  Ryzen power fields, and Intel monitoring/policy controls with read-only PL1/PL2.
- Firmware/manual/Max fan control, saved service curves with a Max threshold and
  a configurable cutoff for levels 1–7. Max cooling stays at Max above the cutoff while lease and sensor checks pass. Unknown thermal limits use an 85°C fallback.
- Experimental [Turbo](TURBO.md), with captured prior settings and explicit Restore.
  Alpha.34 activation passed; Restore needed one retry. Alpha.35 includes the
  restoration-order fix and Max-cooling thermal change, pending installed tests.
- The pinned source-built TPFanCtrl2 2.5.1 with the documented fan-selector patch,
  unmodified signed EC module, original/modified sources, licenses and credits.
  See [dependency review](DEPENDENCY-REVIEW.md).

Processor boost, CPU speed limit and Ryzen power requests work together. Raising
wattage does not enable disabled boost or remove a speed cap, and accepted requests
do not guarantee higher sustained draw. Turbo coordinates supported controls but
cannot guarantee continuous boost. Intel direct wattage/voltage/multiplier writes
and independent integrated AMD/Intel GPU boost are unavailable.

## Installation and lifetime

Setup requests administrator approval, installs under Program Files, registers
an on-demand worker task and configures the owned fan service automatically.
When PawnIO is absent, setup downloads the pinned official installer with bounded
release/API retries, checks its SHA256 and Windows trusted signature, then runs
it once with fixed arguments. Temporary bytes are kept in a private directory
beneath the protected installation and removed afterward. Driver version and
redistribution policy are unchanged; the driver installer is not bundled.

The worker task is tied to the Windows account recorded by approved setup.
Automatic connection is scoped to that account; other accounts or a missing task
may need explicit hardware-access approval. The UI normally stays unelevated.
Unsigned components may be blocked by Windows application control. Signing and
clean-device policy acceptance remain open; do not disable security protections.

An external TPFanControl service is reported as a conflict and left untouched.
Setup errors appear in the GUI and `hardware-setup-error.txt`. A driver return
code 3010 reports that Windows needs a restart; the app does not initiate one.
Repair hardware support retries setup after the underlying issue is resolved.

Minimize keeps manual cooling while lease and telemetry checks pass. Levels 1–7 also require temperatures below the selected cutoff; Max stays at Max above it.
Closing releases manual cooling to firmware; a saved service curve continues.
**CPU policies and Turbo wattage requests remain until restored or replaced by
firmware.** Exit is not a reset of those settings. Startup never enables Turbo.

Uninstall removes the owned task/service and app files, preserving user data and
shared PawnIO. Upgrades migrate validated curves/offsets with backup/rollback and
preserve stopped/disabled engine state. Portable copies never install a SYSTEM
service from their writable folder. See [desktop usage](DESKTOP.md),
[upgrades](UPGRADES.md), [fan curves](FAN-CURVES.md) and [policy recovery](POLICY-RECOVERY.md).

## Build and package checks

Use the pinned tool versions and complete sequence in [README](../README.md).
The patched engine build needs PowerShell 7, C++ v143 and Windows SDK 10.0.26100.
Normal PowerShell staging scripts also support Windows PowerShell 5.1.

1. Fetch verified dependencies/notices and build the reviewed fan-engine patch.
2. Build native components and the desktop. Run scoped `npm test` and the isolated
   native assertions. Never use unrestricted test discovery for hardware harnesses.
3. Review isolated desktop lifecycle checks and demo-only screenshots. The latter
   capture actual rendered pages; their simulated data is not hardware evidence.
4. Create the public source ZIP with `scripts/package-source.ps1`; `-ListFiles`
   lists the exact source inputs without changing archives.
5. Run `scripts/verify-archives.ps1`. It verifies the payload manifest and complete
   portable/source ZIP contents against the current local inputs, without extraction.
   It rejects missing/modified/unexpected files, unsafe/duplicate/symlink names and
   data hidden in directory entries. The shared setup helper is mandatory.
6. Generate checksums only after final packaging/signing. Keep source, portable,
   installer, notices and hashes tied to the reviewed build. Repackage after edits.

CI builds unsigned development artifacts and never publishes a release or writes
real hardware. Integrity checks compare against local inputs; they do not establish
publisher trust. Bit-for-bit reproducible builds are not yet established.

## Gates before a production claim

| Requirement | Current evidence | Remaining |
| --- | --- | --- |
| Source, architecture, schema and MIT/upstream attribution | Implemented; public source and matching license/source materials | Final notice review after dependency changes |
| Automated build and failure-path coverage | Current evidence in [release validation](RELEASE-VALIDATION.md) | Rerun for final source/signing output |
| GUI clarity and layout | Actual Ryzen/Intel demo captures, minimum-window and high-DPI checks | Owner review; no hardware compatibility inference |
| Missing-driver download/trust gates | Mocked setup branch plus actual data-only SHA/signature checks | Real fresh-driver install and cleanup on a clean device |
| Installed telemetry and fan handover | Alpha.33 upgrade/telemetry preservation and alpha.30 T14s fan handover; earlier T14 Gen 3 observations | Current build on both Ryzen targets and real Intel hardware |
| Turbo | Alpha.34 T14s activation passed; Restore needed one retry, then independent verification passed | Bounded alpha.35 hot run and one-pass Restore passed; broaden model, duration and cutoff-crossing coverage |
| Battery and physical recovery | Partial historical/isolated coverage | AC/battery, longer sessions, sensor/worker/service loss, crash exhaustion, sleep/resume/reboot matrix |
| Upgrade/uninstall and account scope | Prior approved upgrades and ownership tests | Clean-device, independent uninstall, standard-user/alternate-account validation |
| Trusted distribution | Signing tooling prepared | Publisher identity, real signing/timestamps and clean-policy acceptance |
| Public announcement | Reviewed source-preview draft exists | Actual reviewed binary release/links and accurate tested scope before a binary announcement |

Only claim support demonstrated on the named model/build. Unknown readings and
ignored firmware fields remain unavailable/read-only. A zero tachometer reading
does not prove a stopped fan. Preserve these limits in the GUI and release text.

## Signing and publication

Follow [signing setup](SIGNING.md) when the publisher account/identity is ready.
The engine is signed before worker compilation so its final hash is embedded;
upstream provenance remains separate. Payload scripts, including the shared
bootstrap helper, installer and uninstaller are covered by the signing path.
No publisher identity or paid signing account was provisioned by this work.
An unsigned experimental prerelease must retain that status and its validation
limits; it must not be presented as a stable production release.

Review the final source/portable/installer/checksum set and tested-device list
before creating a GitHub release. Review the single [Reddit draft](ANNOUNCEMENT.md)
before posting. CI artifacts, old drafts and simulated screenshots are not a
substitute for that decision. Publication is not automatic.

## Owned fan-service recovery

The desired owned-service crash policy is two restart attempts after 5 and 15
seconds, followed by NONE, with a one-day failure-counter reset and no reboot or
recovery command. Configuration validates the protected path and exact engine/
module hashes, checks read-back and attempts verified rollback on failure. It
never configures an external fan service. Isolated policy tests do not prove all
physical crash/suspend recovery paths; the remaining device matrix still applies.
