# Fadester Suite: Start Here

One guide for choosing what to install, setting up OBS Studio once, and checking that every piece is ready before a show.

Everything in the Fadester Suite runs locally on your own computer (`127.0.0.1` loopback only, no cloud accounts, no analytics). Install only the pieces your rig uses:

- **Fadester for OBS** — Stream Deck and OpenDeck plugin (includes the 7 VJster video actions).
- **Fadester Companion** — Desktop app for Xbox / XInput controllers and TourBox on Windows, and TourBox on the Mac (Apple silicon and Intel; ad-hoc signed, not notarized, physical TourBox control of OBS not yet rehearsed on a Mac), plus the whole-mix audio provider.
- **Midi Fadester** — OBS Studio 33 plugin for APC40 mkII, generic MIDI desks, smooth in-process Studio Mode T-bar, and 18 shared fader/FX slots.
- **Visual Sidechain** — part of **Midi Fadester** since 0.9.0 (no separate install): audio-reactive shaders (with a global 3 Hz flash ceiling), Audio Modulator, tempo/bar grid, Panic / Restore visuals, and Tape Deck local/network video speed control.
- **Playlister** — OBS Studio 33 plugin for persistent multi-clip video playlists with transport controls.
- **VJster Chrome extension** — Controls playback speed and YouTube quality in Chrome tabs.

**Want several of these at once on Windows?** The **Fadester Suite Setup** ([`installer/`](../installer/README.md)) installs any mix in one pass.
- Each plugin and Fadester Companion keeps its own version and its own entry in **Installed apps**.
- It never closes OBS for you, and never replaces a newer installed component.
- It is built and tested by a manual GitHub Actions workflow, and is not code-signed yet.

---

## 1. What do you have?

Find your controller below and install **only** the listed items, in order. You can always add optional OBS plugins later.

> **Visual Sidechain is part of Midi Fadester since 0.9.0.** Install Midi Fadester to get it; there is no separate Visual Sidechain download any more. If you have the old separate plugin, the Midi Fadester installer removes it.

| What you have | Install in this order | Install links |
|---|---|---|
| **Stream Deck** (15-key or 32-key) | 1. OBS Studio 33.x<br>2. **Fadester for OBS** (`.streamDeckPlugin`); ready-made layouts for the 15-key deck, none for the 32-key deck yet (drag **Scene** onto a key)<br>3. *(Optional)* **Visual Sidechain** (comes with Midi Fadester 0.9.0 or later), **Playlister**, **Midi Fadester**, **Fadester Companion** (only if you want whole-mix volume across every OBS mixer input), **VJster Chrome extension** | 1. [Fadester for OBS — Three steps](../README.md#three-steps-to-the-first-working-key)<br>2. [Visual Sidechain (in Midi Fadester)](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md)<br>3. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>4. [Midi Fadester — Install](https://github.com/jbrick2070/midi-fadester#install)<br>5. [VJster — Install](vjster/INSTALL.md#install) |
| **Stream Deck +** (4 dials + touch strip + 8 keys) | 1. OBS Studio 33.x<br>2. **Fadester for OBS** (`.streamDeckPlugin`)<br>3. *(Recommended for smooth dial T-bar without window visibility limits)* **Midi Fadester**<br>4. *(Optional)* **Visual Sidechain** (comes with Midi Fadester 0.9.0 or later), **Playlister**, **Fadester Companion** (whole-mix provider), **VJster Chrome extension** | 1. [Fadester for OBS — Three steps](../README.md#three-steps-to-the-first-working-key)<br>2. [Midi Fadester — Install](https://github.com/jbrick2070/midi-fadester#install)<br>3. [Visual Sidechain (in Midi Fadester)](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md)<br>4. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>5. [VJster — Install](vjster/INSTALL.md#install) |
| **Stream Deck Mini** (6 keys) | 1. OBS Studio 33.x<br>2. **Fadester for OBS** (`.streamDeckPlugin`) — its ready-made layout for the Mini is **Source Desk Mini · 6 keys**<br>3. *(Optional)* **Visual Sidechain** (comes with Midi Fadester 0.9.0 or later), **Playlister**, **VJster Chrome extension** | 1. [Fadester for OBS — Three steps](../README.md#three-steps-to-the-first-working-key)<br>2. [Visual Sidechain (in Midi Fadester)](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md)<br>3. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>4. [VJster — Install](vjster/INSTALL.md#install) |
| **Stream Deck Neo** (8 keys + Info Bar) | 1. OBS Studio 33.x<br>2. **Fadester for OBS** (`.streamDeckPlugin`) — includes **Scene Info Bar** for the Neo Info Bar and **Visual Sidechain Meter**; no ready-made layout for the Neo yet, drag **Scene** onto a key<br>3. *(Optional)* **Visual Sidechain** (comes with Midi Fadester 0.9.0 or later), **Playlister**, **VJster Chrome extension** | 1. [Fadester for OBS — Three steps](../README.md#three-steps-to-the-first-working-key)<br>2. [Visual Sidechain (in Midi Fadester)](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md)<br>3. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>4. [VJster — Install](vjster/INSTALL.md#install) |
| **OpenDeck** (Linux, Windows, or macOS) | 1. OBS Studio 33.x<br>2. **Fadester for OBS** built or packed as `.streamDeckPlugin`, installed in OpenDeck<br>3. *(Optional)* Starter profile generator + optional OBS plugins (**Midi Fadester**, which includes **Visual Sidechain**, and **Playlister**) | 1. [OpenDeck guide — First five minutes](OPENDECK.md#first-five-minutes)<br>2. [Midi Fadester — Install](https://github.com/jbrick2070/midi-fadester#install)<br>3. [Visual Sidechain (in Midi Fadester)](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md)<br>4. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install) |
| **A MIDI desk** (Akai APC40 mkII, APC mini mk2, MIDImix, nanoKONTROL2, Launch Control XL, or generic MIDI) | 1. OBS Studio 33.x<br>2. **Midi Fadester** in OBS (**Tools > Midi Fadester**)<br>3. *(Optional)* **Visual Sidechain** (comes with Midi Fadester 0.9.0 or later), **Playlister**, **Fadester Companion** (only if assigning Midi Fadester's Master fader to `mix_master` whole-mix control) | 1. [Midi Fadester — Install](https://github.com/jbrick2070/midi-fadester#install)<br>2. [Visual Sidechain (in Midi Fadester)](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md)<br>3. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>4. [Fadester Companion](../tourbox/README.md#first-five-minutes-game-controller) |
| **A full-size TourBox** (three rotaries, Side, Tour, C1/C2 and a D-pad) | 1. OBS Studio 33.x + **TourBox Console**<br>2. **Fadester Companion** (Windows Store or standalone ZIP; Mac ZIP for Apple silicon or Intel, not notarized)<br>3. In Fadester Companion click **Import into TourBox Console**, then turn **Auto Switch** off and select **OBS Fadester for TourBox**<br>4. *(Optional)* **Midi Fadester** (includes **Visual Sidechain**), **Playlister**, **VJster Chrome extension** | 1. [Fadester Companion — Connect a TourBox](../tourbox/README.md#connect-a-tourbox)<br>2. [Fadester Companion for Mac](../tourbox/MACOS.md)<br>3. [Visual Sidechain (in Midi Fadester)](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md)<br>4. [VJster — Install](vjster/INSTALL.md#install) |
| **An Xbox or XInput controller** (Windows) | 1. OBS Studio 33.x<br>2. **Fadester Companion** (Windows)<br>3. Tick **Use an Xbox or XInput game controller** on the **Setup** tab, then click **Stop** and **Start**; the right trigger then drives the Studio Mode T-bar<br>4. *(Optional)* **Visual Sidechain** (comes with Midi Fadester 0.9.0 or later), **Playlister**, **Midi Fadester**, **VJster Chrome extension** | 1. [Fadester Companion — First five minutes (game controller)](../tourbox/README.md#first-five-minutes-game-controller)<br>2. [Visual Sidechain (in Midi Fadester)](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md)<br>3. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install) |
| **Nothing** (mouse/keyboard + OBS only) | 1. OBS Studio 33.x<br>2. Install whichever OBS plugins match your show:<br>   - **Playlister** for persistent playlists of clips<br>   - **Midi Fadester**, which includes **Visual Sidechain**, for audio-reactive shaders, Audio Modulator, and Tape Deck Browser Sources | 1. [Playlister — Install](https://github.com/jbrick2070/obs-playlister#install)<br>2. [Visual Sidechain (in Midi Fadester)](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md) |

> **One VJster link owner at a time.** **Fadester for OBS**, the standalone **VJster** Stream Deck plugin, and **Fadester Companion** all default to loopback port `48150` for VJster. If you install **Fadester for OBS**, do **not** also install the standalone **VJster** plugin (`Fadester for OBS` already includes all seven VJster actions). If you also run **Fadester Companion**, turn off VJster in one of them so only one program holds port `48150`. When Fadester for OBS holds the port, Fadester Companion shows a grey *VJster: on your Stream Deck* light and nothing needs fixing.

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

Work down this list once. On Stream Deck or OpenDeck, open any **Fadester for OBS** key's settings, click the line at the foot of the page and open **Setup checklist**: it checks every line below by itself and gives a one-sentence fix for anything still off. Red there means it must be fixed; Studio Mode, the Fade transition and the OBS version are notes, needed only for the T-bar and Preview controls.

1. **Enable `obs-websocket` in OBS.**
   - Open OBS Studio 33.x and click **Tools > WebSocket Server Settings**.
   - Tick **Enable WebSocket server** and click **Apply**. Leave the port and **Enable Authentication** as they are.
   - **Fadester Companion** reads OBS's saved password from OBS's local config automatically.
   - **Fadester for OBS** (Stream Deck / OpenDeck) also reads the password and the port by itself when OBS runs on the same computer (from OBS's local config: `%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json` on Windows, `~/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json` on macOS). There is nothing to fill in. For OBS on another computer, click the line at the foot of any key's settings page, open **OBS on another computer, or another port**, fill in host, port and password and click **Save for all controls & test**.
2. **Turn on Studio Mode.**
   - In OBS click **Studio Mode** (or **View > Studio Mode**) so **Preview** sits on the left and **Program** on the right. T-bar and Preview controls need Studio Mode on.
3. **Select the Fade transition.**
   - In OBS's **Scene Transitions** dock, set the active transition to **Fade**. OBS's manual T-bar mixes scenes smoothly only when **Fade** is selected.
4. **Keep OBS un-elevated and visible (Windows native T-bar).**
   - Do **not** launch OBS with **Run as administrator** while Stream Deck or Fadester Companion runs as your normal Windows user — Windows UIPI blocks a normal-user process from driving an elevated OBS window's Studio Mode slider.
   - Keep OBS's main window open on the desktop (it may sit behind other windows, just **not minimised** to the taskbar) when driving OBS's built-in Studio Mode T-bar without Midi Fadester. (If **Midi Fadester** owns the T-bar in-process, OBS may be minimised.)
5. **TourBox Console import and Auto Switch (TourBox users only).**
   - Open **TourBox Console**, click **Import into TourBox Console** in Fadester Companion (it copies the preset's path) and paste it in Console's import window.
   - Turn **Auto Switch** off and select **OBS Fadester for TourBox**, so the one preset works whichever application is in front. (Keeping Auto Switch on instead? Link the preset to OBS, `obs64.exe` on Windows or `OBS.app` on macOS, and to Google Chrome to control videos with Chrome in front.)
6. **macOS Accessibility per host app *(not yet verified on hardware)*.**
   - macOS grants Accessibility per host application. In **System Settings > Privacy & Security > Accessibility**, enable the app that actually drives OBS's native T-bar (`Elgato Stream Deck.app`, `OpenDeck.app`, or **Fadester Companion.app**, whose bundled helpers appear as **Fadester Companion T-bar** and **Fadester Companion Shortcuts**).

---

## 4. Names

Every piece of the Fadester Suite uses one consistent set of English terms so controls, settings, and logs never say two names for the same thing or one name for two different things:

| Term | What it means | What it is NOT |
|---|---|---|
| **Fadester for OBS** | The Stream Deck and OpenDeck plugin, including the 7 bundled VJster actions | Not called bare `"Fadester"`, `"Stream Deck Fadester"`, or `"Stream Deck companion"` |
| **Fadester Companion** | The desktop app for Xbox / XInput controllers, TourBox, and the whole-mix audio provider | Not Bitfocus Companion, and not the Stream Deck plugin (its Windows app file is `Fadester Companion.exe`) |
| **Whole mix** | Moving every public OBS mixer input together while keeping their balance (`io.github.jbrick2070.fadester.mix.v1`, Midi Fadester `mix_master` target) | **All OBS mixer inputs** is the picker option that selects **Whole mix**; Midi Fadester's **Master** strip is a separate single-slot fader (Desktop Audio by default) |
| **Restore visuals** vs **Restore mix** | **Restore visuals** undoes Visual Sidechain's **Panic** (hold `0.8 s`); **Restore mix** returns **Whole mix** inputs to their pre-fade balance | Never bare `"Restore"` without saying whether it restores visuals or the audio mix |
| **Clean FX** vs **Clean / All FX Off** | **Clean FX** is the short label on deck keys and dials (`0 %`); **Clean / All FX Off** is the full name in settings and sentences for zeroing enabled filter slots (`reset_fx`) | Audio and layer controls stay untouched |
| **Layer 1 / Layer 2** | Two sources inside a scene (for blend modes, single-owner layer opacity, or Midi Fadester `crossfade_ab` A/B layer crossfading) | Scenes are never called layers or `LIVE` / `NEXT` |
| **Program / Preview** | OBS Studio Mode's on-air scene (**Program**) and next scene (**Preview**), matching OBS's own window labels | Never `LIVE` / `NEXT` for scenes; `crossfade_ab` and **A/B crossfader** name the two-layer crossfade mode itself |
| **Cue to start** vs **Preview** | **Cue to start** rewinds a Visual Sidechain **Tape Deck** clip to `0.0 s`; putting an OBS scene on standby in Studio Mode is always called **Preview** | Never bare `"Cue"` for putting a scene in Preview |
