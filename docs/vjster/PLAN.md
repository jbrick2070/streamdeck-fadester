# VJster -- Plan

Status: APPROVED 2026-10-30 by the operator. Phase 0 and Phase 1 step 1 done in
`C:\vjster`; moved into this repository the same day (Phase 0b). Companion to
docs/vjster/REQUIREMENTS.md; every step cites the rows it serves. File names
such as REQUIREMENTS.md and PROBE-LOG.md mean the files in `docs/vjster`.
Sections changed after that approval await the operator's review: 3.1, 3.3
to 3.6 (the `hold` and `direct` fields, and the rules step 2 settled), Phase
0b, and steps 2 to 6.

## 1. Toolchain findings on this machine (checked 2026-10-30)

- Stream Deck app 7.4.2.22730, confirmed 2026-10-30 from the app's own log (build May 11 2026). Fadester's committed manifest asks for 7.1; an uncommitted change in this working tree raises it to 7.6, above the installed app, which would then refuse the plugin (F-7). The standalone VJster manifest will ask for 7.4.
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
| V-6 | A WebSocket from a `chrome-extension://` service worker to `ws://127.0.0.1:48150` opens with that Origin header, and a web page's attempt arrives with its own origin (R-LNK-2). | to confirm, Phase 1 step 3 link test |
| V-7 | Port 48150 is free on this machine (`netstat -ano`). | confirmed 2026-10-30: no listener on 48150; a loopback bind succeeded; the port is below the Windows dynamic range (49152 up) and outside the excluded ranges |
| V-8 | OBS 33's browser source, loading `file:///C:/streamdeck-fadester/vjster-page/player.html`, can open a WebSocket to 127.0.0.1 and autoplays with sound (R-OBS-2). | to confirm, Phase 2 |
| V-9 | A rate set through the API survives in-page navigation; the chosen quality level does not (R-SPD-4, R-QLT-7). | confirmed in four runs (PROBE-LOG.md): 1.5 stayed 1.5, read from the player and the element, on the next video; `hd720` became `auto` every time |
| V-10 | The IFrame embed used by the Phase 2 page behaves like the watch page for rates and quality. F-3 says the embed rounds an unsupported rate toward 1, while the watch page clamped 5 to 4. | to confirm, Phase 2: probe the embed separately |
| V-11 | The probe results (V-1, V-2, V-9, F-10) hold in the operator's Chrome 156; they were seen in the built-in pane's Chromium 152. | to confirm, Phase 1 step 4 |

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
      targets.ts         current state per target, change notifications
      display.ts         strip text, bar values, key titles (R-SPD-6, R-QLT-3)
  src/actions/
    vjster-speed-dial.ts      Encoder (step 5)
    vjster-quality-dial.ts    Encoder
    vjster-speed-key.ts       Keypad: preset or step
    vjster-quality-key.ts     Keypad: preset
    vjster-pin-key.ts         Keypad: pin this tab (R-TGT-2)
    vjster-transport-key.ts   Keypad: play/pause
  vjster-extension/
    tsconfig.json        DOM lib, @types/chrome, includes ../src/vjster/shared
    rollup.config.mjs    four bundles: service worker, bridge, adapter, options page
    manifest.json        MV3, host permissions per D-4
    options.html
    src/
      background.ts      service worker: link client, tab registry, target choice
      content-main.ts    MAIN world: YouTube adapter and generic video adapter
      content-bridge.ts  ISOLATED world: relays page <-> worker, nothing else
      options.ts         port, pinned extension id display, all-sites toggle
    tests/               unit tests of the extension logic: run by the root vitest
                         (no chrome.* globals, R-TST-3), type-checked by this tsconfig
    bin/                 built unpacked extension, what Chrome loads (git-ignored)
  vjster-page/           Phase 2: player.html, src/player.ts, bin/ (git-ignored)
  tests/vjster-*.test.ts
  scripts/vjster/
    run-mutation-checks.ts  VJster's flips, clean worktree only (step 2, R-TST-4)
    probe-player-api.js  Phase 1 step 1 probe, pasted into a watch page's console (done 2026-10-30)
```

The deck code is bundled into Fadester's own `plugin.js` by Fadester's rollup config once `src/plugin.ts` registers the VJster actions (step 5). The extension and the page have their own rollup configs and tsconfigs because they run in a browser, not in Node. The shared folder has no imports from `@elgato/streamdeck`, `ws` or `chrome.*`, so it tests as plain functions (R-TST-1, R-TST-3), and nothing in `src/vjster` imports Fadester's OBS code (R-HOME-3). The `tsconfig.json`, rollup and vitest configs written in `C:\vjster` are not carried over; Fadester's apply.

### 3.2 Data flow

1. The operator turns the speed dial. The action computes the next rate (`speed.ts`) from its own last requested rate while that request is unanswered, else from the last reported state, so a fast turn is not undone by a report that lags; it coalesces (`coalesce.ts`) and sends `speed.set` to the current target through `link-server.ts`.
2. The extension's service worker receives it, picks the target tab (`target.ts`) and forwards it to that tab's bridge script.
3. The bridge posts it to the main-world adapter, which calls the player API or the video element.
4. The adapter reads the result back (rate at once, quality by event or polling), the bridge relays a state report, the worker forwards it over the socket.
5. `targets.ts` stores it and `display.ts` redraws every action bound to that target. The strip shows what the page reported (R-BEH-4).

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
| target -> deck | `state` | as R-INT-2, plus `rateDirect` (the rate was written to the element, so the site's menu does not show it) and `inReplyTo` (null when unsolicited); with no video, `rate`, `quality`, `qualityAuto`, `title` and `host` are null and the lists empty |
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

- `manifest.json`: `manifest_version` 3; `background.service_worker`; `content_scripts` twice for the same matches, one with `"world": "MAIN"` (adapter) and one isolated (bridge); `permissions`: `storage`, `alarms`, `tabs`; `host_permissions` per D-4; `optional_host_permissions` for all sites per D-4; `options_page`.
- The adapter finds `#movie_player` on youtube.com and music.youtube.com; elsewhere it finds video elements (R-TGT-3). It listens to `play`, `pause`, `ratechange`, `loadedmetadata` on the element, the player's quality-change event, and `yt-navigate-finish` (V-4). On each `yt-navigate-finish` it checks that `#movie_player` and its video element are still the ones it bound (they were in every probed watch-to-watch navigation, V-4) and re-binds if not, waiting for `#movie_player` when a page starts without one (home, search); then it re-reads the video data, re-applies the held level when "hold quality" is on (default on, R-QLT-7) and reports state. Ad state comes from the `ad-showing` or `ad-interrupting` class on the player or the `.ytp-ad-player-overlay` element (V-3, still to confirm on a monetized video); while an ad shows, intents are queued, at most one per kind, and applied after it clears (R-BEH-1).
- The bridge and the adapter talk with `window.postMessage` tagged with a per-page nonce so another script on the page cannot inject intents.
- The worker keeps a map of tabs from the bridges' reports, reconnects the socket with backoff, answers pings, and re-checks on a one-minute alarm (R-LNK-3).

### 3.8 Stream Deck actions

| Action | Controller | Settings | Strip or key |
|--------|-----------|----------|--------------|
| Speed | Encoder | target, step, fine step, range, extended range, hold speed | `1.25x`, bar with 1.0 mark, title |
| Quality | Encoder | target, hold quality | `1080p` or `Auto 1080p`, bar over the level list |
| Speed preset | Keypad | target, rate | rate text, lit when active |
| Speed step | Keypad | target, +/- | `+0.25` |
| Quality preset | Keypad | target, level | level, dimmed when unavailable |
| Pin tab | Keypad | | pinned title or `Pin` |
| Play/Pause | Keypad | target | state icon |

Every action also reads the global settings: port, pinned extension id (optional), log level.

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

Step 3, link server (R-LNK-1..4, R-TST-2). `src/vjster/plugin/link-server.ts` with in-process tests: origin refusal, pinned id, token path (built now, used in Phase 2), ping every 20 s, latest-wins, malformed message answered with `error`, and the start and stop rule of R-LNK-1. The server sets the `ws` `maxPayload` in bytes, at least 49152, since `MAX_MESSAGE_CHARS` counts UTF-16 units and one unit can take three bytes; `parse` then applies the character limit. Each receiver checks that a message's `target` names it. Adds the origin-check flip (R-TST-4).

Step 4, extension (R-SPD-4, R-QLT-2..3, R-TGT, R-LNK-3, R-BEH-1..2). Adapter, bridge, worker, options page in `vjster-extension/`; logic in modules with unit tests in `vjster-extension/tests/`; built to `vjster-extension/bin`, which `.gitignore` then lists; loaded unpacked (D-3 a). Manual check: the worker's console shows the socket connected to a stub server run by a test script. The adapter follows the sender rules of section 3.3 (title, host, rate, level ids). Step 4 also repeats the probe in Chrome 156 (V-11), confirms the ad markers (V-3), and checks the navigations V-4 lists as not probed. Adds the ad-hold flip (R-TST-4). Build inputs settled by the Phase 0 QA: the extension gets its own `vjster-extension/tsconfig.json` (DOM lib, `@types/chrome`) so Fadester's Node tsconfig stays as it is, and a small `tsx` script copies `manifest.json`, `options.html` and the icons into `vjster-extension/bin` after rollup, since R-STD-3 allows no copy plugin. Every emitted `.js` keeps the SPDX header (R-HOME-4) even though `bin` folders are outside the hygiene walk.

Step 5, deck actions (R-SPD-3, R-SPD-5..6, R-QLT-5, R-TGT-2, R-BEH-4..5). The seven actions, named VJster Speed and so on, in Fadester's category (R-HOME-2), property inspectors, the indicator layouts, icons. Registering them changes `src/plugin.ts`, the plugin manifest and `tests/manifest-hygiene.test.ts`, which counts the actions (6 at HEAD, 7 in the uncommitted work) and, in its uncommitted version, requires every Encoder action to use `layouts/fader-cell.json`, a rule the VJster indicator layouts break; the step extends that test for the VJster actions and their layouts, and waits until no other work modifies those files (R-HOME-5). Gate: D-10, the Stream Deck app version; the speed and quality actions count from their own unanswered request (section 3.2); titles are escaped before they are drawn and never logged (R-BEH-5); `streamdeck validate`; `streamdeck link` to the Stream Deck app; TESTING.md items 1.1 onward with expected strip text; operator hands-on on the Stream Deck + with a watch page, a paused page, two tabs, Picture-in-Picture, an ad, extension reload, Chrome restart, Stream Deck restart.

Step 6, release. The VJster actions ship in the next Fadester for OBS release; the extension ships as a zip of `vjster-extension/bin` next to it, with install steps in docs/vjster. No Marketplace, no Web Store (D-3, D-8). The standalone VJster plugin (R-HOME-2) is planned after this release.

### Phase 2 -- the OBS browser-source target

1. D-5 answered; check whether OBS Browser Events already covers `emit_event` (F-9) and record it.
2. `vjster-page/player.html`: IFrame Player API embed (probe the embed first, V-10), loopback socket client with the token from the URL, state reports, speed via `setPlaybackRate`, quality via `setPlaybackQualityRange` and player sizing (R-QLT-6), V-8 confirmed in the portable OBS 33.
3. Target setting on every action (R-OBS-3), `Both` fan-out, strip states for a page that is not connected.
4. TESTING.md section 2: the page in a browser source, Studio Mode preview, source hidden and shown, OBS restart.
5. Release with the next Fadester for OBS version.

### Phase 3 -- ideas, not planned

Seek dial, volume dial, load a video by id from a key, A/B rate toggle, a Midi Fadester fader as a speed control through its vendor API, Firefox.

## 5. Test strategy summary (R-TST)

- `npx tsc --noEmit` (and, from step 4, the same for `vjster-extension/tsconfig.json`), then `npm test`, Fadester's whole vitest suite, which picks up `tests/vjster-*.test.ts`. The VJster tests stay under 30 s.
- `node --import tsx scripts/vjster/run-mutation-checks.ts` (from step 2) runs every VJster flip in a linked git worktree and reads vitest's JSON report. A flip is killed only when an assertion in its named test files fails; a filter that matches no file, a flip that stops a test file from loading, or a vitest run over 180 s is an error. Every flip runs, survivors and errors both fail the run, each file is put back byte for byte (also on Ctrl+C or exit; only a hard kill can leave it flipped, and the runner names the file first), and the VJster tests run again at the end. It refuses to run in a checkout that is not a linked worktree unless given `--here`; `--list` prints the flips. `tests/vjster-mutations.test.ts` checks in the normal suite that every flip still matches its code exactly once. Fadester's `npm run test:mutation` is not a VJster gate while M-1.1 survives (section 1).
- Fadester's manifest-hygiene test covers every VJster file (R-HOME-4).
- TESTING.md holds the manual items with expected strip text; each release lists which items were run and by whom.
- Nothing automated touches the live YouTube site; the probe in Phase 1 step 1 is run by hand and its output pasted into section 2.

## 6. Repo hygiene per change (R-STD)

Before every commit: `git ls-files --eol` shows only LF, no BOM (`Get-Content -Encoding Byte -TotalCount 3` in Windows PowerShell 5.1, the only PowerShell here), no 0-byte files, no banned placeholder word, the checks of R-TST-6 green, Sonnet 5.5 QA pass over the diff. Stage only VJster's paths; run `npm ci` and the checks of R-TST-6 in a clean `git worktree` of HEAD with those paths copied in, so the commit is tested without the other uncommitted work (R-HOME-5). One push attempt; verify HEAD equals origin; on failure a PowerShell block for the operator.

## 7. Order of work

Phase 0 and Phase 0b (done), then Phase 1 steps 1 to 6 in order, each step one commit after approval of its plan rows, then Phase 2. The probe in step 1 gates the quality design; nothing in steps 2 to 5 waits on it except the quality adapter in step 4.
