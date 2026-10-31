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
npx rollup -c vjster-plugin/rollup.config.mjs
npx streamdeck validate com.jbrick2070.vjster.sdPlugin
```

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
npx rollup -c vjster-page/rollup.config.mjs
npx rollup -c vjster-plugin/rollup.config.mjs
```

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
