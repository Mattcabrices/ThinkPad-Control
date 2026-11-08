# Ryzen compatibility and capability discovery — 0.4 alpha

Direct tuning now discovers Lenovo ThinkPad Ryzen capabilities by signed PawnIO CPU codename and exact firmware telemetry-table version. No CPU product-name whitelist or T14s-specific tuning gate is used. The T14s Gen 2 / 5650U STAPM exception remains narrow because both write routes failed physical read-back on that machine. Other machines negotiate each setting independently when the user requests a change.

## What each machine gets

| Feature | Lenovo Ryzen ThinkPad | Other Ryzen PC | Intel PC |
| --- | --- | --- | --- |
| CPU speed limit and boost (Windows policy) | Yes | Yes | Yes |
| Read-only hardware P-states (needs the sensor driver) | Family 17h, 19h, 1Ah | Family 17h, 19h, 1Ah | Base and minimum from `PLATFORM_INFO` |
| Ryzen power and temperature limits | Reviewed tables only | No: not validated on other vendors' firmware | Not applicable, panel hidden |
| TPFanCtrl2 fan control | Capability detected, primary fan only | No | Experimental on Lenovo Intel ThinkPads; no physical Intel validation |

"Yes" means the code path exists, not that it was physically tested. See "Reviewed protocol mappings" and `CPU-SPEED-STEPS.md` for evidence. The installer's optional hardware task installs the PawnIO sensor driver on any of these machines, and offers the primary-fan engine service on Lenovo Intel or Ryzen ThinkPads. Intel setup is experimental and untested on physical Intel hardware; see `INTEL-SUPPORT.md`. Models with two fans are not specifically supported: the engine runs with `SingleFan=1`, so only the primary fan is read.

## Reviewed protocol mappings

| CPU family | Accepted table versions (hex) | Physical validation here |
| --- | --- | --- |
| Raven Ridge / Raven Ridge 2 / Picasso / Dali | 1E0001, 1E0002, 1E0003, 1E0004, 1E0005, 1E000A, 1E0101 | Fixtures only |
| Renoir / Lucienne | 370000–370005 | Fixtures only |
| Cezanne / Barcelo | 400001–400005 | 5650U, table 400005 |
| Rembrandt (including Ryzen 6000 / compatible 7035 families) | 450004, 450005 | 6650U on a T14 Gen 3, table 450005, AC: fast, slow and temperature changed and restored; sustained did not change. See the compatibility summary |
| Phoenix / Phoenix 2 / Hawk Point | 4C0006, 4C0007, 4C0008, 4C0009 | Fixtures only |
| Strix Point | 5D0008, 5D0009, 5D000B | Fixtures only |
| Strix Halo | 64020C | Fixtures only |
| Krackan Point / Krackan Point 2 | 650005 | Fixtures only |

Names above identify firmware families, not marketing-number guarantees. Hawk Point is identified by its CPU codename and uses the Phoenix tables above; the source doesn't label a separate Hawk Point table. A recognized CPU with an unreviewed table stays unavailable with its codename/table in the reason. Earlier Phoenix tables (4C0003–4C0005) have known sizes but no reviewed readings. Mendocino has setter commands but no table mapping. Dragon Range and Fire Range use different mailboxes and commands that aren't implemented. None of these, nor desktop-derived layouts or future firmware variants, inherit a guessed mapping.

## Integrated GPU temperature

| Table versions (hex) | Offset |
| --- | --- |
| 370000–370004 | 0x5AC |
| 370005 | 0x5C8 |
| 400001 / 400002 / 400003 | 0x604 / 0x61C / 0x63C |
| 400004, 400005 | 0x640 |
| 5D0008, 5D0009, 5D000B | 0x4C8 |
| 64020C | 0x550 |

Only 400005 is physically validated. Each offset is accepted only with its own CPU family and table size. Raven, Rembrandt, Phoenix and Krackan have no reviewed offset, so they rely on GPU driver sensors. Only a driver sensor for the graphics core counts as the GPU temperature. Others, such as `GPU VR SoC` on the T14 Gen 3, stay in the sensor list under their own names. The APU reading is shown on the GPU card only when the machine has one AMD GPU and that GPU reports no core temperature of its own. This registry broadens support across Ryzen ThinkPad generations; it cannot truthfully certify every laptop/BIOS without corresponding evidence.

The read-only discovery validates all four current power/thermal limits before enabling controls. It reads only the known header prefix (through 0x43 or 0x5B, rounded to 64-bit entries). It never maps a guessed full table size. Legacy mobile and Strix Halo thermal limits use 0x58, other reviewed headers use 0x40. MP1 routing and message IDs are family-specific. Unknown family/table pairs and cross-family table substitutions are rejected by fixtures.

## Applying controls

No tuning write occurs at discovery or startup. Explicit changes are bounded, acknowledged and verified against firmware telemetry. If firmware rejects a STAPM change through MP1, families other than the Raven group retry through the reviewed PSMU route (command 0x31). This retry hasn't been shown to work on any machine: on the T14s Gen 2 both routes were acknowledged and ignored, so read-back still decides the result. On the T14 Gen 3 a sustained request didn't change the value, but the route used wasn't recorded, so the retry may not have run. The app now reports the route as `sustainedRoute`. Both tested machines read sustained equal to fast and above slow (25/25/18 W and 28/28/24 W). On the T14 Gen 3, lowering fast also moved sustained until firmware returned it within about 15 seconds, seen once. A verified change now names any other limit that moved. A rejected/capped/ignored value causes per-field failure, attempted verified rollback and disables further custom changes for that connection. Baseline restoration stays available except for known permanent read-only quirks. Other settings and monitoring continue to work. Firmware overrides are reported without silently reapplying values.

The custom ranges start from conservative ceilings: sustained 5–25 W, burst 5–40 W, average 5–30 W, thermal 60–90 C. These are application ranges, not maximum performance claims or manufacturer certification. If a machine's firmware reported a higher limit when the worker connected, that value becomes the ceiling for that setting, so a higher-power machine can use its own range. The app never offers more than the larger of the conservative ceiling and the firmware's own value. Firmware readings above 100 W or 110 C are refused as invalid.

## Provenance

Hardware identities, mailbox addresses, message IDs and header offsets were reviewed against FlyGoat/Jiaxun Yang and contributors' RyzenAdj primary source:

- https://github.com/FlyGoat/RyzenAdj/blob/d9f9f4cd2ee7847831f8821dbfe2b0fe450e0bf5/lib/api.c
- https://github.com/FlyGoat/RyzenAdj/blob/master/lib/nb_smu_ops.c

The original application implementation remains MIT; no RyzenAdj implementation or binary is copied. The existing signed PawnIO module and matching dependency sources retain their licenses. See RYZEN-TUNING.md for lifetime, baseline and rollback semantics.
