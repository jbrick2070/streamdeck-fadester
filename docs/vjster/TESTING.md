# VJster -- Manual checks

Numbered checks that need a real Chrome, a real Stream Deck or a real OBS,
with the expected result. Automated tests cover everything else
(docs/vjster/PLAN.md section 5). Each release lists which items were run, by
whom and on what versions. File names here mean the files in `docs/vjster`.

## 1. Chrome extension (Phase 1 step 4)

Build it first, from the repository root:

```
npx rollup -c vjster-extension/rollup.config.mjs
```

1.1 **Load unpacked (D-3 a).** In Chrome open `chrome://extensions`, turn on
Developer mode, choose "Load unpacked" and pick `vjster-extension/bin`.
Expected: VJster appears with its icon and no error; the details page lists
the YouTube host permission. Note whether Chrome warns about
`ws://127.0.0.1/*` (V-12).

1.2 **Options page.** Open VJster's options. Expected: port 48150, the
extension's 32-letter id, the all-sites box unticked. Save 48151, reopen:
48151 is kept; set it back to 48150.

1.3 **Link to a stub server (no Stream Deck needed).** In a terminal at the
repository root run the link server on its own:

```
node --import tsx -e "import('./src/vjster/plugin/link-server.ts').then(async (m) => { const s = new m.LinkServer({ log: console }); s.on((e) => console.log(JSON.stringify(e))); await s.start(); })"
```

Open the extension's service worker console (`chrome://extensions`, VJster,
"service worker"). Expected within 30 s: the terminal prints
`{"type":"connected","target":"browser"}` and a `state` event with `rate: null` (no video yet). If
nothing connects, note the console error (V-12: the worker may need the host
permission, or Chrome may ask for local network access).

1.4 **A playing video becomes the target.** With 1.3 running, open
`https://www.youtube.com/watch?v=aqz-KE-bpKQ` and let it play. Expected: a
`state` event with the title, `host: "www.youtube.com"`, `rate: 1`,
`qualityAuto: true`.

1.5 **Repeat the probe in Chrome 156 (V-11).** Paste
`scripts/vjster/probe-player-api.js` into the watch page's DevTools console
with `window.VJSTER_PROBE_OPTIONS = { navigate: true, persist: true }` set
first. Expected: the same methods, rate list and behavior as PROBE-LOG.md; add
the result there as a new run.

1.6 **An ad (V-3).** On a video that shows an ad, while the ad plays, watch the
`state` events. Expected: `adPlaying: true` during the ad, then false. Any
speed or quality change sent during the ad is applied only after it ends.

1.7 **Navigation (V-4).** Go from the YouTube home page to a video, then to a
Short, then back to a normal video, then to music.youtube.com. Expected: each
watch page reports its video; a Short or the home page reports `rate: null`
or a video, never stale data from the previous page.

1.8 **All sites (D-4).** Tick "Control videos on every site", accept Chrome's
prompt, reload a page with a plain HTML video (for example a news site).
Expected: its video reports `capabilities: ["speed", "transport"]`. Untick:
the permission is removed and the page stops reporting after a reload.

1.9 **Two tabs (R-TGT-1).** With 1.3 running, play a video in one tab, then
another in a second tab. Expected: the `state` events follow the second; pause
it and they stay with it (paused most recently); close it and they move to the
first.

1.10 **Leaving a site.** While a YouTube video is the target, go to
`https://example.com` in the same tab. Expected: at once, a `state` event with
`rate: null`, or the other tab's video.

1.11 **Worker restart (F-5).** Stop the stub server with Ctrl+C and pause the
video. Wait two minutes, or stop the worker on
`chrome://serviceworker-internals`. Start the stub server again. Expected
within a minute: it connects and reports the paused video (`rate` set,
`playing: false`), not `rate: null`.

1.12 **Two Chrome profiles.** Load the extension in a second Chrome profile and
open both. Expected: the connection changes hands about every 24 to 30 s, not
every second. Use one profile for a show.

1.13 **Hold quality and pin (R-QLT-7, R-TGT-2).** These need intents from the
deck, so they are checked with the plugin in section 2.

## 2. Stream Deck actions (Phase 1 step 5)

Build and check the plugin first, from the repository root:

```
npm run build:vjster
npx streamdeck validate com.jbrick2070.vjster.sdPlugin
```

(`npm run build:vjster` builds the OBS page into `bin/obs` and then the plugin bundle; `npm run build` at the root
runs it after Fadester's build. A pack made without the page makes the plugin log "the OBS page files are missing
from the plugin", as the L.6 device check found.)

2.1 **Link the plugin (changes the Stream Deck app).** Run
`npx streamdeck link com.jbrick2070.vjster.sdPlugin`, then
`npx streamdeck restart com.jbrick2070.vjster`. Expected: a VJster category
in the action list with seven actions and their icons; four profiles,
VJster Live +, VJster Dual +, VJster Live and VJster Mini, in the profile
list, not switched to. Undo with `npx streamdeck unlink com.jbrick2070.vjster`.

2.2 **Extension off.** Switch to VJster Live + with Chrome closed. Expected:
every dial strip says `EXTENSION OFF` in red; turning a dial shows Stream
Deck's alert.

2.3 **A video.** Open Chrome with the extension (section 1) and play
`https://www.youtube.com/watch?v=aqz-KE-bpKQ`. Expected within a few
seconds: SPEED shows `1x` and the title, QUALITY shows `AUTO` and the level
playing, the 1x key is framed in neon.

2.4 **Speed.** Turn SPEED one notch: `1.25x` on the strip and in YouTube's
settings menu. Hold and turn: steps of 0.05. Press: back to `1x`. Turn NUDGE:
steps of 0.05. Check that YouTube's menu labels a value such as 2.25 (R-SPD-2).

2.5 **FX speed.** Press the 8x key, then the 0.1x key. Expected: the video
plays at 8x and at 0.1x, the strip shows `EXT`, YouTube's menu does not
change. Press 1x: back to normal.

2.6 **Quality.** Turn QUALITY down one notch: the strip shows the lower level
with `FIXED`, YouTube's menu shows it. Press QUALITY or the Auto key: `AUTO`.
Go to another video: the fixed level is kept, the nearest lower one if the
video lacks it (R-QLT-7).

2.7 **Play, pause, pin.** The play/pause key and a tap on the SPEED strip
toggle the video. Start a second video in another tab, then press Pin on the
first tab: the deck keeps controlling the pinned tab; press Pin again to let
go.

2.8 **An ad.** On a video that shows an ad, the strip says `AD`; a speed key
pressed during the ad is applied when the ad ends.

2.9 **Port in use.** Close Stream Deck, start something on port 48150 (for
example the stub server of 1.3), start Stream Deck. Expected: `PORT IN USE`
on the strips; the settings page says so and lets you choose another port.
Stop the other program: within 30 s the strips come back.

2.10 **Paused page, Picture-in-Picture.** Pause the video in Chrome: SPEED
still shows its rate and turning still changes it. Put the video in
Picture-in-Picture: the deck keeps controlling it.

2.11 **Restarts.** Reload the extension on `chrome://extensions`, then restart
Chrome, then restart Stream Deck. Expected each time: the strips say
`EXTENSION OFF` or `NO VIDEO` for a moment, then show the video again within
a minute without touching anything.

2.12 **Settings page.** Change a dial's label, step and target, and a key's
rate: the strip and key follow at once. Type a wrong extension id and save:
the status line says it is not an extension id and nothing connects; clear it
and save: the extension connects again.

2.13 **Other decks.** On a 15-key Stream Deck and a Mini, the VJster Live and
VJster Mini profiles show the presets, Speed Step keys (+ and -) and Quality
Preset; a Quality Preset for a level the video lacks is dimmed. Profiles for
a device type that is not connected may not appear until it is.

2.14 **A pinned title and a turn during an ad.** Pin a tab: the Pin key shows
its title. During an ad, turn SPEED two notches: the strip shows the new rate
dimmed next to `AD`, and the video takes it when the ad ends.

The same flows run without hardware in `tests/vjster-plugin-e2e.test.ts`.

## 3. OBS browser-source page (Phase 2)

Build the page with the plugin, from the repository root, then link the plugin as in 2.1:

```
npm run build:vjster
```

(the same as `npx rollup -c vjster-page/rollup.config.mjs` followed by `npx rollup -c vjster-plugin/rollup.config.mjs`;
`tests/vjster-plugin-images.test.ts` fails when a build leaves `bin/obs/player.html` or `player.js` out.)

3.1 **Add the page to OBS.** Open any VJster action's settings, find OBS page,
paste a YouTube link, press Copy address. In OBS add a Browser source, untick
Local file, paste the address as its URL, size 1920 by 1080. Expected: the
video plays with sound. Close and reopen the settings page: it says `OBS page
connected`, and Keep the link on is ticked.

3.2 **Drive OBS.** Set a Speed dial's Control to OBS page. Expected: the strip
shows the video's title and `1x`; turns go from 0.25x to 2x, no further;
Quality set to OBS page says `n/a`. Play/Pause set to OBS page toggles the
video and its caption says `OBS PLAYING` or `OBS PAUSED`.

3.3 **Both.** Set the dial to Both, with a video in Chrome too. Expected: a turn
changes both videos to the same speed; the strip shows Chrome's state.

3.4 **Studio Mode, hidden and shown.** In Studio Mode put the source in Preview
only: it still follows the deck. Hide the source and show it again: with
Shutdown source when not visible off (the default) nothing changes; with it
on, the page reloads and reconnects within a few seconds.

3.5 **Restarts.** Restart OBS while Stream Deck runs: the page loads and
connects. Restart Stream Deck while OBS runs: the strip says `NO PAGE`, then
the page reconnects within 30 s.

3.6 **Keep the link on, off.** Untick it, leave the VJster profile for more
than a minute, then refresh the browser source. Expected: OBS shows an error
page, because nothing serves the page; show a VJster action again and refresh
the source.

3.7 **Offline start.** With the network off, start OBS: the page says it is
trying YouTube's player again. Turn the network on: the video starts within
30 s without refreshing the source.

3.8 **VJster Dual +.** Switch to the bundled VJster Dual + profile with a video
in Chrome and the OBS page. Expected: the CHROME and OBS dials drive one video
each, SYNC drives both, and the keys' captions name their target.

The page's logic runs without OBS in `tests/vjster-page.test.ts`.

## 4. Release files (step 6)

Build them as INSTALL.md says, in a clean worktree of the release commit.

4.1 **The plugin file.** Double-click `release/com.jbrick2070.vjster.streamDeckPlugin`
(after 2.1's `npx streamdeck unlink com.jbrick2070.vjster` if it was linked).
Expected: Stream Deck installs VJster 0.1.0.0 with seven actions; it may ask
to install the bundled profiles; an action's settings page shows the OBS page
section.

4.2 **The extension zip.** Unzip `release/vjster-chrome-extension-<version>.zip`
into a new folder and load that folder unpacked. Expected: as 1.1, with no
error about a missing file or icon.

4.3 **Together.** With both installed from the release files, run 2.3 and 3.1.

## 5. Languages (PLAN.md section 8)

5.1 **Stream Deck in German.** Set Stream Deck's language to Deutsch
(Preferences, General) and restart it. Expected: the action list shows
Tempo, Qualität, Tempo-Vorgabe and so on, with German tooltips; with Chrome
closed the speed strip says TEMPO and ERWEITERUNG AUS, the quality strip
QUALITÄT, the play key PAUSE, the pin key ANHEFTEN; every word stays inside
its key or strip on the Stream Deck + and on a 15-key model.

5.2 **CJK on a real Stream Deck (pending until the CJK files exist).** For
ja, ko, zh_CN and zh_TW in turn, as 5.1. Expected: the glyphs render (no
boxes or question marks) in the font of that language and fit their boxes
on a 72 px key. Until this has been run, R-I18N-4 holds only for the width
estimate of `src/vjster/plugin/display.ts`.

## 6. Language choice (PLAN.md section 9, step L.5)

Run with the root `TESTING.md` section 1 (same builds, same order); the Stream Deck app stays in English. The
simulator run of this flow (images, how made):
`C:\midi-fadester\docs\demo-reel\production\v2\captures\deck-lang\LOG.md`.

6.1 **Nederlands.** With the VJster Live + profile on the Stream Deck +, Chrome open on a YouTube watch page and
the extension connected, open a VJster action's settings, find **Taal / Language** ("all VJster controls") and
pick **Nederlands**. Expected: the page changes to Dutch in place (DEZE ACTIE, TAAL, VJSTER-VERBINDING,
"Verbinding opslaan"), a label or port typed and not yet saved stays; every VJster key and strip redraws at
once: TEMPO, FIJN, KWALITEIT, FX-TEMPO, WEB, AUTO, SPEELT or PAUZE, VASTZETTEN (VASTGEZET once pinned); the
rate keys keep "0.1x" and "0.5x" with a point. Every word fits its key or strip on the hardware. Stream Deck's own action
list, tooltips and dial hints stay English; the OBS page and the Chrome extension stay in their own language
(D-L7), and the OBS page address keeps `hl=en`.

6.2 **Status words.** Close Chrome. Expected: EXTENSIE UIT on the strips. During a YouTube ad (if one comes):
RECLAME SPEELT, which is one of the two Dutch judgement calls; say if it reads badly.

6.3 **The choice is kept over a restart.** Quit the Stream Deck app and start it again (root 1.5). Expected:
VJster's keys and strips come back in Dutch with no settings page opened; the Language select shows
Nederlands; the link still works on the same port with the same extension allow list.

6.4 **Back to Automatic.** Pick **Automatic (Stream Deck's language)**. Expected: everything back to English at
once; the port and the "only this extension" id are unchanged (open the page again to see them).

6.5 **日本語 on an English app.** As 6.1 with 日本語: 速度, 微調整, 画質, FX 速度, 再生中, タブ固定, 自動. Expected:
the glyphs render in a Japanese font and fit (closes 5.2 for Japanese). Then Automatic again.

**Result (2026-11-01).** Run by the operator with the root section 1, on a Stream Deck + (device 4057/132), Stream
Deck app 7.6.0.23012, Windows 11; the VJster build from b20bd27 installed by double-click.

- 6.1 PASSED: TEMPO, FX-TEMPO, PAUZE, VASTZETTEN, KWALITEIT and EXTENSIE UIT on all four strips; the page in Dutch:
  DEZE ACTIE, Stap bij draaien, Bediening Chrome-tabblad, TAAL, VJSTER-VERBINDING, Wachten op de Chrome-extensie,
  Verbinding opslaan.
- 6.2 NOT RUN: no Chrome extension connected during the check.
- 6.3 PASSED: app restarted at 15:08:01, Dutch came back on its own.
- 6.4 PASSED: Automatic gave English again, port 48150 kept.
- 6.5 NOT RUN.

Found on the way, fixed in step L.6 (PLAN.md section 9): (a) the static images Stream Deck draws inside the dial
circles and in the action list (`imgs/actions/*/key.svg`) carried English words ("1x SPEED", "AUTO QUALITY"); they
are now a number or a symbol only, and `tests/vjster-plugin-images.test.ts` keeps them so. (b) The packed plugin had
no `bin/obs`, so it logged "the OBS page files are missing from the plugin": `npm run build` did not run the page
build. It does now (`build:vjster`), and the re-packed `com.jbrick2070.vjster.streamDeckPlugin` holds
`bin/obs/player.html` and `player.js`. It is in `C:\Users\jeffr\Documents\StreamDeck-builds\2026-11-01-language-choice\`
(the operator's folder, with `BUILT-FROM.txt`) for the operator to re-install; 3.1 and 6.2 can then be run with the
extension and OBS.
