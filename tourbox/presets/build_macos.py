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
WINDOWS_MASK = 0x0E
MAC_MASK = 0x07  # Control=1, Shift=2, Option=4; Command=8 must be absent.


def pack(root):
    result = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=result, mode="wb", compresslevel=6, mtime=0) as stream:
        stream.write(ET.tostring(root, encoding="utf-8"))
    return result.getvalue()


def convert_masks(root, preset, before, after):
    """Change only keyboard modifier fields, including labels and TourMenu targets."""
    table = bytearray(base64.b64decode(root.findtext("configBytes"), validate=True))
    windows.require(len(table) == windows.HEADER_SIZE + windows.COUNT * windows.RECORD_SIZE, "Unexpected control-table size")
    for binding in preset["bindings"]:
        offset = windows.HEADER_SIZE + windows.slot(binding) * windows.RECORD_SIZE + (8 if binding["gesture"] == "cw" else 3)
        windows.require(table[offset] == before, "Unexpected physical shortcut modifier")
        table[offset] = after
    root.find("configBytes").text = base64.b64encode(table).decode("ascii")
    fields = root.findall("shortCuts/ShortDesc/m") + root.findall("tourMenuBox/menus/TourMenu/items/TourMenuItem/mask")
    windows.require(len(root.findall("shortCuts/ShortDesc/m")) == 47, "Expected all 47 shortcut labels")
    windows.require(len(root.findall("tourMenuBox/menus/TourMenu/items/TourMenuItem/mask")) == 22, "Expected all 22 menu shortcuts")
    for field in fields:
        windows.require(int(field.text) == before, "Unexpected label/menu shortcut modifier")
        field.text = str(after)


def build(preset):
    root = ET.fromstring(gzip.decompress(windows.build(preset)))
    convert_masks(root, preset, WINDOWS_MASK, MAC_MASK)
    return pack(root)


def check(preset, data):
    root = ET.fromstring(gzip.decompress(data))
    convert_masks(root, preset, MAC_MASK, WINDOWS_MASK)
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
    print(f"{OUTPUT.relative_to(HERE)}: 68 physical shortcuts, 47 actions, 22 menu entries; Control+Option+Shift (no Command)")


if __name__ == "__main__":
    main()
