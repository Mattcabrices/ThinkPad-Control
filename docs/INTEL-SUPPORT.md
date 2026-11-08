# Intel ThinkPad support

The shared Advanced CPU tuning section now shows read-only package PL1/PL2
settings on reviewed Intel models: power, enable/clamp flags, time windows and
register lock. These are captured at hardware connection, not live wattage;
reconnect to refresh. Unsupported mappings and denied reads remain unavailable.
No Intel power-limit writes are implemented. See [decoder scope and sources](INTEL-TUNING-PLAN.md).

This build adds Intel ThinkPads to experimental primary-fan setup and improves
hybrid processor policy handling. No Intel machine was connected for this work.
The implementation and isolated tests are not hardware certification.

Alpha.5 leaves class-aware frequency and Maximum boost controls unavailable when
the native Intel processor identity cannot be read; it does not guess that a
blocked bridge means a non-hybrid CPU. Standard Windows boost remains independent.
Reading the identity does not require a successful P-state/MSR read. See
[policy recovery](POLICY-RECOVERY.md) for verified rollback and explicit repair.

## Available paths

| Feature | Implementation | Limits |
| --- | --- | --- |
| CPU temperature, clocks, load and package power | Pinned LibreHardwareMonitor/PawnIO bridge | Only sensors actually exposed; unavailable readings remain unavailable |
| CPU boost on AC/battery | Windows PERFBOOSTMODE with read-back | Firmware, thermal and power limits still apply |
| Maximum boost | PERFBOOSTMODE plus PERFEPP; PERFEPP1 too when CPUID identifies a hybrid CPU | Both classes must read back; original per-class preferences saved before writes |
| CPU speed limits | PROCFREQMAX plus PROCFREQMAX1 on hybrid CPUs | Policy values are requests, not guarantees of measured frequency |
| Undo speed limits | Restore each class's own connection baseline | Requires complete baseline for the active plan; does not assume both classes were equal |
| Hardware base/minimum and turbo ratios | Existing read-only Intel MSR module and decoder | Missing or unsupported reads remain unavailable; hybrid turbo ratio layout is not inferred |
| Intel graphics | LHM telemetry plus inventory fallback | Separate integrated/discrete devices retained; no invented temperature or independent Intel GPU boost control |
| ThinkPad primary fan | Existing pinned TPFanCtrl2 engine and signed EC module | Experimental; no Intel hardware validation in this project yet; no second channel enabled |
| Motherboard temperature | Named sensors only | No anonymous EC slot relabeled as a motherboard component |
| Advanced CPU tuning | Intel-specific read-only package limits and capability explanation; Ryzen controls never constructed on Intel | No Intel voltage, multiplier, PL1/PL2, undervolt or arbitrary MSR writes added; readings are from connection, not physical Intel validation |

The optional hardware task identifies Lenovo ThinkPads using product/model
inventory and accepts an Intel CPU manufacturer or Ryzen CPU name. Other devices
still receive only the sensor driver. Existing external fan services are left
untouched. Startup and thermal fallback remain firmware-controlled. The primary
fan configuration is not a dual-fan model profile: machines requiring independent
channels still need model-specific work and testing.

Hybrid maximum boost changes both EPP classes on the selected power source.
Non-hybrid CPUs leave PERFEPP1 alone even if Windows exposes it. Unknown/missing
class-1 policy refuses the operation before writes. A failed write/read-back
attempts restoration of every attempted class/source. Old saved baselines lacking
class-1 data are migrated when enabling on a hybrid machine, preserving the
earlier boost/EPP values and capturing the previously untouched second class.

The CPU page calls out different current class limits rather than showing a
uniform limit as selected. Undo restores each class separately. Compatibility
reports include class-1 frequency and both EPP policies without power-plan IDs.

## Isolated coverage and future hardware pass

Tests exercise Intel/Ryzen/non-ThinkPad eligibility, distinct class preferences,
legacy baseline migration, restart restoration, class-1 refusal and ignored
writes, non-hybrid noninterference, distinct frequency undo, incomplete baselines,
and Intel integrated/discrete GPU identity. Native fixtures cover Intel identity
and MSR decoding but do not execute Intel firmware.

The unchanged alpha.3 desktop executable passed its GUI smoke outside the tool's
filesystem sandbox: four metrics rendered, hardware actions stayed disabled and
the demo exited successfully. Earlier sandboxed attempts stalled WebView2's
renderer. This is a test-environment limitation, not proof of an app startup bug.
No security settings or navigation-origin checks were relaxed.

Alpha.4 adds a separately labelled Intel hybrid demo (`--demo-intel`) with its own
simulated database, graphics and per-class policies. It cannot start hardware
access. Its real WebView2 renderer check navigates the CPU and GPU pages, verifies
the mixed class limits, excludes the Ryzen panel, and confirms Intel graphics.
Run `scripts/test-desktop.ps1` after building to check both demo profiles; use a
normal non-elevated desktop session with access to WebView2's renderer, outside a
restrictive tool filesystem sandbox. No UAC is required. The check records stages,
has a UI timeout and independent process deadline, and refuses smoke mode without
an explicit simulated profile. A passing demo is not Intel hardware validation.

Ratio decoding now selects the nominal reference by reviewed family/model.
Nehalem/Westmere uses 133 1/3 MHz; reviewed Sandy Bridge and later client layouts
use 100 MHz. Base/minimum and turbo conversion use the same reference. Core 2,
Atom, other vendors/families and unknown models do not inherit this mapping.
Their Windows policy controls and any exposed LHM telemetry remain separate.
The compatibility report includes `referenceClockMhz`; it is nominal, not a measured
BCLK or a guarantee of actual core speed.

On an Intel test laptop, collect the compatibility report first. Record model,
BIOS, CPU, GPU and exposed sensors without serial numbers. Validate temperature
identity and primary RPM, then test one bounded policy change at a time, restoring
the exact AC/DC and class-specific baselines. Test UAC cancellation/reconnection
and supervised watchdog/recovery before advertising support. Hybrid and
non-hybrid hardware both need this pass. Do not use this server for destructive
crash/sleep/reboot tests while the owner is away.

## References

- [Microsoft PerfEnergyPreference](https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/options-for-perf-state-engine-perfenergypreference): PERFEPP/PERFEPP1 aliases and preference range.
- [TPFanCtrl2 upstream](https://github.com/mews-se/TPFanCtrl2): EC service architecture, PawnIO backend and SingleFan configuration. This project continues to ship its already pinned/patched engine; no new upstream binary was fetched.
- [Intel SDM volume 4](https://www.intel.com/content/dam/develop/external/us/en/documents-tps/335592-sdm-vol-4-testsize.pdf): model-specific register ratio units, including the older 133.33 MHz reference.
- [CPU speed steps](CPU-SPEED-STEPS.md), [compatibility matrix](COMPATIBILITY.md), and [release gates](RELEASE.md).
