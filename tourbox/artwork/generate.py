# SPDX-License-Identifier: GPL-2.0-or-later
"""Original Fadester cover and category artwork. Render PNGs with PyMuPDF."""

from html import escape
from pathlib import Path
from xml.etree import ElementTree
import argparse

import pymupdf


HERE = Path(__file__).resolve().parent
INK, PANEL, LINE = "#112821", "#19372E", "#46665C"
PAPER, SECONDARY, WARM, COOL = "#F8F4E5", "#C0D1C6", "#FFBC74", "#8BE0C4"
FONT = "Arial,Helvetica,sans-serif"
MONO = "Courier New,Courier,monospace"


def text(x, y, value, size, fill=PAPER, weight="normal", font=FONT):
    return (f'<text x="{x}" y="{y}" fill="{fill}" font-family="{font}" '
            f'font-size="{size}" font-weight="{weight}">{escape(value)}</text>')


def rect(x, y, w, h, fill, stroke="none", radius=0, width=1):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{width}"/>')


def line(x1, y1, x2, y2, color, width=1):
    return f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{width}"/>'


def svg(width, height, viewbox, title, description, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {viewbox}" role="img" aria-labelledby="title desc">\n'
            f'<title id="title">{escape(title)}</title>\n<desc id="desc">{escape(description)}</desc>\n'
            + "\n".join(body) + '\n</svg>\n')


# Each pictogram is a 24-unit open-stroke drawing. Shape carries the meaning at small sizes.
GLYPHS = {
    "scenes": ("Scenes", '<rect x="2" y="4" width="14" height="11" rx="1.5"/><path d="M7 18h11a2 2 0 0 0 2-2V9M10 21h8M8 9l3 2-3 2z"/>'),
    "fade": ("Studio fade", '<path d="M3 16h18M5 13v6m14-6v6M9 4h6v4H9zM12 8v8"/><circle cx="12" cy="16" r="2"/>'),
    "audio": ("Audio mix", '<path d="M5 3v7m0 5v6m7-18v12m0 4v2m7-18v3m0 4v11"/><path d="M2.5 10h5v4h-5zM9.5 15h5v4h-5zM16.5 6h5v4h-5z"/>'),
    "media": ("Media playback", '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m8 8 6 4-6 4zm9 0v8"/>'),
    "overlay": ("Layers and overlay", '<path d="m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5"/>'),
    "capture": ("Capture and replay", '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/><circle cx="12" cy="12" r="4"/>'),
    "transition": ("Transition settings", '<path d="M3 7h4c4 0 5 10 10 10h4m-4-3 4 3-4 3M3 17h4c1.4 0 2.5-1.8 3.5-3.5M14 9c1-1.5 2-2 3-2h4m-4-3 4 3-4 3"/>'),
    "diagnostics": ("Connection and status", '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M4 13h4l2-5 3 9 2-5h5"/>'),
}


def glyph(name, x, y, scale, color):
    return (f'<g transform="translate({x} {y}) scale({scale})" fill="none" stroke="{color}" '
            f'stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">{GLYPHS[name][1]}</g>')


def icon(name):
    label = GLYPHS[name][0]
    color = WARM if name in {"scenes", "fade", "audio"} else COOL
    return svg(256, 256, "64 64", label, f"Fadester category icon for {label.lower()}.", [
        rect(2, 2, 60, 60, INK, LINE, 13, 2), glyph(name, 11.5, 11.5, 1.7, color)])


def wordmark():
    # Three rising fader stems, each with its own crossbar.
    return [line(60, 48, 60, 79, WARM, 3), line(69, 48, 69, 79, COOL, 3), line(78, 48, 78, 79, PAPER, 3),
            rect(56, 64, 8, 5, WARM), rect(65, 55, 8, 5, COOL), rect(74, 51, 8, 5, PAPER),
            text(96, 73, "FADESTER", 29, PAPER, "bold")]


def scene_fader_drawing():
    # An abstract pair of cues, then the mechanical path between them.
    out = [text(582, 195, "A  /  PROGRAM", 15, WARM, "bold", MONO),
           text(868, 195, "B  /  PREVIEW", 15, COOL, "bold", MONO),
           rect(582, 216, 246, 150, "#ECAD70"), rect(868, 216, 246, 150, "#8CCBB2"),
           '<circle cx="756" cy="258" r="22" fill="#FCE9BA"/>',
           '<path d="M582 328l57-65 48 51 32-33 109 85H582z" fill="#8C5C49"/>',
           '<path d="M582 344l37-23 26 8 59-25 63 22 61-10v50H582z" fill="#59453A"/>',
           '<path d="M868 325c38-42 51-66 77-56s51 70 81 34 52-26 88-62v125H868z" fill="#477E71"/>',
           '<path d="M868 349c48-30 67-57 110-36s69 42 136-9v62H868z" fill="#326458"/>',
           line(582, 405, 1114, 405, LINE), text(582, 436, "MANUAL DISSOLVE", 14, SECONDARY, "bold", MONO)]
    for n in range(25):
        x = 590 + n * 21.5
        out.append(line(x, 452, x, 465 if n % 4 == 0 else 459, SECONDARY))
    out += [rect(584, 478, 528, 9, "#0D201B", LINE, 4.5),
            rect(788, 465, 63, 34, WARM, "#F2D7AD", 5), line(817, 469, 817, 495, "#6D4E35", 2),
            line(822, 469, 822, 495, "#6D4E35", 2)]
    return out


def cover():
    title = "OBS Fadester for TourBox"
    desc = ("One native TourBox preset for scenes, audio, media and production tools. "
            "An amber Program frame and mint Preview frame sit above a manual fader. "
            "Four labeled pictograms identify scene, audio, media and production controls.")
    out = [rect(0, 0, 1200, 675, INK), *wordmark(),
           text(913, 69, "ONE NATIVE PRESET", 18, SECONDARY, "bold", MONO),
           line(56, 99, 1144, 99, LINE), text(58, 186, "LIVE PRODUCTION", 18, WARM, "bold", MONO),
           text(55, 270, "OBS Fadester", 63, PAPER, "bold"),
           text(55, 340, "for TourBox", 63, PAPER, "bold"),
           text(60, 397, "Cue scenes. Ride the mix.", 28, SECONDARY),
           text(60, 435, "Turn, press, hold Side.", 23, SECONDARY),
           rect(550, 149, 594, 383, PANEL, LINE, 8), *scene_fader_drawing(),
           line(56, 572, 1144, 572, LINE),
           text(58, 615, "Scenes • Audio • Media • Production tools", 30, PAPER, "bold"),
           text(58, 648, "Native Tour menu  /  Windows companion", 16, SECONDARY, "normal", MONO)]
    for x, name, label in [(60, "scenes", "Scenes"), (174, "audio", "Audio"),
                            (288, "media", "Media"), (402, "capture", "Tools")]:
        out += [glyph(name, x, 472, 1.45, WARM if name in {"scenes", "audio"} else COOL),
                text(x, 529, label, 16, SECONDARY, "bold")]
    return svg(1600, 900, "1200 675", title, desc, out)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--check", action="store_true", help="check the SVG masters and PNG dimensions without writing")
    args = cli.parse_args()
    assets = {"master-cover": cover()}
    assets.update({f"icons/{key}": icon(key) for key in GLYPHS})
    for stem, content in assets.items():
        source = HERE / (stem + ".svg")
        image = HERE / (stem + ".png")
        xml = ElementTree.fromstring(content)
        size = (int(xml.attrib["width"]), int(xml.attrib["height"]))
        if args.check:
            if source.read_text(encoding="utf8") != content:
                raise SystemExit(f"Rebuild {source.name}")
            png = pymupdf.Pixmap(str(image))
            if (png.width, png.height) != size:
                raise SystemExit(f"Unexpected dimensions for {image.name}")
        else:
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text(content, encoding="utf8")
            with pymupdf.open(stream=content.encode(), filetype="svg") as document:
                page = document[0]
                scale = pymupdf.Matrix(size[0] / page.rect.width, size[1] / page.rect.height)
                page.get_pixmap(matrix=scale, alpha=stem.startswith("icons/")).save(str(image))
        print(f"{stem}  {size[0]} x {size[1]}")


if __name__ == "__main__":
    main()
