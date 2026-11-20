# Mac action host

`FadesterMacHost` connects the shared `DeskActions`, audio/mix controllers and
`StudioFader` to the Mac native T-bar adapter (Fadester Companion T-bar.app). It is a
command-line host that Fadester Companion.app starts; it has no user interface of its own. Shortcut registration is optional and requires
an explicit input-helper argument. It does not import TourBox presets, change
permissions or launch OBS. Actual TourBox-to-host shortcut delivery and the complete
Mac workflow still need live validation.

Build and run synthetic checks from the repository root with .NET 8:

```sh
dotnet build tourbox/macos/host/FadesterMacHost.csproj -c Release
dotnet run --project tourbox/macos/host/FadesterMacHost.csproj -c Release -- --self-test
python3 tourbox/macos/host/tests/open-pipe.py dotnet tourbox/macos/host/bin/Release/net8.0/FadesterMacHost.dll
```

The checks use synthetic input and native callbacks, production shared action
logic, and an authenticated fake OBS server on a private loopback port. They
never inspect the installed OBS configuration, launch the native helper, request
Accessibility permission, register shortcuts or operate real OBS. Passing them
does not establish native Mac endpoint behavior or hardware compatibility.

The subprocess pipe regression invokes the isolated `--self-test-stdio` mode. It
uses the production bounded stdin reader and ingress, but only echoes accepted
commands: it never dispatches actions or accesses config, OBS, AX or shortcuts.
It checks replies before EOF for LF, CRLF and fragmented lines; malformed input,
overflow recovery and generation rejection; `quit` while the pipe remains open;
and discard of a final unterminated command. Pass a published executable in place
of `dotnet ...dll` to check that exact artifact.

Verified November 4, 2026 on the rented Apple Silicon Mac (macOS 27.2,
.NET 8.0.33): this project compiled with zero warnings or errors, and both the
source-run and published self-contained ARM64 executable passed `--self-test`.
The checks did not launch the native helper or connect to real OBS.
The production stdin open-pipe regression also passed on Windows and on that
published ARM64 Mac executable. Fixed/numeric `READY`, `DISARMED` and `STOPPED`
control frames bypass human-log redaction; a regression verifies that a short
password such as `1` cannot corrupt the connection generation. Human Activity
text still redacts the credential.

A separate controlled rehearsal on that Mac with OBS 33.0.1 passed one stdin
`fader.forward` followed by one host `fader.cancel`: the actual native handle read
**0 → 51 → 0**, and an independent OBS connection observed renderer cursor
**0.0498046875** before cancellation. A bounded read-only wait accounted for the
renderer lagging behind the handle. The original Program/Preview scenes and source
settings/transforms were restored, all four outputs remained inactive, and the
host exited cleanly after `DISARMED` and `STOPPED`. This used the gray Color fixture,
`--no-mix-provider`, and no input helper. It verifies that small move/cancel path,
not full endpoints, return throws or sustained performance.

Physical Scroll and Dial input was verified separately by a count-only shortcut
listener. It did not drive OBS. Physical TourBox-to-host-to-OBS operation remains
unverified.

To create a standalone developer binary:

```sh
dotnet publish tourbox/macos/host/FadesterMacHost.csproj -c Release \
  -r osx-arm64 --self-contained true -p:PublishSingleFile=true -o out/mac-host
./out/mac-host/FadesterMacHost --help
```

Use `osx-x64` for Intel. Build the separate helper using
`tourbox/macos/native/build.sh`. Its actual host launch must have Accessibility
permission through normal macOS controls; a grant for a separately launched
permission window is not proof of permission for this child process.

## Explicit development session

Prepare an existing JSON configuration using the shared bridge schema. A minimal
example is below; replace the input and scene names with real bindings before
using those actions. The host does not create or rewrite the file.

```json
{
  "host": "127.0.0.1",
  "port": 4455,
  "musicInput": "",
  "contentInput": "",
  "micInput": "",
  "mediaInput": "",
  "overlayScene": "",
  "overlaySource": "",
  "anchors": ["", "", "", ""],
  "mixEnabled": false
}
```

Only an explicit live command connects:

```sh
./out/mac-host/FadesterMacHost --run --config /path/to/development.json \
  --native-app "/path/to/Fadester Companion T-bar.app"
```

Authentication uses process-local `FADESTER_OBS_PASSWORD`, or reads the matching,
enabled, authenticated OBS configuration under
`~/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json`.
Only loopback hosts are accepted. No password command-line option exists; secrets
are not printed or saved to the development configuration. The native launcher
removes the OBS credential environment variables before starting its helper.

Startup authenticates OBS, performs a read-only native warmup and checks the same
authenticated connection again. It never moves the bar into position.
`READY <generation>` means this connection is accepting commands. A T-bar that
cannot be read at start (Studio Mode off, Accessibility not granted, the bar not
parked at zero and not where this host's own last sweep left it) no longer refuses
the session: every other control works, a `T-BAR:` line says why, and each Dial
turn looks again (at most every two seconds). There is still no invisible
WebSocket-only T-bar: until the native bar can be read, T-bar moves are refused.

For a strictly read-only startup/status check, add `--read-only`. It permits only
`preview.status`, `fader.status`, `recording.status` and `host.native.status`, disables the mix provider
and monitor, and rejects all non-`Get` OBS requests and every native slider move.
It cannot be combined with `--input-app` or `--enable-mix`. Native startup still
inspects the slider and requires zero; it never parks the slider for you.
`host.native.status` reads its actual 0–1023 value through the existing helper,
independently of StudioFader's logical position; it does not launch a second owner.

Stdin accepts one ASCII command per line. A normal development session supports
commands such as these; read-only sessions enforce the smaller list above:

```text
action preview.status
action fader.status
action soundcheck
action fader.forward
action fader.cancel
action bridge.reconnect
quit
```

An external input adapter can submit
`event <generation> <unixMs> <canonical-action-id>`. It must wait for `READY`, use
that exact generation and timestamp the physical callback, not a later forwarding
attempt. Manual `action` commands are timestamped on receipt. Only shared supported
action IDs are accepted; arbitrary OBS requests are unsupported.

To explicitly use the separate `tourbox/macos/input` Carbon shortcut component,
add both options to the live command:

```sh
  --input-app "/path/to/Fadester Companion Shortcuts.app" \
  --map /path/to/tourbox/presets/map.json
```

After OBS authentication and native-slider validation, the host launches that
helper, waits for all exclusive shortcut registrations to succeed, and arms the
current generation. `READY` is emitted only after its acknowledgement. Events
retain their original callback timestamp and generation through the same ingress
as stdin. Helper exit or protocol failure disarms the host without another input
mechanism. A registration collision fails the whole input startup. While enabled,
these exclusive chords are consumed; no registration occurs during build,
`--help` or `--self-test`. The Mac preset must emit the chords the helper registers
from the same map (Control+Option+Shift, Control+Shift and Option+Shift; never
Command); do not assume an unchanged Windows binary preset works.

The queue holds at most 64 commands. Relative rotary actions across fader, audio,
mix, preview, media and transitions expire after 180 ms; other actions expire
after 1500 ms. The host retains source age through its queue and rechecks age
before a command's first native or OBS mutation. An accepted timed audio fade may
finish deliberately, but a stopped or replaced connection invalidates further
writes. Queued inputs from previous connections are discarded. Reconnect is
explicit; failed or uncertain commands are never retried or replayed.

Grouped mixing remains opt-in through `mixEnabled:true` or the run-only
`--enable-mix` option. The host reuses the existing mix protocol and recovery
journal beside the selected config. Its per-port ownership lease also excludes
the existing Mac mix-only host for this user. An enabled mix provider may service
authenticated whole-mix clients independently of stdin; leave it disabled when
testing only manual actions.

For a controlled writable rehearsal with no grouped-mix event server at all,
use `--no-mix-provider`. It forces grouped mixing off for the run and omits both
the mix monitor and protocol handler. Explicit individual actions remain enabled;
this option is not a read-only mode.

EOF, `quit`, Ctrl+C or SIGTERM disarms input, closes the optional shortcut helper
to unregister its chords, and stops owned tasks. Shutdown sends
no cleanup T-bar reset, Take or level restore. Inspect OBS and explicitly recover
any interrupted manual mix. With VJster on, the host stays up when OBS goes away
(the video controls keep working) and connects again when OBS is back; without
VJster, or with `--mix-only`, an OBS disconnect ends the host and the panel looks
for OBS again. It never resumes motion by itself. No automatic user or system
settings are changed.

Within one host run, a new OBS session (Reconnect, or OBS lost and back with
VJster on) takes over what the last one left: the duck, so Restore still knows
the level to return to, and a transition a cut or a sweep still owes, which goes
back with the next take, cut, T-bar move or Cancel. About 1.5 s after a cut the
host looks once more and puts the operator's transition back if OBS returned to
Cut as the cut ended (the one write that follows a command instead of being one).
Nothing is written when a session starts or ends. A T-bar left part-way is carried
too: if OBS's T-bar still sits there when the next session starts, the next Dial
turn carries on from it, a Fade or Cut finishes it, and Cancel returns to Program;
if OBS's T-bar is at rest by then, the sweep is forgotten.
