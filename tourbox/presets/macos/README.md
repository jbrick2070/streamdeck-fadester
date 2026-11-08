# Experimental macOS master preset

This is the Mac encoding of the same single **OBS Fadester for TourBox** master: 68 physical shortcut assignments, 47 distinct actions, 22 TourMenu entries, the same native menu controls, UP modes and assignment HUD. It does not install or start a companion. Use only with the matching experimental Mac companion and verify native Console import and physical gestures before relying on it.

The Mac shortcuts are **Control + Option + Shift**, followed by the key in the canonical `../map.json`. **Command is absent.** Mac Console's native modifier encoding differs: Control=1, Shift=2, Option=4, Command=8. The Windows master uses mask14 for Ctrl+Alt+Shift; the Mac file uses mask7. Importing the Windows file unchanged is not evidence of equivalent Mac shortcuts.

Generate and check from the repository root:

```sh
python3 tourbox/presets/build_macos.py
python3 tourbox/presets/build_macos.py --check
python3 -m unittest discover -s tourbox/presets -p test_build_macos.py
```

The generator reads the canonical map and reuses the existing master builder, then changes only the 68 physical modifier bytes, 47 shortcut-label modifier fields and 22 menu modifier fields. It does not edit `../OBS Fadester for TourBox.tb`, the Windows map, Console's database, app links or any live device. The header stays unchanged: its second byte is the generic plugin identifier, not a platform marker. A reverse-normalization check verifies every other field against the original builder.

Calibration was read from installed Mac Console 5.12.1 factory `resources/presets/*.json` and its native table records on 2026-11-04. Final Cut's Control+T (slot24) uses mask1; Control+Shift+R (slot22) uses mask3; Photoshop's Command+0 (slot10) uses mask8. Bare Shift uses2 and Option4. Mac tables retain 22-byte headers and 256 13-byte control records. Native UP examples also use byte2 value0x10. These facts establish encoding; they do not prove successful import, shortcut dispatch, hardware timing or another model's chord behavior.

Next supervised check: import this file as a new Mac preset using the top-level Preset List import, keeping existing presets intact. Confirm the exact master name, Dial left/right labels and **Control+Option+Shift+F3/F4** (not Command), and Scroll press **Control+Option+Shift+6**. With a count-only Mac listener, press Scroll once and verify one `preview.status` event. Then check one Dial detent each way, fine movement and modifier release suppression before connecting those inputs to OBS writes. Link the single master to OBS only after the visible assignments agree. The actual native `.tb` import/re-export and physical test remain outstanding until recorded separately.
