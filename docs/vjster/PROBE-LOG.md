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
