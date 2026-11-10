# Reddit announcement draft

Prepared for review; not posted. This draft describes the current source preview, not a signed or hardware-certified binary release. Update the status and link only after the corresponding release checks pass.

## Suggested title

I’m building ThinkPad Control: an open-source Windows app for fan curves, hardware monitoring and CPU power controls

## Post

I wanted one desktop app for checking what my ThinkPad is doing and managing its cooling and CPU power settings, so I’m building ThinkPad Control.

Source: https://github.com/Mattcabrices/ThinkPad-Control

By **Matt Cabrices**.

It brings together:

- CPU/GPU temperatures, clocks and power where the hardware exposes them, plus per-core clock details, measured fan RPM and a sensor list with Min/Max.
- Firmware fan mode, direct fan levels, Max cooling and saved temperature curves.
- Separate AC/battery CPU boost and speed limits, with an explanation of how they interact.
- Advanced Ryzen power limits on reviewed CPU/firmware mappings. Unsupported settings stay read-only. Intel systems get the available monitoring and Windows CPU controls; direct Intel wattage tuning is not implemented.
- An experimental Turbo preset that coordinates Max fan, boost, speed caps and supported Ryzen wattage limits, then offers Restore previous settings.

This is an unsigned development preview, not a finished universal ThinkPad controller. Initial hardware observations are on the T14s Gen 2 AMD and T14 Gen 3 AMD. Other models need validation, and sensor availability depends on firmware and drivers. A short alpha.34 Turbo check on the T14s Gen 2 verified 40 W burst / 30 W average limits, Maximum boost and Max fan. Restore needed one retry; original settings were independently verified afterward. A follow-up source fix for restoration order still needs installed testing. Raising a wattage request does not guarantee that firmware will allow a higher sustained power draw. See the [validation report](RELEASE-VALIDATION.md).

The source is available now; a validated public installer release is still pending. You can run a clearly labelled demo without changing hardware settings. The repository includes build instructions, support details and the current release checklist.

The original app code is MIT licensed. Fan support builds on TPFanControl/TPFanCtrl2, with thanks to troubadix and its continuing contributors. PawnIO and LibreHardwareMonitor provide essential hardware access and monitoring. Their licenses, credits and matching sources are preserved in the project/package.

I’d appreciate feedback on the interface and reports of exposed sensors on other ThinkPads. Please include the model/generation, CPU, Windows version and which readings work, without serial numbers or private logs. Monitoring reports and actual control tests should be described separately.

## Before posting a binary release announcement

- Complete the current release gates and record exact model/build observations.
- Replace preview wording only where current evidence supports it; keep unsupported Intel/Ryzen fields explicit.
- Link the actual reviewed GitHub release and its checksums. Do not link a local candidate, old draft or simulated screenshot as hardware proof.
- State the actual signing status. Do not promise SmartScreen reputation or continuous boost.
- Explain Turbo’s lifetime: minimizing keeps manual cooling; closing releases it, while power settings remain until Restore.
