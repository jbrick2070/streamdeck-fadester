#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Suite Demo Kit install-check, v1 rows (plan section 8, step 5).

    python demo-kit/check-kit.py run --zip <Suite-Demo-Kit-1.1.zip> --dir <new check folder>
                                     [--port 4488] [--no-speed-run]
    python demo-kit/check-kit.py compare-import --file <saved collection> --kit-dir <unzip folder> [--out <file>]

run proves the shipped zip works end to end on a fresh portable OBS 33 with the two OBS plugins,
without touching an installed OBS, the shared test portable or the demo reel's OBS:

1. Unzip into <dir>/kit (an existing file there must be the zip's bytes; nothing is overwritten).
2. Assemble a fresh portable in <dir>/obs (kit_obs.assemble: bin, data and core copied read-only
   and hashed, Playlister and Visual Sidechain from their build folders, a profile "Kit" at
   1920x1080) and an obs-websocket config on --port with a password generated once and kept
   only in that folder's OBS config.
3. Import: OBS's own Import rules in Python (kit_check.import_collection), written into the
   portable's scenes folder and kept as <dir>/import-scripted.json.
4. Under the OBS lock (kit_obs: no obs64 running, the lock file created exclusively, the four
   flags, WM_CLOSE), start that OBS on the collection and run the rows over obs-websocket 5.
   Kit Beat is muted for the whole run (React When Source Is Muted keeps the looks fed) and the
   Speed Page's audio goes through OBS, muted, so the check plays nothing aloud.
   If the plugins row fails (a plugin older than the kit's minimum, or not loaded), the later
   rows are not run: each is recorded as failed, "not run".
   K.6 (kit 1.1): the profile is a Studio Mode layout, so the check turns Studio Mode on for the
   run (studio-mode row; off again at the end if it was off), cues every scene in Preview and
   fades one into Program over the T-bar the way the scene mixer dial does (preview-cues row),
   takes it live the way the dial's press does in Fadester 0.8.1 (mixer-take row: never a
   release, which OBS 33.0.1 cancels; leave and re-enter Studio Mode),
   and checks that every real-footage source and Playlister fills the canvas (full-frame row).
5. Put back everything a row changed (each step on its own, even after a failure), close OBS,
   record the SHA-256 of every file in the portable's config in <dir>/events.json, and check
   the collection OBS saved on exit: normalised back to ./ paths it must still pass
   kit_collection.check_template, so the kit was imported, used and saved without a value
   changing.

Each row writes one JSON line to <dir>/results.jsonl (an earlier file is renamed aside) with
"ok" and what was seen; screenshots go to <dir>/shots/. The exit code is 0 only when every row
passed. The check folder is kept: nothing is ever deleted.

compare-import is the operator's half of plan 8.3(b): after a real Import through OBS's menu
into a portable OBS, switching to the collection and closing OBS, the collection file it saved
must pass the same template check (the "saved" row's) against its own unzip folder: every value
and UUID the template fixes is the kit's. It is not a key-by-key diff with the scripted import:
a key the template check does not look at is not compared. It prints its row and writes a
results file only when --out names one (never into the unzip folder by default).

The VJster speed run (scripts/kit-speed-run.ts) puts the real VJster plugin under the repo's
deck simulator (scripts/vjster/deck-sim.ts) with the kit's Speed + layout, points the kit's
Speed Page at the plugin's page address, and turns the speed dial and presses the speed keys;
the deck's strip must show the rate the page reports back from OBS. It needs the VJster page
built (npx rollup -c vjster-page/rollup.config.mjs) and YouTube reachable; --no-speed-run
leaves it out.

Needs Windows, Python 3.10+ with websockets (12 or later), numpy and Pillow, and Node with the
repository's packages for the speed run.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kit_check as kk  # noqa: E402
import kit_collection as kc  # noqa: E402
import kit_docs as kd  # noqa: E402
import kit_obs  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
DEFAULT_PORT = 4488  # 4477 is the reel's web server (plan section 8)
VENDOR = "visual-sidechain"
LOOKS = ["Look Prism", "Look Kaleido", "Look Pulse"]
VS_FILTERS = [*LOOKS, "Audio Modulator"]
MONITOR_AND_OUTPUT = "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT"
MEDIA = "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_"
RENAMED = " (renamed by the check)"
SPEED_RUN_S = 300  # the speed run's wall-clock limit; the script itself waits at most 120 s for the page
NOT_RUN = "not run: the plugins row failed (a plugin older than the kit's minimum, or not loaded)"
# Settings that move a look by the clock rather than the beat, held still while its reaction
# is measured: Look Kaleido turns by elapsed_time * rotation_speed (fft-kaleidoscope.shader).
STILL = {"Look Kaleido": {"rotation_speed": 0.0}}
# A look whose picture keeps moving after the beat stops is measured without the beat by its
# Reactivity at 0 instead: Look Kaleido also turns by audio_beat, the beat phase, which runs on
# at the last tempo after the audio stops (seen 2026-11-01: a frame change of about 30 with
# Kit Beat paused and rotation_speed 0).
QUIET = {"Look Kaleido": {"vs_audio_reactivity_pct": 0.0}}
SPEED_VIDEO = f"https://youtu.be/{kd.YOUTUBE_ID}"


# ---------------------------------------------------------------- obs-websocket 5

class Obs:
    """A small synchronous obs-websocket 5 client: requests only, no events."""

    def __init__(self, port: int, password: str, timeout_s: float = 60):
        from websockets.sync.client import connect
        deadline = time.monotonic() + timeout_s
        while True:
            try:
                self.ws = connect(f"ws://127.0.0.1:{port}", subprotocols=["obswebsocket.json"], max_size=None,
                                  open_timeout=5)
                break
            except Exception:  # noqa: BLE001 - refused or not ready yet: try again until the deadline
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.5)
        hello = json.loads(self.ws.recv(10))["d"]
        identify = {"rpcVersion": 1, "eventSubscriptions": 0}
        if "authentication" in hello:
            a = hello["authentication"]
            identify["authentication"] = kk.auth_string(password, a["salt"], a["challenge"])
        self.ws.send(json.dumps({"op": 1, "d": identify}))
        reply = json.loads(self.ws.recv(10))
        if reply.get("op") != 2:
            raise RuntimeError(f"obs-websocket did not identify us: {reply}")
        self.n = 0

    def call(self, request: str, data: dict | None = None) -> tuple[int, dict]:
        self.n += 1
        rid = f"kit-{self.n}"
        self.ws.send(json.dumps({"op": 6, "d": {"requestType": request, "requestId": rid, "requestData": data or {}}}))
        while True:
            message = json.loads(self.ws.recv(30))
            if message.get("op") == 7 and message["d"].get("requestId") == rid:
                status = message["d"]["requestStatus"]
                return status["code"], message["d"].get("responseData") or {"comment": status.get("comment")}

    def req(self, request: str, data: dict | None = None) -> dict:
        code, response = self.call(request, data)
        if code != 100:
            raise RuntimeError(f"{request} {json.dumps(data)} answered {code}: {response.get('comment')}")
        return response

    def close(self) -> None:
        self.ws.close()


# ---------------------------------------------------------------- results

class Results:
    """The rows, printed; written to path as JSON lines when there is one."""

    def __init__(self, path: Path | None):
        if path is not None:
            kit_obs.keep_aside(path)
        self.path = path
        self.rows: list[dict] = []

    def add(self, row: str, ok: bool, detail: str, **seen) -> bool:
        entry = {"row": row, "ok": bool(ok), "detail": detail, **seen, "time": time.strftime("%H:%M:%S")}
        self.rows.append(entry)
        if self.path is not None:
            with open(self.path, "a", encoding="utf-8", newline="\n") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(f"{'PASS' if ok else 'FAIL'} {row}: {detail}", flush=True)
        return bool(ok)

    def guard(self, row: str, fn) -> None:
        """Run one row; an exception fails that row, not the run."""
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - a row's failure is reported, the next row still runs
            self.add(row, False, f"{type(exc).__name__}: {exc}")

    def run_rows(self, rows: list, gate: str = "plugins") -> None:
        """Run rows in order; once the gate row has failed, the rest are recorded as not run
        (plan 8.1: no row runs on a plugin older than the kit's minimum)."""
        blocked = False
        for name, fn in rows:
            if blocked:
                self.add(name, False, NOT_RUN)
                continue
            start = len(self.rows)
            self.guard(name, fn)
            if name == gate and not all(r["ok"] for r in self.rows[start:]):
                blocked = True


# ---------------------------------------------------------------- preparing the check folder

def unzip(zip_path: Path, kit_dir: Path) -> list[str]:
    """Unzip once; a file already there must hold the zip's bytes (never overwritten)."""
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        root = kit_dir.resolve()
        for name in names:
            # A member name is a relative, forward-slash path. One that is absolute on
            # either platform ("/x", "C:/x"), or climbs with "..", is refused everywhere,
            # not only on the platform where it happens to resolve outside the folder.
            parts = name.replace("\\", "/").split("/")
            if PurePosixPath(name).anchor or PureWindowsPath(name).anchor or ".." in parts:
                raise RuntimeError(f"the zip's {name!r} would land outside {kit_dir}")
            target = (kit_dir / name).resolve()
            if not target.is_relative_to(root) or target == root:
                raise RuntimeError(f"the zip's {name!r} would land outside {kit_dir}")
            if name.endswith("/"):
                target.mkdir(parents=True, exist_ok=True)
                continue
            data = z.read(name)
            if target.exists():
                if target.read_bytes() != data:
                    raise RuntimeError(f"{target} differs from the zip's {name}; use a new --dir")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    return names


def port_free(port: int) -> bool:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def websocket_config(obs: Path, port: int) -> str:
    """obs-websocket on port with a password made once, stored only in this portable's config."""
    path = obs / "config" / "obs-studio" / "plugin_config" / "obs-websocket" / "config.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        config = {"alerts_enabled": False, "auth_required": True, "first_load": False, "server_enabled": True,
                  "server_password": secrets.token_urlsafe(18), "server_port": port}
        path.write_text(json.dumps(config, indent=4) + "\n", encoding="utf-8", newline="\n")
    config = json.loads(path.read_text(encoding="utf-8"))
    if not config.get("server_enabled") or config.get("server_port") != port:
        raise RuntimeError(f"{path} is not the check's config (server off or another port); use a new --dir")
    return config["server_password"]


# ---------------------------------------------------------------- images

def image(data_uri: str):
    import numpy as np
    from PIL import Image
    raw = base64.b64decode(data_uri.split(",", 1)[1])
    return np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float32), raw


def screenshot(obs: Obs, width: int = 480, **target):
    reply = obs.req("GetSourceScreenshot", {**target, "imageFormat": "png", "imageWidth": width})
    return image(reply["imageData"])


def redact(line: dict) -> dict:
    """A speed-run line without the page key its address carries: it never reaches the results."""
    if "address" in line:
        line = {**line, "address": re.sub(r"#token=[0-9a-f]+", "#token=<not kept>", line["address"])}
    return line


def mean_change(a, b) -> float:
    return float(abs(a - b).mean())


def save_shot(folder: Path, name: str, raw: bytes) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    kit_obs.keep_aside(path)
    path.write_bytes(raw)
    return path


# ---------------------------------------------------------------- the rows

class Check:
    def __init__(self, obs: Obs, ids: dict, kit_dir: Path, folder: Path, log: Path, results: Results,
                 shaders: Path | None = None):
        self.obs, self.ids, self.kit_dir, self.folder, self.log, self.r = obs, ids, kit_dir, folder, log, results
        self.shaders = shaders
        self.sources = {s["name"]: s for s in ids["sources"]}
        self.uuid = {s["name"]: s["uuid"] for s in ids["sources"]}
        self.undo: list = []  # what to put back, newest last

    def wait(self, seconds: float) -> None:
        time.sleep(seconds)

    def program(self, scene: str, settle_s: float = 1.5) -> None:
        self.obs.req("SetCurrentProgramScene", {"sceneName": scene})
        self.wait(settle_s)

    def media(self, name: str, action: str) -> None:
        self.obs.req("TriggerMediaInputAction", {"inputUuid": self.uuid[name], "mediaAction": MEDIA + action})

    def filter_settings(self, filter_name: str, source: str = "Kit Motion") -> dict:
        return self.obs.req("GetSourceFilter", {"sourceUuid": self.uuid[source], "filterName": filter_name})

    def log_text(self) -> str:
        return self.log.read_text(encoding="utf-8", errors="replace")

    def log_has(self, text: str, after: int, timeout_s: float = 5) -> bool:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if text in self.log_text()[after:]:
                return True
            self.wait(0.2)
        return False

    # -- plugins, scenes, inputs, paths, filters, monitoring

    def plugins(self) -> None:
        text = self.log_text()
        loaded = kk.loaded_versions(text)
        problems = kk.version_problems(loaded, self.ids["plugins"])
        problems += kit_obs.log_failures(text, list(self.ids["plugins"]))
        version = self.obs.req("GetVersion")
        if kk.version_tuple(version["obsVersion"]) < (33, 0, 0):
            problems.append(f"OBS {version['obsVersion']} is older than 33.0.0")
        self.r.add("plugins", not problems, "; ".join(problems) or
                   f"OBS {version['obsVersion']}, obs-websocket {version['obsWebSocketVersion']}, " +
                   ", ".join(f"{k} {v}" for k, v in sorted(loaded.items())), loaded=loaded)

    def scenes(self) -> None:
        problems = []
        order = kk.scene_display_order(self.obs.req("GetSceneList"))
        names = [s["sceneName"] for s in order]
        want = [s["name"] for s in self.ids["scenes"]]
        if names != want:
            problems.append(f"scenes {names}, the kit's {want}")
        live = {s["sceneName"]: s for s in order}
        for scene in self.ids["scenes"]:
            got = live.get(scene["name"])
            if got is None:
                continue
            if got.get("sceneUuid") != scene["uuid"]:
                problems.append(f"{scene['name']}: uuid {got.get('sceneUuid')} is not the kit's {scene['uuid']}")
            items = self.obs.req("GetSceneItemList", {"sceneUuid": scene["uuid"]})["sceneItems"]
            have = sorted((i["sceneItemId"], i["sourceName"], i["sourceUuid"]) for i in items)
            expect = sorted((i["id"], i["source"], self.uuid[i["source"]]) for i in scene["items"])
            if have != expect:
                problems.append(f"{scene['name']}: items {have}, the kit's {expect}")
        self.r.add("scenes", not problems, "; ".join(problems) or
                   f"{len(want)} scenes in the kit's order, their uuids and every item id and source uuid")

    def inputs(self) -> None:
        problems = []
        live = {i["inputName"]: i for i in self.obs.req("GetInputList")["inputs"]}
        for name, source in self.sources.items():
            got = live.get(name)
            if got is None:
                problems.append(f"{name}: missing")
            elif (got["inputKind"], got["inputUuid"]) != (source["versioned_id"], source["uuid"]):
                problems.append(f"{name}: {got['inputKind']} {got['inputUuid']}, the kit's "
                                f"{source['versioned_id']} {source['uuid']}")
        extra = sorted(set(live) - set(self.sources))
        if extra:
            problems.append(f"inputs not in the kit: {extra}")
        self.r.add("inputs", not problems, "; ".join(problems) or
                   f"{len(self.sources)} inputs with the kit's names, kinds and uuids")

    def paths(self) -> None:
        shipped = json.loads((self.kit_dir / kd.COLLECTION_FILE).read_text(encoding="utf-8"))
        want = sum(len(kk.setting_paths(s.get("settings", {}))) for s in shipped["sources"])
        problems, count, live = [], 0, {}
        for name in self.sources:
            live[name] = self.obs.req("GetInputSettings", {"inputUuid": self.uuid[name]})["inputSettings"]
            count += len(kk.setting_paths(live[name]))
            problems += kk.input_path_problems(name, live[name], self.kit_dir)
        problems += kk.leftover_dot_paths(live)
        if count != want:
            problems.append(f"{count} local paths live, the shipped collection has {want}")
        self.r.add("paths", not problems, "; ".join(problems) or
                   f"all {count} local paths (media, the title, the card, every Playlister row) absolute, inside "
                   f"{self.kit_dir} and present; no ./ left anywhere", count=count)

    def filters(self) -> None:
        problems = []
        for name, source in self.sources.items():
            if not source.get("filters"):
                continue
            live = self.obs.req("GetSourceFilterList", {"sourceUuid": source["uuid"]})["filters"]
            have = [(f["filterName"], f["filterKind"]) for f in live]
            want = [(f["name"], f["versioned_id"]) for f in source["filters"]]
            if have != want:
                problems.append(f"{name}: filters {have}, the kit's {want}")
            for f in live:
                if f["filterName"] in VS_FILTERS:
                    s = f["filterSettings"]
                    if (s.get("tap_mode"), s.get("tap_source_name"), s.get("react_when_muted")) != (7, "Kit Beat", True):
                        problems.append(f"{name}/{f['filterName']}: tap_mode {s.get('tap_mode')}, tap_source_name "
                                        f"{s.get('tap_source_name')!r}, react_when_muted {s.get('react_when_muted')}")
        self.r.add("filters", not problems, "; ".join(problems) or
                   "every filter present in order with its kind; the three looks and the Audio Modulator "
                   "read back tap_mode 7 on \"Kit Beat\", React When Source Is Muted on")

    def monitoring(self) -> None:
        beat = {"inputUuid": self.uuid["Kit Beat"]}
        kind = self.obs.req("GetInputAudioMonitorType", beat)["monitorType"]
        db = self.obs.req("GetInputVolume", beat)["inputVolumeDb"]
        ok = kind == MONITOR_AND_OUTPUT and abs(db - kc.BEAT_DB) < 0.1
        self.r.add("monitoring", ok, f"Kit Beat {kind} at {db:.2f} dB (the kit's monitor and output at "
                   f"{kc.BEAT_DB} dB)")

    def mute(self, name: str) -> None:
        """Mute an input for the check; unmuted again before OBS closes only if it was not muted."""
        uuid = {"inputUuid": self.uuid[name]}
        if self.obs.req("GetInputMute", uuid)["inputMuted"]:
            return
        self.obs.req("SetInputMute", {**uuid, "inputMuted": True})
        self.undo.append(("unmute", name))

    def quiet(self) -> None:
        """Nothing aloud during the check: mute Kit Beat."""
        self.mute("Kit Beat")
        self.r.add("quiet", True, "Kit Beat muted for the check (put back at the end if it was not muted)")

    def full_frame(self) -> None:
        """K.6: every real-footage source and Playlister fills the canvas in every scene that holds
        it, and the three real-footage sources play the clips the kit names, muted."""
        problems, items = [], 0
        for scene in self.ids["scenes"]:
            for item in self.obs.req("GetSceneItemList", {"sceneUuid": scene["uuid"]})["sceneItems"]:
                if item["sourceName"] not in kc.FULL_FRAME_SOURCES:
                    continue
                items += 1
                t = self.obs.req("GetSceneItemTransform", {"sceneUuid": scene["uuid"], "sceneItemId": item["sceneItemId"]})
                t = t["sceneItemTransform"]
                got = (t.get("positionX"), t.get("positionY"), t.get("boundsType"), t.get("boundsWidth"), t.get("boundsHeight"))
                want = (0, 0, "OBS_BOUNDS_SCALE_INNER", kc.CANVAS[0], kc.CANVAS[1])
                if got != want:
                    problems.append(f"{scene['name']}/{item['sourceName']}: {got}, the kit's {want}")
        for name in kc.MUTED_SOURCES:
            uuid = {"inputUuid": self.uuid[name]}
            live = Path(self.obs.req("GetInputSettings", uuid)["inputSettings"].get("local_file", "")).name
            want = Path(kc.SETTINGS[name]["local_file"]).name
            if live != want:
                problems.append(f"{name}: plays {live!r}, the kit's {want!r}")
            if not self.obs.req("GetInputMute", uuid)["inputMuted"]:
                problems.append(f"{name}: not muted")
        self.r.add("full-frame", not problems and items > 0, "; ".join(problems) or
                   f"{items} media items (the three real-footage sources and the two Playlisters) fill the "
                   f"{kc.CANVAS[0]}x{kc.CANVAS[1]} canvas; Kit Motion, Layer A and Layer B play the train, the sprint "
                   "and the hurdles, muted", items=items)

    # -- Studio Mode (K.6): cue in Preview, fade with the mixer

    def studio(self) -> None:
        was = self.obs.req("GetStudioModeEnabled")["studioModeEnabled"]
        if not was:
            self.obs.req("SetStudioModeEnabled", {"studioModeEnabled": True})
            self.undo.append(("studio", False))
            self.wait(1.0)
        now = self.obs.req("GetStudioModeEnabled")["studioModeEnabled"]
        self.r.add("studio-mode", now is True, f"Studio Mode {'was already on' if was else 'turned on for the check'}"
                   f"{'' if was else ' (off again at the end)'}; the kit profile needs it", was=was)

    def cue(self, scene: dict, timeout_s: float = 4) -> dict:
        """SetCurrentPreviewScene, then GetCurrentPreviewScene until it answers with that scene
        (OBS applies the change on its UI thread, so the first read can still show the old one).
        Returns the last answer."""
        self.obs.req("SetCurrentPreviewScene", {"sceneUuid": scene["uuid"]})
        deadline = time.monotonic() + timeout_s
        while True:
            got = self.obs.req("GetCurrentPreviewScene")
            if got.get("sceneUuid") == scene["uuid"] or time.monotonic() > deadline:
                return got
            self.wait(0.2)

    def preview_cues(self) -> None:
        """Every scene can be cued in Preview, as the profile's scene keys do (SetCurrentPreviewScene);
        then one is faded into Program over the T-bar, as the scene mixer dial does."""
        problems, cued = [], []
        for scene in self.ids["scenes"]:
            got = self.cue(scene)
            cued.append(got.get("sceneName"))
            if got.get("sceneUuid") != scene["uuid"]:
                problems.append(f"cued {scene['name']}, Preview shows {got.get('sceneName')!r}")
        first, second = self.ids["scenes"][0], self.ids["scenes"][1]
        self.program(first["name"], 1.0)
        if self.cue(second).get("sceneUuid") != second["uuid"]:
            problems.append(f"{second['name']} could not be cued before the fade")
        self.wait(0.5)
        mark = len(self.log_text())
        for position in (0.25, 0.5, 0.75):
            self.obs.req("SetTBarPosition", {"position": position, "release": False})
            self.wait(0.2)
        started = self.log_has(f"manual transition to scene '{second['name']}'", mark)
        if not started:
            problems.append(f"the T-bar did not start a manual transition to {second['name']} (OBS log)")
        self.r.add("preview-cues", not problems, "; ".join(problems) or
                   f"all {len(cued)} scenes cued in Preview by uuid ({', '.join(cued)}); {second['name']} cued and "
                   "the T-bar at 0.25, 0.5, 0.75 blends it into Program (OBS logs the manual transition)",
                   cued=cued, started=started)
        self.mixer_take(second, mark)

    def mixer_take(self, scene: dict, mark: int) -> None:
        """The scene mixer's press, sent as Fadester sends it (DirectObsClient.performTbarTake,
        PLAN 12): never a release, which OBS 33.0.1 always cancels. SetTBarPosition 1.0 without
        release aims the manual transition at Next, leaving Studio Mode makes Program the throw's
        target in one UI step, Studio Mode is entered again, Program is read back with
        GetCurrentProgramScene, and Preview gets the previous Live (OBS's own swap). Program must
        be the cued scene; OBS must log the two Studio Mode lines and no "Manual transition
        cancelled". Put back either way: Program on the first scene is the put-back row's job."""
        live = self.obs.req("GetCurrentProgramScene")
        self.obs.req("SetTBarPosition", {"position": 1.0, "release": False})
        try:
            self.obs.req("SetStudioModeEnabled", {"studioModeEnabled": False})
        finally:  # once asked to leave, always asked back (Fadester retries once)
            try:
                self.obs.req("SetStudioModeEnabled", {"studioModeEnabled": True})
            except Exception:  # noqa: BLE001 - once more, as Fadester does
                self.obs.req("SetStudioModeEnabled", {"studioModeEnabled": True})
        self.wait(1.0)
        program = self.obs.req("GetCurrentProgramScene")
        studio = self.obs.req("GetStudioModeEnabled")["studioModeEnabled"]
        if program.get("sceneUuid") == scene["uuid"] and live.get("sceneUuid"):
            self.obs.req("SetCurrentPreviewScene", {"sceneUuid": live["sceneUuid"]})
        left = self.log_has("Switched to regular Preview mode", mark)
        back = self.log_has("Switched to Preview/Program mode", mark)
        cancelled = "Manual transition cancelled" in self.log_text()[mark:]
        ok = program.get("sceneUuid") == scene["uuid"] and studio is True and left and back and not cancelled
        problems = [] if ok else [p for p, bad in (
            (f"Program is {program.get('sceneName')!r}, wanted {scene['name']!r}", program.get("sceneUuid") != scene["uuid"]),
            ("Studio Mode is off after the take", studio is not True),
            ("OBS did not log \"Switched to regular Preview mode\"", not left),
            ("OBS did not log \"Switched to Preview/Program mode\"", not back),
            ("OBS logged \"Manual transition cancelled\"", cancelled)) if bad]
        self.r.add("mixer-take", ok, "; ".join(problems) or
                   f"the press as Fadester sends it (T-bar 1.0 unreleased, leave and re-enter Studio Mode): "
                   f"Program is {program.get('sceneName')!r} by GetCurrentProgramScene, Studio Mode on, OBS logged "
                   "both Studio Mode lines and no cancel",
                   program=program.get("sceneName"), studio=studio, left=left, back=back, cancelled=cancelled)

    # -- the beat in Visual Sidechain

    def signals(self, samples: int = 16, every_s: float = 0.25) -> dict:
        levels, kicks = [], []
        for _ in range(samples):
            reply = self.obs.req("CallVendorRequest", {"vendorName": VENDOR, "requestType": "get_signals"})
            data = reply["responseData"]
            levels.append(float(data.get("level", 0)))
            kicks.append(float(data.get("kick", 0)))
            self.wait(every_s)
        return {"level_max": max(levels), "level_mean": sum(levels) / len(levels), "kick_max": max(kicks)}

    def beat(self) -> None:
        self.program("Kit Visuals", 2.0)
        playing = self.signals()
        self.media("Kit Beat", "PAUSE")
        self.wait(1.0)
        paused = self.signals()
        self.media("Kit Beat", "PLAY")
        self.wait(1.0)
        ok = playing["level_max"] > 0.02 and playing["kick_max"] > 0 and \
            paused["level_max"] < playing["level_max"] / 4
        self.r.add("beat-signals", ok, f"get_signals with Kit Beat playing (muted): level max "
                   f"{playing['level_max']:.3f}, kick max {playing['kick_max']:.3f}; paused: level max "
                   f"{paused['level_max']:.3f}", playing=playing, paused=paused)

    def frame_change(self, frames: int = 6) -> float:
        motion = self.uuid["Kit Motion"]
        shots = []
        for _ in range(frames):
            shots.append(screenshot(self.obs, 320, sourceUuid=motion)[0])
            self.wait(0.2)
        return sum(mean_change(a, b) for a, b in zip(shots, shots[1:])) / (frames - 1)

    def reaction(self, enabled: dict[str, bool], only: list[str], quiet: dict | None = None) -> dict:
        """Mean frame change of Kit Motion (paused, so only the filters move), with only the given
        filters enabled: with the beat playing, then without it: the beat paused, or, given quiet
        settings for the filter, the beat playing and those settings applied."""
        motion = self.uuid["Kit Motion"]
        for name in enabled:
            self.obs.req("SetSourceFilterEnabled", {"sourceUuid": motion, "filterName": name,
                                                    "filterEnabled": name in only})
        self.media("Kit Beat", "PLAY")
        self.wait(1.0)
        out = {"beat": self.frame_change()}
        if quiet:
            self.obs.req("SetSourceFilterSettings", {"sourceUuid": motion, "filterName": only[0],
                                                     "filterSettings": quiet, "overlay": True})
        else:
            self.media("Kit Beat", "PAUSE")
        self.wait(1.0)
        out["no beat"] = self.frame_change()
        self.media("Kit Beat", "PLAY")
        return out

    def looks_react(self) -> None:
        motion = self.uuid["Kit Motion"]
        live = self.obs.req("GetSourceFilterList", {"sourceUuid": motion})["filters"]
        enabled = {f["filterName"]: f["filterEnabled"] for f in live}
        self.program("Kit Visuals", 1.0)
        self.media("Kit Motion", "PAUSE")
        try:
            for name in VS_FILTERS:
                only = [name, "Color Correction"] if name == "Audio Modulator" else [name]
                kept = self.filter_settings(name)["filterSettings"]
                if name in STILL:
                    self.obs.req("SetSourceFilterSettings", {"sourceUuid": motion, "filterName": name,
                                                             "filterSettings": STILL[name], "overlay": True})
                try:
                    seen = self.reaction(enabled, only, QUIET.get(name))
                finally:
                    if name in STILL or name in QUIET:  # back to exactly the settings it had
                        self.obs.req("SetSourceFilterSettings", {"sourceUuid": motion, "filterName": name,
                                                                 "filterSettings": kept, "overlay": False})
                ok = seen["beat"] > 0.5 and seen["beat"] > 2 * seen["no beat"]
                still = ", ".join(f"{k} {v}" for k, v in STILL.get(name, {}).items())
                without = ("its " + ", ".join(f"{k} {v}" for k, v in QUIET[name].items()) + " (beat playing)"
                           if name in QUIET else "the beat paused")
                self.r.add(f"reacts: {name}", ok, f"Kit Motion paused, {name} alone"
                           f"{' (on Color Correction)' if name == 'Audio Modulator' else ''}"
                           f"{f' ({still} while measured)' if still else ''}: mean frame change "
                           f"{seen['beat']:.2f} with the beat playing (muted), {seen['no beat']:.2f} with {without}",
                           seen=seen)
        finally:
            for name, on in enabled.items():
                self.obs.req("SetSourceFilterEnabled", {"sourceUuid": motion, "filterName": name, "filterEnabled": on})
            self.media("Kit Motion", "PLAY")
            self.media("Kit Beat", "PLAY")

    # -- Panic and Restore

    def defaults(self, name: str) -> dict:
        """A filter's defaults: its kind's, plus its shader's uniforms (read from the plugin's own
        shader file in this portable)."""
        live = self.filter_settings(name)
        out = self.obs.req("GetSourceFilterDefaultSettings", {"filterKind": live["filterKind"]})["defaultFilterSettings"]
        shader = live["filterSettings"].get("preset_shader")
        if shader and self.shaders is not None:
            out = {**out, **kk.shader_defaults((self.shaders / shader).read_text(encoding="utf-8"))}
        return out

    def panic(self) -> None:
        before = {n: self.filter_settings(n)["filterSettings"] for n in VS_FILTERS}
        defaults = {n: self.defaults(n) for n in VS_FILTERS}
        mark = len(self.log_text())
        restore_sent = False
        try:
            self.obs.req("TriggerHotkeyByName", {"hotkeyName": "visual_sidechain_panic"})
            panicked = self.log_has("Panic hotkey triggered", mark)
            self.wait(0.5)
            during = {n: self.filter_settings(n)["filterSettings"] for n in VS_FILTERS}
            zeroed = {n: kk.settings_restored(before[n], during[n], defaults[n]) for n in VS_FILTERS}
            mark = len(self.log_text())
            restore_sent = True
            self.obs.req("TriggerHotkeyByName", {"hotkeyName": "visual_sidechain_restore"})
        finally:
            if not restore_sent:  # a read failed after Panic: never leave the looks zeroed
                self.obs.call("TriggerHotkeyByName", {"hotkeyName": "visual_sidechain_restore"})
        restored = self.log_has("Restore hotkey triggered", mark)
        self.wait(0.5)
        after = {n: self.filter_settings(n)["filterSettings"] for n in VS_FILTERS}
        left = {n: kk.settings_restored(before[n], after[n], defaults[n]) for n in VS_FILTERS}
        ok = panicked and restored and any(zeroed.values()) and not any(left.values())
        self.r.add("panic-restore", ok, f"Panic {'logged' if panicked else 'NOT logged'}, changed "
                   f"{', '.join(f'{n} ({len(zeroed[n])} settings)' for n in VS_FILTERS if zeroed[n]) or 'nothing'}; "
                   f"Restore {'logged' if restored else 'NOT logged'}, settings not back: "
                   f"{ {n: v for n, v in left.items() if v} or 'none'}", during=zeroed)

    # -- Playlister

    def current(self, name: str) -> str:
        return self.obs.req("GetInputSettings", {"inputUuid": self.uuid[name]})["inputSettings"].get(
            "current_file_name", "")

    def wait_current(self, name: str, clip: str, timeout_s: float = 6) -> str:
        deadline = time.monotonic() + timeout_s
        while True:
            now = self.current(name)
            if clip in now or time.monotonic() > deadline:
                return now
            self.wait(0.25)

    def playlister(self) -> None:
        self.program("Kit Playlister", 2.5)
        clips = self.uuid["Kit Clips"]
        steps = []
        other_before = self.current("Kit Clips 50%")  # in its own scene since K.6: it must not move
        start = self.wait_current("Kit Clips", "clip-hurdles")
        before = screenshot(self.obs, 320, sourceUuid=clips)[0]
        steps.append(("start", "clip-hurdles", start))
        for action, clip in (("NEXT", "clip-sprint"), ("NEXT", "clip-train"), ("PREVIOUS", "clip-sprint")):
            self.media("Kit Clips", action)
            steps.append((action.lower(), clip, self.wait_current("Kit Clips", clip)))
        self.wait(1.0)
        moved = mean_change(before, screenshot(self.obs, 320, sourceUuid=clips)[0])
        other = self.current("Kit Clips 50%")
        problems = [f"{a}: {c} wanted, current_file_name {now!r}" for a, c, now in steps if c not in now]
        states = {}
        for action, state in (("PAUSE", "OBS_MEDIA_STATE_PAUSED"), ("PLAY", "OBS_MEDIA_STATE_PLAYING")):
            self.media("Kit Clips", action)
            states[action.lower()] = self.wait_state("Kit Clips", state)
            if states[action.lower()] != state:
                problems.append(f"{action.lower()}: {state} wanted, mediaState {states[action.lower()]}")
        if other != other_before:
            problems.append(f"Kit Clips 50% moved too: {other_before!r} became {other!r}")
        if moved < 5:
            problems.append(f"the picture hardly changed from the hurdles to the sprint ({moved:.1f})")
        for _, _, now in steps:
            path = now.split(": ", 1)[-1]
            if not kk.inside(path, self.kit_dir):
                problems.append(f"{path} is not inside {self.kit_dir}")
        self.r.add("playlister-previous-next", not problems, "; ".join(problems) or
                   "Kit Clips by uuid: hurdles, next sprint, next train, previous sprint (current_file_name, "
                   f"inside the kit folder); the picture changed ({moved:.1f}); pause then play (mediaState); "
                   f"Kit Clips 50% (its own scene) did not move ({other!r})", steps=steps, states=states)

    def wait_state(self, name: str, state: str, timeout_s: float = 4) -> str:
        deadline = time.monotonic() + timeout_s
        while True:
            now = self.obs.req("GetMediaInputStatus", {"inputUuid": self.uuid[name]})["mediaState"]
            if now == state or time.monotonic() > deadline:
                return now
            self.wait(0.2)

    def playlister_speed(self) -> None:
        """Each Playlister in its own scene since K.6 (a hidden one is stopped), so each is
        measured with its scene in Program, one after the other."""
        scenes = {"Kit Clips": "Kit Playlister", "Kit Clips 50%": "Kit Playlister 50%"}
        rate, durations = {}, {}
        for name, scene in scenes.items():
            self.program(scene, 2.0)
            self.media(name, "RESTART")
            self.wait(1.0)
            first = (self.obs.req("GetMediaInputStatus", {"inputUuid": self.uuid[name]}), time.monotonic())
            self.wait(4.0)
            last = (self.obs.req("GetMediaInputStatus", {"inputUuid": self.uuid[name]}), time.monotonic())
            rate[name] = (last[0]["mediaCursor"] - first[0]["mediaCursor"]) / ((last[1] - first[1]) * 1000)
            durations[name] = last[0]["mediaDuration"]
        ok = 0.85 <= rate["Kit Clips"] <= 1.15 and 0.4 <= rate["Kit Clips 50%"] <= 0.6 and \
            abs(durations["Kit Clips"] - durations["Kit Clips 50%"]) <= 100
        self.r.add("playlister-speed", ok, f"media cursor over about 4 s of wall time, each in its own scene: "
                   f"Kit Clips {rate['Kit Clips']:.2f}x, Kit Clips 50% {rate['Kit Clips 50%']:.2f}x; durations "
                   f"{durations['Kit Clips']} and {durations['Kit Clips 50%']} ms (the container's, both)",
                   rate=rate, durations=durations)

    # -- the profiles

    def profile_bindings(self) -> list[tuple[str, dict]]:
        found = []
        for name in kd.PROFILE_FILES:
            found += [(name, b) for b in kk.profile_bindings(self.kit_dir / name)]
        return found

    def bindings(self) -> None:
        problems, count = [], 0
        for name, binding in self.profile_bindings():
            count += 1
            problems += [f"{name}: {p}" for p in kk.binding_problems(binding, self.obs.call, self.ids)]
        self.r.add("profile-bindings", not problems and count > 0, "; ".join(problems) or
                   f"{count} actions in the two profiles; every scene position, input uuid, filter "
                   "(source uuid + name + kind + setting), layer (scene + item id), fader and Panic hotkey "
                   "resolves in the live OBS, none answers 600", count=count)

    # -- rename cases (plan 8.4)

    def renames(self) -> None:
        clips, motion = self.uuid["Kit Clips"], self.uuid["Kit Motion"]
        bindings = self.profile_bindings()
        playlister = [b for _, b in bindings if b["action"].endswith("playlister-transport")
                      and b["settings"].get("inputUuid") == clips]
        prism = [b for _, b in bindings if b["action"].endswith("obs-filter")
                 and b["settings"].get("filterName") == "Look Prism"]
        new_name = "Kit Clips" + RENAMED
        self.obs.req("SetInputName", {"inputUuid": clips, "newInputName": new_name})
        try:
            names = {i["inputName"] for i in self.obs.req("GetInputList")["inputs"]}
            by_uuid = [p for b in playlister for p in kk.binding_problems(b, self.obs.call, self.ids)]
        finally:
            self.obs.req("SetInputName", {"inputUuid": clips, "newInputName": "Kit Clips"})
        self.r.add("rename: Kit Clips", new_name in names and not by_uuid and playlister,
                   f"renamed, its {len(playlister)} Playlister keys still resolve by uuid"
                   if not by_uuid else "; ".join(by_uuid))
        self.obs.req("SetSourceFilterName", {"sourceUuid": motion, "filterName": "Look Prism",
                                             "newFilterName": "Look Prism" + RENAMED})
        try:
            gone = [kk.binding_problems(b, self.obs.call, self.ids) for b in prism]
        finally:
            self.obs.req("SetSourceFilterName", {"sourceUuid": motion, "filterName": "Look Prism" + RENAMED,
                                                 "newFilterName": "Look Prism"})
        back = [p for b in prism for p in kk.binding_problems(b, self.obs.call, self.ids)]
        not_found = all(any(f"answered {kk.OBS_NOT_FOUND}" in p for p in g) for g in gone)
        self.r.add("rename: Look Prism", bool(prism) and not_found and not back,
                   f"renamed, all {len(prism)} Look Prism keys find no filter (600, the key's Filter not "
                   f"found); renamed back, they resolve again" if not_found and not back else
                   f"while renamed: {gone}; after renaming back: {back}")

    # -- every scene, and the Speed Page

    def scene_shots(self) -> None:
        shots = self.folder / "shots"
        for n, scene in enumerate(self.ids["scenes"], 1):
            self.program(scene["name"], 2.0)
            pixels, raw = screenshot(self.obs, 960, sourceUuid=scene["uuid"])
            path = save_shot(shots, f"{n}-{scene['name'].replace(' ', '-')}.png", raw)
            spread = float(pixels.std())
            self.r.add(f"shot: {scene['name']}", spread > 3, f"{path.name}, pixel spread {spread:.1f}")

    def speed_card(self) -> None:
        self.program("Kit Speed Page", 3.0)
        pixels, raw = screenshot(self.obs, 640, sourceUuid=self.uuid["Speed Page"])
        path = save_shot(self.folder / "shots", "speed-page-card.png", raw)
        spread = float(pixels.std())
        self.r.add("speed-page-card", spread > 3, f"the Speed Page shows the setup card ({path.name}, pixel "
                   f"spread {spread:.1f})")

    def speed_run(self) -> None:
        page = self.uuid["Speed Page"]
        original = self.obs.req("GetInputSettings", {"inputUuid": page})["inputSettings"]
        self.program("Kit Speed Page", 1.0)
        node = subprocess.Popen(["node", "--import", "tsx", str(REPO / "scripts" / "kit-speed-run.ts"),
                                 "--video", SPEED_VIDEO], cwd=str(REPO), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, encoding="utf-8")
        errors = drain(node.stderr)
        watchdog = threading.Timer(SPEED_RUN_S, node.terminate)  # ends stdout, so the reads below end too
        watchdog.daemon = True
        watchdog.start()
        lines: list[dict] = []
        try:
            first = json.loads(node.stdout.readline() or "{}")
            lines.append(first)
            if first.get("event") != "address":
                raise RuntimeError(f"the speed run gave no address: {redact(first)} {''.join(errors)[-800:]}")
            self.undo.append(("settings", "Speed Page", original))
            self.mute("Speed Page")
            self.obs.req("SetInputSettings", {"inputUuid": page, "overlay": True, "inputSettings":
                                              {"is_local_file": False, "url": first["address"], "reroute_audio": True}})
            for line in node.stdout:
                lines.append(json.loads(line))
                if lines[-1].get("event") == "step":
                    _, raw = screenshot(self.obs, 640, sourceUuid=page)
                    save_shot(self.folder / "shots", f"speed-{lines[-1]['want']}.png", raw)
            node.wait(30)
        finally:
            watchdog.cancel()
            if node.poll() is None:
                node.terminate()
            try:
                node.wait(10)
            except subprocess.TimeoutExpired:
                node.kill()
                node.wait(5)
            node.stdout.close()
        lines = [redact(line) for line in lines]
        done = lines[-1] if lines else {}
        steps = [l for l in lines if l.get("event") == "step"]
        ok = done.get("event") == "done" and done.get("ok") is True and steps and all(s["ok"] for s in steps)
        self.r.add("speed-run", ok, "; ".join(f"{s['press']}: strip {s['seen']!r} (wanted {s['want']})"
                                             for s in steps) or f"no steps: {done} {''.join(errors)[-800:]}",
                   lines=lines)

    # -- put everything back

    def put_back(self) -> None:
        """Undo every change, newest first; one failing step does not skip the others."""
        failed, done = [], []
        first = self.ids["scenes"][0]["name"]
        steps = [("program", first), ("preview", first)] + self.undo[::-1]
        self.undo = []
        for step in steps:
            try:
                if step[0] == "program":
                    self.program(step[1], 1.0)
                elif step[0] == "preview":  # Studio Mode's Preview back on the first scene too
                    if self.obs.req("GetStudioModeEnabled")["studioModeEnabled"]:
                        self.obs.req("SetCurrentPreviewScene", {"sceneName": step[1]})
                elif step[0] == "studio":
                    self.obs.req("SetStudioModeEnabled", {"studioModeEnabled": step[1]})
                    self.wait(1.0)
                elif step[0] == "unmute":
                    self.obs.req("SetInputMute", {"inputUuid": self.uuid[step[1]], "inputMuted": False})
                elif step[0] == "settings":
                    self.obs.req("SetInputSettings", {"inputUuid": self.uuid[step[1]], "overlay": False,
                                                      "inputSettings": step[2]})
                done.append(f"{step[0]} {step[1]}")
            except Exception as exc:  # noqa: BLE001 - recorded; the next step still runs
                failed.append(f"{step[0]} {step[1]}: {type(exc).__name__}: {exc}")
        self.wait(1.5)  # Playlister saves at most once a second
        self.r.add("put-back", not failed, "; ".join(failed) or "put back: " + ", ".join(done))


def drain(stream) -> list[str]:
    """Read a pipe on a thread so it never fills; keeps its last lines, page key redacted."""
    kept: list[str] = []

    def read() -> None:
        with stream:
            for line in stream:
                kept.append(re.sub(r"token=[0-9a-f]+", "token=<not kept>", line))
                del kept[:-40]

    threading.Thread(target=read, daemon=True).start()
    return kept


def config_hashes(obs_dir: Path) -> dict[str, str]:
    """The SHA-256 of every file in the portable's config once OBS has closed (plan 8.5)."""
    return kit_obs.tree_hashes(obs_dir / "config")


def run(zip_path: Path, folder: Path, port: int, speed_run: bool, lock: Path, core: Path) -> int:
    ids = kc.load_ids()
    problems = kc.ids_problems(ids)
    if problems:
        raise RuntimeError("kit-ids.json: " + "; ".join(problems))
    folder.mkdir(parents=True, exist_ok=True)
    kit_dir, obs_dir = (folder / "kit").resolve(), (folder / "obs").resolve()
    results = Results(folder / "results.jsonl")

    names = unzip(zip_path, kit_dir)
    results.add("zip", kk.top_level(names) == sorted(
        [kd.COLLECTION_FILE, "media/", kc.SETUP_CARD, "README.md", "CREDITS.md", *kd.PROFILE_FILES]),
        f"{len(names)} files unzipped into {kit_dir}", names=names)
    assembly = kit_obs.assemble(obs_dir, core, collection=ids["collection"])
    results.add("fresh portable", True, f"{obs_dir}: {sum(len(v) for v in assembly['core'].values())} core files "
                f"from {assembly['core_source']}, plugins " + ", ".join(
                    f"{k} ({v['source']})" for k, v in assembly["plugins"].items()))
    if not port_free(port):
        raise RuntimeError(f"port {port} is taken; pass another --port")
    password = websocket_config(obs_dir, port)

    imported = kk.import_collection(kit_dir / kd.COLLECTION_FILE)
    left = kk.leftover_dot_paths(imported)
    outside = [p for s in imported["sources"] for p in kk.input_path_problems(s["name"], s.get("settings", {}), kit_dir)]
    results.add("import (scripted)", not left and not outside, "; ".join(left + outside) or
                "OBS's Import rules: every ./ path became a path inside the kit folder that exists")
    scenes_dir = obs_dir / "config" / "obs-studio" / "basic" / "scenes"
    target = scenes_dir / f"{ids['collection']}.json"
    kit_obs.keep_aside(target)
    target.write_text(kc.dump(imported), encoding="utf-8", newline="\n")
    kept = folder / "import-scripted.json"
    kit_obs.keep_aside(kept)
    kept.write_text(kc.dump(imported), encoding="utf-8", newline="\n")

    events: list = []
    token = kit_obs.wait_for_lock(lock, "demo-kit check-kit")
    events.append({"event": "lock", "token": token, "time": time.time()})
    try:
        proc, log = kit_obs.start_obs(obs_dir, ids["collection"], events)
        try:
            obs = Obs(port, password)
            check = Check(obs, ids, kit_dir, folder, log, results,
                          obs_dir / "plugins" / "visual-sidechain" / "data" / "shaders")
            try:
                results.run_rows([
                    ("plugins", check.plugins), ("scenes", check.scenes), ("inputs", check.inputs),
                    ("paths", check.paths), ("full-frame", check.full_frame), ("filters", check.filters),
                    ("monitoring", check.monitoring), ("quiet", check.quiet), ("studio-mode", check.studio),
                    ("preview-cues", check.preview_cues), ("beat-signals", check.beat), ("reacts", check.looks_react),
                    ("panic-restore", check.panic), ("playlister-previous-next", check.playlister),
                    ("playlister-speed", check.playlister_speed), ("profile-bindings", check.bindings),
                    ("renames", check.renames), ("shots", check.scene_shots), ("speed-page-card", check.speed_card),
                    *([("speed-run", check.speed_run)] if speed_run else [])])
            finally:
                try:
                    check.put_back()
                finally:
                    obs.close()
        finally:
            kit_obs.stop_obs(proc, events, 120)
        events.append({"event": "config", "sha256": config_hashes(obs_dir), "time": time.time()})
    finally:
        events.append({"event": "unlock", "released": kit_obs.release_lock(lock, token), "time": time.time()})
        (folder / "events.json").write_text(json.dumps(events, indent=1) + "\n", encoding="utf-8")

    results.guard("saved", lambda: saved_row(results, target, kit_dir, ids))
    log_copy = folder / "obs-log.txt"
    kit_obs.keep_aside(log_copy)
    log_copy.write_bytes(log.read_bytes())
    failed = [r["row"] for r in results.rows if not r["ok"]]
    print(f"check-kit: {len(results.rows) - len(failed)} of {len(results.rows)} rows passed"
          + (f"; failed: {', '.join(failed)}" if failed else "") + f"; {results.path}")
    return 1 if failed else 0


def saved_row(results: Results, saved_path: Path, kit_dir: Path, ids: dict, row: str = "saved") -> bool:
    saved = json.loads(saved_path.read_text(encoding="utf-8"))
    normalised = kc.normalise(saved, str(kit_dir))
    normalised["name"] = ids["collection"]  # the GUI may name it "Suite Demo Kit 2"; the name is not compared
    problems = kc.check_template(normalised, ids)
    return results.add(row, not problems, "; ".join(problems) or
                       f"{saved_path.name} as OBS saved it, with {kit_dir} as ./: the kit's template, no value "
                       "changed, every uuid the kit's", name=saved.get("name"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the Suite Demo Kit zip on a fresh portable OBS 33.")
    sub = parser.add_subparsers(dest="step", required=True)
    go = sub.add_parser("run", help="unzip, assemble a fresh portable, import, start OBS and run the rows")
    go.add_argument("--zip", type=Path, required=True)
    go.add_argument("--dir", type=Path, required=True, help="the check folder (made if absent, never emptied)")
    go.add_argument("--port", type=int, default=DEFAULT_PORT)
    go.add_argument("--no-speed-run", action="store_true", help="leave out the VJster speed run")
    go.add_argument("--lock", type=Path, default=kit_obs.DEFAULT_LOCK)
    go.add_argument("--core", type=Path, default=kit_obs.DEFAULT_CORE)
    cmp = sub.add_parser("compare-import", help="check a collection OBS saved after a real Import")
    cmp.add_argument("--file", type=Path, required=True, help="the collection file in OBS's scenes folder")
    cmp.add_argument("--kit-dir", type=Path, required=True, help="the folder the zip was unzipped into")
    cmp.add_argument("--out", type=Path, help="a results file to write (by default the row is only printed)")
    args = parser.parse_args(argv)
    if args.step == "compare-import":
        out = Results(args.out.resolve() if args.out else None)
        ok = saved_row(out, args.file, args.kit_dir.resolve(), kc.load_ids(), "compare-import")
        return 0 if ok else 1
    return run(args.zip.resolve(), args.dir.resolve(), args.port, not args.no_speed_run, args.lock, args.core)


if __name__ == "__main__":
    sys.exit(main())
