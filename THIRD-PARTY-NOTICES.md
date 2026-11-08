# Third-party notices

- LibreHardwareMonitorLib 0.9.6: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor — Mozilla Public License 2.0, with dependencies under their respective licenses. Restored through NuGet. Review the resolved dependency licenses in `native/obj/project.assets.json` before redistributing the published bridge and its driver dependencies. Source files from LHM were not copied into this repository.
- TPFanCtrl2 2.5.1 is bundled under the Unlicense, with its exact source archive and license. Thanks to original TPFanControl author troubadix and maintainers ThinkPad-Forum, byrnes, Shuzhengz, FanDjango and mews-se. Protocol reference: https://github.com/mews-se/TPFanCtrl2/blob/878c8c0a751b4cce126d3b3b59dacf6268314239/fancontrol/sharedstate.h. The engine is rebuilt from that pinned source with our documented single-fan selector patch; original and modified sources, patch and build provenance accompany the executable; packaged configuration starts in BIOS automatic mode and forces the PawnIO backend.
- namazso's signed LpcACPIEC module from PawnIO.Modules 0.2.10 is bundled under LGPL-2.1. The matching source archive and license accompany the binary under `notices/fan-engine/`. See `third-party/README.md` for pinned source links, replacement information and full credits. The PawnIO driver itself is not redistributed; optional hardware setup downloads its official signed installer and verifies its pinned hash and trusted Authenticode signature before running it.
- Node.js built-in SQLite uses SQLite. The application has no npm package dependencies. Node.js and .NET runtime distributions carry their own notices; retain those notices when packaging runtimes.
- Desktop renderer: Microsoft.Web.WebView2 SDK 1.0.4022.49. The installed Microsoft WebView2 Runtime is a separate Microsoft component. SDK LICENSE and NOTICE files are included in the desktop package.
- Desktop packages bundle the installed Node.js runtime and self-contained .NET 8 runtime. Their redistribution licenses/notices, the matching Node source LICENSE, and LHM licenses/notices are included under `notices/`.
- Windows installer is built using Inno Setup 6.7.3 from the official signed vendor distribution. The compiler is a build tool; its vendor licensing applies to commercial builds. The compiler is not shipped inside the application.

Vendor and product names belong to their respective owners. This project is not affiliated with Lenovo, AMD, NVIDIA or the upstream hardware-monitor/control projects.

Additional matching MPL dependency sources and the older PawnIO.Modules source releases used by the sensor libraries/source archives are retained under notices/dependency-sources. See docs/DEPENDENCY-REVIEW.md and third-party/source-dependencies.lock.json for exact versions, hashes and source provenance. Signing a redistributed engine preserves its upstream license and authorship.

Thanks to FlyGoat/Jiaxun Yang and RyzenAdj contributors for documenting the Cezanne SMU table layout. Our independent decoder uses this interoperability information; RyzenAdj code and binaries are not bundled. See docs/THERMAL-SENSORS.md for the exact reference.


