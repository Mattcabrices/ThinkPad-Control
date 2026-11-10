# Turbo

Turbo coordinates existing controls in one action with a saved restoration record.
Alpha.30 introduced it experimentally. The first installed alpha.33 attempt
aborted with an app-connection lease error; automatic rollback and independent
restoration checks passed. Alpha.34 subsequently activated on the T14s Gen 2;
restoration required one retry and then passed independent verification.
See [current validation results](RELEASE-VALIDATION.md) for the exact scope.

Alpha.34 publishes actual intermediate worker readings during activation so a
long transaction does not hide fresh telemetry from the desktop's connection
check. This does not manufacture fresh timestamps or renew the UI lease: a
disconnected UI still times out, and a lease lost during a reading aborts before
the next write. Isolated regressions cover connected and disconnected clients;
an installed check verified 40 W burst / 30 W average limit read-back and Max fan.
Measured CPU power was about 25–27 W during the short check, not 40 W sustained.

That check exposed coupled firmware readings: changing the writable burst limit
also changed the read-only sustained-limit reading. The first Restore tried the
read-only value too early and retained recovery even though the writable restore
returned all limits to baseline. A Restore retry verified and cleared recovery.
Source now restores attempted writable fields first, then verifies the other
readings; a genuinely unrecovered read-only value still retains recovery. This
follow-up fix is not in the installed alpha.34 binary and needs installed testing.

## Activation

The backend reads current capabilities, power source and actual settings. It
requires a readable CPU policy, temperatures below the manual cutoff and writable
Max fan control. Begin in firmware mode or a supported running curve. Alpha.32
also captures custom curves that do not match a saved profile, using the exact
thresholds and sensor adjustments read from the engine. Saved profiles are not
created or edited. Unknown table formats and curves needing sensor-adjustment
review remain blocked; apply a supported curve or return to firmware first.
Existing manual control must also be returned before enabling Turbo.

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

Turbo leaves these requests in place for demanding work until restoration or a
firmware override. It does not repeatedly fight firmware limits. The displayed
App maximum is the reviewed writable ceiling exposed by the provider, not a
verified silicon maximum. If sustained power is read-only on a laptop, Turbo
cannot raise that limit even when its burst and average limits are writable.

## Restoration and interruptions

**Restore previous settings** restores affected policies, captured wattages and
the previous fan mode. Distinct hybrid frequency/EPP values are preserved. Saved
and supported custom curves return with their original thresholds and masks;
restoration verifies actual engine values rather than a profile name. Saved
profiles are not edited. Other tuning controls stay locked until restoration. **Return to firmware**
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
Maximum boost, saved/custom curves, exact row/mask recovery, partial/ignored writes, rollback/retry, restart and
corrupt-file recovery, device/plan/source changes, UI lease loss/renewal, API audit
and failed post-activation snapshots. UI tests cover the restore action and honest
capability messages. These use simulations or in-memory runners.

For an approved installed test, capture real policies, every Ryzen limit, the fan
configuration and saved profiles. Use a short session, verify actual read-back,
restore, then compare with the capture. Do not infer sustained performance gains
from accepted limit requests or simulate hardware certification with a demo.
