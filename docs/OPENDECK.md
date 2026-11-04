# Using Fadester for OBS and VJster with OpenDeck

[OpenDeck](https://github.com/nekename/OpenDeck) is a free, open-source program that runs Stream Deck plugins without Elgato's Stream Deck software. Fadester for OBS runs in it as it is, and VJster comes in the same plugin (see [SUITE.md](SUITE.md)): one install gives you all seventeen actions. This page gets it installed and onto your keys and dials.

**What has been tried:** OpenDeck 2.14.2 on Windows 11 with a Stream Deck +, Node 25. Fadester's keys and dials draw, its settings pages and ready-made layouts open as OpenDeck profiles, and `npm run opendeck:parity` drives the plugin the way OpenDeck does against a live OBS 33: scene changes, a fade and a dial all work. VJster's keys and dials draw, its settings pages open, its link to Chrome starts, and a VJster program that stops is started again. macOS and Linux are not tried. OpenDeck lists only Elgato decks as supported.

## First five minutes

1. **Install OpenDeck** from its [releases page](https://github.com/nekename/OpenDeck/releases), or on Windows with `winget install nekename.OpenDeck`. Install [Node.js](https://nodejs.org/) 24 or later too: OpenDeck starts these plugins with the `node` on your computer, and the Flatpak build of Node does not work.
2. **Start OpenDeck once with your deck connected, then quit it** (also from the tray icon). Close Elgato's Stream Deck software first: only one program can hold the deck.
3. **Build the plugin** in this folder, once: `npm install`, then `npm run build`.
4. **Install it:**

   ```powershell
   npm run opendeck:install -- --layout --fadester-layouts fit
   ```

   This copies the plugin (Fadester with VJster in it) into OpenDeck's plugins folder (`%APPDATA%\opendeck\plugins` on Windows) and puts VJster's four keys and two dials on your deck's current profile. It only fills free slots (a slot that holds another action is left alone), keeps the first copy of the profile file it changed in OpenDeck's `backups` folder, and says what it placed, refreshed and skipped. Run it again after you update the plugins: it replaces the plugin folders and rebuilds VJster's own keys and dials, keeping their settings and any title you styled in OpenDeck. `--fadester-layouts fit` also writes Fadester's ready-made layouts for your deck (see below). `--dry-run` shows what it would do. The standalone VJster plugin (for a deck with no OBS) is `vjster` after the command's name, and `both` installs it beside the suite; `all` and `fadester` still mean the suite.
5. **Start OpenDeck.** The VJster keys read 1x, +0.25, Paused and Pin Tab, and the first two dials show Speed and Quality. Click a key to open its settings below the grid. Fadester's and VJster's actions are in the action list on the right, VJster's named **VJster Speed**, **VJster Quality** and so on.
6. **Add the Chrome extension** from [docs/vjster/INSTALL.md](vjster/INSTALL.md) (the same extension as with Stream Deck software), then open a video: the keys follow it.

## Fadester for OBS in OpenDeck

`--fadester-layouts fit` writes the ready-made layouts made for your deck (a Stream Deck + gets the "+" layouts, a 15-key deck the "15 Keys" ones, a Mini the Mini one) as OpenDeck profiles; pick one from the profile list under the deck's name. `--fadester-layouts plus-scene-desk,plus-vj-rig` writes just the ones you name (the names are the `slug` values in [profiles/layouts.json](../profiles/layouts.json)). A profile that is already there is left as it is, so your edits stay; delete it in OpenDeck to build it again. Or drag Fadester's actions from OpenDeck's action list (under **Fadester for OBS**) onto keys and dials yourself.

Then follow the README's [first five minutes](../README.md#first-five-minutes) from step 3 (the OBS WebSocket password).

Two things differ from Stream Deck software:

- **The layouts are written by the install command, not opened from a settings page.** OpenDeck does not read Stream Deck's profile files, so the settings page's "Open starter layout" does not apply. [DECK-LAYOUTS.md](../DECK-LAYOUTS.md) lists every layout key by key.
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
