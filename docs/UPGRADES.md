# Fan configuration during upgrades

Setup validates the existing owned fan configuration before stopping the service
or replacing files. It migrates only firmware/curve mode, supported rising fan
curve rows and bounded sensor offsets onto the new engine template. Engine paths,
backend, hotkeys, manual watchdogs and secondary fallback tables come from the new
release. Firmware mode uses the new firmware-controlled defaults.

Manual or malformed configurations stop the upgrade before payload replacement.
Return to firmware or a valid saved curve and retry; the previous files remain.
An external fan service is not treated as an owned configuration to migrate.

The engine INI is excluded from the payload's blanket copy. After payload
installation, the prepared configuration is staged beside its destination and
atomically replaces it with an exact backup. Successful hardware setup removes
the backup. Interrupted/failed setup restores it before attempting to restart
the previously running owned engine. A previously stopped engine stays stopped.
Unfinished backup/candidate files block another upgrade, preserving recovery data.

Configuration tests exercise clean installs, curves/offsets, new safety defaults,
invalid data, failed commits and rollback without touching hardware. Real upgrade
evidence belongs in HANDOFF/artifacts until independently verified. CPU boost,
frequency policies and firmware power limits are not written by migration.
