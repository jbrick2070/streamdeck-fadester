# Experimental Mac shortcut input

This unpublished component receives only the canonical Fadester shortcuts that
Mac TourBox Console emits. It uses Carbon `RegisterEventHotKey`, not an event tap,
global keyboard recording, HID ownership or an Accessibility injection API. It
does not inspect arbitrary keys, touch TourBox USB/forwarding state, connect to OBS,
or change security settings. Registration is explicit and separate from building.

The intended Mac preset uses **Control+Option+Shift**, with no Command modifier.
The semantic map retains `Ctrl+Alt+Shift` spelling; this component translates those
names to native Carbon modifier flags and known ANSI/F1..F12 key codes. Use the
verified Mac preset, not an unchanged Windows binary preset. Non-US keyboard
layouts and actual Console delivery remain live validation tasks.

## Build and synthetic checks

```sh
cd tourbox/macos/input
/bin/bash build.sh
"build/Fadester Mac Shortcuts Experimental.app/Contents/MacOS/FadesterMacShortcuts" \
  --self-test --map ../../presets/map.json
dotnet run --project tests/InputChecks.csproj -c Release
python3 tests/open-pipe.py "build/Fadester Mac Shortcuts Experimental.app/Contents/MacOS/FadesterMacShortcuts"
```

These commands do not register shortcuts or observe hardware. Swift tests parse
all 47 unique canonical actions and simulate old/future/pre-arm events. C# tests
compile the real transport and verify its strict event parser.
The open-pipe check invokes a synthetic echo mode using the production bounded
stdin reader, verifies immediate LF/CRLF responses while stdin stays open, and
checks QUIT without relying on EOF. It never registers a shortcut.

## Private protocol

Explicit runtime launch (not performed by the tests):

```text
FadesterMacShortcuts --listen /absolute/path/to/map.json
```

The helper registers all unique chords with `kEventHotKeyExclusive`, then emits `INPUT_READY <count>`. A
collision or unsupported registration releases every chord already acquired and
fails startup. No partial mapping is accepted. It starts disarmed; registered
chords are consumed but no action event is emitted until the host arms it.
The installed Apple SDK's `HIToolbox/CarbonEvents.h` documents that the default
zero options can notify multiple apps, so that nonexclusive default is not used.

The parent writes one command per line:

```text
ARM 1
DISARM
ARM 2
QUIT
```

Acknowledgements are `INPUT_ARMED 1`, `INPUT_DISARMED`, and `INPUT_ARMED 2`.
Generations must strictly increase. On a registered shortcut callback the helper
emits exactly:

```text
event 2 1793912345678 fader.forward
```

The timestamp retains the Carbon OS event's age at its callback, rather than the
later forwarding time. Events older than 1500 ms, from before the current ARM,
or with invalid future times are dropped. The host **must additionally preserve
the Windows 180 ms rotary cutoff**, non-rotary 1500 ms expiry, generation check at
dispatch, and bounded queue. No timestamp may be refreshed during forwarding.
The helper is deliberately not configured with repeat suppression that could
drop closely spaced rotary shortcut sequences.

EOF, QUIT or protocol failure unregisters every shortcut. No application focus,
permission prompt or OBS cleanup write is issued. The app has a separate,
ad-hoc-signed experimental bundle identity and is not a product release.

## Optional C# transport

`MacShortcutInput(appPath, mapPath, Action<MacShortcutEvent>)` exposes `Start(token)`,
`Ready`, `Done`, `ArmAsync(generation)`, and `DisarmAsync()`. The event record fields
are `Action`, `Generation`, and `UnixMs`. This source is not wired into the host
automatically. A future host can link it explicitly under `--input-app`.

Authenticate OBS and complete the read-only native-slider warmup before ARM.
Immediately invalidate the host's current generation on disconnect, then DISARM;
old buffered events retain their previous generation. After reconnect, use a new
generation. Treat helper exit, registration failure or unexpected protocol output
as input failure, never as permission to substitute another input mechanism.
The launcher removes OBS password environment variables before spawning the helper.
