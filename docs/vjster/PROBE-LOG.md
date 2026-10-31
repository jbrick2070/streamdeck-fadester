# VJster -- Probe log (Phase 1 step 1)

Raw results behind F-4, F-10, V-1 to V-4 and V-9. Every run was made in the
Claude desktop app's built-in browser pane, user agent
`... Claude/4.4212.0 Chrome/152.0.7977.167 ...`, never in the operator's
Chrome 156 (V-11). Page: the Creative Commons film "Big Buck Bunny 60fps 4K"
(`watch?v=aqz-KE-bpKQ`), then the related videos a click led to. No ad class
or overlay was seen in any sample.

## Runs

| Run | When (local) | Code | Start state |
|-----|--------------|------|-------------|
| H | 2026-10-30, before S1 | hand-written snippets, five separate calls (A to E below) | playing |
| S1 | 2026-10-30, 23:50 | the probe script before the review fixes; restore paused at once | paused |
| S2 | between S1 and S3 | as S1 plus a wait of up to 3 s before the final pause | paused |
| S3 | 2026-10-31, 00:12 | the probe script before its last ad guards, the pause skip and the outer error handler were added; with no ad and no error those additions change nothing | paused |
| R1 | 2026-10-30 | the first reviewer's own re-run (navigation and Auto only) | not reported |

## Methods and lists (H-A, S1, S3)

All twelve methods the script lists are functions: `getAvailableQualityLevels`,
`getPlaybackQuality`, `getPreferredQuality`, `setPlaybackQualityRange`,
`setPlaybackQuality`, `getPlaybackRate`, `setPlaybackRate`,
`getAvailablePlaybackRates`, `getVideoData`, `getPlayerState`, `playVideo`,
`pauseVideo`. `setPlaybackQualityRangeAndReload` (H-A only) is undefined.

- `getAvailableQualityLevels()`: hd2160, hd1440, hd1080, hd720, large, medium, small, tiny, auto.
- `getAvailablePlaybackRates()`: 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4.

## Quality

| Run | small seen within | hd1080 seen within | Poll | Level playing 2 s after `setPlaybackQualityRange("auto")` |
|-----|-------------------|--------------------|------|-----------------------------------------------------------|
| H-B | 253 ms (height 240) | 502 ms (height 1080) | 250 ms | hd720 |
| S1 | 220 ms | 221 ms | 100 ms | hd1080 |
| S2 | 108 ms | 222 ms | 100 ms | large |
| S3 | 103 ms | 114 ms | 100 ms | hd1080 |
| R1 | | | | hd1080 |

In every run that set a level (H, S1, S2, S3) `getPreferredQuality()` read
the fixed level right after it was set, and `auto` right after the auto form.

## Rates (H-B, H-C, S1, S2, S3; identical every time)

| Asked | `getPlaybackRate()` and `video.playbackRate` |
|-------|----------------------------------------------|
| 1.5 | 1.5 |
| 1.3 | 1.3 |
| 1.37 | 1.35 |
| 2.25 | 2.25 |
| 3 | 3 |
| 5 | 4 |
| 0.1 | 0.25 |
| 0.05 | 0.25 (H-C, S1, S2, S3) |
| 1 | 1 |

Writing `video.playbackRate = 4.5` directly: read back 4.5 while the player API
still reported its last value (1). The speed actually played was not measured.
Writing 17 threw `NotSupportedError`.

## Navigation (watch page to watch page only)

| Navigation | Rate and level set before | `yt-navigate-finish` | `yt-page-data-updated` | Same `#movie_player` and `<video>` | Rate after (player / element) | Preferred after |
|------------|---------------------------|----------------------|------------------------|------------------------------------|-------------------------------|-----------------|
| H-D | no (rate 1) | 962 ms | 1521 ms | yes / yes | 1 / not read | auto |
| H-E | 1.5, hd720 | fired, not timed | not watched | not read | 1.5 / 1.5 | auto |
| S1 | 1.5, hd720 | 752 ms | not within 4.5 s | yes / yes | 1.5 / 1.5 | auto |
| S2 | 1.5, hd720 | 916 ms | not within 4.5 s | yes / yes | 1.5 / 1.5 | auto |
| S3 | 1.5, hd720 | 824 ms | 827 ms | yes / yes | 1.5 / 1.5 | auto |
| R1 | not reported | 843 ms | 1056 ms | not reported | not reported | auto |

Times are milliseconds after the click. In S1 the next video was still
unstarted when the script paused it (state -1); S2 and S3 ended paused
(state 2) after the restore.

## Ad markers sampled

| Run | At the start | After the navigation |
|-----|--------------|----------------------|
| H | player classes (H-A, H-B); no overlay check | H-E: player classes and overlay; H-D: not sampled |
| S1, S2, S3 | player classes and overlay | player classes and overlay |
| R1 | not reported | not reported |

No ad class and no overlay element appeared in any sample.

## Restore (script runs)

| Run | Rate | Element rate | Preferred | State |
|-----|------|--------------|-----------|-------|
| S1 | 1 | not reported | auto | -1 (unstarted, not playing) |
| S2 | 1 | not reported | auto | 2 (paused) |
| S3 | 1 | 1 | auto | 2 (paused) |

## Live adapter check (step 4, 2026-10-31)

The extension's page adapter, built with esbuild (minified) from
`vjster-extension/src/content-main.ts` as it stood before the step 4 review
(the shipped bundle is built by rollup from the same source), was injected into the watch page in
the built-in pane (Chromium 152) and driven exactly as the bridge drives it,
by `window.postMessage` with the `vjster-bridge` tag. Every answer came back
naming its intent; "player" is what the real player reported afterwards.

| Intent | Answer | Player |
|--------|--------|--------|
| first report, unsolicited | rate 1, Auto, large, 9 levels, 12 rates, title | |
| speed.set 1.5 | rate 1.5 | API 1.5, element 1.5 |
| speed.step +0.25 | rate 1.75 | 1.75, 1.75 |
| speed.step -0.5 | rate 1.5 | 1.5, 1.5 |
| speed.set 4.5, direct | rate 4.5, rateDirect true | API 1.5, element 4.5 |
| speed.reset | rate 1, rateDirect false | 1, 1 |
| quality.set hd1080, hold | Auto false, level still large; a follow-up report 1.5 s later: hd1080 | preferred hd1080 |
| quality.step -1, hold | Auto false | preferred hd720 |
| quality.reset | Auto true | preferred auto |
| transport.toggle | playing false | paused |
| transport.toggle | playing false at once; play events then reported playing true | playing |
| speed.set 0 | no answer: the adapter drops an intent the parser refuses | unchanged |
| speed.set 9 | rate 4 | 4, 4 |

The page was then set back to 1x and Auto and paused.

## Fake-player checks of the committed script (2026-10-31)

Scratch harnesses written by the reviewers ran the committed script against a
fake player in fifteen scenarios. None of them made a player or element call
while the fake ad flag was set.

| Scenario | Outcome |
|----------|---------|
| normal run, no options, start states cued or ended, fixed starting preference, next video starting late | starting rate and preference put back, player paused |
| next video starts about 9 s after the click | put back, but that video starts after the restore and is left playing, as the header says |
| `setPlaybackRate` throws | measurements kept, `error` set, restore done |
| reading the starting state throws | `error` set, nothing changed |
| `getPreferredQuality` missing | `stopped`, nothing changed |
| ad at the start | `stopped`, nothing changed |
| ad starts during the element-rate sleep | `stopped`, restore skipped |
| ad on the next video | no `stopped` (no measurement was left), restore skipped; that page stays at rate 1.5 and playing |
| ad starts during the restore's wait | rate and preference put back, pause skipped (`pauseSkipped`) |

The harnesses are not part of the repository.

## Embed probe (Phase 2, 2026-10-31)

A scratch page served from `http://127.0.0.1:48190` loaded YouTube's IFrame
Player API and embedded the same 4K Creative Commons video, muted, at 1280
by 720, in the desktop app's built-in pane (Chromium 152). The player object
offered `getAvailablePlaybackRates`, `getAvailableQualityLevels`,
`getPlaybackQuality`, `setPlaybackQuality` and `setPlaybackRate`, and no
`setPlaybackQualityRange` or `getPreferredQuality`. The rate list was 0.25,
0.5, 0.75, 1, 1.25, 1.5, 1.75, 2; the level list hd2160 to tiny plus auto.

| Asked | Read at once | After the event | Measured from the clock |
|-------|--------------|-----------------|-------------------------|
| 1.5 | 1 (the old rate) | 1.5, event after 26 ms | |
| 1.3, 1.05, 0.3 | the old rate | as asked | |
| 3 | the old rate | 3 | 3.00 |
| 4 | | 4 | 3.99 |
| 4.5, 5, 16 | | 4 | 4.00 to 4.04 |
| 1.33 | | 1.3 | 1.30 |
| 1.37 | | 1.35 | 1.35 |
| 0.1, 0.27 | | 0.25 | 0.25 |

Quality: `setPlaybackQuality("small")` left hd720 playing after 6 s. Shrinking
the iframe to 256 by 144 and scaling it back up with a CSS transform left
hd720 for 30 s. A new player created at 256 by 144 started at large (480p)
and stayed there through `setSize` to 1280 by 720 and back. A new player at
1280 by 720 with `vq=small` started at hd1440. So the embed offers no
quality control the page could use (R-QLT-6 dropped).

## Live page run (Phase 2, 2026-10-31)

The built page was served by a real `LinkServer` with a test token and
opened in the built-in pane at `/obs?v=aqz-KE-bpKQ&mute=1#token=...`. The
address bar showed it without the token at once, and the embed's `forigin`
parameter carried it without the token. The page connected as the `obs`
target and reported the video (rates 0.25 to 2, capabilities speed and
transport). Driven from the server: `speed.set` 1.5, 3 and a step of 0.25
were answered with 1.5, 3 and 3.25; `speed.set` 8 with `direct` with 4;
`quality.set` with `unsupported`; two `transport.toggle` with paused, then
playing; `speed.reset` with 1. Each answer carried the rate the player had
taken, not the lagging one. (This build still added 4 to the listed rates;
after the OBS check the page reports the list as it is.)

## OBS check (V-8, 2026-10-31)

In the portable OBS 33.0.0 (`--portable`, obs-browser 2.27.4, CEF
150.0.7871.252), on a separate scene collection made for the test, one
Browser source at 1280 by 720 with the page's address (served by a scratch
link server on port 48192, muted, audio routed to OBS). OBS was started
minimized with `--disable-updater`. Within 8 s the page connected and
reported the video playing at 1x. Then: `speed.set` 1.5 answered 1.5;
`speed.set` 3 answered 2; a step of 0.25 answered 2 after the 300 ms wait
(no rate change); `speed.set` 8 with `direct` answered 2; `quality.set`
`unsupported`; play/pause paused and resumed; `speed.reset` answered 1. So
in OBS the embed stops at 2x, its listed range. OBS was closed by its own
window message (a clean exit, no crash marker); its `user.ini` and
`global.ini` were restored from a backup to their earlier checksums and the
test collection removed. OBS's websocket needs the operator's password, so
no screenshot of the source was taken.
