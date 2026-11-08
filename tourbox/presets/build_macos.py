# SPDX-License-Identifier: GPL-2.0-or-later
"""Generate the experimental macOS master without changing the Windows preset."""

import argparse
import base64
import gzip
import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import build as windows


HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "macos" / (windows.MASTER_NAME + ".tb")
# Console stores keyboard modifiers as a bit mask whose bits differ by platform.
# Windows (build.py MODS): Ctrl=8, Alt=4, Shift=2. Mac: Control=1, Shift=2,
# Option=4, Command=8. The conversion goes bit by bit, so the OBS actions'
# Ctrl+Alt+Shift (14) becomes Control+Option+Shift (7), the video and layer
# actions' Ctrl+Shift (10) becomes Control+Shift (3) and Alt+Shift stays
# Option+Shift (6). Command never appears: a Mac mask with bit 8 set, or a
# Windows mask with bit 1 set, is rejected, which also catches a file converted
# twice.
WINDOWS_BITS = {"Ctrl": 8, "Alt": 4, "Shift": 2}
MAC_BITS = {"Ctrl": 1, "Alt": 4, "Shift": 2}
WINDOWS_MASK = 0x0E  # Ctrl+Alt+Shift, the chord of the OBS actions
MAC_MASK = 0x07  # Control+Option+Shift; Command=8 must be absent.


def remap(mask, source, target):
    """Translate one modifier mask between the two platform encodings."""
    names = [name for name, bit in source.items() if mask & bit]
    windows.require(mask == sum(source[name] for name in names) and len(names) >= 2,
                    f"Unexpected shortcut modifier mask {mask}")
    return sum(target[name] for name in names)


def to_mac(mask):
    return remap(mask, WINDOWS_BITS, MAC_BITS)


def to_windows(mask):
    return remap(mask, MAC_BITS, WINDOWS_BITS)


def pack(root):
    result = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=result, mode="wb", compresslevel=6, mtime=0) as stream:
        stream.write(ET.tostring(root, encoding="utf-8"))
    return result.getvalue()


def convert_masks(root, preset, convert):
    """Change only keyboard modifier fields: the physical table, the labels and the TourMenu targets."""
    table = bytearray(base64.b64decode(root.findtext("configBytes"), validate=True))
    windows.require(len(table) == windows.HEADER_SIZE + windows.COUNT * windows.RECORD_SIZE, "Unexpected control-table size")
    for binding in preset["bindings"]:
        offset = windows.HEADER_SIZE + windows.slot(binding) * windows.RECORD_SIZE + (8 if binding["gesture"] == "cw" else 3)
        table[offset] = convert(table[offset])
    root.find("configBytes").text = base64.b64encode(table).decode("ascii")
    labels = root.findall("shortCuts/ShortDesc/m")
    menu = root.findall("tourMenuBox/menus/TourMenu/items/TourMenuItem/mask")
    windows.require(len(labels) == len(windows.labels_for(preset)), "Shortcut labels differ from the map")
    windows.require(len(menu) == len(windows.menu_keys(preset)), "Menu shortcuts differ from the map")
    for field in labels + menu:
        field.text = str(convert(int(field.text)))


def build(preset):
    root = ET.fromstring(gzip.decompress(windows.build(preset)))
    convert_masks(root, preset, to_mac)
    return pack(root)


def check(preset, data):
    root = ET.fromstring(gzip.decompress(data))
    convert_masks(root, preset, to_windows)
    normalized = pack(root)
    windows.check(preset, normalized)
    windows.require(gzip.decompress(normalized) == gzip.decompress(windows.build(preset)),
                    "Mac preset differs from the canonical master beyond modifier encoding")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify the saved Mac master without writing")
    args = parser.parse_args()
    presets = json.loads((HERE / "map.json").read_text(encoding="utf-8"))["presets"]
    windows.check_master(presets)
    preset = presets["master"]
    candidate = build(preset)
    check(preset, candidate)
    if args.check:
        check(preset, OUTPUT.read_bytes())
        windows.require(OUTPUT.read_bytes() == candidate, "Rebuild the Mac master")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_bytes(candidate)
    root = ET.fromstring(gzip.decompress(candidate))
    masks = sorted({int(e.text) for e in root.findall("shortCuts/ShortDesc/m")})
    print(f"{OUTPUT.relative_to(HERE)}: {len(preset['bindings'])} physical shortcuts, "
          f"{len(root.findall('shortCuts/ShortDesc'))} labels, "
          f"{len(root.findall('tourMenuBox/menus/TourMenu/items/TourMenuItem'))} menu entries; "
          f"Mac modifier masks {masks} (no Command)")


if __name__ == "__main__":
    main()
