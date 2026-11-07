# Changelog

What changed in Fadester for OBS and, where it says so, in VJster. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the plugin's own (`manifest.json`). There is no change control here: the newest entry is the version.

## Unreleased

- **OBS Fadester for TourBox drives YouTube and two VJ layers.** The companion hosts the VJster link itself (the loopback WebSocket the VJster Chrome extension connects to; the same rules and protocol as the Stream Deck plugin's), outside its OBS loop, so the video works with OBS closed. The one preset's layout changed: the raised Knob is the video's speed (press and turn for 0.05 steps, tap to read the video, Side + press for 1x), Scroll press-and-turn its quality, Side + D-pad Up play/pause; Music moved to Side + Dial. Hold Top for the VJ layers: Knob and Scroll cycle Layer 1's and Layer 2's blend mode, the Dial rides Layer 2's opacity through its Color Correction filter. The new actions use Ctrl+Shift and Alt+Shift F-key chords. The panel gets the VJster port and extension pin, Layer 1 and 2 and the opacity step; labels in nine languages; a port taken by the Stream Deck plugin's VJster is reported, never taken over. Self-tests cover the link and the layer actions; `tests/tourbox-vjster-link.test.ts` drives the built bridge with the real extension logic.

- **VJster Chrome extension 0.1.1:** the options page now says the extension needs the VJster plugin, with links to get it, the install steps and the privacy policy (in all 12 languages), and a first install opens that page. The manifest names the project's home page. Dutch is the extension's twelfth language.

## 0.10.0 - 2026-11-04

- Fadester’s bundle and all 17 suite actions now use the GitHub account namespace `io.github.jbrick2070.fadester-for-obs`. The previous `com.jbrick2070.fadester-for-obs` build and its custom profiles can stay installed during migration; the new plugin has separate settings. Re-enter the OBS password and use a new starter or rebind your controls. Standalone VJster keeps its own ID.
- First-time OpenDeck users can choose a working Scene Desk straight from the profile list (Source Desk on Mini). No source build is necessary. The optional source installer selects that layout on a new, empty deck. See the [OpenDeck guide](docs/OPENDECK.md#first-five-minutes).

## 0.9.1 - 2026-11-04

### Fixed

- **The display strip of a Stream Deck + in OpenDeck** drew a grey and black checkerboard instead of the dials' pictures. OpenDeck's strip renderer reads a layout picture only from a base64 data URI, and every dial sent the URL-encoded form that keys (and Stream Deck software) accept. Dials, in both Fadester and VJster, now send the strip picture as base64; keys are unchanged.
- The suite's generated files are compared without regard to line ends, so a fresh checkout on Windows or Linux no longer reports them out of date.

## 0.9.0 - 2026-11-04

### Added

- **One plugin suite** ([docs/SUITE.md](docs/SUITE.md)): the Fadester plugin now carries VJster's seven actions (**VJster Speed**, **Quality**, **Speed Preset**, **Speed Step**, **Quality Preset**, **Pin Tab**, **Play / Pause**), so one install gives seventeen actions. `bin/plugin.js` is a small launcher that registers with Stream Deck or OpenDeck once and runs the Fadester plugin and the VJster plugin as two programs, passing messages between them and the host; neither plugin's own code changed. Their stored settings sit side by side (VJster's under their own key) and a save by one never touches the other's. A program that stops is started again. The standalone VJster plugin is still built and released. Fadester's own action ids are unchanged; VJster's are `com.jbrick2070.fadester-for-obs.vjster-*`. VJster's Stream Deck profiles are not in the suite yet.
- **OpenDeck support** ([docs/OPENDECK.md](docs/OPENDECK.md)): `npm run opendeck:install` copies the plugin (Fadester, with VJster in it) into [OpenDeck](https://github.com/nekename/OpenDeck) (a free, open-source host for Stream Deck plugins) and puts VJster's starter keys and dials on the deck, filling free slots only, and `--fadester-layouts` writes Fadester's ready-made layouts as OpenDeck profiles (a multi-page rig becomes one profile per page). Tried on Windows with a Stream Deck +; the plugins themselves are unchanged.

### Changed

- The documentation was rewritten for ease of use: README, DECK-LAYOUTS.md, the profile library, VJster's README and INSTALL.md, and this changelog. Engineering records (REQUIREMENTS, PLAN, TESTING) are unchanged.
- The **Suite Demo Kit 1.1** (`demo-kit/`): real footage (the train, sprint and hurdles clips) full frame instead of the generated loops; one Playlister per scene, with the 50 % copy in its own scene; the **Suite Demo Kit +** profile is a Studio Mode layout: every scene key cues in Preview and dial 1 of every page is the scene mixer (Scene blend).

### Fixed

- The scene mixer's press (and the end of a queue-next throw) takes Next live on OBS 33.0.1. OBS 33.0.1 cancels a T-bar released over obs-websocket and Program snapped back; the press now leaves and re-enters Studio Mode instead, checks that Program is Next, and says so on the dial when it is not. OBS logs "Switched to regular Preview mode" and "Switched to Preview/Program mode" at each take.

### Planned for 0.8.1 (not yet in the code)

- Visual Panic's Restore key: a 2 s hold with a ring while holding and a green check when OBS accepts it (today 0.8 s).
- A first-five-minutes hint on the settings page.

## 0.8.0 - 2026-11-01

### Added

- **OBS Filter** (keys and dials): ride one filter setting on a dial (a Visual Sidechain Shader Filter's Effect mix or Reactivity, a Color Correction's opacity, or most numeric settings with a range), press to drop it while held; from a key, turn a filter on and off, glide a setting to a value, or step it. Writes are paced and never touch a setting an Audio Modulator or a fader drives.
- **Visual Panic** (keys): Visual Sidechain's Panic at once and Restore after a 0.8 s hold, through OBS's hotkeys; PANIC SENT on the keys until a Restore is accepted.
- **VJ Rig +** and **VJ Rig 15 Keys** layouts: four pages (Perform, Layers, Visuals, Scenes) with Panic on the same key on every page and Next page bottom left. Accent colours (brass, teal, magenta) on the direct actions.
- **Playlister Transport** (keys): Previous, Next, Play/pause, Stop, Restart and Status for one Playlister source, showing the state OBS reports; the **Playlister Transport +** layout. Needs Playlister 0.5 or later.
- **Language choice** on every settings page: Automatic (Stream Deck's language) or one of nine languages, now including **Dutch**. The choice applies to every Fadester control at once and survives restarts.
- Translations of every text the plugin draws or shows (keys, dials, the Info Bar, status sentences, the settings pages) in Elgato's eight languages: English, German, Spanish, French, Japanese, Korean, Simplified Chinese, Traditional Chinese.
- **VJster 0.2.0**: the OBS page (a browser source that plays a YouTube video at the speed the deck sets, 0.25x to 2x), the Target setting (Browser, OBS page, Both), the **VJster Dual +** profile, the same language choice with Dutch, and translations of the plugin, its settings page, the Chrome extension and the OBS page.
- The **Suite Demo Kit 1.0** (`demo-kit/`): one OBS scene collection, media and two Stream Deck + profiles that show Playlister, Visual Sidechain, Fadester for OBS and VJster together.

### Changed

- The bundled layouts are rebuilt with version 0.8.0.0; there are fourteen.
- VJster's static key images carry a number or a symbol instead of English words, so they fit every language.

### Fixed

- Saving global settings never loses a key, including writes that race each other, a write before the stored settings are known, and an older settings page's copy (both plugins).
- VJster's packed plugin now contains its OBS page (`bin/obs`).
- Wording: Korean "action" is 동작 in VJster as in Fadester; Dutch says "toets" and "draaiknop" for a key and a dial, and "Verbinding aanhouden" for keeping the link on.

## 0.7.7 - 2026-10-31

### Added

- **OBS Scene Info Bar** for the Stream Deck Neo: connection, live scene and, in Studio Mode, the preview scene. The plugin now needs Stream Deck 7.6.

## Earlier

- **2026-10-31**: VJster Phase 1 (the Stream Deck plugin, the Chrome extension, the loopback link, the install guide) and Phase 2 (the OBS page).
- **0.6.0 - 2026-10-28**: direct OBS controls (Scene & Transition, OBS Fader, OBS Fade, Source & Layer) and the dynamic starter layouts, with no Midi Fadester needed.
- **0.3.0 - 2026-10-28**: the Midi Fadester slot editor and controller panel in the settings page, safer connection handling.
- **0.2.0 - 2026-10-28**: the Midi Fadester FX catalog and clean controls.
- **2026-10-27**: the first build: a Midi Fadester Fader dial and Auto-fade key, with live OBS 33 conformance tests.
