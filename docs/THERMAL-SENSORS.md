# Supplemental thermal sensors

The worker supplements LibreHardwareMonitor 0.9.6 with two original, read-only adapters. Each polls independently every three seconds without holding the fan watchdog lock. Read failures clear the affected sample; samples older than twelve seconds disappear. Neither adapter changes boost, clock, power limits or fan settings.

## Firmware zones

Windows `root\WMI:MSAcpi_ThermalZoneTemperature` exposes `InstanceName` and `CurrentTemperature`. The latter is tenths of Kelvin: Celsius = value / 10 - 273.15. Zero, non-finite and temperatures outside (0, 125] Celsius are unavailable. Enumeration has a two-second timeout and runs outside the command/watchdog thread. Windows may require an elevated worker to access this class.

Firmware zone names are retained, in the `Firmware` sensor group. The dashboard uses a firmware-zone card when no identified motherboard temperature exists. It does not rename TZ01 as a motherboard die or infer identities for unnamed EC slots. Firmware may expose no zones, or may supply static values; that cannot establish physical sensor placement.

## APU GFX

The public PawnIO `RyzenSmu` API provided by the pinned LHM dependency refreshes and reads the firmware PM telemetry table. We use its existing signed module; no additional kernel driver or copied LHM implementation is introduced.

The supplemental decoder requires all of:

- A CPU codename and PM table version pair listed under "Integrated GPU temperature" in `RYZEN-COMPATIBILITY.md`. Only Cezanne table `0x00400005` is physically validated.
- The exact table size for that version (rounded to 64-bit entries by the API).
- A finite Celsius float at that version's byte offset, within (0, 125].

Unknown CPU families and table versions remain unavailable; no approximate offset or CPU-temperature substitution is used. The APU GFX domain also appears separately in All sensors with its exact codename, table and offset.

The reading is shown on a GPU card only when the machine has exactly one AMD GPU and that GPU reports no core temperature of its own. A driver's own temperature always takes precedence. With two AMD GPUs, neither inherits the reading. One limitation remains: a discrete Radeon that is the only visible AMD GPU and has no temperature sensor would show the APU reading.

Layout reference: FlyGoat/RyzenAdj `lib/api.c`, `request_table_ver_and_size` and `get_gfx_temp`: https://github.com/FlyGoat/RyzenAdj/blob/d9f9f4cd2ee7847831f8821dbfe2b0fe450e0bf5/lib/api.c. Thanks to Jiaxun Yang and RyzenAdj contributors for documenting the table. We used the table identity/offset as interoperability information and wrote the decoder independently; no RyzenAdj binary or implementation code is bundled. RyzenAdj retains its own LGPL license.

API conversion reference: https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/design-guide (thermal temperatures in tenths Kelvin).

## Validation

Native fixture tests cover Kelvin conversion, sentinel rejection, GFX table decoding, unknown/truncated tables, NaN and discrete-GPU identity rejection. Provider tests verify firmware-zone labeling remains distinct from motherboard and per-GPU values. Physical verification is summarized separately in COMPATIBILITY.md; an automated fixture is not evidence of successful firmware access on a machine.

