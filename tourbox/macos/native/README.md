# Experimental Mac native T-bar adapter

This unpublished component is integrated into the experimental Mac action host.
It is not part of the mix-only host, a finished TourBox Mac application, or a release.
It builds using the Mac's existing Swift/AppKit/ApplicationServices tools and has
no third-party runtime dependencies. `MacNativeTBar.cs` is an optional .NET 8 caller
source; it is not linked into any shipping project.

The separate development write probe demonstrated AXValue 0 → 512 → 0 with OBS's
visible handle and renderer following. On November 4, 2026, the action host then
passed a controlled small move/cancel with this helper on Apple Silicon macOS 27.2
and OBS 33.0.1: native readbacks 0 → 51 → 0, independent renderer cursor settling
at 0.0498046875, original scenes restored and all outputs inactive. The host used
stdin commands with shortcut input and the mix provider disabled. Full endpoints,
return throws, sustained latency and physical controller operation remain unverified.

## Build and synthetic checks

```sh
cd tourbox/macos/native
/bin/bash build.sh
"build/Fadester Native Slider Experimental.app/Contents/MacOS/FadesterNativeSlider" --self-test
dotnet run --project tests/AdapterChecks.csproj -c Release
```

The Swift checks use synthetic slider objects and private temporary lock files.
They also exercise the production bounded reader through a real Foundation pipe,
requiring LF and fragmented CRLF commands to arrive while the writer stays open,
then checking overflow recovery and partial-command rejection at EOF.
The C# checks compile the real adapter and verify tick/listener parsing. Neither
test inspects OBS, sends AX writes, prompts for permission, or changes settings.

## Permission and process lifetime

Opening the app normally presents only a permission window. Its explicit request
button invokes the normal macOS Accessibility prompt; the user grants permission
manually. This bundle has the separate identifier
`io.github.jbrick2070.fadester-tourbox.native-slider.experimental`. Neither existing
probe bundle is modified, and their grants are not reused. This app is ad-hoc
signed, not notarized. Rebuilds may require another grant.

Each host must verify TCC's responsible-process attribution for its actual
launch path. Granting this app through its normal window is not proof that a
direct executable launch from another host will inherit that grant. Permission
denial fails closed; there is no TCC database access, settings automation or
fallback to WebSocket-only fading. The controlled action-host rehearsal above
verified its actual child-process launch on that development Mac; it does not
establish permission for a different path, build or machine.

The private protocol mode has no window, focus activation or automatic prompt:

```text
FadesterNativeSlider --stdio --obs-pid PID --obs-port PORT
```

The caller must already have authenticated the matching **loopback** OBS v5
connection. It passes only numeric PID and port, never the password. Both sides
independently parse complete PID/descriptor/name records from the system
`lsof -Ffpn` listener table. The Swift backend verifies
the requested PID's OBS bundle/executable identity and pins its launch time.
A per-PID exclusive file lease prevents another copy running as this OS user from
owning the same native slider. It is not an OBS-wide lease across different users
or unrelated controllers.

## Protocol and guards

One ASCII line (at most 128 bytes, with LF or CRLF termination) produces one
flushed reply without waiting for pipe closure. There is no greeting.

```text
READ
MOVE 0 512 1793912345678
```

`MOVE` takes expected and desired integer positions in 0..1023, followed by the
caller's current Unix timestamp in milliseconds. Replies are `OK <actual>` or
`ERR <reason>`. Requests older than 500 ms or over 100 ms into the future are
refused, including a second freshness check immediately before the setter.
Malformed commands never invoke the backend. A guard or write failure latches
the session disarmed; callers must not replay an unconfirmed write.

Every read and write verification scans only the pinned OBS process, requiring
one OBS window and exactly one enabled, writable slider with full identifier
`OBSApp.OBSBasic.centralwidget.canvasEditor.QWidget.SliderIgnoreScroll` and exact
range 0..1023. The window and slider objects stay pinned for the session. Missing
permission, process replacement, UI recreation, extra windows, unreadable nodes,
ambiguous matches, traversal limits, unexpected value or readback all fail closed.
Scans have a 1.5 second traversal deadline, 3,000 queued nodes, 30 levels, 128
children per node and 75 ms per-element AX messaging timeout. Individual in-flight
AX calls can finish after a deadline. Slow scans expire writes rather than queue
old motion; real rotary latency remains to be measured.

AX provides no atomic compare-and-swap. The final expected-value read narrows but
cannot eliminate the race with a simultaneous hand move, nor detect a hand move
away and back between observations. Never claim exclusive control over operator
actions or unrelated AX clients. No keyboard, focus, T-bar release or OBS WebSocket
command is generated by the Swift component.

EOF/transport loss terminates the helper without moving or resetting the bar.
There is deliberately no cleanup write after failure. The caller handles safe
recovery according to the observed OBS state.

## C# integration

After authenticated OBS connection setup, construct
`new MacNativeTBar(port, absoluteAppBundlePath)` and await `ReadAsync()` to warm
and validate the target before accepting controls. Pass `adapter.MoveAsync` as
the existing `StudioFader` constructor's non-null `nativeMove` callback. Dispose
the adapter on OBS disconnect; errors latch it closed until a new, independently
validated connection creates a new instance. The C# launcher removes OBS password
environment variables from the native helper and its listener-inspection child.

`MoveAsync(from, to)` rounds normalized positions to native 0..1023 ticks and sends
one expected-value move. Equal-value calls only poll `READ`; they never force a
hand-moved slider back. Moves waiting over 400 ms, including startup delays, expire.

The shared `StudioFader` remains responsible for rail release: after the native
move to 0 or 1023 it calls authenticated OBS `SetTBarPosition` with `release:true`,
then `nativeMove(0, 0)` verifies the real handle parks at zero. The adapter does not
duplicate this RPC. The small move/cancel rehearsal verified the zero-release and
Program/Preview restoration path on one isolated Mac fixture. Full endpoints,
return throws and broader failure cases still need real Mac rehearsal before this
wiring can ship. Synthetic tests alone do not establish actual frontend behavior.
