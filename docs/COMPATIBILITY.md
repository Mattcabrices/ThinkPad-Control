# Hardware compatibility and release checklist

| Feature | T14s Gen 2 AMD / T14 Gen 3 AMD | Other ThinkPads |
| --- | --- | --- |
| Windows CPU AC/battery boost | Implemented through standard Windows power policy; read-back required | Capability detected |
| CPU temperature / load / clocks | LHM bridge; readings require working driver access | Exposed sensors only |
| Radeon telemetry | LHM bridge, missing sensors remain unavailable | AMD / NVIDIA / Intel hardware detected |
| Motherboard temperature | Only named LHM board/EC hardware sensors; not assumed from CPU or anonymous EC slots | Exposed sensors only |
| Fan RPM | TPFanCtrl2 tachometers or LHM Fan sensors | Validated engine configuration required |
| Direct fan levels 1–7 | Implemented optional TPFanCtrl2 shared-state client | Model compatibility inherited from engine, not certified here |
| Fan percentages | Only LHM-discovered fan IControl objects | Explicit ID allowlist required |
| Independent Radeon GPU boost | Not available | Not available for AMD / Intel |
| Independent NVIDIA boost | Not applicable to Radeon-only systems | Legacy default auto-boost property only, driver gated |

Target models are not claims of certified compatibility. The following observations supersede the earlier unelevated discovery checks. Missing or unidentified sensors remain unavailable.

For the alpha.34 T14s Gen 2 Turbo activation and verified restoration after one
retry, see [current validation results](RELEASE-VALIDATION.md). This short check
does not establish sustained performance or Turbo support on other models.

| Machine and tested build | Observed on hardware | Still open |
| --- | --- | --- |
| T14s Gen 2 AMD, Ryzen 5 PRO 5650U; alpha.2 installed | Elevated PawnIO access; CPU and APU GFX temperatures; ACPI thermal zone; real tachometer readings and manual fan control; Windows power policies; fast/slow/thermal SMU changes and restoration; read-only P-states | Audible fan versus zero RPM, cancelled/approved reconnect, battery behavior, full recovery matrix. Sustained limit is read-only after both reviewed routes were ignored. |
| T14 Gen 3 AMD, Ryzen 5 PRO 6650U; alpha.1 tested | Installation and driver access; CPU temperature; P-states; fast/slow/thermal SMU changes and restoration; policy read-back; manual fan level 4 around 2640 RPM and firmware return | Alpha.2 retest, independent GPU core temperature, audible fan versus zero RPM, 1600 MHz cap overshoot, sustained-limit fallback, battery/recovery matrix. |

The T14 Gen 3 alpha.1 reading named `GPU VR SoC` is a voltage-regulator sensor, not a GPU core temperature. Alpha.2 excludes it from the GPU temperature card. The T14s uses a separately mapped APU GFX reading. Anonymous EC slots and the ACPI thermal zone are not proof of a motherboard sensor's physical location.

See the model observations above, [CPU speed steps](CPU-SPEED-STEPS.md), and the isolated test suite. Protocol fixtures for other CPU families establish routing and refusal behavior; they do not prove firmware accepts writes on those machines.

TPFanCtrl2 reference layout is `mews-se/TPFanCtrl2/fancontrol/sharedstate.h`, Git blob `a06b26663fa449b9232755a7633eb62de50e2368` (7796 bytes for FCSHARED). There is no protocol version field; validate layout against an exact engine build before enabling it. This implementation opens an existing mapping; it never creates a real engine mapping. Isolated native tests create a uniquely named Local test mapping, not the Global hardware mapping.

Before broad release:

- Verify correct EC backend, model configuration, fan/RPM mapping, firmware ownership and temperature-slot validity on both target machines.
- Exercise physical AC/battery boost read-back and rollback under permission errors and concurrent power-plan changes.
- Validate both tachometers, BIOS mode, levels 1–7, temperature fail-safe, UI close, API crash, native crash, service crash, sensor loss and reboot.
- Test lid close, sleep, resume, hibernation, docking and power-source changes. Restore firmware before suspend in an installed service.
- Validate the implemented exact service-path and engine/module hash checks. Detect competing controllers beyond the fixed service-name conflict; stop other control clients for this alpha.
- Validate pinned engine 2.5.1 against real EC readings; review the upstream global shared-memory ACLs and concurrency behavior.
- Validate the implemented UI/worker separation and installer/uninstall paths; complete trusted signing and physical recovery tests. See RELEASE.md for current deployment gates.

No direct EC register probing or firmware assumptions are made by this code. It cannot promise universal ThinkPad control: model firmware and drivers remain part of the support contract.

