# Redistribution review — November 5, 2026

Original application code remains MIT. The following components retain their own
licenses. This records an engineering review of the pinned package metadata and
upstream sources, not a blanket endorsement of future dependency versions.

| Component | License / retained material |
| --- | --- |
| TPFanCtrl2 2.5.1 | Unlicense; original executable, modified BIOS-start configuration, exact source archive and full credits |
| LpcACPIEC module shipped beside TPFanCtrl2 | LGPL-2.1; exact PawnIO.Modules 0.2.10 source and license |
| LibreHardwareMonitorLib 0.9.6 | MPL-2.0; exact NuGet-declared source commit archive and license |
| BlackSharp.Core 1.0.7 | MPL-2.0; exact NuGet-declared source commit archive and license |
| DiskInfoToolkit 1.1.2 | MPL-2.0; exact NuGet-declared source commit archive and license |
| RAMSPDToolkit-NDD 1.4.2 | MPL-2.0; exact NuGet-declared source commit archive and license |
| LHM's twelve embedded PawnIO modules | Binary hashes match official PawnIO.Modules 0.2.2 release; matching source archive included |
| RAMSPDToolkit source archive's three PawnIO binaries | Binary hashes match official PawnIO.Modules 0.1.6 release; matching source archive included. The shipped NDD DLL has no embedded module resources |
| HidSharp 2.6.4 | Apache-2.0; complete package license including copyright retained |
| Mono.Posix.NETStandard 1.0.0 | Package's official license link resolves to Mono's license; full pinned Mono license and package copyright/metadata retained |
| Microsoft System libraries | MIT; package notices and source repository/commit metadata retained |
| Node.js 24.19.0 | Distribution license and bundled dependency notices retained |
| .NET runtime | Distribution license and third-party notices retained |
| Microsoft.Web.WebView2 SDK | Microsoft SDK license/notice retained; WebView2 Runtime remains a separately installed prerequisite |
| PawnIO driver | Not redistributed; optional setup fetches the official signed installer after explicit installer task selection |
| Inno Setup and Microsoft signing tools | Build tools, not bundled into the app; their own tool-use licensing applies |

`third-party/nuget-inventory.json` records resolved packages and source metadata.
It includes restored build/non-Windows assets, not a claim that every listed file
is shipped. `source-dependencies.lock.json` pins the additional source/license
downloads. Those archives are shipped under notices/dependency-sources. The fan
engine's original lock/source pair remains under notices/fan-engine.

`lhm-module-provenance.json` and `ram-module-provenance.json` record exact SHA256
matches against the official module release archives. No modules were loaded to
perform this comparison. The actual win-x64 LHM DLL resources were parsed without loading the assembly; all twelve module hashes match the recorded source-release mappings. The RAMSPDToolkit-NDD DLL has no embedded module resources, but its full source archive contains three older module binaries, so their corresponding source is also retained. LHM's module source version differs from TPFanCtrl2's;
shipping only the fan engine's newer source archive would miss that distinction.

MPL library source has not been modified. Signing a redistributed executable
does not relabel its upstream authorship. The LGPL modules remain unmodified and
their source/license and recipient modification rights are preserved. Future
changes to library/module versions must update these source mappings, license
material and hashes before release. Review native/runtime notices again after
dependency upgrades and before publishing a final signed build.

Official sources are identified by exact commit URL in the lock files and NuGet
inventory. Module releases: https://github.com/namazso/PawnIO.Modules/releases
Mono's official NuGet license link: https://go.microsoft.com/fwlink/?linkid=869050

