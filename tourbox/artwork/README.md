# OBS Fadester for TourBox artwork

The single 1600 × 900 cover represents the **OBS Fadester for TourBox** native preset: **Scenes • Audio • Media • Production tools**. It is suitable for the preset guide, release page, and gallery fields that accept landscape images. Use the PNG for uploads and the SVG for scalable display. The SVG includes an accessible title and description.

| Files | Alternative text |
| --- | --- |
| `master-cover.svg`, `master-cover.png` | OBS Fadester for TourBox. One native preset for scenes, audio, media and production tools. Program and Preview scene frames sit above a manual fader, beside four labeled control icons. |

## Category icons

The `icons` folder contains a 256 × 256 SVG and transparent PNG for each category. Display them beside text in the guide or companion panel. Use an empty image alt attribute when the adjacent label already names the category.

| Filename stem | Label |
| --- | --- |
| `scenes` | Scenes |
| `fade` | Studio fade |
| `audio` | Audio mix |
| `media` | Media playback |
| `overlay` | Layers and overlay |
| `capture` | Capture and replay |
| `transition` | Transition settings |
| `diagnostics` | Connection and status |

The scene frames, fader wordmark and pictograms are original vector drawings. Amber and mint distinguish Program and Preview; text labels and shapes also communicate their roles independently of color. All controls belong to one preset, with production actions available through its native Tour menu. TourBox Console renders the actual assignments from the native preset file. The original eight category icons are preserved.

## Rebuild

With Python and PyMuPDF installed, run the following from the repository root. The generator writes only inside this directory. The check validates the SVG masters and the dimensions of all PNG exports.

```shell
python tourbox/artwork/generate.py
python tourbox/artwork/generate.py --check
```
