# VJster -- Plan

Status: APPROVED 2026-10-30 by the operator. Phase 0 and Phase 1 step 1 done in
`C:\vjster`; moved into this repository the same day (Phase 0b). Companion to
docs/vjster/REQUIREMENTS.md; every step cites the rows it serves. File names
such as REQUIREMENTS.md and PROBE-LOG.md mean the files in `docs/vjster`.
Sections changed after that approval await the operator's review: 3.1, 3.3
to 3.7 (the `hold` and `direct` fields, the rules step 2 settled, and the
extension details of step 4, which replaced the approved per-page nonce),
Phase 0b, and steps 2 to 6.

## 1. Toolchain findings on this machine (checked 2026-10-30)

- Stream Deck app 7.4.2.22730, confirmed 2026-10-30 from the app's own log (build May 11 2026). Fadester's committed manifest asks for 7.1; an uncommitted change in this working tree raises it to 7.6, above the installed app, which would then refuse the plugin (F-7). The standalone VJster manifest asks for 7.1 (step 5).
- Node v25.9.0, npm 11.12.1. VJster builds with Fadester's own `package.json`: Node >= 24, `@elgato/streamdeck` 3.0.3, `@elgato/cli` 1.10.3, rollup 4.65.1, TypeScript 5.9.3, vitest 3.2.7, tsx 4.23.15, and `ws` 8.22.0 through `@elgato/streamdeck` (R-STD-3).
- Fadester's baseline on 2026-10-30, with its uncommitted work in the tree: `npx tsc --noEmit` clean, `npm test` 22 files and 234 tests passing; with the Phase 0b files added, 23 files and 237 tests. A clean worktree of HEAD 7cf7207 plus only the Phase 0b files: `npm ci`, `npx tsc --noEmit` clean, `npm test` 22 files and 234 tests passing.
- `npm run test:mutation` fails on Fadester's own HEAD 7cf7207, with or without the VJster files: mutation M-1.1 (the encoder layout path in the plugin manifest) survives `tests/manifest-hygiene.test.ts`. The mutation rewrites the first `"layout"` line, which at HEAD belongs to the `layer-control` action, while the committed hygiene test checks only the `fader` action's layout; the uncommitted version of that test checks every Encoder action and would likely kill it. Fadester's runner throws at the first surviving mutation and has no filter, so nothing after M-1.1 runs. Both files carry uncommitted work, so VJster leaves them alone (R-HOME-5) and keeps its own runner (R-TST-4).
- Chrome 156.0.8078.79 at the usual Program Files path. Content scripts in the main world and the WebSocket keep-alive for service workers are both far older than that (F-5).
- Installed Stream Deck plugins that overlap: Elgato OBS Studio, Elgato YouTube (statistics), OBS Browser Events (encrypted manifest). None controls playback speed or quality in a browser, so VJster has no installed competitor; the overlap check is a Phase 2 item (F-9).
- The portable OBS 33 at `C:\Users\jeffr\OBS-Studio-33-Portable` is the Phase 2 test bed. If it is open by hand, ask before closing it.
- No Python is used anywhere (R-ID-5). No Inno Setup is needed: the plugin ships as a `.streamDeckPlugin` file from `streamdeck pack`, the extension as a zip of the built folder.

## 2. Facts to confirm at build time

Rows here start as "to confirm" and become "confirmed <date>" or are corrected, with the requirement updated the same day.

| # | Fact | Status |
|---|------|--------|
| V-1 | `#movie_player` on a watch page exposes `getAvailableQualityLevels`, `getPlaybackQuality`, `setPlaybackQualityRange`, `getPlaybackRate`, `setPlaybackRate`, `getAvailablePlaybackRates`, `getVideoData` (F-4). | confirmed 2026-10-30 and 31 in the built-in pane (Chromium 152): all present, plus `getPreferredQuality` and `setPlaybackQuality`; probed on a 4K Creative Commons video offering hd2160 down to tiny plus auto |
| V-2 | `setPlaybackQualityRange(level, level)` changes the picture within 5 s and `getPlaybackQuality` reports it; the auto form restores Auto. | confirmed in four runs (PROBE-LOG.md): small and hd1080 each seen within about 0.5 s (video height 240 and 1080; the probes poll, so their times are upper bounds); after `setPlaybackQualityRange("auto")`, `getPreferredQuality()` read `auto` at once while the level playing 2 s later was hd720, hd1080, large and hd1080, and hd1080 in the first reviewer's re-run |
| V-3 | The player element carries the `ad-showing` class while an ad plays (R-BEH-1 detection). | not observed: no ad class or overlay in any sample (PROBE-LOG.md lists when each run looked), so the markers are unconfirmed. The adapter watches the `ad-showing` and `ad-interrupting` classes on `#movie_player` and the `.ytp-ad-player-overlay` element; step 4 confirms on a video that shows an ad |
| V-4 | `document` fires `yt-navigate-finish` after an in-page navigation, so the adapter re-binds without a reload. | confirmed for watch-to-watch navigation only (PROBE-LOG.md): `yt-navigate-finish` fired in all six navigations and, in the five that were timed, 0.75 to 0.96 s after the click; `yt-page-data-updated` fired within 4.5 s in only three of those five, so the adapter relies on `yt-navigate-finish` alone; `#movie_player` and its `<video>` element were the same elements before and after in all four navigations where identity was recorded. Not probed: home or search to watch, Shorts, the miniplayer, music.youtube.com, autoplay-next and playlists (step 4) |
| V-5 | `dialRotate` carries `ticks` and `pressed`; the indicator layout id and its fields as the SDK 3 docs list them. | to confirm, Phase 1 step 5 |
| V-6 | A WebSocket from a `chrome-extension://` service worker to `ws://127.0.0.1:48150` opens with that Origin header, and a web page's attempt arrives with its own origin (R-LNK-2). | to confirm by the operator: TESTING.md 1.3. The step 3 tests set the Origin themselves, so they cannot show what Chrome sends |
| V-7 | Port 48150 is free on this machine (`netstat -ano`). | confirmed 2026-10-30: no listener on 48150; a loopback bind succeeded; the port is below the Windows dynamic range (49152 up) and outside the excluded ranges |
| V-8 | OBS 33's browser source, loading `file:///C:/streamdeck-fadester/vjster-page/player.html`, can open a WebSocket to 127.0.0.1 and autoplays with sound (R-OBS-2). | partly confirmed 2026-10-31 (autoplay muted; with sound is TESTING.md 3.1) for the page served at `http://127.0.0.1:<port>/obs` (not a file), in the portable OBS 33.0.0 (obs-browser 2.27.4, CEF 150): it loaded, connected as the `obs` target, autoplayed (muted for the test, so sound was not heard), and followed speed and play/pause; there the embed plays at most 2x, its listed range (PROBE-LOG.md, OBS check) |
| V-9 | A rate set through the API survives in-page navigation; the chosen quality level does not (R-SPD-4, R-QLT-7). | confirmed in four runs (PROBE-LOG.md): 1.5 stayed 1.5, read from the player and the element, on the next video; `hd720` became `auto` every time |
| V-10 | The IFrame embed used by the Phase 2 page behaves like the watch page for rates and quality. F-3 says the embed rounds an unsupported rate toward 1, while the watch page clamped 5 to 4. | probed 2026-10-31 in the built-in pane (Chromium 152, PROBE-LOG.md, embed probe): `getAvailablePlaybackRates` lists 0.25 to 2, yet the embed played 0.25 to 4 on the 0.05 grid (1.33 became 1.3, 1.37 became 1.35, 0.1 became 0.25, 5 and 16 became 4); `getPlaybackRate` lags the setter by one message, about 26 ms, until `onPlaybackRateChange`; there is no `setPlaybackQualityRange`, `setPlaybackQuality` changed nothing, and neither a 256 by 144 player nor `vq=small` moved the level. In OBS the embed stops at 2 (V-8) |
| V-11 | The probe results (V-1, V-2, V-9, F-10) hold in the operator's Chrome 156; they were seen in the built-in pane's Chromium 152. | to confirm by the operator: TESTING.md 1.5 |
| V-12 | Chrome loads the manifest's `ws://127.0.0.1/*` host permission without complaint, and the service worker can open `ws://127.0.0.1:48150` (with or without it; Chrome's local network access rules may ask). | to confirm by the operator: TESTING.md 1.1 and 1.3 |

## 3. Architecture

### 3.1 Files

VJster's files inside the Fadester repository (R-HOME-1). Fadester files that
later steps must edit, each only when no other work modifies it (R-HOME-5):
`package.json` and `package-lock.json` (steps 3 and 4), `.gitignore` (step 4), and in step 5
`src/plugin.ts`, the plugin manifest, `tests/manifest-hygiene.test.ts` and the
plugin's `ui`, `imgs` and `layouts` folders. Nothing else of Fadester's is
touched.

```
C:\streamdeck-fadester
  docs/vjster/
    REQUIREMENTS.md  PLAN.md  PROBE-LOG.md  TESTING.md (step 5)
  src/vjster/
    shared/
      protocol.ts        message types, validation, version (R-INT-1..3)
      speed.ts           step, clamp, snap, extended range (R-SPD-1..2)
      quality.ts         level labels, cycle, auto (R-QLT-1)
      target.ts          target selection over tab states (R-TGT-1..3)
      coalesce.ts        50 ms coalescing with last-value guarantee (R-BEH-3)
    plugin/
      link-server.ts     ws server on 127.0.0.1, origin and token checks, ping (R-LNK-1..4)
      hub.ts             the shared server, latest state per target, start/stop rule, reconfigure
      display.ts         strip and key artwork as SVG, status words (R-SPD-6, R-QLT-3, R-BEH-4)
      settings.ts        per-action and plugin-wide settings with safe defaults
      controllers.ts     what each action does with a turn, press or tap (no SDK)
      actions.ts         the Stream Deck SDK glue: one class per action
      standalone.ts      the standalone plugin's entry (D-12)
  com.jbrick2070.vjster.sdPlugin/   the standalone plugin (D-12)
    manifest.json        seven actions, three bundled profiles
    imgs/                plugin and category icons, action icons, default key images
    layouts/vjster-strip.json   one full-canvas pixmap per dial
    ui/                  vjster.html, vjster.js, vjster.css: the settings page
    profiles/            VJster Live + (Stream Deck +), VJster Live (15 keys), VJster Mini
    bin/                 built plugin.js (git-ignored)
  vjster-plugin/rollup.config.mjs   builds the standalone plugin
  vjster-extension/
    tsconfig.json        DOM lib, no Node types, includes ../src/vjster/shared
    rollup.config.mjs    four bundles plus an inline step that copies the static files
    manifest.json        MV3, host permissions per D-4
    options.html
    icons/               icon.svg and the 16, 48 and 128 pixel PNGs rendered from it
    src/
      chrome.d.ts        hand-written types for the Chrome APIs used (R-STD-3)
      page-state.ts      the sender rules: clean title, host, rates, levels
      adapter-core.ts    applies intents to a MediaControl; ads, holds, read-back
      youtube.ts         YouTube's player as a MediaControl
      generic-video.ts   any page's video element as a MediaControl
      video-choice.ts    which video on a page is the video (R-TGT-3)
      messages.ts        page, bridge and worker messages and their validators
      router.ts          the worker's logic: tab registry, target, reports
      link-client.ts     the worker's socket: backoff, pings, errors
      settings.ts        port, all-sites scripts, storage keys
      page-wiring.ts     the adapter's page boundary: run once, listen to this window only
      content-main.ts    MAIN world entry: the adapter around YouTube's player or a video
      bridge-core.ts     the bridge: relays page <-> worker, fills in the host, says when the page is left
      content-bridge.ts  ISOLATED world entry: hands bridge-core the real window
      worker-core.ts     the worker's wiring of the router and the link to Chrome
      background.ts      service worker entry: hands worker-core the real chrome object
      options.ts         port, this extension's id, all-sites toggle
    bin/                 built unpacked extension, what Chrome loads (git-ignored)
  vjster-page/           Phase 2, the OBS page; built into the plugin's bin/obs (git-ignored)
    player.html          the page; the plugin serves it at /obs
    tsconfig.json  rollup.config.mjs
    src/
      page-params.ts     the address: video id, playlist, flags, port, token
      embed-control.ts   YouTube's IFrame embed as a MediaControl (V-10)
      settle.ts          answers wait for the embed to confirm them
      page-core.ts       the page's logic without the DOM: link, adapter, reports
      page-boot.ts       start-up: token out of the address, then YouTube's script, tried again if it fails
      player-page.ts     entry: hands page-boot the real browser
  src/vjster/plugin/obs-page.ts       the page files the server hands out, the address, video ids from links
  src/vjster/plugin/obs-keepalive.ts  keeps the link on once an OBS page has connected
  tests/vjster-*.test.ts   includes the extension's logic tests, tests/vjster-ext-*.test.ts
  scripts/vjster/
    run-mutation-checks.ts  VJster's flips, clean worktree only (step 2, R-TST-4)
    build-profiles.ts    writes the bundled profiles (deterministic)
    make-plugin-images.ts   writes the plugin's SVG icons and default keys
    deck-sim.ts          a pretend Stream Deck and Chrome tab around the real code
    probe-player-api.js  Phase 1 step 1 probe, pasted into a watch page's console (done 2026-10-30)
```

Step 5 bundles the deck code into the standalone plugin's own `plugin.js` with `vjster-plugin/rollup.config.mjs` (D-12); a Fadester-hosted copy would register the same classes from Fadester's `src/plugin.ts` once that file is free. The extension and the page have their own rollup configs and tsconfigs because they run in a browser, not in Node. The shared folder has no imports from `@elgato/streamdeck`, `ws` or `chrome.*`, so it tests as plain functions (R-TST-1, R-TST-3), and nothing in `src/vjster` imports Fadester's OBS code (R-HOME-3). The `tsconfig.json`, rollup and vitest configs written in `C:\vjster` are not carried over; Fadester's apply.

### 3.2 Data flow

1. The operator turns the speed dial. The action computes the next rate (`speed.ts`) from its own last requested rate while that request is unanswered, else from the last reported state, so a fast turn is not undone by a report that lags; it coalesces (`coalesce.ts`) and sends `speed.set` to the current target through `link-server.ts`.
2. The extension's service worker receives it, picks the target tab (`target.ts`) and forwards it to that tab's bridge script.
3. The bridge posts it to the main-world adapter, which calls the player API or the video element.
4. The adapter reads the result back (rate at once, quality by event or polling), the bridge relays a state report, the worker forwards it over the socket.
5. `hub.ts` stores it and `display.ts` redraws every action bound to that target. The strip shows what the page reported (R-BEH-4).

Unsolicited state reports follow the same path upward: play, pause, navigation, ad start and end, tab close.

### 3.3 Protocol v1 (R-INT)

| Direction | Message | Fields |
|-----------|---------|--------|
| deck -> target | `speed.set` | `rate`; `direct` (write the element, R-SPD-2 extended range); `hold` (write again when the element is replaced, R-SPD-4) |
| deck -> target | `speed.step` | `delta`, a rate change of plus or minus one allowed step (0.05, 0.1, 0.25, 0.5); the target applies `nextRate` with one tick; `direct` and `hold` (as `speed.set`) |
| deck -> target | `speed.reset` | sets 1.0; a held rate of 1.0 changes nothing, so no hold needs clearing |
| deck -> target | `quality.set` | `level` (`hd1080` style id; `auto` acts as `quality.reset`); `hold` (re-apply after navigation, R-QLT-7) |
| deck -> target | `quality.step` | `direction` (+1 toward higher quality, -1 lower); `hold` (as `quality.set`) |
| deck -> target | `quality.reset` | |
| deck -> target | `transport.toggle` | |
| deck -> target | `state.get` | |
| deck -> target | `pin.set` | `pinned` (true/false) |
| target -> deck | `state` | as R-INT-2, plus `rateDirect` (the rate was written to the element, so the site's menu does not show it), `pinned` (the reported tab is the pinned one; the browser target only) and `inReplyTo` (null when unsolicited); with no video, `rate`, `quality`, `qualityAuto`, `title` and `host` are null and the lists empty |
| target -> deck | `error` | `code`, `message`, `inReplyTo` |
| both | `ping` / `pong` | `t` |

All messages carry `v: 1`, `target` and an `id` (1 to 64 letters, digits, hyphens or underscores) that a reply echoes in `inReplyTo`.

As built in step 2: `parse(text, accept)` in `protocol.ts` is used on both sides; a target accepts intents, the deck accepts reports, both accept keepalives. It never throws. It returns the message rebuilt from known fields only, or a failure with the error code to answer with and the id to answer to when one was readable. Error codes: `too-long` (over 16384 characters, refused unread), `bad-json`, `bad-version`, `bad-message` (a required field missing or malformed), `unknown-type`, `unexpected-type` (a message meant for the other side), and for targets refusing an intent later, `no-video`, `unsupported` and `internal`. Limits that keep the link to titles, host names and playback state (R-LNK-5): `title` at most 300 characters, `host` a bare host name (letters, digits, dots, hyphens), lists at most 64 items, rates above 0 and at most 16, level ids 1 to 16 lowercase letters or digits. Unknown capabilities from a newer peer are ignored like unknown fields. `errorReply` builds the `error` answer.

Who answers: only a target answers a message with `error`. The deck drops a malformed report, logs it once without its content (R-BEH-5), and asks again with `state.get`; it never sends `error`, which a target would refuse as `unexpected-type`. `parse` does not check that the envelope `target` names the receiver; each receiver does (step 3).

What senders must do, because the parser refuses a whole report over one bad field: a target truncates the title to 300 characters and strips control characters from it, sends the page's `location.hostname` or null (never a port, a path or an IPv6 literal, which the host rule refuses), reports `rate` null rather than 0 when there is no usable rate, and drops level ids that are not 1 to 16 lowercase letters or digits. Titles still come from arbitrary pages: the deck escapes them before drawing (step 5) and never logs them (R-BEH-5).

### 3.4 Speed logic (R-SPD)

As built in step 2 (`speed.ts`): everything runs in integer twentieths (0.05 units), so no float tie can round the wrong way. `rangeFor(availableRates, extended)` takes the minimum and maximum of the target's reported rates; a value within a thousandth of a twentieth of a grid point counts as that point (float noise such as 0.05 * 7, or a page reporting 1.0000001), any other value moves inward onto the grid. The result is never below 0.05 or above 16: 0.25 to 4 on YouTube; 0.25 to 2 when a target reports none usable or nothing on the grid fits; exactly 1x when it reports only `[1]`; and in extended range 0.1 to 16, the grid values inside Chrome's 0.0625 to 16. `nextRate(current, ticks, step, range)` moves to the next point of the step grid anchored at 1x in the turn's direction, then one more step per further tick, then clamps; so from 1.3 one notch of 0.25 goes to 1.5 or 1.25, and from 0.25 one notch of 0.5 goes to 0.5. A range end may be off the step grid (0.25 for a 0.5 step). Every allowed step is a multiple of 0.05, so every result is on the player's grid (F-10) without a second snap. A turn from a rate outside the range lands on the nearer end; one call moves at most `MAX_TICKS` (1000) notches. `snapRate` puts any reported value on the grid (anything that is not a finite positive rate becomes 1x, and nothing snaps below 0.05); `clampRate` also clamps it; `resetRate` is `RESET_RATE` (1x) clamped. The step grid's anchor at 1x is its own constant, so changing `RESET_RATE` (D-7) does not move the grid. In step 5 the speed action sets the `direct` flag in `speed.set` when extended range is on, so the adapter writes the element instead of the player API. Tests cover 0.25 steps across the range, the held fine step, snapping of odd values the site may report (for example 1.0000001), clamping at both ends, and the 0.5 step against the 0.25 minimum, which is off that step's grid.

### 3.5 Quality logic (R-QLT)

As built in step 2 (`quality.ts`): `normalizeLevels` keeps the page's own order (highest first), drops `auto`, repeats and anything that is not a level id. `stepQuality(levels, current, ticks)`: positive ticks move toward higher quality, stopping at both ends; it skips `auto` even when given the raw reported list. `current` is the fixed level when one is set, else the level playing under Auto, so the first notch from Auto moves one level from what is playing. From a level not in the list (`unknown`, or none), a turn up picks the highest level and a turn down the lowest. `qualityLabel` maps `hd2160` to `2160p` through `tiny` to `144p` and `auto` to `Auto`; unknown ids are shown as-is so a new level YouTube adds never crashes the display. `resolveHeldLevel(held, levels)` implements R-QLT-7: the held level, else the nearest lower offered level, else the lowest offered; null when the held id's height is unknown and it is not offered.

### 3.6 Target selection (R-TGT)

As built in step 2 (`target.ts`): `chooseTarget(tabs, {focusedWindowId, activeTabIds, pinnedTabId})` over records `{tabId, windowId, playing, lastPlayAt, lastPauseAt}`; titles and hosts stay with the extension's tab registry. A pinned tab wins only while it is still tracked. Equal times go to the lower tab id, and a tab that never paused ranks last when nothing plays. Pure, tested with small tables.

`coalesce.ts` (R-BEH-3): `createCoalescer(send, 50)` sends the first value of a burst at once, at most one value per 50 ms after that, and always the last value, within one interval even if the clock steps backward. Its default clock is `performance.now()` where the host has it. A `send` that pushes again is throttled like any push. `flush` sends the waiting value now; `cancel` drops it, and the 50 ms spacing from the last send still applies. The deck coalesces absolute values (`speed.set`, `quality.set`) computed as data flow step 1 says, so dropping the middle of a burst loses nothing.

### 3.7 Extension details

- `manifest.json`: `manifest_version` 3; `background.service_worker` (an ES module); `content_scripts` twice for the same matches, one with `"world": "MAIN"` (adapter) and one isolated (bridge); `permissions`: `storage`, `alarms` and `scripting`, no `tabs`; `host_permissions` per D-4; `optional_host_permissions` for all sites per D-4; `options_page`.
- The adapter finds `#movie_player` on youtube.com and its subdomains, music.youtube.com included; elsewhere it finds video elements (R-TGT-3). It listens to `play`, `playing`, `pause`, `ratechange`, `loadedmetadata`, `emptied` and `ended` on the element, to class changes on the player (ads), and to `yt-navigate-finish` (V-4). Quality is read back by polling (R-QLT-3), not by the player's quality-change event. On each `yt-navigate-finish` it re-binds `#movie_player` and its video element if they changed (they did not in any probed watch-to-watch navigation, V-4), and it watches the page grow only while there is no player (home, search); then it re-applies the held level when "hold quality" is on (default on, R-QLT-7), retrying while the read-back runs, and reports state. Ad state comes from the `ad-showing` or `ad-interrupting` class on the player or the `.ytp-ad-player-overlay` element (V-3, still to confirm on a monetized video); while an ad shows, intents are held, at most one per kind, and applied after it clears (R-BEH-1). Unsolicited reports that say nothing new are skipped. A player without the quality methods keeps speed and play/pause; the worker notes it once per tab in its own console (R-QLT-2).
- The bridge and the adapter talk with `window.postMessage`, tagged `vjster-page` and `vjster-bridge`; each listens only to messages from its own window, never from a frame. As built in step 4 there is no nonce: the adapter shares its JavaScript world with the page, so a page can always forge what the adapter says, and a secret in that world would not stay secret. Instead every hop validates what it receives (`messages.ts`): the adapter re-parses each intent with the link's own parser, the bridge and the worker rebuild page state with the sender rules of section 3.3 and strip controls from error messages, the bridge fills in the host name from its own `location`, and the worker accepts an answer or an error only from the tab it sent that intent to, and only once. The worst a page can do is misreport its own video, or claim to play so that it becomes the target.
- The worker keeps a map of tabs from the bridges' reports (this extension's bridges, top frame only), reconnects the socket with backoff from 1 s doubling to 30 s with up to 20 % jitter (the longest wait, 24 to 30 s, at once after close code 4000, when a second copy of the extension took the link), answers pings, answers a malformed message with `error`, and re-checks on a one-minute alarm (R-LNK-3). The pinned tab is kept in `chrome.storage.session`, so it survives the worker being stopped; only a tab whose video has played can be pinned. A tab joins the registry when its video plays, or when it answers a refresh saying its video has played since the page loaded, and leaves when its page reports no video, when the page is left (`pagehide` in the bridge) or when the tab closes. Chrome stops an idle worker after 30 s, which empties the registry, so the worker asks every tab's bridge for fresh state when it starts, whenever the link opens and after a tab failed to take an intent, and a page restored from the back-forward cache reports again.

### 3.8 Stream Deck actions

| Action | Controller | Settings | Strip or key |
|--------|-----------|----------|--------------|
| Speed | Encoder | strip label, step, held-turn step, extended range, hold speed, target | label, `1.25x` in a magenta-to-cyan glow, a bar with 1x marked, the title; `EXT` for a direct rate, `AD` during an ad |
| Quality | Encoder | strip label, hold quality, target | `1080p` with `AUTO` or `FIXED`, one segment per offered level |
| Speed Preset | Keypad | rate (0.1 to 16), direct write, hold, target | the rate, framed in neon while it plays |
| Speed Step | Keypad | direction, step, extended range, target | `+0.25` and the rate playing |
| Quality Preset | Keypad | level or Auto, hold, target | the level, dimmed when the video lacks it |
| Pin Tab | Keypad | | pin glyph, the pinned tab's title (or `PINNED`), or `PIN TAB` |
| Play / Pause | Keypad | target | play or pause glyph, `PLAYING` or `PAUSED` |

As built in step 5, every action reads the plugin-wide settings on its settings page: the port (default 48150), the extension ids allowed to connect (empty allows any), and a link status line; the OBS page token is created once and kept there (Phase 2). Status words on the strip and keys: `EXTENSION OFF`, `NO PAGE`, `NO VIDEO`, `N/A`, `AD PLAYING`, `PORT IN USE` (R-BEH-4).

## 4. Phases

### Phase 0 -- this plan, repository and skeleton (done in `C:\vjster`)

1. Operator approves REQUIREMENTS.md and PLAN.md; D-2 and D-6 answered. DONE 2026-10-30.
2. `git init` in `C:\vjster`, LICENSE, `.gitattributes`, `.gitignore` (node_modules, bin, extension-dist, release), `package.json` pinned to Fadester's versions, `tsconfig.json`, rollup and vitest configs, empty `tests/smoke.test.ts` that passes, `npm test` green.
3. Create `jbrick2070/vjster` on GitHub with `gh` (public, same visibility as Fadester), push once, verify HEAD equals origin (R-STD-4). DONE 2026-10-30: https://github.com/jbrick2070/vjster, commit 178f5b2, HEAD equal to origin/main on the first push.
4. Record the Stream Deck app version and whether port 48150 is free (V-7). DONE 2026-10-30: 7.4.2.22730 from the app log; no listener on 48150.

### Phase 0b -- move into the Fadester repository (2026-10-30)

The operator revised D-6 ("both ideally", starting in `C:\streamdeck-fadester`). This move copies the two documents, rewritten for this repository, the probe log (`PROBE-LOG.md`), the protocol constants (`src/vjster/shared/protocol.ts`), their test (`tests/vjster-protocol.test.ts`) and the probe (`scripts/vjster/probe-player-api.js`). It touches no Fadester file. `C:\vjster` keeps its history (Phase 0 at 178f5b2, then the probe step) and a README pointing here (R-HOME-6).

### Phase 1 -- Chrome, speed and quality

Step 1, probe (R-TST-5, V-1..V-4, V-9). DONE 2026-10-30 and 31, without any extension, in the desktop app's built-in browser pane (Chromium 152, not the operator's Chrome 156, V-11). First run: hand-written snippets. Second and third runs: earlier versions of the probe script. Fourth run, 2026-10-31: `scripts/vjster/probe-player-api.js` as it stood before its last ad guards and outer error handler were added (with no ad and no error those additions change nothing), with navigate and persist on, starting from a paused video, which it left paused. All on a 4K Creative Commons video and the related videos it led to; the raw data of every run is in PROBE-LOG.md. Results are in section 2 and in F-4, F-10, R-SPD-2, R-SPD-4, R-QLT-2, R-QLT-3 and R-QLT-7. `setPlaybackQualityRange` works, so the quality dial is built as designed; the speed grid is the player's 0.05 grid over 0.25 to 4; a held quality level needs re-applying after navigation; the ad markers are still unconfirmed (V-3). Three Sonnet 5.5 reviews found defects in the script and the docs; the blocking ones are fixed, and the script's ad, error and restore paths were exercised against a fake player in fifteen scenarios (PROBE-LOG.md).

Step 2, shared logic (R-INT, R-SPD-1..2, R-QLT-1, R-TGT, R-BEH-3). `protocol.ts`, `speed.ts`, `quality.ts`, `target.ts`, `coalesce.ts` in `src/vjster/shared` with full unit tests, and the runner `scripts/vjster/run-mutation-checks.ts` with the flips for this step's logic (a clamp bound, the snap grid), run in a clean worktree (R-TST-4); the origin-check flip lands with step 3 and the ad-hold flip with step 4. DONE 2026-10-31: sections 3.3 to 3.6 say what was built. Tests: `tests/vjster-protocol`, `-speed`, `-quality`, `-target`, `-coalesce` and `-mutations.test.ts`, 102 tests, including a sweep of every grid rate and every step size with ticks from -3 to 3 in four ranges, the limits of every protocol field at and one past their bound, and a check that every mutation flip still matches its code exactly once. Mutation checks M-V-1 to M-V-8 (clamp bound, snap grid, step grid, last value wins, stale pin, quality ends, host-only reports, unknown fields dropped): all killed in a clean worktree; the runner refuses to run in the shared checkout. The Sonnet 5.5 review of the first version found a coalescer that could wait an hour after a backward clock step, a runner that counted any non-zero exit as a kill, and some 30 flips of its own that the tests missed; all are fixed or covered. Replayed against the fixed code with seven more flips for the fixes, 62 of its 64 flips are killed; the one survivor that matters (a reported rate of 0 widening the range) now has a test, and the other is equivalent (two known level ids never share a height).

Step 3, link server (R-LNK-1..4, R-TST-2). `src/vjster/plugin/link-server.ts` with in-process tests: origin refusal, pinned id, token path (built now, used in Phase 2), ping every 20 s, latest-wins, a malformed message dropped and answered with `state.get` (section 3.3: only targets answer with `error`), and the start and stop rule of R-LNK-1. The server sets the `ws` `maxPayload` in bytes, at least 49152, since `MAX_MESSAGE_CHARS` counts UTF-16 units and one unit can take three bytes; `parse` then applies the character limit. Each receiver checks that a message's `target` names it. Adds the origin-check flip (R-TST-4).

DONE 2026-10-31, revised after the Sonnet 5.5 review. `LinkServer` listens on 127.0.0.1 through a plain HTTP server that only upgrades: plain HTTP gets 426 (Phase 2 adds the OBS page's three paths), and an upgrade is refused with HTTP 403, before any WebSocket exists, unless it carries exactly one Host header naming `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding) and passes one of two checks. A `token` query parameter decides alone: it must equal the OBS page token (32 hex digits, compared in constant time; target `obs`), and a wrong token is refused even with an extension Origin; from Phase 2 the token path also needs the served page's own Origin. Without one, the Origin must be `chrome-extension://` plus 32 letters a to p, one of the pinned ids if any are set (target `browser`). Pinned ids are compared in lower case; malformed pinned ids or a malformed token are dropped with a warning, failing closed. A refusal is logged with its reason only, at most once every 10 s with a count of the ones in between. `maxPayload` is 49152 bytes: a frame of exactly that size is read (and dropped as too long by `parse`); a larger one closes the socket, with code 1009 when the frame arrived whole (a very large frame may just reset the connection). On connect the server sends `state.get`. A newer connection for the same target closes the older one with code 4000, which is not reported as a disconnect; the browser and OBS connections never replace each other. Every 20 s it sends a JSON `ping` (JSON, not a WebSocket ping frame, because a Chrome service worker stays alive on messages it receives, F-5); a peer silent past 60 s is closed with 4001 and reported gone once, so with the default timers a silent peer goes 60 to 80 s after its last message. The keepalive uses a monotonic clock, so sleep and clock steps do not close healthy peers. A ping from a peer gets a pong with the same `t`. A malformed report, a binary frame, or a report naming the other target is dropped, warned about once per connection without its content, and answered with `state.get` at most once every 2 s. A message from a connection that was replaced or closed is ignored. A listener that throws is logged with a fixed line. `send(target, intent)` adds `v`, `id` and `target` and returns the id, or null when the target is not connected. `stop()` reports every live connection gone, closes them with 1001 and frees the port; `start()` and `stop()` may overlap safely (one shared start; a stop waits for a pending start). An error on the HTTP server after it listens is logged, never thrown. A taken or reserved port (EADDRINUSE or EACCES) rejects `start()` with `LinkPortInUseError` (D-11). `LinkLifecycle` starts the server on the first `acquire` and stops it 60 s after the last `release`, records a failed start, retries on the next acquire, and clears the error once a start works. `ws` is imported through `@elgato/streamdeck` and is not yet in `package.json` (R-STD-3, R-HOME-5). Tests: `tests/vjster-link-server.test.ts`, 39 tests with real WebSocket clients on an ephemeral port; the keepalive, the re-ask throttle and the refusal-log throttle run on a fake clock. Mutation flips M-V-9 to M-V-21.

Step 4, extension (R-SPD-4, R-QLT-2..3, R-TGT, R-LNK-3, R-BEH-1..2). Adapter, bridge, worker, options page in `vjster-extension/`; logic in modules with unit tests in `tests/vjster-ext-*.test.ts`; built to `vjster-extension/bin`, which `.gitignore` then lists; loaded unpacked (D-3 a). Manual check: the worker's console shows the socket connected to a stub server run by a test script. The adapter follows the sender rules of section 3.3 (title, host, rate, level ids). Step 4 also repeats the probe in Chrome 156 (V-11), confirms the ad markers (V-3), and checks the navigations V-4 lists as not probed. Adds the ad-hold flip (R-TST-4).

DONE 2026-10-31, revised after the Sonnet 5.5 review. The extension is in `vjster-extension/` (section 3.1); `npx tsc --noEmit -p vjster-extension` type-checks it and `npx rollup -c vjster-extension/rollup.config.mjs` builds it into `vjster-extension/bin`, with the SPDX banner on every bundle (R-HOME-4). An inline rollup plugin copies `manifest.json`, `options.html` and the icons next to the bundles, and `vjster-extension/tsconfig.json` uses the DOM lib with the hand-written `src/chrome.d.ts` and `types: []`, so Fadester's Node tsconfig stays as it is (R-STD-3).

Manifest: MV3, minimum Chrome 116, content scripts on `*://*.youtube.com/*` at `document_idle` (adapter in the MAIN world, bridge isolated), permissions `storage`, `alarms` and `scripting`, host permissions `*://*.youtube.com/*` and `ws://127.0.0.1/*`, and optional `<all_urls>` for the all-sites option, which registers the same two scripts for every site but YouTube. By Chromium's source `ws://127.0.0.1/*` is a valid host permission, though the worker's socket does not need it; it stays until V-12 is checked. There is no `tabs` permission: titles come from the player, hosts from the bridge, and tab ids from `chrome.tabs.query`, which gives ids without it.

The adapter (`adapter-core.ts`) answers every intent with a state report or an error, also when the player throws (R-INT-4). It applies speed through the player, or to the element for extended range (marked `rateDirect`) and for plain videos, and makes sure the element really plays the asked rate after a direct write. It re-applies a held element rate when the element is replaced or an ad ends, and a held level after navigation, retrying while the read-back runs (R-SPD-4, R-QLT-7). It reads a new level back every 500 ms for up to 5 s, and after a return to Auto until the level playing changes (R-QLT-3). During an ad it changes nothing and keeps the latest intent of each kind: two play/pause toggles cancel, and a held `speed.step` keeps only the latest step. It applies them in the order speed, quality, play/pause when the ad ends (R-BEH-1). It skips unsolicited reports that say nothing new, and it says whether the page's video has played since the page loaded. A YouTube player missing only the quality methods keeps speed and play/pause, and the worker notes it once per tab in its own console (R-QLT-2, R-BEH-5).

The worker (section 3.7) accepts an answer only from the tab it sent that intent to. It asks every tab for fresh state when it starts and when the link opens, so a restarted worker finds playing and paused videos again. It drops a tab whose page is left, asks the tabs again after one failed to take an intent, and waits 24 to 30 s before taking the link back from a second copy of the extension.

Tests in Node: `tests/vjster-ext-adapter`, `-messages`, `-router`, `-link` and `-wiring.test.ts`, 142 tests. The link tests run the extension's link client and router against the real link server of step 3, with a fake tab around the real adapter; the wiring tests run the bridge, the page boundary and the worker against fake browser objects. The page wiring that needs a DOM (the mutation observers and the capture-phase media events in `content-main.ts`) and the options page are covered only by the manual checks. Before the review fixes, the built adapter was also run on the live YouTube page in the desktop app's built-in browser, driven as the bridge drives it (PROBE-LOG.md, live adapter check). Mutation flips M-V-22 to M-V-29, and after the review M-V-38 to M-V-53 (M-V-30 to M-V-37 belong to step 5).

The review found the registry lost on a worker restart, stale tabs after leaving a site, answers accepted from any tab, no read-back after Auto, all of YouTube lost over one missing quality method, test gaps (46 of its 75 flips survived), and doc errors; all are fixed. Its second pass ran 116 flips of its own on the fixes and asked for tests of the `played` flag through the worker and of the YouTube call forms, and for a held level that survives an empty level list after navigation; all are done. Not checked yet, because they need the operator's Chrome: loading the extension, the service worker's socket to the plugin, the ad markers, the navigations V-4 lists, the probe in Chrome 156, a worker restart and two Chrome profiles; all are in TESTING.md section 1.

Step 5, deck actions (R-SPD-3, R-SPD-5..6, R-QLT-5, R-TGT-2, R-BEH-4..5). The seven actions, named VJster Speed and so on, in Fadester's category (R-HOME-2), property inspectors, the indicator layouts, icons. Registering them changes `src/plugin.ts`, the plugin manifest and `tests/manifest-hygiene.test.ts`, which counts the actions (6 at HEAD, 7 in the uncommitted work) and, in its uncommitted version, requires every Encoder action to use `layouts/fader-cell.json`, a rule the VJster indicator layouts break; the step extends that test for the VJster actions and their layouts, and waits until no other work modifies those files (R-HOME-5). Gate: D-10, the Stream Deck app version (step 5 sidesteps it with D-12); the speed and quality actions count from their own unanswered request (section 3.2); titles are escaped before they are drawn and never logged (R-BEH-5); `streamdeck validate`; `streamdeck link` to the Stream Deck app; TESTING.md items 1.1 onward with expected strip text; operator hands-on on the Stream Deck + with a watch page, a paused page, two tabs, Picture-in-Picture, an ad, extension reload, Chrome restart, Stream Deck restart.

DONE 2026-10-31 as the standalone VJster plugin (D-12): `com.jbrick2070.vjster.sdPlugin`, built by `npx rollup -c vjster-plugin/rollup.config.mjs`, accepted by `npx streamdeck validate com.jbrick2070.vjster.sdPlugin`. Seven actions (section 3.8) over one shared `Hub`; each dial and key has a controller with no SDK in it, so it is tested with a fake hub and a fake clock. The speed and quality dials count from their own unanswered request while it is pending (section 3.2), coalesce to one request per 50 ms, reset on a press only when not turned while held, and alert instead of sending when the target is off; turns during an ad are sent and held by the page (R-BEH-1). The hub serializes reconfigures: an early version left two servers running when Stream Deck echoed the settings while a new OBS token was being saved, which the deck simulator caught. Three profiles are bundled and installed without switching to them: VJster Live + for the Stream Deck + (keys 0.1x FX, 0.5x, 1x, 2x / play-pause, pin, Auto, 8x FX; dials SPEED, NUDGE in 0.05 steps for beat-matching, QUALITY, FX SPEED in 0.5 steps over 0.1x to 16x), VJster Live for the 15-key Stream Deck, and VJster Mini; `scripts/vjster/build-profiles.ts` writes them byte for byte the same each time. `scripts/vjster/deck-sim.ts` runs the real plugin under a pretend Stream Deck with the real extension logic around a fake YouTube player, so the whole path from a dial turn to the page and back to the strip is tested without hardware (`tests/vjster-plugin-e2e.test.ts`). Tests: `tests/vjster-plugin-units`, `-package` and `-e2e.test.ts`, 66 tests. Mutation flips M-V-30 to M-V-37, and after the review M-V-64 to M-V-72. The Sonnet 5.5 review found that an unanswered or refused request could leave its dim value on the strip for good (now it redraws when it expires, and an error drops it at once), that a title with a lone surrogate or a noncharacter froze a strip (now replaced by a space), and that the Pin key did not show the pinned title as R-TGT-2 says (now it does). Also fixed from its list: the server waits for the stored settings before it starts, so it never runs on the default port or without the extension pin; a malformed pinned extension id now makes the server refuse every extension instead of quietly allowing any; a settings write without the OBS token keeps it; the settings page gets its status again when it appears; a taken port is tried again every 30 s; draws go out at most every 100 ms per action, the last one always; turns during an ad add up while the page holds them; and only the ad's status word lets a control through. Not done here, because they change the operator's Stream Deck app: linking the plugin and trying it on the device (TESTING.md section 2).

Step 6, release. As built, the standalone plugin ships as `com.jbrick2070.vjster.streamDeckPlugin` from `npx streamdeck pack`, and the extension as a zip of `vjster-extension/bin`, with install steps in docs/vjster; a Fadester-hosted copy follows D-12. Tagging and publishing are the operator's call. No Marketplace, no Web Store (D-3, D-8). The standalone VJster plugin (R-HOME-2) is planned after this release.

### Phase 2 -- the OBS browser-source target

1. D-5 answered; check whether OBS Browser Events already covers `emit_event` (F-9) and record it. DONE 2026-10-31: built as D-5 (a), the recommendation, while the operator was away; with (a), F-9 no longer matters and was not checked.
2. `vjster-page/player.html`: IFrame Player API embed (probe the embed first, V-10), loopback socket client with the token from the URL, state reports, speed via `setPlaybackRate`, quality via `setPlaybackQualityRange` and player sizing (R-QLT-6), V-8 confirmed in the portable OBS 33.
3. Target setting on every action (R-OBS-3), `Both` fan-out, strip states for a page that is not connected.
4. TESTING.md section 3 (written as section 2 here before step 5 took that number): the page in a browser source, Studio Mode preview, source hidden and shown, OBS restart.

5. Release with the next Fadester for OBS version. As built, the page ships inside the standalone plugin's `bin/obs`, so it releases with the plugin (step 6).



DONE 2026-10-31, items 2 to 4. The page is `vjster-page/` (section 3.1), built by `npx rollup -c vjster-page/rollup.config.mjs` into the plugin's `bin/obs` folder, and served by the plugin's own link server at `http://127.0.0.1:<port>/obs` (`obs-page.ts` and the `pages` option of `LinkServer`). The server answers plain GET and HEAD for `/obs`, `/obs/` and `/obs/player.js` only, with the same single-Host check as an upgrade (403 otherwise), `Cache-Control: no-store`, `nosniff`, `Referrer-Policy: strict-origin`, and a Content-Security-Policy that allows the page's own script, YouTube's player script and frame, a socket to this computer, and no framing by other sites; every other request still gets 426. Served over http rather than as a file, the embed sees a normal origin and referrer (a `file://` page was not tried).

The address is `http://127.0.0.1:<port>/obs?v=<video id>#token=<token>`, optionally with `list`, `loop=1`, `mute=1` and `start=<seconds>`. The settings page has an OBS page section: paste a YouTube link, copy the address. The token sits in the fragment, which no browser sends to a server; the page reads it from there only, and removes it from its own address before YouTube's script loads (`page-boot.ts`); the server accepts the token only from the page's own origin, `http://127.0.0.1:<port>` or `http://localhost:<port>`. In the live run the embed's `forigin` parameter carried the address without it.

The page connects with the token as the `obs` target (R-LNK-2), reports state like the extension (host null, never pinned), applies speed through `setPlaybackRate` and play/pause through the player, and answers an intent only once the embed confirms it (`settle.ts`: the matching player event, or 300 ms), because the embed's getters lag one message (V-10); without that the deck would show the old rate. Quality is refused with `unsupported`, so R-QLT-6 is dropped. The deck's range follows the player's own list, 0.25 to 2, which is what OBS plays (V-8). A held rate goes back on when the next video of a playlist starts loading and again at its first play (a playlist rollover was not seen live). YouTube's script is tried again after 2, 4, 8, 16 and then every 30 s when it fails to load, since OBS does not reload the source.

OBS loads a browser source only when it starts or the source is refreshed, and the page comes from the link server, which normally stops 60 s after the last VJster action leaves the deck. So the first OBS page to connect turns on "keep the link on" (`obs-keepalive.ts`, a checkbox on the settings page), unless the operator has already chosen on or off (the setting is stored as on, off or not chosen), and while it is on the server runs while the plugin runs (R-LNK-1 as built).

Item 3: the target setting, `Both` and the `NO PAGE` strip came with step 5 (section 3.8). Phase 2 adds the target to key captions (`OBS SPEED`, `SYNC SPEED`, `OBS PLAYING`) and a fourth bundled profile, VJster Dual + for the Stream Deck +, that plays Chrome and OBS side by side.

Tests: `tests/vjster-page.test.ts`, including the page's logic (`page-core.ts`) against the real link server with a fake embed that lags like the real one, its start-up order and retry (`page-boot.ts`), the page serving and its exact headers, the address rules and keeping the link on; and `tests/vjster-page-e2e.test.ts`, the real plugin under the deck simulator serving fixture page files, answering its settings page, keeping the page across a port change, putting a dropped token back, and keeping an explicit off. Mutation flips M-V-54 to M-V-62 and M-V-73 to M-V-80. Revised after the Sonnet 5.5 review: an explicit off for keeping the link on no longer turns itself back on; the token path also needs the page's origin, and the page no longer reads a token or port from the query; the start-up is testable and retries YouTube's script; a settings write that drops the token gets one back; the settings page asks for the address again after a port change; `videoseries` is not taken for a video id. Live checks: in the desktop app's built-in browser (Chromium 152), the page served by a real link server and driven by intents; and in the portable OBS 33.0.0 (CEF 150), a browser source with the page's address on a separate test scene collection, which loaded, connected, played, and followed speed and play/pause (V-8, PROBE-LOG.md). The portable OBS's two settings files were backed up and restored to their earlier checksums, the test collection was removed, and OBS was closed cleanly.

Not checked, because it needs the operator's OBS and Stream Deck together: TESTING.md section 3.

### Phase 3 -- ideas, not planned

Seek dial, volume dial, load a video by id from a key, A/B rate toggle, a Midi Fadester fader as a speed control through its vendor API, Firefox.

## 5. Test strategy summary (R-TST)

- `npx tsc --noEmit` (and, from step 4, the same for `vjster-extension/tsconfig.json`, from Phase 2 for `vjster-page/tsconfig.json`), then `npm test`, Fadester's whole vitest suite, which picks up `tests/vjster-*.test.ts`. The VJster tests stay under 30 s.
- `node --import tsx scripts/vjster/run-mutation-checks.ts` (from step 2) runs every VJster flip in a linked git worktree and reads vitest's JSON report. A flip is killed only when an assertion in its named test files fails; a filter that matches no file, a flip that stops a test file from loading, or a vitest run over 180 s is an error. Every flip runs, survivors and errors both fail the run, each file is put back byte for byte (also on Ctrl+C or exit; only a hard kill can leave it flipped, and the runner names the file first), and the VJster tests run again at the end. It refuses to run in a checkout that is not a linked worktree unless given `--here`; `--list` prints the flips. `tests/vjster-mutations.test.ts` checks in the normal suite that every flip still matches its code exactly once. Fadester's `npm run test:mutation` is not a VJster gate while M-1.1 survives (section 1).
- Fadester's manifest-hygiene test covers every VJster file (R-HOME-4).
- `tests/vjster-plugin-e2e.test.ts` starts the real plugin from source under `scripts/vjster/deck-sim.ts` on a free port and drives it like a Stream Deck +; it needs no hardware and no Chrome.
- TESTING.md holds the manual items with expected strip text; each release lists which items were run and by whom.
- Nothing automated touches the live YouTube site; the probe in Phase 1 step 1 is run by hand and its output pasted into section 2.

## 6. Repo hygiene per change (R-STD)

Before every commit: `git ls-files --eol` shows only LF, no BOM (`Get-Content -Encoding Byte -TotalCount 3` in Windows PowerShell 5.1, the only PowerShell here), no 0-byte files, no banned placeholder word, the checks of R-TST-6 green, Sonnet 5.5 QA pass over the diff. Stage only VJster's paths; run `npm ci` and the checks of R-TST-6 in a clean `git worktree` of HEAD with those paths copied in, so the commit is tested without the other uncommitted work (R-HOME-5). One push attempt; verify HEAD equals origin; on failure a PowerShell block for the operator.

## 7. Order of work

Phase 0 and Phase 0b (done), then Phase 1 steps 1 to 6 in order, each step one commit after approval of its plan rows, then Phase 2. The probe in step 1 gates the quality design; nothing in steps 2 to 5 waits on it except the quality adapter in step 4.
