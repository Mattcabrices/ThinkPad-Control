# Capturing an unreliable RPM reading

Use the running, reviewed bundled TPFanCtrl2 service. From a PowerShell terminal
in the source directory, run:

```powershell
./scripts/read-fan-diagnostics.ps1 -OutputPath ./fan-diagnostics.json
```

The default capture takes about 22 seconds. It reads shared memory with read-only
access and never submits a command, changes fan mode, reads new EC addresses,
starts a service or requests elevation. If access is denied or the service is
absent, it fails explicitly. An audible-fan observation must come from someone
physically at the laptop during the capture. Note whether it is audible before,
during and after the samples, and which ThinkPad model was used.

The JSON includes the engine sequence, command/acknowledgement counters, raw
mode/level, both primary tachometer bytes, decoded RPM, freshness and the first
anonymous EC temperature slot. It excludes computer/user names and identifiers.
Check the file before sharing it alongside any separate model details.

Freshness starts false until a sequence change is observed, and becomes false
after 12 seconds without another update. `currentRpm` is null while freshness is
unconfirmed; `rawRpm` still exposes exactly what the engine published. A fresh
zero means the engine published zero tachometer bytes. It does not prove that the
fan is physically stopped. Invalid bytes remain null. The upstream protocol has
no transaction marker around its write, so the sequence check is best-effort.

On the T14s Gen 2 server, the owner heard the fan while the GUI displayed zero.
A later read-only capture with the app closed observed advancing engine sequences
and zero tachometer bytes. These observations narrow the issue below the display
layer but do not establish its cause. Firmware behavior, EC acquisition and other
hardware-monitor software remain possible factors. No alternate registers or
cached positive readings are substituted. A supervised comparison during manual
levels and firmware automatic mode has since been captured without anyone listening,
with HWMonitor running. It read no zeros at 60 to 65 °C. Readings were all multiples
of 100, and levels 4 and 7 both settled at 3800 RPM, so this laptop's reading may be
coarse or capped. Comparing zero counts with HWMonitor closed, while someone listens,
is still pending.

This source utility is separate from the alpha.6 compiled payload. It uses the
same reviewed 7796-byte shared-state layout as the app and is not a general client
for arbitrary fan-controller versions.
