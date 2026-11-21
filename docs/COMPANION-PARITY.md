# Fadester Companion: Windows and Mac parity

This page lists what the Fadester Companion window offers on each operating system. Each difference is marked as either **intentional** (the hardware or the OS requires it) or a **gap** (it could match, but does not yet).

Both ship in every release: `Fadester-Companion-Windows-x64-<version>.zip` (and the Store package) and the Mac `Fadester Companion.app` in `Fadester-Companion-macOS-arm64-<version>.zip` (Apple silicon) and `Fadester-Companion-macOS-x64-<version>.zip` (Intel), all at the version in `installer/components.json`. The Mac app is built, packed and self-tested on GitHub's macOS runners for both architectures (panel, host and helper self-tests and the fake-OBS discovery check, run from the extracted ZIP). It is ad-hoc signed and not notarized. Not yet checked on a real Mac: the window on screen, the Accessibility prompt, and physical TourBox control of OBS.

Sources: `tourbox/panel/FadesterTourBox.cs` and `ShowMe.cs` (Windows), `tourbox/macos/panel/Panel.swift`, `Model.swift` and `ShowMe.swift` (Mac).

## Release files

| | Windows | Mac | Status |
| --- | --- | --- | --- |
| Release file | `Fadester-Companion-Windows-x64-<version>.zip`, plus the Microsoft Store package, and inside the Fadester Suite Setup | `Fadester-Companion-macOS-arm64-<version>.zip` and `Fadester-Companion-macOS-x64-<version>.zip` | Same release, same version. **Intentional**: one ZIP per Mac architecture (the .NET single-file host cannot be made universal). **Gap**: no combined Mac installer. |
| Beside the app | TourBox presets (13 languages), game-controller map, quick guide and translated guides, read-me, rehearsal notes, license | Mac TourBox preset (13 languages, `presets/<locale>/`), Mac guide and translated Mac quick starts (`guide/`), read-me, license | Same. **Intentional**: no game-controller map or Windows rehearsal notes |
| Signing | The Store package is signed for the Store; the ZIP is not code-signed | Ad-hoc signed, not notarized: open it once, then **Open Anyway** in System Settings → Privacy & Security | **Gap**: no Developer ID notarization yet (the owner's step) |

## Window layout

| Part | Windows | Mac | Status |
| --- | --- | --- | --- |
| Version | In the main window's title and header, in the title of every Show-me, import-guide and feedback window, and on the last line of the quick guide | Same, and in **Fadester Companion → About Fadester Companion** | Same |
| Header | Title, version and live status line (two lines, the whole text as a tooltip) | Title, app icon, version and live status line (two lines, the whole text as a tooltip) | Same |
| Readiness lights | OBS, TourBox, VJster, Controller, Controls | OBS, TourBox, VJster, Controls | Same states, words and buttons. **Intentional**: the Mac has no game controller, so it has no Controller light. On Windows a closed or missing TourBox Console shows grey instead of amber while the game controller is in use. |
| OBS light | Red **Open OBS**; amber Studio Mode with **Turn on**; amber server or password with **Show me** | Same | Same |
| TourBox light | Green only when Console holds the preset; amber **preset not imported** with **Import**; amber **old preset** | Same | Same |
| VJster light | Grey until a video was connected once on this computer, then amber when none is connected. Grey **on your Stream Deck** when the suite's own Stream Deck or OpenDeck plugin holds the VJster port; red **port in use** only for another program | Same | Same. The Mac setup diagram still draws the VJster link red while the port is held |
| Controls light | **Start**, **Try again**, or **Stop** when on | The same, plus **Controls: starting…** and **Accessibility: needed** with **Grant…** | **Intentional**: the Mac host has a starting state and needs Accessibility |
| Amber reminder strip | OBS hidden, or OBS not in front while TourBox Console runs, with a **Bring OBS to Front** button | Same, plus the Accessibility reminder before Start | Same. **Intentional**: Accessibility is a macOS permission. |
| Tabs | Setup, Assignments, Game controller, Control map, Activity (native tabs) | Setup, Assignments, Control map, Activity (four buttons) | **Intentional**: the game controller is Windows only (XInput). **Gap**: the tab control looks different |
| Footer buttons | **Start** / **Stop** (red while on), Save assignments, Show / hide feedback, Quick guide (Open settings only when `config.json` cannot be read) | Same four buttons | Same |
| First run | The controls start by themselves | The controls start by themselves once Accessibility is granted | **Intentional**: no system prompt at launch on the Mac |
| Closing the window | With the controls on it hides to the notification area (icon beside the clock: Open, Start / Stop, Quit) | With the controls on it hides; the menu-bar icon (top right) has Open, Start / Stop, Quit, and the Dock icon reopens the window | Same behaviour, each system's own place |
| Note under the footer | Says where the icon is and how to quit | The same, in the Mac's words | Same |
| App menus | None (a Windows window has none) | Fadester Companion (About, Hide, Quit), Edit (Undo, Redo, Cut, Copy, Paste, Select All), Window | **Intentional** |
| Panel languages | 13 (the Windows display language, or `--language`) | The same 13, from the same catalog (the Mac's first preferred language, or `--language`) | Same. See [Panel languages](#panel-languages). |
| Feedback window | Last action and the Visual Sidechain meter line | Last action and the Visual Sidechain meter line | Same |
| Quick guide | Opens the guide in the panel's language (`guide/<locale>.html`) | Opens the Mac quick start in the panel's language (`guide/<locale>.html`); English opens `START-HERE.html` | Same. The Mac quick starts (`tourbox/macos/panel/guide/`) leave out the Windows-only parts (game controller, Windows x64). |
| Light and dark | Dark when Windows is in dark app mode, read when the panel opens (`--theme dark` or `--theme light` chooses by hand). The header, the blue and red buttons and the feedback window are the same in both; the Show-me guide windows stay light. Spin-box arrows and check-box squares keep Windows' light drawing. | Follows the Mac's Appearance setting, also while open. The setup diagram and the Show-me guide windows stay light | Same rule. Written for the Mac without a build: check it on a real Mac |
| Scaled screens | Sharp text (GDI scaling); the layout is the 100 % one | Retina native | **Intentional** |
| Window size | 780 × 700, never larger than the screen | 920 × 856, never larger than the screen | Same rule. The Mac window is larger because of its setup diagram |

## Setup tab

| Step | Windows | Mac | Status |
| --- | --- | --- | --- |
| 1 Connect to OBS | Port and password filled in from OBS (a typed port is kept), Read scenes and inputs, Program/Preview summary, Visual Sidechain meter line | Same | Same |
| Setup diagram | None | Clickable setup diagram | **Gap** on Windows |
| 2 Controller | "Choose your controller": game controller (Easy mode) and TourBox: **Import into TourBox Console** copies the preset path, opens Console and opens the **Show me where to click** guide (also its own button) | "Set up your TourBox": save the `.tb`, open Console, **Show me where to click**, **Download TourBox Console…**, **TourBox Preset Square…** | Same guide. **Intentional**: the game controller is Windows only, and the Mac saves the `.tb` with a save dialog. **Gap**: the two download links are Mac only |
| macOS Accessibility | Not applicable | Grant Accessibility, native helper window, status | **Intentional** (macOS permission) |
| 3 Try Preview | Present | Present | Same |
| Optional: Assign your inputs | A paragraph that points to the Assignments tab | Same | Same |
| Optional sections, order | Assign, Whole mix, VJster | Same | Same |
| Optional: VJster | Enable, port, extension ID, Target, OBS video URL / ID, Copy OBS Browser Source URL | Same fields | Same |
| Optional: Whole mix | Enable, **Use only Stream Deck, OpenDeck or MIDI**, step (dB), fade (ms) | Same | Same. The Mac runs `FadesterMacHost --run --mix-only`: no shortcut helper, native T-bar, Accessibility or VJster. |
| Number fields | Spin boxes | Plain fields, with "Enter a valid number" | **Gap** |
| An empty choice | **Unassigned**, and **Unavailable: name** for a saved source OBS no longer has | Same | Same |

## While the controls run

| | Windows | Mac | Status |
| --- | --- | --- | --- |
| Status when on | "The controls are on. TourBox shortcuts: N." then "Connected to OBS at 127.0.0.1:4455." | "Connected to OBS. The controls are on." | Near enough. **Gap**: the Windows lines come from the controls in English |
| Words | The controls are **on** or **off**; the app is **Fadester Companion** | Same: no "armed", "disarmed", "host" or "panel" in a message | Same |
| Activity lines | The bridge's sentences | The host's own lines (`READY 1`, `RESULT fader.back: …`, `T-BAR: …`) | **Gap**: the Mac shows protocol lines; the status line above them is in words |
| Cut | Returns as soon as Program shows the scene; the transition goes back about 1.5 s later | Puts the transition back inside the cut, and looks again 1.5 s later | **Gap** (speed only): the Mac holds other input for about a second after a cut |
| T-bar cannot be read (Studio Mode off, OBS minimised or run as administrator, no Accessibility) | Only the T-bar waits; a held controller button sends OBS's own transition | Only the T-bar waits; the status line says why | Same rule |
| After a reconnect | A part-thrown T-bar is finished or returned by itself; the duck and an owed transition are carried | A part-thrown T-bar stays where it is and the next Dial turn, Fade, Cut or Cancel acts on it; the duck and an owed transition are carried | **Intentional**: the Mac host writes to OBS only on a fresh command |
| Stopping | Returns a T-bar it had part-thrown and puts a borrowed transition back | "Stopping the controls… No fade or volume reset is sent." | **Intentional**: the same rule |
| A refused OBS sign-in | Retried after 5 s, then twice as long each time up to a minute; Save tries at once | The same intervals | Same |

## Assignments, Control map, Activity

These match on both systems:
- **Assignments:** six sources, four Preview anchors, **Assign the first four OBS scenes**, Layer 1 and Layer 2 scene and source, and the five **Adjust the feel** values.
- **Control map:** the same table with category icons, in the panel's language.
- **Activity:** the same log. Neither panel logs the Visual Sidechain meter lines there.

## "Show me" windows

| Window | Windows | Mac |
| --- | --- | --- |
| OBS WebSocket server, password | Animation with OBS's labels in the panel's language | Same |
| Studio Mode | No window: the OBS light's **Turn on** button asks OBS | Same |
| VJster waiting for video, VJster port in use | Two-way card (Chrome or OBS page; quit Stream Deck or pick another port) | Same words |
| TourBox import | Animation: Import, paste the copied path, open, then select the preset (Auto Switch off) | Animation: Import, pick the file in the Finder dialog, open, then select the preset (Auto Switch off), with step buttons |

TourBox Console's own labels (Preset List, Import, Auto Switch) stay in English in both animations and texts, as Console shows them.

## Panel languages

The suite's 13 languages: English, German, Spanish, French, Italian, Japanese, Korean, Dutch, Brazilian Portuguese, Russian, Turkish, Simplified Chinese and Traditional Chinese. Portuguese (any region) opens Brazilian Portuguese.

Both panels use one catalog:
- `tourbox/panel/PanelText.cs` (English, Spanish, French, Simplified Chinese) and `PanelExtraText.cs` (German, Italian, Japanese, Korean, Russian, Traditional Chinese, Dutch, Brazilian Portuguese, Turkish) hold every string the Windows panel uses, including the ones both panels share.
- `tourbox/macos/panel/mac-strings.json` holds the Mac-only strings (Accessibility, the `.tb` save, the setup diagram, the menus, the Mac host's messages) in the same 13 languages.
- `node tourbox/macos/panel/make-strings.cjs` writes `tourbox/macos/panel/PanelStrings.swift`. `build.sh` and `tests/companion-mac-strings.test.ts` fail when that file is stale, when the Swift panel asks for a key the catalog lacks, or when a Mac-only string is unused. The Windows panel's self-test builds the real window in every language.
- `tourbox/presets/locales.json` holds the TourBox preset's labels, and `tourbox/guide/` and `tourbox/macos/panel/guide/` the quick starts, in the twelve languages other than English.

Written without a check against the programs themselves: the names of OBS's own menu items and buttons in Dutch, Brazilian Portuguese and Turkish (`obsUi…` and the sentences that quote them). Compare them with OBS in each language.

Fadester Suite Setup and the Fadester Companion installer open in the same 13 languages (`installer/lang/`, see `installer/README.md`).

Still English on both: the full guide `START-HERE.html` (the control map and recovery), the bridge's and the host's own Activity lines, and on the Mac the rare messages about a damaged settings file (`Settings` validation in `Model.swift`) and the T-bar helper's permission window.

No action is called "take" anywhere: the TourBox label is **Preview to Program**, and the texts say fade and cut. The action ids (`take`, `take.cut`) are protocol names and are unchanged. A preset imported before this change keeps its old label until it is imported again; its shortcuts are the same, so the old-preset warning does not appear on Windows. The Mac app compares the preset file itself and offers the updated one.

## Suggested follow-ups, in priority order

1. **Check the Mac app on a real Mac.** CI builds and self-tests it on both architectures; what is left needs a screen and hardware: open the released ZIP past Gatekeeper, check the lights, the menu-bar icon, Command-V in the password field, the meter line, Stream Deck-only mode and a non-English language (`--language de`, `--language ja`, `--language tr`) on screen, grant Accessibility, and rehearse with a TourBox.
2. **Look at the dark appearance on screen.** Windows: the pictures from `--render FILE.png --theme dark` were checked for every tab; the window itself (title bar, scroll bars, an open drop-down list, the game controller table with its rows) was not. Mac: not built or seen. Still light in dark mode: the Show-me guide windows on both, the Mac setup diagram, and on Windows the spin-box arrows and check-box squares.
3. **Shorter Setup page.** See the proposal below. It needs an on-screen review, so it was not changed blind.
4. **Setup diagram on Windows** (or none on either: the lights say the same in less space; the owner's choice).
5. **The Mac's Activity lines in words**, as on Windows.
6. **Game controller on the Mac.** This would be a new feature (Apple's GameController framework), not a parity fix.

## Proposal: a shorter Windows Setup page

Not implemented: it changes what a newcomer sees first, so it needs an on-screen review by the owner.

Today the Windows Setup tab is one long scrolling page: Connect to OBS, Choose your controller (game controller and TourBox), Try Preview, Assign your inputs, Whole mix and VJster. The last two are optional and hold most of the controls.

Proposed:
1. **Collapse the two optional sections by default.** Show each as one line with its title, a one-line summary of its state ("Off", "On, Stream Deck only", "On, Chrome & OBS page, port 48150") and a **Show** / **Hide** link. Open a section by itself when it is on and its light is amber or red, so a problem is never hidden.
2. **Fold "Assign your inputs" into Try Preview**, as one sentence with a link that opens the Assignments tab.
3. **Keep the order** a newcomer acts in: OBS, controller, first cue, then the optional sections.
4. **Remember** which optional sections were opened (a panel preference, not in `config.json`).

Expected result: steps 1 to 3 fit on the first screen without scrolling at the default 780 × 700 window. Check on screen before building: wrapping at 125% and 150% display scaling, the longest translations (German, Russian), keyboard focus order, and the same change on the Mac panel for parity.
