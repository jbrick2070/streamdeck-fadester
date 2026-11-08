# SPDX-License-Identifier: GPL-2.0-or-later
"""Suite Demo Kit: the scene collection (plan step 2). Standard library only.

kit-ids.json is the single source of truth for every name, kind and UUID the Stream Deck
profiles bind to: the six scenes in order (keys bind by __scene_index_N__), each scene's
items with their fixed item ids, every source and every filter. This module adds what a
profile never binds to: settings, transforms and texts, and from both it writes the draft
collection.

The draft is what the builder authors. A portable OBS 33 loads it and saves it back (the
round-trip in kit_obs.py), so the shipped file holds every key OBS itself writes (hotkeys,
relative coordinates, versioned ids, canvas). normalise() then turns that saved file into
kit-template.json: the round-trip's absolute media paths become ./ paths again, and
Playlister's resume state is dropped (see below). diff_draft() proves OBS kept every value
the draft set, apart from prev_ver; check_template() is the check the committed template
must pass (and the test suite runs it).

UUIDs: sha256("suite-demo-kit:" + seed), the first 16 bytes with the RFC 4122 version 4 and
variant bits set, like stableUuid in scripts/profile-checks.ts. The seed is the source's
name; a filter's seed is "<source name>/<filter name>".

Where the code's reality differs from the plan (demo-kit-plan-r1.md, sections 3 and 5):
- Playlister saves its resume state (current_file_name, current_row_uuid, current_item_key,
  current_item_occurrence, current_media_index) on every save. current_file_name holds the
  round-trip's absolute path in the middle of a string ("1-3: C:/..."), which the importer's
  ./ rewrite cannot reach, so these keys are dropped and the kit starts at the first row.
  That is the one post-processing step besides ./ paths and UUIDs.
- Kit Beat is an item in scenes 2-6 (Fable review, plan section 15 item 2), so the beat
  dial and the looks' named tap hear it on every page; Kit Clips 50% has one row, the
  hurdles clip.
- Kit Credits (the clip credits) is in scenes 1, 4 and 5; scene 6 carries the Big Buck
  Bunny line in Speed Page Note.
- K.6 (the operator's decisions of 2026-11-01): real footage everywhere. Kit Motion (the
  Visuals base under the three looks and the Audio Modulator) is the train clip, Layer A
  the sprint and Layer B the hurdles, each full canvas, looping and muted (their audio was
  removed in the media step anyway); the generated loops are no longer made. The source
  names and UUIDs stay, so the profiles the operator imported keep working. Kit Playlister
  is one full-frame Playlister (Kit Clips); the 50 % copy has its own scene, Kit Playlister
  50% (a scene cannot share the source's name "Kit Clips 50%"), so Studio Mode cues and
  fades it like any other. No side-by-side anywhere; every media item is the whole canvas.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
from pathlib import Path

KIT_DIR = Path(__file__).resolve().parent
IDS_PATH = KIT_DIR / "kit-ids.json"
TEMPLATE_PATH = KIT_DIR / "kit-template.json"

COLLECTION_NAME = "Suite Demo Kit"
CANVAS = (1920, 1080)
# OBS 33.0.0 as MAKE_SEMANTIC_VERSION(33, 0, 0); the draft's prev_ver, so obs.c reads
# monitoring_enabled from the file instead of deriving it from monitoring_type (plan 2.1).
OBS_33 = 33 << 24
UUID_PREFIX = "suite-demo-kit:"

# Every file the collection points at, relative to the folder holding the collection.
MEDIA_FILES = ["media/kit-title.png", "media/kit-beat.ogg", "media/clip-hurdles.mp4", "media/clip-sprint.mp4",
               "media/clip-train.mp4"]
SETUP_CARD = "vjster-setup.html"
KIT_FILES = [*MEDIA_FILES, SETUP_CARD]

BEAT_DB = -12.0  # D-7: monitor and output at -12 dB
PLAYLISTER_RESUME_KEYS = ["current_file_name", "current_item_key", "current_item_occurrence",
                          "current_media_index", "current_row_uuid"]

FONT = "Segoe UI"
WHITE = 0xFFFFFF  # text_gdiplus colours are 0xBBGGRR
BACKGROUND = 0xFF2A1A12  # color_source colours are 0xAABBGGRR: #121A2A

TEXTS = {
    "Kit Note": "Press a key: each page of the deck drives one scene",
    "Kit Credits": ("Clips: \u201c100 metres hurdles\u201d by FISUTV, CC BY 3.0 \u00b7 \u201cWomen's 100M Final - "
                    "28th Summer Universiade 2015 Gwangju\u201d by FISUTV, CC BY 3.0 \u00b7 \u201cT3 Train Crossing "
                    "Cooks River\u201d by Unyxium, CC BY 4.0 \u00b7 via Wikimedia Commons \u00b7 cut and re-encoded "
                    "\u00b7 full credits in CREDITS.md"),
    # One short line each (K.6): the clips fill the frame, the note sits over them at the top.
    "Speed Note 100": "100 %: the three clips. Previous, Play / pause and Next act on this Playlister.",
    "Speed Note 50": "50 %: the hurdles clip. Playlister speed is a setting: changing it restarts the clip.",
    "Speed Page Note": ("VJster: speed from the deck, 0.25x to 2x, live in OBS\n"
                        "Big Buck Bunny \u00b7 Blender Foundation \u00b7 CC BY 3.0 \u00b7 played from YouTube, "
                        "not included"),
}
# Each text's box (width, height) and font size; the box is the source's extents.
TEXT_BOXES = {
    "Kit Note": (1600, 120, 56),
    "Kit Credits": (1800, 140, 28),
    "Speed Note 100": (1800, 60, 30),
    "Speed Note 50": (1800, 60, 30),
    "Speed Page Note": (1600, 160, 36),
}

TAP = {"tap_mode": 7, "tap_source_name": "Kit Beat", "react_when_muted": True,
       "vs_effect_mix_pct": 100.0, "vs_audio_reactivity_pct": 100.0}


def _modulator_slot(n: int, setting: str, signal: int, low: float, high: float) -> dict:
    """One Audio Modulator slot on Color Correction, as the reel's working setup (Reel.json:383-388)."""
    return {f"slot_{n}_enabled": True, f"slot_{n}_target_filter": "Color Correction",
            f"slot_{n}_target_setting": setting, f"slot_{n}_seeded_target": f"Color Correction::{setting}",
            f"slot_{n}_signal": signal, f"slot_{n}_amount_pct": 100.0,
            f"slot_{n}_min_value": low, f"slot_{n}_max_value": high}


# Settings and "enabled" per filter, keyed "<source>/<filter>".
FILTERS = {
    "Kit Motion/Color Correction": ({"contrast": 0.0, "saturation": 0.0, "hue_shift": 0.0}, True),
    "Kit Motion/Look Prism": ({**TAP, "preset_shader": "fft-chromatic-prism-bloom.shader",
                               "prism_dispersion": 0.4, "bloom_intensity": 0.85, "bloom_threshold": 0.55,
                               "hue_shift_amount": 0.25}, True),
    "Kit Motion/Look Kaleido": ({**TAP, "preset_shader": "fft-kaleidoscope.shader"}, False),
    "Kit Motion/Look Pulse": ({**TAP, "preset_shader": "fft-zoom-pulse.shader"}, False),
    "Kit Motion/Audio Modulator": ({"tap_mode": 7, "tap_source_name": "Kit Beat", "react_when_muted": True,
                                    **_modulator_slot(1, "hue_shift", 2, -140.0, 140.0),
                                    **_modulator_slot(2, "contrast", 5, 0.0, 1.1)}, True),
    "Layer A/Layer Fade": ({"opacity": 1.0}, True),
    "Layer B/Layer Fade": ({"opacity": 1.0}, True),
}


def _text(name: str) -> dict:
    cx, cy, size = TEXT_BOXES[name]
    return {"text": TEXTS[name], "font": {"face": FONT, "size": size, "style": "Regular", "flags": 0},
            "color": WHITE, "align": "center", "valign": "center", "extents": True, "extents_cx": cx,
            "extents_cy": cy, "extents_wrap": True}


def _playlist(*names: str) -> list[dict]:
    return [{"uuid": f"kit-{n}", "value": f"./media/clip-{n}.mp4"} for n in names]


# Source settings, with every path as a ./ path relative to the collection's folder.
SETTINGS = {
    "Kit Background": {"color": BACKGROUND, "width": CANVAS[0], "height": CANVAS[1]},
    "Kit Title": {"file": "./media/kit-title.png"},
    **{name: _text(name) for name in TEXTS},
    "Kit Beat": {"is_local_file": True, "local_file": "./media/kit-beat.ogg", "looping": True,
                 "restart_on_activate": False},
    # Real footage (K.6): the train under the looks, the sprint and the hurdles as the layers.
    "Kit Motion": {"is_local_file": True, "local_file": "./media/clip-train.mp4", "looping": True,
                   "restart_on_activate": False},
    "Layer A": {"is_local_file": True, "local_file": "./media/clip-sprint.mp4", "looping": True,
                "restart_on_activate": False},
    "Layer B": {"is_local_file": True, "local_file": "./media/clip-hurdles.mp4", "looping": True,
                "restart_on_activate": False},
    # visibility_behavior 0 is stop/restart, so each copy restarts when its scene shows.
    "Kit Clips": {"playlist": _playlist("hurdles", "sprint", "train"), "loop": True, "speed_percent": 100,
                  "visibility_behavior": 0},
    "Kit Clips 50%": {"playlist": _playlist("hurdles"), "loop": True, "speed_percent": 50,
                      "visibility_behavior": 0},
    "Speed Page": {"is_local_file": True, "local_file": f"./{SETUP_CARD}", "width": 1280, "height": 720},
}

# Item transforms per scene: (x, y) of the top-left corner and, for a bounded item, the box it
# is scaled into (OBS_BOUNDS_SCALE_INNER). Unbounded items keep their own size. Every media
# item is FULL, the whole canvas (K.6: full frame, no 2-up); the notes and credits sit over it.
FULL = ((0, 0), CANVAS)
# The three real-footage sources and the two Playlisters: all full frame, in every scene.
FULL_FRAME_SOURCES = ["Kit Motion", "Layer A", "Layer B", "Kit Clips", "Kit Clips 50%"]
# Sources whose audio is muted in the collection (their clips have no audio stream anyway).
MUTED_SOURCES = ["Kit Motion", "Layer A", "Layer B"]
LAYOUT = {
    "Kit Welcome": {"Kit Background": FULL, "Kit Title": ((320, 200), None), "Kit Note": ((160, 600), None),
                    "Kit Credits": ((60, 900), None)},
    "Kit Visuals": {"Kit Motion": FULL, "Kit Beat": ((0, 0), None)},
    "Kit Layers": {"Layer A": FULL, "Layer B": FULL, "Kit Beat": ((0, 0), None)},
    "Kit Playlister": {"Kit Background": FULL, "Kit Clips": FULL, "Speed Note 100": ((60, 40), None),
                       "Kit Credits": ((60, 900), None), "Kit Beat": ((0, 0), None)},
    "Kit Playlister 50%": {"Kit Background": FULL, "Kit Clips 50%": FULL, "Speed Note 50": ((60, 40), None),
                           "Kit Credits": ((60, 900), None), "Kit Beat": ((0, 0), None)},
    "Kit Speed Page": {"Kit Background": FULL, "Speed Page": ((320, 100), (1280, 720)),
                       "Speed Page Note": ((160, 850), None), "Kit Beat": ((0, 0), None)},
}


# ---------------------------------------------------------------- ids

def kit_uuid(seed: str) -> str:
    """A fixed v4-format UUID for a kit name (see the module docstring)."""
    raw = bytearray(hashlib.sha256((UUID_PREFIX + seed).encode("utf-8")).digest()[:16])
    raw[6] = (raw[6] & 0x0F) | 0x40
    raw[8] = (raw[8] & 0x3F) | 0x80
    h = raw.hex()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def load_ids(path: Path = IDS_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def ids_problems(ids: dict) -> list[str]:
    """Everything wrong with kit-ids.json: UUIDs off the rule, duplicates, dangling items."""
    problems: list[str] = []
    names: set[str] = set()
    uuids: set[str] = set()

    def claim(name: str, uuid: str, seed: str) -> None:
        if name in names:
            problems.append(f"name used twice: {name}")
        names.add(name)
        if uuid in uuids:
            problems.append(f"uuid used twice: {uuid}")
        uuids.add(uuid)
        if uuid != kit_uuid(seed):
            problems.append(f"{seed}: uuid {uuid} is not kit_uuid({seed!r}) = {kit_uuid(seed)}")

    sources = {s["name"]: s for s in ids["sources"]}
    for source in ids["sources"]:
        claim(source["name"], source["uuid"], source["name"])
        if source["name"] not in SETTINGS:
            problems.append(f"{source['name']}: no SETTINGS entry in kit_collection.py")
        filter_names = set()
        for f in source.get("filters", []):
            if f["name"] in filter_names:
                problems.append(f"{source['name']}: filter name used twice: {f['name']}")
            filter_names.add(f["name"])
            seed = f"{source['name']}/{f['name']}"
            if f["uuid"] in uuids:
                problems.append(f"uuid used twice: {f['uuid']}")
            uuids.add(f["uuid"])
            if f["uuid"] != kit_uuid(seed):
                problems.append(f"{seed}: uuid {f['uuid']} is not kit_uuid({seed!r})")
            if seed not in FILTERS:
                problems.append(f"{seed}: no FILTERS entry in kit_collection.py")
    listed_filters = {f"{s['name']}/{f['name']}" for s in ids["sources"] for f in s.get("filters", [])}
    for seed in sorted(set(FILTERS) - listed_filters):
        problems.append(f"FILTERS entry {seed} is no filter in kit-ids.json")
    for index, scene in enumerate(ids["scenes"]):
        claim(scene["name"], scene["uuid"], scene["name"])
        if scene.get("index") != index:
            problems.append(f"scene {scene['name']}: index {scene.get('index')} but position {index}")
        item_ids = [item["id"] for item in scene["items"]]
        if len(set(item_ids)) != len(item_ids):
            problems.append(f"scene {scene['name']}: item id used twice")
        if item_ids != list(range(1, len(item_ids) + 1)):
            problems.append(f"scene {scene['name']}: item ids are not 1..{len(item_ids)} in order")
        layout = LAYOUT.get(scene["name"])
        if layout is None:
            problems.append(f"scene {scene['name']}: no LAYOUT entry in kit_collection.py")
            layout = {}
        for item in scene["items"]:
            if item["source"] not in sources:
                problems.append(f"scene {scene['name']}: item {item['id']} names no kit source: {item['source']}")
            if item["source"] not in layout:
                problems.append(f"scene {scene['name']}: item {item['id']} ({item['source']}) has no LAYOUT entry")
            elif item["source"] in FULL_FRAME_SOURCES and layout[item["source"]] != FULL:
                problems.append(f"scene {scene['name']}: {item['source']} is not full frame (K.6: no 2-up)")
        for name in sorted(set(layout) - {item["source"] for item in scene["items"]}):
            problems.append(f"scene {scene['name']}: LAYOUT entry {name} is no item of the scene")
    for name in sorted(set(LAYOUT) - {scene["name"] for scene in ids["scenes"]}):
        problems.append(f"LAYOUT entry {name} is no scene in kit-ids.json")
    return problems


# ---------------------------------------------------------------- the draft

def with_root(value, root: str | None):
    """Replace a leading ./ in every string with root + "/" (the round-trip needs real paths)."""
    if isinstance(value, dict):
        return {k: with_root(v, root) for k, v in value.items()}
    if isinstance(value, list):
        return [with_root(v, root) for v in value]
    if isinstance(value, str) and root is not None and value.startswith("./"):
        return root.rstrip("/\\").replace("\\", "/") + "/" + value[2:]
    return value


def beat_volume() -> float:
    return 10 ** (BEAT_DB / 20)


def _source_common(volume: float = 1.0, monitoring_type: int = 0, muted: bool = False) -> dict:
    return {"prev_ver": OBS_33, "volume": volume, "muted": muted, "monitoring_type": monitoring_type,
            "monitoring_enabled": monitoring_type != 0}


def _item(item: dict, scene_name: str, uuid: str) -> dict:
    (x, y), box = LAYOUT[scene_name][item["source"]]
    entry = {"name": item["source"], "source_uuid": uuid, "id": item["id"], "visible": True, "locked": False,
             "pos": {"x": float(x), "y": float(y)}, "scale": {"x": 1.0, "y": 1.0}, "rot": 0.0, "align": 5}
    if box is None:
        entry.update(bounds_type=0, bounds_align=0)
    else:
        entry.update(bounds_type=2, bounds_align=0, bounds={"x": float(box[0]), "y": float(box[1])})
    return entry


def draft_collection(ids: dict, root: str | None = None) -> dict:
    """The collection the builder authors: ./ paths, or root-based paths when root is given."""
    sources_out = []
    uuids = {s["name"]: s["uuid"] for s in ids["sources"]}
    for source in ids["sources"]:
        name = source["name"]
        beat = name == "Kit Beat"
        entry = {"name": name, "uuid": source["uuid"], "id": source["id"], "versioned_id": source["versioned_id"],
                 "settings": copy.deepcopy(SETTINGS[name]),
                 **_source_common(beat_volume() if beat else 1.0, 2 if beat else 0, name in MUTED_SOURCES)}
        if source.get("filters"):
            entry["filters"] = []
            for f in source["filters"]:
                settings, enabled = FILTERS[f"{name}/{f['name']}"]
                entry["filters"].append({"name": f["name"], "uuid": f["uuid"], "id": f["id"],
                                         "versioned_id": f["versioned_id"], "settings": copy.deepcopy(settings),
                                         "enabled": enabled, "prev_ver": OBS_33})
        sources_out.append(entry)
    for scene in ids["scenes"]:
        items = [_item(item, scene["name"], uuids[item["source"]]) for item in scene["items"]]
        sources_out.append({"name": scene["name"], "uuid": scene["uuid"], "id": "scene", "versioned_id": "scene",
                            "settings": {"id_counter": len(items), "custom_size": False, "items": items},
                            **_source_common()})
    first = ids["scenes"][0]["name"]
    draft = {"name": ids["collection"], "current_scene": first, "current_program_scene": first,
             "scene_order": [{"name": s["name"]} for s in ids["scenes"]], "sources": sources_out,
             "groups": [], "transitions": [], "current_transition": "Fade", "transition_duration": 300,
             "preview_locked": False, "scaling_enabled": False, "resolution": {"x": CANVAS[0], "y": CANVAS[1]},
             "version": 2}
    return with_root(draft, root)


# ---------------------------------------------------------------- after the round-trip

def _short_name(path: str) -> str | None:
    """The 8.3 spelling of an existing Windows path (GetShortPathNameW), or None."""
    if os.name != "nt":
        return None
    try:
        import ctypes
        buffer = ctypes.create_unicode_buffer(32768)
        return buffer.value if ctypes.windll.kernel32.GetShortPathNameW(path, buffer, 32768) else None
    except (OSError, AttributeError, ValueError):
        return None


def root_spellings(root: str) -> list[str]:
    """Every way the round-trip folder can be spelt, forward slashes, no trailing slash.

    OBS writes the folder as it was given, which on Windows may be an 8.3 short name
    (C:/Users/RUNNER~1/...) while the checker resolved it to the long name, or the other way
    round. Both spellings, plus the one given, count as the root."""
    candidates = [root]
    try:
        candidates.append(os.path.realpath(root))
    except (OSError, ValueError):
        pass
    short = _short_name(root)
    if short:
        candidates.append(short)
    spellings: list[str] = []
    for candidate in candidates:
        flat = candidate.rstrip("/\\").replace("\\", "/")
        if flat and flat not in spellings:
            spellings.append(flat)
    return spellings


_ABSOLUTE = re.compile(r"^(?:[A-Za-z]:/|//|/)")


def _canonical(path: str) -> str | None:
    """realpath with forward slashes and no trailing slash: on Windows it expands every 8.3
    component of the part that exists, so mixed spellings of one folder become one."""
    try:
        return os.path.realpath(path).replace("\\", "/").rstrip("/")
    except (OSError, ValueError):
        return None


def normalise(saved: dict, root: str) -> dict:
    """The saved collection with root paths as ./ paths and Playlister's resume state dropped.

    Refuses (ValueError) a string that still holds the root anywhere after that, so no
    absolute path of the round-trip machine can reach the template."""
    roots = root_spellings(root)
    # A GitHub runner's TEMP is C:/Users/RUNNER~1/... while mkdtemp's own folder keeps its long
    # name, so a saved path can mix short and long components that match no single spelling.
    canonical_root = _canonical(root)
    out = copy.deepcopy(saved)
    for source in out.get("sources", []):
        if source.get("id") == "obs_playlister_source":
            for key in PLAYLISTER_RESUME_KEYS:
                source.get("settings", {}).pop(key, None)

    def fix(value, where: str):
        if isinstance(value, dict):
            return {k: fix(v, f"{where}.{k}") for k, v in value.items()}
        if isinstance(value, list):
            return [fix(v, f"{where}[{i}]") for i, v in enumerate(value)]
        if isinstance(value, str):
            flat = value.replace("\\", "/")
            for spelling in roots:
                if flat.lower().startswith(spelling.lower() + "/"):
                    return "./" + flat[len(spelling) + 1:]
            if canonical_root and _ABSOLUTE.match(flat):
                canonical = _canonical(value)
                if canonical and canonical.lower().startswith(canonical_root.lower() + "/"):
                    return "./" + canonical[len(canonical_root) + 1:]
            if any(spelling.lower() in flat.lower() for spelling in roots):
                raise ValueError(f"{where} still holds the round-trip folder: {value!r}")
        return value

    return fix(out, "$")


def _keyed(items: list) -> dict | None:
    """A list of objects keyed by name, else by uuid; None when the list is not like that."""
    for key in ("name", "uuid"):
        if items and all(isinstance(i, dict) and key in i for i in items):
            keys = [i[key] for i in items]
            if len(set(keys)) == len(keys):
                return {k: i for k, i in zip(keys, items)}
    return None


def _same(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-3)
    return a == b


# Keys OBS rewrites with its own value on every save; their change is expected.
OBS_OWNED = {"prev_ver"}


def diff_draft(draft, saved, where: str = "$") -> dict:
    """What OBS changed or dropped of the draft's values, and which keys it added.

    Lists of objects are matched by name (sources, filters, items, scene order) or uuid
    (Playlister rows), since OBS saves sources in its own order."""
    result = {"changed": [], "missing": [], "added": []}

    def walk(d, s, path: str) -> None:
        if isinstance(d, dict) and isinstance(s, dict):
            for k, v in d.items():
                if k not in s:
                    result["missing"].append(f"{path}.{k}")
                elif k in OBS_OWNED:
                    continue
                else:
                    walk(v, s[k], f"{path}.{k}")
            for k in s:
                if k not in d:
                    result["added"].append(f"{path}.{k}")
            return
        if isinstance(d, list) and isinstance(s, list):
            dk, sk = _keyed(d), _keyed(s)
            if dk is not None and sk is not None:
                for k, v in dk.items():
                    if k not in sk:
                        result["missing"].append(f"{path}[{k}]")
                    else:
                        walk(v, sk[k], f"{path}[{k}]")
                for k in sk:
                    if k not in dk:
                        result["added"].append(f"{path}[{k}]")
                return
            if len(d) != len(s):
                result["changed"].append(f"{path}: {len(d)} entries became {len(s)}")
                return
            for i, (a, b) in enumerate(zip(d, s)):
                walk(a, b, f"{path}[{i}]")
            return
        if not _same(d, s):
            result["changed"].append(f"{path}: {d!r} became {s!r}")

    walk(draft, saved, where)
    return result


# A drive path, a UNC or \\?\ path, a POSIX path, or a file: URL.
ABSOLUTE = re.compile(r"(^|[\s\"'=:])([A-Za-z]:[\\/]|\\\\|/[A-Za-z])|(?i:file:/)")

# Keys each plugin writes into its own settings when it loads and saves. OBS keeps a source
# or filter whose plugin did not load with the draft's settings as they were, so the diff
# alone cannot see a missing plugin; these keys prove the plugin ran (seen in the
# 2026-11-01 round-trip: Playlister's settings migration, Visual Sidechain's fader seeding
# and the modulator's baselines).
PLUGIN_KEYS = {
    "obs_playlister_source": ["schema_version", "row_kinds"],
    "visual_sidechain_shader_filter": ["param_fader_1_seeded"],
    "visual_sidechain_modulator_filter": ["saved_baselines"],
}


def strings(value):
    if isinstance(value, dict):
        for v in value.values():
            yield from strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v)
    elif isinstance(value, str):
        yield value


def check_template(template: dict, ids: dict) -> list[str]:
    """Everything that keeps a saved-and-normalised collection from shipping as the kit."""
    problems: list[str] = []
    if template.get("name") != ids["collection"]:
        problems.append(f"collection name is {template.get('name')!r}, not {ids['collection']!r}")
    delta = diff_draft(draft_collection(ids), template)
    problems += [f"changed: {c}" for c in delta["changed"]]
    problems += [f"missing: {m}" for m in delta["missing"]]

    by_name = {s.get("name"): s for s in template.get("sources", [])}
    for entry in [*ids["sources"], *ids["scenes"]]:
        saved = by_name.get(entry["name"])
        if saved is None:
            continue  # reported as missing above
        if saved.get("uuid") != entry["uuid"]:
            problems.append(f"{entry['name']}: uuid {saved.get('uuid')} is not the kit's {entry['uuid']}")
        if saved.get("prev_ver", 0) < OBS_33:
            problems.append(f"{entry['name']}: prev_ver {saved.get('prev_ver')} is older than OBS 33.0.0")
        saved_filters = {f.get("name"): f for f in saved.get("filters", [])}
        for f in entry.get("filters", []):
            got = saved_filters.get(f["name"], {})
            if got and got.get("uuid") != f["uuid"]:
                problems.append(f"{entry['name']}/{f['name']}: uuid {got.get('uuid')} is not the kit's")
        for part in [saved, *saved.get("filters", [])]:
            lacking = [k for k in PLUGIN_KEYS.get(part.get("id"), []) if k not in part.get("settings", {})]
            if lacking:
                label = entry["name"] if part is saved else f"{entry['name']}/{part.get('name')}"
                problems.append(f"{label}: no {', '.join(lacking)} written, so its plugin did not load")
        if saved.get("id") == "obs_playlister_source":
            left = [k for k in PLAYLISTER_RESUME_KEYS if k in saved.get("settings", {})]
            if left:
                problems.append(f"{entry['name']}: Playlister resume state left: {', '.join(left)}")
    extra = sorted(set(by_name) - {e["name"] for e in [*ids["sources"], *ids["scenes"]]})
    if extra:
        problems.append(f"sources not in kit-ids.json: {', '.join(extra)}")

    beat = by_name.get("Kit Beat", {})
    if beat.get("monitoring_type") != 2 or beat.get("monitoring_enabled") is not True:
        problems.append("Kit Beat: monitoring_type must be 2 and monitoring_enabled true (D-7)")
    for scene in template.get("sources", []):
        if scene.get("id") == "scene":
            for item in scene.get("settings", {}).get("items", []):
                if item.get("source_uuid") != by_name.get(item.get("name"), {}).get("uuid"):
                    problems.append(f"{scene['name']}: item {item.get('name')} has another source's uuid")

    used = set()
    for text in strings(template):
        if ABSOLUTE.search(text) and not text.startswith(("http://", "https://")):
            problems.append(f"absolute path: {text!r}")
        if text.startswith("./"):
            used.add(text[2:])
    unknown = sorted(used - set(KIT_FILES))
    if unknown:
        problems.append(f"./ paths to files the kit does not ship: {', '.join(unknown)}")
    unused = sorted(set(KIT_FILES) - used)
    if unused:
        problems.append(f"kit files no source uses: {', '.join(unused)}")
    return problems


def dump(data: dict) -> str:
    """JSON as the kit writes it: OBS's 4-space indent, UTF-8 text, LF, one trailing newline."""
    return json.dumps(data, indent=4, ensure_ascii=False) + "\n"
