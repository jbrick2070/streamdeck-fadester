# Changelog

What changed in Fadester for OBS and, where it says so, in VJster. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the plugin's own (`manifest.json`). There is no change control here: the newest entry is the version.

## Unreleased

- **Fadester Companion from the Microsoft Store speaks your language.** The Store package declared only English, and Windows gives a packaged app the best match between your languages and the ones its package declares, so the panel, the Quick guide and the presets came up in English on a German, French, Japanese or other Windows. The next package declares all ten languages the companion ships in. The larger logo sizes (200 % and 400 % display scaling) are now included in the package in a form Windows reads.
- **Fadester Companion: the Quick guide covers game controllers.** In all ten languages the Quick guide now shows how to start with an Xbox or XInput controller instead of a TourBox (tick the controller box, cue with the D-pad, take with the trigger or a held A), and tells people who installed from the Microsoft Store to open Fadester Companion from the Start menu.
- **Fadester for TourBox is now Fadester Companion, with a new icon.** The control panel's window and heading say Fadester Companion, the name it will have in the Microsoft Store, since it now runs a game controller and VJster as well as a TourBox; the TourBox preset in TourBox Console keeps its name. The icon is the Fadester faders with a small game pad, drawn to stay sharp from the taskbar's 16 px up to 256 px. A privacy page, [docs/PRIVACY.md](docs/PRIVACY.md), says what the companion keeps and sends: settings and a log on your computer, commands to OBS, and nothing to the internet.
- **Fadester for TourBox: the controller's take pushes the T-bar.** A take from the game controller (A) played OBS's transition while OBS's T-bar stayed still, so nothing on screen showed the move. With a Fade selected in OBS, holding A now pushes the T-bar like a hand, end to end in the Fade's **Duration**, and reaching the end takes. Let go before the end and the T-bar stays there; hold A again to carry on, press B to finish at once, or View to go back to Program. In easy mode the push starts after 0.15 s of holding; a take OBS plays by itself still needs 0.4 s. The Activity tab says where a T-bar was left and how to go on. With Cut or another transition selected, or another transition override on the Preview scene, A is OBS's own take as before. Takes from the TourBox, a Stream Deck or OBS itself are unchanged.
- **Fadester for TourBox: game controller (Windows).** An Xbox or XInput controller can drive OBS through the companion, with or without a TourBox: the right trigger is a spring-loaded T-bar (pull to mix, all the way to take, let go early to go back), A takes, B cuts, the D-pad cues Preview (up and down walk OBS's scene list as it is drawn) and rides Music (left and right), the left trigger ducks Music while held, and the sticks ride Layer 2 and VJster's speed, with fast and slow speed presets. It keeps working while OBS is in front, which a browser page cannot do. Off by default: tick **Use an Xbox or XInput game controller** in the panel. **Easy mode**, on by default, makes take, cut and other sudden switches on air need a short hold, so a bumped control does nothing. Every control but the right trigger can be set on the panel's **Game controller** tab, with a second layer while LB is held. See [docs/gamepad/README.md](docs/gamepad/README.md).
- **Fadester for TourBox: cut.** After a cut OBS could end up on Cut, so the next take cut instead of fading and the T-bar was refused until you picked Fade again. OBS ignores a change of transition until the last one has finished, which can be about a second after the picture is done, and it sometimes switched back to Cut by itself as the cut finished. The companion now keeps trying for about three seconds, so a take pressed right after a cut fades, and a cut pressed right after a take goes out as soon as OBS lets it instead of doing nothing; if OBS still refuses, it says so. A second take or cut pressed before the first has gone out counts as a double press and does nothing. For 30 s after each cut it also checks again before the next take, cut, T-bar move or cancel, and it says whether the cut went out.
- **Fadester for TourBox: T-bar with Cut selected.** The trigger and the Dial refused to mix while OBS had any transition but a Fade selected, so after a cut that left OBS on Cut the T-bar did nothing until you picked Fade by hand. The T-bar now selects a Fade for the throw and puts your transition back when you let go or take.
- **Fadester for TourBox: transition trace.** When OBS ended up on a transition you had not picked, nothing showed what had changed it. Started from a terminal with `--trace-transitions`, the companion now prints each change of OBS's selected transition with the time and says whether it asked for that change itself, next to its own scene and T-bar requests, every transition OBS runs and each selection OBS did not act on within three seconds. Apart from one reading of the selection at the start, the trace sends OBS nothing of its own, and without the option nothing is different. See [tourbox/README.md](tourbox/README.md#read-the-desk-and-recover).
- **Fadester for TourBox: lost connection.** When the link to OBS dropped and came back, the companion forgot what it had in hand: a ducked source stayed ducked, the transition a cut still owed stayed on Cut, and a part-thrown T-bar stayed part-way with nothing able to clear it. It now carries these across the reconnect: Restore brings the duck back, your transition is put back, and a part-thrown T-bar returns to Program. Cancel also releases a T-bar that an earlier run left stuck part-way. While OBS is not connected, a controller press now says so once in the log.
- **Connection that died quietly.** After sleep, a pulled cable or a frozen OBS the connection could stay open with nothing behind it: keys kept showing a timeout and nothing reconnected until OBS or Stream Deck was restarted. Fadester now checks a silent connection, drops a dead one and reconnects by itself.
- **Volume above 0 dB.** A source boosted above 0 dB in OBS was pulled down to 0 dB by the first turn of a volume dial or the start of a fade. A turn or a fade now starts from the level the source has; Fadester still never adds boost of its own.
- **Settings Stream Deck refuses to save.** When Stream Deck could not save the connection settings, the plugin could stop, and the address on the page was not the one in use. The new address is now used at once, the save is tried again with the next change, and the failure goes to the log.

## 0.10.1 - 2026-11-08

- **OBS address with a port:** a Host typed as `127.0.0.1:4455` no longer makes Fadester stop on the next key press (and, in the suite, stop for good after a few presses). It now shows OBS unreachable until the Host holds the address alone.
- **VJster link settings:** changing the link port or the allowed extension at the moment a key appeared could leave the old link running with the old settings, with the keys saying EXTENSION OFF until Stream Deck restarted. The old link now always stops first.
- **Scene transitions:** when OBS answered the temporary Cut or Fade selection too late, the scene could keep that transition as its own setting. Fadester now always puts the scene's own transition back.
- **Connecting:** when OBS answered the first request after connecting too late, Fadester stayed half-connected until a control was pressed. It now drops that connection and connects again by itself.
- **Suite:** a settings page left open while Fadester or VJster restarted inside the suite stopped answering until it was reopened. It now keeps working.
- **VJster Both:** a control set to Both now drives the OBS page also when Chrome is closed or has no video; the strip still shows Chrome's state. It used to refuse with an alert.
- **Filter controls:** when OBS refuses a value, or does not answer in time, the control now says why instead of just not moving.
- **VJster allowed extension:** an over-long entry in Only this extension (such as a pasted extension page address) no longer lets every extension connect; it now counts as an invalid id.
- **VJster start-up:** if Stream Deck does not send VJster's stored settings, VJster goes on after 5 s with a working OBS page link instead of waiting for good.
- **Midi Fadester settings pages:** with Fadester's Language set to a language other than Stream Deck's, these two pages mixed in words of the chosen language. They are now wholly in Stream Deck's language until they get the Language choice.
- **VJster:** after a play/pause leaves another tab's video as the one to control, the deck shows that video at once.
- **VJster extension:** when every-site control is turned off, VJster stops using it at once in open tabs (a page's script may run until the page reloads; VJster ignores what it reports); the option should keep working after the extension is updated or reloaded (checked by hand in docs/vjster/TESTING.md 1.8); and the options page shows its real state.
- **TourBox panel:** the Adjust the feel hint names the current controls.
- **VJster:** a held quality level is restored after a YouTube ad.
- **VJster OBS page:** quick speed-step presses add up.
- **Preparing Studio Mode** no longer replaces a Preview you had already chosen when OBS's Studio Mode notice arrives while Fadester is still reading the scenes; it decides on what OBS reports at that moment.
- **Connecting while OBS starts:** OBS's websocket takes clients before OBS has finished loading, and answers every request "not ready" until it has. A deck or controller that connected in that moment stayed half-connected (never Connected, and never trying again) until OBS was restarted, and Midi Fadester could be reported as not installed. Fadester now waits a moment and tries again on the same connection. Large scene collections, which take longest to load, made this likely.
- **TourBox on macOS (experimental, not a release):** the Mac development pieces are now on `main`: an action host, a shortcut-input helper, a native T-bar adapter, a setup panel, two probes, a grouped-mix host, the `tourbox-macos` core-check workflow, and a Mac encoding of the one preset (`tourbox/presets/macos`), regenerated from the current map so that the video and layer actions carry Control+Shift and Option+Shift. Nothing Mac-side has been built since the VJster layout landed; [tourbox/MACOS.md](tourbox/MACOS.md) lists what still needs porting. The Windows package is unchanged.
- **TourBox layers:** a layer acts only when its scene item is found exactly once, so a source that left its scene, or a doubled copy, is refused instead of changing Program through the wrong item. A Top + Dial opacity turn counts as a held Dial turn for the stray T-bar guard. The bridge stops on the end of its input only when the panel started it. The rehearsal no longer has you reset the video speed by pressing Side + Knob for a status.
- **TourBox:** the panel's preset button is now **Import into TourBox Console**: it copies the preset's path, opens Console and says what to do there, so nobody ends up double-clicking the `.tb` file. **Local port** is now **OBS port**; while VJster is on it can no longer be the same as the VJster port, and a wrong port is reported as a wrong port instead of a request for a password. "Connected to OBS" now says that the TourBox does nothing until the controls are started.
- **TourBox safety:** the Tour menu's quality reset no longer uses Alt+Shift+F4, which Windows could read as Alt+F4 and close the window in front while the controls were stopped; import the preset again to get this. A T-bar tick right after a Music turn is ignored, so a detent that slips out of Side + Dial cannot move Program. Late opacity and blend ticks are dropped sooner. The controls stop when the panel goes away, and the panel keeps a short `panel.log`.
- **TourBox docs:** VJster controls YouTube in Chrome only, not a YouTube browser source in OBS; show the video with a Window Capture of Chrome.
- **OBS Fadester for TourBox drives YouTube and two VJ layers.** The companion hosts the VJster link itself (the loopback WebSocket the VJster Chrome extension connects to; the same rules and protocol as the Stream Deck plugin's), outside its OBS loop, so the video works with OBS closed. The one preset's layout changed: the raised Knob is the video's speed (press and turn for 0.05 steps, tap to read the video, Side + press for 1x), Scroll press-and-turn its quality, Side + D-pad Up play/pause; Music moved to Side + Dial. Hold Top for the VJ layers: Knob and Scroll cycle Layer 1's and Layer 2's blend mode, the Dial rides Layer 2's opacity through its Color Correction filter. The new actions use Ctrl+Shift and Alt+Shift F-key chords. The panel gets the VJster port and extension pin, Layer 1 and 2 and the opacity step; labels in nine languages; a port taken by the Stream Deck plugin's VJster is reported, never taken over. Self-tests cover the link and the layer actions; `tests/tourbox-vjster-link.test.ts` drives the built bridge with the real extension logic.
- **VJster Chrome extension 0.1.2:** the options page and store description now name all three companions (the VJster plugin for Stream Deck or OpenDeck, and Fadester for TourBox), and the download link opens the full releases page so the TourBox package can be found.
- **VJster Chrome extension 0.1.1:** the options page now says the extension needs the VJster plugin, with links to get it, the install steps and the privacy policy (in all 12 languages), and a first install opens that page. The manifest names the project's home page. Dutch is the extension's twelfth language.

## 0.10.0 - 2026-11-04

- Fadester’s bundle and all 17 suite actions now use the GitHub account namespace `io.github.jbrick2070.fadester-for-obs`. The previous `com.jbrick2070.fadester-for-obs` build and its custom profiles can stay installed during migration; the new plugin has separate settings. Re-enter the OBS password and use a new starter or rebind your controls. Standalone VJster keeps its own ID.
- First-time OpenDeck users can choose a working Scene Desk straight from the profile list (Source Desk on Mini). No source build is necessary. The optional source installer selects that layout on a new, empty deck. See the [OpenDeck guide](docs/OPENDECK.md#first-five-minutes).

## 0.9.1 - 2026-11-04

### Fixed

- **The display strip of a Stream Deck + in OpenDeck** drew a grey and black checkerboard instead of the dials' pictures. OpenDeck's strip renderer reads a layout picture only from a base64 data URI, and every dial sent the URL-encoded form that keys (and Stream Deck software) accept. Dials, in both Fadester and VJster, now send the strip picture as base64; keys are unchanged.
- The suite's generated files are compared without regard to line ends, so a fresh checkout on Windows or Linux no longer reports them out of date.

## 0.9.0 - 2026-11-04

### Added

- **One plugin suite** ([docs/SUITE.md](docs/SUITE.md)): the Fadester plugin now carries VJster's seven actions (**VJster Speed**, **Quality**, **Speed Preset**, **Speed Step**, **Quality Preset**, **Pin Tab**, **Play / Pause**), so one install gives seventeen actions. `bin/plugin.js` is a small launcher that registers with Stream Deck or OpenDeck once and runs the Fadester plugin and the VJster plugin as two programs, passing messages between them and the host; neither plugin's own code changed. Their stored settings sit side by side (VJster's under their own key) and a save by one never touches the other's. A program that stops is started again. The standalone VJster plugin is still built and released. Fadester's own action ids are unchanged; VJster's are `com.jbrick2070.fadester-for-obs.vjster-*`. VJster's Stream Deck profiles are not in the suite yet.
- **OpenDeck support** ([docs/OPENDECK.md](docs/OPENDECK.md)): `npm run opendeck:install` copies the plugin (Fadester, with VJster in it) into [OpenDeck](https://github.com/nekename/OpenDeck) (a free, open-source host for Stream Deck plugins) and puts VJster's starter keys and dials on the deck, filling free slots only, and `--fadester-layouts` writes Fadester's ready-made layouts as OpenDeck profiles (a multi-page rig becomes one profile per page). Tried on Windows with a Stream Deck +; the plugins themselves are unchanged.

### Changed

- The documentation was rewritten for ease of use: README, DECK-LAYOUTS.md, the profile library, VJster's README and INSTALL.md, and this changelog. Engineering records (REQUIREMENTS, PLAN, TESTING) are unchanged.
- The **Suite Demo Kit 1.1** (`demo-kit/`): real footage (the train, sprint and hurdles clips) full frame instead of the generated loops; one Playlister per scene, with the 50 % copy in its own scene; the **Suite Demo Kit +** profile is a Studio Mode layout: every scene key cues in Preview and dial 1 of every page is the scene mixer (Scene blend).

### Fixed

- The scene mixer's press (and the end of a queue-next throw) takes Next live on OBS 33.0.1. OBS 33.0.1 cancels a T-bar released over obs-websocket and Program snapped back; the press now leaves and re-enters Studio Mode instead, checks that Program is Next, and says so on the dial when it is not. OBS logs "Switched to regular Preview mode" and "Switched to Preview/Program mode" at each take.

### Planned for 0.8.1 (not yet in the code)

- Visual Panic's Restore key: a 2 s hold with a ring while holding and a green check when OBS accepts it (today 0.8 s).
- A first-five-minutes hint on the settings page.

## 0.8.0 - 2026-11-01

### Added

- **OBS Filter** (keys and dials): ride one filter setting on a dial (a Visual Sidechain Shader Filter's Effect mix or Reactivity, a Color Correction's opacity, or most numeric settings with a range), press to drop it while held; from a key, turn a filter on and off, glide a setting to a value, or step it. Writes are paced and never touch a setting an Audio Modulator or a fader drives.
- **Visual Panic** (keys): Visual Sidechain's Panic at once and Restore after a 0.8 s hold, through OBS's hotkeys; PANIC SENT on the keys until a Restore is accepted.
- **VJ Rig +** and **VJ Rig 15 Keys** layouts: four pages (Perform, Layers, Visuals, Scenes) with Panic on the same key on every page and Next page bottom left. Accent colours (brass, teal, magenta) on the direct actions.
- **Playlister Transport** (keys): Previous, Next, Play/pause, Stop, Restart and Status for one Playlister source, showing the state OBS reports; the **Playlister Transport +** layout. Needs Playlister 0.5 or later.
- **Language choice** on every settings page: Automatic (Stream Deck's language) or one of nine languages, now including **Dutch**. The choice applies to every Fadester control at once and survives restarts.
- Translations of every text the plugin draws or shows (keys, dials, the Info Bar, status sentences, the settings pages) in Elgato's eight languages: English, German, Spanish, French, Japanese, Korean, Simplified Chinese, Traditional Chinese.
- **VJster 0.2.0**: the OBS page (a browser source that plays a YouTube video at the speed the deck sets, 0.25x to 2x), the Target setting (Browser, OBS page, Both), the **VJster Dual +** profile, the same language choice with Dutch, and translations of the plugin, its settings page, the Chrome extension and the OBS page.
- The **Suite Demo Kit 1.0** (`demo-kit/`): one OBS scene collection, media and two Stream Deck + profiles that show Playlister, Visual Sidechain, Fadester for OBS and VJster together.

### Changed

- The bundled layouts are rebuilt with version 0.8.0.0; there are fourteen.
- VJster's static key images carry a number or a symbol instead of English words, so they fit every language.

### Fixed

- Saving global settings never loses a key, including writes that race each other, a write before the stored settings are known, and an older settings page's copy (both plugins).
- VJster's packed plugin now contains its OBS page (`bin/obs`).
- Wording: Korean "action" is 동작 in VJster as in Fadester; Dutch says "toets" and "draaiknop" for a key and a dial, and "Verbinding aanhouden" for keeping the link on.

## 0.7.7 - 2026-10-31

### Added

- **OBS Scene Info Bar** for the Stream Deck Neo: connection, live scene and, in Studio Mode, the preview scene. The plugin now needs Stream Deck 7.6.

## Earlier

- **2026-10-31**: VJster Phase 1 (the Stream Deck plugin, the Chrome extension, the loopback link, the install guide) and Phase 2 (the OBS page).
- **0.6.0 - 2026-10-28**: direct OBS controls (Scene & Transition, OBS Fader, OBS Fade, Source & Layer) and the dynamic starter layouts, with no Midi Fadester needed.
- **0.3.0 - 2026-10-28**: the Midi Fadester slot editor and controller panel in the settings page, safer connection handling.
- **0.2.0 - 2026-10-28**: the Midi Fadester FX catalog and clean controls.
- **2026-10-27**: the first build: a Midi Fadester Fader dial and Auto-fade key, with live OBS 33 conformance tests.
