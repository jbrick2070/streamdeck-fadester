# VJster -- Requirements

Status: APPROVED 2026-10-30 by the operator (D-2 GPL-2.0-or-later). Phase 0 and Phase 1 step 1 were done in `C:\vjster` (`jbrick2070/vjster`); on 2026-10-30 the operator moved VJster into this repository (D-6 revised, section 0.1). Requirement ids in `docs/vjster` and `src/vjster` refer to this file, not to Fadester's own REQUIREMENTS.md, and file names such as PLAN.md and PROBE-LOG.md mean the files in `docs/vjster`. Rows added or changed after that approval await the operator's review: section 0.1 (R-HOME-1..6), R-QLT-7, R-LNK-1's start and stop rule, D-9, D-10 and D-11, from step 2 the extended range of 0.1 to 16 in R-SPD-2 and the added fields in R-INT-2, and from step 3 the Host check in R-LNK-2, the 60 s silence rule in R-LNK-3 and close code 4000 in R-LNK-4.

VJster puts the playback speed and the picture quality of the video that is
playing in the operator's own browser on Stream Deck keys and Stream Deck +
dials. YouTube first; any page with an HTML video element gets speed control.
A second phase drives a video inside an OBS browser source from the same deck
actions.

Conventions: `R-*` rows are requirements (hard unless marked "soft"),
`F-*` rows are facts checked on the date given, `D-*` rows are decisions the
operator answers before the phase that depends on them.

## 0. Identity and scope

| ID | Requirement |
|----|-------------|
| R-ID-1 | VJster is two cooperating parts: Stream Deck actions (Elgato SDK 3, TypeScript on the Stream Deck app's Node runtime), shipped inside Fadester for OBS first and later also as a standalone plugin (R-HOME-2), and a companion Chrome extension (Manifest V3). The actions own the deck; the extension owns the browser. They talk over a loopback WebSocket on this machine only. |
| R-ID-2 | Name "VJster" (operator, 2026-10-30). The Chrome extension and the later standalone plugin (UUID `com.jbrick2070.vjster`) are named "VJster". Inside Fadester for OBS the actions are named "VJster Speed", "VJster Quality" and so on, and carry Fadester's category and UUID prefix (R-HOME-2). Repository and folder: this one (R-HOME-1). Neither "OBS", "YouTube" nor "Google" appears in the name, identifiers, icon or artwork of the extension or the standalone plugin, or in a VJster action's own name or icon. Internal wire values such as the target id `obs` (R-INT-1) and plain prose referring to the OBS program or the YouTube site are not branding. |
| R-ID-3 | Phase 2 adds a second target: a local HTML page of the operator's own, loaded in an OBS browser source, that embeds a YouTube video and obeys the same deck actions. It is a transport, not a different feature set. |
| R-ID-4 | License: GPL-2.0-or-later (D-2), matching Fadester for OBS. Author Jeffrey A. Brick. Every source file is written for this project; nothing is copied from another extension or plugin. |
| R-ID-5 | 100 % local. No cloud, no API keys, no accounts, no analytics, no update checks. The only network traffic is loopback (127.0.0.1) between the two parts, plus in Phase 2 the OBS browser source page connecting to the same loopback socket. No Python anywhere in the product, the build or the tests. |

## 0.1 Home in the Fadester repository (D-6 revised 2026-10-30)

| ID | Requirement |
|----|-------------|
| R-HOME-1 | VJster's source of truth is the Fadester for OBS repository, `C:\streamdeck-fadester` (`jbrick2070/streamdeck-fadester`). Documents: `docs/vjster/`. Code: `src/vjster/` (shared logic, link server, deck logic), deck actions `src/actions/vjster-*.ts` (step 5). Tests: `tests/vjster-*.test.ts`. Probe: `scripts/vjster/probe-player-api.js`. The Chrome extension: `vjster-extension/` with its own `tsconfig.json` (DOM lib, `@types/chrome`) and rollup config, built into `vjster-extension/bin/`. The Phase 2 page: `vjster-page/`, built into `vjster-page/bin/`. |
| R-HOME-2 | "Both" (operator, 2026-10-30): the deck actions ship first inside Fadester for OBS, and a standalone VJster plugin (`com.jbrick2070.vjster`) is built later from the same source with its own manifest, for decks without OBS. A Stream Deck action has no category of its own (`@elgato/schemas` 0.5.3: `Category` is a plugin property, absent from the action definition), so inside Fadester the VJster actions appear in Fadester's category and their UUIDs start with Fadester's plugin UUID (`com.jbrick2070.fadester-for-obs.vjster-speed` and so on); the standalone plugin's actions use `com.jbrick2070.vjster.*`. |
| R-HOME-3 | VJster code, which includes `src/actions/vjster-*.ts`, imports nothing from Fadester's OBS code (`src/obs`, `src/control`, `packages/streamdeck-fadester-shared/src/obs`), so the standalone build stays possible. A Fadester module may be reused only if it imports nothing Fadester-specific: at 7cf7207 `packages/streamdeck-fadester-shared/src/palette.ts` and `cell-rate-limiter.ts` import nothing (the `src/gfx` files of those names only re-export them), while `svg-renderer.ts` there imports Fadester's slot types and `fx-policy` and is not reusable as is. |
| R-HOME-4 | Fadester's rules apply to every VJster file: its manifest-hygiene test (an SPDX `GPL-2.0-or-later` header and no banned word in every `.ts`, `.js`, `.mjs`, `.css` and `.html`; no BOM and no 0-byte file anywhere; R-STD-1 keeps the banned word out of Markdown too), `npx tsc --noEmit` and `npm test`. Fadester's mutation runner joins these once its M-1.1 no longer survives; until then VJster's own runner applies (R-TST-4). Built output lives in folders named `bin`, which the hygiene walk skips. |
| R-HOME-5 | The Fadester working tree may hold someone else's uncommitted work. A VJster step never edits a file that is modified there; a step that needs such a file (on 2026-10-30: `package.json`, `package-lock.json`, `src/plugin.ts`, the plugin manifest, `tests/manifest-hygiene.test.ts`, README) waits until that work is committed. A VJster commit stages only its own paths and is tested in a clean worktree of the committed tree plus those paths before its single push. |
| R-HOME-6 | `C:\vjster` and `jbrick2070/vjster` are kept, never deleted; their README points here. Whether that repository later holds the standalone build or is archived is D-9. |

## 1. Facts that shape the design (checked 2026-10-30)

| ID | Fact |
|----|------|
| F-1 | obs-browser registers one obs-websocket vendor, `obs-browser`, with one request, `emit_event`, fields `event_name` (string) and `event_data` (object). It is delivered to every browser source page as a DOM `CustomEvent` on the page's global object with `detail` set to `event_data`. Confirmed in obs-browser master: `obs-browser-plugin.cpp` (registration and handler), `obs-browser-source.cpp` (`DispatchJSEvent` to all browsers), `browser-app.cpp` (the render process builds `new CustomEvent(name, {detail})` and calls `dispatchEvent`). |
| F-2 | obs-websocket has no request that sends keyboard or mouse input into a browser source, its media requests apply to media sources only, and the browser source has no custom-JavaScript setting. A raw youtube.com page inside OBS therefore cannot be controlled from obs-websocket. Only a page the operator controls can listen (R-ID-3). |
| F-3 | The YouTube IFrame Player API reference (read 2026-10-30) documents `setPlaybackRate` (the player rounds an unsupported value toward 1) and `getAvailablePlaybackRates` (always at least `[1]`), and no longer documents any quality setter. The embedded player chooses quality from its rendered size and the connection. |
| F-4 | On youtube.com itself the player element (`#movie_player`) exposes the same API object, including methods the reference no longer lists: `getAvailableQualityLevels`, `getPlaybackQuality`, `setPlaybackQualityRange`, plus `getPlaybackRate`, `setPlaybackRate`, `getAvailablePlaybackRates`, `getVideoData`. User scripts rely on them and they can change without notice. CONFIRMED 2026-10-30 and 31 by the Phase 1 step 1 probe in the desktop app's built-in browser pane (Chromium 152, PLAN.md V-1, V-2, V-11): all of them exist, plus `getPreferredQuality`, which returns the chosen level or `auto`, and `setPlaybackQuality`. A fixed level took effect within about 0.5 s in all four runs. After `setPlaybackQualityRange("auto")`, `getPreferredQuality()` reads `auto` at once, but the level actually playing may lag: 2 s later it was hd720, hd1080, large and hd1080 in four runs, and hd1080 in the first reviewer's re-run (PROBE-LOG.md). To be repeated in the operator's Chrome 156 at Phase 1 step 4. |
| F-5 | Chrome Manifest V3: a content script declared with `"world": "MAIN"` runs in the page's own JavaScript world and can call the player object; an isolated-world script sees the DOM but not page objects. The extension service worker is stopped after 30 s idle; since Chrome 116 WebSocket traffic resets that timer, so a heartbeat shorter than 30 s keeps the worker and its socket alive. Installed Chrome: 156.0.8078.79. The Phase 1 step 1 probe ran in the desktop app's built-in browser (Chromium 152), not in this Chrome. |
| F-6 | Windows Chrome runs an extension that did not come from the Chrome Web Store only when it is loaded unpacked with Developer mode on (Chrome may show a "disable developer mode extensions" prompt at start), or when a registry policy allowlists it. The Web Store allows unlisted items (one-time developer fee), with a single-purpose description and a privacy disclosure for host permissions. |
| F-7 | Toolchain on this machine: Stream Deck app `StreamDeck.exe` is 7.4.2.22730, confirmed 2026-10-30 from the app's own log (build May 11 2026). Fadester's committed manifest asks for 7.1; an uncommitted change in the Fadester working tree raises it to 7.6, above the installed app, which would then refuse the plugin. The standalone VJster manifest will ask for 7.4. Node v25.9.0, npm 11.12.1. Fadester for OBS (C:\streamdeck-fadester) uses `@elgato/streamdeck` 3.0.3, `@elgato/cli` 1.10.3, manifest `SDKVersion` 3, Node >= 24, rollup 4.65.1, TypeScript 5.9.3 (declared ^5.8.3), vitest 3.2.7, tsx, and a mutation-check script. Since the move, VJster builds with Fadester's own `package.json` (R-STD-3). |
| F-8 | Stream Deck + encoders deliver `dialRotate` (signed `ticks`, plus `pressed` when the dial is held during the turn), `dialDown`, `dialUp` and `touchTap`. The touch strip is drawn from a feedback layout; the built-in indicator layout gives a title, an icon, a value and a bar. |
| F-9 | Prior art installed here: Elgato's own OBS plugin, Elgato's YouTube plugin (channel statistics, not playback) and "OBS Browser Events" (`com.luxterful.obs-browser-events`, Marketplace build, encrypted manifest, not inspected). Phase 2 checks whether the last one already sends `emit_event`; if so, VJster's Phase 2 shrinks to the page. |
| F-10 | Browsers limit `HTMLMediaElement.playbackRate`; Chrome documents 0.0625 to 16. The probe (Chromium 152 in the built-in pane, 2026-10-30) saw 4.5 accepted and read back (the speed actually played was not measured) and 17 throw `NotSupportedError`; the exact bounds were not probed. In the same probe YouTube's player reports rates 0.25 to 4 (`getAvailablePlaybackRates`: 0.25 steps up to 2, then 2.5, 3, 3.5, 4), and `setPlaybackRate` kept every value tried that lies on a 0.05 grid inside that range (1.3, 1.5, 2.25, 3, 1) and moved the others: 1.37 became 1.35, 5 became 4, 0.1 and 0.05 became 0.25. The rest of the 0.05 grid was not tried. A value written to the element directly (4.5) is read back from the element, but the player API keeps reporting its own last value. |

## 2. Intents: the vocabulary shared by all parts

| ID | Requirement |
|----|-------------|
| R-INT-1 | One protocol, version 1, JSON messages over the loopback WebSocket. Intents from the deck: `speed.set {rate}`, `speed.step {delta}`, `speed.reset`, `quality.set {level}`, `quality.step {direction}`, `quality.reset`, `transport.toggle`, `state.get`, `pin.set {pinned}`. Every message carries `v: 1`, an `id` and a `target` (`browser` or `obs`); a reply echoes the id in `inReplyTo`. Both sides exchange `ping` and `pong` for the keep-alive (R-LNK-3). The full table is PLAN.md 3.3. |
| R-INT-2 | State reports from a target: `{v, target, rate, availableRates, quality, availableQualities, qualityAuto, title, host, playing, adPlaying, capabilities}`, plus `rateDirect` (R-SPD-2 marker) and `inReplyTo`. With no video the video fields are null and the lists empty. `capabilities` says what this target can do (`speed`, `quality`, `transport`) so the deck shows "n/a" instead of guessing. |
| R-INT-3 | Unknown fields are ignored. A target answers an unknown or malformed intent with an `error {code, message, inReplyTo}`; the deck drops a malformed report, logs it once without its content and asks again with `state.get`, at most once every 2 s (PLAN.md 3.3). Neither side closes the connection over a bad message; the WebSocket layer itself closes on a frame over 49152 bytes (1009) or on invalid UTF-8 (1007). Messages are validated before use on both sides; no `eval`, no dynamic property paths. |
| R-INT-4 | Every intent is answered, by a state report within 250 ms or by an error, so the deck can show the real result (R-BEH-4). |

## 3. Speed

| ID | Requirement |
|----|-------------|
| R-SPD-1 | A speed dial turn changes the rate by the configured step, default 0.25. Turning while the dial is held uses the fine step, default 0.05, which matches the grid the probe saw (F-10). Both steps are settings of the action (0.05, 0.1, 0.25, 0.5). |
| R-SPD-2 | Range by default the player's own: the minimum and maximum of `getAvailablePlaybackRates()` (0.25 to 4 on YouTube today, F-10; the first draft said 2) on the 0.05 grid the player appears to use (F-10: every grid value tried was kept), so the values the deck sends should come back unchanged, which step 5's TESTING checks across the grid; a target without a player API gets 0.25 to 2. Whether the site's settings menu labels a value such as 2.25, which the player accepts but does not list, was not inspected; TESTING checks it at step 5. An "extended range" setting (off by default) allows the grid values inside the browser's own limits, 0.1 to 16 (F-10; Chrome's lower limit 0.0625 is off the grid), by writing `playbackRate` on the video element directly; the deck then shows the element's value with a marker, because the player API and the site's menu will not reflect it. |
| R-SPD-3 | Dial press and release without a turn resets the rate to 1.0. A touch tap toggles play and pause when the target reports the `transport` capability. |
| R-SPD-4 | On YouTube the rate is set through the page's player API, and YouTube carries it to the next video in that tab (1.5 survived, read from the player and the element, in all four watch-to-watch navigations probed with a rate set, PLAN.md V-9). On any other site the rate is written to the chosen video element and, with "hold speed" on (default on), written again when the element is replaced or reloads metadata. |
| R-SPD-5 | Preset keys (Keypad): one fixed rate per key, shown on the key, highlighted while it is the active rate. Step keys: `+step` and `-step`. All keys use the same step and range settings as the dial. |
| R-SPD-6 | Speed display on the strip: the rate as `1.25x`, a bar from the range minimum to maximum with 1.0 marked, and the video title truncated to fit. States: `No video` when nothing is targeted, `Extension off` when the extension is not connected, `Ad playing` while R-BEH-1 holds the change. |

## 4. Quality (YouTube only, best effort)

| ID | Requirement |
|----|-------------|
| R-QLT-1 | A quality dial turn steps through the levels the current video offers (`getAvailableQualityLevels`, F-4), shown as `2160p`, `1440p`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`; `auto` is not in the cycle. A press returns to Auto. |
| R-QLT-2 | A level is applied through `setPlaybackQualityRange(level, level)`; Auto through `setPlaybackQualityRange("auto")`; whether Auto is on comes from `getPreferredQuality()`, which returns `auto` or the chosen level. Confirmed 2026-10-30 (F-4). If a method is missing or throws, the dial shows `n/a`, one log line is written, and nothing retries in a loop. |
| R-QLT-3 | After a change the actual quality is read back (quality-change event, else polling every 500 ms for at most 5 s) and displayed as `1080p`, or `Auto 1080p` while Auto is on. The dial never shows a level the player did not take. A return to Auto succeeds when `getPreferredQuality()` reads `auto`; the level shown next to it is whatever is playing, which can stay at the old fixed level for a while (F-4). |
| R-QLT-4 | Quality is YouTube only. Other sites report no `quality` capability and the dial shows `n/a`. |
| R-QLT-5 | Preset keys for fixed levels show dimmed when the current video does not offer that level. |
| R-QLT-6 | Soft: in the Phase 2 OBS page, quality is also steered by sizing the embedded player to the chosen level's resolution, because the embed picks quality from rendered size (F-3). |
| R-QLT-7 | YouTube reset the chosen level to Auto in every watch-to-watch navigation probed (four runs, 2026-10-30 and 31: `hd720` became `auto` on the next video every time while the rate survived; other kinds of navigation were not probed, PLAN.md V-4, V-9). A "hold quality" setting (default on) re-applies the chosen level after `yt-navigate-finish`, so the dial's level outlives the video the way the rate does. The held level lives in the page adapter, per tab, in memory only. If the next video does not offer it, the nearest lower offered level is applied and shown. `quality.reset`, which a dial press sends, clears the hold. |

## 5. Which video is "the current one"

| ID | Requirement |
|----|-------------|
| R-TGT-1 | The extension tracks every tab with a video element that has played. The target is: the one tab whose video is playing, if exactly one; among several playing tabs, the active tab of the focused window, else the one that started most recently; if none is playing, the one paused most recently, so speed can be set before pressing play. |
| R-TGT-2 | A "Pin this tab" key fixes the target to the active tab until unpinned or the tab closes; the key shows the pinned title. |
| R-TGT-3 | Background tabs and Picture-in-Picture count the same as a foreground tab. Several videos on one page: the playing one, else the largest visible one. |
| R-TGT-4 | A target change is pushed to the deck at once, so the strip title follows what will actually be controlled. |

## 6. The link between the plugin and the extension

| ID | Requirement |
|----|-------------|
| R-LNK-1 | The plugin hosts a WebSocket server bound to 127.0.0.1 only, default port 48150, configurable in the property inspector and the extension's options page. It never binds a LAN address. The server runs only while a VJster action is in use: it starts at the first `willAppear` of a VJster action and stops 60 s after the last `willDisappear`, so a page or profile switch does not drop the link, and a Fadester for OBS install that uses no VJster action opens no port. Two VJster hosts on one machine are D-11. |
| R-LNK-2 | The server accepts a connection only when the HTTP `Origin` header is a `chrome-extension://` origin, optionally pinned to one extension id in settings. Any other origin, including a web page trying 127.0.0.1, is refused at the handshake. Phase 2's OBS page connects with a random 128-bit token (32 hex digits) in its URL query instead, because its origin is `file://`. Every connection must also carry a Host header naming the server itself (`127.0.0.1:<port>` or `localhost:<port>`), which defeats DNS rebinding; refusals are plain HTTP 403. |
| R-LNK-3 | The extension's service worker connects, reconnects with backoff from 1 s to 30 s, and answers the plugin's JSON `ping`, sent every 20 s, with a `pong` (F-5); the plugin closes a connection that stays silent for 60 s. A `chrome.alarms` check every minute reconnects if the socket is gone. While the plugin's server is stopped (R-LNK-1) a refused connection is the normal state: the extension keeps retrying with its backoff and logs nothing for it. |
| R-LNK-4 | One browser connection is current at a time (latest wins; the older one is closed with code 4000); the plugin asks for the current state on connect, and the target pushes it then and on every change. |
| R-LNK-5 | The link carries titles, hostnames and playback state only; never full URLs, cookies, page content or history. Nothing is stored on disk except the operator's settings. |

## 7. Phase 2: the OBS browser-source target

| ID | Requirement |
|----|-------------|
| R-OBS-1 | A local page shipped in the repository (`vjster-page/player.html`) embeds one YouTube video through the IFrame Player API, connects to the plugin's loopback socket (D-5), reports state like the extension does, and applies speed via `setPlaybackRate`; quality best effort via `setPlaybackQualityRange` and the size lever (R-QLT-6). |
| R-OBS-2 | The page takes the video id, the port and the token from its URL query, so the browser source URL is the whole configuration. OBS's browser source allows autoplay without a gesture, so the page starts when the source becomes active. |
| R-OBS-3 | Each deck action has a Target setting: Browser, OBS page, or Both. Both sends every intent to both targets and shows the browser's state. |
| R-OBS-4 | Alternative transport kept documented, not built unless D-5 says so: `CallVendorRequest` to vendor `obs-browser`, request `emit_event`, with `event_name` `vjster` and `event_data` = the intent (F-1). It is one-way; state could only be guessed. |

## 8. Behavior rules (hard)

| ID | Requirement |
|----|-------------|
| R-BEH-1 | VJster never alters, skips, mutes or speeds up advertisements. While the player reports an ad, intents are held and the chosen rate is applied when the content resumes; the strip says `Ad playing`. |
| R-BEH-2 | VJster never reads, stores or transmits watch history, cookies or page content beyond the current title and hostname, kept in memory only (R-LNK-5). |
| R-BEH-3 | Bounded work: fast dial turns coalesce so at most one call reaches the page per 50 ms, and the final value is always applied. Every intent causes at most one call into the page. |
| R-BEH-4 | Degrade visibly, never silently: `Extension off`, `No video`, `Ad playing`, `n/a`. A number on the strip is always the value the target reported, never the value the deck asked for. |
| R-BEH-5 | Logs go through the Stream Deck SDK logger with a level setting (default info); the extension logs to its own console only. No log line contains a URL or a title. |

## 9. Testing

| ID | Requirement |
|----|-------------|
| R-TST-1 | Unit tests (vitest) for all pure logic: rate stepping, clamping and snapping; the quality cycle over varied level lists; target selection over tab states; message validation; coalescing. They need neither the Stream Deck app nor Chrome. |
| R-TST-2 | Link tests run the plugin's WebSocket server in-process with real `ws` clients: origin, Host and token refusal, pinned ids, latest-wins, malformed reports dropped and re-asked with a throttle, and the keepalive on a fake clock. |
| R-TST-3 | Extension logic lives in modules with no `chrome.*` globals; thin adapters wrap the browser API so the logic is unit-tested like the plugin's. |
| R-TST-4 | Mutation checks: named flips (a clamp bound, the snap grid, the origin check, the ad hold) must each make the suite fail. They run from VJster's own runner, `scripts/vjster/run-mutation-checks.ts`, because Fadester's runner stops at its first surviving mutation (PLAN.md section 1). A mutation runner rewrites tracked files, so it runs only in a clean worktree, never in the shared checkout. |
| R-TST-5 | A probe (Phase 1 step 1) lists the player API methods present on a live watch page and records the result in PLAN.md section 2 before quality code is written. |
| R-TST-6 | `npx tsc --noEmit` for every VJster tsconfig (the root one; from step 4 also `npx tsc --noEmit -p vjster-extension`) and `npm test` (Fadester's whole vitest suite, which picks up the VJster tests) run after every code change without being asked. Manual checks live in TESTING.md as numbered items with the expected strip text. |

## 10. Code and repo standards

| ID | Requirement |
|----|-------------|
| R-STD-1 | UTF-8 without BOM, stored with LF line endings (`git ls-files --eol` shows `i/lf`; this repository has no `.gitattributes`), ASCII quotes in docs and commands, no profanity, and the placeholder word the operator banned is never written (use placeholder or stub). |
| R-STD-2 | TypeScript strict for the plugin, the extension and the Phase 2 page; `npx tsc --noEmit` passes for each tsconfig (R-TST-6). The console probe `scripts/vjster/probe-player-api.js` is plain JavaScript on purpose: it is pasted into a browser console and never built, tested or shipped. |
| R-STD-3 | Fadester's `package.json` and its pinned versions are VJster's. VJster may add only `ws` as a direct dependency (step 3; today it is resolved through `@elgato/streamdeck`, and Fadester's shared package already imports it), `@types/chrome` as a dev dependency (step 4), and npm scripts named `vjster:*` that build and check the extension and the page, each when `package.json` is not modified by other work (R-HOME-5). Nothing else without a D-row. |
| R-STD-4 | Each step: docs/vjster REQUIREMENTS.md and PLAN.md updated, operator approval, code, the checks of R-TST-6, a Sonnet 5.5 QA pass over the diff, commit of VJster's own paths only, tested in a clean worktree (R-HOME-5). One `git push` attempt per step; afterwards verify HEAD equals origin, no 0-byte files, no BOMs; on failure hand over a copy-paste PowerShell block. |
| R-STD-5 | Inside Fadester for OBS the VJster actions ship in Fadester's version. The standalone plugin and the extension carry their own semantic versions, the plugin manifest in the four-part form (`0.1.0.0`). Icons are drawn for VJster; no OBS, YouTube or Elgato artwork. |

## 11. Non-goals

- Skipping, blocking or hurrying advertisements; downloading or recording video.
- Controlling a browser that is not the operator's own, or a raw youtube.com page inside OBS (F-2).
- Firefox and Safari. Edge is Chromium and may load the extension unchanged; untested.
- Volume, seeking, playlists and loading a video by id from the deck: Phase 3 ideas only.
- An OBS plugin or an OBS forum listing. If the Phase 2 page is ever listed there, the forum's policy applies (AI-use disclosure; no "OBS" in names).

## 12. Open decisions

| ID | Question | Proposed / answer | Gate |
|----|----------|-------------------|------|
| D-1 | Name and identifiers. | ANSWERED 2026-10-30 by the operator: "VJster"; `com.jbrick2070.vjster`; `jbrick2070/vjster`; `C:\vjster`. | Phase 0 |
| D-2 | License. | ANSWERED 2026-10-30 by the operator: GPL-2.0-or-later, like Fadester for OBS. | Phase 0 |
| D-3 | How the extension is installed. (a) Load unpacked with Developer mode, personal use. (b) Chrome Web Store, unlisted, before any public release. (c) Registry allowlist for a packed file. | (a) now, (b) before the first public release. | Phase 1 step 5 |
| D-4 | Host permissions. | `*.youtube.com` and `music.youtube.com` in the manifest; an optional all-sites permission the operator can grant from the options page for speed on any video element. | Phase 1 step 4 |
| D-5 | Phase 2 transport. (a) The page connects to VJster's loopback socket: two-way, no obs-websocket password in the plugin. (b) `emit_event` through obs-websocket: one-way. | (a). | Phase 2 |
| D-6 | Standalone plugin or an action group inside Fadester for OBS. | ANSWERED 2026-10-30 by the operator: standalone. REVISED the same day by the operator: "both ideally", starting in `C:\streamdeck-fadester`. The deck actions ship first in Fadester for OBS; a standalone VJster plugin is built later from the same source (section 0.1). | Phase 1 |
| D-7 | Default steps. | Turn 0.25, held turn 0.05, press resets to 1.0 (R-SPD-1, R-SPD-3). Built as proposed in step 2 (`DEFAULT_STEP`, `DEFAULT_FINE_STEP`, `RESET_RATE` in `src/vjster/shared/speed.ts`); still the operator's call, and a change is one constant each. | Phase 1 step 5 |
| D-8 | Elgato Marketplace listing of the plugin. | Not before Phase 2 is done; Fadester's PUBLISHING.md experience applies. A Fadester for OBS release that carries the VJster actions needs a listing text for a feature that works without OBS. | First public release |
| D-9 | Future of `jbrick2070/vjster`. (a) It holds the standalone build's releases, source staying here. (b) Archived on GitHub after the standalone build ships from this repository. | (a). Nothing changes there before the standalone build. | Standalone build |
| D-10 | Stream Deck app version for step 5. The uncommitted Fadester manifest asks for 7.6; the installed app is 7.4.2.22730 (F-7) and would refuse the plugin, so the VJster actions could not be tried on this deck. | Update the Stream Deck app to 7.6 or later before step 5, or keep Fadester's MinimumVersion at or below the installed version until then. The Fadester work decides the manifest; VJster only checks the gate. | Phase 1 step 5 |
| D-11 | Fadester-hosted VJster and the standalone plugin on one machine: both would listen on 48150. | The second to start finds the port taken, opens no server, shows `VJster runs in another plugin` (a new R-BEH-4 state, added with the standalone build) and retries the port every 30 s, taking over when the other host stops; the port setting lets an operator run both on purpose. | Standalone build |
