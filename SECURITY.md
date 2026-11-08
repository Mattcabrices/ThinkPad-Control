# Security

Report exploitable issues through the repository's private security advisory
channel when available. If private reporting is unavailable, open an issue asking
for a private contact method without publishing the exploit details. Do not include serial numbers,
personal paths, credentials or telemetry databases in public issues.

The UI and localhost API run without elevation. Hardware commands use an
explicitly approved worker and a private named pipe. TPFanCtrl2 is a separate
SYSTEM service installed only under Program Files. An existing external service
is never overwritten. The installer leaves the shared PawnIO driver installed
when removing this app.

Unsigned alpha builds may be blocked by Windows application control. Do not
disable Smart App Control, Secure Boot, Memory Integrity or driver enforcement
to use this application. A trusted release must pass signature checks and the
physical-device validation described in docs/RELEASE.md.
