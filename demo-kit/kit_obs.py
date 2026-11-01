# SPDX-License-Identifier: GPL-2.0-or-later
"""Suite Demo Kit: a fresh portable OBS 33 of the kit's own, and the collection round-trip.

Never touches an installed OBS, the shared test portable's config or plugins, or the demo
reel's OBS: the fresh portable is assembled in a folder of its own from read-only copies.

assemble(): copies bin, data and core (OBS 33 keeps its core plugins in core\\; there is no
obs-plugins folder) from an official portable tree, then the Playlister and Visual Sidechain
builds into plugins\\, and hashes every file (SHA-256) into assembly.json next to it, with
each plugin repo's HEAD as "repo_head" (informational: the hashes are the evidence). It never overwrites or deletes: run it again on the same folder
and it only checks the copies still match. Config: portable_mode.txt, global.ini and user.ini
with first run off and the updater off, and a profile "Kit" with a 1920x1080 canvas (the
canvas is the profile's, not the collection's, plan 2.1). Midi Fadester is not installed
(plan D-8: no slots before the reel).

run_obs(): the OBS lock first (no obs64 in tasklist, then C:\\Users\\jeffr\\obs-run.lock created
exclusively; it waits while another agent holds it), then only this portable's obs64 with
--portable --disable-updater --multi --disable-shutdown-check, closed through WM_CLOSE to
its main window; taskkill only if it has not exited after the close wait, and then logged.
The lock is deleted only when it is still ours.
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_CORE = Path(r"C:\Users\jeffr\OBS-Studio-33-Portable")
DEFAULT_PLUGINS = {
    "obs-playlister": Path(r"C:\Users\jeffr\Documents\obs-playlister\build_x64\rundir\RelWithDebInfo\obs-playlister"),
    "visual-sidechain": Path(r"C:\visual-sidechain\build_x64\rundir\RelWithDebInfo\visual-sidechain"),
}
DEFAULT_LOCK = Path(r"C:\Users\jeffr\obs-run.lock")
CORE_PARTS = ["bin", "data", "core"]
PROFILE = "Kit"
OBS_FLAGS = ["--portable", "--disable-updater", "--multi", "--disable-shutdown-check"]
STARTUP_LINE = "==== Startup complete"

GLOBAL_INI = """[General]
FirstRun=true
EnableAutoUpdates=false
MaxLogs=10

[Basic]
Profile={profile}
ProfileDir={profile}
SceneCollection={collection}
SceneCollectionFile={collection}
"""
USER_INI = """[General]
FirstRun=true
ConfirmOnExit=false

[BasicWindow]
PreviewProgramMode=false
"""
PROFILE_INI = """[General]
Name={profile}

[Video]
BaseCX=1920
BaseCY=1080
OutputCX=1920
OutputCY=1080
FPSType=0
FPSCommon=30
"""


class LockBusy(Exception):
    """Another agent holds the OBS lock, or an obs64 runs."""


# ---------------------------------------------------------------- assembly

def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def tree_hashes(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): sha256_of(p) for p in sorted(root.rglob("*")) if p.is_file()}


def git_head(folder: Path) -> str | None:
    """The HEAD of the repo a build folder sits in, or None. Informational only: a rundir
    can hold an older build than HEAD (or code and data of different commits), so the
    plugin files' SHA-256 hashes are the record of what was loaded."""
    run = subprocess.run(["git", "-C", str(folder), "rev-parse", "HEAD"], capture_output=True, text=True)
    return run.stdout.strip() if run.returncode == 0 else None


def copy_checked(source: Path, target: Path) -> dict[str, str]:
    """Copy a tree once (never over an existing one) and return its hashes, checked against the source."""
    if not target.exists():
        shutil.copytree(source, target)
    want, got = tree_hashes(source), tree_hashes(target)
    if want != got:
        differ = sorted(k for k in set(want) | set(got) if want.get(k) != got.get(k))
        raise RuntimeError(f"{target} does not match {source} ({len(differ)} files differ, first {differ[:3]}); "
                           "use a new folder, nothing is overwritten")
    return got


def write_once(path: Path, text: str) -> None:
    """Write a config file only if it is absent (OBS rewrites some of these on exit)."""
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")


def assemble(obs: Path, core: Path = DEFAULT_CORE, plugins: dict[str, Path] | None = None,
             collection: str = "Suite Demo Kit") -> dict:
    plugins = DEFAULT_PLUGINS if plugins is None else plugins
    obs.mkdir(parents=True, exist_ok=True)
    log: dict = {"core_source": str(core), "core": {}, "plugins": {}}
    for part in CORE_PARTS:
        log["core"][part] = copy_checked(core / part, obs / part)
    for name, folder in plugins.items():
        log["plugins"][name] = {"source": str(folder), "repo_head": git_head(folder),
                                "files": copy_checked(folder, obs / "plugins" / name)}
    write_once(obs / "portable_mode.txt", "")
    cfg = obs / "config" / "obs-studio"
    write_once(cfg / "global.ini", GLOBAL_INI.format(profile=PROFILE, collection=collection))
    write_once(cfg / "user.ini", USER_INI)
    write_once(cfg / "basic" / "profiles" / PROFILE / "basic.ini", PROFILE_INI.format(profile=PROFILE))
    (cfg / "basic" / "scenes").mkdir(parents=True, exist_ok=True)
    (obs / "assembly.json").write_text(json.dumps(log, indent=1) + "\n", encoding="utf-8", newline="\n")
    return log


# ---------------------------------------------------------------- the OBS lock

def obs_pids() -> list[int]:
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq obs64.exe", "/FO", "CSV", "/NH"],
                         capture_output=True, text=True).stdout
    return [int(line.split('","')[1]) for line in out.splitlines() if line.startswith('"obs64.exe"')]


def take_lock(lock: Path, owner: str, pids=obs_pids) -> str:
    """Create the lock exclusively, after checking no obs64 runs; returns the token written."""
    if pids():
        raise LockBusy("an obs64 is running")
    token = f"{owner} pid {os.getpid()} at {time.strftime('%Y-%m-%dT%H:%M:%S')}"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise LockBusy(f"{lock} exists: {lock.read_text(encoding='utf-8', errors='replace').strip()}") from exc
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(token + "\n")
    if pids():  # an OBS started between the check and the lock: give the lock back
        release_lock(lock, token)
        raise LockBusy("an obs64 started while taking the lock")
    return token


def wait_for_lock(lock: Path, owner: str, wait_s: float = 1800, poll_s: float = 15, pids=obs_pids) -> str:
    deadline = time.monotonic() + wait_s
    while True:
        try:
            return take_lock(lock, owner, pids)
        except LockBusy as exc:
            if time.monotonic() >= deadline:
                raise
            print(f"kit-obs: waiting for the OBS lock ({exc})", file=sys.stderr)
            time.sleep(poll_s)


def release_lock(lock: Path, token: str) -> bool:
    """Delete the lock only if it still holds our token."""
    try:
        if lock.read_text(encoding="utf-8").strip() != token:
            return False
    except FileNotFoundError:
        return False
    lock.unlink()
    return True


# ---------------------------------------------------------------- start and stop

def windows(pid: int) -> list[tuple[int, str]]:
    from ctypes import wintypes as w
    user32 = ctypes.WinDLL("user32")
    found: list[tuple[int, str]] = []

    @ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
    def enum(hwnd, _):
        title = ctypes.create_unicode_buffer(512)
        user32.GetWindowTextW(hwnd, title, 512)
        owner = w.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            found.append((hwnd, title.value))
        return True

    user32.EnumWindows(enum, 0)
    return found


def newest_log(obs: Path) -> Path | None:
    logs = sorted((obs / "config" / "obs-studio" / "logs").glob("*.txt"), key=lambda p: p.stat().st_mtime)
    return logs[-1] if logs else None


def run_obs(obs: Path, collection: str, events: list, settle_s: float = 8, start_s: float = 180,
            close_s: float = 120) -> Path:
    """Start this portable's OBS on a collection, let it settle, close it; returns its log.

    The caller holds the OBS lock. events gets one dict per step (start, close, kill)."""
    exe = obs / "bin" / "64bit" / "obs64.exe"
    before = newest_log(obs)
    args = [str(exe), *OBS_FLAGS, "--profile", PROFILE, "--collection", collection]
    proc = subprocess.Popen(args, cwd=str(exe.parent))
    events.append({"event": "start", "pid": proc.pid, "args": args, "time": time.time()})
    log = None
    deadline = time.monotonic() + start_s
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"OBS exited early with {proc.returncode}")
        log = newest_log(obs)
        if log is not None and log != before and STARTUP_LINE in log.read_text(encoding="utf-8", errors="replace") \
                and any(t.startswith("OBS ") for _, t in windows(proc.pid)):
            break
        time.sleep(0.5)
    else:
        stop_obs(proc, events, close_s)
        raise RuntimeError(f"OBS did not finish starting in {start_s} s")
    time.sleep(settle_s)
    stop_obs(proc, events, close_s)
    return log


def stop_obs(proc: subprocess.Popen, events: list, close_s: float) -> None:
    main = [h for h, t in windows(proc.pid) if t.startswith("OBS ")]
    if main:
        ctypes.WinDLL("user32").PostMessageW(main[0], 0x0010, 0, 0)  # WM_CLOSE
        events.append({"event": "close", "pid": proc.pid, "time": time.time()})
    try:
        proc.wait(close_s)
        events.append({"event": "exited", "pid": proc.pid, "code": proc.returncode, "time": time.time()})
    except subprocess.TimeoutExpired:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        events.append({"event": "taskkill", "pid": proc.pid, "reason": f"no exit {close_s} s after WM_CLOSE",
                       "time": time.time()})
        proc.wait(30)
        raise RuntimeError("OBS did not exit after WM_CLOSE; taskkill used (logged)")


LOADED_LINE = "] plugin loaded successfully"


def log_failures(text: str, plugins) -> list[str]:
    """What in an OBS log fails the round-trip: a kit plugin without its "plugin loaded
    successfully" line, any line naming a kit plugin that says it failed, a source type OBS
    does not know (Source ID '...' not found) or a source it could not create.

    Narrow on purpose: OBS 33 logs benign "Failed to load 'en-US' text" and "not found"
    lines for its own optional modules (decklink, the NVIDIA denoiser) on every start."""
    lines = [line.strip() for line in text.splitlines()]
    found = [f"{name}: no '[{name}{LOADED_LINE}' line in the OBS log" for name in plugins
             if not any(f"[{name}{LOADED_LINE}" in line for line in lines)]
    for line in lines:
        low = line.lower()
        if ("source id '" in low and "' not found" in low) or "failed to create source" in low \
                or (any(name.lower() in low for name in plugins) and "fail" in low):
            found.append(line)
    return found


# ---------------------------------------------------------------- the round-trip

STAND_IN_CARD = """<!doctype html>
<meta charset="utf-8">
<title>Suite Demo Kit setup card (round-trip stand-in)</title>
<body style="background:#121a2a;color:#fff;font:32px 'Segoe UI',sans-serif">
<p>Round-trip stand-in: the setup card itself is plan step 3. Not shipped.</p>
"""


def place_kit_files(root: Path, media: Path, manifest: dict, setup_card: Path | None) -> None:
    """Copy the kit's media (checked against the media manifest) and the setup card under root."""
    import kit_collection as kc
    listed = {f["path"]: f for f in manifest["files"]}
    for rel in kc.MEDIA_FILES:
        entry = listed.get(rel)
        if entry is None:
            raise RuntimeError(f"{rel} is not in the media manifest; run build-kit.py media first")
        source = media.parent / rel
        if hashlib.sha1(source.read_bytes()).hexdigest() != entry["sha1"]:
            raise RuntimeError(f"{source} does not match the media manifest")
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copy2(source, target)
        elif sha256_of(target) != sha256_of(source):
            raise RuntimeError(f"{target} exists and differs from {source}; use a new folder")
    card = root / kc.SETUP_CARD
    if setup_card and setup_card.is_file():
        # The real card (step 3): an earlier card that differs, such as step 2's stand-in, is
        # set aside (renamed, never deleted) so the round-trip loads the card that ships.
        if card.exists() and card.read_bytes() != setup_card.read_bytes():
            keep_aside(card)
        if not card.exists():
            shutil.copy2(setup_card, card)
    elif not card.exists():
        card.write_text(STAND_IN_CARD, encoding="utf-8", newline="\n")


def keep_aside(path: Path) -> None:
    """Rename an earlier file out of the way (never deleted)."""
    if path.exists():
        n = 1
        while path.with_name(f"{path.name}.run{n}").exists():
            n += 1
        path.rename(path.with_name(f"{path.name}.run{n}"))


def roundtrip(obs: Path, build: Path, template_path: Path, lock: Path = DEFAULT_LOCK,
              core: Path = DEFAULT_CORE, plugins: dict[str, Path] | None = None,
              setup_card: Path | None = None) -> dict:
    """Draft -> portable OBS load and save -> normalised template, with the diff written to build/roundtrip/."""
    import kit_collection as kc
    ids = kc.load_ids()
    problems = kc.ids_problems(ids)
    if problems:
        raise RuntimeError("kit-ids.json: " + "; ".join(problems))
    manifest = json.loads((build / "media-manifest.json").read_text(encoding="utf-8"))
    report_dir = build / "roundtrip"
    report_dir.mkdir(parents=True, exist_ok=True)

    assembly = assemble(obs, core, plugins, ids["collection"])
    root = obs / "kit-root"
    place_kit_files(root, build / "media", manifest, setup_card)
    root_posix = root.resolve().as_posix()
    draft = kc.draft_collection(ids, root_posix)
    scenes = obs / "config" / "obs-studio" / "basic" / "scenes"
    target = scenes / f"{ids['collection']}.json"
    keep_aside(target)
    target.write_text(kc.dump(draft), encoding="utf-8", newline="\n")

    events: list = []
    token = wait_for_lock(lock, "demo-kit roundtrip")
    events.append({"event": "lock", "token": token, "time": time.time()})
    try:
        log = run_obs(obs, ids["collection"], events)
    finally:
        events.append({"event": "unlock", "released": release_lock(lock, token), "time": time.time()})
        (report_dir / "events.json").write_text(json.dumps(events, indent=1) + "\n", encoding="utf-8")

    saved = json.loads(target.read_text(encoding="utf-8"))
    log_text = log.read_text(encoding="utf-8", errors="replace")
    normalised = kc.normalise(saved, root_posix)
    delta = kc.diff_draft(kc.draft_collection(ids), normalised)
    report = {"obs_log": log.name, "log_failures": log_failures(log_text, list(assembly["plugins"])),
              "plugins": {k: {"source": v["source"], "repo_head": v["repo_head"],
                              "dll_sha256": {f: h for f, h in v["files"].items() if f.endswith(".dll")}}
                          for k, v in assembly["plugins"].items()},
              "core_source": assembly["core_source"],
              "changed": delta["changed"], "missing": delta["missing"], "added": sorted(delta["added"]),
              "template_problems": kc.check_template(normalised, ids)}
    for name, data in (("draft.json", draft), ("saved.json", saved), ("diff.json", report)):
        (report_dir / name).write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    shutil.copy2(log, report_dir / "obs-log.txt")
    if report["log_failures"]:
        raise RuntimeError("round-trip: a kit plugin or source failed in the OBS log, see "
                           + str(report_dir / "diff.json"))
    if delta["changed"] or delta["missing"] or report["template_problems"]:
        raise RuntimeError("round-trip: OBS did not keep the draft, see " + str(report_dir / "diff.json"))
    template_path.write_text(kc.dump(normalised), encoding="utf-8", newline="\n")
    return report
