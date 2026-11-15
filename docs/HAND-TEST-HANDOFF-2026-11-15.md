# Hand-test handoff (2026-11-15)

For the agent at the owner's desk: the Windows PC first, the Mac later. This file replaces instructions that
lived only in a chat. Read it in full, then start at section 3.

**Why this session exists.** The release candidates pass their headless tests and their Windows and macOS CI.
Nobody has yet tried them with real OBS, a deck, a TourBox, a game controller or a MIDI desk. This session does
that, one physical action at a time: everything on Windows, then everything on the Mac, then one publish.

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

- **Nothing is published until both passes are done.** All four releases stay drafts through the Windows pass
  and the Mac pass, even with zero failures. No uploads to the Microsoft Store or Elgato, no tags, no change
  to the suite pins. Publishing happens once, at the end, when the owner says "publish".
- **The code is frozen while a pass is running.** The tagged commits are the release candidates. If a check
  finds a defect, write it up with evidence and carry on with the next line. Fixes happen between passes
  (section 6), never in the middle of one.
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

**The order, decided by the owner on 2026-11-15:**

1. **Windows, everything.** Every line, with every device connected: the Stream Deck +, the game controller,
   the TourBox and the MIDI desk. The owner can connect them all. Ask for a device to be plugged in before
   its lines; do not mark it "not tested" without asking.
2. **Fix what failed**, re-cut the candidates and re-run those lines (section 6).
3. **The Mac, everything** (section 7), in the same way.
4. **Publish once**, after both passes, on the owner's word.

Only one agent drives a pass.

**For the Windows pass:**

1. **Look.** Check `C:\fadester\hand-test-kit\` and `C:\fadester\release-drafts\`. Tell the owner in a few
   lines what exists and what is missing from section 4.
2. **Fill the gaps that block tonight.** Items 1 to 7 of section 4. Build only what is missing.
3. **Roll call** (section 4, item 6). Fix or note anything it finds before the first hardware line.
4. **Walk the run sheet** (section 5) in order, one line at a time: give one instruction, the owner does it
   and answers, you record the measured result and move on. If a line fails, save the logs, say which release
   it blocks, and carry on with the next line.
5. **Record and report** (section 6).

**Use the portable OBS for lines A to I.** It keeps the candidates out of the owner's everyday OBS until they
have passed. The installers are line J, and lines K to S then run on the installed OBS. If the owner would
rather install first, that is their call:
make sure the rollback kit (section 4, item 7) exists before they click.

### 3a. If the desk agent's local plan exists, it is the master

Reported on 2026-11-15 from the desk agent's own summary; the author of this file has not read these files.
`C:\fadester\release-drafts\` holds `human-hardware-test-plan.md` (phases H1 to H8, 42 checks in a GATE and a
DEEP tier), `desk-checklist.md`, `opus-handoff-prompt.md`, `install-results.json` and
`all-checks-results.json`. The Suite Demo Kit is imported in the owner's OBS, with its Stream Deck + profiles.
That plan starts with the installers (its H1.1) and ends with publishing (its H8).

If those files are there, follow that plan and its prompt, with these changes. Where they disagree, this
section wins.

1. **One list, one driver.** Use section 5 of this file as a cross-check, not as a second list to run end to
   end. Only one agent drives the session. `run-all-checks.ps1` swaps the OBS settings folder out and back, so
   a second agent running it would pull the profile from under a session in progress.
2. **Before the installers:** stage the rollback (section 4, item 7). The owner closes OBS; never force it.
3. **Flash cap first.** Before any check where the owner looks at a reactive effect, find a flash-cap result
   for these builds in `all-checks-results.json`. If there is none, run line B1 first.
4. **Add these lines if the plan lacks them.** The summary of the plan does not mention them, and most are
   the audit's safety items:
   - the T-bar slider lost mid-fade (A3, A4), a reconnect mid-fade (A5), and the Companion's helper lost
     mid-fade (A8). These exercise the recovery that 0.12.0 changed.
   - Panic pressed on the keyboard, and Panic across a Stream Deck restart (D1, D2).
   - the whole mix after Stop controls then Start controls, and with the Companion closed (E2, E3).
   - silence stops the beat (C1), if the plan only checks the meter's label.
   - TourBox steps at the rails (A6) and the MIDI desk unplugged mid-fade (A9).
   - anything in groups K to S that the plan does not cover. The likely gaps are the TourBox rehearsal (R1),
     the MIDI desk lines (L1 to L5), Playlister edits while a clip plays (P2) and the dress rehearsal (S1).
5. **Run the plan's full tier.** Every GATE and every DEEP check, not the short list. The owner can connect
   every device, so ask for the TourBox and the MIDI desk when their lines come up (A6, A9, and the plan's
   physical MIDI fader checks). "Not tested" is only for something the owner says cannot be connected, and it
   is never a pass.
6. **No publishing at the end of the Windows pass.** The plan's last phase (its H8) waits until the Mac pass
   is also done. Then show the pass, fail and not-tested lists for both passes, release by release, and wait
   for the owner's "publish".
7. **Other projects.** Checks for anything outside these four repositories are not part of this sign-off.
   Keep them out of the go / no-go table.

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
SD is this repo, MF is `midi-fadester`, VS is `visual-sidechain`, PL is `obs-playlister`.

**Everything means the whole suite.** Lines A to J cover what is new or safety-critical in these candidates.
Lines K to S cover the rest, on the installed OBS, so that every product and every device is used at least once: Fadester for OBS
and VJster on the deck, Midi Fadester with the MIDI desk, Visual Sidechain, Playlister, Fadester Companion
with the TourBox and the game controller, and then everything together.

Each repo also lists its own manual checks. Fold in any that these lines miss: `TESTING.md` and
`demo-kit/TESTING.md` here, `docs/vjster/TESTING.md`, `tourbox/REHEARSAL.md`, and `TESTING.md` in MF, VS
(also `BETA-TESTING.md`) and PL.

Before the first line, show the owner one coverage table: product, device, and the lines that cover it. No
row may be empty.

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

### J. Installers

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| J1 | Close OBS. Run `run-three-installers-admin.cmd` as administrator. | Three entries in Installed apps. The installed OBS 33 log shows 0.7.0, 0.7.0 and 0.5.1 loading. | The three OBS plugin releases |
| J2 | Repeat A1, B1 and D1 once on installed OBS. | The same results as on the portable OBS. | The three OBS plugin releases |

### K. Every deck action once

Truth: SD `io.github.jbrick2070.fadester-for-obs.sdPlugin/manifest.json` (19 actions), SD `TESTING.md`,
`demo-kit/TESTING.md`, [OPENDECK.md](OPENDECK.md).

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| K1 | Use each of the 19 actions once on the Stream Deck +: OBS Scene Info Bar, Source & Layer, OBS Fader, Scene & Transition, OBS Fade, Playlister Transport, OBS Filter, Visual Panic, Visual Sidechain Meter, Tape Deck, Midi Fadester Fader, Midi Fadester Auto-fade, and the seven VJster actions. | Each does its job and its face shows the right state. Nothing is cut off on a key or the touch strip. | Fadester for OBS 0.12.0 |
| K2 | Open each action's settings page once. | The controls work and the text reads properly. | Fadester for OBS 0.12.0 |
| K3 | If the owner uses OpenDeck: load the plugin there, press one key and turn one dial. | It works as it does in Stream Deck. | Fadester for OBS 0.12.0 |

### L. Midi Fadester with the MIDI desk

Truth: MF `README.md` and `TESTING.md`; `API-CONTRACT.md` (slot `target_mode`, `reset_fx`, soft takeover).

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| L1 | Crossfader on the T-bar: one full throw, then a part throw and back. | The fade is smooth, it takes at the end, and coming back to the start cancels. The Transition button is never left locked. | Midi Fadester 0.7.0 |
| L2 | One control for each other job: mix two layers, layer opacity, audio volume, and a filter setting. | Each moves its target smoothly, and the dialog shows the value. | Midi Fadester 0.7.0 |
| L3 | Press Clean / All FX Off. | Every FX filter setting goes back to its start value. Audio, layers and the T-bar are untouched. | Midi Fadester 0.7.0 |
| L4 | Move a slot from a Stream Deck dial, then touch the same physical fader. | The fader does nothing until it reaches the current value, then picks up with no jump. | Midi Fadester 0.7.0 |
| L5 | Master mapped to the whole mix, with the Companion running; then with the Companion closed. | The whole mix follows the fader. With the Companion closed it says it needs Fadester Companion and changes nothing. | Midi Fadester 0.7.0 |

### N. Visual Sidechain (only after B1 has passed)

Truth: VS `README.md`, `TESTING.md`, `BETA-TESTING.md`.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| N1 | Put each of the 11 built-in shaders on a source with music playing. | Each one reacts to the music. | Visual Sidechain 0.7.0 |
| N2 | Audio Modulator on a setting of another filter on the same source; then switch the modulator off. | The setting moves with the audio. Switching off puts it back where it was. | Visual Sidechain 0.7.0 |
| N3 | Press the Panic hotkey, then Restore. | Panic stops every reactive effect at once. Restore brings them back as they were. | Visual Sidechain 0.7.0 |
| N4 | Tape Deck clip: speed from 25% up to 800%, tape pitch on and off, Cue to start. | It plays at each speed, and a speed change does not restart the clip. | Visual Sidechain 0.7.0 |

### P. Playlister

Truth: PL `README.md` and `TESTING.md`; SD `src/actions/playlister-transport-key.ts`.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| P1 | A Playlister source with a folder and a playlist file: play, Next, Previous, from OBS and from the Playlister Transport keys. | Clips play in order, and both ways of stepping work. | Playlister 0.5.1, Fadester for OBS 0.12.0 |
| P2 | While a clip plays: add and remove list items, and drop a new file into the watched folder. | The playing clip does not restart. | Playlister 0.5.1 |
| P3 | Step the playlist from the Companion's media controls. | Previous, next, play and restart work. | Fadester Companion 0.1.4 |

### Q. VJster and YouTube

Truth: `docs/vjster/INSTALL.md`, `docs/vjster/TESTING.md`, SD `src/vjster/`.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| Q1 | Chrome extension with a YouTube tab: the VJster Speed and Quality dials, the presets, Speed Step, Play / Pause and Pin Tab. | Each changes the tab, and each face shows the state. | Fadester for OBS 0.12.0 |
| Q2 | The OBS page: add its link as a Browser Source and set Control to the OBS page. | The video plays inside OBS and its speed follows the dial. Quality says honestly that it is not available there. | Fadester for OBS 0.12.0 |
| Q3 | Host the VJster link from the deck plugin, then from the Companion's Setup tab (Target, OBS video URL / ID, Copy OBS Browser Source URL). One host at a time. | Each host works alone. If both are started, the second names who holds the port. | Fadester for OBS 0.12.0, Fadester Companion 0.1.4 |

### R. Fadester Companion with the TourBox and the game controller

Truth: [tourbox/REHEARSAL.md](../tourbox/REHEARSAL.md), `tourbox/README.md`, `docs/gamepad/`.

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| R1 | Every step of "Physical master rehearsal pending" in `tourbox/REHEARSAL.md`, with the TourBox. | As written there. That rehearsal has been pending since the single master preset replaced the older ones. | Fadester Companion 0.1.4 |
| R2 | Game controller: every mapped control once, then again with Easy mode on. | As the gamepad guide says. In Easy mode a guarded control needs its hold. | Fadester Companion 0.1.4 |
| R3 | Layer 1 and Layer 2 blend, and the music duck. | Blend steps through the modes and resets. The duck lowers the music and puts it back. | Fadester Companion 0.1.4 |

### S. Dress rehearsal (the last line of each pass)

| Line | The owner does | Passes when | Blocks |
|---|---|---|---|
| S1 | With every device connected, the owner starts a recording and, if they choose, a private or unlisted test stream. Then a short set that uses every device: a fade on the T-bar from each controller, a fade on the bar, a whole-mix fade and Restore mix, a clip change in Playlister, a speed ride on Tape Deck and on VJster, Panic and Restore visuals. | Nothing locks. Program never changes without a press. The recording plays back clean, and OBS's log has no errors from the four plugins. | All four releases |

S1 is the only line that runs while OBS is recording or streaming, and only the owner starts it.

## 6. Recording results, fixing, and publishing

**After each pass**

- Write one draft results file per repo in the kit folder, in the style of
  [tourbox/REHEARSAL.md](../tourbox/REHEARSAL.md): what was done, on what hardware and versions, and what was
  observed or measured. Commit nothing until the owner asks.
- End with one table: each release, and the lines that passed, failed or were not tested.
- Give the owner one "back to normal" script: their everyday OBS profile and scene collection, their Stream
  Deck profile, and which Fadester Companion edition is running.

**Fixing what failed**

- Fix failures in one batch after the pass, not during it. Each fix goes through a pull request with a test
  that fails without it, and green CI. The audit's rules still hold: protocol changes are additive, and
  Panic, Restore and the flash cap only ever get stricter.
- Re-cut the draft releases from the fixed commit. The owner decides whether a version number changes.
- Re-run every failed line on the re-cut files, and lines A1 to A4 and B1 again as a guard.
- A fix made after the Windows pass is re-checked on Windows before the Mac pass starts. A fix made after
  the Mac pass that touches shared code is re-checked on both.

**Publishing (once, at the end)**

- Publish only the exact files that were tested. Record the SHA-256 of each tested file during the passes,
  and compare it with the draft release's file before publishing.
- Order: the three OBS plugins, then Fadester for OBS, then the suite pins, then the suite installer. Stop
  for the owner's "yes" before each step that cannot be undone.
- The Microsoft Store and Elgato submissions are the owner's own uploads. Prepare the files and the texts;
  upload nothing.

## 7. The Mac pass (after Windows is done)

The same as Windows: every line that applies, with every device connected, one at a time. The agent on the
Mac builds the exact Mac run sheet first, from the "Real host acceptance" list in
[CROSS-PLATFORM-CANDIDATE.md](CROSS-PLATFORM-CANDIDATE.md), [tourbox/MACOS.md](../tourbox/MACOS.md),
[COMPANION-PARITY.md](COMPANION-PARITY.md), `scripts/macos/README.md` and section 5 of this file. Sections 2
and 6 apply unchanged. Visual Sidechain and Playlister have no macOS build, so on the Mac their keys are
tested for saying so plainly (line M9).

The sheet must cover at least:

| Line | The owner does | Passes when |
|---|---|---|
| M1 | Install the same Fadester for OBS 0.12.0 file that was tested on Windows (compare its SHA-256). | All 19 actions appear, both halves of the plugin start, and the settings pages work. |
| M2 | Press Use OBS's saved password. Then quit and reopen Stream Deck. | It reads OBS's saved password on request. Note whether the password is still saved after the restart: saving to the Keychain failed with -25293 before ([CROSS-PLATFORM-CANDIDATE.md](CROSS-PLATFORM-CANDIDATE.md)). Do not claim it works unless it is seen to. |
| M3 | Open the Setup checklist, including its Accessibility line. | Each failing line says its fix. The checklist never raises the macOS permission prompt by itself. |
| M4 | Grant Accessibility to Stream Deck, then do lines A1 to A5. | As on Windows. The Mac T-bar path is marked experimental: record exactly what happens at each position. |
| M5 | Install Midi Fadester 0.7.0 from its macOS package and connect the MIDI desk. | OBS loads it, the desk is found, a crossfader throw works, and line A9 passes. |
| M6 | Scenes, transitions, source visibility, audio faders and fades from the deck. | As the "Real host acceptance" list says. |
| M7 | Whole mix with the Mac mix host running: lines E1 to E3. | As on Windows. |
| M8 | VJster on the Mac: the Chrome extension, then the OBS page. | Speed, quality, Play / Pause and Pin Tab work, and the link reconnects. |
| M9 | Press the keys that need Visual Sidechain or Playlister: Visual Panic, Visual Sidechain Meter, Tape Deck, Playlister Transport, and a fade set to beats. | Each key says plainly what is missing. The fade set to beats fires at once and shows NO TEMPO. Nothing hangs or waits silently. |
| M10 | The experimental Fadester Companion app with the TourBox: lines A6 and A8, and whatever [COMPANION-PARITY.md](COMPANION-PARITY.md) says the Mac app supports. | Steps follow the same rail rule. When its helper is lost mid-fade it stops and asks for a reset, with no Studio Mode toggle: that is the documented exception. |

Finish the Mac pass with the dress rehearsal (line S1), using what exists on the Mac.

Lines M1 to M9 are about files that ship for the Mac. Line M10 is an experimental app that is not among the
release files: record its results, and the owner says whether they count for the publish. An ad-hoc rebuild of
a Mac app can need its Accessibility grant again.

## 8. Open decisions for the owner

- **"Publish"**, once, after both passes.
- **Whether line M10 counts** for the publish (the experimental Mac Companion).
- **Code signing.** Every Windows installer is unsigned, and the suite installer's behaviour under SmartScreen
  and Smart App Control is untested.
- **Later work, not part of this release:** P1-1 (a whole-mix provider inside Midi Fadester) and the P2 items
  in the audit.
