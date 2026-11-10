# Advanced Ryzen tuning — 0.4 alpha

The CPU & power page selects direct SMU controls by Lenovo ThinkPad identity, signed PawnIO CPU-family identification and an exact reviewed telemetry-table version. The original T14s/5650U-only restriction is removed. See RYZEN-COMPATIBILITY.md for the accepted family/table matrix and the distinction between protocol fixtures and real hardware evidence.

| Setting | Custom range | Unit |
| --- | --- | --- |
| Sustained power (STAPM) | 5–25; read-only on the tested T14s/5650U combination | W |
| Burst power (PPT fast) | 5–40 | W |
| Average power (PPT slow) | 5–30 | W |
| CPU thermal limit | 60–90 | C, integer |

These are conservative application limits, not device maximum ratings or guaranteed performance. Power accepts tenths of a watt. A higher limit does not enable Windows boost or guarantee a higher clock. Voltage, multipliers, Curve Optimizer, time constants and GPU clock writes are not exposed.

Each power row lists its **Firmware limit**, **Connection baseline** and **App
maximum**. The first two come from observed laptop values. App maximum comes from
the provider's validated request range, including a higher observed baseline
where supported; Turbo uses the same ceiling for writable fields. It is not a
hardware-rated or guaranteed accepted maximum. The current adapter does not
expose a verified hardware maximum. Read-only fields remain disabled even when
their app ceiling is displayed.

Alpha.36 separately displays optional [firmware-reported power ranges](FIRMWARE-POWER-LIMITS.md)
for named profiles. These are advisory OEM capability ranges, not SMU maximum
ratings, and do not change the writable ranges above. Missing metadata remains
Not reported. CPU SPL, APU SPL and STAPM are not silently treated as the same limit.

## Boundaries and verification

The worker uses the existing LHM 0.9.6 signed embedded RyzenSMU module through an original MIT transport. It checks every IOCTL result and returned length, takes the shared Global\Access_PCI mutex and uses bounded waits. Only fixed, family-selected commands/register addresses exist internally. No arbitrary register or mailbox API is exposed to the UI, local HTTP API or private pipe. No additional tuning driver is installed.

Header reads consume only reviewed offsets. Unknown family/table combinations are refused. Firmware queries run independently of the fan watchdog lock. Telemetry is polled every three seconds and expires after twelve seconds. First valid values establish the connection baseline. An explicit write captures the previous value, requests one setting and checks matching telemetry within a bounded window. Ignored, rejected, capped or immediately overwritten writes fail; the controller attempts to restore the prior observed value and verifies recovery. Failed recovery remains explicitly UNVERIFIED. A failed field becomes read-only for that connection while other controls continue working.

Firmware overrides are reported without reapplying values. Nothing is applied at startup, resume or on power-source changes. Changing AC/battery source disables tuning until hardware access is reconnected and a new baseline is captured. Every write rechecks that source.

## Baselines and lifetime

Restore baseline is per setting and means the first valid value observed by the current worker. It is not a factory reset: connecting while custom settings are active captures those settings. A valid captured baseline can exceed the custom UI ceiling. Factory restoration may require a reboot/vendor action. Settings may remain active after closing the app until firmware replaces them; the app does not claim automatic factory restoration.

## Physical evidence

The observations below establish lower-limit changes and restoration, not raising
limits above the original values. Higher sustained package power, continuous turbo
or improved workload performance has not been demonstrated. A firmware-verified
setting is not a measurement of delivered power or performance. Known unsupported
fields remain read-only with disabled controls and a reason; failed custom writes
disable further changes for that connection while verified baseline recovery may
remain available.

Selected lower-limit and restore operations were verified on a T14s Gen 2 /5650U /table400005. STAPM requests were ignored through both reviewed routes; that specific combination retains a read-only quirk. Other models negotiate capability independently.

Selected lower-limit and restore operations were verified on a T14 Gen 3 /6650U /table450005. Sustained requests were ignored; coupled changes between limits were also observed. These observations do not establish supported increases, stable higher wattage or general firmware compatibility. Raw device journals are not included in the public source.

Native fixture tests cover family routing, command IDs, header offsets, invalid data, bounded write requests, read-back failure and rollback. They do not certify BIOS acceptance on untested laptops. The T14 Gen 3 has not been physically tested in this session.

## Fan engine and intermittent zero RPM

Version 0.4 rebuilds pinned TPFanCtrl2 2.5.1 with a documented selector patch: SingleFan avoids EC fan-bank selection entirely; dual selection preserves unrelated selector bits and skips redundant writes. Tachometer bytes are still read low-first from the original EC locations. No requested speed, temperature, or cached nonzero sample is substituted for current RPM. A raw zero remains labelled as rotation unconfirmed.

This patch addresses an implementation difference from Linux thinkpad_acpi; intermittent zero readings still require installed testing and physical rotation correlation. Do not infer a physical fan stop solely from zero bytes. Original/modified engine sources, patch and build provenance ship under notices/fan-engine. The signed LpcACPIEC module and PawnIO kernel driver are unchanged.

## Source references and credits

- FlyGoat/Jiaxun Yang and RyzenAdj contributors: https://github.com/FlyGoat/RyzenAdj/blob/d9f9f4cd2ee7847831f8821dbfe2b0fe450e0bf5/lib/api.c and lib/nb_smu_ops.c.
- namazso/PawnIO.Modules signed module ABI, matching 0.2.2 sources already included with LHM dependencies: https://github.com/namazso/PawnIO.Modules/blob/e12a858d952461ee2e919897cacbff7f905fe370/RyzenSMU.p.
- Fan selector semantics: https://github.com/torvalds/linux/blob/master/drivers/platform/x86/lenovo/thinkpad_acpi.c (fan_select_fan1, fan_get_speed).

The original application decoder/control implementation remains MIT. No RyzenAdj or Linux implementation code is copied. Existing LHM, PawnIO and TPFanCtrl2 components retain their respective licenses and author credits.
