# Fadester Companion: Windows and Mac parity

This page lists what the Fadester Companion window offers on each operating system. Each difference is marked as either **intentional** (the hardware or the OS requires it) or a **gap** (it could match, but does not yet). The Mac app is experimental and has not been verified on hardware; the Mac changes marked "Unreleased" below have not been compiled yet (they were written on Windows).

Sources: `tourbox/panel/FadesterTourBox.cs` and `ShowMe.cs` (Windows), `tourbox/macos/panel/Panel.swift`, `Model.swift` and `ShowMe.swift` (Mac).

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
| Quick guide | Opens the guide in the panel's language (`guide/<locale>.html`) | Opens the English Mac guide (`START-HERE.html`) | **Gap**: the Mac guide is English only |

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
| TourBox import | Animation: Import, paste the copied path, open, then **Not Linked** → OBS Studio → Save | Animation: Import, pick the file in the Finder dialog, then **Not Linked** → OBS → Save, with step buttons |

TourBox Console's own labels (Preset List, Import, Not Linked, Running applications, Save) stay in English in both animations and texts, as Console shows them.

## Panel languages

Both panels use one catalog:
- `tourbox/panel/PanelText.cs` (English, Spanish, French, Simplified Chinese) and `PanelExtraText.cs` (German, Italian, Japanese, Korean, Russian, Traditional Chinese) hold every string the Windows panel uses, including the ones both panels share.
- `tourbox/macos/panel/mac-strings.json` holds the Mac-only strings (Accessibility, the `.tb` save, the setup diagram, the Mac host's messages) in the same 10 languages.
- `node tourbox/macos/panel/make-strings.cjs` writes `tourbox/macos/panel/PanelStrings.swift`. `build.sh` and `tests/companion-mac-strings.test.ts` fail when that file is stale, when the Swift panel asks for a key the catalog lacks, or when a Mac-only string is unused.

Still English on the Mac: the Mac guide, and the rare messages about a damaged settings file (`Settings` validation in `Model.swift`).

## Suggested follow-ups, in priority order

1. **Verify the Unreleased Mac changes on a Mac.** Build with `tourbox/macos/panel/build.sh`, run `--self-test` and the discovery check, then check the lights, the meter line, Stream Deck-only mode and a non-English language (`--language de`, `--language ja`) on screen. Long translations in the fixed-width setup diagram may need shorter words.
2. **Shorter Windows Setup page.** See the proposal below. It needs an on-screen review, so it was not changed blind.
3. **Mac quick guide in the panel's language.** Generate the Mac guide per language, as the Windows guides are.
4. **Setup diagram on Windows.** The Mac's clickable diagram has no Windows counterpart.
5. **Game controller on the Mac.** This would be a new feature (Apple's GameController framework), not a parity fix.

## Proposal: a shorter Windows Setup page

Not implemented: it changes what a newcomer sees first, so it needs an on-screen review by the owner.

Today the Windows Setup tab is one long scrolling page: Connect to OBS, Choose your controller (game controller and TourBox), Try Preview, Assign your inputs, Whole mix and VJster. The last two are optional and hold most of the controls.

Proposed:
1. **Collapse the two optional sections by default.** Show each as one line with its title, a one-line summary of its state ("Off", "On, Stream Deck only", "On, Chrome & OBS page, port 48150") and a **Show** / **Hide** link. Open a section by itself when it is on and its light is amber or red, so a problem is never hidden.
2. **Fold "Assign your inputs" into Try Preview**, as one sentence with a link that opens the Assignments tab.
3. **Keep the order** a newcomer acts in: OBS, controller, first cue, then the optional sections.
4. **Remember** which optional sections were opened (a panel preference, not in `config.json`).

Expected result: steps 1 to 3 fit on the first screen without scrolling at the default 780 × 700 window. Check on screen before building: wrapping at 125% and 150% display scaling, the longest translations (German, Russian), keyboard focus order, and the same change on the Mac panel for parity.
