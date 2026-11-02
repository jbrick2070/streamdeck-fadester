# The Fadester layout library

Fourteen ready-made layouts ship inside the plugin for the Stream Deck +, the 15-key Stream Deck and the Stream Deck Mini. The easy way to open one is from any Fadester control's settings page: expand **Ready-made layouts**, choose, press **Open current starter layout**. This page is for importing a file by hand and for the people who build the files. What each layout does, key by key, is in [DECK-LAYOUTS.md](../DECK-LAYOUTS.md).

## The fourteen files

| Layout | Mode | Deck | Keys and dials used | What it is for |
|---|---|---|---|---|
| [Source Desk +](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-source-desk-v3.streamDeckProfile) | Either | Stream Deck + | 7 keys, 4 dials | Browse sources, show/hide, three mixer dials, mic and music fade pairs. |
| [Half Source Desk +](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-source-half-v2.streamDeckProfile) | Either | Stream Deck + | 4 keys, 2 dials | The same for one mixer input, with half the deck free. |
| [Source Desk 15 Keys](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-source-desk-v4.streamDeckProfile) | Either | 15 keys | 9 keys | Browse sources and three audio fade pairs; six keys free. |
| [Half Source Desk 15 Keys](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-source-half-v2.streamDeckProfile) | Either | 15 keys | 7 keys | Browse sources, show/hide, mic and music fade pairs; eight keys free. |
| [Source Desk Mini](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/mini-source-desk-v2.streamDeckProfile) | Either | Mini | 5 keys | Previous and next source, show/hide, one audio fade pair. |
| [Creative Layer Lab +](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-creative-layer-lab-v2.streamDeckProfile) | Either | Stream Deck + | 8 keys, 4 dials | Blend modes and layer order, plus source selection and audio. |
| [Creative Layer Lab 15 Keys](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-creative-layer-lab-v2.streamDeckProfile) | Either | 15 keys | 12 keys | The same through buttons, plus mic and music fade pairs. |
| [Scene Desk +](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-scene-desk-v2.streamDeckProfile) | Studio | Stream Deck + | 8 keys, 3 dials | Previous, next and random Preview scene, Cut, Transition, Scene 1, mixer dials and the T-bar. |
| [Scene Desk 15 Keys](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-scene-desk-v2.streamDeckProfile) | Studio | 15 keys | 13 keys | Previous, next and random Preview scene, Cut, Transition, Scene 1-4, audio fade pairs. |
| [Scene Desk +, Regular](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-scene-regular-v3.streamDeckProfile) | Regular | Stream Deck + | 8 keys, 3 dials | Straight to the previous, next, random or numbered scene (1-3); mixer dials. |
| [Scene Desk 15 Keys, Regular](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-scene-regular-v2.streamDeckProfile) | Regular | 15 keys | 13 keys | The same with Scene 1-4, Cut previous and Cut next, audio fade pairs. |
| [Playlister Transport +](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-playlister-transport-v1.streamDeckProfile) | Either | Stream Deck + | 6 keys | Previous, next, play/pause, stop, restart and status for one Playlister source. |
| [VJ Rig +](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-vj-rig-v1.streamDeckProfile) | Studio | Stream Deck + | 4 pages of 8 keys and 4 dials | Perform, Layers, Visuals and Scenes pages; Panic on the same key on every page. |
| [VJ Rig 15 Keys](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-vj-rig-v1.streamDeckProfile) | Studio | 15 keys | 4 pages of 15 keys | The same four pages through buttons. |

Every profile name carries its mode: **Studio Mode**, **Regular Mode** or **Either Mode**. No file holds a host, a port, a password or a device serial number.

## Import a file by hand

1. Open the `.streamDeckProfile` for your deck. Stream Deck imports it as a new profile.
2. Open one Fadester key on it and, under **OBS connection**, paste OBS's WebSocket password once and press **Save for all controls & test**. Every Fadester control on every profile shares that connection.
3. Press the keys. Scene keys follow your OBS scene list; Music, Mic and Aux controls have found your mixer inputs. Change any of them in the key's settings page; keep both keys of a fade pair on the same input.
4. Playlister Transport and VJ Rig keys ship unbound: open each one's settings page once and choose the source, filter or Playlister.
5. Put your other actions on the empty keys and dials.

Opening a layout from the settings page does the same, and the second time returns you to your edited copy. A later release's updated layout opens as its own profile; your old one and its edits stay.

## Next to other plugins

The half layouts leave real empty keys for the OBS actions and tools you already use: recording, replay, chat, a transform. A profile can reference another plugin's actions, but Stream Deck does not carry that plugin inside the profile, so these layouts ship with Fadester actions only and the rest is yours to add.

## For developers: rebuilding the files

`layouts.json` in this folder is the source of truth. Run:

```powershell
node --import tsx scripts/build-profiles.ts
```

The builder writes the `.streamDeckProfile` archives into the plugin's `profiles/` folder, plus `catalog.json` and `manifest-entries.json` here. It uses fixed IDs so the output is the same every time, rejects invalid positions and action IDs, and never reads or edits installed user profiles.

Each profile ZIP holds a root `*.sdProfile/manifest.json` with `Device`, `Name`, `Pages` and `Version: "3.0"`; each page has `Controllers`, `Icon` and `Name`, with actions keyed by `column,row`. Device model values come from the default profiles the installed Stream Deck app ships.

Elgato's [Profiles SDK guide](https://docs.elgato.com/streamdeck/sdk/guides/profiles/) covers bundling exported profiles in a plugin, and the [manifest profile reference](https://docs.elgato.com/streamdeck/sdk/references/manifest/#profile) the device type, editability and install behaviour. The manifest entries use `AutoInstall: false` and `DontAutoSwitchWhenInstalled: true`, so Stream Deck installs no layout when it installs the plugin; a layout is installed the first time it is opened from a settings page, and the plugin then switches the deck to it. Elgato's [profile guidance](https://docs.elgato.com/stream-deck/profiles/getting-started/) explains that other plugins a profile uses must be installed separately.
