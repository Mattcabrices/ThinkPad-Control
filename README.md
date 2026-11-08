# ThinkPad Control

An open-source Windows desktop controller for Intel and Ryzen ThinkPads: CPU/GPU telemetry, measured fan RPM, direct fan levels, AC/battery CPU boost controls and local history. Original code is [MIT licensed](LICENSE).

By **Matt Cabrices**. **0.4.0-alpha.26 is an unsigned development alpha. Hardware support is not yet certified on either target model.** The first targets are T14s Gen 2 AMD and T14 Gen 3 AMD. Other ThinkPads are detected by capability; no universal support claim is made.

Alpha.3 adds experimental Intel primary-fan setup, hybrid CPU energy preferences and per-class frequency restoration. Intel hardware validation is pending; see [Intel support and test plan](docs/INTEL-SUPPORT.md).

**Advanced CPU tuning adapts to Intel and AMD Ryzen processors.** AMD Ryzen
systems show the Ryzen power-limit controls, which require an exact reviewed
firmware-table mapping; unrecognized mappings stay unavailable. Intel systems
show their own capability explanation and retain the available monitoring and
Windows power-policy controls plus read-only PL1/PL2 settings on reviewed models
(captured at connection; reconnect to refresh). Direct Intel PL1/PL2, voltage and multiplier
tuning is not implemented; Intel never receives Ryzen SMU controls. Other AMD
processor families are outside this advanced-tuning scope.

Alpha.4 adds model-aware Intel ratio references and a simulated Intel GUI profile.
Run `npm run demo -- --demo-intel` for its browser preview, or launch the desktop
with `--demo-intel`. Both remain clearly labelled simulations with no hardware writes.

Alpha.5 verifies CPU/GPU rollback read-back and preserves pending Maximum boost
recovery targets across restart. The CPU page offers an explicit recovery action
when needed. See [policy recovery](docs/POLICY-RECOVERY.md).

Alpha.5 verifies CPU/GPU rollback read-back and preserves pending Maximum boost
recovery targets across restart. The CPU page offers an explicit recovery action
when needed. See [policy recovery](docs/POLICY-RECOVERY.md).

## Install

The local build produces `ThinkPad-Control-Setup-0.4.0-alpha.26-x64.exe` and a portable ZIP under `artifacts/releases`. Setup installs under Program Files with Start menu shortcuts and an uninstaller. Node and .NET runtimes are included. Microsoft WebView2 Runtime is required; setup links to Microsoft's download if it is missing.

The package **includes a source-built TPFanCtrl2 2.5.1 with our documented fan-selector patch** and its signed EC module. Setup installs hardware support automatically and configures its service. If PawnIO is absent, setup downloads its official signed installer and verifies its pinned hash and signature. An existing external TPFanControl service is left untouched and reported as a conflict. Firmware retains automatic cooling until you explicitly choose a manual fan level. Installation and selected controls have been exercised on the two target machines; clean-device installation, recovery and the complete validation matrix remain pending. See [observed results](docs/COMPATIBILITY.md).

Hardware access connects by itself when the app opens, with no UAC prompt each time. Setup registers an on-demand scheduled task, under its one approval, that starts a separate hardware worker. The worker exits when the app disconnects, and accepts only your Windows account and the app's bundled runtime. The interface runs without elevation. Windows application control can block unsigned alpha components; trusted signing is required for a public release. Do not disable Windows security features to run this build.

Minimizing sends the app to the tray and preserves manual fan control. Closing the window releases manual control to firmware; saved service curves continue. Choose Exit to stop the app. Uninstall removes the hardware worker task and the owned engine service; user history and the shared PawnIO driver remain. A portable copy does not install privileged hardware support from a user-writable folder.

Upgrades migrate validated fan curves and sensor adjustments onto the new engine
defaults, with a configuration backup and rollback. See [upgrade behavior](docs/UPGRADES.md).

## Capabilities

| Feature | Availability |
| --- | --- |
| CPU/GPU temperatures, loads and clocks | Sensors exposed through LibreHardwareMonitor and working driver access |
| Motherboard temperature | Named board/EC sensors only; anonymous slots are not relabeled |
| Fan RPM | Actual tachometer readings from TPFanCtrl2 or exposed LHM fan sensors |
| Direct fan levels 1–7 and firmware automatic | Compatible TPFanCtrl2 engine; fresh valid temperature readings required |
| AC/battery CPU boost policy | Windows processor policy with read-back and rollback |
| AC/battery CPU speed steps | Windows maximum-frequency policy on AMD and Intel; tested on the 5650U and 6650U on AC, with a 6650U cap discrepancy still under investigation. Hardware P-states are read-only. See [CPU speed steps](docs/CPU-SPEED-STEPS.md) |
| Independent integrated Radeon boost | Unavailable on these APUs |
| NVIDIA boost | Driver-gated legacy auto-boost property where supported |

Missing readings remain unavailable. Manual fan control uses a lease and thermal watchdog; these mechanisms do not replace physical crash, sleep and resume validation. See [compatibility](docs/COMPATIBILITY.md) and [release gates](docs/RELEASE.md).

## Build and test

Use Windows x64, Node 24.19.0 and .NET SDK 8.0.427 from their official distributions. For an installer, put Inno Setup 6.7.3 under `.tools/inno`. Review its licensing for your build use.

```powershell
./scripts/fetch-dependencies.ps1
./scripts/fetch-build-notices.ps1
pwsh -File ./scripts/build-fan-engine.ps1
./scripts/build-native.ps1
./scripts/build-desktop.ps1  # -SkipInstaller for a portable-only build
npm run check
npm test
./scripts/verify-release.ps1
./scripts/package-source.ps1
```

The Windows CI workflow builds unsigned alpha artifacts and runs isolated tests. It never publishes releases or performs hardware writes. All upstream fan-engine assets and matching source archives are pinned by SHA256 in `third-party/dependencies.lock.json`. Source packaging excludes local tools, telemetry, build outputs and private keys. Bit-for-bit reproducible builds are not yet established.

For GUI development: `npm run demo` starts a simulated dashboard at `http://127.0.0.1:47831`. No npm dependency installation is needed. `npm start` uses live telemetry and capability-gated controls. The native desktop embeds this same interface in WebView2; users do not need a browser or terminal.

## Architecture and source

| Directory | Purpose |
| --- | --- |
| `desktop/` | WinForms/WebView2 shell, tray and worker approval |
| `public/` | Renderer and desktop integration |
| `src/` | Loopback API, provider orchestration, SQLite schema/history and audit |
| `native/` | Privileged sensor/policy bridge, private IPC and fan watchdog |
| `native-tests/`, `tests/` | Isolated fan-protocol, API, policy, IPC and packaging tests |
| `installer/`, `scripts/` | Installer, dependency verification and build/release tooling |
| `third-party/` | Pinned dependency metadata and upstream attribution |
| `docs/` | Architecture, hardware limits and validation/release requirements |

[System architecture and database schema](docs/ARCHITECTURE.md) · [Desktop guide](docs/DESKTOP.md) · [Release plan](docs/RELEASE.md) · [Signing setup and one-month option](docs/SIGNING.md) · [Dependency review](docs/DEPENDENCY-REVIEW.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Thanks

ThinkPad Control is created by **Matt Cabrices**. Thanks to **troubadix**, original TPFanControl author, and **ThinkPad-Forum, byrnes, Shuzhengz, FanDjango and mews-se** for continuing the fan-control work; **namazso** for PawnIO and its EC module; and the **LibreHardwareMonitor contributors** for sensor access. This app combines their work with a desktop interface and capability-aware controls.

Bundled components retain their own licenses. Packages include upstream notices and matching TPFanCtrl2/PawnIO.Modules source archives. See [full attribution](third-party/README.md) and [third-party notices](THIRD-PARTY-NOTICES.md). This project is not affiliated with Lenovo, AMD, NVIDIA or these upstream projects.



Advanced Ryzen tuning: the CPU & power page now includes direct SMU controls selected by reviewed Ryzen family and firmware-table capabilities across Lenovo ThinkPads. See [tuning details](docs/RYZEN-TUNING.md) for support, limits, verification and baseline semantics. Zero EC tachometer readings are explicitly marked as unconfirmed rotation; the intermittent firmware-mode zero issue remains under investigation.


The exact Ryzen support matrix is documented in [compatibility](docs/RYZEN-COMPATIBILITY.md). Building the patched fan engine requires PowerShell 7, Microsoft C++ v143 and Windows SDK 10.0.26100; run scripts/build-fan-engine.ps1 before the desktop build. Original and modified fan-engine sources and build provenance ship in the package. Local continuation notes and raw host journals are excluded from public source.
