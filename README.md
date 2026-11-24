# Fadester for OBS

**Fadester for OBS 1.5.0** puts OBS Studio on your Stream Deck: scenes, transitions, sources, filters and audio on keys and dials. It talks to OBS's built-in WebSocket server, so the main controls need no MIDI desk and no extra OBS plugin. Fourteen ready-made layouts. Thirteen languages.

> **Setting up the whole Fadester Suite?** Start with **[docs/START-HERE.md](docs/START-HERE.md)**: what to install for your controller, which video player to pick, first-run OBS settings, and the suite's names for things.

## Three steps to the first working key

<img src="docs/images/first-key-steps.svg" alt="The first working key in three steps: 1, double-click the .streamDeckPlugin file and press Install; 2, in OBS, Tools, WebSocket Server Settings, tick Enable WebSocket server; 3, drag Scene onto a key in Stream Deck and press it: OBS goes to the next scene." width="900">

1. **Install the plugin.** On the [Releases page](https://github.com/jbrick2070/streamdeck-fadester/releases/latest), download the file whose name ends in `.streamDeckPlugin` and double-click it. Stream Deck asks to install it: press **Install**.
2. **Turn on OBS's WebSocket server.** In OBS's menu bar: **Tools > WebSocket Server Settings**, tick **Enable WebSocket server**, press **OK**. Leave **Enable Authentication** as it is: there is nothing to copy.
3. **Drag Scene onto a key.** In Stream Deck's action list, open the category *Fadester for OBS* and drag **Scene** (the first action) onto a key. It starts as **Next scene**: press it, and OBS goes to the next scene in your list.

That's it. With OBS on the same computer the plugin finds OBS's port and signs in with the password OBS saved. While OBS is not connected, the key and the first line of its settings page say what to do, for example **Turn on OBS WebSocket** or **Start OBS**.

**Using [OpenDeck](docs/OPENDECK.md)**, the free open-source alternative to Elgato's Stream Deck software? Follow the [OpenDeck quick start](docs/OPENDECK.md#first-five-minutes); the packaged plugin brings a ready-made profile for the Plus, the 15-key deck and the Mini.

### Then, if you like

- **Fill the deck with a ready-made layout.** Click any Fadester for OBS key in Stream Deck to open its settings. Once OBS is connected, the first line reads **New deck? Fill it with a ready-made layout** (until you have clicked it once). Click it, pick a layout under **Ready-made layouts** and press **Open this layout**. It installs as a profile you can edit, your deck switches to it, and your other profiles stay.
- **Find the plugin's own settings** in the one line at the foot of every settings page, for example `Fadester for OBS 1.5.0 · Connected to OBS 33.0.1 · Settings`. Click it for **Language**, **OBS connection**, **Setup checklist** and **Ready-made layouts**. They apply to every Fadester for OBS key and dial.
- **OBS on another computer, or another port?** Click the foot line, open **OBS on another computer, or another port**, fill in the host, the port and OBS's password (in OBS: **Tools > WebSocket Server Settings > Show Connect Info**) and press **Save for all controls & test**. You type it once for all keys and dials.
- **Setup checklist.** Red marks what must be fixed (OBS reachable, password accepted). Studio Mode, the Fade transition, the OBS version and the T-bar rows are notes: they matter only for the controls that name them.

## Good to know

- **Needs** Stream Deck 7.6 or later (6.x is not supported) on Windows 10 or later or macOS 13.5 or later, and OBS Studio with its WebSocket server on (tested with OBS 33). Works on a Stream Deck, Stream Deck +, Stream Deck Mini and Stream Deck Neo.
- **One plugin, two products.** From 0.9.0 this plugin also carries [VJster](docs/vjster/README.md): speed and quality dials and keys for the video playing in Chrome or in an OBS browser source. Its seven actions are in the same list, named **VJster Speed** and so on. How that works: [docs/SUITE.md](docs/SUITE.md). VJster is still released on its own for decks with no OBS.
- **No profile appears by itself.** Stream Deck installs no profile with the plugin: a layout arrives the first time you open it, so your profile list stays yours. You can also double-click any layout's `.streamDeckProfile` file ([profile library](profiles/README.md)).
- **Upgrading from 0.9.x or earlier with a download from this page?** Since 0.10 the download here uses a new plugin ID. (A copy from the Elgato Marketplace keeps the old one and simply updates there; do not add this download to it.) Install it alongside the old version, let it sign in to OBS (it reads OBS's saved password by itself), then open a fresh layout or replace old Fadester actions in a copy of your custom profile. Keep the old plugin until you have checked the new controls. The standalone VJster ID has not changed.

## Ready-made layouts

All fourteen are in [DECK-LAYOUTS.md](DECK-LAYOUTS.md), key by key. The picker lists only the layouts for your deck, with the OBS mode in front: **[Studio Mode]**, **[Regular Mode]** or **[Either Mode]**, as in **[Studio Mode] Scene Desk +** or **[Regular Mode] Scene Desk · 15 keys**. In Stream Deck's own profile list the same layout is called **Fadester — Scene Desk + (Studio Mode)**.

| You want to | Open | Stream Deck + | 15 keys | Mini |
|---|---|---|---|---|
| Choose scenes in Preview, then send Preview to Program with Cut, the transition or the T-bar | **[Studio Mode] Scene Desk** | yes | yes | |
| Switch scenes directly, no Preview | **[Regular Mode] Scene Desk** | yes | yes | |
| Show and hide the sources of one scene, fade audio | **[Either Mode] Source Desk**, or **Half Source Desk**, which leaves half the deck free | yes | yes | yes |
| Try blend modes and layer order | **[Either Mode] Creative Layer Lab** | yes | yes | |
| Drive a Playlister source (needs Playlister 0.5) | **[Either Mode] Playlister Transport +** | yes | | |
| Run a VJ set: four pages with Panic on every page | **[Studio Mode] VJ Rig** | yes | yes | |

- A Studio Mode layout offers **Turn on Studio Mode and open** (or **Prepare Preview and open** when Studio Mode is already on) and prepares Preview for you; the button works once OBS is connected.
- Every layout is an editable copy: change, add or remove keys freely. Opening a layout a second time returns to your edited copy. Layouts never contain your password.
- The Stream Deck XL and the Neo have no ready-made layout yet; the page says so.

![The Perform page of the VJ Rig on a Stream Deck +, as an earlier version drew it (a render from the plugin's own controllers against a running OBS, not a photo; the words on the keys have changed since): Preview to Program, Previous, Next and Random scene keys, Playlister Play / pause and Next, Panic, a T-bar strip and Effect mix, Reactivity and Forest Camera dials.](docs/images/vj-rig-perform-page.png)

## The controls

![Photo of a Stream Deck + running an earlier version of Fadester for OBS in Dutch, before OBS was set up: scene keys, two Playlister keys, the red PANIEK (Panic) key, a T-bar strip and a Desktop Audio dial on the touch strip. Several keys still ask for Studio Mode or a Playlister to be picked.](docs/images/streamdeck-fadester-hero.jpg)

Every control is in the *Fadester for OBS* category of Stream Deck's action list, in this order. Drag one onto a key or dial and click it to open its settings.

**Scene** (key). **Next scene**, **Previous scene**, **Random scene**, a numbered scene, a scene by name, or **The scene in Preview (to Program)**. Under **When pressed**: **Transition to it** (OBS's current transition, or one you choose: Fade, Fade to Black, or any transition installed in OBS), **Cut to it**, or **Put it in Preview**.
- Cut and transitions work in both modes; Preview needs Studio Mode. Length in beats and a start on the beat are under **Timing**.
- Numbered scene keys follow positions in your OBS scene list, so they work without setup.
- A key whose scene is on Program has a red frame and the word PROGRAM; in Preview, a green frame and PREVIEW. The key names the transition it will use, for example **Next · Fade**.

**Volume & T-bar** (dial on a Stream Deck +). Turn to ride one audio input, or choose **Switch scenes (T-bar)** under **Control**: the strip shows the PROGRAM and PREVIEW scenes and the dial fades Preview into Program, as the APC40's crossfader does.
- Turn right all the way to finish the fade; let the dial rest a moment, then turn right again for the next one. A press sends Preview to Program at any point. The T-bar needs Studio Mode and two different scenes.
- **Dial press** is yours to choose: Preview to Program, next blend mode on the selected source, Normal blend, show or hide, or nothing. **Scene loop** can queue the next scene after each transition you finish, so one dial walks through your scenes.
- **No flash** when the dial can reach OBS's own on-screen T-bar slider: OBS 33 on the same computer, the Fade transition selected, and OBS's main window not minimised and not running as administrator (Windows) or Accessibility granted (macOS, experimental, full endpoints not yet verified on Mac hardware).
- **Otherwise** (over the network, another transition, OBS minimised or elevated, no Accessibility) the dial ends a fade by leaving and re-entering Studio Mode: OBS's own window flashes white for a moment, while the picture OBS sends out stays clean. The **Midi Fadester Fader** dial, with Midi Fadester installed, has none of these window or permission requirements.

**Audio Fade** (key). Fade one audio input to 0 % or to 100 % over a chosen time, or instantly. A later move of that input cancels its running fade.

**Whole-show fade.** Choose **All OBS mixer inputs** under **Control** on **Audio Fade** or **Volume & T-bar**. This needs [Fadester Companion](tourbox/README.md) (Windows, from the [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) or the release ZIP; Mac, from the release's `Fadester-Companion-macOS-*.zip`): turn on **All OBS mixer inputs** there, choose mix-only mode if you do not use a TourBox, and start its controls. The key fades out or restores the Whole mix; the dial adjusts it in the steps set in Fadester Companion. Restore mix returns each managed input to its own level. Normal source controls do not need Fadester Companion.

**Source & Layer** (key or dial). Browse the sources of the current scene with a dial or Previous/Next keys, and show or hide the selected one.
- The selection is shared by every Fadester for OBS control on that scene. It follows Preview in Studio Mode, otherwise Program; you can pin it to a fixed scene. A key that edits the scene on Program is framed red and says so.
- Optional creative controls cycle blend modes (Normal, Additive, Subtract, Screen, Multiply, Lighten, Darken) and move a layer up or down; reordering stays off until you turn it on.
- To fade a layer, put a Color Correction filter on it and ride its opacity with **Filter**.

**Filter** (key or dial). On a dial, ride one filter setting: a Visual Sidechain Shader Filter's Effect mix or Reactivity, a Color Correction's opacity, or most numeric settings you give a range (not modes, file paths, colours and a few safety settings). Press the dial to drop the value while held. On a key: turn a filter on or off, glide a setting to a value over a time, or step it. Choose the source and its filter once in the settings page. Changes are smoothed and never touch a setting an Audio Modulator or a fader already drives.

**Playlister** (key). **Previous**, **Next**, **Play / pause**, **Stop**, **Restart** or **Status** for one [Playlister](https://github.com/jbrick2070/obs-playlister) source, chosen in the key's settings page. Needs Playlister 0.5 or later in OBS.
- The key shows what OBS reports (Playing, Paused, Stopped, with the time), not just that a press was sent.
- With Playlister 1.5.0 or newer (the first that says what it plays, through its `get_now_next` request over obs-websocket), **Status** and **Play / pause** show the playing item's name instead of their own word, and **Next** names the item that follows (not with Shuffle on, where Playlister chooses the next item only as it starts). A key with a label of its own keeps it. Names only: never a folder or an address. With an older Playlister (0.5.x) the keys show their own words; there is nothing to set.

**Tape Deck** (key or dial). Drives one [Visual Sidechain](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md) **Tape Deck** filter on an OBS Browser Source (`25% to 800% (0.25x to 8x)` live speed).
- Turning a dial steps along the 11-rung speed ladder. A press runs **Play / pause**, **Cue to start**, **Normal speed (100% / 1x)**, **Speed up** or **Speed down**.
- The face shows speed in both units (`"150% (1.5x)"`), playing or paused, and the plain states **NOT LOADED** (Visual Sidechain absent) and **NO DECK** (no deck found). It redraws on `decks_changed`, with no polling, at most 10 times a second per key.
- Tape Decks stay outside Visual Sidechain's Panic and Restore visuals. *(Direct Fadester Companion / TourBox Tape Deck preset bindings are a planned follow-up.)*

**Visual Panic** (key). [Visual Sidechain](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md)'s own **Panic** (instant) and **Restore visuals** (hold 0.8 s), sent through OBS's hotkeys. After Panic the key reads **PANIC SENT** until Restore visuals is accepted or the OBS connection drops; meanwhile no Visual Sidechain filter is written from the deck. Needs Visual Sidechain in OBS (it comes with Midi Fadester 0.9.0 or newer), and the key looks the same without it: so before the show, hold **Restore visuals** once (it changes nothing when no Panic is on). If the key then says **Needs Midi Fadester**, OBS has no Visual Sidechain.

**Visual Sidechain Meter** (key or dial). Visual Sidechain's BPM and the beat. Press to tap the tempo, lock the BPM or resync beat 1; on a dial, a turn changes the BPM by 1 per click. Needs Visual Sidechain in OBS.

**Scene Info Bar** (Stream Deck Neo). Shows the connection, the Program scene and, in Studio Mode, the Preview scene. Display only.

**Midi Fadester Fader (optional)** and **Midi Fadester Auto-fade (optional)**. A dial and a key for one slot of [Midi Fadester](https://github.com/jbrick2070/midi-fadester), for people who use it with an APC40 or another MIDI controller. Everything else in this plugin works without Midi Fadester.

## Optional OBS plugins

None of these is needed for scenes, transitions, sources, audio or filters.

| Plugin | What it adds on the deck |
|---|---|
| [Playlister](https://github.com/jbrick2070/obs-playlister) 0.5 or later | The Playlister keys and the Playlister Transport layout. The names of the playing and the next item on the keys need Playlister 1.5.0 or newer. |
| [Visual Sidechain](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md), part of Midi Fadester 0.9.0 or later | Visual Panic, Visual Sidechain Meter, Tape Deck, quantized beat/bar fades, and the Effect mix and Reactivity dials of the VJ Rig. |
| [Midi Fadester](https://github.com/jbrick2070/midi-fadester) | The two actions labelled *(optional)*, for an APC40 or another MIDI controller. |

The [Suite Demo Kit](demo-kit/README.md) is one OBS scene collection with media and two Stream Deck + profiles that show the plugins working together.

## Which video player when

Four players have speed control: **VJster** in a Chrome tab (25% to 200%, live, with YouTube quality), the **VJster OBS page** in a Browser Source (25% to 200%, live), Visual Sidechain's **Tape Deck** for one video file (25% to 800%, live) and **OBS Playlister** for a running order of clips (1% to 200%; changing Speed restarts the clip). Which one to pick, the full speed ranges and what controls each: [docs/START-HERE.md, section 2](docs/START-HERE.md#2-which-video-player-when).

## When something is off

| The key or dial says | What to do |
|---|---|
| **Turn on OBS WebSocket** | In OBS: **Tools > WebSocket Server Settings**, tick **Enable WebSocket server**. |
| **Start OBS** | OBS is not running on this computer. Start it; the plugin connects by itself. |
| **OBS not connected** | OBS is on another computer, or has never saved its WebSocket settings; the plugin cannot tell which. Start OBS and tick **Enable WebSocket server**, or check the host and port under **OBS on another computer, or another port** at the foot of the settings page. The settings page's first line names the cause in full. |
| **Wrong password** | A password you typed wins over the one OBS saved. With OBS on this computer, open the line at the foot of the settings page and press **Use OBS's own password**. For OBS on another computer, copy the password from OBS's **Tools > WebSocket Server Settings > Show Connect Info** into **OBS on another computer, or another port** and press **Save for all controls & test**. Meanwhile the plugin tries again every 30 seconds and says so. |
| **Scene T-bar needs OBS Studio Mode**, **Preview selection needs OBS Studio Mode** | Turn on Studio Mode in OBS (**View > Studio Mode**), or open the layout again with **Turn on Studio Mode and open**. The Regular Mode layouts have no Preview or T-bar. |
| **Choose a different Preview** | The T-bar needs Preview and Program to be two different scenes. Pick another scene in Preview. |
| **Not set up**, **Choose a source**, **Choose a filter**, **Choose a Playlister** | That key or dial is not bound yet. Click it in Stream Deck to open its settings and pick the control, source, filter or Playlister. VJ Rig and Playlister Transport keys ship unbound on purpose. |
| **Needs Midi Fadester**, **Playlister missing** | Install that OBS plugin (Visual Sidechain comes with Midi Fadester 0.9.0 or newer), or switch to the scene collection that has the source. |
| **Companion offline**, **Whole mix is off** | An **All OBS mixer inputs** key or dial needs Fadester Companion. Start it, connect it to the same OBS, and turn on **All OBS mixer inputs** there. |
| **PANIC SENT** | Visual Sidechain's Panic is on. Hold **Restore visuals** for 0.8 s to bring the effects back. |
| A key changed the picture on Program in Studio Mode | A scene's content is shared: when Preview and Program show the same scene, layer edits change both. The control is framed red and labels that scene PROGRAM. |
| A numbered scene key does nothing | OBS has fewer scenes than the number. Add a scene, or pin the key to a named scene in its settings page. |
| *Fadester for OBS* is listed twice in Stream Deck's actions | The plugin from the Elgato Marketplace and the one from this page are the same plugin under two IDs, and Stream Deck holds them as two. Keep one and remove the other in Stream Deck. Keys keep the copy they were placed with, so re-place the keys of the copy you remove. |

When OBS goes away, the plugin reconnects by itself and every key shows the same short reason, with a broken-link picture.

## Languages

Fadester for OBS speaks thirteen languages, the same thirteen as the rest of the Fadester suite: English, German, Spanish, French, Italian, Japanese, Korean, Dutch, Brazilian Portuguese, Russian, Turkish, Simplified Chinese and Traditional Chinese.

- **Choose:** open any control's settings page, click the line at its foot and choose under **Language**. The choice applies at once to every Fadester for OBS key, dial and settings page (the VJster ones and the two Midi Fadester pages included) and survives restarts. A VJster key's settings page has the same **Language** box: it is the one setting, shown in both places.
- **Automatic** follows Stream Deck's language. Stream Deck itself offers eight of the thirteen (English, German, Spanish, French, Japanese, Korean and the two Chinese), so Dutch, Italian, Brazilian Portuguese, Russian and Turkish are chosen by hand under **Language**. Stream Deck's own menus, action list, tooltips and dial hints stay in Stream Deck's language.
- **OBS's own words** (Studio Mode, Preview, Program, Scene, Source, Transition) use OBS's translation, so the deck matches OBS; where a key or strip is too small for the whole word it is cut short (Dutch **Voorvert.** for Voorvertoning, Brazilian Portuguese **Pré-vis.** for Pré-visualização). Your scene, source and filter names are shown as they are.
- **Who translated:** the translations were drafted by an AI model (Claude); eight of them were reviewed by a second one (Gemini), while Italian, Brazilian Portuguese, Russian and Turkish have had no second review yet. No native speaker has checked any of them. If something reads wrong, please open an issue or a pull request: the files are `io.github.jbrick2070.fadester-for-obs.sdPlugin/<language>.json`, with `en.json` as the English source. VJster's languages are in [docs/vjster/INSTALL.md](docs/vjster/INSTALL.md).

## Bring your own controller or robot

Fadester is not tied to the Stream Deck. Every surface in the suite drives OBS through the same four doors, open to a new hardware controller, a platform of your own, a web page, a script or a robot (a cue list or an AI agent, directly or through an MCP server that passes obs-websocket requests through):

| Door | What it gives you |
|---|---|
| **Plain OBS requests** over obs-websocket | Scenes, transitions, sources, audio and filters. A platform that hosts Stream Deck plugins, like [OpenDeck](docs/OPENDECK.md), runs Fadester for OBS as it is. |
| **The Midi Fadester vendor API** (`CallVendorRequest`, vendor `midi-fadester`) | The 18 fader and FX slots: T-bar, crossfades, layer opacity, audio, any numeric filter setting, timed fades. |
| **The shared whole-mix protocol** (`io.github.jbrick2070.fadester.mix.v1` over `BroadcastCustomEvent`) | The Whole mix as one fader. |
| **Keystrokes to Fadester Companion** | Anything that can press `Ctrl+Alt+Shift+F3` gets the native T-bar, Preview selection, media, overlays, the YouTube video and the VJ layers, no TourBox required. |

[docs/ADD-YOUR-OWN-CONTROLLER.md](docs/ADD-YOUR-OWN-CONTROLLER.md) has the JSON for each door, the manners that keep a show safe, and a worked example.

## Documentation

| Page | What is in it |
|---|---|
| [DECK-LAYOUTS.md](DECK-LAYOUTS.md) | Every ready-made layout, key by key |
| [profiles/README.md](profiles/README.md) | The profile library, importing by hand, and how the files are built |
| [docs/vjster/README.md](docs/vjster/README.md), [docs/vjster/INSTALL.md](docs/vjster/INSTALL.md) | VJster |
| [docs/SUITE.md](docs/SUITE.md) | The one plugin that carries Fadester for OBS and VJster, and how it is built |
| [docs/OPENDECK.md](docs/OPENDECK.md) | Running the plugin with OpenDeck, the free open-source alternative to Stream Deck software |
| [tourbox/README.md](tourbox/README.md) | Fadester Companion, the Windows app that drives OBS from a TourBox controller |
| [tourbox/MACOS.md](tourbox/MACOS.md) | Fadester Companion for Mac (in every release as `Fadester-Companion-macOS-arm64-<version>.zip` and `-x64-`; ad-hoc signed, not notarized; built and self-tested in CI, not yet rehearsed with a TourBox on a real Mac) |
| [docs/gamepad/README.md](docs/gamepad/README.md) | Driving Fadester Companion from an Xbox controller |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each version |
| [demo-kit/README.md](demo-kit/README.md) | The Suite Demo Kit |
| [docs/ADD-YOUR-OWN-CONTROLLER.md](docs/ADD-YOUR-OWN-CONTROLLER.md) | Bring your own controller, platform or robot: the four doors into Fadester, with JSON |
| [API-CONTRACT.md](API-CONTRACT.md) | The optional `midi-fadester` vendor API |
| [FEATURE-AUDIT.md](FEATURE-AUDIT.md) | What the Midi Fadester vendor API allows and what the plugin does with it |
| [PUBLISHING.md](PUBLISHING.md) | Packaging and Marketplace checklist (for the maintainer) |
| [LICENSE](LICENSE) | GNU General Public License v2.0 |

## For developers

```powershell
npm test
npm run build
npm run validate
npm run pack
```

`npm run pi:harness [-- --page auto-fade-key]` serves the optional Midi Fadester settings pages against the fake OBS server. The engineering record is in `REQUIREMENTS.md`, `PLAN.md` and `TESTING.md`.

## Credits and licence

Fadester for OBS is written with AI coding tools under human direction, review and verification on real hardware. It is free software under the [GNU General Public License v2.0](LICENSE).

> **Disclaimer:** Fadester for OBS is an independent third-party plugin and is not made, endorsed, or supported by the OBS Project or Elgato.
