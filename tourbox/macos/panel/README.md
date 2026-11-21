# Fadester Companion — Mac setup window

**Fadester Companion** (`Fadester Companion.app`) is the Mac AppKit companion matching the Windows Fadester Companion header, live readiness lights (`OBS`, `TourBox`, `VJster`, `Controls` + quick `Start`/`Stop`), live interactive Setup signal-flow diagram, animated `Show me` walkthroughs, contextual foreground reminder banner (`Bring OBS to Front`), Setup, Assignments, Control map, Activity, and non-activating floating feedback HUD for the Mac action host. It ships in every release as `Fadester-Companion-macOS-arm64-<version>.zip` (Apple silicon) and `Fadester-Companion-macOS-x64-<version>.zip` (Intel), built and self-tested on GitHub's macOS runners. It is ad-hoc signed and not notarized. Opening the window performs read-only OBS scene/input discovery when OBS is running, never registers shortcuts until explicit Start, and never overwrites TourBox Console presets automatically.

## Install

1. Download the ZIP for your Mac (Apple silicon: `arm64`; Intel: `x64`; Apple menu → **About This Mac** shows which) and unzip it. The `Fadester Companion` folder holds the app, the TourBox preset `OBS Fadester for TourBox.tb` (English labels; `presets/<language>/` holds the same preset with translated labels), the full guide `START-HERE.html`, translated quick starts in `guide/<language>.html`, a short read-me for users (`USER-README.md` here, shipped as `README.md`) and the license.
2. Move **Fadester Companion.app** to Applications.
3. The app is not signed or notarized by Apple, so macOS will refuse to open it the first time. Try to open it once, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. (On macOS 14 and older you can instead Control-click the app and choose **Open**, then **Open** again; newer macOS no longer offers that.)
4. Grant Accessibility when Setup asks (see below). TourBox Console needs its own permissions.

Not yet checked on a real Mac: opening a downloaded copy past Gatekeeper, the window on screen, the Accessibility prompt for the bundled helper, and control of OBS from a physical TourBox. CI checks the build and the self-tests only. Please report what you find, with your Mac (Apple silicon or Intel) and macOS version.

Use **Import into TourBox Console** to save the embedded `OBS Fadester for TourBox.tb`, with labels in the panel's language, to `Downloads` without a save window (the path is copied, and TourBox Console opens; a different file of that name already there is never replaced, the preset is then saved as `OBS Fadester for TourBox 2.tb` and every text and the animation name that file; when Downloads cannot be written, a save window asks where). **Show me where to click** is the floating animated 3-step visual guide: click the middle **Import [↙]** icon beside Preset List, press ⌘⇧G, ⌘V and Return in the file window (or pick the file in Downloads by hand if the window does not accept that), open the `.tb`, turn **Auto Switch** off and select **OBS Fadester for TourBox** (one preset then works whichever app is in front; only with Auto Switch on, click **Not Linked → pick OBS (not Fadester) → Save**, and link Google Chrome too to control videos with Chrome in front). Setup also provides direct **Download TourBox Console…** and **TourBox Preset Square…** links and tracks the saved `.tb` SHA-256 (`saved-preset.sha256`) so future app updates flag newer presets automatically. **Quick guide** opens the quick start in the panel's language (`guide/<language>.html`, made from `tourbox/macos/panel/guide/`), or the full English `START-HERE.html` with the map and rehearsal. Use **Read scenes and inputs from OBS** for bounded, authenticated, read-only discovery. Unavailable saved targets remain visible; they are never silently rebound. Save while the controls run applies assignments, inputs, anchors and steps at once; the port, VJster, mixer mode and fade step still need Stop and Start.

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
host and releases its shortcuts; it sends no fade cancellation, transition or level
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

`bash tourbox/macos/package.sh [OUTPUT_DIR]` runs the complete build and packs the
release ZIP for this Mac's architecture (`Fadester-Companion-macOS-arm64-<version>.zip`
or `...-x64-...`, plus a `.sha256`). It then extracts the ZIP and runs the panel, host
and helper self-tests and the discovery check below from the extracted app. The
macOS workflow and the draft-release workflow both run it, on `macos-15` (Apple
silicon) and `macos-15-intel`. There is no universal app: the .NET single-file host
cannot be merged with `lipo`, so each architecture has its own ZIP.

```sh
app='tourbox/macos/panel/build/Fadester Companion.app'
"$app/Contents/MacOS/Fadester Companion" --self-test
node tourbox/macos/panel/tests/discovery-server.mjs "$app/Contents/MacOS/Fadester Companion"
"$app/Contents/MacOS/Fadester Companion" --render-preview /tmp/setup.png /tmp/assignments.png /tmp/control-map.png
```

Self-tests cover strict settings, Unicode, secret-free serialization, redaction,
and a synthetic owned child reaching READY then quitting through an open pipe.
The Node check uses the repository's `ws` dependency and a fresh private fake
OBS endpoint; no real settings are read. `FADESTER_TEST_MODULE_ROOT` can point to
an existing checkout with that dependency. Offline previews use synthetic names,
show no window, read no user settings and make no connection.

Accessibility attribution from the GUI, source assignments, menu/modifier behavior, fast
rotary input and end-to-end OBS actions still need a supervised Mac rehearsal.
The panel speaks the Windows panel's 13 languages (the Mac's first preferred
language, or `--language CODE`). Its strings come from `tourbox/panel/PanelText.cs`,
`PanelExtraText.cs` and the Mac-only `mac-strings.json`, generated into
`PanelStrings.swift` by `node tourbox/macos/panel/make-strings.cjs` (build.sh and
`tests/companion-mac-strings.test.ts` refuse a stale file). TourBox Console's own
labels (Preset List, Import, Auto Switch) stay as Console shows them.
The panel saves the TourBox preset and opens the quick start in its own language:
build.sh writes each language's Mac preset with `tourbox/presets/build_macos.py
--localized-out` (the same shortcuts, translated labels, as `build.py` makes the Windows
ones) and copies `guide/<language>.html`. `--self-test` checks that every language has
both in the built app, and measures every Setup-diagram label and button in all 13
languages at the narrowest diagram width, failing if any would need text smaller than
8 points or leave its box.
**Use only Stream Deck, OpenDeck or MIDI** runs the host with `--mix-only`: no
shortcut helper, native T-bar, Accessibility or VJster. The Setup tab and the
feedback window show the Visual Sidechain meter line (from a scan, and from the
host's `VS-METER:` lines while the controls run), as on Windows.
US/ABC keyboard mappings are the initial scope. The source
targets macOS 12 for compilation, but that does not establish tested support for
every older system or Intel hardware.

## Verified direct bundled-host check — November 4, 2026

On macOS 27.2 Apple Silicon with OBS 33.0.1, the assembled app passed
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
