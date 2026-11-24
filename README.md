# Fadester for OBS

**Fadester for OBS 1.5.0** puts OBS Studio on your Stream Deck: scenes, transitions, sources, filters and audio on keys and dials. It talks to OBS's built-in WebSocket server, so the main controls need no MIDI desk and no extra OBS plugin. Fourteen ready-made layouts. Thirteen languages.

> **Setting up the whole Fadester Suite?** Start with **[docs/START-HERE.md](docs/START-HERE.md)**: what to install for your controller and the first-run OBS settings.

## Three steps to the first working key

<img src="docs/images/first-key-steps.svg" alt="The first working key in three steps: 1, double-click the .streamDeckPlugin file and press Install; 2, in OBS, Tools, WebSocket Server Settings, tick Enable WebSocket server; 3, drag Scene onto a key in Stream Deck and press it: OBS goes to the next scene." width="900">

1. **Install the plugin.** On the [Releases page](https://github.com/jbrick2070/streamdeck-fadester/releases/latest), download the file whose name ends in `.streamDeckPlugin` and double-click it. Stream Deck asks to install it: press **Install**.
2. **Turn on OBS's WebSocket server.** In OBS's menu bar: **Tools > WebSocket Server Settings**, tick **Enable WebSocket server**, press **OK**. Leave **Enable Authentication** as it is: there is nothing to copy.
3. **Drag Scene onto a key.** In Stream Deck's action list, open the category *Fadester for OBS* and drag **Scene** (the first action) onto a key. It starts as **Next scene**: press it, and OBS goes to the next scene in your list.

That's it. With OBS on the same computer the plugin finds OBS's port and signs in with the password OBS saved. While OBS is not connected, the key and the first line of its settings page say what to do, for example **Turn on OBS WebSocket** or **Start OBS**.

**Using [OpenDeck](docs/OPENDECK.md)**, the free open-source alternative to Elgato's Stream Deck software? Follow the [OpenDeck quick start](docs/OPENDECK.md#first-five-minutes).

### Then, if you like

- **Fill the deck with a ready-made layout.** Click any Fadester for OBS key to open its settings. Once OBS is connected, the first line reads **New deck? Fill it with a ready-made layout**: click it, pick a layout and press **Open this layout**.
- **The plugin's own settings** are in the line at the foot of every settings page (it shows the version and the connection): **Language**, **OBS connection**, **Setup checklist** and **Ready-made layouts**, for every key and dial at once.
- **OBS on another computer, or another port?** Click the foot line, open **OBS on another computer, or another port**, fill in the host, the port and OBS's password, and press **Save for all controls & test**.

## Good to know

- **Needs** Stream Deck 7.6 or later (6.x is not supported) on Windows 10 or later or macOS 13.5 or later, and OBS Studio with its WebSocket server on (tested with OBS 33). Works on a Stream Deck, Stream Deck +, Stream Deck Mini and Stream Deck Neo.
- **One plugin, two products.** From 0.9.0 this plugin also carries [VJster](docs/vjster/README.md): speed and quality controls for the video playing in Chrome or in an OBS browser source, named **VJster Speed** and so on in the same action list ([docs/SUITE.md](docs/SUITE.md)). VJster is still released on its own for decks with no OBS.
- **No profile appears by itself.** A layout arrives the first time you open it, so your profile list stays yours.
- **Upgrading from 0.9.x or earlier with a download from this page?** Since 0.10 the download here uses a new plugin ID. (A copy from the Elgato Marketplace keeps the old one and simply updates there; do not add this download to it.) Install it alongside the old version, let it sign in to OBS, then open a fresh layout or replace old Fadester actions in a copy of your custom profile. Keep the old plugin until you have checked the new controls. The standalone VJster ID has not changed.

## Ready-made layouts

All fourteen are in [DECK-LAYOUTS.md](DECK-LAYOUTS.md), key by key; the files are in the [profile library](profiles/README.md). The picker lists only the layouts for your deck, with the OBS mode in front, as in **[Studio Mode] Scene Desk +**.

| You want to | Open | Stream Deck + | 15 keys | Mini |
|---|---|---|---|---|
| Choose scenes in Preview, then send Preview to Program with Cut, the transition or the T-bar | **[Studio Mode] Scene Desk** | yes | yes | |
| Switch scenes directly, no Preview | **[Regular Mode] Scene Desk** | yes | yes | |
| Show and hide the sources of one scene, fade audio | **[Either Mode] Source Desk**, or **Half Source Desk** | yes | yes | yes |
| Try blend modes and layer order | **[Either Mode] Creative Layer Lab** | yes | yes | |
| Drive a Playlister source (needs Playlister 0.5) | **[Either Mode] Playlister Transport +** | yes | | |
| Run a VJ set: four pages with Panic on every page | **[Studio Mode] VJ Rig** | yes | yes | |

Every layout is an editable copy, and it never contains your password. The Stream Deck XL and the Neo have no ready-made layout yet.

## The controls

All in the *Fadester for OBS* category of Stream Deck's action list. Every setting and how each dial behaves: **[docs/ACTIONS.md](docs/ACTIONS.md)**.

| Control | On | What it does |
|---|---|---|
| **Scene** | key | Next, previous, random, numbered or named scene, or the one in Preview: transition, cut, or put it in Preview |
| **Volume & T-bar** | dial | Ride one audio input, or choose **Switch scenes (T-bar)**: the strip shows the PROGRAM and PREVIEW scenes and the dial fades Preview into Program |
| **Audio Fade** | key | Fade one audio input to 0 % or 100 %, or the Whole mix with **All OBS mixer inputs** (needs Fadester Companion). Restore mix returns each managed input to its own level |
| **Source & Layer** | key or dial | Pick a source of the scene, show or hide it, blend modes, layer order |
| **Filter** | key or dial | Ride, switch or glide one filter setting |
| **Playlister** | key | Transport and status for one Playlister source; with Playlister 1.5.0 or newer it names what plays |
| **Tape Deck** | key or dial | Speed and transport for a Visual Sidechain Tape Deck |
| **Visual Panic** | key | Visual Sidechain's Panic, and Restore visuals (hold 0.8 s) |
| **Visual Sidechain Meter** | key or dial | BPM and beat: tap, lock, resync |
| **Scene Info Bar** | Stream Deck Neo | Connection, Program and Preview scene |
| **Midi Fadester Fader (optional)**, **Midi Fadester Auto-fade (optional)** | dial, key | One slot of Midi Fadester |

## Optional OBS plugins

None of these is needed for scenes, transitions, sources, audio or filters.

| Plugin | What it adds on the deck |
|---|---|
| [Playlister](https://github.com/jbrick2070/obs-playlister) 0.5 or later | The Playlister keys and the Playlister Transport layout. Item names on the keys need Playlister 1.5.0 or newer. |
| [Visual Sidechain](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md), part of Midi Fadester 0.9.0 or later | Visual Panic, Visual Sidechain Meter, Tape Deck, quantized beat/bar fades, and the Effect mix and Reactivity dials of the VJ Rig. |
| [Midi Fadester](https://github.com/jbrick2070/midi-fadester) | The two actions labelled *(optional)*, for an APC40 or another MIDI controller. |

The [Suite Demo Kit](demo-kit/README.md) is one OBS scene collection with media and two Stream Deck + profiles that show the plugins working together.

## Which video player when

Four players have speed control: **VJster** in a Chrome tab, the **VJster OBS page** in a Browser Source, Visual Sidechain's **Tape Deck** for one video file, and **OBS Playlister** for a running order of clips (where changing Speed restarts the clip). Speed ranges and which to pick: [docs/VIDEO-PLAYERS.md](docs/VIDEO-PLAYERS.md).

## When something is off

The key says what is wrong, and the settings page's first line says it in full. The three most common:

| The key or dial says | What to do |
|---|---|
| **Turn on OBS WebSocket** | In OBS: **Tools > WebSocket Server Settings**, tick **Enable WebSocket server**. |
| **Start OBS** | Start OBS on this computer; the plugin connects by itself. |
| **Choose a different Preview** | The T-bar needs Preview and Program to be two different scenes. Pick another scene in Preview. |

Every other message (wrong password, Studio Mode, unbound keys, **PANIC SENT**, the plugin listed twice): [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Languages

Fadester for OBS speaks thirteen languages, the same thirteen as the rest of the Fadester suite. Choose under **Language** in the line at the foot of any settings page; **Automatic** follows Stream Deck, which offers eight of them. The translations were drafted by AI and have not been checked by native speakers; corrections are welcome. Details: [docs/ACTIONS.md](docs/ACTIONS.md#languages).

## Bring your own controller or robot

Every surface in the suite drives OBS through the same four doors: plain obs-websocket requests, the Midi Fadester vendor API, the shared whole-mix protocol, and keystrokes to Fadester Companion. A new controller, a script or a robot can use them too: [docs/ADD-YOUR-OWN-CONTROLLER.md](docs/ADD-YOUR-OWN-CONTROLLER.md) has the JSON and a worked example.

## Documentation

- [DECK-LAYOUTS.md](DECK-LAYOUTS.md) and [profiles/README.md](profiles/README.md): the ready-made layouts and their files.
- [docs/ACTIONS.md](docs/ACTIONS.md): every action and setting. [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): every message on a key.
- [docs/vjster/README.md](docs/vjster/README.md) and [docs/vjster/INSTALL.md](docs/vjster/INSTALL.md): VJster. [docs/SUITE.md](docs/SUITE.md): the one plugin that carries both.
- [docs/OPENDECK.md](docs/OPENDECK.md): running the plugin with OpenDeck.
- [tourbox/README.md](tourbox/README.md): Fadester Companion for TourBox on Windows; [tourbox/MACOS.md](tourbox/MACOS.md) for Mac (ad-hoc signed, not notarized, not yet rehearsed with a TourBox on a real Mac); [docs/gamepad/README.md](docs/gamepad/README.md) for an Xbox controller.
- [docs/ADD-YOUR-OWN-CONTROLLER.md](docs/ADD-YOUR-OWN-CONTROLLER.md), [API-CONTRACT.md](API-CONTRACT.md) and [FEATURE-AUDIT.md](FEATURE-AUDIT.md): the doors into Fadester and the optional `midi-fadester` vendor API.
- [CHANGELOG.md](CHANGELOG.md), [demo-kit/README.md](demo-kit/README.md) (the Suite Demo Kit), [PUBLISHING.md](PUBLISHING.md) (for the maintainer), [LICENSE](LICENSE) (GNU General Public License v2.0).

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
