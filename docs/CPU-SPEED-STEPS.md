# CPU speed steps and hardware P-states — 0.4 alpha

CPU speed steps have two separate parts: a control that caps speed, and a read-only view of the processor's hardware states.

## The control: Windows maximum frequency

A step sets the active power plan's `PROCFREQMAX` value, separately for plugged-in and battery use. `0` means no limit. Accepted values are 0 or whole numbers from 800 to 8000 MHz.

- The same setting and code path are used on AMD and Intel. No driver or hardware access is needed.
- On Intel hybrid CPUs, `PROCFREQMAX1` is written too, so both core classes are capped. Other CPUs leave it untouched.
- Each write is read back. A failed write or mismatch restores the captured values.
- Voltages and multipliers are not changed.
- A step stays in the power plan after the app closes, like any Windows power setting. Nothing is reapplied automatically.
- **Undo** returns the value seen when the app connected to that plan. This may be an existing cap and is not a factory default.
- A limit that doesn't match a step, such as one already set in the Windows power plan, appears as **Custom**, with a note if it has no effect while boost is off.
- Choosing a step applies it immediately.

Read-back proves that Windows stored the value, not that firmware honours it. Compare the live frequency in the panel to confirm the effect.

## The read-only view: hardware states

With hardware access enabled, the worker reads fixed registers through the signed PawnIO modules once at connection. Callers cannot choose a register.

| CPU | Registers | Decoding |
| --- | --- | --- |
| AMD family 17h, 19h (Zen 1–4) | `C0010064`–`C001006B`; `C00102B1` for CPPC | Bit 63 enabled; MHz = 200 × FID[7:0] / DID[13:8] |
| AMD family 1Ah (Zen 5) | Same | Bit 63 enabled; MHz = 5 × FID[11:0], where FID must exceed 0xF |
| Intel | `PLATFORM_INFO` (`CE`) | Base = bits 15:8 × 100 MHz; minimum = bits 47:40 × 100 MHz |

### Boost range

Boost has no list of states on Ryzen: above P0, firmware picks the speed continuously.

- **AMD, with CPPC active:** `C00102B0` is read on each logical processor, and the highest value is used. It only suggests the range and doesn't convert directly to MHz. A 5650U reports highest 186 and nominal 89, which scales P0 to 4807 MHz against a rated 4.2 GHz. A 6650U also reports highest 186, with nominal 105, which scales to 5137 MHz against a rated 4.5 GHz. The app therefore never shows or offers that figure. It uses it only to space **Boost** limits above P0, which were 3100 and 4000 MHz on the 5650U. The raw values are in the Compatibility report.
- **Intel:** `TURBO_RATIO_LIMIT` (`1AD`) gives the top ratio by active core count, so the top value is offered as **Max boost**. On hybrid CPUs, only the top ratio is used because the layout differs. A rising, below-base or impossible table is refused. Alpha.4 selects the nominal ratio reference from reviewed family/model identities: 133 1/3 MHz on Nehalem/Westmere and 100 MHz on reviewed newer client layouts. Unknown layouts are refused; `referenceClockMhz` is included in the report. No Intel machine has been tested.

These are ordinary Windows speed limits and not hardware states. Firmware still picks the actual speed, and they have no effect while boost is off. On the 5650U, a 3100 MHz limit held the core sensor at 3044 MHz under load. The panel also notes when package power or temperature is at its Ryzen limit.

Disabled, malformed or out-of-range entries are dropped. Other vendors and AMD families are refused with a reason, and steps fall back to values derived from the rated base frequency. When firmware uses CPPC, it can select speeds between the listed states, so the panel says so.

Three or more hardware states are offered exactly as read. With fewer, steps are interpolated between the known frequencies and labelled only by MHz.

## Validation

| Item | Evidence |
| --- | --- |
| `PROCFREQMAX` on Ryzen 5 PRO 5650U, AC | Physical, through the installed app: up to 2301 MHz fell to 1602 MHz under load with a 1600 MHz cap, then the original value was restored |
| `PROCFREQMAX` on Ryzen 5 PRO 6650U, AC | Physical: a 1600 MHz cap was stored and slowed the CPU, but didn't hold at 1600. The core sensor read 1815 MHz, and workload timing suggested about 2280 MHz. That run had boost on (mode 2) |
| `PROCFREQMAX` on Ryzen 5 PRO 5650U, timed, AC, boost off | Physical on 0.4.0-alpha.2, one run of each state: workload median 1851 ms uncapped, 2693 ms at 1600 MHz, 1848 ms restored. The 1.455 ratio matches the 1.438 expected from 2300 to 1600 MHz, about 1580 MHz. The `Core #2` sensor read about 1086 MHz in that run, against 1602 MHz in the earlier test, so a single clock sensor doesn't prove a cap. Whether boost explains the 6650U difference hasn't been tested |
| Battery behaviour | Not physically tested |
| AMD register decoding, family 19h | Physical on the 5650U: P0 2300, P1 1800, P2 1600 MHz; CPPC active. P0 agrees with the 2301 MHz base Windows reports. Physical on the 6650U: P0 2900, P1 1800, P2 1600 MHz; CPPC active. P0 agrees with the 2901 MHz base |
| AMD family 17h decoding | Fixtures only |
| AMD family 1Ah decoding | Fixtures only |
| All Intel paths, including hybrid | Fixtures only; no Intel machine was available |

The Compatibility report includes this data so results from other machines can be reviewed. Support on a CPU family is claimed only after its report has been checked.

## Maximum boost

This option sets `PERFBOOSTMODE` to 2 (Aggressive) and `PERFEPP` to 0 (favor speed) for plugged-in or battery use. On hybrid Intel it also sets and verifies `PERFEPP1`, saving/restoring both class preferences separately. It doesn't change speed limits or Ryzen power limits, and it never sets the minimum processor state to 100%.

Earlier values are saved to `max-boost-baseline.json` in the app's data folder before the first write. If that save fails, nothing is changed. Turning the option off restores those values, even after a restart. If they are unknown or invalid, the app sets standard boost (mode 1, preference 50) and says so. Using the plain boost switch leaves Maximum boost first. Turning it off while it's already off changes nothing. A power plan already in mode 2, as on the T14 Gen 3, only has its preference changed. No gain was measured there either, but those runs were affected by heat and a standby period, so that result is weak.

Alpha.5 records pending recovery before applying or restoring Maximum boost. If
recovery cannot be verified, the CPU page offers **Finish boost recovery** even
when the combined toggle reads off. Re-enable is refused until this is resolved;
the saved original preferences are not overwritten. No startup recovery writes
occur. Both already-on and already-off requests are no-ops when no recovery is
pending. See [recovery behavior and limits](POLICY-RECOVERY.md).

Firmware still decides actual speed. Measured on a Ryzen 5 PRO 5650U on AC, with firmware limits of 25/25/18 W and 86 °C, using the active Balanced plan. One workload was pinned to a single core. Speed by timing is relative to the boost-off runs, taken as the 2301 MHz rated speed:

| Setting | Workload time | Speed by timing | Highest core sensor | Package power | Temperature |
| --- | --- | --- | --- | --- | --- |
| Boost off | 175–184 ms | about 2300–2400 MHz | 2271 MHz | 10–11 W | 66–79 °C |
| Standard boost | 117 and 125 ms | about 3400–3600 MHz | 3843 MHz | 18.0 W | 79–82 °C |
| Maximum boost | 116 and 117 ms | about 3600–3650 MHz | 3493 MHz | 17.9–18.0 W | 80–82 °C |

Short bursts after idle gave a median of 285.0 ms on standard boost and 287.1 ms on Maximum boost, over 120 alternating samples each. **On this machine, Maximum boost gave no clear speed gain over standard boost**. The large gain comes from turning boost on. Battery use and fan noise weren't measured, and other CPUs may behave differently.

With boost on, package power sat at the 18 W average limit. Raising that limit to 25 W, under the firmware's automatic fan control and starting from an already warm machine, only helped a little. The one-core sensor peak rose from 3693 to 3918 MHz, but workload time didn't improve (101 ms at 18 W, 103 ms at 25 W, 106 ms back at 18 W). Package power stayed near 18 W at 25 W, and temperature reached 87 °C against the 86 °C limit. On this machine, heat appears to take over as the limit once the power limit is raised.

A later run started cooler, at 71 °C. At 25 W under firmware fan control, it reached a 4017 MHz core sensor peak (median peak 3992 MHz), 99 ms workload time, 20.6 W and 87 °C over 16 seconds. So about 4 GHz is reachable for short periods from a cool start, but these short runs didn't show that it can be sustained. Fan level 7 under 18 W gave 3568 MHz, 108 ms and 83 °C. Level 7 read about 3800 RPM after spin-up, while firmware has been seen above 5000 RPM, so level 7 is not the fan's top speed. Another application was using a full core during these tests, so absolute figures are pessimistic.

A `_Total` processor counter averages all logical processors, so it understates the speed of a busy core. Earlier sustained figures based on it are not used here.

## Not exposed

The signed AMD module also permits writes to the P-state registers, and those registers include voltage IDs (VID). This app does not use those writes: incorrect values can cause instability, and firmware may ignore or replace them. The signed Intel module does not permit writing a frequency-control register at all.

## Sources

- Linux `tools/power/cpupower/utils/helpers/amd.c` (AMD layout reference; no code copied)
- Windows `powercfg` setting definitions on the test host (`PROCFREQMAX`, `PROCFREQMAX1`)
- Intel SDM volume 4 (`MSR_PLATFORM_INFO`)
