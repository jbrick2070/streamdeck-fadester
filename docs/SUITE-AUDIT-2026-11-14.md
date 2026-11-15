# Fadester Suite audit: friction, overlaps and 360° reactivity (2026-11-14)

Independent product, UX, architecture and feature audit of the four active repositories, read from source at
these commits:

| Repo | Version | Commit |
|---|---|---|
| `streamdeck-fadester` (SD) | 0.11.0 | `9d164c6` |
| `midi-fadester` (MF) | 0.6.0 | `b966bfc` |
| `visual-sidechain` (VS) | 0.6.0 | `a595426` |
| `obs-playlister` (PL) | 0.5.0 / 0.5.1 | `9d4ac00` |

**How to read this.** Every finding below was read in code or docs and carries a `repo/path:line` pointer.
Anything marked *(inferred)* is a conclusion drawn from the code, not a line that says so. Nothing here was run
against real OBS, real hardware or a real deck; section 5 lists what that leaves open. No code was changed.

---

## 1. Honest executive verdict

**The suite is in good structural shape. Most of the "sprawl" is real host constraints, not bad factoring, and
should not be merged.** Three OBS plugins, one deck plugin, one desktop app and one browser extension is the
right number of processes for what they do: Qt in-process, a Node deck plugin, a desktop process that owns
TourBox and XInput, and a browser sandbox. The contracts between them (`API-CONTRACT.md`, the in-process
bridge, "one owner per concept") are clean and are followed in code.

**What is already strong and should be left alone:** the suite launcher and settings mux, VJster's link
security and port takeover, Tape Deck's system-picked port, the whole-mix journal and its refusal to raise
levels on shutdown, Companion's readiness lights and password auto-read, the "reason sentence" pattern for
unavailable slots, and checksums on every artifact.

**The biggest genuine findings, in order:**

1. **The 3 Hz flash cap covers less than the product description implies.** It limits one uniform,
   `vs_flash_envelope`, which one built-in shader reads. All 11 built-in shaders also receive raw `audio_kick`
   and friends, the Audio Modulator has no limiter at all, and the limiter is per filter so stacked filters add
   up. The README is honest about stacking, but the cap is not "per-filter" in the sense a user would assume.
   This is the one place where the "uncompromising" non-negotiable is not yet met in code.
2. **Reactivity is produced and then dropped.** VS computes and broadcasts `signals_changed` at up to 30 Hz
   and registers an in-process proc and signal. **Nothing in the suite consumes any of them.** No surface
   subscribes; the shared vendor client discards every vendor event that is not from `midi-fadester`.
3. **There is no tempo foundation to build "on the beat" features on.** BPM is the mean of eight kick
   intervals, `beat_phase` resets on each kick, and there is no bar count, downbeat, confidence, tap tempo or
   lock. Beat phase also keeps running at a stale or default 120 BPM in silence.
4. **Panic has no truth channel.** It is reachable only by hotkey name, has no vendor request, no event and no
   state field, so the Stream Deck "PANIC SENT" latch is a local guess.
5. **Three T-bar hosts recover differently from the same failure**, with no shared written contract or test
   vectors.
6. **Whole-mix depends on a desktop app for historical reasons, not a documented one**, and its protocol has
   no provider identity.
7. **Install friction is mostly documentation and discovery**, not architecture: no landing page, no "which
   player when", one component auto-reads the OBS password and another makes you paste it, and several READMEs
   contradict the code.

**360° reactivity verdict:** the right move is small and structural, not a pile of features. Fix the cap and
the tempo foundation first, then let surfaces *display* signals and let operator-armed actions be *timed* by
them. One rule should govern every reactive feature: **audio may shape or time an action the operator armed;
audio never originates a Program change.**

---

## 2. Keep as-is (do not merge or break)

| Keep | Why |
|---|---|
| **Three separate OBS plugins** | Independent versions, independent failure. A user who wants only Playlister must not load an FFT. A single DLL would couple release risk for no user gain. A combined *installer* is fine (P1-5); a combined *binary* is not. |
| **"One owner per concept"** (`SD/API-CONTRACT.md:104-107`, `VS/REQUIREMENTS.md:107`) | MF owns slots, VS owns signals, neither re-exposes the other. Every cross-plugin recommendation below keeps this rule. |
| **Three T-bar hosts** (MF Qt in-process, SD koffi worker, Companion helper) | Each host is forced by where it runs. Consolidate the *contract*, not the code (P0-5). |
| **MF as the recommended smooth T-bar path** | It is the only one that does not need accessibility permissions, a visible window or a version gate. |
| **Suite launcher and mux** (`SD/src/suite/launcher.ts`, `mux.ts`) | Neither child plugin was changed to fit; settings merge and child restart are tested. |
| **Standalone VJster plugin** | Still needed for decks with no OBS and for saved profiles that name it. |
| **VJster extension and `/obs` page as two targets** | They solve different problems (a Chrome tab versus an OBS Browser Source) and already share one protocol with a `browser`/`obs` target. |
| **Fadester Companion as a separate desktop app** | TourBox hotkeys and XInput need a long-lived desktop process. Folding it into a deck plugin would lose both for users with no deck. |
| **Playlister driven by stock OBS media requests** (`SD/src/obs/direct-obs-client.ts:144-162`) | The Stream Deck transport key therefore works with any media source, and Playlister stays free of suite coupling. |
| **Whole-mix: single provider, journal first, never raise levels on shutdown** (`SD/tourbox/bridge/MixDesk.cs:68-76`, `MixJournal.cs:43-57`) | These semantics are correct. If the provider moves (P1-1), the semantics move with it unchanged. |
| **Tape Deck's port** (`VS/src/tubester/listener.c:233-255`) | System-picked, exclusive, loopback. No collision is possible. |
| **VJster link checks** (Origin, extension id pin, 32-hex page token) and **port-in-use takeover** | Correct and already honest on the keys. |
| **Panic and Clean as separate concepts**, Restore behind an 800 ms hold | Different owners, different scope. Do not auto-chain them; fix the wording instead (P1-7). |
| **The 10 updates/second per-cell redraw cap and "no polling"** (`SD/REQUIREMENTS.md:86,143`) | Meters must be designed inside this cap, not by lifting it (P1-3). |
| **User-facing names "Tape Deck", "Playlister", slot labels, "VJster " action prefix, "(optional)" suffix** | Already consistent. Internal `tubester_*` ids stay so saved settings survive. |

---

## 3. Prioritized recommendations and coding plan

### P0: safety and honesty (do these before any new reactive feature)

#### P0-1. Make the flash cap cover every transient path Visual Sidechain owns

- **Problem.** The limiter admits one flash per 1/rate (0.5 to 3 Hz) into `vs_flash_envelope`
  (`VS/src/core/onset.c:225-258`, `VS/src/obs/shader-filter.c:961-985`). Only
  `VS/data/shaders/fft-strobe-flash.shader:52` reads it. All 11 built-in shaders reference raw
  `audio_kick`/`audio_snare`/`audio_flux`/`audio_beat` (for example bloom brightness at
  `fft-chromatic-prism-bloom.shader:72`), bounded only by the 100 ms onset refractory, about 10 Hz. The Audio
  Modulator can drive Color Correction brightness or opacity from Kick with no cap
  (`VS/src/obs/modulator-filter.c`, no limiter present). The limiter state is per filter instance
  (`shader-filter.c:158`), so two filters can interleave to 6 Hz.
- **Proposed change.**
  1. **One process-wide flash clock.** Move the limiter state out of the filter into a shared module so all VS
     filters admit flashes from the same budget. Per-filter rate stays as a *lower* personal limit; the global
     ceiling is 3 Hz and is not configurable upward.
  2. **Publish limited transients.** Add `audio_kick_safe`, `audio_snare_safe`, `audio_flux_safe` uniforms and
     matching modulator sources, all gated by the shared clock. Raw uniforms stay for geometry (zoom, warp,
     displacement), where they are not a luminance flash.
  3. **Audit the 11 built-in shaders.** For each, every term that changes whole-frame luminance, saturation
     toward red, or inversion moves to the `_safe` signal. Geometry terms stay raw.
  4. **Modulator "Flash guard".** Per slot, on by default and forced through the shared clock when the source
     is a transient (Kick, Snare, Flux, Beat) *and* the target property is luminance-class on a known filter
     kind (brightness, contrast, gamma, opacity, color multiply/add). Turning it off is possible but labelled
     plainly and logged once.
  5. **Custom shaders.** They cannot be policed. Say so in the Properties window next to the file picker, and
     document `vs_flash_envelope` and the `_safe` uniforms as the supported path.
- **Affected.** VS: `src/core/onset.c`, `onset.h`, new `src/core/flash-clock.{c,h}`, `src/obs/shader-filter.c`,
  `src/obs/modulator-filter.c`, `src/core/modulation.{c,h}`, `src/core/shader-parse.c:70,338`, all of
  `data/shaders/*.shader`, `data/locale/*.ini`, `README.md:31`.
- **Trade-offs and risks.** Existing looks get calmer on fast material; that is the point, but it is a visible
  change and belongs in the changelog. A global clock means one busy filter can starve another's flash; admit
  in arrival order and document it. Saved settings must load unchanged (new keys default to guarded).
- **Steps and acceptance.**
  1. Headless test: two limiter clients fed a 10 Hz transient admit a combined total of at most 3 flashes in
     any 1 s window (extend `tests/test-onset.c`).
  2. Headless test: a modulator slot Kick to Color Correction `brightness` with guard on changes direction at
     most 6 times per second (3 rises, 3 falls).
  3. `tests/check-shader-locale.cmake`-style static check: no built-in shader multiplies a final colour by a raw
     transient uniform (grep rule with an allow-list for geometry).
  4. `tests/obs-shader-screenshot-selftest.ps1`: capture each built-in at a 10 Hz click track, measure mean
     frame luminance over time, assert no more than 3 luminance reversals per second.
  5. Windows: run 3 and 4 on the RTX rig. macOS: VS has no macOS build today (`build-project.yaml:77`,
     `if: false`); the headless tests still run in CI.

#### P0-2. Stop beat phase running in silence; add `audio_present` and `beat_confidence`

- **Problem.** In silence or starvation the analyzer zeroes envelopes, FFT, kick and snare but copies `beat`
  and `estimated_bpm` unconditionally (`VS/src/core/analyzer.c:241-261`). Beat phase freewheels at the last or
  default 120 BPM (`onset.c:188-191`, `onset.h:25-28`), so anything bound to Beat keeps pulsing with no music.
  The only "no audio" hint is a static sentence in Properties (`VS/src/obs/audio-tap.c:432-494`).
- **Proposed change.** After a hold time (suggest 2 s gated or starved), freeze `beat` at 0 and report
  `audio_present: false`. Add `beat_confidence` 0..1 from interval variance across the eight-interval window.
  Show a live one-line state in Properties ("Hearing audio on Track 1" / "No audio on Track 1 for 5 s") and add
  both fields to `get_signals`, `signals_changed` and the in-process proc. Fix the stale band comments at
  `analyzer.h:67-68` (code is 55-130 Hz and 250-4000 Hz, `onset.c:93-94`).
- **Affected.** VS: `src/core/analyzer.c`, `analyzer.h`, `onset.{c,h}`, `src/obs/vendor-api.c:33-61`,
  `src/core/fader-bridge.c:176-185`, `src/obs/audio-tap.c`; SD: `API-CONTRACT.md` bridge table.
- **Trade-offs.** Additive fields only; `api_version` stays 1. A breakdown with no kick will lower confidence,
  which is correct: P1-2 gives the operator tap and lock for exactly that case.
- **Acceptance.** `tests/test-analyzer.c`: 3 s of silence after a 128 BPM click yields `beat == 0`,
  `audio_present == false`; resuming restores phase within two kicks. With no audio, `signals_changed` stops
  after the hold time (the 1e-3 change gate at `fader-bridge.c:479-496` then suppresses it).

#### P0-3. Give Panic a truth channel

- **Problem.** Panic and Restore are hotkeys only (`VS/src/plugin-main.c:46-136,870-873`), reachable from
  outside through `TriggerHotkeyByName`. There is no request, event or field, so
  `SD/src/control/visual-safety.ts:8-17` keeps a local latch it calls "a display aid". After an OBS restart, a
  second deck, or a hotkey press on the keyboard, the key can show the wrong state.
- **Proposed change.** Add vendor requests `panic`, `restore`, `get_safety` and event `safety_changed`
  `{ panic: bool, since_ms }`; add `panic` to `get_signals`. The Stream Deck key reads real state when VS
  0.7+ answers and falls back to today's hotkey-plus-latch for older builds. Press still sends Panic every
  time; Restore keeps its hold.
- **Affected.** VS: `src/obs/vendor-api.c:167-168`, `src/plugin-main.c`; SD:
  `packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.ts:651` (accept a second vendor name),
  `src/control/visual-safety.ts`, `src/actions/visual-panic-key.ts`, `tourbox/bridge` Panic action.
- **Trade-offs.** None for safety: the hotkey path stays as the fallback and as the keyboard route.
- **Acceptance.** Headless vendor test for each request. Live: press Panic on the keyboard, the Stream Deck key
  shows Panic within one event; restart the deck plugin mid-Panic, the key comes back showing Panic.

#### P0-4. Document the whole-mix protocol in the contract and add provider identity

- **Problem.** `API-CONTRACT.md` never mentions `io.github.jbrick2070.fadester.mix.v1`; it lives only in
  `SD/docs/ADD-YOUR-OWN-CONTROLLER.md:51-93`. Replies carry no provider id and the client takes the first reply
  per request id (`SD/src/obs/whole-mix.ts:77,85`). Single ownership is enforced only by a local mutex
  (`SD/tourbox/bridge/Program.cs:96-97`), so a second provider on another machine, or a future native one, would
  see the other's writes as manual edits and release inputs (`MixDesk.cs:36-56`).
- **Proposed change.** Add a contract section for the mix protocol. Add `provider: { id, name, version }` to
  every reply (additive). Clients pin the first provider they hear for the session and show
  "Two mix providers are answering" instead of acting if a different id replies.
- **Affected.** SD: `API-CONTRACT.md`, `docs/ADD-YOUR-OWN-CONTROLLER.md`, `src/obs/whole-mix.ts`,
  `tourbox/bridge/MixProtocolServer.cs:47-69`, `tourbox/macos/bridge`; MF: `src/obs/mfd-vendor-api.c:30-72`.
- **Acceptance.** Unit test in `whole-mix` for a second provider id. Bridge self-test asserts the field.

#### P0-5. One written T-bar safety contract with shared test vectors

- **Problem.** The same mid-fade failure ends three ways. SD re-reads, releases near a rail and finally falls
  back to an automatic Studio Mode toggle take (`SD/src/obs/direct-obs-client.ts:1339-1445`). Companion latches
  `needsReset` and asks the operator to press Cancel or drag the bar (`SD/tourbox/bridge/StudioFader.cs:313-314,
  433`). On reconnect SD adopts an open fade (`direct-obs-client.ts:1074`) and Companion cancels to Program
  (`StudioFader.cs:79-105`). The rail thresholds 921/102 are re-declared per implementation
  (`direct-obs-client.ts:45-46`, `MF/src/core/tbar-logic.h:17-23`). The OBS version gate also differs: SD accepts
  33.x (`SD/src/obs/native-tbar.ts:71-76`), Companion only 33.0.0 and 33.0.1 (`StudioFader.cs:234,373`).
- **Proposed change.** Do **not** merge the code. Write `docs/TBAR-SAFETY-CONTRACT.md` stating: release at most
  once per throw, the rail thresholds, refusal versus uncertain-write handling, never replay a write, reconnect
  policy, and the recovery ladder. Add `tests/vectors/tbar-safety.json` and have each implementation's tests
  load it. Then decide, deliberately, whether Companion adopts SD's automatic finish. My recommendation: yes,
  because "press Cancel or drag the bar" during a show is the weaker guarantee against a locked Transition
  button. Align the version gate by decision and record the reason either way.
- **Affected.** SD: `src/obs/direct-obs-client.ts`, `src/obs/native-tbar.ts`, `tourbox/bridge/StudioFader.cs`,
  `tourbox/bridge/NativeTBar.cs`, `tourbox/macos/native/AXSlider.swift`; MF: `src/core/tbar-logic.{c,h}`,
  `tests/test-tbar-logic.c`.
- **Risks.** Changing Companion's recovery is a behaviour change on hardware; it needs a rehearsal on Windows
  and on the Mac, where full endpoints are still unverified (`tourbox/macos/native/README.md`).
- **Acceptance.** All three test suites pass the same vectors. Live on both OSes: kill the helper mid-throw at
  30%, 60% and 95%; OBS's Transition button is usable again within 2 s with no operator action.

#### P0-6. Documentation truth pass (small, same week)

Verified contradictions to fix:

- `MF/README.md:49,271` say Windows only; `src/midi/coremidi-device.c` and the macOS CI job exist.
- `VS/README.md:40` says 0.6.0 is shared with Fadester for OBS, which is 0.11.0.
- `SD/demo-kit/README.md:7-8,49-50` says there is no public release and asks for Fadester 0.7.7, Stream Deck 7.1.
- `SD/docs/vjster/INSTALL.md:5` and `SD/tourbox/README.md:80` say Companion cannot drive the OBS page;
  `SD/tourbox/bridge/VjsterLink.cs:3,67` serves `/obs`.
- `SD/docs/vjster/INSTALL.md:20` says Windows only; the manifest declares macOS 13.5.
- `SD/PUBLISHING.md:9-11` still describes three Windows-only plugins.
- `MF/README.md:146` calls Clean "the panic button"; `VS/README.md:95` says they are separate.
- `SD/README.md:49` describes white-flash behaviour the Unreleased changelog says is gone on Windows.
- `MF/src/obs/mfd-vendor-api.c:339` calls proc `visual_sidechain_set_fader_slot`, which VS never registers.
  Remove the dead call (P2-1 replaces it with the correct direction).
- `PL/buildspec.json` macOS `bundleId` is still upstream's `com.codeyan.media-playlist-source`.

---

### P1: friction reduction and the reactivity foundation

#### P1-1. Whole-mix: add a native provider inside Midi Fadester; Companion stays the provider when MF is absent

- **Answer to "why does it need Companion?"** No document argues the placement. It began as a TourBox chord in
  an app that already had a long-lived authenticated connection and a config folder; `--mix-only` was added
  later for everyone else *(inferred from history; `SD/PLAN.md` has no whole-mix section and
  `ADD-YOUR-OWN-CONTROLLER.md:129` states the rule with no reason)*.
- **Should it live in the Stream Deck plugin? No.** The plugin lives only while the deck software runs, OpenDeck
  or a second deck creates multiple instances, and it would need its own crash journal.
- **Should it live in Midi Fadester? Yes, as an addition.** MF is always loaded when installed, already calls
  `obs_source_set_volume` for audio slots and already has persisted crash recovery. Today an MF user's own
  Master fader shows "Needs Fadester Companion" (`MF/src/obs/mfd-engine.c:540-566`), which is the most awkward
  dependency in the suite.
- **Proposed change.** Port `MixDesk` semantics to MF unchanged (journal before write, release an input on any
  outside edit, never raise on shutdown, late-joiner watcher). Because an in-process plugin cannot receive
  `BroadcastCustomEvent`, expose it as vendor request `mix` on `midi-fadester` and advertise
  `capabilities.mix_provider: true` in `get_state`. Stream Deck: call the vendor request when the capability is
  present, otherwise broadcast as today. Companion: on connect, if MF advertises the capability, stand down and
  forward its own TourBox and gamepad mix controls to MF. Depends on P0-4 (provider identity).
- **Zero feature loss.** Stream Deck-only users with no MF keep `--mix-only` exactly as now.
- **Affected.** MF: new `src/core/mix-provider.{c,h}`, `src/obs/mfd-engine.c`, `src/obs/mfd-vendor-api.c`;
  SD: `src/obs/whole-mix.ts`, `tourbox/bridge/MixDesk.cs`, `MixProtocolServer.cs`, `Program.cs`,
  `tourbox/macos/bridge`; `API-CONTRACT.md`.
- **Risks.** Two journals for one scene collection if a user moves between providers mid-fade. Rule: a provider
  that finds the other's unfinished journal refuses and says which program must finish or restore it.
- **Acceptance.** MF headless test with a fake source list covering baseline, outside edit, crash and reload.
  Live on Windows and macOS: MF only, Master fader fades and restores the whole mix with no Companion running;
  start Companion, it reports "Midi Fadester owns the whole mix"; kill OBS mid-fade, relaunch, levels are offered
  for restore and never raised silently.

#### P1-2. Tempo foundation in Visual Sidechain: tap, lock, bar counter

- **Problem.** Every "on the beat" idea in `SD/IDEAS.md` and `SD/PLAN.md:249-260` needs a downbeat and a tempo
  the operator can trust. The estimator will be wrong on breakdowns, half-time and non-four-on-the-floor
  material, by design.
- **Proposed change.** Vendor requests `tap_tempo`, `set_bpm {bpm}`, `lock_bpm {locked}`, `resync_downbeat`
  (this press is beat 1), matching hotkeys, and signals `beat_index` (0..3), `bar_phase` (0..1), `bar_index`,
  `bpm_locked`. When locked, kicks correct phase only within a small window and never change tempo.
- **Affected.** VS: `src/core/onset.{c,h}`, new `src/core/tempo.{c,h}`, `src/obs/vendor-api.c`,
  `src/plugin-main.c`, `src/core/fader-bridge.c`; SD: `API-CONTRACT.md`.
- **Risks.** Low. Purely additive state; defaults reproduce today's behaviour.
- **Acceptance.** `tests/test-onset.c`: four taps at 500 ms give 120 BPM within 1; with lock on, a 4 s kickless
  gap leaves `bar_phase` continuous; `resync_downbeat` sets `beat_index` to 0 on the next event.

#### P1-3. Surfaces subscribe to signals: honest meters inside the 10 Hz cap

- **Problem.** No surface shows whether Visual Sidechain is hearing anything, what tempo it believes, or that
  Panic is on. Signals are broadcast to nobody.
- **Proposed change.**
  - Shared client accepts a list of vendor names (`obs-vendor-client.ts:651`).
  - New Stream Deck action **Visual Sidechain Meter** (key, dial and Neo info bar forms): BPM number with a lock
    mark, a beat dot stepped from `beat_index`, four bars for sub-bass/bass/mid/high, and plain states
    "NO AUDIO", "PANIC", "NOT LOADED". Stream Deck + touch strip gets the 32-band spectrum.
  - Companion panel: the same line in its HUD (`SD/tourbox/panel/FadesterTourBox.cs:236`).
  - Tap, lock and resync as key actions on the same action (P1-2).
- **Design rule.** At 10 redraws a second a 65 ms kick will alias, so **draw smoothed envelopes and the
  locally interpolated beat counter, never raw kick**. Do not lift the cap. Key-face pulses stay gentle: one
  step per beat, low contrast.
- **Affected.** SD: `packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.ts`, new
  `src/actions/visual-meter.ts`, `src/gfx/svg-renderer.ts`, `src/actions/obs-neo-infobar.ts`, manifest, 9
  locales, `scripts/build-profiles.ts`, `suite-plugin` assembly, `tourbox/panel`, `tourbox/bridge`.
- **Risks.** Deck USB throughput at sustained 10 Hz on several cells is untested; ship with a per-action rate
  choice (2, 5, 10 per second) and default 5.
- **Acceptance.** Unit tests with a fake event stream for each state. Live on Stream Deck +, Mini, Neo and
  OpenDeck on Windows and macOS: meter tracks a click track; unplug audio, "NO AUDIO" within 3 s; CPU of the
  plugin process stays under an agreed budget with four meter cells showing.

#### P1-4. Quantized, operator-armed actions ("fade on the one")

- **Problem.** `auto_fade` takes a fixed `ms` (`SD/src/actions/auto-fade-key.ts:125-129,163-169`); a scene fade
  cannot land on the music.
- **Proposed change.** On Auto-fade, OBS Fade and Scene & Transition keys add **Length**: milliseconds or
  1/2/4/8/16 beats, and **Start**: now, next beat or next bar. The surface computes `ms` from VS tempo and
  sends the existing request; no contract change in MF. While waiting, the key shows "ARMED" and a second press
  fires now. A third hold cancels.
- **Deterministic rules (non-negotiable).**
  - A press always results in the action, or in a visible cancel. Never a silent wait.
  - If VS is missing, `audio_present` is false, or confidence is low and tempo is not locked, fire immediately
    with the configured millisecond fallback and show "NO TEMPO".
  - Maximum wait is one bar, capped at 4 s.
  - Nothing here starts without a key press. Audio never originates a Program change.
- **Affected.** SD: `src/actions/auto-fade-key.ts`, `obs-fade-key.ts`, `obs-scene-transition-key.ts`,
  `src/types/settings.ts`, PI pages, locales; Companion: `tourbox/bridge/DeskActions.cs` take actions.
- **Acceptance.** Unit tests for every fallback branch with a fake clock. Live: at 120 BPM locked, a 4-beat fade
  measures 2000 ms within one video frame and starts within 40 ms of the bar.

#### P1-5. One guided setup pass

- **Problems, all verified.** No suite landing page; install steps are spread over six READMEs. The Stream Deck
  plugin makes the user paste the obs-websocket password (`SD/README.md:16-18`) while Companion reads it from
  OBS's own config (`SD/tourbox/bridge/BridgeConfig.cs:97-110`). No minimum-version check exists for a too-old
  OBS plugin: "Needs Playlister 0.5" is prose and the key shows a generic "missing"
  (`SD/src/actions/playlister-transport-key.ts:219`). Three Windows installers are unsigned. Three programs
  default to VJster port 48150 and the advice is "keep only one" (`SD/docs/SUITE.md:10`).
- **Proposed change.**
  1. **`docs/START-HERE.md`**, linked first from all four READMEs: a "what you need for X" table (I have a
     Stream Deck / a MIDI desk / a TourBox / a gamepad / nothing), the "which player when" table from P1-6, and
     a compatibility matrix of minimum versions.
  2. **"Use OBS's saved password" button** in the Stream Deck settings page, reading
     `plugin_config/obs-websocket/config.json` on Windows and macOS when OBS is local. A button, not silent:
     the user sees what was read and from where. Extract the reader into the shared package so SD and both
     Companions use one implementation.
  3. **Setup checklist in the settings page**, mirroring Companion's readiness lights: OBS reachable, password
     accepted, OBS version, Studio Mode, Fade selected, OBS not elevated, window not minimised, macOS
     Accessibility granted to this host app, each OBS plugin present with version against the matrix, and who
     holds the VJster port. Each failing line carries its one-sentence fix.
  4. **Minimum-version gates** using `get_state.version` (MF) and `get_signals.version` (VS). Playlister has no
     vendor API; detect by input kind and say "version unknown" rather than guess (optional `get_info` in P2-5).
  5. **Name the VJster port holder.** Add a tiny loopback `GET /whoami` to the link server in all three hosts so
     "PORT IN USE" becomes "VJster link is held by Fadester Companion. Close it or turn off VJster there."
  6. **One combined OBS plugin installer for Windows**, already proposed in `SD/PUBLISHING.md:13`: one Inno
     setup with three checkboxes, each plugin keeping its own version and its own separate installer. Sign it;
     one signed installer means one prompt instead of three. Signing cost and eligibility are not something I
     verified.
- **Affected.** SD: `docs/`, `README.md`, `src/pi/`, `io...sdPlugin/ui`, shared package,
  `src/vjster/plugin/link-server.ts`, `tourbox/bridge/VjsterLink.cs`, `tourbox/macos`; all three OBS plugin
  READMEs; a new `suite-installer/` (location is the owner's choice).
- **Risks.** Reading OBS's config file touches a stored password: local only, on request only, never logged,
  never sent to the settings page as text (`passwordSet` only, as today). macOS Keychain persistence is still
  failing with -25293 (`SD/docs/CROSS-PLATFORM-CANDIDATE.md:39`); do not claim it until it passes.
- **Acceptance.** Fresh Windows and macOS user accounts: from the landing page to a working fade in one pass,
  with no step that requires reading a second document. Each checklist line has a test that forces its failure.

#### P1-6. Make the four video players obvious, and give Tape Deck a first-class control

- **Finding.** The split itself is sound; the explanation is missing. There is no decision table anywhere, and
  Tape Deck has no dedicated action on any surface: a search of all of SD for "tubester", "tape deck" and
  `get_decks` returns nothing. The only route is a hand-built OBS Filter binding documented at `VS/README.md:83`.

| Player | Plays | Speed | Speed change | Pick it when |
|---|---|---|---|---|
| VJster, Chrome tab | YouTube in Chrome | 0.25 to 2x (0.1 to 16x extended) | live | You are capturing a browser window and want quality control |
| VJster, OBS page | One YouTube video or playlist as a Browser Source | 0.25 to 2x | live | You want YouTube inside OBS with no Chrome window |
| Tape Deck | Local or network video file on a Browser Source | 25 to 800% | live, with optional tape pitch | You want to scratch or ride the speed of one clip |
| Playlister | Files, folders, playlists, URLs through Media Source | 1 to 200%, a setting | restarts the clip | You want a running order that survives edits |

- **Proposed change.** Put that table in `START-HERE.md` and each README. Add vendor requests to VS:
  `deck_command { deck, op: play_pause | cue | speed_set | speed_step | normal }` and event `decks_changed`, so
  surfaces stop depending on hotkey names. Add a Stream Deck **Tape Deck** action (dial and key) and matching
  Companion media controls, removing the deferral at `VS/docs/tubester/PLAN.md:245`. Show speed everywhere as
  both forms, "150% (1.5x)". Playlister's restart-on-speed-change stays, but its label says so.
- **Not recommended.** Folding Tape Deck into the VJster target abstraction. VJster's child process has no OBS
  connection and the units and capabilities differ; the coupling would cost more than a small dedicated action.
- **Affected.** VS: `src/obs/vendor-api.c:168`, `src/tubester/deck-filter.c:554-558,911-917`; SD: new
  `src/actions/tape-deck-control.ts`, manifest, locales, profiles, `tourbox/bridge/DeskActions.cs`; PL:
  `data/locale`, `README.md`.
- **Acceptance.** Headless vendor tests; live: a dial rides Tape Deck speed with the readout matching the filter
  window on Windows; action shows "Visual Sidechain is not loaded" when absent.

#### P1-7. Glossary and naming pass (wording only, no id changes)

| Confusion (verified) | Fix |
|---|---|
| "Companion" means three things: MF calls the Stream Deck plugin "Stream Deck companion" (`MF/data/locale/en-US.ini:224,237-238`), the same file says "Fadester Companion app" (`:376-384`), and the controller guide names Bitfocus Companion | Reserve "Fadester Companion" for the desktop app. Call the deck plugin "Fadester for OBS" everywhere. |
| Fadester Companion has six names (`Fadester for TourBox.exe`, "the Fadester panel", `FadesterTourBoxBridge`, ...) though it also serves gamepads and mix-only users | One user-facing name. Rename the executable at the next Store update; keep the old name as a shim for saved shortcuts. |
| The deck plugin is "Fadester for OBS", "Stream Deck Fadester" (`VS/data/locale/en-US.ini:88,90,137,141,148,210`) and bare "Fadester" | "Fadester for OBS" only. |
| Whole mix: "All OBS mixer inputs", "Whole mix", "Mix master", "Fadester mix master", and MF's unrelated "Master" strip | "Whole mix" as the concept; "All OBS mixer inputs" stays as the picker option that selects it. |
| "Restore" means undo Panic, restore mix, and music duck restore | Always qualify: "Restore visuals", "Restore mix". |
| Clean has seven spellings in `SD` `en.json` | "Clean FX" on keys, "Clean / All FX Off" in long text. |
| Two layers: "Left / Right", "A/B", "Layer A / Layer B", "Layer 1 / Layer 2", LIVE / NEXT | "Layer 1 / Layer 2" for sources; Program / Preview for scenes, as OBS says. |
| "Cue" means seek to start (Tape Deck) and put in Preview (Companion) | "Cue to start" versus "Preview". |

All of this is locale text across 9 to 12 languages per component; plan it as one coordinated change with the
existing locale key checks.

#### P1-8. Layer opacity: one owner per source

- **Problem.** MF uses a hidden `__midi_fadester_opacity__` filter (`MF/src/obs/mfd-layer-filter.h:15-16,32`);
  Companion finds or creates a Color Correction filter named "Fadester opacity"
  (`SD/tourbox/bridge/DeskActions.cs:199-226`). On one source they multiply, and MF's catalog hides its filter
  (`API-CONTRACT.md:21`), so nothing can explain why a layer is dim. A Stream Deck OBS Filter dial and Companion
  can also write the same Color Correction opacity, last write wins.
- **Proposed change.** When MF is loaded and has a `layer_opacity` slot on that source, Companion drives that
  slot through `set_fader_value` instead of adding a filter. Otherwise it behaves as today. Define "Layer 1" and
  "Layer 2" and the opacity owner once, in `API-CONTRACT.md`. Add `has_internal_opacity` to the catalog's layer
  entries so surfaces can say "Opacity is owned by Midi Fadester FX 3".
- **Acceptance.** Bridge self-test for both branches; live: with both present, layer opacity reaches exactly
  100% and 0% from either surface.

---

### P2: cross-plugin reactivity and polish (after P0 and P1 are rehearsed)

#### P2-1. Global reactivity through Midi Fadester slots, not through a new router

- **Gap.** The Audio Modulator reaches sibling filters on one source only
  (`VS/src/obs/modulator-filter.c:50-59,1315-1318`). Audio cannot reach another source, a scene item or a layer.
- **Proposed change.** MF slots already reach any source: layer opacity, any numeric filter setting, volume.
  Add a per-slot **Signal** input in MF: source signal, depth, polarity, attack and release. MF *reads* signals
  through the existing `visual_sidechain_get_signals` proc and signal; VS still never writes a slot, so "one
  owner per concept" holds. The signal is an **offset on top of the hardware value**, so the physical fader
  keeps its base and soft takeover never fights it.
- **Hard limits.** Not available on `tbar` targets, ever. Luminance-class targets take only the `_safe`
  transients from P0-1. Panic zeroes every signal depth in MF as well; this is the one place Panic should reach
  across plugins, because the motion is audio-driven.
- **Verdict.** Genuinely useful for live work: kick ducks layer 2 opacity, bass opens a blur on another camera.
- **Affected.** MF: `src/obs/mfd-engine.c`, `src/core/` slot model, `src/ui/`, `src/obs/mfd-vendor-api.c`
  (`set_slot` fields, additive); `API-CONTRACT.md`.

#### P2-2. Playlister "advance on the bar" (operator-armed)

- Already contemplated and deferred at `PL/REQUIREMENTS.md:231`. One checkbox per source, with a key to arm and
  disarm it: advance every N bars while armed and showing.
- **Limits.** Minimum dwell of one bar and never under 1 s (fast hard cuts are flashes too). If tempo is not
  locked and confidence is low, hold the current clip and say so. It changes a clip inside one source; it never
  changes scene or Program. Reads the in-process signal only; no vendor API needed.
- **Verdict.** Useful for folders of loops. Keep it one checkbox.

#### P2-3. Modulator ergonomics

- Per-slot attack and release with three presets (Punchy, Smooth, Swell); today they are per-filter analysis
  settings only (`VS/src/core/analyzer.h:89-90`).
- "Starter rig" presets that add a shader filter and a modulator with guarded defaults in one click. The demo
  kit covers part of this for scenes; nothing does for a user's own source.

#### P2-4. MIDI out feedback

- Already Phase 5 (`MF/REQUIREMENTS.md:95,129`). When it lands: knob rings follow slot values, and a pad row
  counts beats from P1-2. LEDs are small and are not a photosensitivity concern, but keep the pad counter to one
  step per beat.

#### P2-5. Smaller items

- Opt-in "Check for updates" button in the settings page and Companion (a button, never a background call;
  update `docs/PRIVACY.md`). Nothing outside the two stores tells a user anything is stale today.
- A prebuilt OpenDeck layout installer so users do not need system Node 24 and a source build
  (`SD/docs/OPENDECK.md:9,17-25`).
- Optional Playlister `get_info` vendor request so surfaces can read its version.
- Stream Deck key that offers to open Fadester Companion when the whole mix shows "Companion offline" (only
  still relevant for users without MF after P1-1). I did not check whether Companion registers a launch protocol.
- Enable macOS CI for VS and PL only when a real port exists; today both are `if: false`.

### Considered and not recommended

| Idea | Why not |
|---|---|
| Audio-triggered scene or Program switches | Violates the deterministic-show rule. A missed or doubled kick becomes a stray cut on air. |
| Envelope- or kick-driven Tape Deck speed | Audible pitch wobble and visible judder; reads as a fault, not an effect. A static "match clip tempo to BPM" ratio is the only sane version and is niche. |
| Audio-driven VJster/YouTube speed | Playback rate moves on a 0.05 grid and re-buffers; network-dependent. |
| VS writing Midi Fadester slots directly | Breaks slot ownership and keeps the physical fader in "waiting" forever. P2-1 gets the same result the right way round. |
| Raising the 10 Hz cell cap for "real" kick flashes on keys | Aliasing and USB load for no information gain; the smoothed bars and beat counter carry more. |
| Merging the three OBS plugins or the T-bar implementations into one codebase | More coupling and more permissions for no user-visible benefit. |
| Whole-mix provider inside the Stream Deck plugin | Wrong lifetime, multiple instances, no durable journal. |

---

## 4. Files needed

None. All four repositories were read directly at the commits above.

## 5. What this audit did not verify

- **Nothing was executed.** No OBS, no deck, no TourBox, no MIDI desk, no macOS machine. Every acceptance test
  above is still to be run.
- **Stream Deck device throughput** at a sustained 10 redraws a second across several cells is untested.
- **Whether a MIDI device loss aborts an open T-bar throw in Midi Fadester** was not confirmed; a search found
  no such abort.
- **Playlister's serialisation of an external Next** was taken from `PL/PLAN.md:180`, not traced in code.
- **The suite launcher's child ports** are assumed ephemeral; the bind call was not read.
- **Non-English locale files**, `tourbox/presets/map.json`, the full `DECK-LAYOUTS.md` and most of
  `tourbox/macos` were not opened.
- **Per-shader luminance behaviour** was inferred from which uniforms each shader references, not measured.
  P0-1 step 4 is the measurement.
- **Code-signing cost and eligibility** for the Windows installers were not researched.
