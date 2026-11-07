# Fadester for TourBox · rehearsal and submission

## Historical evidence from November 4, 2026

The following results describe earlier Show and Tools release candidates. They establish the observed behavior of those builds. Verification of the single **OBS Fadester for TourBox** master preset is recorded separately below.

| Check | Evidence |
|---|---|
| Native files | Show: 32 shortcut assignments and one native preset switch. Tools: 22 and one. The generator decoded both files and compared them with the map, a known-good Console export, and the vendor switch encoding. There are 42 distinct Windows shortcuts shared across the two files. |
| Real TourBox Console | Console 5.12.1 imported each .tb as a new preset. Both linked to the installed OBS Studio alongside a pre-existing profile. The native editor displayed Show and Tools labels and the native Switch Preset action. |
| Actual OBS connection | The companion authenticated to OBS Studio 33.0.1 on localhost, discovered actual scenes/inputs, and read Preview and Program. The public package contains no password, scene collection or personal mappings. |
| Real mixer interruption | In an isolated OBS 33.0.1 instance, a second authenticated client moved a source to −30.125 dB during the companion’s duck. OBS emitted the actual input-volume event, the fade stopped, and later restore and undo left the new level alone. An already-dispatched write can still cross an exactly simultaneous external write. |
| Manual Studio Mode fader | A separate disposable OBS 33.0.1 instance with color sources exercised the shipping fader. A partial move held a blend, cancel restored the original, the outward rail took Preview, and a reverse throw returned to the first scene. The regular OBS collection was not used for those writes. |
| Windows input and error handling | The packaged listener registers global shortcuts, receives test messages on its own Windows thread, authenticates to a test OBS server, applies audio and scene actions, refuses to cue when Studio Mode is off, and releases shortcuts on quit. A competing listener and an occupied shortcut were tested separately. |
| Physical Show preset | On 2026-11-04 the operator recorded the hardware and OBS together. Console reactivated Show for OBS about 0:55 into the recording. The raised Knob changed the music level; the flat Dial completed three manual takes (about 1:08, 1:10 and 1:12); the notched Scroll changed only Preview (1:16–1:22). Duck and restore reached −12 dB and the previous −4.44 dB. The clip does not establish the model, every chord, or any Tools binding. |
| Cut followed by a manual fade | The physical rehearsal exposed a fault around 1:32: OBS selected Cut, but the companion reported selection had failed and the next manual fade was blocked. The corrected bridge passed this sequence in an isolated OBS 33.0.1 instance: Cut took the amber scene, Fade was restored, and the next dial sweep reached a half mix. For the next physical check, start on Fade with distinct scenes, press Top once, then turn the flat Dial into a partial mix. Confirm one cut, the selector back on Fade, and a visible blend. |
| Second physical Show run (RC2) | The flat Dial completed four manual fades at about 0:12, 0:22, 0:30 and 0:33. Three partial sweeps reversed back to their starting scene. The OBS slider handle stayed parked while the picture blended and the companion percentage changed. Scroll cued Preview without moving Program. Fine-Dial input registered, but both panes showed the same scene; the guard correctly declined a new fade. At 1:02 the readout showed ordinary Take rather than Cut, so the physical Top → Dial sequence remains unverified. |

### Later checks of the earlier release candidates

On November 4, 2026 Jeffrey reported the repaired native white handle running smoothly on his hardware. With the shipping native helper, a separate OBS Studio 33.0.1 instance reached 512/1023 on the visible handle at half throw, parked at 0 on completion, and returned from Amber to Blue. Both complete throws used the default 20 steps. Cancel and a direct Cut followed by another half throw also passed; the Program scene screenshots matched the two expected solid colors. These checks did not use the regular show.

Console 5.12.1 imported the release candidate Show and Tools files through its preset-list importer, each with one success and zero failures. Its local import copies matched both original files byte for byte. Both native TourMenus retained nine entries, with the whole-mix shortcuts and human-readable descriptions. On the rehearsal machine these additional presets have the suffix “02”; the existing linked rehearsal presets were left intact.

In the private OBS 33.0.1 whole-mix fixture, a provider and independent authenticated client drove two unequal synthetic tones (440 and 880 Hz). Four actual MKV captures were decoded independently. On track 1 each tone measured −6.02 dB at half gain, zero at silence, and −0.03 dB relative to its own baseline after restore (AAC). A late-added source joined at silence. A renamed source restored by UUID; an externally moved muted input kept its new level and track-2-only routing. Run `python tourbox/tests/live-obs.py --mix --slot jg2ike1e` to repeat on the private test installation.

The same disposable OBS also loaded the candidate MIDI Fadester DLL. Driving its master slot through its own vendor API at 50% travel applied its cubic curve (0.125 gain, −18.1 dB), and the plugin reported the confirmed value via its native receipt endpoint. A duplicate acknowledgement was ignored, full travel restored both original levels, and disabling grouped control produced a decline without changing audio. No physical MIDI hardware was involved. Use `--midi-plugin PATH` with the private mix fixture to exercise this integration.

## Master preset verification — November 4, 2026

The current package imports one file, **OBS Fadester for TourBox.tb**, and uses the map entry **presets.master**. Tour and Side + Tour both open its menu. The earlier observations above precede this consolidation.

| Check | Evidence |
|---|---|
| Native master import | TourBox Console 5.12.1 successfully imported **OBS Fadester for TourBox**. Read-only decoding of the imported records matched the generated source: 68 physical shortcut assignments, 47 unique shortcuts, two native menu openers, 22 menu entries and 16 HUD selections. Bare Side, Top, Tall and Short retained their native UP/release settings. |
| Candidate package | The local rc5 candidate built successfully and passed its automated package checks and Windows shortcut transport test. This checks the software path; it does not establish acceptance of every physical combination on the controller. |
| Guide | The generated single-preset guide passed syntax, link-target and label-coverage checks. Visual inspection confirmed the expanded control reference, menu and release-mode notes are readable without clipped rows. |

### Physical master rehearsal pending

The imported master and the expanded modifier combinations still need the following physical rehearsal. Import and software checks alone do not establish their hardware behavior.

Use two visually different scenes in Studio Mode, choose Fade and check that no broadcast is running. Select **OBS Fadester for TourBox**. Keep an eye on **Program** and listen to the assigned audio.

1. Turn Scroll: only Preview changes. Tap Scroll: the companion reports both names. Hold Scroll down and turn: media steps, and the scene should not jump. If no media is assigned, the Activity message identifies the missing assignment.
2. Turn the flat Dial until the picture is half mixed. Stop, then press and turn for a finer adjustment. A bare tap should report position. **Side + Dial press** cancels and the original Program picture returns.
3. Complete a full throw. One take only; extra ticks toward the same end must not cause another. Turn in the other direction to return. Try a separate automatic Take on Tall.
4. With YouTube playing in Chrome and the VJster extension installed, turn the raised Knob, then press and turn it: the video’s speed should move in 0.25 and 0.05 steps, and Activity should read each new speed back. Tap to read the video; hold Side and press to return to 1x. Hold Side and turn the flat Dial: only the assigned Music level should move; hold Tall and turn the Knob for Content. Short should undo a continuous level adjustment. Duck music, then restore to the level you started at.
5. Press Tour, scroll to **Check recording status**, and press Tall. Dismiss with Short. Repeat with Side + Tour and confirm the same menu and unchanged preset name.
6. Confirm the menu includes transition type and duration, overlay show/hide, mic mute, screenshot, recording chapter, replay and reconnect, media play/pause, the whole-mix level readout, video quality back to Auto and both blend modes back to Normal. Test only assigned sources and available recording/replay functions.
10. With Layer 1 and Layer 2 assigned, hold Top and turn the Knob, then Scroll, then the Dial: Layer 1’s blend mode, Layer 2’s blend mode and Layer 2’s opacity should change in OBS, and Activity should read each back. Release Top after each: Program must not cut (Top’s bare action is Cut on release; a Top hold that moved a rotary must not fire it). Press and turn Scroll: the video’s quality should step; Side + D-pad Up should play and pause it. Close OBS: the Knob must still change the video’s speed.
7. With whole-mix control enabled for rehearsal, try Side + Knob down/up and its status press, then choose the whole-mix fade and restore from Tour. Confirm the source levels in OBS and preserve any source adjusted manually.
8. Rehearse each new modifier with disposable scenes and audio. Side, Tall, Short and Top have bare actions set to native UP mode. First test a bare press/release, then hold each while turning every rotary according to the guide. Check that the held gesture performs only the selected operation throughout the hold and release. Pay particular attention to Tall and Top so an unintended Take or Cut is caught.
9. Check Side + Top screenshot, Side + Tall cancel, Side + Short Preview sync, Top + Tall chapter, Top + Short replay, Tall + Short soundcheck, Top + D-pad overlay/transition controls, and Side + C1/C2 whole-mix fade/restore. Recording and replay functions need their corresponding OBS outputs active. Record which gestures the tested model actually accepts.

These master modifier tests are pending. TourBox documents UP mode as executing the bare action on release and supporting combination use. That documentation and the native slot registry establish the intended configuration; the new physical gestures still need observation. [TourBox UP mode](https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html)

For the public entry, use GALLERY.txt, an accessible companion download, and the verified **OBS Fadester for TourBox.tb** file. Confirm the model actually rehearsed rather than checking every compatible-looking model in the form.
