# Fadester Suite: Start Here

Which pieces of the Fadester Suite to install for your hardware, and how to set up OBS Studio once. Everything runs on your own computer (`127.0.0.1` loopback only, no cloud accounts, no analytics).

## Most people: a Stream Deck

<img src="images/first-key-steps.svg" alt="The first working key in three steps: 1, double-click the .streamDeckPlugin file and press Install; 2, in OBS, Tools, WebSocket Server Settings, tick Enable WebSocket server; 3, drag Scene onto a key in Stream Deck and press it: OBS goes to the next scene." width="900">

1. **Install Fadester for OBS.** On the [Releases page](https://github.com/jbrick2070/streamdeck-fadester/releases/latest), download the file ending in `.streamDeckPlugin` and double-click it; in Stream Deck press **Install**.
2. **Turn on OBS's WebSocket server.** In OBS Studio 33's menu bar: **Tools > WebSocket Server Settings**, tick **Enable WebSocket server**, press **OK**. There is nothing to copy: the plugin reads the port and password OBS saved.
3. **Drag Scene onto a key.** In Stream Deck's action list, category *Fadester for OBS*, drag **Scene** onto a key and press it: OBS goes to the next scene. For a full deck, click the key, click the line at the foot of its settings page and open **Ready-made layouts**.

That's it. Another controller, or more pieces? Find your hardware in [section 1](#1-what-do-you-have).

Quick start in other languages: [Deutsch](quickstart/de.md#start-here) · [Español](quickstart/es.md#start-here) · [Français](quickstart/fr.md#start-here) · [Italiano](quickstart/it.md#start-here) · [日本語](quickstart/ja.md#start-here) · [한국어](quickstart/ko.md#start-here) · [Nederlands](quickstart/nl.md#start-here) · [Português (Brasil)](quickstart/pt-BR.md#start-here) · [Русский](quickstart/ru.md#start-here) · [Türkçe](quickstart/tr.md#start-here) · [简体中文](quickstart/zh-CN.md#start-here) · [繁體中文](quickstart/zh-TW.md#start-here)

## The pieces

- **Fadester for OBS**: the Stream Deck and OpenDeck plugin, with the 7 VJster video actions.
- **Fadester Companion**: desktop app for Xbox / XInput controllers and TourBox on Windows, and TourBox on the Mac (not notarized; TourBox control of OBS not yet rehearsed on a Mac); also the whole-mix audio provider.
- **Midi Fadester**: OBS Studio 33 plugin for APC40 mkII and other MIDI desks, a smooth in-process Studio Mode T-bar, and 18 shared fader/FX slots.
- **Visual Sidechain**: part of Midi Fadester since 0.9.0: audio-reactive shaders (with a global 3 Hz flash ceiling), Audio Modulator, tempo grid, Panic / Restore visuals, and Tape Deck video speed control.
- **Playlister**: OBS Studio 33 plugin for multi-clip video playlists with transport controls.
- **VJster Chrome extension**: playback speed and YouTube quality in Chrome tabs.

**Several at once on Windows?** The **Fadester Suite Setup** ([`installer/`](../installer/README.md)), `Fadester-Suite-Setup-<version>-Windows-x64.exe` in every release from 1.5.0, installs any mix in one pass. Each piece keeps its own version and entry in **Installed apps**; it never closes OBS and never replaces a newer component. It is not code-signed yet.

---

## 1. What do you have?

Install **only** the listed items, in order. Visual Sidechain comes with Midi Fadester 0.9.0 or later (the Midi Fadester installer removes an old separate Visual Sidechain).

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

> **One VJster link owner at a time.** Fadester for OBS, the standalone VJster plugin and Fadester Companion all use port `48150` for VJster. With Fadester for OBS, do **not** also install the standalone VJster plugin (it already has all seven VJster actions); if you also run Fadester Companion, turn VJster off in one of them. A grey *VJster: on your Stream Deck* light in Fadester Companion means all is well.

---

## 2. Which video player when

Four players have speed control: VJster in a Chrome tab, the VJster OBS page, Visual Sidechain's Tape Deck and Playlister. Speed ranges, what each plays and which to pick: [VIDEO-PLAYERS.md](VIDEO-PLAYERS.md).

---

## 3. First-run steps (every setup)

Do these once; the details are in [OBS-SETUP.md](OBS-SETUP.md). On Stream Deck or OpenDeck, the **Setup checklist** (click the line at the foot of any Fadester for OBS settings page) checks them for you.

1. **Enable the WebSocket server** in OBS: **Tools > WebSocket Server Settings**, tick **Enable WebSocket server**. Fadester for OBS and Fadester Companion read the saved password themselves.
2. **Turn on Studio Mode** (**View > Studio Mode**): **Preview** on the left, **Program** on the right. T-bar and Preview controls need it.
3. **Select the Fade transition** in OBS's **Scene Transitions** dock; OBS's T-bar mixes smoothly only with Fade.
4. **Windows:** do not run OBS as administrator, and do not minimise it while driving its own T-bar without Midi Fadester.
5. **TourBox:** click **Import into TourBox Console** in Fadester Companion, then turn **Auto Switch** off and select **OBS Fadester for TourBox**.
6. **macOS:** allow the app that drives the T-bar in **System Settings > Privacy & Security > Accessibility** (not yet verified on hardware).

---

## 4. Names

One set of English terms across the suite, so nothing has two names ([NAMES.md](NAMES.md) has the full table):

| Term | What it means | What it is NOT |
|---|---|---|
| **Fadester for OBS** | The Stream Deck and OpenDeck plugin, with the 7 VJster actions | Not bare `"Fadester"` or `"Stream Deck companion"` |
| **Fadester Companion** | The desktop app for Xbox / XInput, TourBox and the whole-mix audio | Not Bitfocus Companion, not the Stream Deck plugin |
| **Whole mix** | Every public OBS mixer input moved together, keeping their balance | **All OBS mixer inputs** is the picker option that selects it; Midi Fadester's **Master** strip is one single fader |
| **Restore visuals** vs **Restore mix** | **Restore visuals** undoes Visual Sidechain's **Panic** (hold `0.8 s`); **Restore mix** returns the Whole mix to its balance | Never bare `"Restore"` |
| **Clean FX** vs **Clean / All FX Off** | **Clean FX** is the short key label; **Clean / All FX Off** the full name for zeroing filter slots (`reset_fx`) | Audio and layers stay untouched |
| **Layer 1 / Layer 2** | Two sources inside a scene (blend modes, layer opacity, Midi Fadester `crossfade_ab`) | Scenes are never layers |
| **Program / Preview** | OBS Studio Mode's on-air scene and next scene, as OBS labels them | Never `LIVE` / `NEXT` |
| **Cue to start** vs **Preview** | **Cue to start** rewinds a **Tape Deck** clip to `0.0 s`; a scene on standby is in **Preview** | Never bare `"Cue"` for a scene |
