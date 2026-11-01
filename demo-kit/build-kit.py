#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Suite Demo Kit builder.

Step 1: the kit's media, written into a build folder.

    python demo-kit/build-kit.py media [--out demo-kit/build] [--stock <folder>] [--with-spare]

Step 2: the scene collection (kit_collection.py, kit_obs.py; see their docstrings).

    python demo-kit/build-kit.py roundtrip --obs <fresh portable folder> [--out demo-kit/build]
    python demo-kit/build-kit.py check-collection

roundtrip writes the draft collection from kit-ids.json, loads it in a fresh portable OBS 33
assembled read-only in --obs (under the OBS lock), lets OBS save it, and writes the result
with ./ paths as kit-template.json; the diff and OBS's log go to <out>/roundtrip/.
check-collection checks the committed kit-ids.json and kit-template.json without OBS.

Step 3: CREDITS.md (kit_docs.py), from stock-credits.json after the same check of the originals.

    python demo-kit/build-kit.py credits [--stock <folder>]

Step 5: the zip that ships (kit_package.py), and the install-check (check-kit.py).

    python demo-kit/build-kit.py zip --out <folder>

What it makes, all 1280x720, 30 fps where it is video:

- kit-motion.mp4, layer-a.mp4, layer-b.mp4: 8 s seamless loops (240 frames) we draw
  ourselves. The drawing is a parameterised copy of the reel's media maker
  (C:/midi-fadester/docs/demo-reel/production/obs/media/make_original_media.py, which
  is 1920x1080/60 with a 30 s period), re-rendered with W, H, FPS, COUNT =
  1280, 720, 30, 240, never cut from the reel's files. kit-motion is the reel's "cool"
  design, layer-a its "warm" design, layer-b a third design made for the kit ("tide").
- kit-beat.ogg: a 16 s, 120 BPM loop synthesised here (kick, snare, hats from sine and
  noise envelopes), Ogg Opus, mono.
- kit-title.png: the kit's title image, drawn with Pillow (our text and shapes).
- clip-hurdles.mp4, clip-sprint.mp4, clip-train.mp4: 8 s excerpts cut from the reel's
  local stock originals after each file's SHA-1 and size are checked against
  stock-credits.json in that folder. Nothing is downloaded. Their own audio is removed
  (plan D-6). clip-marathon.mp4 (the spare) only with --with-spare.

media-manifest.json next to the media folder lists every file's SHA-1 and size, the
tool versions, and for stock excerpts the source row and the changes made (CC BY's
indicate-changes rule). It holds no absolute paths and no times, so two builds on the
same machine give the same manifest; the encoders run with bitexact flags.

The builder never deletes anything, so a file an earlier run left in media/ (say
clip-marathon.mp4 from a --with-spare run) stays there; the build names every such file
in a warning, and later steps package what the manifest lists, not the folder.

Never touches an installed OBS. Needs Python 3.10+ with numpy, opencv-python and
Pillow, ffmpeg and ffprobe on PATH (with libx264 and libopus), and Windows' Segoe UI.
The unit tests (test_build_kit.py, run by tests/demo-kit-media.test.ts) need the same
Python packages; without them that vitest file skips and the M-K1 mutations in
scripts/run-mutation-checks.ts report "survived", so the mutation runner needs them too.

Where the code's reality differs from the plan (demo-kit-plan-r1.md, section 3.4):
- The plan names no cut points. Starts follow the reel's own stock takes
  (C:/midi-fadester/docs/demo-reel/production/v2/deck/record-stock.mts:25-51):
  hurdles 4.6 s (the accepted "hurdles-2" take, mid-race), train 3.0 s, marathon 4.0 s.
  The sprint starts at 0.9 s so its 8 s end at 8.9 s, the limit in CAPTURE-LOG.md:109.
- The plan names one maker for three loops; the reel's maker has two designs, so
  layer-b is a third design in the same style.
- stock-credits.json has no file-name field; the file name is the Commons title without
  "File:" and with spaces as underscores, which matches every file in the folder.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import platform
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, __version__ as PIL_VERSION

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kit_collection as kc  # noqa: E402
import kit_docs as kd  # noqa: E402
import kit_obs  # noqa: E402
import kit_package  # noqa: E402

KIT_DIR = Path(__file__).resolve().parent
DEFAULT_OUT = KIT_DIR / "build"
CREDITS_PATH = KIT_DIR / "CREDITS.md"
DEFAULT_STOCK = Path(r"C:\midi-fadester\docs\demo-reel\production\v2\media\stock")

W, H, FPS, COUNT = 1280, 720, 30, 240
TAU = 2 * math.pi
S = W / 1920  # the reel's maker draws in 1920x1080 coordinates

OUR_LICENSE = kd.OUR_LICENSE
OUR_LICENSE_URL = kd.OUR_LICENSE_URL
OUR_AUTHOR = kd.OUR_AUTHOR

CLIP_SECONDS = 8
CLIP_FRAMES = CLIP_SECONDS * FPS
STOCK_CHANGES = "cut to 8 s, scaled to 720p, re-encoded to H.264, audio removed"

# Each excerpt: the output name, the Commons title as stock-credits.json writes it,
# where the cut starts, the latest usable second of the source, and whether it ships.
STOCK_CLIPS = [
    {"out": "clip-hurdles.mp4", "title": "File:100 metres hurdles.webm",
     "start": 4.6, "limit": 24.764, "shipped": True},
    {"out": "clip-sprint.mp4",
     "title": "File:Women's 100M Final - 28th Summer Universiade 2015 Gwangju.webm",
     "start": 0.9, "limit": 8.9, "shipped": True},
    {"out": "clip-train.mp4", "title": "File:T3 Train Crossing Cooks River.webm",
     "start": 3.0, "limit": 18.018, "shipped": True},
    {"out": "clip-marathon.mp4", "title": "File:Rome-marathon-via-galvani-2017.webm",
     "start": 4.0, "limit": 25.667, "shipped": False},
]

BEAT_RATE = 48000
BEAT_BPM = 120
BEAT_SECONDS = 16
BEAT_PEAK_DBFS = -1.0

TITLE_SIZE = (1280, 320)
TITLE_TEXT = "Suite Demo Kit"
TITLE_SUBTITLE = "Playlister \u00b7 Visual Sidechain \u00b7 Fadester \u00b7 VJster"
TITLE_FONT = Path(r"C:\Windows\Fonts\segoeuib.ttf")
SUBTITLE_FONT = Path(r"C:\Windows\Fonts\segoeui.ttf")

BITEXACT = ["-fflags", "+bitexact", "-map_metadata", "-1"]
# One x264 thread: with frame threads two runs gave different bytes on this machine.
H264 = ["-c:v", "libx264", "-threads", "1", "-preset", "medium", "-pix_fmt", "yuv420p", "-g", "60",
        "-flags:v", "+bitexact", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-colorspace", "bt709", "-movflags", "+faststart"]


class StockError(Exception):
    """A stock original is missing or is not the file stock-credits.json describes."""


# ---------------------------------------------------------------- stock excerpts

def stock_file_name(title: str) -> str:
    """The local file name for a Commons title ("File:A b.webm" -> "A_b.webm")."""
    name = title[5:] if title.startswith("File:") else title
    return name.replace(" ", "_")


def sha1_of(path: Path) -> str:
    digest = hashlib.sha1()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def clips_to_build(with_spare: bool) -> list[dict]:
    return [c for c in STOCK_CLIPS if c["shipped"] or with_spare]


def verify_stock(stock_dir: Path, clips: list[dict]) -> dict[str, dict]:
    """Check every clip's original against stock-credits.json; return its credits row.

    Every problem is collected and raised together, before anything is encoded.
    """
    credits_path = stock_dir / "stock-credits.json"
    if not credits_path.is_file():
        raise StockError(f"no stock-credits.json in {stock_dir}")
    rows = json.loads(credits_path.read_text(encoding="utf-8"))
    by_title = {row["title"]: row for row in rows}
    problems: list[str] = []
    found: dict[str, dict] = {}
    for clip in clips:
        row = by_title.get(clip["title"])
        if row is None:
            problems.append(f"{clip['title']}: no row in stock-credits.json")
            continue
        path = stock_dir / stock_file_name(clip["title"])
        if not path.is_file():
            problems.append(f"{path.name}: file missing")
            continue
        actual_bytes = path.stat().st_size
        if actual_bytes != row["bytes"]:
            problems.append(f"{path.name}: {actual_bytes} bytes, stock-credits.json says {row['bytes']}")
            continue
        actual_sha1 = sha1_of(path)
        if actual_sha1 != row["sha1"]:
            problems.append(f"{path.name}: SHA-1 {actual_sha1}, stock-credits.json says {row['sha1']}")
            continue
        found[clip["out"]] = row
    if problems:
        raise StockError("stock check failed:\n  " + "\n  ".join(problems))
    return found


def cut_command(source: Path, start: float, output: Path) -> list[str]:
    """ffmpeg arguments for one 8 s, 1280x720, 30 fps, silent H.264 excerpt."""
    return ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{start:.3f}", "-i", str(source),
            "-frames:v", str(CLIP_FRAMES), "-an", "-sn", "-dn",
            "-vf", f"fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p",
            *H264, "-crf", "23", "-maxrate", "3M", "-bufsize", "6M", *BITEXACT, str(output)]


def cut_clip(source: Path, start: float, output: Path) -> None:
    """Cut one excerpt; a failing ffmpeg is reported with its own message."""
    result = subprocess.run(cut_command(source, start, output), capture_output=True)
    if result.returncode:
        raise RuntimeError(f"ffmpeg failed for {output.name}: {result.stderr.decode(errors='replace')}")


# ---------------------------------------------------------------- our loops

def phase(frame: int) -> float:
    """The loop phase: one full turn every COUNT frames, so frame COUNT equals frame 0."""
    return TAU * frame / COUNT


LOW_W, LOW_H = W // 3, H // 3
XX, YY = np.meshgrid(np.linspace(-1.78, 1.78, LOW_W, dtype=np.float32),
                     np.linspace(-1, 1, LOW_H, dtype=np.float32))
THETA = np.linspace(0, TAU, 500, endpoint=True, dtype=np.float32)
XS = np.linspace(-160 * S, W + 160 * S, 400, dtype=np.float32)


def to_rgb(a: np.ndarray) -> np.ndarray:
    return np.clip(a, 0, 255).astype(np.uint8)


def px(v: float) -> int:
    """A 1920-wide coordinate or length at the kit's size."""
    return round(v * S)


def width(v: int) -> int:
    return max(1, round(v * S))


def cool(frame: int) -> np.ndarray:
    """kit-motion: the reel's "cool" design, folded torus curves and orbiting beads."""
    p = phase(frame)
    glow = np.exp(-((XX + .4 * math.cos(p)) ** 2 / .95 + (YY - .25 * math.sin(p)) ** 2 / 1.2))
    glow2 = np.exp(-((XX - 1.2) ** 2 / .5 + (YY + .45) ** 2 / .4))
    low = np.stack([12 + 24 * glow + 36 * glow2, 15 + 14 * glow + 18 * glow2,
                    35 + 54 * glow + 54 * glow2], axis=-1)
    canvas = cv2.resize(to_rgb(low), (W, H), interpolation=cv2.INTER_CUBIC)
    curves = []
    for k in range(29):
        q = k / 28
        th = THETA + .17 * math.sin(p) + .4 * q
        rad = 420 + 250 * q + 22 * np.sin(3 * THETA + 2 * p + q * 6)
        x = 960 + rad * np.cos(th) + 72 * np.sin(2 * THETA + p + q * 6)
        y = 540 + (175 + 210 * q) * np.sin(th) + 68 * np.cos(3 * THETA - p + q * 7)
        y += 35 * np.sin(THETA + p) * math.cos(p)
        pts = (np.stack([x, y], axis=1) * S).astype(np.int32)
        colour = (round(70 + 120 * q), round(219 - 140 * q), round(230 + 20 * q))
        curves.append((pts, colour, width(2) if k % 4 else width(4)))
    glow_layer = np.zeros_like(canvas)
    for pts, colour, _ in curves[::3]:
        cv2.polylines(glow_layer, [pts], False, colour, width(14), cv2.LINE_AA)
    glow_layer = cv2.GaussianBlur(glow_layer, (0, 0), 10 * S)
    canvas = cv2.addWeighted(canvas, 1, glow_layer, .8, 0)
    for pts, colour, w in curves:
        cv2.polylines(canvas, [pts], False, colour, w, cv2.LINE_AA)
    for k in range(30):
        a = TAU * k / 30 + p * (1 + (k % 3))
        r = 230 + (k % 6) * 130
        x = px(960 + r * math.cos(a))
        y = px(540 + (.35 * r + 35) * math.sin(a))
        colour = (130, 244, 255) if k % 3 else (230, 170, 255)
        if 0 < x < W and 0 < y < H:
            cv2.circle(canvas, (x, y), width(8), (30, 63, 86), -1, cv2.LINE_AA)
            cv2.circle(canvas, (x, y), width(3), colour, -1, cv2.LINE_AA)
    return canvas


WARM_STOPS = np.array([0, .22, .45, .67, .84, 1])
WARM_PALETTE = np.array([[39, 10, 49], [100, 21, 49], [188, 49, 34], [241, 98, 30],
                         [255, 165, 52], [255, 221, 126]], dtype=np.float32)


def warm(frame: int) -> np.ndarray:
    """layer-a: the reel's "warm" design, a fluid field with folded contours."""
    p = phase(frame)
    field = (np.sin(2.9 * XX + 1.7 * np.sin(1.7 * YY + p) + .9 * math.cos(p))
             + .65 * np.sin(3.8 * YY - 1.7 * XX - 2 * p)
             + .28 * np.sin(7 * XX + 4 * YY + p))
    v = np.clip(.5 + .25 * field, 0, 1)
    low = np.stack([np.interp(v, WARM_STOPS, WARM_PALETTE[:, i]) for i in range(3)], axis=-1)
    light = .85 + .15 * np.exp(-((XX - .2) ** 2 + (YY + .2) ** 2) / 2)
    low *= light[..., None]
    canvas = cv2.resize(to_rgb(low), (W, H), interpolation=cv2.INTER_CUBIC)
    for k in range(19):
        q = k / 18
        ys = (-180 + k * 80 + 120 * np.sin(XS / (510 * S) + p + q * 2.6)
              + 74 * np.sin(XS / (265 * S) - 2 * p + q * 4.4))
        pts = np.stack([XS, ys * S], axis=1).astype(np.int32)
        colour = (int(198 + 50 * q), int(80 + 90 * q), int(30 + 60 * q))
        cv2.polylines(canvas, [pts], False, colour, width(2) if k % 4 else width(4), cv2.LINE_AA)
    for k in range(5):
        angle = round(18 * math.sin(p + k * .12))
        centre = (px(1440 + 80 * math.cos(p)), px(470 + 110 * math.sin(p)))
        axes = (px(230 + k * 36 + 20 * math.sin(p)), px(390 + k * 16))
        cv2.ellipse(canvas, centre, axes, angle, 0, 360, (250, 170 + k * 8, 58 + k * 12),
                    width(2), cv2.LINE_AA)
    return canvas


TIDE_STOPS = np.array([0, .3, .55, .8, 1])
TIDE_PALETTE = np.array([[8, 12, 40], [30, 40, 120], [90, 60, 190], [60, 190, 220],
                         [220, 250, 255]], dtype=np.float32)


def tide(frame: int) -> np.ndarray:
    """layer-b: made for the kit in the same style, two ring sources interfering."""
    p = phase(frame)
    ax, ay = -.7 + .35 * math.cos(p), .15 * math.sin(p)
    bx, by = .8 - .3 * math.cos(p), -.2 + .2 * math.sin(2 * p)
    ra = np.sqrt((XX - ax) ** 2 + (YY - ay) ** 2)
    rb = np.sqrt((XX - bx) ** 2 + (YY - by) ** 2)
    field = np.sin(9 * ra - 2 * p) + np.sin(7 * rb + p) + .4 * np.sin(4 * XX - 3 * YY + p)
    v = np.clip(.5 + .2 * field, 0, 1)
    low = np.stack([np.interp(v, TIDE_STOPS, TIDE_PALETTE[:, i]) for i in range(3)], axis=-1)
    canvas = cv2.resize(to_rgb(low), (W, H), interpolation=cv2.INTER_CUBIC)
    for k in range(7):
        r = px(120 + k * 110 + 40 * math.sin(p + k * .9))
        centre = (px(960 + 520 * math.cos(p)), px(540 + 120 * math.sin(2 * p)))
        cv2.circle(canvas, centre, r, (150 + k * 12, 210, 255), width(2), cv2.LINE_AA)
    return canvas


LOOPS = {"kit-motion.mp4": cool, "layer-a.mp4": warm, "layer-b.mp4": tide}


def _mean_delta(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a.astype(np.int16) - b.astype(np.int16))))


def loop_seam(fn) -> tuple[float, float]:
    """(mean pixel change from frame 0 to frame COUNT, seam step / ordinary step).

    A seamless loop has frame COUNT equal to frame 0 apart from raster rounding (a few
    anti-aliased pixels, as the reel's maker also logged), and the step from the last
    frame back to frame 0 is about as large as an ordinary step between frames.
    """
    first = fn(0)
    endpoint = _mean_delta(first, fn(COUNT))
    ratio = _mean_delta(fn(COUNT - 1), first) / _mean_delta(first, fn(1))
    return endpoint, ratio


def seam_problem(name: str, endpoint: float, ratio: float) -> str | None:
    if endpoint > .01 or not .8 <= ratio <= 1.25:
        return f"{name}: not seamless (frame {COUNT} vs 0 mean {endpoint:.4f}, seam ratio {ratio:.2f})"
    return None


def render_loop(fn, output: Path) -> None:
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
               "-i", "pipe:0", "-an", *H264, "-crf", "24", "-maxrate", "1500k", "-bufsize", "3M",
               *BITEXACT, str(output)]
    proc = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdin is not None and proc.stderr is not None
    try:
        for frame in range(COUNT):
            proc.stdin.write(fn(frame).tobytes())
    except BrokenPipeError:
        pass  # ffmpeg stopped early; its exit code and message are reported below
    finally:
        try:
            proc.stdin.close()
        except BrokenPipeError:
            pass
    err = proc.stderr.read().decode(errors="replace")
    proc.stderr.close()
    if proc.wait():
        raise RuntimeError(f"ffmpeg failed for {output.name}: {err}")


# ---------------------------------------------------------------- the beat

def _hit_kick(rate: int) -> np.ndarray:
    t = np.arange(int(.45 * rate)) / rate
    freq = 50 + 100 * np.exp(-t / .045)
    phase_ = TAU * np.cumsum(freq) / rate
    return np.sin(phase_) * np.exp(-t / .16)


def _hit_snare(rate: int, noise: np.ndarray) -> np.ndarray:
    n = int(.25 * rate)
    t = np.arange(n) / rate
    tone = .45 * np.sin(TAU * 185 * t) * np.exp(-t / .05)
    return .55 * noise[:n] * np.exp(-t / .07) + tone


def _hit_hat(rate: int, noise: np.ndarray, open_: bool) -> np.ndarray:
    n = int((.18 if open_ else .06) * rate)
    t = np.arange(n) / rate
    bright = np.diff(noise[: n + 1])  # a first difference is a simple high-pass
    return .22 * bright * np.exp(-t / (.06 if open_ else .015))


def beat_hits(rate: int = BEAT_RATE, bpm: int = BEAT_BPM, seconds: int = BEAT_SECONDS
              ) -> list[tuple[int, np.ndarray]]:
    """Every hit of one loop as (start sample, samples). The noise is one seeded buffer."""
    noise = np.random.default_rng(20261101).uniform(-1, 1, rate).astype(np.float64)
    kick, snare = _hit_kick(rate), _hit_snare(rate, noise)
    hat, open_hat = _hit_hat(rate, noise, False), _hit_hat(rate, noise, True)
    beat = 60 / bpm
    hits: list[tuple[int, np.ndarray]] = []
    for b in range(round(seconds / beat)):
        at = round(b * beat * rate)
        hits.append((at, kick))
        if b % 2 == 1:
            hits.append((at, snare))
        hits.append((at, hat))
        off = round((b + .5) * beat * rate)
        hits.append((off, open_hat if b % 4 == 3 else hat))
    return hits


def mix_linear(hits: list[tuple[int, np.ndarray]], length: int) -> np.ndarray:
    """Mix hits into a buffer long enough for every tail (no wrap)."""
    out = np.zeros(length + max(len(s) for _, s in hits))
    for at, samples in hits:
        out[at:at + len(samples)] += samples
    return out


def synth_beat(rate: int = BEAT_RATE, bpm: int = BEAT_BPM, seconds: int = BEAT_SECONDS
               ) -> np.ndarray:
    """One seamless loop: tails that run past the end are folded onto the start."""
    length = rate * seconds
    mixed = mix_linear(beat_hits(rate, bpm, seconds), length)
    loop = mixed[:length].copy()
    tail = mixed[length:]
    loop[:len(tail)] += tail
    peak = np.max(np.abs(loop))
    return (loop * (10 ** (BEAT_PEAK_DBFS / 20) / peak)).astype(np.float32)


def encode_beat(samples: np.ndarray, output: Path) -> None:
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
               "-f", "f32le", "-ar", str(BEAT_RATE), "-ac", "1", "-i", "pipe:0",
               "-c:a", "libopus", "-b:a", "80k", "-flags:a", "+bitexact", *BITEXACT, str(output)]
    result = subprocess.run(command, input=samples.astype("<f4").tobytes(), capture_output=True)
    if result.returncode:
        raise RuntimeError(f"ffmpeg failed for {output.name}: {result.stderr.decode(errors='replace')}")


# ---------------------------------------------------------------- the title image

def render_title() -> Image.Image:
    """The kit's title image: a transparent card with the name, subtitle and level bars."""
    img = Image.new("RGBA", TITLE_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    w, h = TITLE_SIZE
    draw.rounded_rectangle((8, 8, w - 8, h - 8), radius=36, fill=(14, 18, 40, 225),
                           outline=(90, 200, 230, 255), width=4)
    for i in range(12):  # a row of level bars, our own shape
        bar = 30 + round(90 * abs(math.sin(i * .9 + .4)))
        x = 60 + i * 26
        draw.rounded_rectangle((x, h // 2 + 70 - bar, x + 16, h // 2 + 70), radius=6,
                               fill=(70 + i * 12, 219 - i * 10, 240, 255))
    title_font = ImageFont.truetype(str(TITLE_FONT), 112)
    sub_font = ImageFont.truetype(str(SUBTITLE_FONT), 40)
    draw.text((420, 70), TITLE_TEXT, font=title_font, fill=(240, 246, 255, 255))
    draw.text((424, 214), TITLE_SUBTITLE, font=sub_font, fill=(150, 210, 235, 255))
    return img


def save_title(output: Path) -> None:
    render_title().save(output, format="PNG", optimize=False)


# ---------------------------------------------------------------- checks and manifest

def probe(path: Path) -> dict:
    result = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_entries",
                             "stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames"
                             ":format=duration", "-of", "json", str(path)],
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def check_video(path: Path) -> list[str]:
    """Problems with one video output: it must be 1280x720, 30 fps, 240 frames, silent."""
    info = probe(path)
    streams = info.get("streams", [])
    problems = []
    if any(s.get("codec_type") == "audio" for s in streams):
        problems.append(f"{path.name}: has an audio stream")
    video = [s for s in streams if s.get("codec_type") == "video"]
    if len(video) != 1:
        return problems + [f"{path.name}: {len(video)} video streams"]
    v = video[0]
    if (v.get("width"), v.get("height")) != (W, H):
        problems.append(f"{path.name}: {v.get('width')}x{v.get('height')}")
    if v.get("r_frame_rate") != f"{FPS}/1":
        problems.append(f"{path.name}: {v.get('r_frame_rate')} fps")
    if v.get("codec_name") != "h264":
        problems.append(f"{path.name}: codec {v.get('codec_name')}")
    if str(v.get("nb_read_frames")) != str(COUNT):
        problems.append(f"{path.name}: {v.get('nb_read_frames')} frames")
    return problems


def check_beat(path: Path) -> list[str]:
    info = probe(path)
    audio = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    if len(audio) != 1 or audio[0].get("codec_name") != "opus":
        return [f"{path.name}: not one Opus stream"]
    duration = float(info["format"]["duration"])
    if abs(duration - BEAT_SECONDS) > .05:
        return [f"{path.name}: {duration:.3f} s"]
    return []


def file_entry(media_dir: Path, name: str) -> dict:
    path = media_dir / name
    return {"path": f"media/{name}", "bytes": path.stat().st_size, "sha1": sha1_of(path)}


def tool_versions() -> dict:
    ffmpeg = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, check=True)
    return {"ffmpeg": ffmpeg.stdout.splitlines()[0], "python": platform.python_version(),
            "numpy": np.__version__, "opencv": cv2.__version__, "pillow": PIL_VERSION}


def make_manifest(entries: list[dict], tools: dict) -> dict:
    """The manifest; refuses an entry holding an absolute path (a drive letter or a leading slash)."""
    for entry in entries:
        text = json.dumps(entry).replace("https://", "").replace("http://", "")
        if ":\\\\" in text or ":/" in text or '"/' in text or '"\\\\' in text:
            raise ValueError(f"absolute path in manifest entry {entry['path']}")
    return {"kit": "Suite Demo Kit", "version": "1.0", "step": "media",
            "generator": "demo-kit/build-kit.py media", "tools": tools,
            "files": sorted(entries, key=lambda e: e["path"])}


# ---------------------------------------------------------------- the media step

def build_media(out: Path, stock_dir: Path, with_spare: bool = False) -> dict:
    clips = clips_to_build(with_spare)
    rows = verify_stock(stock_dir, clips)  # before anything is written
    media = out / "media"
    media.mkdir(parents=True, exist_ok=True)

    for name, fn in LOOPS.items():
        problem = seam_problem(name, *loop_seam(fn))
        if problem:
            raise RuntimeError(problem)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        jobs = [pool.submit(render_loop, fn, media / name) for name, fn in LOOPS.items()]
        for clip in clips:
            source = stock_dir / stock_file_name(clip["title"])
            jobs.append(pool.submit(cut_clip, source, clip["start"], media / clip["out"]))
        for job in jobs:
            job.result()
    encode_beat(synth_beat(), media / "kit-beat.ogg")
    save_title(media / "kit-title.png")

    problems: list[str] = []
    for name in [*LOOPS, *(c["out"] for c in clips)]:
        problems += check_video(media / name)
    problems += check_beat(media / "kit-beat.ogg")
    if problems:
        raise RuntimeError("media check failed:\n  " + "\n  ".join(problems))

    manifest = make_manifest(media_entries(media, clips, rows), tool_versions())
    (out / "media-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8",
                                              newline="\n")
    return manifest


def media_entries(media: Path, clips: list[dict], rows: dict[str, dict]) -> list[dict]:
    """The manifest's file entries: our originals, then each stock excerpt with its source."""
    entries = []
    for name in [*LOOPS, "kit-beat.ogg", "kit-title.png"]:
        entries.append({**file_entry(media, name), "kind": "original", "author": OUR_AUTHOR,
                        "license": OUR_LICENSE, "license_url": OUR_LICENSE_URL})
    for clip in clips:
        entries.append({**file_entry(media, clip["out"]), "kind": "stock", "shipped": clip["shipped"],
                        **stock_credit(clip, rows[clip["out"]])})
    return entries


def stock_credit(clip: dict, row: dict) -> dict:
    """A stock excerpt's source row and changes, as the manifest and CREDITS.md give them."""
    return {"source": {"file": stock_file_name(clip["title"]), "title": row["title"], "page": row["page"],
                       "artist": row["artist"], "license": row["license"], "license_url": row["license_url"],
                       "sha1": row["sha1"], "bytes": row["bytes"], "start": clip["start"],
                       "seconds": CLIP_SECONDS},
            "changes": STOCK_CHANGES}


def stock_rows(stock_dir: Path) -> dict[str, dict]:
    """stock-credits.json's rows for the shipped clips, keyed by output name, without hashing
    the originals (the tests compare CREDITS.md with it; the credits step uses verify_stock)."""
    rows = json.loads((stock_dir / "stock-credits.json").read_text(encoding="utf-8"))
    by_title = {row["title"]: row for row in rows}
    return {c["out"]: by_title[c["title"]] for c in clips_to_build(False)}


def credit_clips(rows: dict[str, dict]) -> list[dict]:
    """The shipped clips' credits, in STOCK_CLIPS order."""
    return [{"out": c["out"], **stock_credit(c, rows[c["out"]])} for c in clips_to_build(False)]


def write_credits(stock_dir: Path, target: Path = CREDITS_PATH) -> list[dict]:
    """Write CREDITS.md from stock-credits.json after the size and SHA-1 check of the originals."""
    clips = credit_clips(verify_stock(stock_dir, clips_to_build(False)))
    problems = kd.credits_problems(kd.render_credits(clips), clips)
    problems += kd.on_screen_problems(kc.TEXTS["Kit Credits"], clips)
    if problems:
        raise RuntimeError("credits check failed:\n  " + "\n  ".join(problems))
    target.write_text(kd.render_credits(clips), encoding="utf-8", newline="\n")
    return clips


def stray_files(out: Path, manifest: dict) -> list[str]:
    """Files in media/ the manifest does not list (left by an earlier run; never deleted)."""
    listed = {f["path"] for f in manifest["files"]}
    return sorted(p.name for p in (out / "media").iterdir()
                  if p.is_file() and f"media/{p.name}" not in listed)


def check_collection(template_path: Path) -> int:
    ids = kc.load_ids()
    problems = kc.ids_problems(ids)
    template = json.loads(template_path.read_text(encoding="utf-8"))
    problems += kc.check_template(template, ids)
    for line in problems:
        print(f"build-kit: {line}", file=sys.stderr)
    if not problems:
        print(f"{template_path.name}: {len(template['sources'])} sources, fixed UUIDs, ./ paths: ok")
    return 1 if problems else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the Suite Demo Kit.")
    sub = parser.add_subparsers(dest="step", required=True)
    media = sub.add_parser("media", help="make the kit's media into the build folder")
    media.add_argument("--out", type=Path, default=DEFAULT_OUT)
    media.add_argument("--stock", type=Path, default=DEFAULT_STOCK)
    media.add_argument("--with-spare", action="store_true", help="also cut the spare marathon clip")
    check = sub.add_parser("check-collection", help="check kit-ids.json and kit-template.json")
    check.add_argument("--template", type=Path, default=kc.TEMPLATE_PATH)
    cred = sub.add_parser("credits", help="write CREDITS.md from stock-credits.json (originals checked first)")
    cred.add_argument("--stock", type=Path, default=DEFAULT_STOCK)
    trip = sub.add_parser("roundtrip", help="load the draft collection in a fresh portable OBS 33, save it, "
                                            "and write kit-template.json")
    trip.add_argument("--obs", type=Path, required=True, help="the fresh portable's folder (made if absent)")
    trip.add_argument("--out", type=Path, default=DEFAULT_OUT, help="the build folder holding media/")
    trip.add_argument("--core", type=Path, default=kit_obs.DEFAULT_CORE, help="official OBS 33 portable tree")
    trip.add_argument("--lock", type=Path, default=kit_obs.DEFAULT_LOCK)
    trip.add_argument("--template", type=Path, default=kc.TEMPLATE_PATH)
    pack = sub.add_parser("zip", help="pack the kit zip from the template, the manifest's media, the docs and "
                                      "the built profiles")
    pack.add_argument("--out", type=Path, required=True, help="the folder the zip and kit-zip.json go to")
    pack.add_argument("--build", type=Path, default=DEFAULT_OUT, help="the build folder holding media/ and profiles/")
    args = parser.parse_args(argv)
    if args.step == "zip":
        try:
            listing = kit_package.build_zip(args.out.resolve(), build=args.build.resolve())
        except RuntimeError as exc:
            print(f"build-kit: {exc}", file=sys.stderr)
            return 2
        print(f"{listing['zip']}: {len(listing['files'])} files, {listing['size'] / 1e6:.1f} MB, "
              f"sha256 {listing['sha256']}, in {args.out.resolve()}")
        return 0
    if args.step == "check-collection":
        return check_collection(args.template)
    if args.step == "credits":
        try:
            clips = write_credits(args.stock)
        except StockError as exc:
            print(f"build-kit: {exc}", file=sys.stderr)
            return 2
        print(f"CREDITS.md: {len(clips)} stock excerpts, our media, the suggested YouTube video")
        return 0
    if args.step == "roundtrip":
        report = kit_obs.roundtrip(args.obs.resolve(), args.out.resolve(), args.template,
                                   lock=args.lock, core=args.core, setup_card=KIT_DIR / kc.SETUP_CARD)
        print(f"round-trip: {len(report['added'])} keys added by OBS, none of the draft's values changed; "
              f"wrote {args.template}")
        return check_collection(args.template)
    cv2.setNumThreads(1)
    try:
        manifest = build_media(args.out, args.stock, args.with_spare)
    except StockError as exc:
        print(f"build-kit: {exc}", file=sys.stderr)
        return 2
    total = sum(f["bytes"] for f in manifest["files"])
    for f in manifest["files"]:
        print(f"{f['sha1']}  {f['bytes']:>9}  {f['path']}")
    print(f"{len(manifest['files'])} files, {total / 1e6:.1f} MB, in {os.path.abspath(args.out)}")
    for name in stray_files(args.out, manifest):
        print(f"build-kit: warning: media/{name} is not in the manifest (left by an earlier run; "
              "not packaged)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
