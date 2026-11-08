# CPU clock readings

The main CPU clock and the speed-limit panel use the same telemetry selection.
When individual core sensors are available, the displayed value is the highest
raw core clock in the latest sample. The UI shows **CPU speed** in GHz with two
decimal places and the caption **Highest current core clock**. It is not a peak
recorded since opening the app. On Intel hybrid CPUs the selection includes both
P-cores and E-cores. Bus, memory, uncore, GPU and effective clocks are excluded.

Individual core speeds appear below the headline, with their sensor core labels
preserved (including Intel P/E core types) and natural numeric ordering. Missing
per-core readings are explicitly unavailable, never invented from an aggregate.
An expandable **Clock details** section retains its open state across refreshes.

Clock details shows **Average core speed**, calculated by adding
the raw speeds of the reporting cores and dividing by their count. It displays
that count so missing readings are not silently counted as zero. Individual
readings take priority over a separate aggregate sensor. When only the aggregate
sensor exists, its average remains available as a fallback.

**Idle-adjusted speed (effective)** is shown separately when available. It averages time
spent working and resting: a core at 3000 MHz for half a sample and asleep for
the other half averages about 1500 MHz effective. A low value is normal with
little work to do. Effective clocks are a different quantity from raw clocks;
zero is valid for an idle effective-clock reading. Missing readings stay
unavailable. An aggregate average is labelled as an average if no individual
cores or explicit maximum sensor is available.

Without hardware clock sensors, Windows' ProcessorFrequency counter can be
shown as a **Windows estimate**. Inventory CurrentClockSpeed/MaxClockSpeed values
are not presented as live clock measurements. Different tools may sample at
different times and over different intervals, so their current values need not
match exactly. Compare the same quantity and current-value column, rather than
comparing a current average with a recorded maximum.

Sensor names are taken from the pinned LibreHardwareMonitor source shipped in
the source notices: Amd17Cpu exposes Core #n, Cores (Average), and separate
effective sensors; IntelCpu exposes CPU Core/P-Core/E-Core sensors and Bus Speed.
The original selector is in src/cpu-clock.js. No new register access or clock
control is added by this telemetry change.

Boost and the maximum-frequency policy are separate controls that work together:
boost permits operation above rated speed, while the frequency policy limits
what Windows requests. No limit does not turn boost on. Firmware and power and
thermal constraints still determine the clocks reached.
