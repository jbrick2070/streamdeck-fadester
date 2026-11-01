# SPDX-License-Identifier: GPL-2.0-or-later
"""Suite Demo Kit install-check: the parts that need no OBS (plan section 8, step 5).

check-kit.py runs the live rows; everything here is plain data in, problems out, so the unit
tests (test_check_kit.py) cover it without an OBS:

- import_collection(): OBS 33's Import, in Python. OBS's importer (frontend/importers/studio.cpp,
  StudioImporter::ImportScenes and TranslatePaths, CheckPath) takes the folder that holds the
  JSON (QDir::cleanPath(dir.filePath("..")), forward slashes, no trailing one) and, for every
  string that starts with "./", asks Windows for the full path of folder + string. There is no
  separator between them: "C:/SuiteDemoKit" + "./media/a.mp4" is "C:/SuiteDemoKit./media/a.mp4",
  and Windows' path normalisation (GetFullPathNameW, which _wfullpath calls) drops the trailing
  dot of "SuiteDemoKit.", giving C:\\SuiteDemoKit\\media\\a.mp4. The result is kept only when it
  starts with the folder's own full path followed by a backslash; otherwise (a drive root, a
  ".." that leaves the folder) the string stays "./...". Both buffers are MAX_PATH (260)
  wide characters, so a longer path also stays as it was. OS translation (TranslateOSStudio)
  only renames Linux and macOS source kinds, none of which the kit uses. The importer sets the
  collection's name to the one in the dialog, which defaults to the file's "name".
- input_path_problems(): every local path of a live input is absolute, inside the unzip folder,
  exists, and none still starts with "./".
- profile_bindings() and binding_problems(): every key of the two .streamDeckProfile files and
  what it binds to, resolved through an ask(requestType, requestData) callable, the way the
  plugins resolve them (Playlister keys by inputUuid, filter keys by sourceUuid + filterName,
  layer keys by scene name + item id, scene keys by display position, the beat fader by name).
- loaded_versions(), version_problems(): the plugin versions in this run's OBS log against the
  minimums in kit-ids.json ("plugins").
- auth_string(): obs-websocket 5's authentication.
"""
from __future__ import annotations

import base64
import hashlib
import json
import ntpath
import os
import re
import zipfile
from pathlib import Path

MAX_PATH = 260
OBS_NOT_FOUND = 600  # obs-websocket RequestStatus::ResourceNotFound

FADESTER = "com.jbrick2070.fadester-for-obs."
VJSTER = "com.jbrick2070.vjster."
PAGE_ACTIONS = {"com.elgato.streamdeck.page.next", "com.elgato.streamdeck.page.previous"}
PANIC_HOTKEYS = ["visual_sidechain_panic", "visual_sidechain_restore"]
PLAYLISTER_KIND = "obs_playlister_source"


# ---------------------------------------------------------------- OBS's Import

def full_path(path: str) -> str | None:
    """GetFullPathNameW, as _wfullpath calls it; None past MAX_PATH (both of OBS's buffers)."""
    if len(path.encode("utf-16-le")) // 2 >= MAX_PATH:
        return None
    if os.name == "nt":
        out = os.path.abspath(path)  # nt._getfullpathname: GetFullPathNameW
    else:  # a stand-in for tests off Windows: ntpath normalisation and the trailing-dot rule
        out = ntpath.normpath(path.replace("/", "\\"))
        out = "\\".join(part.rstrip(".") if part not in (".", "..") else part for part in out.split("\\"))
    return None if len(out.encode("utf-16-le")) // 2 >= MAX_PATH else out


def check_path(path: str, root_dir: str) -> str:
    """studio.cpp CheckPath: the full path of root_dir + path when it stays inside root_dir."""
    root = full_path(root_dir)
    absolute = full_path(root_dir + path)
    if not root or not absolute:
        return path
    if not absolute.startswith(root):
        return path
    if absolute[len(root):len(root) + 1] != "\\":
        return path
    return absolute


def translate_paths(value, root_dir: str):
    """studio.cpp TranslatePaths: every string starting with ./, in objects and arrays alike."""
    if isinstance(value, dict):
        return {k: translate_paths(v, root_dir) for k, v in value.items()}
    if isinstance(value, list):
        return [translate_paths(v, root_dir) for v in value]
    if isinstance(value, str) and value.startswith("./"):
        return check_path(value, root_dir)
    return value


def import_root(json_path: Path) -> str:
    """QDir::cleanPath(QDir(path).filePath("..")): the JSON's folder, forward slashes."""
    folder = str(json_path.resolve().parent).replace("\\", "/")
    return folder if folder.endswith(":/") else folder.rstrip("/")


def import_collection(json_path: Path, name: str | None = None) -> dict:
    """What OBS's Import makes of a collection file (see the module docstring)."""
    data = json.loads(json_path.read_text(encoding="utf-8"))
    for key in ("sources", "name", "current_scene"):  # StudioImporter::Check
        if data.get(key) is None:
            raise ValueError(f"{json_path} is no OBS Studio collection: no {key!r}")
    out = translate_paths(data, import_root(json_path))
    out["name"] = name or data["name"] or "OBS Studio Import"
    return out


def leftover_dot_paths(value, where: str = "$") -> list[str]:
    if isinstance(value, dict):
        return [p for k, v in value.items() for p in leftover_dot_paths(v, f"{where}.{k}")]
    if isinstance(value, list):
        return [p for i, v in enumerate(value) for p in leftover_dot_paths(v, f"{where}[{i}]")]
    return [f"{where}: {value}"] if isinstance(value, str) and value.startswith("./") else []


def top_level(names: list[str]) -> list[str]:
    """The top-level entries of a zip listing, a folder as "media/"."""
    return sorted({n.split("/", 1)[0] + "/" if "/" in n else n for n in names})


# ---------------------------------------------------------------- paths of live inputs

def setting_paths(settings: dict) -> list[str]:
    """The local file paths in an input's settings: media, image, browser card, Playlister rows."""
    paths = []
    if settings.get("is_local_file", True) and isinstance(settings.get("local_file"), str):
        paths.append(settings["local_file"])
    if isinstance(settings.get("file"), str):
        paths.append(settings["file"])
    for row in settings.get("playlist") or []:
        if isinstance(row, dict) and isinstance(row.get("value"), str):
            paths.append(row["value"])
    return paths


def inside(path: str, folder: Path) -> bool:
    p = os.path.normcase(os.path.normpath(path))
    f = os.path.normcase(os.path.normpath(str(folder)))
    return p.startswith(f.rstrip("\\/") + os.sep)


def input_path_problems(name: str, settings: dict, kit_dir: Path) -> list[str]:
    problems = []
    for path in setting_paths(settings):
        if path.startswith("./"):
            problems.append(f"{name}: {path} is still a ./ path")
        elif not os.path.isabs(path):
            problems.append(f"{name}: {path} is not absolute")
        elif not inside(path, kit_dir):
            problems.append(f"{name}: {path} is outside the kit folder {kit_dir}")
        elif not os.path.isfile(path):
            problems.append(f"{name}: {path} does not exist")
    return problems


# ---------------------------------------------------------------- profiles

def profile_bindings(profile: bytes | Path) -> list[dict]:
    """Every action of a .streamDeckProfile: page, controller, position, action uuid, settings."""
    source = profile if isinstance(profile, Path) else __import__("io").BytesIO(profile)
    found = []
    with zipfile.ZipFile(source) as z:
        for member in sorted(z.namelist()):
            parts = member.split("/")
            if len(parts) != 4 or parts[1] != "Profiles" or parts[3] != "manifest.json":
                continue
            page = json.loads(z.read(member))
            for controller in page.get("Controllers") or []:
                for position, action in sorted((controller.get("Actions") or {}).items()):
                    found.append({"page": parts[2], "controller": controller.get("Type"), "position": position,
                                  "action": action.get("UUID"), "settings": action.get("Settings") or {}})
    return found


def scene_display_order(scene_list: dict) -> list[dict]:
    """GetSceneList's scenes in the Scenes dock's order (OBS lists them bottom first), as
    Fadester reads them (src/obs/direct-obs-client.ts sceneNamesInDisplayOrder)."""
    return sorted(scene_list.get("scenes", []), key=lambda s: -s["sceneIndex"])


def binding_problems(binding: dict, ask, ids: dict) -> list[str]:
    """What keeps one profile action from finding its target in the live OBS. ask(type, data)
    returns (code, responseData): code 100 is success, 600 not found."""
    action, s = binding["action"], binding["settings"]
    where = f"{binding['page'][:8]} {binding['controller']} {binding['position']} {action}"
    problems: list[str] = []

    def need(request: str, data: dict) -> dict | None:
        code, response = ask(request, data)
        if code != 100:
            problems.append(f"{where}: {request} {json.dumps(data, sort_keys=True)} answered {code}")
            return None
        return response

    if action in PAGE_ACTIONS:
        return []
    if action.startswith(VJSTER):
        if s.get("target") != "obs":
            problems.append(f"{where}: target {s.get('target')!r}, not the Speed Page's 'obs'")
        return problems
    if not action.startswith(FADESTER):
        return [f"{where}: an action this check does not know"]
    kind = action[len(FADESTER):]
    if kind == "scene-transition":
        match = re.fullmatch(r"__scene_index_(\d+)__", s.get("sceneTarget", ""))
        scenes = need("GetSceneList", {})
        if not match:
            problems.append(f"{where}: sceneTarget {s.get('sceneTarget')!r} is not a scene position")
        elif scenes is not None:
            order = scene_display_order(scenes)
            index = int(match.group(1))
            want = ids["scenes"][index]["name"] if index < len(ids["scenes"]) else None
            got = order[index]["sceneName"] if index < len(order) else None
            if got is None or got != want:
                problems.append(f"{where}: scene position {index} is {got!r} live, the kit's is {want!r}")
    elif kind == "obs-filter":
        response = need("GetSourceFilter", {"sourceUuid": s.get("sourceUuid"), "filterName": s.get("filterName")})
        if response is not None:
            if response.get("filterKind") != s.get("filterKind"):
                problems.append(f"{where}: {s.get('filterName')} is a {response.get('filterKind')}, "
                                f"the key wants {s.get('filterKind')}")
            setting = s.get("setting")
            if setting:
                defaults = need("GetSourceFilterDefaultSettings", {"filterKind": s.get("filterKind")}) or {}
                known = {**defaults.get("defaultFilterSettings", {}), **response.get("filterSettings", {})}
                if setting not in known:
                    problems.append(f"{where}: {s.get('filterName')} has no setting {setting}")
    elif kind == "layer-control":
        response = need("GetSceneItemSource", {"sceneName": s.get("sceneName"), "sceneItemId": s.get("sceneItemId")})
        if response is not None and response.get("sourceUuid") != s.get("sourceUuid"):
            problems.append(f"{where}: item {s.get('sceneItemId')} of {s.get('sceneName')} is "
                            f"{response.get('sourceName')}, not the key's {s.get('sourceName')}")
    elif kind == "playlister-transport":
        response = need("GetInputSettings", {"inputUuid": s.get("inputUuid")})
        if response is not None and response.get("inputKind") != PLAYLISTER_KIND:
            problems.append(f"{where}: {s.get('inputUuid')} is a {response.get('inputKind')}, not a Playlister")
    elif kind == "obs-fader":
        if s.get("target") != "input_volume":
            problems.append(f"{where}: fader target {s.get('target')!r} is not checked")
        else:
            need("GetInputVolume", {"inputName": s.get("inputName")})
    elif kind == "visual-panic":
        hotkeys = need("GetHotkeyList", {})
        if hotkeys is not None:
            missing = [h for h in PANIC_HOTKEYS if h not in hotkeys.get("hotkeys", [])]
            if missing:
                problems.append(f"{where}: OBS has no hotkey {', '.join(missing)}")
    else:
        problems.append(f"{where}: a Fadester action this check does not know")
    return problems


# ---------------------------------------------------------------- plugin versions

LOADED_VERSION = re.compile(r"\[([\w-]+)\] plugin loaded successfully \(version ([0-9][0-9.]*)\)")


def loaded_versions(log_text: str) -> dict[str, str]:
    return {m.group(1): m.group(2) for m in LOADED_VERSION.finditer(log_text)}


def version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(p) for p in version.split(".") if p.isdigit())


def version_problems(loaded: dict[str, str], minimums: dict[str, dict]) -> list[str]:
    problems = []
    for name, want in minimums.items():
        got = loaded.get(name)
        if got is None:
            problems.append(f"{name}: not loaded (no version line in the OBS log)")
        elif version_tuple(got) < version_tuple(want["min_version"]):
            problems.append(f"{name}: {got} is older than the kit's minimum {want['min_version']}")
    return problems


# ---------------------------------------------------------------- obs-websocket

def auth_string(password: str, salt: str, challenge: str) -> str:
    secret = base64.b64encode(hashlib.sha256((password + salt).encode("utf-8")).digest()).decode("ascii")
    return base64.b64encode(hashlib.sha256((secret + challenge).encode("utf-8")).digest()).decode("ascii")


SHADER_UNIFORM = re.compile(r"^uniform\s+(?:float|int|bool)\s+(\w+)\s*<.*?>\s*=\s*([-+0-9.eE]+|true|false)\s*;",
                            re.MULTILINE | re.DOTALL)


def shader_defaults(text: str) -> dict:
    """The user uniforms a Visual Sidechain .shader file declares, with their defaults: OBS
    reports none of them in GetSourceFilterDefaultSettings (they depend on the shader chosen),
    and a filter's settings hold one only once it was written, as Restore does."""
    out: dict = {}
    for name, value in SHADER_UNIFORM.findall(text):
        out[name] = value == "true" if value in ("true", "false") else float(value)
    return out


def settings_restored(before: dict, after: dict, defaults: dict) -> list[str]:
    """Keys whose value after Restore is not the one before Panic (a key absent before must be
    at its default after: Restore writes the saved value back explicitly)."""
    changed = []
    for key in sorted(set(before) | set(after)):
        was = before.get(key, defaults.get(key))
        now = after.get(key, defaults.get(key))
        if was != now and not (isinstance(was, (int, float)) and isinstance(now, (int, float))
                               and abs(was - now) < 1e-6):
            changed.append(f"{key} {was!r} -> {now!r}")
    return changed
