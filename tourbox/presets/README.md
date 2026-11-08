# OBS Fadester for TourBox preset for Windows

Import **OBS Fadester for TourBox.tb** using the import button beside **Preset List** in TourBox Console. Link **OBS Fadester for TourBox** to the running OBS application and select it. For a later update, select this existing preset and use its own menu’s **Import** command to replace its contents.

The raised Knob is the speed of the YouTube video in Chrome, through VJster: press and turn for 0.05 steps, tap to read the video, Side + press for 1x. Press and turn Scroll for the video's quality; Side + D-pad Up plays or pauses it. The flat Dial controls the Studio Mode fader and Scroll selects Preview scenes; press and turn the Dial for finer movement. Hold Side and turn the Dial for Music, Tall and turn the Knob for Content. Hold Top: Knob and Scroll cycle Layer 1's and Layer 2's blend modes and the Dial rides Layer 2's opacity. The companion provides these actions through the shortcuts shown in Console; the video and layer actions use Ctrl+Shift and Alt+Shift chords, everything else Ctrl+Alt+Shift.

The generated guide includes the selected Side, Tall, Short and Top modifier combinations for whole-mix level and media, Content and transition type, fine adjustments, the VJ layers, and direct production shortcuts. The four prime buttons use native **UP** mode, so their bare actions execute on release. Confirm the new hold-and-release gestures on the actual hardware using REHEARSAL.md. [TourBox UP mode](https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html)

## Tour menu and assignment HUD

Press **Tour** or **Side + Tour** to open the same menu at the pointer. Scroll to a choice, then press **Tall** or click the entry to run it. Press **Short** to dismiss. [TourBox TourMenu manual](https://www.tourboxtech.com/en/manual/tourmenu/)

The menu includes the following actions in display order.

1. Read Preview & Program
2. Read fade position
3. Check audio inputs
4. Sync preview to live scene
5. Duck music
6. Restore music level
7. Read whole mix level
8. Fade whole mix to silence
9. Restore whole mix
10. Check recording status
11. Save OBS screenshot
12. Add recording chapter
13. Save replay buffer
14. Play or pause media
15. Reconnect to OBS
16. Previous transition
17. Next transition
18. Shorter transition
19. Longer transition
20. Show overlay
21. Hide overlay
22. Mute microphone
23. Read the video
24. Video speed back to 1x
25. Video quality to Auto
26. Layer 1 blend mode Normal
27. Layer 2 blend mode Normal

With **All OBS mixer inputs** enabled in the companion, **Side + raised Knob turn** adjusts the group level; **Read whole mix level** in the menu reads it. **Side + Knob press** returns the video speed to 1x. The native Console registry assigns slot 8 to KNOB+SIDE and slot 126 to its separate press. The whole-mix fade and restore actions use deliberate menu selections. See the companion guide for source discovery, manual intervention and restore behavior.

The **General HUD** starts hidden. Open it from the top right of TourBox Console for the regular and fine fader, Preview scroll, video speed and fine speed, video quality, Music (Side + Dial), whole mix (Side + Knob), Layer 2 opacity and the two layer blend turns, Take, Undo, recording status, Read the video, 1x, play/pause, Duck and Restore music, and Tour. Click **Select Items** on the HUD to customize that list. [TourBox HUD guide](https://www.tourboxtech.com/en/news/how-to-use-hud-in-tourbox.html)

## Reproduce the preset

From the repository root, use Python 3.10 or newer. These commands operate only on the preset file in this folder.

```shell
python tourbox/presets/build.py
python tourbox/presets/build.py --check
```

`map.json` defines the action and Windows shortcut for every binding. Its single presets.master entry includes the physical controls and menuBindings for commands reached through the menu. `nativeBindings` opens the menu in TourBox Console, `tourMenu.actions` lists bridge actions in display order and `hud` selects the controls shown in the optional General HUD. The checker decodes all 256 control records and checks each shortcut, label, menu target and HUD row against the map. It also checks that each control is available in the editor and compares the shipped XML with a fresh build. When supplied, `--reference "path/to/OBS Scene Test.tb"` also checks a separate Left/Ctrl+Shift+F9 and Right/Ctrl+Shift+F10 reference.

## Native format and verification

The format is gzip-compressed `TableTransfer` XML version 1.9. The factory blank template uses a 22-byte header and 256 indexed, 13-byte records. Keyboard blocks contain the modifier mask, key kind, and keycode; a rotary has a five-byte block for each direction. F-keys use TourBox's compact special-key numbers. The native shortcut labels use `0x01000000 | keycode` for those special keys. This was verified against both control records and both labels of a manually configured, saved OBS preset in Windows Console 5.12.1. The remaining 254 records of that reference matched the factory blank control table. Neither that preset nor any device identifier or application path is embedded here.

The installed Console control registry identifies **Knob**, **Scroll**, and **Dial** as slots 4, 9 and 15. It separately identifies their ordinary presses (55, 10, 56) and their simultaneous push-and-turn combinations (59, 69, 75). **Side+Scroll press** is 135, **Side+Dial press** is 143, **Side+Tour** is 150, and **Side+Dial turn** is 171. Both **Tour** and **Side+Tour** reference menu 0. Side chords provide cancel and Preview sync; bare spindle presses request status or a soundcheck.

The menu and HUD structures follow the installed Windows Resolve preset. The factory Windows Harmony and MediBang Lite presets also demonstrate the exact record used here for bare Tour (slot 42) opening menu 0. The item’s modifier mask and native key identify its shortcut description in `ShortDesc`. Each General HUD item is one physical control slot, so a rotary row includes both directions.

This preset targets the desktop model with those controls and registered combinations. Software inspection and file decoding cannot establish how a different model's firmware handles a physical chord. Check the row labels in Console and test in a rehearsal before using them on air.

See TourBox's [preset import guide](https://www.tourboxtech.com/en/news/import-and-export-presets-in-tourbox.html) and [rotary controls guide](https://www.tourboxtech.com/en/news/how-to-use-the-rotating-section-controls.html). An independent [control-table investigation](https://audion.dev/en/read/tourbox-presets-translator/tools/FORMAT.md) supplies additional Windows calibration evidence for the D-pad positions, modifier mask, and F-key codes.
