# Intel advanced tuning feasibility

Read-only package power-limit discovery is now implemented for explicitly reviewed
Intel client models, using the existing signed module. The UI shows PL1/PL2,
enable/clamp flags, time windows and register lock, labelled as a reading captured
when hardware access connects. Reconnect to refresh. Missing/denied/invalid readings
remain unavailable. This has fixture coverage, not physical Intel validation.
Standard Intel Windows boost, EPP and frequency policies already exist. Direct
Intel package-power writes remain unimplemented.

Register layout/model references reviewed for this implementation:
- [Intel SDM volume 4](https://www.intel.com/content/dam/develop/external/us/en/documents-tps/335592-sdm-vol-4-testsize.pdf).
- [Linux v6.12 RAPL definitions/model registry](https://raw.githubusercontent.com/torvalds/linux/v6.12/drivers/powercap/intel_rapl_common.c).
- [Linux v6.12 Intel family identifiers](https://raw.githubusercontent.com/torvalds/linux/v6.12/arch/x86/include/asm/intel-family.h).

Only fixed reads0x606/0x610 are used. Core client encodings are selected by an
explicit family6/model allowlist; Atom-specific and unknown encodings are not
inherited. Watts are decoded independently for both limits, with disabled-zero
values left unavailable. A locked register remains readable; an unlocked register
does not imply write support. MSR limits may differ from MMIO/firmware constraints,
so these readings are not a claim of the effective overall performance ceiling.
Original implementation is MIT; no upstream driver implementation was copied.

## Existing backend constraint

`native/CpuPStates.cs` uses the pinned signed IntelMSR PawnIO module through
`ioctl_read_msr`. The matching reviewed source in
`.tools/dependencies/PawnIO.Modules-0.2.2-source.zip` at dependency commit
`e12a858d952461ee2e919897cacbff7f905fe370` exposes read operations only.
Its allowlist includes RAPL units, package power limit and package power info
registers (0x606, 0x610 and 0x614). It exposes no MSR write operation.
Changing app code or signing the app executable does not add that operation.

## Incremental implementation

1. Add capability-detected, read-only Intel power-limit decoding with exact
   reviewed processor mappings and units. Show sustained/burst limits, supported
   timing and lock information only when validated. No guessed AMD equivalents.
2. Present a shared Advanced CPU tuning section whose contents depend on verified
   capabilities. AMD Ryzen and Intel need separate controllers, ranges and labels.
   Unknown hardware should receive an explicit status, not writable dummy fields.
3. Before offering Intel writes, select and review a supported kernel-access
   backend/module that actually exposes the required bounded operation. Preserve
   its trust/signature requirements; do not weaken the existing module checks.
   Distribution and driver/module signing are separate from app signing.
4. Implement exact baseline capture, permission/lock checks, bounded changes,
   read-back, firmware-override reporting and verified rollback. Preserve unrelated
   register fields. Do not silently reapply limits in a continuous firmware fight.
5. Validate on actual Intel ThinkPads, with at least hybrid/non-hybrid coverage,
   AC/battery transitions, failures and recovery. Simulated tests alone cannot
   establish that a BIOS permits or honors the requested limits.

The existing service, private IPC, UI shell, policy controls and test infrastructure
are reusable. Direct-write transport and hardware validation are the larger work.
Scope should initially be package power limits, not voltage/multipliers or a
promise of fixed continuous boost. Other AMD processors likewise need their own
reviewed protocols; Ryzen SMU commands must not be sent to unrelated CPUs.
