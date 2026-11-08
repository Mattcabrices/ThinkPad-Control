# Turbo

Turbo coordinates existing controls in one action with a saved restoration record.
Alpha.30 introduces it experimentally. Installed Turbo hardware validation is
pending; the alpha.29 fan-handover test does not certify this new feature.

## Activation

The backend reads current capabilities, power source and actual settings. It
requires a readable CPU policy, temperatures below the manual cutoff and writable
Max fan control. Begin in firmware mode or a saved curve matching the running
configuration. Return existing manual control or an unmatched curve to firmware
first, or save/apply the curve normally.

Before writing, Turbo captures recovery data. It then requests and verifies:

1. Max fan.
2. No CPU frequency cap for the current power source, including both processor
   classes on supported hybrid Intel CPUs.
3. Maximum boost for that power source.
4. Reviewed maxima for explicitly writable Ryzen wattage fields. Read-only fields
   are skipped and explained in the GUI.

Only a verified combined result is shown as **Verified active**. The CPU
temperature limit, manual fan cutoff and independent GPU boost are unchanged.
Intel direct wattage controls stay read-only. The opposite source's Windows
policies are untouched; Ryzen firmware limits and cooling are device-wide.
Ceilings come from worker/provider capabilities, never arbitrary UI values.
Firmware still governs actual clocks and sustained wattage: continuous boost or
higher measured power is not guaranteed.

## Restoration and interruptions

**Restore previous settings** restores affected policies, captured wattages and
the previous fan mode. Distinct hybrid frequency/EPP values are preserved. Saved
curves return with their original thresholds and masks; saved profiles are not
edited. Other tuning controls stay locked until restoration. **Return to firmware**
remains available; the recovery action remains available on every tab.

Activation failure attempts verified restoration. Failed or unverified restoration
keeps recovery data and reports the problem. A changed Windows plan is never
automatically switched back: return to the original plan before retrying. A
different device identity or invalid record refuses recovery/activation rather
than guessing. Only settings Turbo attempted to change are restored; unrelated
Windows settings are left alone.

Minimizing retains manual cooling through the native lease/watchdog. Closing,
connection loss or the manual cutoff releases manual cooling to firmware.
**Power settings remain until restored.** Startup, power-source changes and
firmware overrides never automatically enable or reapply Turbo. An interrupted or
restarted session shows restoration pending, not verified active. Restore before
another activation.

Long activations renew cooling only while the requesting UI has a fresh lease.
The independent worker watchdog remains authoritative. Recovery records are
atomically replaced in the local data directory, with separate live and Ryzen/
Intel demo files. They capture actual pre-Turbo values, not factory defaults.

## Tests

`tests/turbo.test.js` covers Intel/Ryzen, AC/DC isolation, read-only fields, existing
Maximum boost, saved curves, partial/ignored writes, rollback/retry, restart and
corrupt-file recovery, device/plan/source changes, UI lease loss/renewal, API audit
and failed post-activation snapshots. UI tests cover the restore action and honest
capability messages. These use simulations or in-memory runners.

For an approved installed test, capture real policies, every Ryzen limit, the fan
configuration and saved profiles. Use a short session, verify actual read-back,
restore, then compare with the capture. Do not infer sustained performance gains
from accepted limit requests or simulate hardware certification with a demo.
