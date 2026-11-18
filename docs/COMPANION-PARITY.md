# Fadester Companion: Windows and Mac parity

This page lists what the Fadester Companion window offers on each operating system. Each difference is marked as either **intentional** (the hardware or the OS requires it) or a **gap** (it could match, but does not yet).

Both ship in every release: `Fadester-Companion-Windows-x64-<version>.zip` (and the Store package) and the Mac `Fadester Companion.app` in `Fadester-Companion-macOS-arm64-<version>.zip` (Apple silicon) and `Fadester-Companion-macOS-x64-<version>.zip` (Intel), all at the version in `installer/components.json`. The Mac app is built, packed and self-tested on GitHub's macOS runners for both architectures (panel, host and helper self-tests and the fake-OBS discovery check, run from the extracted ZIP), including the changes marked "Unreleased" below. It is ad-hoc signed and not notarized. Not yet checked on a real Mac: the window on screen, the Accessibility prompt, and physical TourBox control of OBS (see [tourbox/MACOS.md](../tourbox/MACOS.md)).

Sources: `tourbox/panel/FadesterTourBox.cs` and `ShowMe.cs` (Windows), `tourbox/macos/panel/Panel.swift`, `Model.swift` and `ShowMe.swift` (Mac).

## Release files

| | Windows | Mac | Status |
| --- | --- | --- | --- |
| Release file | `Fadester-Companion-Windows-x64-<version>.zip`, plus the Microsoft Store package | `Fadester-Companion-macOS-arm64-<version>.zip` and `Fadester-Companion-macOS-x64-<version>.zip` | Same release, same version. **Intentional**: one ZIP per Mac architecture (the .NET single-file host cannot be made universal). |
| Beside the app | TourBox presets (10 languages), game-controller map, quick guide and translated guides, read-me, rehearsal notes, license | Mac TourBox preset (10 languages, `presets/<locale>/`), Mac guide and translated Mac quick starts (`guide/`), read-me, license | Same (Unreleased). **Intentional**: no game-controller map or Windows rehearsal notes |
| Signing | The Store package is signed for the Store; the ZIP is not code-signed | Ad-hoc signed, not notarized: right-click → **Open**, or **Open Anyway** in Privacy & Security | **Gap**: no Developer ID notarization yet |

## Window layout

| Part | Windows | Mac | Status |
| --- | --- | --- | --- |
| Header | Title, version and live status line | Title, app icon, version and live status line | Same |
| Readiness lights | OBS, TourBox, VJster, Controller, Controls | OBS, TourBox, VJster, Controls | Same states, words and buttons (Unreleased). **Intentional**: the Mac has no game controller, so it has no Controller light. On Windows a closed or missing TourBox Console shows grey instead of amber while the game controller is in use. |
| Amber reminder strip | OBS hidden, or OBS not in front while TourBox Console runs, with a **Bring OBS to Front** button | Same, plus the Accessibility reminder before Start | Same (Unreleased). **Intentional**: Accessibility is a macOS permission. |
| Tabs | Setup, Assignments, Game controller, Control map, Activity | Setup, Assignments, Control map, Activity | **Intentional**: the game controller is Windows only (XInput) |
| Footer buttons | Save & start controls, Save assignments, Show / hide feedback, Quick guide (Open settings only when `config.json` cannot be read) | Same four buttons | Same |
| "Keep this window open" note | Under the footer buttons, always visible | Under the footer buttons, always visible | Same |
| Panel languages | 10 (the Windows display language, or `--language`) | The same 10, from the same catalog (the Mac's first preferred language, or `--language`) | Same (Unreleased). See [Panel languages](#panel-languages). |
| Feedback window | Last action and the Visual Sidechain meter line | Last action and the Visual Sidechain meter line | Same (Unreleased) |
| Quick guide | Opens the guide in the panel's language (`guide/<locale>.html`) | Opens the Mac quick start in the panel's language (`guide/<locale>.html`); English opens `START-HERE.html` | Same (Unreleased). The Mac quick starts (`tourbox/macos/panel/guide/`) leave out the Windows-only parts (game controller, Windows x64). |

## Setup tab

| Step | Windows | Mac | Status |
| --- | --- | --- | --- |
| 1 Connect to OBS | Port, optional password, Read scenes and inputs, Program/Preview summary, Visual Sidechain meter line | Same, including the meter line (from a scan's read-only `get_signals` request and from the host's `VS-METER:` lines) | Same (Unreleased) |
| Setup diagram | None | Clickable setup diagram | **Gap** on Windows |
| 2 Controller | Game controller (Easy mode) and TourBox: **Import into TourBox Console** copies the preset path, opens Console and opens the **Show me where to click** guide (also its own button) | TourBox: save the `.tb`, open Console, **Show me where to click**, download links | Same guide (Unreleased). **Intentional**: the game controller is Windows only, and the Mac saves the `.tb` with a save dialog. |
| macOS Accessibility | Not applicable | Grant Accessibility, native helper window, status | **Intentional** (macOS permission) |
| 3 Try Preview | Present | Present | Same |
| Optional: VJster | Enable, port, extension ID, Target, OBS video URL / ID, Copy OBS Browser Source URL | Same fields | Same |
| Optional: Whole mix | Enable, **Use only Stream Deck, OpenDeck or MIDI**, step (dB), fade (ms) | Same | Same (Unreleased). The Mac runs `FadesterMacHost --run --mix-only`: no shortcut helper, native T-bar, Accessibility or VJster. |

## Assignments, Control map, Activity

These match on both systems:
- **Assignments:** six sources, four Preview anchors, **Assign the first four OBS scenes**, Layer 1 and Layer 2 scene and source, and the five **Adjust the feel** values.
- **Control map:** the same table with category icons, in the panel's language (the Mac now bundles each language's `map.json`, Unreleased).
- **Activity:** the same log. Neither panel logs the Visual Sidechain meter lines there.

## "Show me" windows

| Window | Windows | Mac |
| --- | --- | --- |
| OBS WebSocket server, password, Studio Mode | Animation with OBS's labels in the panel's language | Same |
| VJster waiting for video, VJster port in use | Two-way card (Chrome or OBS page; quit Stream Deck or pick another port) | Same words |
| TourBox import | Animation: Import, paste the copied path, open, then select the preset (Auto Switch off) | Animation: Import, pick the file in the Finder dialog, open, then select the preset (Auto Switch off), with step buttons |

TourBox Console's own labels (Preset List, Import, Auto Switch) stay in English in both animations and texts, as Console shows them.

## Panel languages

Both panels use one catalog:
- `tourbox/panel/PanelText.cs` (English, Spanish, French, Simplified Chinese) and `PanelExtraText.cs` (German, Italian, Japanese, Korean, Russian, Traditional Chinese) hold every string the Windows panel uses, including the ones both panels share.
- `tourbox/macos/panel/mac-strings.json` holds the Mac-only strings (Accessibility, the `.tb` save, the setup diagram, the Mac host's messages) in the same 10 languages.
- `node tourbox/macos/panel/make-strings.cjs` writes `tourbox/macos/panel/PanelStrings.swift`. `build.sh` and `tests/companion-mac-strings.test.ts` fail when that file is stale, when the Swift panel asks for a key the catalog lacks, or when a Mac-only string is unused.

Still English on the Mac: the full Mac guide `START-HERE.html` (the control map and recovery, as on Windows), and the rare messages about a damaged settings file (`Settings` validation in `Model.swift`).

## Suggested follow-ups, in priority order

1. **Check the Mac app on a real Mac.** CI now builds and self-tests it on both architectures; what is left needs a screen and hardware: open the released ZIP past Gatekeeper, check the lights, the meter line, Stream Deck-only mode and a non-English language (`--language de`, `--language ja`) on screen, grant Accessibility, and rehearse with a TourBox. The setup diagram now fits its labels in all 10 languages by the panel's self-test; confirm the look on screen.
2. **Shorter Windows Setup page.** See the proposal below. It needs an on-screen review, so it was not changed blind.
3. **Setup diagram on Windows.** The Mac's clickable diagram has no Windows counterpart.
4. **Game controller on the Mac.** This would be a new feature (Apple's GameController framework), not a parity fix.

## Proposal: a shorter Windows Setup page

Not implemented: it changes what a newcomer sees first, so it needs an on-screen review by the owner.

Today the Windows Setup tab is one long scrolling page: Connect to OBS, Choose your controller (game controller and TourBox), Try Preview, Assign your inputs, Whole mix and VJster. The last two are optional and hold most of the controls.

Proposed:
1. **Collapse the two optional sections by default.** Show each as one line with its title, a one-line summary of its state ("Off", "On, Stream Deck only", "On, Chrome & OBS page, port 48150") and a **Show** / **Hide** link. Open a section by itself when it is on and its light is amber or red, so a problem is never hidden.
2. **Fold "Assign your inputs" into Try Preview**, as one sentence with a link that opens the Assignments tab.
3. **Keep the order** a newcomer acts in: OBS, controller, first cue, then the optional sections.
4. **Remember** which optional sections were opened (a panel preference, not in `config.json`).

Expected result: steps 1 to 3 fit on the first screen without scrolling at the default 780 × 700 window. Check on screen before building: wrapping at 125% and 150% display scaling, the longest translations (German, Russian), keyboard focus order, and the same change on the Mac panel for parity.
