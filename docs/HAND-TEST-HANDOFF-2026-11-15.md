# Hand-test handoff (2026-11-15)

For the agent at the owner's desk: the Windows PC first, the Mac later. This file replaces instructions that
lived only in a chat. Read it in full, then start at section 3.

**Why this session exists.** The release candidates pass their headless tests and their Windows and macOS CI.
Nobody has yet tried them with real OBS, a deck, a TourBox, a game controller or a MIDI desk. This session does
that, one physical action at a time, and decides which releases may be published.

To start, the owner says:

> Read `docs/HAND-TEST-HANDOFF-2026-11-15.md` in the streamdeck-fadester repo and follow it. I'm at the desk.

---

## 1. Where things stand

Checked on GitHub at 2026-11-15 18:41 UTC.

| Repo | Release candidate | Release state | Last published |
|---|---|---|---|
| `streamdeck-fadester` (Fadester for OBS; Fadester Companion 0.1.4) | tag `v0.12.0`, `main` `de9c0cc` | draft | `v0.11.0` |
| `midi-fadester` | tag `0.7.0`, `main` `4f242a1` | draft | `0.6.0` |
| `visual-sidechain` | tag `0.7.0`, `main` `b0f79bd` | draft | `0.6.0` |
| `obs-playlister` | tag `0.5.1`, `main` `5f00ff9` | draft | `0.5.0` |

- **In these candidates:** audit items P0-1 to P0-6, owner decisions DEC-1 to DEC-4, P1-2 to P1-8, the
  Companion Windows and Mac parity pass, and the suite installer. The audit is
  [SUITE-AUDIT-2026-11-14.md](SUITE-AUDIT-2026-11-14.md).
- **Not started:** P1-1 (a whole-mix provider inside Midi Fadester) and every P2 item.
- **`release/suite-pins`** is one commit ahead of `main`. It pins the suite installer to the new versions and
  waits until the four releases are published.
- **Reported by the earlier desk agent, not seen by the author of this file:**
  - `C:\fadester\release-drafts\` holds `run-three-installers-admin.cmd`, `run-three-installers.ps1`,
    `run-all-checks.ps1`, and the Microsoft Store and Elgato listing drafts.
  - A portable OBS 33 carries the release-candidate plugins (it was called `obs33-portable-0.7.0`).
  - A kit may already exist in `C:\fadester\hand-test-kit\` if the preparation in section 4 was run.

  Look at what is really there before you build or trust anything.

## 2. Rules for this session

- **Nothing is published.** All four releases stay drafts. No uploads to the Microsoft Store or Elgato, no
  tags, no change to the suite pins. Publishing needs the owner to say "go" after the results are in.
- **The code is frozen.** The tagged commits are the release candidates. If a check finds a defect, write it
  up with evidence and stop on that line. The owner decides whether to re-cut.
- **Nothing elevated by the agent.** Only the owner's own click runs an installer.
- **The owner's everyday setup is not touched.** Use a separate OBS profile and scene collection and a
  separate Stream Deck profile, all named "Fadester hand test". Put the everyday OBS settings back byte for
  byte after any run against installed OBS.
- **Flash safety.** Measure the flash cap by machine before the owner looks at anything. Never ask the owner
  to watch a test whose failure would be a fast flash until that measurement has passed.
- **No show is running.** Refuse to start while OBS is streaming, recording or has the virtual camera on.
- **Read before you state.** Every instruction and expected result comes from the code at the tags. Section 5
  names the file for each line. If the code and this file disagree, the code wins: say so.
- **Honest results.** Nothing counts as verified on hardware until the owner has done it. Say "measured",
  "seen by the owner" or "not tested" for every line.
- **Wording.** Call stand-in values "placeholder" or "test", nothing else. No curse words. Keep messages to
  the owner short: one instruction at a time.

## 3. Start here

1. **Look.** Check `C:\fadester\hand-test-kit\` and `C:\fadester\release-drafts\`. Tell the owner in a few
   lines what exists and what is missing from section 4.
2. **Fill the gaps that block tonight.** Items 1 to 7 of section 4. Build only what is missing.
3. **Roll call** (section 4, item 6). Fix or note anything it finds before the first hardware line.
4. **Walk the run sheet** (section 5) in order, one line at a time: give one instruction, the owner does it
   and answers, you record the measured result and move on. If a line fails, save the logs, say which release
   it blocks, and carry on with the next line.
5. **Record and report** (section 6).

**Use the portable OBS for lines A to I.** It keeps the candidates out of the owner's everyday OBS until they
have passed. The installers are line J, last. If the owner would rather install first, that is their call:
make sure the rollback kit (section 4, item 7) exists before they click.

## 4. Preparation (skip whatever already exists and checks out)

Needed before the first hardware line:

1. **Run sheet.** One page from section 5: one physical action per line, the expected result in one sentence,
   and the release a failure blocks. Mark lines your automated checks already cover.
2. **Test rig.** A separate OBS profile and scene collection with:
   - two unmistakable scenes for the T-bar;
   - a source carrying each built-in shader, and an Audio Modulator driving Color Correction brightness;
   - a Tape Deck clip, a Playlister folder, and Layer 1 and Layer 2 sources;
   - three audio inputs at different levels;
   - `visual-sidechain/tests/fixtures/kick-120bpm-4bars.wav` and `silence-and-dc.wav`, plus a 10 Hz click you
     generate;
   - the Panic, Restore, Tap, Lock and Resync hotkeys bound in this profile only (`visual_sidechain_panic`,
     `visual_sidechain_restore`, `visual_sidechain_tap_tempo`, `visual_sidechain_lock_bpm`,
     `visual_sidechain_resync_downbeat`).

   `demo-kit/` builds a scene collection and may be the faster start.
3. **Deck page.** One Stream Deck + profile with the controls in run-sheet order, generated the way
   `scripts/build-profiles.ts` does, ready for the owner to double-click.
4. **Watcher.** A script that listens to OBS during the session and writes one timestamped line per event:
   transition start, end and length; how long a manual transition stayed open; Program and Preview; Studio
   Mode toggles; `safety_changed`; tempo and bar phase when a fade starts; whole-mix replies; Midi Fadester
   device state. Each run-sheet line gets a measured result from it. Extend `run-all-checks.ps1` if it exists.
5. **Faults.** Where a line needs a fault, script it to fire when the watcher sees the T-bar cross the target
   position: stop Fadester Companion's native slider helper, or minimise OBS's window. The owner only moves
   the control. Unplugging the MIDI desk stays the owner's job.
6. **Roll call.** One table, printed first:
   - which decks, the game controller, the MIDI desk and the TourBox are detected;
   - the versions actually loaded: Fadester for OBS, the three OBS plugins, Fadester Companion;
   - whether the Microsoft Store edition of Fadester Companion is installed (it must be closed while 0.1.4
     runs: two copies fight over the OBS connection and VJster port 48150);
   - whether Smart App Control or SmartScreen will block the unsigned installers;
   - that OBS is not streaming, recording or running the virtual camera.
7. **Rollback.** Before any installer runs:
   - copy the three current plugin folders from `C:\ProgramData\obs-studio\plugins`;
   - download the published `0.6.0`, `0.6.0` and `0.5.0` installers and the `v0.11.0` deck plugin;
   - check them against the SHA-256 values in `installer/components.json` on `main`, which still pins those
     versions;
   - write a one-click `rollback-admin.cmd`, and tell the owner what is installed now.

After items 1 to 7:

8. **Mac kit.** One folder to copy to the Mac: the macOS files from the draft releases and the latest CI run,
   and a one-page Mac run sheet (section 7). Say which Mac pieces can only be built on the Mac.
9. **Go / no-go sheet.** One page mapping each run-sheet line to the release it blocks, and the publish order
   for when the owner says go: the three OBS plugins, then Fadester for OBS, then the suite pins, then the
   Store and Elgato. Run none of it.
10. **Elgato shots.** A shot list for the three hardware photos, the deck page each needs, and two or three
    1920x960 thumbnail candidates from the existing artwork.

## 5. Run sheet

Do the lines in this order. "Truth" is where the expected result is defined: read it before giving the line.
SD is this repo, MF is `midi-fadester`, VS is `visual-sidechain`.

### A. The T-bar never locks (first, always)

Truth: [TBAR-SAFETY-CONTRACT.md](TBAR-SAFETY-CONTRACT.md), `tests/vectors/tbar-safety.json`,
`src/obs/direct-obs-client.ts` (`TBAR_RAIL = 0.03`), `tourbox/bridge/StudioFader.cs` (`RailZone`),
`tourbox/bridge/Gamepad.cs` (`PadTbar`). OBS is in Studio Mode with Fade selected and its window visible.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| A1 | Stream Deck + T-bar dial: turn to about half, then back to rest. | OBS's own T-bar handle follows. At rest, Program is unchanged and OBS's Transition button works. | Fadester for OBS 0.12.0 |
| A2 | Turn right to the end, and keep turning. | It takes once in the last 3%. The rest of the spin does nothing. | Fadester for OBS 0.12.0 |
| A3 | Throw to about 10%. The agent minimises OBS. Turn once more. Repeat at about 49%. | Within 2 seconds the Transition button works, Program is the starting scene, and Preview is still the cued scene. | Fadester for OBS 0.12.0 |
| A4 | The same at about 50% and about 90%. | Within 2 seconds the fade finishes: Program is the scene that was in Preview. | Fadester for OBS 0.12.0 |
| A5 | Throw to about 30%. Turn OBS's WebSocket server off and on. Turn the dial. | The dial picks the open fade up, or closes it by the same half rule. The Transition button is never left locked. | Fadester for OBS 0.12.0 |
| A6 | Fadester Companion with the TourBox: step forward to the end; step back from part-way; one fine step from rest; one step back at rest. | A forward step landing at 97% or more takes. A step back from an open fade landing at 3% or less returns to Program. A fine step from rest opens a fade. A step back at rest does nothing. | Fadester Companion 0.1.4 |
| A7 | Game controller trigger: one slow full pull; then three part pulls, each let go. | A full pull takes once. Letting go early returns to Program. It feels as it did in 0.1.3. | Fadester Companion 0.1.4 |
| A8 | Companion fade to about 30%. The agent stops the native slider helper. One more step. Repeat at about 70%. | It closes by the half rule within 2 seconds, with no Cancel press. | Fadester Companion 0.1.4 |
| A9 | Midi Fadester crossfader on the T-bar: throw to about 45%, then pull the USB cable. Plug it back in. | Program returns at once and the Transition button works. After plugging in, nothing moves until the crossfader is brought back to its start. | Midi Fadester 0.7.0 |

A6 is new behaviour in 0.12.0: the Companion's steps used to need exactly 0 or 1. A7 must be unchanged.
On the Mac, the experimental Companion host is the one documented exception: it stops and asks for a reset
with no Studio Mode toggle.

### B. Flash cap (machine first)

Truth: VS `src/core/flash-clock.h` (`VS_FLASH_RATE_MAX_HZ 3.0`, one clock shared by every filter),
VS `tests/obs-shader-screenshot-selftest.ps1`, VS locale `Modulator.FlashGuard`.

| Line | Who | Passes when | Blocks |
|---|---|---|---|
| B1 | The agent runs the screenshot self-test with the 10 Hz click, each built-in shader alone and several stacked. The owner does not look. | No more than 3 flashes in any second, in every case. | Visual Sidechain 0.7.0 |
| B2 | Only after B1 passes: the owner looks at the strobe shader, then at an Audio Modulator driving Color Correction brightness from Kick with Flash Guard on. | Calm: about 3 per second at most. | Visual Sidechain 0.7.0 |

### C. Silence stops the beat

Truth: VS `src/core/analyzer.h` (`VS_SILENCE_HOLD_SEC 2.0f`), VS locale `AudioTap.Status.SilentFor`,
SD `en.json` `vmNoAudio`.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| C1 | Play the 120 BPM loop on a beat-driven effect, then stop the audio. | Beat-driven movement stops within about 2 seconds. The Visual Sidechain Meter shows NO AUDIO. The filter's Properties say how long there has been no audio. | Visual Sidechain 0.7.0 |

### D. Panic is real

Truth: SD `src/actions/visual-panic-key.ts`, `src/actions/dial-math.ts` (`DIAL_HOLD_THRESHOLD_MS = 800`),
VS vendor requests `get_safety`, `panic`, `restore` and event `safety_changed`.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| D1 | Press the Panic hotkey on the keyboard. Do not touch the deck. | The Visual Panic key shows PANIC SENT. | Visual Sidechain 0.7.0, Fadester for OBS 0.12.0 |
| D2 | With Panic on, quit and restart the Stream Deck app. | The key comes back showing Panic. | Fadester for OBS 0.12.0 |
| D3 | Tap the key, then hold it for a second. | The tap does not restore. The hold (0.8 s) restores the visuals. | Fadester for OBS 0.12.0 |

### E. Whole mix

Truth: `API-CONTRACT.md` (whole-mix section), SD `src/obs/whole-mix.ts`, `tourbox/bridge/MixDesk.cs`.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| E1 | Companion running with All OBS mixer inputs on: fade the whole mix out, then Restore mix. | Every input is back at its starting level. Nothing was muted or re-routed. | Fadester for OBS 0.12.0, Fadester Companion 0.1.4 |
| E2 | In the Companion: Stop controls, then Start controls. Do E1 again. | "Two mix providers are answering" never appears. | Fadester Companion 0.1.4 |
| E3 | Quit the Companion and press the key. | The key says Companion offline and sends nothing. | Fadester for OBS 0.12.0 |

### F. Tempo, meter and fades on the bar

Truth: SD `src/control/quantized-fade.ts` (`MAX_QUANTIZE_WAIT_MS = 4000`, `MIN_QUANTIZE_CONFIDENCE = 0.35`,
hold to cancel = `DIAL_HOLD_THRESHOLD_MS`), SD `src/actions/visual-meter.ts`, VS tempo requests and hotkeys.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| F1 | With the 120 BPM loop playing: tap four beats, then Lock. | The meter shows about 120, shows it as locked, and counts the beats. | Visual Sidechain 0.7.0, Fadester for OBS 0.12.0 |
| F2 | Press Resync on a downbeat. | The count restarts at 1. | Visual Sidechain 0.7.0 |
| F3 | Auto-fade key set to 4 beats, Start: Next bar. Press once. | ARMED, then it fires on the bar. The watcher reports a fade of about 2.0 s and how far from the bar it started (the audit's target was within 40 ms). | Fadester for OBS 0.12.0 |
| F4 | Arm it, then tap again. | It fires now. | Fadester for OBS 0.12.0 |
| F5 | Arm it, then hold for a second. | CANCELLED. Nothing fires. | Fadester for OBS 0.12.0 |
| F6 | Unlock the tempo, stop the audio, press. | It fires at once with the millisecond fallback and shows NO TEMPO. It never waits silently, and never waits more than 4 seconds. | Fadester for OBS 0.12.0 |
| F7 | One press each on OBS Fade and Scene & Transition, set the same way. | As F3. | Fadester for OBS 0.12.0 |

No line in F starts by itself. Audio never starts a Program change: if anything fires without a press, stop
and report it as a release blocker.

### G. Tape Deck

Truth: SD `src/actions/tape-deck-control.ts`, VS `deck_command` in `src/obs/vendor-api.c`.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| G1 | Turn the Tape Deck dial up and down. Press the key for Play / Pause and Cue to start. | Speed moves along the ladder from 25% to 800%. The face shows both forms, such as 150% (1.5x), and matches the filter window. | Fadester for OBS 0.12.0, Visual Sidechain 0.7.0 |
| G2 | Switch to a scene collection with no Tape Deck. | The face says NO DECK. | Fadester for OBS 0.12.0 |

### H. One owner for layer opacity

Truth: `API-CONTRACT.md` (Layer 1, Layer 2 and the opacity owner), `tourbox/bridge/DeskActions.cs`.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| H1 | No Midi Fadester slot on Layer 2: ride the Companion's Layer 2 opacity fully down and up. | The layer goes fully clear and fully solid. | Fadester Companion 0.1.4 |
| H2 | Remove any Fadester opacity filter that H1 added to the source. Give Midi Fadester a layer-opacity slot on the Layer 2 source and scene, then ride it again from the Companion. | The Activity line names the Midi Fadester slot. The picture reaches exactly 0% and 100%. The Companion adds no filter of its own. | Fadester Companion 0.1.4, Midi Fadester 0.7.0 |
| H3 | Add a Color Correction filter named Fadester opacity to that source by hand, and ride once more. | The Activity line says the two stack. Nothing on that filter is changed or deleted. | Fadester Companion 0.1.4 |

### I. Setup page

Truth: SD `en.json` (`obsSavedReadBtn`, `chkHeading`, `chkCheckAgain`, `chkDetailPortOther`),
SD `src/vjster/plugin/link-server.ts` (`/whoami`).

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| I1 | On the settings page, press Use OBS's saved password. | It shows the port and that a password was found before anything is saved, then connects. The password itself is never shown. | Fadester for OBS 0.12.0 |
| I2 | Open the Setup checklist. Turn Studio Mode off, press Check again; turn it on, press again. | The failing line says the fix in one sentence, then clears. | Fadester for OBS 0.12.0 |
| I3 | Start the Companion with VJster on while the deck plugin holds the VJster link. | The port message names who holds it. | Fadester for OBS 0.12.0 |

### J. Installers (last)

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| J1 | Close OBS. Run `run-three-installers-admin.cmd` as administrator. | Three entries in Installed apps. The installed OBS 33 log shows 0.7.0, 0.7.0 and 0.5.1 loading. | The three OBS plugin releases |
| J2 | Repeat A1, B1 and D1 once on installed OBS. | The same results as on the portable OBS. | The three OBS plugin releases |

## 6. Recording results, and afterwards

- Write one draft results file per repo in the kit folder, in the style of
  [tourbox/REHEARSAL.md](../tourbox/REHEARSAL.md): what was done, on what hardware and versions, and what was
  observed or measured. Commit nothing until the owner asks.
- End with the go / no-go table: each release, the lines that passed, the lines that failed or were not
  tested, and whether it may be published.
- Give the owner one "back to normal" script: their everyday OBS profile and scene collection, their Stream
  Deck profile, and which Fadester Companion edition is running.
- Publishing, the Store, Elgato and the suite pins all wait for the owner's "go".

## 7. The Mac session

Visual Sidechain and Playlister have no macOS build, so there is nothing to test for them there.

1. **Accessibility grants** for Stream Deck or OpenDeck, and for the experimental Fadester Companion app. An
   ad-hoc rebuild can need the grant again.
2. **Stream Deck T-bar:** lines A1 to A5. Both the below-half and the half-or-above closeouts must work.
3. **Experimental Companion host:** when its helper is lost mid-fade it must stop and ask for a reset, with
   no Studio Mode toggle.
4. **Midi Fadester on CoreMIDI:** line A9.
5. **Keychain:** saving the OBS password failed with -25293 before
   ([CROSS-PLATFORM-CANDIDATE.md](CROSS-PLATFORM-CANDIDATE.md)). Note whether it still does. Do not claim it works.
6. **VJster extension** on the Mac: listed as untested.
7. `scripts/macos/README.md` describes the isolated live suite check.

## 8. Open decisions for the owner

- **Publish or hold** each of the four releases, after the results.
- **Code signing.** Every Windows installer is unsigned, and the suite installer's behaviour under SmartScreen
  and Smart App Control is untested.
- **P1-1.** Whether to build the whole-mix provider inside Midi Fadester, once lines E1 to E3 have passed.
- **P2 items** in the audit, one at a time, only after this session is signed off.
