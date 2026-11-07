# TourBox preset for YouTube playback and live VJ use (Windows)

Written 2026-11-04. A design, not a build. Companion to `C:\Users\jeffr\Documents\obs-playlister\docs\TOURBOX-LAYOUT.md`
(the OBS "Show" preset); the two presets share Tour as the switch between them. Every TourBox Console
fact below comes from that doc's sources or the pages listed in section 8. Anything marked
**untested** was not confirmed against a primary source or on this machine and belongs in the test.

## 0. The one decision that shapes everything: how keystrokes reach the video

TourBox Console sends keystrokes, mouse actions and macros. It has no network action and no
documented "run program" action (its macro "Open" opens a file, folder or URL). So the TourBox can
reach YouTube by exactly three paths:

| Path | What carries the press | Needs Chrome focused? | Which tab gets it | Ads | Live |
|---|---|---|---|---|---|
| **A. Native YouTube key** (`k`, `j`, `<`, `,` ...) | Chrome delivers the key to the focused page | **Yes**, and the YouTube tab must be the active tab, and the caret must not be in search, comments or chat | The active tab only | Player decides | Player decides |
| **B. VJster command** (Chrome extension `commands`, `"global": true`) | Chrome routes the shortcut to VJster's service worker even when Chrome has no focus | **No** for global commands (Windows supports them; ChromeOS does not) | VJster's own router: the one playing tab, else active tab of the focused window, else the most recent; or the pinned tab | Held until the ad ends (R-BEH-1), never skipped | Range reported by the player; speed collapses to 1x when the player offers only `[1]` |
| **C. OBS hotkey** | OBS global hotkeys with "Never disable hotkeys" | No | n/a | n/a | n/a |

Path B does not exist yet. VJster today takes intents only from the Stream Deck plugin over the
loopback link; the extension has no `commands` block (checked: `manifest.json` has none). Adding one
is the smallest piece of new code in this design and the one that makes the preset work by feel,
because feel means "without looking at which window has focus". Everything below assumes path B
for the core controls and path A only for things that are harmless when they miss.

Chrome's rules for path B (primary source, section 8):

- A command shortcut must include Ctrl or Alt; Shift is optional; Ctrl+Alt is forbidden; F-keys are
  not in the supported list; media keys take no modifier.
- Global commands: suggested keys are limited to **Ctrl+Shift+0..9** (ten slots). "End users are
  free to remap global commands to their preferred key combination" at `chrome://extensions/shortcuts`.
  Whether the remap UI accepts a non-digit key for a global command is **untested**.
- At most four `suggested_key` entries in the manifest; the rest are assigned once by hand at
  `chrome://extensions/shortcuts`. They persist per Chrome profile.
- Whether Chrome counts a TourBox-driver keystroke as a real keyboard press for global commands is
  **untested** (it should: Console injects keyboard input like any macro tool).

Key budget, so the TourBox never sends a key that does nothing:

| Slot | Key sent by TourBox | VJster command | Scope |
|---|---|---|---|
| 1 | Ctrl+Shift+1 | speed down one step (0.25) | global |
| 2 | Ctrl+Shift+2 | speed up one step (0.25) | global |
| 3 | Ctrl+Shift+3 | speed reset to 1x | global |
| 4 | Ctrl+Shift+4 | play/pause | global |
| 5 | Ctrl+Shift+5 | seek back 5 s | global |
| 6 | Ctrl+Shift+6 | seek forward 5 s | global |
| 7 | Ctrl+Shift+7 | jump back one beat | global |
| 8 | Ctrl+Shift+8 | loop in / loop out (two-state) | global |
| 9 | Ctrl+Shift+9 | loop clear | global |
| 0 | Ctrl+Shift+0 | reset all (speed 1x, quality Auto, loop clear) | global |
| a | Alt+Shift+Q / W | speed down / up fine (0.05) | Chrome-focused; remap to global if the UI allows |
| b | Alt+Shift+A / S | seek back / forward 0.5 s | same |
| c | Alt+Shift+Z / X | frame back / forward (pauses first) | same |
| d | Alt+Shift+B | tap tempo | same |
| e | Alt+Shift+P | pin / unpin this tab | same |
| f | Alt+Shift+L | jump to live edge | same |
| g | Alt+Shift+G | jump back four beats | same |

If the remap to global works for the Alt+Shift set, the whole preset is focus-free. If not, the
Side-held layer (section 2) still works whenever Chrome is the foreground window, which during a
VJ set it usually is; OBS does not need focus for its hotkeys (path C).

## 1. The preset: "YouTube VJ"

Console settings: auto-switch **off**, this preset and "Show" starred so Tour toggles between
them. HUD on, a different colour from "Show". Knob and Scroll rotation speed on the slowest setting
so one detent is one keystroke (Console names the three speeds differently on two manual pages:
"Fast/Medium/Slow" on one, "standard/slow 1/slow 2" on another; use the slowest). Rep mode off
everywhere; Up mode off everywhere.

| Control | Normal | Side held (physical combination) | Path | Status |
|---|---|---|---|---|
| **Knob** turn | Playback speed, 0.25 per detent, down/up | Speed, 0.05 per detent | B | new plumbing; intents exist |
| **Knob** press | **Reset to 1x** | Quality back to Auto (`quality.reset`) | B | new plumbing; intents exist |
| **Dial** turn | Seek 5 s per click, back/forward | (none: Dial has no Prime Four combinations; Custom Section only, untested) | B | new code |
| **Dial** press | **Play/pause** | (empty) | B | new plumbing; `transport.toggle` exists |
| **Scroll** turn | Frame step back/forward; pauses the video first if playing | Seek 0.5 s per tick | B | new code, frame step **untested** (3.4) |
| **Scroll** press | Jump back one beat | Tap tempo | B | new code |
| **Tall** | Loop in, then loop out (press twice; loop runs from the second press) | Pin/unpin this tab (`pin.set` exists) | B | new code |
| **Short** | Loop clear | Jump to live edge | B | new code |
| **Top** | **Reset everything** (macro, 3.7) | (empty) | B + C | new code + Console macro |
| **D-pad Up / Down** | Speed preset 1x / 0.5x (`speed.set` exists) | 2x / 0.25x | B | needs four more key slots or a TourMenu, untested |
| **D-pad Left** | Jump back four beats (one bar) | (empty) | B | new code (beat command with a count) |
| **D-pad Right** | Next video, Shift+N | (empty) | A | native, needs Chrome focus, harmless when it misses |
| **Tour** | Switch preset to "Show" | | Console built-in | today |
| **C1** | Mute, `m` | | A | native, needs focus; harmless when it misses |
| **C2** | Fullscreen, `f` | | A | native, needs focus |
| **Side** alone | **Empty on purpose** | | | |

Why the rotaries sit where they do, by feel:

- **Knob = speed.** It is under the index finger, has the firmest detents and the shortest travel,
  so you can count detents without looking: two detents from 1x is 1.5x, two back is home. Press
  it and you are at 1x for certain. Speed is the one thing a VJ rides for seconds at a time.
- **Dial = seek.** Big, flat, thumb-driven, coarse. Five seconds per click is a scrub you can count.
  Its press is the biggest target on the box, which is where play/pause belongs.
- **Scroll = frames.** Fast, small, with a click. Frame stepping is a burst of ticks while paused.
  Its press is "back one beat", the move you make on a downbeat without thinking.
- **Tall/Short = loop.** The two tallest buttons are a pair you find by touch: big sets, small clears.

Double-clicks are unmapped everywhere. A double-click on a TourBox is a timing gesture you cannot
feel. Side alone is empty so a wrong release never fires anything (the OBS doc's section 6 test
checks that Console does not fire Side's own action after a combination; the result applies here).

## 2. The Side-held layer: "fine and rescue"

One layer, one idea: everything under Side is the same control, finer, or the way out.

| Side + | Does | Why it is here |
|---|---|---|
| Knob turn | Speed in 0.05 steps on the grid the player keeps (F-10) | Same finger, same direction, five times finer: nudging a clip to a tempo |
| Knob press | Quality back to Auto | The rescue for the other dial VJster has |
| Scroll turn | Seek 0.5 s per tick | Same control as frames, ten times coarser, still sub-second |
| Scroll press | Tap tempo | Tapping is a press you repeat; it sits beside the beat jump it feeds |
| Tall | Pin/unpin the current tab | Fixes "the wrong tab is being controlled" without touching the mouse |
| Short | Jump to live edge | The rescue for a live stream you fell behind on |
| D-pad Up/Down | 2x / 0.25x presets | The extremes, deliberately not on the plain press |

Not in the layer: Dial (Console offers no Prime Four combination for it; a Custom Section pair is
possible and **untested**), Top, Tour, C1, C2.

## 3. Feature by feature: native, VJster, or new code

Native key facts come from YouTube's own shortcut page; what it does not say is marked.

### 3.1 Play/pause

- **Native:** `k` ("Pause/Play in player"). Space only "when the seek bar is selected", otherwise it
  activates whatever button has focus, so never send Space. The page also lists the keyboard
  "Play/Pause Media Key". Chrome handles hardware media keys without focus through the Media Session
  and picks the tab itself (the most recent session). Whether Console can send a media key, and which
  tab Chrome picks with two YouTube tabs open, is **untested**.
- **VJster:** `transport.toggle` exists today (player `playVideo`/`pauseVideo`). Held during an ad
  (R-BEH-1), applied when the content resumes.
- **Verdict:** VJster, via global command 4. Needs only the `commands` plumbing.

### 3.2 Playback speed and reset to 1x

- **Native:** `>` and `<` "Speed up/Slow down the video playback rate". The page gives no step
  size; 0.25 is what the player's menu shows, **unverified** on a Google page. No native reset key:
  returning to 1x is up to four presses from 2x, and you cannot know how many without looking.
- **VJster:** `speed.step` (0.25, fine 0.05, R-SPD-1), `speed.set`, `speed.reset` exist. YouTube's
  own API doc: an unsupported value is rounded "in the direction of 1"; the probe saw the 0.05 grid
  kept inside 0.25 to 4 (F-10). The rate survives watch-to-watch navigation in the tab (R-SPD-4).
- **Verdict:** VJster, global commands 1, 2, 3 (and Alt+Shift+Q/W for fine). Nothing new inside
  the page; only command-to-intent mapping.

### 3.3 Fine seeking

- **Native:** Left/Right "on the seek bar" 5 s, `j`/`l` 10 s "in player". The arrows scroll the
  page when the seek bar is not selected, so they are the wrong key to send blind. Nothing finer
  than 5 s.
- **VJster:** no seek intent today. New intent `seek.by {seconds}`: in the MAIN-world script,
  `video.currentTime += seconds` on the element VJster already tracks (the player's `seekTo` goes to
  "the closest keyframe before that time" unless the span is buffered; `currentTime` on buffered data
  is the finer of the two in Chrome). Clamp to `[0, duration]`.
- **Verdict:** new code, small. Global 5 and 6 for 5 s, Alt+Shift+A/S for 0.5 s. Ads: a seek intent
  during an ad should be **dropped, not held**; a seek that lands two minutes later is a surprise,
  unlike a held speed. The `held` map in `content-main.js` is keyed by kind, so "seek" simply never
  enters it.

### 3.4 Frame stepping

- **Native:** `.` and `,`: "While the video is paused, skip to the next frame" / "go back to the
  previous frame". Documented as paused-only.
- **VJster:** no API for a frame. Two ways, both **untested**:
  1. Pause via the player, then dispatch a synthetic `keydown` for `.`/`,` on the document in the
     MAIN world. YouTube's own key handler may ignore untrusted events.
  2. Pause, then `currentTime += 1/fps`. The fps is not exposed by the player API; measure it with
     `requestVideoFrameCallback` (two consecutive callbacks give `presentedFrames` and `mediaTime`
     deltas), fall back to 1/30.
  Way 2 is deterministic and testable; build that, keep way 1 as a probe.
- **Verdict:** new code; the behaviour "pause first if playing" is the VJ-useful part (freeze and
  nudge). Alt+Shift+Z/X.

### 3.5 Loop in / loop out

- **Native:** none. The player's right-click menu has a whole-video "Loop", not on the Help pages I
  could reach (**unverified**), and there is no A-B loop and no key.
- **VJster:** new. Intent `loop.mark` (two-state: first call stores A = `currentTime`; second stores
  B and arms; a third call while armed re-marks A) and `loop.clear`. Implementation: a `timeupdate`
  listener (fires about four times a second) plus a `requestVideoFrameCallback` loop while armed,
  seeking to A when `currentTime >= B`. The jump lands on a keyframe boundary or the buffered frame,
  so a tight loop under about 0.5 s will stutter; that is physics, not a bug. Loop survives speed
  changes. A new video in the tab (`loadedmetadata`/`emptied`, already bound) clears it.
- **Verdict:** new code, the largest piece (about 80 lines plus tests). Global 8 and 9.

### 3.6 Jump back on beat, and tap tempo

- **Native:** none.
- **VJster:** `seek.by` with `seconds = -(60 / bpm) * count`. BPM from `tempo.tap`: keep the last
  eight tap times in the worker, BPM = 60 / mean interval, discard if the interval is over 2 s. The
  worker owns the tempo (it outlives tabs); the page only seeks. Beat jumps land where `currentTime`
  lands, so they are as accurate as 3.3.
- **Verdict:** new code, small (worker-side arithmetic plus the seek from 3.3). Global 7; count 4
  for D-pad Left is slot g.

### 3.7 Reset every effect with one button (Top)

What "every effect" means on this rig: the VJster state (speed, quality, loop) and the OBS-side
effects (Visual Sidechain's chain, later Midi Fadester's `reset_fx`).

- **VJster:** new intent `reset.all` = `speed.reset` + `quality.reset` + `loop.clear`, one call,
  one state report. Global 0.
- **OBS:** Visual Sidechain's Panic/Restore are OBS hotkeys (path C); Midi Fadester's reset is
  planned (R-FADE-5). With "Never disable hotkeys" set they land with any window focused.
- **Console macro on Top:** shortcut Ctrl+Shift+0, delay 60 ms, shortcut `<OBS panic hotkey>`.
  Macros support sequenced shortcuts with delays (manual: "keyboard shortcuts, mouse action, delay,
  text input..."). The delay keeps two global shortcuts from being seen as one chord. **Untested**
  that Console sends modifiers cleanly in a macro.
- **Verdict:** new code (one small intent) plus a Console macro that exists today.

### 3.8 Quality (bonus, already built)

`quality.step`/`quality.reset` exist. Not on a plain control in this preset because during a set
quality changes are rare; Side+Knob press returns to Auto. Add `quality.step` to the D-pad in a
later pass if wanted.

## 4. Browser focus, ads, live streams, multiple tabs

**Focus.** Path B global commands ignore focus. Path A keys need Chrome focused, the YouTube tab
active, and the caret outside any text field; the Help page also says that with the "new computer
experience" "you must click the video player before using keyboard shortcuts". Only harmless
controls use path A (Shift+N, `m`, `f`). Console's auto-switch must be off, or the preset would
change when OBS comes to the front and the global keys would stop being sent.

**Ads.** VJster "never alters, skips, mutes or speeds up advertisements" (R-BEH-1). Speed, quality
and play/pause intents are held and applied when content resumes; the strip (on a Stream Deck) says
`Ad playing`. On a TourBox you get no such notice: the control simply does nothing until the ad
ends, then does what you asked. New intents follow the same rule: seek, frame, loop, beat are
**dropped** during an ad, reset-all is held. Native keys during an ad: whatever the player allows,
**untested**.

**Live streams.** YouTube's DVR lets viewers "pause, rewind, and continue", capped around 12 hours,
and "Viewers can never seek back to before you went live"; the creator can disable DVR, in which
case nothing here can seek. The IFrame reference says `getDuration()` on a live stream returns the
elapsed time since the stream began (from the truncated tail of the page, **verify**). So:
`seek.by` works inside the DVR window; "jump to live" = `seekTo(getDuration())`, or click the
player's own Live button if that proves more exact (**untested**); loops work but B drifts
relative to the live edge; speed: the player reports `getAvailablePlaybackRates()` and VJster uses
that range (R-SPD-2), so a live stream that offers only `[1]` makes the Knob do nothing, which is
the correct silent failure. Whether YouTube offers speed on a live stream when rewound is
**untested**. Frame step on live: **untested**.

**Multiple tabs.** This is where path B beats path A outright. VJster's router (R-TGT-1..4): one
playing tab wins; several playing, the active tab of the focused window, else the most recently
started; none playing, the most recently paused. Side+Tall pins the active tab until unpinned or
closed. Native keys go to the active tab only, and a media key goes wherever Chrome's Media Session
points. Two YouTube tabs both playing in two windows is the case to try in the test.

## 5. What to build, in order

1. `manifest.json`: a `commands` block with four `suggested_key` entries (1, 2, 3, 4 above,
   `"global": true`); the rest declared without keys and assigned once at
   `chrome://extensions/shortcuts`. `background.js`: `chrome.commands.onCommand` builds the intent
   and hands it to the existing router with a no-op reply sink (the link may be down; a TourBox
   press must not depend on the Stream Deck app running). About 40 lines plus a test with a fake
   `commands` object (R-TST-3 style).
2. `shared` vocabulary: `seek.by`, `frame.step`, `loop.mark`, `loop.clear`, `tempo.tap`,
   `reset.all`, validated field by field (R-INT-3). `content-main.js`: the four page-side
   handlers. State report gains `loop: {a, b, armed} | null` and `bpm`.
3. The Console preset and the Top macro.
4. Later: deck keys for loop and beat so the Stream Deck shows state the TourBox cannot.

## 6. Five-minute hardware test

Setup once: a YouTube video with chapters open and paused in one tab; OBS running and focused
(not Chrome); the preset loaded; `chrome://extensions/shortcuts` showing the ten Ctrl+Shift keys.

| Min | Do | Pass if | Fails the design if |
|---|---|---|---|
| 0:00 | With OBS focused, press Dial | Video plays. Chrome never came to the front | Nothing: global commands do not see TourBox keystrokes. Fall back to Console auto-switch and path A, and the "by feel" goal is gone |
| 0:30 | Knob two detents right, two left, then press | Menu shows 1.5x, then 1x, then press leaves 1x (check Settings > Speed) | More or fewer than two steps: the rotary floods; Rep mode is on or the speed setting is not the slowest |
| 1:00 | Hold Side, Knob one detent right, release Side | Speed reads 1.05x (or the next grid value); nothing else happened on release | Any action on Side release: Side must stay empty and the layer moves to Tour |
| 1:30 | Dial three clicks right, then Side+Scroll two ticks left | Time moves +15 s, then -1 s (watch the time readout) | Page scrolls instead of seeking: a native arrow key got mapped by mistake |
| 2:00 | Pause (Dial press), Scroll five ticks right, five left | Frame counter (`Stats for nerds`, right-click) advances and returns; video stays paused | No change: synthetic keys are ignored and fps is unknown; fall back to a fixed 1/30 step |
| 2:30 | Tall at 0:10, Tall again at 0:14, wait 10 s, Short | Playback loops 10 to 14 twice, then runs on after Short | Loop drifts or never returns: the `timeupdate` path is too slow; use the frame callback |
| 3:15 | Tap Side+Scroll press four times at a steady pace, then Scroll press once | Time jumps back by one interval (about 0.5 s at 120 BPM) | Jump of 0 or a wild value: tap filter discards everything; log the intervals |
| 3:45 | Open a second YouTube tab in a second window, play it, press Dial from OBS | Only one video pauses, the one VJster's rule names (both playing: active tab of the focused window, else the last started). Side+Tall then pins it; Dial again toggles the pinned one | Both tabs change: a native key leaked; or neither: the router lost the window |
| 4:15 | Let an ad play (or a live stream with DVR), press Top | Nothing visible during the ad; when content resumes speed is 1x, loop gone, OBS effects off. On the live stream, Side+Short lands on the live edge | Ad skipped or sped up: a policy failure, stop and fix before anything else |
| 4:45 | Press Tour, then Tour | HUD colour changes to "Show" and back; Knob now rides music level in OBS, then speed again | Stuck in one preset: auto-switch is still on |

What this test does not cover: media keys, the Custom Section Dial pair, remapping Alt+Shift keys
to global, frame stepping on a live stream, and Console macro timing with modifiers. Each is
marked untested above and is a one-minute add-on once the core passes.

## 7. Untested and unverified, in one list

- Chrome global commands fire on TourBox-injected keystrokes.
- The `chrome://extensions/shortcuts` UI accepts a non-digit key for a global command.
- Native `<`/`>` step size (0.25 by observation; not on the Help page).
- The right-click "Loop" item (observed in the player; no Help page found).
- Synthetic `,`/`.` keydown accepted by YouTube's handler.
- `getDuration()` on a live stream = elapsed time (seen only in a summary of the API page's tail).
- Speed offered on a rewound live stream; frame step on live.
- Console: macro with two modifier shortcuts and a delay; Side's own action on release after a
  combination; Dial+Side via Custom Section; media keys as a Console shortcut.
- TourBox model on this machine: not readable from the Console log; a Lite lacks Side, Dial and
  the D-pad and cannot run this preset.

## 8. Sources

YouTube and Chrome (primary, read 2026-11-04):
- Keyboard shortcuts, exact wording for `k`, Space, `j`/`l`, arrows "on the seek bar", `,`/`.`
  "While the video is paused", `<`/`>`, 0-9, Shift+N/P, `m`, `f`, media keys, "click the video
  player before using keyboard shortcuts": https://support.google.com/youtube/answer/7631406
- Speed menu (Computer): Settings > Speed, click-and-hold 2x; no value list:
  https://support.google.com/youtube/answer/7509567?co=GENIE.Platform%3DDesktop&hl=en
- DVR on live streams, 12 h cap, "never seek back to before you went live", creator can disable:
  https://support.google.com/youtube/answer/9296823
- IFrame Player API: `setPlaybackRate` rounds toward 1, `getAvailablePlaybackRates`, `seekTo`
  keyframe note, `setLoop` (playlists only), `getDuration` on live (summary only):
  https://developers.google.com/youtube/iframe_api_reference
- Chrome `commands`: Ctrl or Alt required, no Ctrl+Alt, four suggested keys, global = works without
  focus, global suggestions limited to Ctrl+Shift+0..9, user remap at `chrome://extensions/shortcuts`,
  `onCommand`: https://developer.chrome.com/docs/extensions/reference/api/commands
- Chrome `tabs`: `audible`, `sendMessage`: https://developer.chrome.com/docs/extensions/reference/api/tabs

TourBox (primary):
- Macro commands: shortcuts, mouse, delay, text, open file/folder/URL: https://www.tourboxtech.com/en/manual/macro_commands
- Custom Section, macros on combinations: https://www.tourboxtech.com/en/news/how-to-create-custom-actions.html
- Up mode, Rep mode, speed modes: https://www.tourboxtech.com/ca/manual/how-to-customize-buttons/
- Knob/Scroll + Prime Four combinations, Dial excluded, rotation speed: https://www.tourboxtech.com/en/news/how-to-use-the-rotating-section-controls.html
- Built-in functions overview (no run-program action found): https://www.tourboxtech.com/en/news/how-to-assign-built-in-functions.html
- Presets, HUD, haptics, control inventory: see the OBS doc's source list.

Yours:
- VJster intents, router, ad hold, ranges: `C:\streamdeck-fadester\docs\vjster\REQUIREMENTS.md`
  (R-SPD-1..4, R-QLT-1..3, R-TGT-1..4, R-BEH-1..4, R-INT-2..3, F-4, F-5, F-10) and the built
  extension `C:\Users\jeffr\Documents\VJster-Chrome-extension\{manifest.json,background.js,content-main.js}`
- OBS preset, Console facts, "Never disable hotkeys": `C:\Users\jeffr\Documents\obs-playlister\docs\TOURBOX-LAYOUT.md`
