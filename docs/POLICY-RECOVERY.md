# Power-policy recovery — alpha.5

CPU and GPU policy commands verify the stored policy they change. This is not a
measurement of achieved clock speed: Windows, drivers and firmware still select
actual performance.

## CPU rollback

If a CPU boost, Maximum boost or frequency change fails after an attempted write,
the app requests the original values for every attempted source/class. It then
reads them back. A successful command exit alone no longer counts as recovery.
Ignored restoration, unavailable reads and detected active-plan changes are
reported as **incomplete or unverified**, rather than claiming restoration.

Recovery writes name the original plan. If the app detects another active plan
before recovery activation, it leaves that plan active and reports that the old
plan's restoration could not be verified. This is detection, not an atomic lock
against other power-management applications. Do not run competing controllers.

The privileged worker's CPU boost path performs the same recovery read-back.
Maximum boost and speed controls also verify hybrid class-1 preferences/limits.
Non-hybrid systems retain their existing class-1 settings.

## Maximum boost recovery record

`max-boost-baseline.json` stores the recovery target before either applying or
restoring Maximum boost. A pending flag remains if the operation and rollback
cannot be verified, or if the process exits before finalizing the record.
Re-enabling Maximum boost is refused while recovery is pending, so it cannot
overwrite the original saved preferences with a partially changed state.

The CPU page shows **Finish boost recovery** for the affected power source even
when its combined Maximum boost state reads off. This explicit action restores
and verifies the saved target. A plain CPU boost command finishes pending
preference recovery before applying its requested mode. Recovery targets are
never applied automatically on startup, reconnect or power-source change.

The pending record survives restart. If an operation fails but rollback is
verified, the previous recovery record is retained. If policy application
succeeds but the final metadata write fails, the result says the verified settings
are in effect and the recovery record remains pending. An unwritable initial
record refuses the operation before policy writes.

A failed repair can return to the partial state observed before that repair.
Its message explicitly says the saved recovery target is still pending; this is
not presented as completing the earlier recovery. Unsupported current boost
indices/preferences refuse capture before enabling Maximum boost.

Older records without class-1 preferences retain the earlier migration behavior.
When an original baseline is missing/corrupt, the existing explicit fallback is
standard boost (mode 1, preference 50), and the result says the original values
were unknown. A persisted fallback is marked as unknown; a retry does not present
it as the original owner preference. Already-on and already-off requests remain
no-ops when no pending recovery exists.

The compatibility report exposes pending flags, not the saved file's contents.
Frequency and plain-boost rollback are verified within the request; they do not
gain a new cross-restart recovery journal. Interrupted operations still require
review of their audit entry and current settings.

## NVIDIA legacy default auto-boost

For an exposed legacy NVIDIA default auto-boost property, capture its current
default immediately before a write. Refuse when that value is unknown. If the
write or verification fails, request the captured default and verify it again.
Failure to verify restoration stays explicit. Queries and writes remain scoped
to the same GPU UUID. The privileged worker still resolves NVIDIA's executable
only from its trusted installation paths.

This does not add Intel/AMD GPU boost control, clocks, voltage or a new NVIDIA
tuning interface. Most modern drivers may leave this legacy feature unavailable.
GPU recovery is bounded to the request; no startup reapplication is added.

## Validation limits

Isolated Node and native tests inject command results and in-memory policies.
They cover ignored restoration, partial writes, failed reads, plan changes,
separate hybrid preferences, restart recovery, unknown GPU defaults, and the
pending-recovery UI action. Tests do not issue real policy writes. Physical
driver failure, crash/reboot recovery and Intel hardware behavior still require
the supervised validation matrix in [release gates](RELEASE.md).
