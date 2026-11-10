# ThinkPad Control for Windows

This package is an unsigned development preview. Hardware availability depends on your ThinkPad, firmware and drivers; it is not certified for every model. Normal operation needs no account, browser tab or terminal.

## Install and connect

Run the installer for Start menu shortcuts, automatic hardware setup and uninstall support. It requests administrator approval and installs under Program Files. Node and .NET runtimes are included. WebView2 Runtime is required; setup links to Microsoft's download if absent.

Setup registers an on-demand hardware worker task and configures the bundled source-built TPFanCtrl2 engine. If PawnIO is missing, setup downloads its official signed installer and checks its hash and signature before running it. Temporary download failures are retried; setup stops if verification fails. Initial setup may need internet access. An existing external TPFanControl service is reported as a conflict and is not replaced.

Open the app. Hardware access connects through the installed task for the Windows account recorded during approved setup, without a UAC prompt on each launch. Another account or an unavailable task may need approval again. The interface normally stays unprivileged; a separate worker handles permitted hardware operations through private IPC. If setup fails, review the GUI diagnostic and hardware-setup-error.txt in the installed folder. App > Settings offers Repair hardware support. A pending reboot needs a normal Windows restart before retrying; setup does not certify sleep/recovery behavior.

A portable copy must remain in its complete extracted folder. It does not install a SYSTEM service from a user-writable directory. If the installed task is unavailable, Enable hardware access may ask through UAC. Unsigned components can be blocked by Windows application control. Do not disable security features to run this preview.

## Read your hardware

Overview shows CPU/GPU temperatures, clocks, power and fan RPM where exposed. All sensors provides detailed readings and session Min/Max. The CPU headline is the fastest sampled core when per-core telemetry is available; individual cores are listed separately. Any Windows-counter fallback is labelled as an estimate. Tools using different sampling intervals may show different values.

Unavailable sensors stay unavailable. A firmware thermal zone is not a confirmed motherboard sensor, anonymous EC slots are not relabelled, and GPU VR SoC is not a GPU core temperature. Zero RPM means the tachometer reported zero; it does not prove the fan stopped. Integrated Radeon has no independent boost control on the target APUs. GPU controls depend on the driver.

## Control cooling

Cooling offers firmware automatic mode, supported manual fan levels and Max cooling, and saved temperature curves. The bundled configuration uses the primary fan; a second physical fan needs separate validation. Review the selected temperature cutoff before manual use. In alpha.35, levels 1–7 return to firmware at the cutoff; Max cooling stays at Max as temperatures rise. Lost connection or invalid telemetry still releases Max. LHM percentage controls retain their 85°C cutoff. This does not raise the processor's thermal limit.

Save a curve to keep it as a profile. Apply profile activates the saved curve; Save and apply commits edits and activates them. A saved service curve can continue after the window closes. Existing valid sensor adjustments are retained while fresh learning is incomplete; recommendations do not apply themselves. Firmware mode removes active curve corrections.

- Minimize hides the app to the tray and preserves manual fan control while its lease and temperature checks pass.
- Close window releases owned manual fan control to firmware. It does not stop an active saved service curve.
- Double-click the tray icon to reopen. Exit stops the app and its owned background processes.

The lease/watchdog is a protection mechanism, not proof of recovery from every firmware, driver, crash or suspend failure. Physical recovery validation remains incomplete.

## Coordinate CPU controls

Processor boost permits clocks above the normal range. CPU speed limit caps what Windows requests; No limit does not turn boost on. Maximum boost enables boost and favors performance while keeping the selected speed cap. AC and battery policies are separate.

Advanced CPU tuning adapts to the processor. Reviewed Ryzen mappings expose verified power/temperature fields; unsupported or ignored fields stay read-only. Intel PL1/PL2 readings are read-only. Raising a requested limit does not guarantee higher sustained power or clocks. Restore baseline uses the value observed when the hardware worker connected, not a factory default. Reconnect after changing AC/battery source before Ryzen tuning.

Experimental Turbo saves the current settings, requests Max fan, removes the current-source speed cap, enables Maximum boost and raises only supported Ryzen wattage fields to reviewed ceilings. It leaves temperature limits unchanged. Use Restore previous settings to recover the captured policy, wattages and fan mode. If restoration fails, the recovery action remains available.

IMPORTANT: closing, connection loss or invalid telemetry releases manual cooling to firmware, but Turbo power settings remain until restored. Startup never enables Turbo automatically. An interrupted session shows restoration pending. Other tuning controls remain locked until restoration; Return to firmware stays available. Alpha.34 activated on the T14s Gen 2; Restore needed one retry and then passed independent verification. Alpha.35 subsequently passed a bounded hot run with Max held through 87.125°C and Restore succeeding in one attempt. See [validation results](RELEASE-VALIDATION.md).

Windows power policies and firmware power-limit requests may persist after exit. Closing the app is not a reset of those settings. Firmware still makes the final performance decision; continuous boost is not guaranteed.

## Data, removal and credits

Data and the isolated WebView profile live under %LOCALAPPDATA%\ThinkPadControl. Uninstall removes the owned engine service, worker task and application files while preserving user data and the shared PawnIO driver. Upgrades migrate validated curves and adjustments with a backup.

For licenses, credits, matching upstream sources and the fan-engine patch, see the notices folder. Original app code is MIT licensed. Project source and current support details: https://github.com/Mattcabrices/ThinkPad-Control
