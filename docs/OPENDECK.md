# Using Fadester for OBS and VJster with OpenDeck

[OpenDeck](https://github.com/nekename/OpenDeck) is a free, open-source program that runs Stream Deck plugins without Elgato's Stream Deck software. Fadester for OBS runs in it as it is, and VJster comes in the same plugin (see [SUITE.md](SUITE.md)): one install gives you all seventeen actions. This page gets it installed and onto your keys and dials.

**What has been tried:** OpenDeck 2.14.2 on Windows 11 with a Stream Deck +, Node 25. Fadester's keys and dials draw, its settings pages and ready-made layouts open as OpenDeck profiles, and `npm run opendeck:parity` drives the plugin the way OpenDeck does against a live OBS 33: scene changes, a fade and a dial all work. VJster's keys and dials draw, its settings pages open, its link to Chrome starts, and a VJster program that stops is started again. macOS and Linux are not tried. OpenDeck lists only Elgato decks as supported.

## First five minutes

1. **Connect the deck.** Start [OpenDeck](https://github.com/nekename/OpenDeck/releases) with Elgato’s Stream Deck software closed. OpenDeck needs [Node.js](https://nodejs.org/) 24 or later to run this plugin.
2. **Install Fadester.** In OpenDeck’s plugin manager, install **Fadester for OBS** if it is listed, or use its local-file install button with the [Fadester download](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin). No terminal or source build is needed.
3. **Choose your starter** in the profile list beneath the device name. Fadester adds **Scene Desk + (Regular Mode)** for the Plus, **Scene Desk 15 Keys (Regular Mode)** for a 15-key deck, or **Source Desk Mini (Either Mode)** for a Mini. The installed plugin leaves your current profile selected. If the new profile is missing, quit OpenDeck from the tray and reopen it. On other models, drag **Scene & Transition** to one key.
4. **Connect OBS once.** In OBS, open **Tools → WebSocket Server Settings**, enable the server and use **Show Connect Info** to find the password. Click a Fadester key in OpenDeck, paste the password under **OBS connection**, and choose **Save for all controls & test**.
5. **Try it.** With at least two scenes in OBS and streaming and recording off, press **Next scene** on Scene Desk. You’ll see OBS switch scenes and the deck show the real scene names. On a Mini, use **Next source** to select a source and **Show/hide** to toggle it. You can press it again to put the source back.

## More layouts and VJster

To install the rest of the [layout library](../DECK-LAYOUTS.md) from source, start OpenDeck once with the deck attached, quit it fully, then run these commands in the repository:

```sh
npm install
npm run build
npm run opendeck:install -- --fadester-layouts fit
```

On a fresh deck with only an empty Default profile, the source installer also selects the recommended starter so it appears on next launch. Existing selections and edited profiles are preserved. To add VJster’s four keys and two dials to free slots on the current profile as well, include `--layout`. To use VJster with Chrome, follow the [extension instructions](vjster/INSTALL.md).

## Fadester for OBS in OpenDeck

`--fadester-layouts fit` writes the ready-made layouts made for your deck (a Stream Deck + gets the "+" layouts, a 15-key deck the "15 Keys" ones, a Mini the Mini one) as OpenDeck profiles; pick one from the profile list under the deck's name. `--fadester-layouts plus-scene-desk,plus-vj-rig` writes just the ones you name (the names are the `slug` values in [profiles/layouts.json](../profiles/layouts.json)). A profile that is already there is left as it is, so your edits stay; delete it in OpenDeck to build it again. Or drag Fadester's actions from OpenDeck's action list (under **Fadester for OBS**) onto keys and dials yourself.

Then follow the README's [first five minutes](../README.md#first-five-minutes) from step 3 (the OBS WebSocket password).

In OpenDeck:

- **Select profiles in OpenDeck.** Fadester supplies one starter directly; the source installer adds the full library. [DECK-LAYOUTS.md](../DECK-LAYOUTS.md) lists every layout key by key.
- **The VJ Rig's pages are separate profiles.** Each page (Perform, Layers, Visuals, Scenes) is one OpenDeck profile, and Elgato's Next page key has no counterpart, so that key is left empty: switch pages from the profile list.
- **The Stream Deck Neo's Info Bar** is not part of what was tried.

## When something is off

- **A VJster key stays empty or a dial shows a warning sign.** Quit OpenDeck, run the install command again and start it: it rebuilds VJster's own keys and dials. If a slot holds something else it says so and leaves it.
- **"OpenDeck is running."** Quit it, including the tray icon. It rewrites its profiles when it quits, so a change made while it runs is lost.
- **"has no bin/plugin.js."** Run `npm run build` first.
- **Nothing happens when you turn a dial.** Check that Chrome has the VJster extension and that a video is playing; the settings page (click a VJster key) shows whether the link is up.
- **The deck is not found.** OpenDeck lists only Elgato decks as supported; check its own page for your model.

## Checking it against a real OBS

`npm run opendeck:parity` runs the plugin from OpenDeck's plugins folder the way OpenDeck starts it (the same command line and plugin id, with a stand-in for OpenDeck's side of the plugin protocol), against the isolated portable OBS 33 that `npm run test:obs-live` uses, and checks what OBS did: Next scene from the first scene and wrapping round from the last, a key set to one scene, a fade key on an audio input, and a dial that lowers and raises its volume. It also puts a VJster key on the deck and checks that it draws, that its link starts, that saving VJster's settings leaves Fadester's alone, and that a VJster program that is stopped is started again. It needs that OBS copy (its folder is set at the top of `tests/obs-live-conformance.ts`; `FADESTER_TEST_OBS` or `--obs-root` points the parity run at another) and no deck. It launches only that OBS, and refuses to run while any other OBS is open.

macOS and Linux: `--config <folder>` points the installer at OpenDeck's folder if it is not where the installer looks (`~/Library/Application Support/opendeck`, `~/.config/opendeck`; the Flatpak build keeps it under `~/.var/app`). These paths follow OpenDeck's documentation and have not been tried.
