# Contributing

Original contributions are MIT licensed. Retain upstream notices. Do not copy
third-party hardware code without reviewing its license and matching source.

Use Windows x64, Node 24.19.0 and .NET SDK 8.0.427. Download the official tools,
then run scripts/fetch-dependencies.ps1 and scripts/fetch-build-notices.ps1.
Run npm run check, scripts/build-native.ps1, scripts/build-desktop.ps1
(-SkipInstaller without Inno Setup), npm test and scripts/verify-release.ps1.
Create the source ZIP with scripts/package-source.ps1, then run
scripts/verify-archives.ps1 to compare both ZIPs against the current build inputs.
The Windows CI workflow follows these steps. Network access is required for
NuGet and pinned upstream downloads. No real hardware writes belong in CI.

`npm test` selects only `tests/*.test.js` and runs one test file at a time to keep
CPU use low. Keep manual hardware harnesses outside this
directory and invoke them explicitly only in an approved maintenance window.
Do not use unrestricted `node --test` discovery in a hardware-test workspace.

For actual desktop layout review after building, run
`./scripts/test-desktop.ps1 -CaptureScreenshots` in an interactive Windows session
with WebView2 available. It opens isolated Ryzen and Intel demos without UAC or
hardware access, capturing all seven pages plus CPU-tuning/fan-curve details at
1320×960 and 840×640 outer-window sizes. PNGs and viewport/overflow diagnostics
are written under the reported `artifacts/desktop-check-*` folder. Display
scaling affects CSS viewport size and is recorded in each capture's JSON.
The flag selects visual checks; run without it for the separate minimize/close/
reopen lifecycle checks. Normal startup never captures screenshots. Both
unattended modes refuse to run without an explicit demo profile.

For the installer, put the official Inno Setup 6.7.3 compiler in .tools/inno.
Review that compiler's licensing for your use. Signing credentials must stay
outside the source tree. CI uploads unsigned alpha artifacts, never releases.

Compatibility reports should include ThinkPad family/generation, machine type
(not serial number), CPU/GPU, Windows version, BIOS version, exposed sensors and
driver versions. Separate read-only telemetry results from manual-control tests.
Never infer motherboard temperature from an anonymous EC slot.
