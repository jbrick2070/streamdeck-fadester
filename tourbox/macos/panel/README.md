# Fadester Companion — Mac setup window

**Fadester Companion** (`Fadester Companion.app`) is the Mac AppKit companion matching the Windows Fadester Companion header, live readiness lights (`OBS`, `TourBox`, `VJster`, `Controls` + quick `Start`/`Stop`), live interactive Setup signal-flow diagram, animated `Show me` walkthroughs, contextual foreground reminder banner (`Bring OBS to Front`), Setup, Assignments, Control map, Activity, and non-activating floating feedback HUD for the Mac action host. It is an unpublished developer candidate, not a notarized release. Opening the window performs read-only OBS scene/input discovery when OBS is running, never registers shortcuts until explicit Start, and never overwrites TourBox Console presets automatically.

Use **1. Save TourBox Preset (.tb)…** to save the embedded `OBS Fadester for TourBox.tb` to a visible folder (such as `Downloads`), then click **2. Open TourBox Console** (or **Show me where to click** for the floating animated 3-step visual guide): click the middle **Import [↙]** icon beside Preset List, open the `.tb`, and click **Not Linked → pick OBS (not Fadester) → Save** with Auto Switch on. Setup also provides direct **Download TourBox Console…** and **TourBox Preset Square…** links and tracks the saved `.tb` SHA-256 (`saved-preset.sha256`) so future app updates flag newer presets automatically. Open the included Quick guide for the full map and rehearsal. Use **Read scenes and inputs from OBS** for bounded, authenticated, read-only discovery. Unavailable saved targets remain visible; they are never silently rebound. Stop before editing assignments.

The panel uses authenticated loopback OBS only. A blank password field reads the
matching local OBS settings; a typed password stays in process memory and the
owned host's environment, never the saved settings or log. Settings use the
separate `~/Library/Application Support/FadesterTourBox/panel-config.json`
(including VJster port, optional Chrome extension pin, `/obs` Browser Source
token, target selection, and Layer 1/2 scene-item assignments; the OBS page
token is redacted from Activity logs). Malformed saved settings are not
overwritten. Whole-mix control starts disabled; when disabled the host is
launched with `--no-mix-provider`.

Accessibility is granted manually to the native slider component using its
permission window. TourBox Console has separate permissions. The actual child
launch from the GUI still needs testing; a previous probe's grant or a direct
command-line launch is not proof of the GUI's Accessibility attribution.
Start never moves OBS into position, substitutes invisible fading or retries an
uncertain action. Connected appears only after the host's READY acknowledgement.
Startup without READY is stopped after 30 seconds. Stop/quit closes only the owned
host and releases its shortcuts; it sends no fade cancellation, take or level
restore. Review OBS after an interrupted transition.

## Build and offline checks

Use the existing .NET 8 SDK, Xcode command-line tools and Python 3.10+ on a Mac:

```sh
bash tourbox/macos/panel/build.sh
```

The build embeds the self-contained action host, native/input helper apps, Mac
preset, map, offline guide, license and .NET notices. It uses only ad-hoc signing;
it is not notarized and does not install or launch the GUI. `DOTNET=/path/to/dotnet`
selects the existing SDK, and `PYTHON=/path/to/python3` selects Python.
`--ui-only` omits the runtime and creates the separate **Fadester Companion
UI Preview.app** bundle. Its Start guard refuses use; a complete build is preserved.

```sh
app='tourbox/macos/panel/build/Fadester Companion.app'
"$app/Contents/MacOS/FadesterTourBoxPanel" --self-test
node tourbox/macos/panel/tests/discovery-server.mjs "$app/Contents/MacOS/FadesterTourBoxPanel"
"$app/Contents/MacOS/FadesterTourBoxPanel" --render-preview /tmp/setup.png /tmp/assignments.png /tmp/control-map.png
```

Self-tests cover strict settings, Unicode, secret-free serialization, redaction,
and a synthetic owned child reaching READY then quitting through an open pipe.
The Node check uses the repository's `ws` dependency and a fresh private fake
OBS endpoint; no real settings are read. `FADESTER_TEST_MODULE_ROOT` can point to
an existing checkout with that dependency. Offline previews use synthetic names,
show no window, read no user settings and make no connection.

Accessibility attribution from the GUI, source assignments, menu/modifier behavior, fast
rotary input and end-to-end OBS actions still need a supervised Mac rehearsal.
English strings and US/ABC keyboard mappings are the initial scope. The source
targets macOS 12 for compilation, but that does not establish tested support for
every older system or Intel hardware.

## Verified direct bundled-host check — November 4, 2026

On macOS 27.2 Apple Silicon with OBS 33.0.1, the assembled experimental app passed
deep, strict code-signature verification and contained its host, native/input
helpers, map and Mac preset. Launching the **bundled host directly** with
`--read-only` and its **bundled native helper** reached authenticated `READY 1`
without a permission prompt or denial. Native status read **0 / 1023**; the other
status reads reported the original Program/Preview pair, Studio Mode on with no
host-owned fade, and recording stopped. `quit` produced `DISARMED 1`, `STOPPED`
and exit code zero.

Independent before/after checks confirmed unchanged fixture identities, source
settings and transforms, native bar zero, idle renderer cursor 1, and all four
outputs inactive. No GUI was launched, no shortcuts were registered, and no mix
provider, native move or OBS write was requested. This verifies the direct
bundled host/helper path only; it does **not** establish GUI-process permission
attribution, saved assignments, physical TourBox-to-OBS operation or audible mixing.

Tested host SHA-256:
`7c8383a4d4b5b70806d1f19ea91dc605c90c8790d353c8f43dc637609562f852`;
native-helper SHA-256:
`09e0b1f8ea8161cb680b90bedfbd86397a98520ebacaec1732a9330ffced34e0`.
