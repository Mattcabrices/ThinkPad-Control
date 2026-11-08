# Fan curves and profiles

A fan profile is a name plus the temperature at which each of fan levels 1 to 7 starts. Profiles are on the **Cooling** page. Saving stores one; **Apply** saves any edits and makes it the running curve.

**Status: tested on one laptop, a T14s Gen 2 on AC.** Applying, switching profiles, running with the app closed, returning to firmware and the flat slot adjustment all worked there. Not tested: a reboot, recovery from a failed apply, a curve actually reaching maximum speed at the limit, battery, stepping up or down through levels with the adjustment in place, or any other model.

## How a curve runs

The bundled fan engine runs the curve as a Windows service, so it continues with the app closed and after a restart. Applying a profile needs hardware access, because the elevated worker changes the engine configuration and restarts the service. While the engine is stopped, it has returned the fan to firmware.

The worker checks the rows again, writes only the `Level=` and `Active=` lines, and waits for the engine to report the new mode. If that fails, it restores the previous configuration and says so.

**Use firmware control** returns to the installed default. An app update also replaces the engine configuration, which returns the fan to firmware until a profile is applied again.

## The firmware limit

Each laptop's limit is read from its own firmware, not assumed:

| CPU | Source | Note |
| --- | --- | --- |
| Ryzen | Thermal limit in the reviewed firmware table | The lower of the current value and the value seen at connection |
| Intel | `IA32_TEMPERATURE_TARGET`: TjMax less its offset | Read only. Engine setup is experimental on Intel ThinkPads; actual Intel curve behavior still needs hardware validation |

If no limit can be read, curves stay off and firmware keeps control.

## Rules

- At the firmware thermal limit, the fan runs at maximum speed (Level 10) to protect the CPU, and stays there until the temperature falls to level 7's start. This is the laptop's own limit, not the higher thermal junction limit.
- Level 7 starts below the firmware limit.
- Levels must rise with temperature, at least 1 °C apart, and can't start below 30 °C.
- If the fan may stop, level 1 must start by 65 °C.
- Level 7 is a regulated step and not the top speed. On a T14s Gen 2, level 7 read about 3800 RPM, and maximum speed read up to 5400 RPM.
- A saved profile that breaks these rules after the limit falls is marked and can't be applied until it's edited.

## Defaults

New installs start with two editable profiles, placed relative to the limit. These are starting points and haven't been tested for temperature or noise. At an 86 °C limit:

| Profile | Level 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Computer active | 55 | 61 | 66 | 71 | 76 | 81 | 85 |
| Server inactive (runs the fan sooner) | 45 | 51 | 56 | 61 | 66 | 72 | 78 |

"Computer active" was chosen to run at about level 2 around 60 to 65 °C, where firmware on the T14s read 2500 to 3100 RPM.

## How the engine moves between levels

A row applies from its temperature going up, and at or below it going down. So going up, level 3 starts at its own temperature, and going down, the fan drops to level 2 only at or below level 2's start temperature. That gap keeps the fan from switching back and forth. The fan stops 5 °C below level 1's start, if stopping is allowed.

## Level 10 / Boost mode

Level 10 is the fan's top speed: the controller's unregulated "disengaged" mode, sent to the engine as level 64. It's **not for long-term use**. The manual button on the Cooling page is meant for short, intensive work, ideally with Maximum boost on and a raised power limit, which it doesn't set for you. A curve also uses it automatically at the firmware thermal limit, to protect the CPU, and that keeps working with the app closed.

The manual button stays under the same protections as other manual levels: a 10-second lease, so it stops if the window is closed or minimized, plus the 78 °C manual exit and the 85 °C watchdog. On a T14s Gen 2 it read 4900 to 5400 RPM, against about 3800 for level 7, in runs under a minute from a cool start. Long runs haven't been tested.

There's no level 8 or 9. The controller has no steps between level 7 and this mode. Switching between the two was tried, and it swung between 3000 and 4900 RPM with an audible surge.

## Known limits

Sensor learning starts fresh when the app opens, after an engine configuration
change, and after a failed or successful curve request. It waits 15 seconds for
publication to settle, then requires a new two-minute observation window. Old
slot-history files are not reused: earlier versions could combine adjusted and
unadjusted values. Learned fan speeds and saved profiles are unaffected.

An existing configured sensor adjustment stays in place when fresh learning has
no conclusion. Applying another profile retains it. The app recommends removal
only after the same settled observation window shows at least 3 °C of movement
in that slot. No adjustment is added or removed automatically. Returning to
lasting firmware control clears adjustments, and a subsequent profile application
needs fresh observations before new adjustments can be recommended.

- The engine follows the hottest of its embedded controller sensors, not the CPU sensor shown in the app. These usually track closely, but not always.
- A sensor slot can sit at one value while the CPU moves, which stops a curve falling below that temperature's level. On a T14s Gen 2, slot 11 (index 10) read 65 °C while the CPU went from 70 to 52 °C, and a T14 Gen 3 slot read 66 °C. The engine's old label for this slot is "pwr", a power supply sensor, which isn't confirmed for these laptops. The app watches for this: a slot of at least 40 °C that moves no more than 1 °C, for at least 2 minutes, while the CPU moves at least 5 °C and another slot moves too. It then asks you to apply the profile again, and the engine reads that slot lower by a fixed amount, down to 35 °C at its flat value. It isn't hidden: if it really heats up, it can still raise the fan, but later than its true temperature would. A slot that starts moving prompts another apply, which removes the adjustment, but only while the app is open. While adjusted, the engine publishes the lower value, so the sensor list shows it too.
- Switching profiles is manual. Nothing switches on activity.
- Manual control still exits at 78 °C. With a curve set, it exits into the curve instead of firmware.
- **Return to firmware** on the manual panel lasts until the next engine restart. The curve returns after that, so use **Use firmware control** to make it lasting.
