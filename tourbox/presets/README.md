# OBS Fadester for TourBox preset for Windows

The TourBox preset for Fadester Companion: the flat Dial drives OBS's Studio Mode fader, Scroll picks the Preview scene, and the raised Knob rides the speed of the YouTube video in Chrome through VJster.

## Quick start

1. **Import it.** In TourBox Console, click the import button beside **Preset List** and pick **OBS Fadester for TourBox.tb**. (Fadester Companion's **Import into TourBox Console** button copies the path for you.)
2. **Select it.** Turn **Auto Switch** off and select **OBS Fadester for TourBox**: one preset then works whichever application is in front (OBS, Chrome or anything else).
3. **Try it.** Turn **Scroll** to put a scene in Preview, then turn the flat **Dial** to fade to it.

That's it. Keep Auto Switch on only if you want to: then link the preset to OBS, and to Google Chrome too to control videos with Chrome in front. **Updating:** select this existing preset and use its own menu’s **Import** command to replace its contents.

## The controls

| Control | Does |
|---|---|
| Flat Dial | The Studio Mode fader; press and turn for finer movement |
| Scroll | Select Preview scenes; press and turn for the video's quality |
| Raised Knob | The video's speed (VJster); press and turn for 0.05 steps (or Short + Dial); tap to play or pause |
| Side tap (or Side + Knob press) | Video speed back to 1x |
| Side + D-pad Up | Read the video |
| Side + Dial / Tall + Knob | Music / Content |
| Top + Knob / Top + Scroll / Top + Dial | Layer 1's blend mode / Layer 2's blend mode / Layer 2's opacity |

The companion provides these actions through the shortcuts shown in Console; the video and layer actions use Ctrl+Shift and Alt+Shift chords, everything else Ctrl+Alt+Shift.

The generated guide also lists the Side, Tall, Short and Top combinations for whole-mix level and media, Content and transition type, fine adjustments, the VJ layers, and direct production shortcuts. The four prime buttons use native **UP** mode, so their own actions happen on release (Side: video speed back to 1x, Short: check recording status, Tall: Preview to Program, Top: cut). Confirm the hold-and-release gestures on the real hardware with REHEARSAL.md. [TourBox UP mode](https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html)

## Tour menu and assignment HUD

Press **Tour** or **Side + Tour** to open the same menu at the pointer. Scroll to a choice, then press **Tall** or click the entry to run it. Press **Short** to dismiss. [TourBox TourMenu manual](https://www.tourboxtech.com/en/manual/tourmenu/)

The menu, in display order:

1. Read Preview & Program
2. Read fade position
3. Check audio inputs
4. Sync preview to live scene
5. Duck music
6. Restore music level
7. Undo last audio change
8. Read whole mix level
9. Fade whole mix to silence
10. Restore whole mix
11. Check recording status
12. Save OBS screenshot
13. Add recording chapter
14. Save replay buffer
15. Play or pause media
16. Reconnect to OBS
17. Previous transition
18. Next transition
19. Shorter transition
20. Longer transition
21. Show overlay
22. Hide overlay
23. Mute microphone
24. Read the video
25. Video speed back to 1x
26. Video quality to Auto
27. Layer 1 blend mode Normal
28. Layer 2 blend mode Normal

- **Whole mix.** With **All OBS mixer inputs** enabled in the companion, **Side + raised Knob turn** adjusts the group level and **Read whole mix level** in the menu reads it. The whole-mix fade and restore are deliberate menu choices. Source discovery, manual moves and restore: see the companion guide.
- **Side + Knob press**, like a tap on Side, returns the video speed to 1x. The native Console registry assigns slot 8 to KNOB+SIDE and slot 126 to its separate press.
- **General HUD** starts hidden. Open it from the top right of TourBox Console for the regular and fine fader, Preview scroll, video speed and fine speed, video quality, Music (Side + Dial), whole mix (Side + Knob), Layer 2 opacity and the two layer blend turns, Preview to Program (Tall), recording status (Short), 1x (Side and Side + Knob press), Read the video, play/pause, Duck and Restore music, and Tour. Click **Select Items** on the HUD to customize that list. [TourBox HUD guide](https://www.tourboxtech.com/en/news/how-to-use-hud-in-tourbox.html)

## For developers

### Reproduce the preset

From the repository root, use Python 3.10 or newer. These commands operate only on the preset file in this folder.

```shell
python tourbox/presets/build.py
python tourbox/presets/build.py --check
```

`map.json` defines the action and Windows shortcut for every binding. Its single presets.master entry includes the physical controls and menuBindings for commands reached through the menu. `nativeBindings` opens the menu in TourBox Console, `tourMenu.actions` lists bridge actions in display order and `hud` selects the controls shown in the optional General HUD. The checker decodes all 256 control records and checks each shortcut, label, menu target and HUD row against the map. It also checks that each control is available in the editor and compares the shipped XML with a fresh build. When supplied, `--reference "path/to/OBS Scene Test.tb"` also checks a separate Left/Ctrl+Shift+F9 and Right/Ctrl+Shift+F10 reference.

### Native format and verification

- **Format.** Gzip-compressed `TableTransfer` XML version 1.9. The factory blank template uses a 22-byte header and 256 indexed, 13-byte records. Keyboard blocks contain the modifier mask, key kind and keycode; a rotary has a five-byte block for each direction. F-keys use TourBox's compact special-key numbers, and the native shortcut labels use `0x01000000 | keycode` for those special keys.
- **Verified** against both control records and both labels of a manually configured, saved OBS preset in Windows Console 5.12.1. The remaining 254 records of that reference matched the factory blank control table. Neither that preset nor any device identifier or application path is embedded here.
- **Slots.** The installed Console control registry identifies **Knob**, **Scroll** and **Dial** as slots 4, 9 and 15, their ordinary presses as 55, 10 and 56, and their push-and-turn combinations as 59, 69 and 75. **Side+Scroll press** is 135, **Side+Dial press** is 143, **Side+Tour** is 150, and **Side+Dial turn** is 171. Both **Tour** and **Side+Tour** reference menu 0. Side chords provide cancel and Preview sync; bare spindle presses request status or a soundcheck.
- **Menu and HUD** follow the installed Windows Resolve preset. The factory Windows Harmony and MediBang Lite presets also show the exact record used here for bare Tour (slot 42) opening menu 0. The item’s modifier mask and native key identify its shortcut description in `ShortDesc`. Each General HUD item is one physical control slot, so a rotary row includes both directions.
- **Model.** This preset targets the desktop model with those controls and registered combinations. Software inspection and file decoding cannot establish how a different model's firmware handles a physical chord. Check the row labels in Console and test in a rehearsal before using them on air.

See TourBox's [preset import guide](https://www.tourboxtech.com/en/news/import-and-export-presets-in-tourbox.html) and [rotary controls guide](https://www.tourboxtech.com/en/news/how-to-use-the-rotating-section-controls.html). An independent [control-table investigation](https://audion.dev/en/read/tourbox-presets-translator/tools/FORMAT.md) supplies additional Windows calibration evidence for the D-pad positions, modifier mask, and F-key codes.
