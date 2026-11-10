# Firmware-reported power maximums

By **Matt Cabrices**.

Alpha.36 reads optional Lenovo power-range metadata and displays it on CPU &
power. This feature is read-only. It does not change CPU policies, power limits,
thermal limits, firmware profiles, Turbo targets or the app's writable ranges.
Missing data is shown as **Not reported**, never inferred from TDP, observed
power, the current power target or the highest accepted request.

## What is reported

The worker queries only `LENOVO_CAPABILITY_DATA_01` in `root\WMI`. CPU device
ID 1 and type 0 identify ordinary, non-cross-load limits. Reviewed feature IDs
are 1 (CPU average/SPPT), 2 (CPU sustained/SPL), 3 (CPU burst/FPPT) and 5 (APU
sustained/SPL). Each range retains its encoded profile ID, minimum, default,
maximum and increment in watts. CPU SPL, APU SPL and the existing Ryzen SMU STAPM
setting are not assumed to be identical controls.

The UI lists each profile separately. Profile 0 is labelled Platform-defined,
255 is Custom, and other IDs are shown as Profile N without guessing their
names. It does not infer the active profile or switch profiles. A reported
maximum means a firmware-allowed setting for that profile, not an absolute
silicon rating, proof of safe operation under every workload, or guaranteed
sustained delivery. Positive reporting still needs validation on hardware that
implements this interface; the tested T14s Gen 2 returns Invalid class.

## Data boundaries

The original MIT decoder rejects unsupported/non-power identifiers, cross-load
subtypes, invalid or implausible ranges, unsupported capability flags,
conflicting duplicate IDs and oversized tables. The 500 W plausibility bound
applies to metadata decoding only; it grants no write capability. An unavailable
query clears prior values. Samples older than 60 seconds are hidden as stale.
Access denial is distinguished from an absent class.

WMI collection runs independently of the sensor and fan locks, with a two-second
enumeration timeout and 30-second polling. The snapshot path only reads the
cached immutable result. No WMI methods, registry changes, raw register scans,
trial power writes or additional UAC requests are used. The compatibility report
exports only allowlisted metadata fields and excludes stale values.

## Higher-power ThinkPads and caps

ThinkPads are not universally 15–25 W machines. Lenovo offered the T15p Gen 3
with the Core i7-12800H; Intel lists 45 W processor base power for that CPU.
The T15g Gen 2 also offered H-series processors, and P-series workstations include
Ryzen HS options. Base power/TDP is distinct from burst limits and does not
define a universal multiplier for a safe custom wattage.

Alpha.36 does not add uncapped tuning. Existing bounds, writable-field checks,
firmware read-back and restoration remain in force. Existing Ryzen ranges can
already retain higher observed connection baselines. Removing all bounds would
require a separate policy decision across the UI, API, native validation and
Turbo recovery journal; it is not accomplished by removing an input maximum.
Intel direct power writes remain unimplemented regardless of detected ranges.

## Primary references

- [Linux Lenovo WMI documentation](https://docs.kernel.org/wmi/devices/lenovo-wmi-other.html)
- [Capability ID layout and flags](https://github.com/torvalds/linux/blob/master/drivers/platform/x86/lenovo/wmi-capdata.h)
- [CPU feature identifiers](https://github.com/torvalds/linux/blob/master/drivers/platform/x86/lenovo/wmi-other.c)
- [Lenovo T15p Gen 3 specifications](https://psrefstuff.lenovo.com/product/ThinkPad/ThinkPad_T15p_Gen_3)
- [Intel laptop processor comparison chart](https://www.intel.com/content/dam/support/us/en/documents/processors/core/Intel-Core-Comparsion-Chart.pdf)
- [Lenovo P16v Gen 1 AMD specifications](https://psref.lenovo.com/product/ThinkPad/ThinkPad_P16v_Gen_1_AMD)

Protocol facts were reviewed November 10, 2026. No Linux or Lenovo Legion Toolkit
implementation code is copied into this feature; upstream licenses and credits
for bundled components remain unchanged.
