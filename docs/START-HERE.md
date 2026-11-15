# Fadester Suite: Start Here

One guide for choosing what to install, setting up OBS Studio once, and checking that every piece is ready before a show.

Everything in the Fadester Suite runs locally on your own computer (`127.0.0.1` loopback only, no cloud accounts, no analytics). Install only the pieces your rig uses:

- **Fadester for OBS** (`streamdeck-fadester`) — Stream Deck and OpenDeck plugin (includes the 7 VJster video actions).
- **Fadester Companion** (`streamdeck-fadester/tourbox/`) — Desktop app for Xbox / XInput controllers and TourBox on Windows (and an experimental, not verified on hardware macOS host), plus the whole-mix audio provider.
- **Midi Fadester** (`midi-fadester`) — OBS Studio 33 plugin for APC40 mkII, generic MIDI desks, smooth in-process Studio Mode T-bar, and 18 shared fader/FX slots.
- **Visual Sidechain** (`visual-sidechain`) — OBS Studio 33 plugin for audio-reactive shaders (with a global 3 Hz flash ceiling), Audio Modulator, tempo/bar grid, Panic / Restore visuals, and Tape Deck local/network video speed control.
- **Playlister** (`obs-playlister`) — OBS Studio 33 plugin for persistent multi-clip video playlists with transport controls.
- **VJster Chrome extension** (`streamdeck-fadester/vjster-extension/`) — Controls playback speed and YouTube quality in Chrome tabs.

**Want several of these at once on Windows?** The **Fadester Suite Setup** ([`installer/`](../installer/README.md)) installs any mix in one pass.
- Each plugin and Fadester Companion keeps its own version and its own entry in **Installed apps**.
- It never closes OBS for you, and never replaces a newer installed component.
- It is built and tested by a manual GitHub Actions workflow, and is not code-signed yet.

---

## 1. What do you have?

Find your controller below and install **only** the listed items, in order. You can always add optional OBS plugins later.

| What you have | Install in this order | Install links |
|---|---|---|
| **Stream Deck** (15-key or 32-key) | 1. OBS Studio 33.x<br>2. **Fadester for OBS** (`.streamDeckPlugin`)<br>3. *(Optional)* **Visual Sidechain**, **Playlister**, **Midi Fadester**, **Fadester Companion** (only if you want whole-mix volume across every OBS mixer input), **VJster Chrome extension** | 1. [Fadester for OBS — First five minutes](../README.md#first-five-minutes)<br>2. [Visual Sidechain — Installation](https://github.com/jbrick2070/visual-sidechain#installation-obs-studio-3300-on-windows-x64)<br>3. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>4. [Midi Fadester — Install](https://github.com/jbrick2070/midi-fadester#install)<br>5. [VJster — Install](vjster/INSTALL.md#install) |
| **Stream Deck +** (4 dials + touch strip + 8 keys) | 1. OBS Studio 33.x<br>2. **Fadester for OBS** (`.streamDeckPlugin`)<br>3. *(Recommended for smooth dial T-bar without window visibility limits)* **Midi Fadester**<br>4. *(Optional)* **Visual Sidechain**, **Playlister**, **Fadester Companion** (whole-mix provider), **VJster Chrome extension** | 1. [Fadester for OBS — First five minutes](../README.md#first-five-minutes)<br>2. [Midi Fadester — Install](https://github.com/jbrick2070/midi-fadester#install)<br>3. [Visual Sidechain — Installation](https://github.com/jbrick2070/visual-sidechain#installation-obs-studio-3300-on-windows-x64)<br>4. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>5. [VJster — Install](vjster/INSTALL.md#install) |
| **Stream Deck Mini** (6 keys) | 1. OBS Studio 33.x<br>2. **Fadester for OBS** (`.streamDeckPlugin`) — pick the **OBS Switcher Mini** or **VJster Mini** ready-made layout<br>3. *(Optional)* **Visual Sidechain**, **Playlister**, **VJster Chrome extension** | 1. [Fadester for OBS — First five minutes](../README.md#first-five-minutes)<br>2. [Visual Sidechain — Installation](https://github.com/jbrick2070/visual-sidechain#installation-obs-studio-3300-on-windows-x64)<br>3. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>4. [VJster — Install](vjster/INSTALL.md#install) |
| **Stream Deck Neo** (8 keys + Info Bar) | 1. OBS Studio 33.x<br>2. **Fadester for OBS** (`.streamDeckPlugin`) — includes **OBS Status** and **Visual Sidechain Meter** for the Neo Info Bar<br>3. *(Optional)* **Visual Sidechain**, **Playlister**, **VJster Chrome extension** | 1. [Fadester for OBS — First five minutes](../README.md#first-five-minutes)<br>2. [Visual Sidechain — Installation](https://github.com/jbrick2070/visual-sidechain#installation-obs-studio-3300-on-windows-x64)<br>3. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>4. [VJster — Install](vjster/INSTALL.md#install) |
| **OpenDeck** (Linux, Windows, or macOS) | 1. OBS Studio 33.x<br>2. **Fadester for OBS** built or packed as `.streamDeckPlugin`, installed in OpenDeck<br>3. *(Optional)* Starter profile generator + optional OBS plugins (**Midi Fadester**, **Visual Sidechain**, **Playlister**) | 1. [OpenDeck guide — First five minutes](OPENDECK.md#first-five-minutes)<br>2. [Midi Fadester — Install](https://github.com/jbrick2070/midi-fadester#install)<br>3. [Visual Sidechain — Installation](https://github.com/jbrick2070/visual-sidechain#installation-obs-studio-3300-on-windows-x64)<br>4. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install) |
| **A MIDI desk** (Akai APC40 mkII, APC mini mk2, MIDImix, nanoKONTROL2, Launch Control XL, or generic MIDI) | 1. OBS Studio 33.x<br>2. **Midi Fadester** in OBS (**Tools > Midi Fadester**)<br>3. *(Optional)* **Visual Sidechain**, **Playlister**, **Fadester Companion** (only if assigning Midi Fadester's Master fader to `mix_master` whole-mix control) | 1. [Midi Fadester — Install](https://github.com/jbrick2070/midi-fadester#install)<br>2. [Visual Sidechain — Installation](https://github.com/jbrick2070/visual-sidechain#installation-obs-studio-3300-on-windows-x64)<br>3. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>4. [Fadester Companion](../tourbox/README.md#first-five-minutes-game-controller) |
| **TourBox** (Elite, Elite Plus, NEO, or Lite) | 1. OBS Studio 33.x + **TourBox Console**<br>2. **Fadester Companion** (Windows Store or standalone ZIP; macOS host is *experimental, not verified on hardware*)<br>3. Import the `.tb` preset in TourBox Console and enable **Auto Switch** for OBS<br>4. *(Optional)* **Midi Fadester**, **Visual Sidechain**, **Playlister**, **VJster Chrome extension** | 1. [Fadester Companion — Connect a TourBox](../tourbox/README.md#connect-a-tourbox)<br>2. [Experimental macOS candidate](CROSS-PLATFORM-CANDIDATE.md)<br>3. [Visual Sidechain — Installation](https://github.com/jbrick2070/visual-sidechain#installation-obs-studio-3300-on-windows-x64)<br>4. [VJster — Install](vjster/INSTALL.md#install) |
| **An Xbox or XInput controller** (Windows) | 1. OBS Studio 33.x<br>2. **Fadester Companion** (Windows)<br>3. Press any button on the controller; triggers ride the Studio Mode T-bar right away<br>4. *(Optional)* **Visual Sidechain**, **Playlister**, **Midi Fadester**, **VJster Chrome extension** | 1. [Fadester Companion — First five minutes (game controller)](../tourbox/README.md#first-five-minutes-game-controller)<br>2. [Visual Sidechain — Installation](https://github.com/jbrick2070/visual-sidechain#installation-obs-studio-3300-on-windows-x64)<br>3. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install) |
| **Nothing** (mouse/keyboard + OBS only) | 1. OBS Studio 33.x<br>2. Install whichever OBS plugins match your show:<br>   - **Playlister** for persistent playlists of clips<br>   - **Visual Sidechain** for audio-reactive shaders, Audio Modulator, and Tape Deck Browser Sources | 1. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>2. [Visual Sidechain — Installation](https://github.com/jbrick2070/visual-sidechain#installation-obs-studio-3300-on-windows-x64) |

> **One VJster link owner at a time.** **Fadester for OBS**, the standalone **VJster** Stream Deck plugin, and **Fadester Companion** all default to loopback port `48150` for VJster. If you install **Fadester for OBS**, do **not** also install the standalone **VJster** plugin (`Fadester for OBS` already includes all seven VJster actions). If you also run **Fadester Companion**, turn off VJster in one of them so only one program holds port `48150`.

---

## 2. Which video player when

The suite has four ways to play video with speed control. Pick the one that matches where your clips live and whether you need live speed changes without restarting playback:

| Player | Plays | Speed range | Speed change | Pick it when |
|---|---|---|---|---|
| **VJster, Chrome tab** | YouTube (with quality control) or any allowed HTML5 `<video>` tab in Chrome | `25%–200% (0.25x–2x)` (`400% (4x)` when YouTube offers it; `10%–1600% (0.1x–16x)` extended) | Live | You are capturing a browser window and want live speed or YouTube quality control |
| **VJster, OBS page** | One YouTube video or playlist inside an OBS Browser Source | `25%–200% (0.25x–2x)` | Live | You want YouTube inside OBS with no Chrome window |
| **Tape Deck** *(in Visual Sidechain)* | One local or network video file inside an OBS Browser Source | `25%–800% (0.25x–8x)` | Live, with optional tape pitch | You want to ride the speed of one clip live from a dial, key, or MIDI fader |
| **Playlister** | Local files, folders, `.m3u`/`.pls` playlists, and URLs through OBS's Media Source | `1%–200% (0.01x–2x)` as a source setting | Restarts the clip from its beginning | You want a multi-clip running order with Next/Previous transport that survives edits |

---

## 3. First-run steps (every setup)

Work down this list once. On Stream Deck or OpenDeck, open any **Fadester for OBS** action's settings and expand **Setup checklist** under **OBS connection** — it checks every line below automatically and gives a one-sentence fix for anything still off.

1. **Enable `obs-websocket` in OBS.**
   - Open OBS Studio 33.x and click **Tools > WebSocket Server Settings**.
   - Tick **Enable WebSocket server**, keep port `4455` (unless you purposefully changed it), tick **Enable Authentication**, and click **Apply**.
   - **Fadester Companion** reads OBS's saved password from OBS's local config automatically.
   - **Fadester for OBS** (Stream Deck / OpenDeck): open **OBS connection** on any action's settings page and click **Use OBS's saved password**. It shows the port and confirms a password was found in OBS's local config (`%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json` on Windows, `~/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json` on macOS) before you click **Fill port & save password** — or paste the password manually and click **Save & test**.
2. **Turn on Studio Mode.**
   - In OBS click **Studio Mode** (or **View > Studio Mode**) so **Preview** sits on the left and **Program** on the right. T-bar and Preview controls need Studio Mode on.
3. **Select the Fade transition.**
   - In OBS's **Scene Transitions** dock, set the active transition to **Fade**. OBS's manual T-bar mixes scenes smoothly only when **Fade** is selected.
4. **Keep OBS un-elevated and visible (Windows native T-bar).**
   - Do **not** launch OBS with **Run as administrator** while Stream Deck or Fadester Companion runs as your normal Windows user — Windows UIPI blocks a normal-user process from driving an elevated OBS window's Studio Mode slider.
   - Keep OBS's main window open on the desktop (it may sit behind other windows, just **not minimised** to the taskbar) when driving OBS's built-in Studio Mode T-bar without Midi Fadester. (If **Midi Fadester** owns the T-bar in-process, OBS may be minimised.)
5. **TourBox Console import and Auto Switch (TourBox users only).**
   - Open **TourBox Console**, click **Import**, and import Fadester Companion's preset (`tourbox/presets/`).
   - Link the preset to OBS (`obs64.exe` on Windows, `OBS.app` on macOS) and turn **Auto Switch** on so TourBox switches to the Fadester preset whenever OBS or Companion is focused.
6. **macOS Accessibility per host app *(experimental, not verified on hardware)*.**
   - macOS grants Accessibility per host application. In **System Settings > Privacy & Security > Accessibility**, enable the app that actually drives OBS's native T-bar (`Elgato Stream Deck.app`, `OpenDeck.app`, or the experimental macOS development host).
   - **Known open issue on macOS:** Keychain password persistence in the experimental macOS candidate currently fails with `-25293` (`errSecAuthFailed` in non-interactive runs; see [CROSS-PLATFORM-CANDIDATE.md](CROSS-PLATFORM-CANDIDATE.md)). Do not rely on macOS Keychain storage until verified on hardware; pass `FADESTER_OBS_PASSWORD` or read local OBS config per session.

---

## 4. Compatibility matrix

Rows list suite features; columns show which component provides or consumes each feature. Release numbers are recorded at release time rather than guessed in advance.

| Feature | Fadester for OBS (Stream Deck / OpenDeck) | Fadester Companion (Desktop) | Midi Fadester (OBS plugin) | Visual Sidechain (OBS plugin) | Playlister (OBS plugin) |
|---|---|---|---|---|---|
| Direct OBS scenes, transitions, cuts, audio input faders, layers, filters | first release that includes it: `(placeholder, fill at release)` | first release that includes it: `(placeholder, fill at release)` (Windows; macOS *experimental, not verified on hardware*) | Not required | Not required | Not required |
| Native Studio Mode T-bar (without Midi Fadester) | first release that includes it: `(placeholder, fill at release)` (OBS `33.x`, Fade, Studio Mode, visible window) | first release that includes it: `(placeholder, fill at release)` (OBS `33.x`, Windows; macOS *experimental, not verified on hardware*) | Not required | Not required | Not required |
| Shared T-bar safety & recovery contract (`TBAR-SAFETY-CONTRACT.md`) | first release that includes it: `(placeholder, fill at release)` | first release that includes it: `(placeholder, fill at release)` | first release that includes it: `(placeholder, fill at release)` | — | — |
| Smooth in-process T-bar, 18 MIDI/WebSocket slots, `get_catalog`, `reset_fx` (`Clean / All FX Off`) | first release that includes it: `(placeholder, fill at release)` | first release that includes it: `(placeholder, fill at release)` (calls `midi-fadester` when present) | first release that includes it: `(placeholder, fill at release)` | first release that includes it: `(placeholder, fill at release)` (optional Speed/Parameter Fader bridge) | — |
| Single-owner Layer 2 opacity (`has_internal_opacity`, `opacity_slot`) | first release that includes it: `(placeholder, fill at release)` (reads catalog) | first release that includes it: `(placeholder, fill at release)` | first release that includes it: `(placeholder, fill at release)` | — | — |
| Whole-mix audio control (`All OBS mixer inputs` / `mix_master` with provider pin) | first release that includes it: `(placeholder, fill at release)` | first release that includes it: `(placeholder, fill at release)` (provider) | first release that includes it: `(placeholder, fill at release)` | — | — |
| Process-wide 3 Hz flash ceiling & `*_safe` uniforms / Modulator Flash guard | — | — | — | first release that includes it: `(placeholder, fill at release)` | — |
| Live Panic / Restore visuals truth (`get_safety`, `panic`, `restore`, `safety_changed`, hotkey fallback on older builds) | first release that includes it: `(placeholder, fill at release)` | first release that includes it: `(placeholder, fill at release)` | — | first release that includes it: `(placeholder, fill at release)` | — |
| Silence hold (`audio_present`, `beat_confidence`), tempo lock, tap tempo, 4-beat bar grid | first release that includes it: `(placeholder, fill at release)` (**Visual Sidechain Meter** & beat-quantized fades) | first release that includes it: `(placeholder, fill at release)` (tempo/meter readout & quantized takes) | — | first release that includes it: `(placeholder, fill at release)` | — |
| **Tape Deck** deck controls (`deck_command`, `decks_changed`, dual `%` / `x` speed readout) | first release that includes it: `(placeholder, fill at release)` | Follow-up (out of scope until preset map updates) | first release that includes it: `(placeholder, fill at release)` (optional Speed Fader) | first release that includes it: `(placeholder, fill at release)` | — |
| **Playlister** transport keys (Next, Previous, Play/Pause, Stop, Restart, Status) | first release that includes it: `(placeholder, fill at release)` (detects `obs_playlister_source` input kind; version unknown over WebSocket) | first release that includes it: `(placeholder, fill at release)` (media input transport) | — | — | first release that includes it: `(placeholder, fill at release)` |
| **VJster** Chrome tab & OBS Browser Source speed/quality + `GET /whoami` port-holder naming | first release that includes it: `(placeholder, fill at release)` | first release that includes it: `(placeholder, fill at release)` | — | — | — |
| Guided setup checklist & **Use OBS's saved password** button | first release that includes it: `(placeholder, fill at release)` | first release that includes it: `(placeholder, fill at release)` (readiness lights & local password read) | — | — | — |

---

## 5. Names

Every piece of the Fadester Suite uses one consistent set of English terms so controls, settings, and logs never say two names for the same thing or one name for two different things:

| Term | What it means | What it is NOT |
|---|---|---|
| **Fadester for OBS** | The Stream Deck and OpenDeck plugin (`io.github.jbrick2070.fadester-for-obs`, including the 7 bundled VJster actions) | Not called bare `"Fadester"`, `"Stream Deck Fadester"`, or `"Stream Deck companion"` |
| **Fadester Companion** | The desktop app (`streamdeck-fadester/tourbox/`) for Xbox / XInput controllers, TourBox, and the whole-mix audio provider | Not Bitfocus Companion, and not the Stream Deck plugin (its Windows `.exe` remains `Fadester for TourBox.exe` until a Store update adds a compatibility shim) |
| **Whole mix** | Moving every public OBS mixer input together while keeping their balance (`io.github.jbrick2070.fadester.mix.v1`, Midi Fadester `mix_master` target) | **All OBS mixer inputs** is the picker option that selects **Whole mix**; Midi Fadester's **Master** strip is a separate single-slot fader (Desktop Audio by default) |
| **Restore visuals** vs **Restore mix** | **Restore visuals** undoes Visual Sidechain's **Panic** (hold `0.8 s`); **Restore mix** returns **Whole mix** inputs to their pre-fade balance | Never bare `"Restore"` without saying whether it restores visuals or the audio mix |
| **Clean FX** vs **Clean / All FX Off** | **Clean FX** is the short label on deck keys and dials (`0 %`); **Clean / All FX Off** is the full name in settings and sentences for zeroing enabled filter slots (`reset_fx`) | Audio and layer controls stay untouched |
| **Layer 1 / Layer 2** | Two sources inside a scene (for blend modes, single-owner layer opacity, or Midi Fadester `crossfade_ab` A/B layer crossfading) | Scenes are never called layers or `LIVE` / `NEXT` |
| **Program / Preview** | OBS Studio Mode's on-air scene (**Program**) and next scene (**Preview**), matching OBS's own window labels | Never `LIVE` / `NEXT` for scenes; `crossfade_ab` and **A/B crossfader** name the two-layer crossfade mode itself |
| **Cue to start** vs **Preview** | **Cue to start** rewinds a Visual Sidechain **Tape Deck** clip to `0.0 s`; putting an OBS scene on standby in Studio Mode is always called **Preview** | Never bare `"Cue"` for putting a scene in Preview |
