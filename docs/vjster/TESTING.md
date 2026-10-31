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

Added with step 5.

## 3. OBS browser-source page (Phase 2)

Added with Phase 2.
