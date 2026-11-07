"""Build and check the single OBS Fadester for TourBox Console 1.9 preset. Standard library only."""

import argparse
import base64
from copy import deepcopy
import gzip
import io
import json
from pathlib import Path
import re
import struct
import xml.etree.ElementTree as ET


HERE = Path(__file__).resolve().parent
HEADER_SIZE, RECORD_SIZE, COUNT = 22, 13, 256
ROTARY_FLAG = 8
# Console's Top Standard -> UP change was observed on an otherwise identical
# preset: only byte 2 of its 13-byte record changes from 0x00 to 0x10.
# Vendor behavior: https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html
RELEASE_MODE = 0x10
# Factory blank template's rotary flags. The Console marks other rotary chords when assigned.
DEFAULT_ROTARIES = {4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 49, 59, 202, 203, 204, 205}
PRESS = {"tall": 0, "side": 1, "top": 2, "short": 3, "scroll": 10, "up": 16,
         "down": 17, "left": 18, "right": 19, "side+up": 20, "side+down": 21,
         "side+left": 22, "side+right": 23, "c1": 34, "c2": 35, "tour": 42,
         "knob": 55, "dial": 56, "side+knob": 126, "side+scroll": 135,
         "side+dial": 143, "side+tour": 150,
         "side+c1": 154, "side+c2": 156, "side+top": 32, "side+tall": 27,
         "side+short": 30, "top+tall": 25, "top+short": 29, "tall+short": 26,
         "top+up": 43, "top+down": 44, "top+left": 45, "top+right": 46}
ROTATE = {"knob": 4, "scroll": 9, "dial": 15, "knob+press": 59, "scroll+press": 69,
          "dial+press": 75, "side+dial": 171, "side+knob": 8, "side+scroll": 14,
          "tall+knob": 5, "tall+scroll": 11, "tall+dial": 168,
          "short+knob": 6, "short+scroll": 12, "short+dial": 169,
          "top+knob": 7, "top+scroll": 13, "top+dial": 170}
# These are recognized native slots, not inferred combinations. Read-only source:
# C:\Program Files\TourBox Console\app\resources\app.asar
#   out/main/index.js: tourBoxKeys (line 2677)
#   out/renderer/assets/hooks--JgclY4l.js: tourBoxProductIdToSupportedKeyInfoMap (line 43)
# The installed 007 model supports slots 0..171 except 47..51. Names A/B,
# TOP_BAR, WHEEL and SWITCH mean Tall/Short, Top, Dial and Tour respectively.
# The actual Console stores Ctrl+Shift+F9/F10 with a 0x01000000 prefix on the
# compact special-key ID in ShortDesc. This differs from the Qt F-key numbers.
MODS = {"Ctrl": 8, "Alt": 4, "Shift": 2}
OPEN_MENU_ZERO = bytes.fromhex("00 00 20 00 00 00 00 00 00 00 00 00")
NATIVE_ACTIONS = {"tourMenu": OPEN_MENU_ZERO}
EMPTY = bytes(5)

# Compatibility contract from the former two presets: every original action keeps
# its Ctrl+Alt+Shift chord. The VJ layout (2026-11) moves some of them to other
# controls and adds VJ_KEYS; VJ_PHYSICAL_KEYS lists the controls it changed.
ACTION_KEYS = dict(zip(
    [f"F{i}" for i in range(1, 13)] + list("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789"),
    ("music.down music.up fader.back fader.forward preview.previous preview.next take undo "
     "anchor.1 anchor.2 anchor.3 anchor.4 "
     "fader.cancel preview.sync take.cut music.duck content.down content.up media.previous media.next "
     "media.play media.restart overlay.show overlay.hide mic.mute transition.previous transition.next "
     "transition.shorter transition.longer music.restore capture.screenshot recording.chapter replay.save "
     "recording.status bridge.reconnect soundcheck mix.fadeOut mix.restore "
     "music.fineDown music.fineUp fader.fineBack fader.fineForward fader.status preview.status "
     "mix.down mix.up mix.status").split(), strict=True))
# Full chords for the VJ actions: Ctrl+Shift and Alt+Shift with F-keys, which no
# app on a show PC uses and which Console encodes as modifier bits (mods 10 and 6).
VJ_KEYS = {
    "Ctrl+Shift+F1": "vjster.speed.down", "Ctrl+Shift+F2": "vjster.speed.up", "Ctrl+Shift+F3": "vjster.status",
    "Ctrl+Shift+F4": "vjster.speed.fineDown", "Ctrl+Shift+F5": "vjster.speed.fineUp", "Ctrl+Shift+F6": "vjster.speed.reset",
    "Ctrl+Shift+F7": "layer2.opacity.down", "Ctrl+Shift+F8": "layer2.opacity.up",
    "Ctrl+Shift+F9": "vjster.quality.down", "Ctrl+Shift+F10": "vjster.quality.up", "Ctrl+Shift+F11": "vjster.playPause",
    "Ctrl+Shift+F12": "layer2.blend.previous", "Alt+Shift+F1": "layer2.blend.next",
    "Alt+Shift+F2": "layer1.blend.previous", "Alt+Shift+F3": "layer1.blend.next",
    "Alt+Shift+F4": "vjster.quality.reset", "Alt+Shift+F5": "layer1.blend.reset", "Alt+Shift+F6": "layer2.blend.reset",
}
ALL_ACTIONS = set(ACTION_KEYS.values()) | set(VJ_KEYS.values())
# slot:gesture:chord for the controls the VJ layout reassigned; a bare key means Ctrl+Alt+Shift as below.
VJ_PHYSICAL_KEYS = """
4:ccw:Ctrl+Shift+F1 4:cw:Ctrl+Shift+F2 55:press:Ctrl+Shift+F3 59:ccw:Ctrl+Shift+F4 59:cw:Ctrl+Shift+F5
126:press:Ctrl+Shift+F6 171:ccw:F1 171:cw:F2 170:ccw:Ctrl+Shift+F7 170:cw:Ctrl+Shift+F8
69:ccw:Ctrl+Shift+F9 69:cw:Ctrl+Shift+F10 20:press:Ctrl+Shift+F11 13:ccw:Ctrl+Shift+F12 13:cw:Alt+Shift+F1
7:ccw:Alt+Shift+F2 7:cw:Alt+Shift+F3
""".split()
ORIGINAL_PHYSICAL_KEYS = """
126:press:9 8:ccw:7 8:cw:8 4:ccw:F1 4:cw:F2 15:ccw:F3 15:cw:F4
9:ccw:F5 9:cw:F6 0:press:F7 3:press:F8 16:press:F9 19:press:F10
17:press:F11 18:press:F12 34:press:D 35:press:R 171:ccw:E 171:cw:F
59:ccw:1 59:cw:2 75:ccw:3 75:cw:4 69:ccw:G 69:cw:H 143:press:A
135:press:B 56:press:5 10:press:6 2:press:C 55:press:X 22:press:G
23:press:H 20:press:I 21:press:J
""".split()
ADDED_PHYSICAL_KEYS = """
1:press:V 14:ccw:G 14:cw:H 5:ccw:E 5:cw:F 11:ccw:N 11:cw:O
168:ccw:3 168:cw:4 6:ccw:1 6:cw:2 12:ccw:F5 12:cw:F6
169:ccw:3 169:cw:4 7:ccw:E 7:cw:F 13:ccw:G 13:cw:H
170:ccw:P 170:cw:Q 154:press:Y 156:press:Z 32:press:S 27:press:A
30:press:B 25:press:T 29:press:U 43:press:K 44:press:L 45:press:N
46:press:O 26:press:X
""".split()
RELEASE_SLOTS = {0, 1, 2, 3}
HUD_SLOTS = [15, 75, 9, 4, 59, 69, 171, 8, 170, 13, 7, 0, 3, 1, 55, 126, 20, 34, 35, 42]
MASTER_MENU = ("preview.status fader.status soundcheck preview.sync music.duck music.restore "
               "mix.status mix.fadeOut mix.restore recording.status capture.screenshot recording.chapter "
               "replay.save media.play bridge.reconnect transition.previous transition.next "
               "transition.shorter transition.longer overlay.show overlay.hide mic.mute "
               "vjster.status vjster.speed.reset vjster.quality.reset layer1.blend.reset layer2.blend.reset").split()
MASTER_NAME = "OBS Fadester for TourBox"


def require(ok, message):
    if not ok:
        raise ValueError(message)


def check_master(presets):
    require(list(presets) == ["master"], "Ship exactly one master preset; no alternate bank or backup")
    preset = presets["master"]
    require(preset["name"] == MASTER_NAME and preset["file"] == MASTER_NAME + ".tb" and
            preset["tourMenu"]["name"] == MASTER_NAME, "Master preset/file/menu name differs")
    bindings = preset["bindings"] + preset.get("menuBindings", [])
    actual = {b["hotkey"]: b["action"] for b in bindings}
    expected = {"Ctrl+Alt+Shift+" + key: action for key, action in ACTION_KEYS.items()} | VJ_KEYS
    require(len(expected) == 65 and actual == expected, "All 47 original and 18 VJ action/shortcut pairs must remain")
    require(all(actual[b["hotkey"]] == b["action"] for b in bindings), "Conflicting action/shortcut pair")
    physical = {(slot(b), b["gesture"]): b["hotkey"] for b in preset["bindings"]}
    fixed = {(int(i), gesture): key if "+" in key else "Ctrl+Alt+Shift+" + key
             for i, gesture, key in (row.split(":") for row in ORIGINAL_PHYSICAL_KEYS + ADDED_PHYSICAL_KEYS + VJ_PHYSICAL_KEYS)}
    require(len(preset["bindings"]) == 68 and physical == fixed,
            "Preserve the original 35 shortcuts, the approved 33 additions and the VJ layout's 17 reassignments")
    require({slot(b) for b in preset["bindings"] if b.get("mode") == "release"} == RELEASE_SLOTS and
            all(b.get("mode", "standard") in ("standard", "release") for b in preset["bindings"]),
            "Bare Side, Top, Tall and Short must use calibrated UP/release mode")
    for modifier in ("", "side+", "top+", "tall+", "short+"):
        for control in ("knob", "scroll", "dial"):
            require(all((ROTATE[modifier + control], direction) in physical for direction in ("ccw", "cw")),
                    f"Both directions required for {modifier + control}")
    require(all((i, "press") in physical for i in (25, 26, 27, 29, 30, 32)),
            "All six Side/Top/Tall/Short pairs must be assigned")
    require(len(preset["nativeBindings"]) == 2 and
            {(b["control"], b["gesture"], b["function"]) for b in preset["nativeBindings"]} ==
            {("tour", "press", "tourMenu"), ("side+tour", "press", "tourMenu")},
            "Tour and Side+Tour must open the same menu; preset switching is not allowed")
    require(preset["tourMenu"]["actions"] == MASTER_MENU, "Master menu must retain the full production action list")
    accessible = {b["action"] for b in preset["bindings"]} | set(preset["tourMenu"]["actions"])
    require(accessible == ALL_ACTIONS, "Every original and VJ action must be accessible on hardware or menu")
    require(hud_slots(preset) == HUD_SLOTS, "Preserve the curated 20-row HUD")


def slot(binding):
    control, gesture = binding["control"], binding["gesture"]
    require(gesture in {"press", "ccw", "cw"}, f"Unknown gesture {gesture}")
    return (PRESS if gesture == "press" else ROTATE)[control]


def key_block(hotkey):
    *mods, key = hotkey.split("+")
    # Modifiers in Console's order, at least two of them (a lone modifier would be a typing key on some layouts).
    require(len(mods) >= 2 and mods == [name for name in MODS if name in mods], f"Unexpected bridge modifiers in {hotkey}")
    if key in [f"F{i}" for i in range(1, 13)]:
        kind, code = 1, int(key[1:]) + 9
    else:
        require(len(key) == 1 and key.isascii() and (key.isupper() or key.isdigit()),
                f"Unsupported TourBox key {key}")
        kind, code = 0, ord(key)
    return bytes((sum(MODS[name] for name in mods), kind, 0, 0, code))


def shortcut_id(hotkey):
    mod, kind, _, _, key = key_block(hotkey)
    return mod, (kind << 24) | key


def labels_for(preset):
    labels = {}
    for binding in preset["bindings"] + preset.get("menuBindings", []):
        pair = shortcut_id(binding["hotkey"])
        require(pair not in labels or labels[pair] == binding["label"], f"Conflicting labels: {binding}")
        labels[pair] = binding["label"]
    return labels


def ints(parent, name, values):
    element = ET.SubElement(parent, name)
    for value in values:
        ET.SubElement(element, "int").text = str(value)


def fields(parent, **values):
    for name, value in values.items():
        ET.SubElement(parent, name).text = str(value)


def menu_keys(preset):
    actions = preset["tourMenu"]["actions"]
    require(actions and len(actions) == len(set(actions)), "Empty or duplicated menu action")
    by_action = {b["action"]: b["hotkey"] for b in preset["bindings"] + preset.get("menuBindings", [])}
    return [shortcut_id(by_action[action]) for action in actions]


def add_menu(root, preset):
    # Console's Resolve Workspaces menu follows the pointer and closes after selection.
    box = ET.SubElement(root, "tourMenuBox")
    fields(box, x=-1000, y=-1000)
    menu = ET.SubElement(ET.SubElement(box, "menus"), "TourMenu")
    fields(menu, id=0, name=preset["tourMenu"]["name"], style=2, lineH=28, lineW=200,
           wordSize=13, isFollowMouse=1, mousePosition=9)
    items = ET.SubElement(menu, "items")
    for mask, key in menu_keys(preset):
        fields(ET.SubElement(items, "TourMenuItem"), type=1, builtinId=0, macroId=0, mask=mask, natureKey=key)
    ET.SubElement(menu, "lengthWidths")
    fields(menu, isReside=0, alpha=255)
    ET.SubElement(box, "locations")
    ET.SubElement(box, "panels")
    fields(box, showAll="false", isCapsule="false", select="SCROLL", ok="A", close="B", adjust="WHEEL",
           reset="SWITCH", selectSpeed=1, selectVibrance=2, selectReverse=0, adjustSpeed=0,
           adjustVibrance=2, adjustReverse=0)


def hud_slots(preset):
    hud = preset["hud"]
    return [ROTATE[control] for control in hud["turn"]] + [PRESS[control] for control in hud["press"]]


def add_hud(root, preset):
    hud = ET.SubElement(root, "hudList")
    fields(hud, visible="false", x=-1, y=-1)
    fields(ET.SubElement(hud, "monitorArea"), x=0, y=0, width=1920, height=1080)
    fields(hud, sideHideMode=0, dockerShellSize=702, itemFontSize=11, itemWidth=245,
           alpha=204, toolBarAlpha=255, coverAlpha=51, style=1, distractionFree=0)
    ints(hud, "items", hud_slots(preset))


def add_sections(root, slots):
    # Preserve Console's standard layout sections. Put custom chords into its editable Custom Section.
    sections = [
        ("id821", "Rotating Section.html", [4, 55], [5, 6, 7, 8]),
        ("", "", [47, 48, 49, 50, 172, 173, 174, 175, 187, 188, 189, 190, 202, 203, 204, 205], []),
        ("", None, [9, 10], [11, 12, 13, 14]),
        ("", None, [15, 56], []),
        ("id822", "Prime Four Section.html", [1, 2, 51, 0, 3], [33, 31, 231, 24, 28, 32, 27, 30, 25, 29, 26]),
        ("id823", "Kit Section.html", [42, 16, 17, 18, 19, 34, 35], [43, 44, 45, 46, 20, 21, 22, 23, 36, 37, 57, 58]),
    ]
    listed = {i for _, _, shown, folded in sections for i in shown + folded}
    sections.append(("id3420", "Custom Section.html", sorted(slots - listed), []))
    config = ET.SubElement(root, "presetConf")
    categories = ET.SubElement(config, "category")
    for name, html, shown, folded in sections:
        row = ET.SubElement(categories, "TBCategory")
        ET.SubElement(row, "name").text = name
        if html is None:
            ET.SubElement(row, "shortDesc")
        else:
            ET.SubElement(row, "html").text = html
            ET.SubElement(row, "longDesc").text = "NONE"
        ints(row, "items", shown)
        ints(row, "foldItems", folded)
        ET.SubElement(row, "fold").text = "true"
    ET.SubElement(config, "ballConfigs")


def build(preset):
    records = [bytearray((i, ROTARY_FLAG if i in DEFAULT_ROTARIES else 0)) + bytearray(11)
               for i in range(COUNT)]
    used = set()
    for binding in preset["bindings"]:
        i, gesture = slot(binding), binding["gesture"]
        mode = binding.get("mode", "standard")
        require(mode in ("standard", "release") and (mode == "standard" or gesture == "press"),
                f"Release mode is supported only on a button press: {binding}")
        require((i, gesture) not in used, f"Duplicate binding: {binding}")
        used.add((i, gesture))
        if gesture != "press":
            records[i][1] = ROTARY_FLAG
        elif mode == "release":
            records[i][2] = RELEASE_MODE
        offset = 8 if gesture == "cw" else 3
        records[i][offset:offset + 5] = key_block(binding["hotkey"])
    for binding in preset["nativeBindings"]:
        i = slot(binding)
        require(binding["function"] in NATIVE_ACTIONS and binding["gesture"] == "press" and
                binding.get("mode", "standard") == "standard" and
                (i, "press") not in used, f"Invalid native binding: {binding}")
        used.add((i, "press"))
        records[i][1:] = NATIVE_ACTIONS[binding["function"]]
    root = ET.Element("TableTransfer")
    ET.SubElement(root, "version").text = "1.9"
    table = bytes.fromhex("06 02") + bytes(20) + b"".join(records)
    ET.SubElement(root, "configBytes").text = base64.b64encode(table).decode("ascii")
    shortcuts = ET.SubElement(root, "shortCuts")
    for (mod, key), label in labels_for(preset).items():
        entry = ET.SubElement(shortcuts, "ShortDesc")
        for tag, value in [("m", mod), ("s", key), ("d", label)]:
            ET.SubElement(entry, tag).text = str(value)
    add_menu(root, preset)
    ET.SubElement(root, "presetName").text = preset["name"]
    add_sections(root, {i for i, _ in used})
    add_hud(root, preset)
    ET.indent(root, space="  ")
    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=buffer, mode="wb", compresslevel=6, mtime=0) as packed:
        packed.write(ET.tostring(root, encoding="utf-8"))
    return buffer.getvalue()


def decode(data):
    root = ET.fromstring(gzip.decompress(data))
    require(root.tag == "TableTransfer" and root.findtext("version") == "1.9", "Expected a native 1.9 preset")
    table = base64.b64decode(root.findtext("configBytes"), validate=True)
    require(len(table) == HEADER_SIZE + COUNT * RECORD_SIZE, "Unexpected table length")
    require(root.find("macros") is None, "Unexpected macros")
    decoded = {}
    for expected, (i, flags, aux, first, second) in enumerate(struct.iter_unpack("BBB5s5s", table[HEADER_SIZE:])):
        require(i == expected, f"Misplaced slot {expected}")
        if aux == 4:
            require(flags == 0 and first == bytes.fromhex("00 15 00 00 00") and second == EMPTY, "Unknown built-in")
            decoded[i, "press"] = "switchPreset"
            continue
        require(aux in (0, RELEASE_MODE) and flags in (0, ROTARY_FLAG) and not (aux and flags),
                f"Unknown or incompatible mode flags in {i}")
        if first[0] == 0x20:
            require(flags == aux == 0 and first[1:] == bytes(4) and second == EMPTY,
                    f"Expected a press linking to menu 0 at {i}")
            decoded[i, "press"] = "tourMenu"
            continue
        for gesture, block in zip(("ccw", "cw") if flags else ("press", "unexpected"), (first, second)):
            if block == EMPTY:
                continue
            mods, kind, param, reserved, code = block
            require(gesture != "unexpected" and param == reserved == 0 and kind in (0, 1) and mods <= 14,
                    f"Unknown key action at {i}/{gesture}")
            key = f"F{code - 9}" if kind == 1 else chr(code)
            decoded[i, gesture] = "+".join([name for name, bit in MODS.items() if mods & bit] + [key])
    labels = {(int(s.findtext("m")), int(s.findtext("s"))): s.findtext("d")
              for s in root.findall("shortCuts/ShortDesc")}
    require(len(labels) == len(root.findall("shortCuts/ShortDesc")), "Duplicate ShortDesc")
    return root, decoded, labels


def check(preset, data):
    root, decoded, labels = decode(data)
    expected = {(slot(b), b["gesture"]): b["hotkey"] for b in preset["bindings"]}
    expected.update({(slot(b), "press"): b["function"] for b in preset["nativeBindings"]})
    require(root.findtext("presetName") == preset["name"] and expected == decoded and labels_for(preset) == labels,
            f"Saved bindings/labels differ from {preset['name']}")
    table = base64.b64decode(root.findtext("configBytes"), validate=True)
    release_slots = {slot(b) for b in preset["bindings"] if b.get("mode") == "release"}
    require({i for i in range(COUNT) if table[HEADER_SIZE + i * RECORD_SIZE + 2] == RELEASE_MODE} == release_slots,
            "Saved UP/release modes differ from the map")
    visible = {int(e.text) for e in root.findall("./presetConf/category/TBCategory/*/int")}
    require(all(i in visible for i, _ in expected), "Preset contains controls hidden from the editor")
    require(decoded.get((42, "press")) == decoded.get((150, "press")) == "tourMenu" and
            "switchPreset" not in decoded.values(), "Tour and Side+Tour must both open menu 0; no preset switching")
    menus = root.findall("tourMenuBox/menus/TourMenu")
    require(len(menus) == 1 and menus[0].findtext("id") == "0" and
            menus[0].findtext("name") == preset["tourMenu"]["name"] and menus[0].findtext("isReside") == "0",
            "Missing/mismatched TourMenu target")
    keys = []
    for item in menus[0].findall("items/TourMenuItem"):
        require([item.findtext(t) for t in ("type", "builtinId", "macroId")] == ["1", "0", "0"],
                "Expected a keyboard shortcut in TourMenu")
        keys.append((int(item.findtext("mask")), int(item.findtext("natureKey"))))
    require(keys == menu_keys(preset) and len(keys) == len(set(keys)) and all(labels.get(k) for k in keys),
            "TourMenu shortcuts or labels differ from the map")
    selected = [int(i.text) for i in root.findall("hudList/items/int")]
    require(selected == hud_slots(preset) and selected and len(selected) == len(set(selected)) and
            set(selected) <= {i for i, _ in decoded} and root.findtext("hudList/visible") == "false",
            "Expected hidden General HUD with unique assigned controls")


def localized_presets(presets, translations):
    master = presets["master"]
    actions = ALL_ACTIONS | {"native.tourMenu"}
    require(isinstance(translations, dict) and translations and "en" not in translations,
            "Expected translations separate from the English master")
    baseline, _, _ = decode(build(master))
    for entry in baseline.findall("shortCuts/ShortDesc"):
        entry.remove(entry.find("d"))
    baseline_xml = ET.tostring(baseline)
    for locale, labels in translations.items():
        require(re.fullmatch(r"[a-z]{2}(?:-[A-Z]{2})?", locale), f"Invalid locale: {locale}")
        require(isinstance(labels, dict) and labels.keys() == actions,
                f"{locale}: translate every action ID exactly once")
        require(all(isinstance(label, str) and label.strip() and not re.search(r"[\r\n]", label)
                    for label in labels.values()), f"{locale}: labels must be nonempty single lines")
        localized = deepcopy(presets)
        preset = localized["master"]
        for binding in preset["bindings"] + preset["menuBindings"]:
            binding["label"] = labels[binding["action"]]
        for binding in preset["nativeBindings"]:
            binding["label"] = labels["native.tourMenu"]
        check_master(localized)
        data = build(preset)
        check(preset, data)
        translated, _, _ = decode(data)
        for entry in translated.findall("shortCuts/ShortDesc"):
            entry.remove(entry.find("d"))
        require(baseline_xml == ET.tostring(translated),
                f"{locale}: translations must only change shortcut labels")
        yield locale, localized, data


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--check", action="store_true", help="validate the English preset without rewriting it")
    cli.add_argument("--reference", type=Path, help="also verify an existing OBS Scene Test.tb (Ctrl+Shift+F9/F10)")
    cli.add_argument("--localized-out", type=Path, help="write translated presets and maps into locale subfolders")
    args = cli.parse_args()
    if args.reference:
        _, records, labels = decode(args.reference.read_bytes())
        require(records == {(18, "press"): "Ctrl+Shift+F9", (19, "press"): "Ctrl+Shift+F10"} and
                labels == {(10, 0x1000012): "Kit Welcome", (10, 0x1000013): "Kit Visuals"}, "Reference mismatch")
    presets = json.loads((HERE / "map.json").read_text(encoding="utf-8"))["presets"]
    check_master(presets)
    require(not ({path.name for path in HERE.glob("*.tb")} - {MASTER_NAME + ".tb"}),
            "Remove superseded or backup native presets; ship only the master")
    assigned = {}
    for preset in presets.values():
        for binding in preset["bindings"] + preset.get("menuBindings", []):
            key = binding["hotkey"]
            require(assigned.setdefault(key, binding["action"]) == binding["action"], f"Bridge chord collision: {key}")
        out = HERE / preset["file"]
        data = build(preset)
        check(preset, data)
        if args.check:
            saved = out.read_bytes()
            check(preset, saved)
            require(gzip.decompress(saved) == gzip.decompress(data), f"Rebuild {out.name}")
        else:
            out.write_bytes(data)
        print(f"{out.name}: {len(preset['bindings'])} shortcuts, {len(preset['nativeBindings'])} native controls, "
              f"{len(menu_keys(preset))} menu items, {len(hud_slots(preset))} HUD rows")
    translations = json.loads((HERE / "locales.json").read_text(encoding="utf-8"))
    for locale, localized, data in localized_presets(presets, translations):
        if args.localized_out:
            folder = args.localized_out / locale
            folder.mkdir(parents=True, exist_ok=True)
            (folder / localized["master"]["file"]).write_bytes(data)
            (folder / "map.json").write_text(
                json.dumps({"version": 1, "presets": localized}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8")
        print(f"{locale}: all shortcut labels verified against the master")


if __name__ == "__main__":
    main()
