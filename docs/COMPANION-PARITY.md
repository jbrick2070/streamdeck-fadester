# Fadester Companion: Windows and Mac parity

This page lists what the Fadester Companion window offers on each operating system. Each difference is marked as either **intentional** (the hardware or the OS requires it) or a **gap** (it could match, but does not yet). The Mac app is experimental and has not been verified on hardware.

Sources: `tourbox/panel/FadesterTourBox.cs` (Windows) and `tourbox/macos/panel/Panel.swift` (Mac).

## Window layout

| Part | Windows | Mac | Status |
| --- | --- | --- | --- |
| Header | Title and live status line | Title, app icon and live status line | Same |
| Readiness lights | OBS, Controller, Controls | OBS, TourBox, VJster, Controls | **Gap**: Windows has no TourBox or VJster light. The Mac has no game controller, so it has no Controller light. |
| Amber reminder strip | While controls run: OBS hidden, or OBS not in front while TourBox Console runs (text only) | OBS hidden or behind another app, with a **Bring OBS to Front** button | **Gap**: Windows has no button in the reminder |
| Tabs | Setup, Assignments, Game controller, Control map, Activity | Setup, Assignments, Control map, Activity | **Intentional**: the game controller is Windows only (XInput) |
| Footer buttons | Save & start controls, Save assignments, Show / hide feedback, Quick guide (Open settings only when `config.json` cannot be read) | Same four buttons | Same |
| "Keep this window open" note | Under the footer buttons, always visible | Under the footer buttons, always visible | Same (Windows moved it there from the bottom of Setup) |
| Panel languages | 10 (follows the Windows display language, or `--language`) | English only | **Gap** |

## Setup tab

| Step | Windows | Mac | Status |
| --- | --- | --- | --- |
| 1 Connect to OBS | Port, optional password, Read scenes and inputs, Program/Preview summary, Visual Sidechain meter line (also in the HUD) | Port, optional password, Read scenes and inputs, Program/Preview summary | **Gap**: the Mac shows no Visual Sidechain meter (`P1-3`) |
| Setup diagram | None | Clickable setup diagram | **Gap** on Windows |
| 2 Controller | Game controller (Easy mode) and TourBox: **Import into TourBox Console** copies the preset path and opens Console | TourBox: save the `.tb`, open Console, **Show me where to click**, download links | **Intentional** for the game controller. **Gap**: Windows has no "Show me where to click" import guide. |
| macOS Accessibility | Not applicable | Grant Accessibility, native helper window, status | **Intentional** (macOS permission) |
| 3 Try Preview | Present | Present | Same |
| Optional: VJster | Enable, port, extension ID, **Target**, **OBS video URL / ID**, **Copy OBS Browser Source URL** | Same fields | Same (Windows gained Target and the OBS page link in this change) |
| Optional: Whole mix | Enable, **Use only Stream Deck, OpenDeck or MIDI**, step (dB), fade (ms) | Enable, step (dB), fade (ms) | **Gap**: the Mac has no Stream Deck-only mode. `FadesterMacHost` has no `--mix-only` flag, and the separate `FadesterMixHost` is not bundled in the app. |

## Assignments, Control map, Activity

These match on both systems:
- **Assignments:** six sources, four Preview anchors, **Assign the first four OBS scenes**, Layer 1 and Layer 2 scene and source, and the five **Adjust the feel** values.
- **Control map:** the same table with category icons.
- **Activity:** the same log.

## Suggested follow-ups, in priority order

1. **Mac Stream Deck-only mode.** Add `--mix-only` to `FadesterMacHost`, or bundle `FadesterMixHost`, then add the matching checkbox to the Mac panel. It is a small change in shared C#, but it must be verified on a Mac.
2. **Mac Visual Sidechain meter.** Show the `P1-3` meter line in the Mac Setup tab and HUD, as Windows does.
3. **Windows TourBox and VJster lights.** Show TourBox Console and VJster readiness in the Windows light strip, as the Mac does, so the next fix is visible without reading Activity.
4. **Windows "Show me where to click" for the TourBox import, and a Bring OBS to Front button in the reminder.** Reuse the existing `ShowMe.cs` animation used for OBS.
5. **Mac panel languages.** Move the Mac panel strings into a catalog shared with, or generated from, `PanelText.cs` and `PanelExtraText.cs`.
6. **Shorter Windows Setup page.** Consider collapsing the optional VJster and Whole mix sections by default. This needs an on-screen review, so it was not changed blind.
7. **Game controller on the Mac.** This would be a new feature (Apple's GameController framework), not a parity fix.
