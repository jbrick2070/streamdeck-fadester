# Using Fadester for OBS and VJster with OpenDeck

[OpenDeck](https://github.com/nekename/OpenDeck) is a free, open-source program that runs Stream Deck plugins without Elgato's Stream Deck software. Fadester for OBS runs in it as it is, with VJster in the same plugin ([SUITE.md](SUITE.md)): one install gives you all nineteen actions.

## First five minutes

<img src="images/opendeck-steps.svg" alt="Fadester for OBS in OpenDeck in three steps: 1, start OpenDeck with the deck connected and the Stream Deck software closed; 2, install Fadester for OBS from OpenDeck's plugin manager or its local-file install button; 3, pick the Fadester layout in the profile list under the deck's name." width="900">

1. **Start OpenDeck.** Connect the deck, close Elgato's Stream Deck software and start [OpenDeck](https://github.com/nekename/OpenDeck/releases). It needs [Node.js](https://nodejs.org/) 24 or later to run this plugin.
2. **Install Fadester.** In OpenDeck's plugin manager, install **Fadester for OBS** if it is listed, or use its local-file install button with the [Fadester download](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin). No terminal or source build is needed.
3. **Pick your layout** in the profile list beneath the deck's name: **Scene Desk + (Regular Mode)** for the Plus, **Scene Desk 15 Keys (Regular Mode)** for a 15-key deck, or **Source Desk Mini (Either Mode)** for a Mini. On other models, drag **Scene** onto one key.

That's it, once OBS's WebSocket server is on (in OBS: **Tools → WebSocket Server Settings**, tick **Enable WebSocket server**). With OBS on the same computer, Fadester signs in with the password OBS saved; there is nothing to type.

Quick start in other languages: [Deutsch](quickstart/de.md#opendeck) · [Español](quickstart/es.md#opendeck) · [Français](quickstart/fr.md#opendeck) · [Italiano](quickstart/it.md#opendeck) · [日本語](quickstart/ja.md#opendeck) · [한국어](quickstart/ko.md#opendeck) · [Nederlands](quickstart/nl.md#opendeck) · [Português (Brasil)](quickstart/pt-BR.md#opendeck) · [Русский](quickstart/ru.md#opendeck) · [Türkçe](quickstart/tr.md#opendeck) · [简体中文](quickstart/zh-CN.md#opendeck) · [繁體中文](quickstart/zh-TW.md#opendeck)

**Try it:** with at least two scenes in OBS and streaming and recording off, press **Next scene** on Scene Desk. OBS switches scenes and the deck shows the real scene names. On a Mini, press **Next source** to select a source and **Show/hide** to toggle it; press it again to put the source back.

## Good to know

- **Your current profile stays selected** when the plugin installs. If the new profile is missing from the list, quit OpenDeck from the tray and reopen it.
- **OBS on another computer:** in OBS, **Show Connect Info** gives the password. Click a Fadester key in OpenDeck, click the line at the foot of its settings page, open **OBS on another computer, or another port**, fill in the host, the port and the password, and choose **Save for all controls & test**.
- **The VJ Rig's pages are separate profiles.** Each page (Perform, Layers, Visuals, Scenes) is one OpenDeck profile, and Elgato's Next page key has no counterpart, so that key is left empty: switch pages from the profile list.
- **The Stream Deck Neo's Info Bar** is not part of what was tried.
- **What has been tried:** OpenDeck 2.14.2 on Windows 11 with a Stream Deck +, Node 25. Fadester's keys and dials draw, its settings pages and ready-made layouts open as OpenDeck profiles, and `npm run opendeck:parity` drives the plugin the way OpenDeck does against a live OBS 33: scene changes, a fade and a dial all work. VJster's keys and dials draw, its settings pages open, its link to Chrome starts, and a VJster program that stops is started again. macOS and Linux are not tried. OpenDeck lists only Elgato decks as supported.

## Optional: all layouts and VJster's keys

The plugin supplies one profile for your deck. To add the rest of the [layout library](../DECK-LAYOUTS.md) (every layout key by key) from source: start OpenDeck once with the deck attached, quit it fully (the tray icon too), then run in the repository:

```sh
npm install
npm run build
npm run opendeck:install -- --fadester-layouts fit
```

- `--fadester-layouts fit` writes the ready-made layouts made for your deck (a Stream Deck + gets the "+" layouts, a 15-key deck the "15 Keys" ones, a Mini the Mini one) as OpenDeck profiles; pick one from the profile list under the deck's name.
- `--fadester-layouts plus-scene-desk,plus-vj-rig` writes just the ones you name (the names are the `slug` values in [profiles/layouts.json](../profiles/layouts.json)).
- A profile that is already there is left as it is, so your edits stay; delete it in OpenDeck to build it again. On a fresh deck with only an empty Default profile, the installer also selects the recommended profile so it appears on next launch; existing selections and edited profiles are kept.
- Add `--layout` to put VJster's four keys and two dials on free slots of the current profile as well. To use VJster with Chrome, follow the [extension instructions](vjster/INSTALL.md).
- Or drag Fadester's actions from OpenDeck's action list (under **Fadester for OBS**) onto keys and dials yourself.

## When something is off

| You see | What to do |
|---|---|
| A VJster key stays empty or a dial shows a warning sign | Quit OpenDeck, run the install command again and start it: it rebuilds VJster's own keys and dials. If a slot holds something else it says so and leaves it. |
| **"OpenDeck is running."** | Quit it, including the tray icon. It rewrites its profiles when it quits, so a change made while it runs is lost. |
| **"has no bin/plugin.js."** | Run `npm run build` first. |
| Nothing happens when you turn a VJster dial | Check that Chrome has the VJster extension and that a video is playing; the settings page (click a VJster key) shows whether the link is up. |
| The deck is not found | OpenDeck lists only Elgato decks as supported; check its own page for your model. |

## For developers: checking it against a real OBS

`npm run opendeck:parity` runs the plugin from OpenDeck's plugins folder the way OpenDeck starts it (the same command line and plugin id, with a stand-in for OpenDeck's side of the plugin protocol), against the isolated portable OBS 33 that `npm run test:obs-live` uses, and checks what OBS did:

- Next scene from the first scene and wrapping round from the last, a key set to one scene, a fade key on an audio input, and a dial that lowers and raises its volume.
- A VJster key on the deck: that it draws, that its link starts, that saving VJster's settings leaves Fadester's alone, and that a VJster program that is stopped is started again.

It needs that OBS copy (its folder is set at the top of `tests/obs-live-conformance.ts`; `FADESTER_TEST_OBS` or `--obs-root` points the parity run at another) and no deck. It launches only that OBS, and refuses to run while any other OBS is open or while another VJster link holds 127.0.0.1:48150.

**macOS and Linux:** `--config <folder>` points the installer at OpenDeck's folder if it is not where the installer looks (`~/Library/Application Support/opendeck`, `~/.config/opendeck`; the Flatpak build keeps it under `~/.var/app`). These paths follow OpenDeck's documentation and have not been tried.
