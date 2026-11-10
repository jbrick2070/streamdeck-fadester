# The suite: Fadester for OBS and VJster in one plugin

**Fadester for OBS 0.9.0 and later is one plugin with seventeen actions**: Fadester's ten (scenes, transitions, sources, filters, audio, Playlister, Visual Panic) and VJster's seven (speed and quality dials, speed presets and steps, Play / Pause, Pin Tab). You install it once, in Stream Deck software or in [OpenDeck](OPENDECK.md), and every action is in one list. VJster's actions are named **VJster Speed**, **VJster Quality** and so on.

The standalone VJster plugin (`com.jbrick2070.vjster`) is still built and released for decks that have no OBS and for saved profiles that name it. If both are installed they can run together: the second to start finds the link port taken, says so on its keys, and takes over when the other stops ([docs/vjster/REQUIREMENTS.md](vjster/REQUIREMENTS.md) D-11).

## What is different for you

- **One install, one settings home.** Fadester's connection settings (OBS host, port, password, language) and VJster's (link port, Chrome extension ids, the OBS page key, language) are stored side by side without touching each other: VJster's sit under their own key.
- **VJster's settings page** is the same page as the standalone plugin's. It saves through the plugin, never straight over the stored settings.
- **VJster's Stream Deck profiles** (Live +, Dual +, Live 15, Mini) belong to the standalone plugin; the suite does not carry copies yet. In OpenDeck, `npm run opendeck:install -- --layout` puts VJster's starter keys and dials on the deck from the suite.
- **The Chrome extension** is the same one, from the [Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb); it talks to the VJster half of the suite on the same port, 48150 by default. Fadester Companion can host the same link, so keep only one program with VJster running: the suite, the VJster plugin or Fadester Companion.

## How it is built

Stream Deck and OpenDeck start a plugin as one program. The suite's `bin/plugin.js` is a small **launcher** that registers with the host once, then starts the two real plugins as child programs, each exactly as the host would start it, and passes messages between the three:

```
Stream Deck / OpenDeck
        |  one plugin connection
   bin/plugin.js   (the launcher, src/suite/launcher.ts)
     |                    |
 bin/fadester.js     bin/vjster/plugin.js
 (Fadester's plugin)  (VJster's plugin, copied from its own build)
```

Neither plugin's code was changed to fit. The routing lives in `src/suite/mux.ts`, a pure module with its own tests (`tests/suite-mux.test.ts`):

- **Actions.** A message about one of VJster's actions goes to VJster, with the action id turned into the one VJster knows (`io.github.jbrick2070.fadester-for-obs.vjster-speed` becomes `com.jbrick2070.vjster.speed`, and back for what it says to the host). Stream Deck wants every action id of a plugin to start with the plugin's own id, which is why the suite names them this way. Everything else goes to Fadester; events that belong to neither (a deck connecting, the computer waking) go to both.
- **Stored settings.** The host keeps one settings object for the whole plugin. The launcher is the only one that reads or writes it: Fadester sees everything except VJster's key, VJster sees only its own key, and every save is merged into what is stored, so neither can lose the other's keys. A save that arrives before the stored settings have been read waits for them. Each read is answered with the id of the read (the SDK hands an answer to that read only).
- **A child that stops** is started again within a second (up to five times in a minute) and told what was showing: the decks, the stored settings, each key and dial it owns with the settings it has now, and its settings page, if one of its keys has it open. If it cannot be started, its keys show an alert.
- **Children end with the launcher.** Stream Deck and OpenDeck stop only the plugin they started, so each child checks every two seconds that the launcher is still there and ends when it is gone.
- **Local only.** Each child connects to a port of its own on 127.0.0.1. A connection counts only if it carries no browser `Origin` and registers the plugin id the launcher made up for that start; anything else is closed.
- **Logs.** `logs/suite.log` (starts and stops, never settings or passwords), `logs/fadester-output.log` and `logs/vjster-output.log` (what each child printed). The plugin's own SDK logs are in the same folder.

## Keeping the pieces in step

VJster's own folder, `com.jbrick2070.vjster.sdPlugin`, stays the source of its images, strip layout, settings page, language files and manifest. `npm run suite:assemble` copies what the suite needs into the Fadester folder (the seven manifest entries, the language entries in every language, the images, `layouts/vjster-strip.json`, `ui/vjster/`, and `vjster/`, the folder the VJster child starts in, which holds VJster's own manifest and language files because the SDK reads both from there). `tests/suite-assemble.test.ts` fails when those copies are out of date; `npm run build` runs the assembly.

```powershell
npm run build            # Fadester, VJster and the suite launcher, then copies VJster into bin/vjster
npm run validate         # Elgato's validator on the suite
npm test                 # includes tests/suite-*.test.ts
npm run opendeck:parity  # drives the suite like OpenDeck does, against a real OBS 33 (see OPENDECK.md)
```

## The test OBS

The live runs (`npm run test:obs-live`, `npm run opendeck:parity`, `tests/vj-rig-live-check.ts`, `tests/playlister-live-check.ts`) and Midi Fadester's and Visual Sidechain's own live runs use this machine's one test OBS, `C:\Users\jeffr\OBS-Studio-33-Portable`. It holds only settings. Its `bin`, `core` and `data` are directory links to the installed OBS 33, and `plugins\midi-fadester`, `plugins\obs-playlister` and `plugins\visual-sidechain` are links into the one plugin folder, `C:\ProgramData\obs-studio\plugins`, which the operator's OBS loads too. So there is one OBS and one set of plugins, and a run never changes the operator's own OBS settings. Every run refuses while any OBS is open. Remove a link with `rmdir`; never delete the folder with a recursive delete, which can follow a link and empty the installed OBS or the plugin folder.

## Not done yet

- VJster's Stream Deck profiles in the suite.
- A single language setting for both halves: Fadester's and VJster's Language boxes are still separate, and each applies to its own actions.
- Dutch names for VJster's actions in the host's action list (the Dutch file holds the plugin's own texts only, by design).
