# SPDX-License-Identifier: GPL-2.0-or-later
"""Unit tests for demo-kit/build-kit.py (the media step). Run by tests/demo-kit-media.test.ts.

They need numpy, opencv-python and Pillow, but not the stock originals: the stock check
runs on small files made here. The title tests need Windows' Segoe UI and the ffmpeg tests
need ffmpeg and ffprobe on PATH; each skips, with the reason, when its need is missing.
"""
import hashlib
import importlib.util
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

sys.dont_write_bytecode = True
_SPEC = importlib.util.spec_from_file_location("build_kit", Path(__file__).with_name("build-kit.py"))
kit = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(kit)

HAVE_FONTS = kit.TITLE_FONT.is_file() and kit.SUBTITLE_FONT.is_file()
NO_FONTS = f"Segoe UI not found ({kit.TITLE_FONT})"
HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
NO_FFMPEG = "ffmpeg or ffprobe not on PATH"


def lavfi(output: Path, video: str, *extra: str) -> None:
    """A short synthetic file made by ffmpeg from a lavfi source."""
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", video,
                    *extra, str(output)], check=True, capture_output=True)


def sliding_loop(frame: int) -> np.ndarray:
    """A cheap seamless loop for the build test: a gradient slid 16 px a frame (3 widths a loop)."""
    row = np.tile(np.arange(256, dtype=np.uint8), kit.W // 256)
    img = np.repeat(np.roll(row, 16 * frame)[None, :, None], kit.H, axis=0)
    return np.repeat(img, 3, axis=2)


def write_stock(folder: Path, files: dict[str, bytes], rows: list[dict]) -> None:
    for name, data in files.items():
        (folder / name).write_bytes(data)
    (folder / "stock-credits.json").write_text(json.dumps(rows), encoding="utf-8")


def row_for(title: str, data: bytes) -> dict:
    return {"title": title, "page": "https://commons.wikimedia.org/wiki/" + title.replace(" ", "_"),
            "sha1": hashlib.sha1(data).hexdigest(), "bytes": len(data), "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0", "artist": "Someone"}


CLIP = {"out": "clip-test.mp4", "title": "File:A test clip.webm", "start": 1.0, "limit": 20, "shipped": True}


class StockPlan(unittest.TestCase):
    def test_file_name_from_title(self):
        self.assertEqual(kit.stock_file_name("File:100 metres hurdles.webm"), "100_metres_hurdles.webm")
        self.assertEqual(kit.stock_file_name("File:Women's 100M Final - 28th Summer Universiade 2015 Gwangju.webm"),
                         "Women's_100M_Final_-_28th_Summer_Universiade_2015_Gwangju.webm")

    def test_three_clips_ship_and_the_spare_only_on_request(self):
        shipped = [c["out"] for c in kit.clips_to_build(False)]
        self.assertEqual(shipped, ["clip-hurdles.mp4", "clip-sprint.mp4", "clip-train.mp4"])
        self.assertEqual([c["out"] for c in kit.clips_to_build(True)], shipped + ["clip-marathon.mp4"])

    def test_kilnap_viaduct_is_never_cut(self):
        self.assertFalse(any("Kilnap" in c["title"] for c in kit.STOCK_CLIPS))

    def test_every_cut_fits_inside_its_usable_part(self):
        for clip in kit.STOCK_CLIPS:
            self.assertGreaterEqual(clip["start"], 0, clip["out"])
            self.assertLessEqual(clip["start"] + kit.CLIP_SECONDS, clip["limit"], clip["out"])
        sprint = next(c for c in kit.STOCK_CLIPS if c["out"] == "clip-sprint.mp4")
        self.assertEqual(sprint["limit"], 8.9)

    def test_cut_command_is_8_s_720p_30_fps_silent_and_bitexact(self):
        args = kit.cut_command(Path("in.webm"), 4.6, Path("out.mp4"))
        self.assertLess(args.index("-ss"), args.index("-i"))
        self.assertEqual(args[args.index("-ss") + 1], "4.600")
        self.assertEqual(args[args.index("-frames:v") + 1], "240")
        self.assertIn("-an", args)
        self.assertIn("fps=30,scale=1280:720", args[args.index("-vf") + 1])
        self.assertEqual(args[args.index("-threads") + 1], "1")
        self.assertIn("+bitexact", args)
        self.assertEqual(args[-1], "out.mp4")


class StockCheck(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.data = b"stock original bytes"

    def tearDown(self):
        self._tmp.cleanup()

    def test_a_matching_file_passes_and_returns_its_row(self):
        write_stock(self.dir, {"A_test_clip.webm": self.data}, [row_for(CLIP["title"], self.data)])
        rows = kit.verify_stock(self.dir, [CLIP])
        self.assertEqual(rows["clip-test.mp4"]["sha1"], hashlib.sha1(self.data).hexdigest())

    def test_a_changed_file_of_the_same_size_is_refused(self):
        changed = b"stock original bytez"
        write_stock(self.dir, {"A_test_clip.webm": changed}, [row_for(CLIP["title"], self.data)])
        with self.assertRaisesRegex(kit.StockError, "SHA-1"):
            kit.verify_stock(self.dir, [CLIP])

    def test_a_file_of_another_size_is_refused(self):
        write_stock(self.dir, {"A_test_clip.webm": self.data + b"!"}, [row_for(CLIP["title"], self.data)])
        with self.assertRaisesRegex(kit.StockError, "bytes"):
            kit.verify_stock(self.dir, [CLIP])

    def test_a_missing_file_is_refused(self):
        write_stock(self.dir, {}, [row_for(CLIP["title"], self.data)])
        with self.assertRaisesRegex(kit.StockError, "file missing"):
            kit.verify_stock(self.dir, [CLIP])

    def test_a_clip_with_no_credits_row_is_refused(self):
        write_stock(self.dir, {"A_test_clip.webm": self.data}, [])
        with self.assertRaisesRegex(kit.StockError, "no row"):
            kit.verify_stock(self.dir, [CLIP])

    def test_no_credits_file_is_refused(self):
        with self.assertRaisesRegex(kit.StockError, "stock-credits.json"):
            kit.verify_stock(self.dir, [CLIP])

    def test_every_problem_is_named_together(self):
        other = {**CLIP, "out": "clip-other.mp4", "title": "File:Other.webm"}
        write_stock(self.dir, {"A_test_clip.webm": b"wrong bytes of size20"}, [row_for(CLIP["title"], self.data)])
        with self.assertRaises(kit.StockError) as caught:
            kit.verify_stock(self.dir, [CLIP, other])
        self.assertIn("A_test_clip.webm", str(caught.exception))
        self.assertIn("File:Other.webm", str(caught.exception))

    def test_the_build_refuses_before_writing_any_media(self):
        write_stock(self.dir, {}, [])
        out = self.dir / "out"
        with self.assertRaises(kit.StockError):
            kit.build_media(out, self.dir)
        self.assertFalse((out / "media").exists())


class Loops(unittest.TestCase):
    def test_each_loop_is_720p_and_seamless_over_240_frames(self):
        self.assertEqual((kit.W, kit.H, kit.FPS, kit.COUNT), (1280, 720, 30, 240))
        for name, fn in kit.LOOPS.items():
            with self.subTest(name):
                self.assertEqual(fn(0).shape, (720, 1280, 3))
                endpoint, ratio = kit.loop_seam(fn)
                self.assertIsNone(kit.seam_problem(name, endpoint, ratio))

    def test_the_seam_check_catches_a_jump(self):
        self.assertIsNotNone(kit.seam_problem("x", .5, 1.0))
        self.assertIsNotNone(kit.seam_problem("x", 0, 3.0))
        self.assertIsNone(kit.seam_problem("x", 0, 1.0))

    def test_the_loops_move_and_differ(self):
        firsts = [fn(0) for fn in kit.LOOPS.values()]
        for fn, first in zip(kit.LOOPS.values(), firsts):
            self.assertGreater(np.mean(np.abs(first.astype(int) - fn(60).astype(int))), 1)
        self.assertGreater(np.mean(np.abs(firsts[0].astype(int) - firsts[1].astype(int))), 10)
        self.assertGreater(np.mean(np.abs(firsts[1].astype(int) - firsts[2].astype(int))), 10)


class Beat(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.beat = kit.synth_beat()

    def test_16_s_at_48_khz_peaking_at_minus_1_dbfs(self):
        self.assertEqual(len(self.beat), 48000 * 16)
        self.assertAlmostEqual(float(np.max(np.abs(self.beat))), 10 ** (-1 / 20), places=5)

    def test_it_is_the_same_every_time(self):
        self.assertTrue(np.array_equal(self.beat, kit.synth_beat()))

    def test_it_loops_seamlessly(self):
        # Two loops mixed straight through: the second one must equal the folded loop.
        # At 120 BPM every tail ends inside the loop; at 240 BPM the last kick's tail
        # runs past the end, so the fold itself is exercised.
        for rate, bpm, seconds in [(48000, 120, 16), (8000, 240, 2)]:
            with self.subTest(bpm=bpm):
                length = rate * seconds
                hits = kit.beat_hits(rate, bpm, seconds)
                if bpm == 240:
                    self.assertGreater(max(at + len(s) for at, s in hits), length)
                beat = self.beat if bpm == 120 else kit.synth_beat(rate, bpm, seconds)
                twice = [*hits, *[(at + length, s) for at, s in hits]]
                straight = kit.mix_linear(twice, 2 * length)[length:2 * length]
                scale = float(np.max(np.abs(beat))) / float(np.max(np.abs(straight)))
                self.assertTrue(np.allclose(straight * scale, beat, atol=1e-5))

    def test_a_kick_lands_on_every_beat_at_120_bpm(self):
        for b in range(32):
            at = b * 24000
            before = np.mean(np.abs(self.beat[at - 960:at - 480])) if at else 0
            after = np.mean(np.abs(self.beat[at:at + 960]))
            self.assertGreater(after, before, f"beat {b}")
        hits = kit.beat_hits()
        kick = hits[0][1]  # the first hit of the loop is the kick on beat 1
        self.assertEqual([at for at, s in hits if s is kick], [b * 24000 for b in range(32)])


class Title(unittest.TestCase):
    @unittest.skipUnless(HAVE_FONTS, NO_FONTS)
    def test_size_mode_and_the_same_bytes_every_time(self):
        def png() -> bytes:
            buffer = io.BytesIO()
            kit.render_title().save(buffer, format="PNG", optimize=False)
            return buffer.getvalue()
        img = kit.render_title()
        self.assertEqual((img.size, img.mode), ((1280, 320), "RGBA"))
        self.assertEqual(png(), png())

    def test_the_title_names_no_obs_or_youtube(self):
        for text in (kit.TITLE_TEXT, kit.TITLE_SUBTITLE):
            self.assertNotIn("OBS", text)
            self.assertNotIn("YouTube", text)


class Manifest(unittest.TestCase):
    def test_relative_paths_and_page_urls_are_accepted(self):
        entry = {"path": "media/clip-train.mp4", "source": {"page": "https://commons.wikimedia.org/wiki/x"}}
        manifest = kit.make_manifest([entry], {"ffmpeg": "x"})
        self.assertEqual(manifest["files"], [entry])

    def test_an_absolute_path_is_refused(self):
        for bad in ["C:/midi-fadester/x.webm", "C:\\midi-fadester\\x.webm", "/home/x.webm"]:
            with self.subTest(bad), self.assertRaises(ValueError):
                kit.make_manifest([{"path": "media/x.mp4", "source": {"file": bad}}], {})

    def test_entries_carry_licence_and_each_stock_clips_source_and_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            media = Path(tmp)
            names = [*kit.LOOPS, "kit-beat.ogg", "kit-title.png", "clip-test.mp4", "clip-spare.mp4"]
            for name in names:
                (media / name).write_bytes(name.encode())
            spare = {**CLIP, "out": "clip-spare.mp4", "title": "File:A spare.webm", "shipped": False}
            rows = {"clip-test.mp4": row_for(CLIP["title"], b"a"), "clip-spare.mp4": row_for(spare["title"], b"bb")}
            entries = {e["path"]: e for e in kit.media_entries(media, [CLIP, spare], rows)}
        self.assertEqual(sorted(entries), sorted(f"media/{n}" for n in names))
        for name in [*kit.LOOPS, "kit-beat.ogg", "kit-title.png"]:
            entry = entries[f"media/{name}"]
            self.assertEqual((entry["kind"], entry["author"], entry["license"]),
                             ("original", "Jeffrey A. Brick", "CC BY 4.0"), name)
            self.assertEqual(entry["sha1"], hashlib.sha1(name.encode()).hexdigest())
            self.assertEqual(entry["bytes"], len(name.encode()))
        stock = entries["media/clip-test.mp4"]
        self.assertEqual((stock["kind"], stock["shipped"]), ("stock", True))
        self.assertEqual(stock["changes"], "cut to 8 s, scaled to 720p, re-encoded to H.264, audio removed")
        self.assertEqual(stock["source"], {
            "file": "A_test_clip.webm", "title": CLIP["title"], "page": rows["clip-test.mp4"]["page"],
            "artist": "Someone", "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0",
            "sha1": hashlib.sha1(b"a").hexdigest(), "bytes": 1, "start": 1.0, "seconds": 8})
        self.assertFalse(entries["media/clip-spare.mp4"]["shipped"])

    def test_files_the_manifest_does_not_list_are_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "media").mkdir()
            for name in ["kit-motion.mp4", "clip-marathon.mp4", "old.txt"]:
                (out / "media" / name).write_bytes(b"x")
            manifest = {"files": [{"path": "media/kit-motion.mp4"}]}
            self.assertEqual(kit.stray_files(out, manifest), ["clip-marathon.mp4", "old.txt"])
            self.assertTrue((out / "media" / "clip-marathon.mp4").exists())  # named, never deleted


@unittest.skipUnless(HAVE_FFMPEG, NO_FFMPEG)
class Checks(unittest.TestCase):
    """check_video and check_beat on small files ffmpeg makes here."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls._tmp.name)
        h264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
        cls.good = cls.dir / "good.mp4"
        lavfi(cls.good, "color=c=gray:s=1280x720:r=30:d=8", *h264)
        lavfi(cls.dir / "small.mp4", "color=c=gray:s=640x360:r=30:d=8", *h264)
        lavfi(cls.dir / "short.mp4", "color=c=gray:s=1280x720:r=30:d=1", *h264)
        lavfi(cls.dir / "fps25.mp4", "color=c=gray:s=1280x720:r=25:d=9.6", *h264)
        lavfi(cls.dir / "mpeg4.mp4", "color=c=gray:s=1280x720:r=30:d=8", "-c:v", "mpeg4")
        lavfi(cls.dir / "loud.mp4", "color=c=gray:s=1280x720:r=30:d=8", "-f", "lavfi", "-i",
              "sine=d=8", *h264, "-c:a", "aac", "-shortest")

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_a_right_clip_passes(self):
        self.assertEqual(kit.check_video(self.good), [])

    def test_each_wrong_property_is_named(self):
        for name, says in [("small.mp4", "640x360"), ("short.mp4", "30 frames"), ("fps25.mp4", "25/1 fps"),
                           ("mpeg4.mp4", "codec mpeg4"), ("loud.mp4", "audio stream")]:
            with self.subTest(name):
                problems = kit.check_video(self.dir / name)
                self.assertTrue(any(says in p for p in problems), problems)

    def test_the_beat_check_wants_16_s_of_opus(self):
        beat = self.dir / "beat.ogg"
        kit.encode_beat(kit.synth_beat(), beat)
        self.assertEqual(kit.check_beat(beat), [])
        short = self.dir / "short.ogg"
        kit.encode_beat(kit.synth_beat()[:48000 * 4], short)
        self.assertTrue(any("4.0" in p for p in kit.check_beat(short)), kit.check_beat(short))
        flac = self.dir / "beat.flac"
        lavfi(flac, "sine=d=16")
        self.assertEqual(kit.check_beat(flac), ["beat.flac: not one Opus stream"])

    def test_a_failing_cut_reports_ffmpegs_message(self):
        missing = self.dir / "no-such-source.webm"
        with self.assertRaises(RuntimeError) as caught:
            kit.cut_clip(missing, 0, self.dir / "cut.mp4")
        message = str(caught.exception)
        self.assertIn("ffmpeg failed for cut.mp4", message)
        self.assertIn("no-such-source.webm", message)  # ffmpeg's own stderr, not thrown away


@unittest.skipUnless(HAVE_FFMPEG, NO_FFMPEG)
@unittest.skipUnless(HAVE_FONTS, NO_FONTS)
class BuildMedia(unittest.TestCase):
    """The whole media step on a small synthetic stock folder and one cheap loop."""

    def test_a_build_writes_checked_media_and_its_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            stock, out = Path(tmp) / "stock", Path(tmp) / "out"
            stock.mkdir()
            source = stock / "Src_clip.mp4"
            lavfi(source, "testsrc2=s=640x360:r=25:d=10", "-f", "lavfi", "-i", "sine=d=10",
                  "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest")
            data = source.read_bytes()
            (stock / "stock-credits.json").write_text(json.dumps([row_for("File:Src clip.mp4", data)]),
                                                      encoding="utf-8")
            clip = {"out": "clip-src.mp4", "title": "File:Src clip.mp4", "start": 1.0, "limit": 10,
                    "shipped": True}
            spare = {**clip, "out": "clip-spare.mp4", "shipped": False}
            with mock.patch.object(kit, "STOCK_CLIPS", [clip, spare]), \
                    mock.patch.object(kit, "LOOPS", {"kit-motion.mp4": sliding_loop}):
                manifest = kit.build_media(out, stock)
            paths = [f["path"] for f in manifest["files"]]
            self.assertEqual(paths, ["media/clip-src.mp4", "media/kit-beat.ogg", "media/kit-motion.mp4",
                                     "media/kit-title.png"])
            self.assertFalse((out / "media" / "clip-spare.mp4").exists())
            written = json.loads((out / "media-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(written, manifest)
            for f in manifest["files"]:
                self.assertEqual(f["sha1"], hashlib.sha1((out / f["path"]).read_bytes()).hexdigest())
            self.assertEqual(kit.check_video(out / "media" / "clip-src.mp4"), [])
            self.assertEqual(manifest["files"][0]["source"]["sha1"], hashlib.sha1(data).hexdigest())
            self.assertEqual(kit.stray_files(out, manifest), [])


if __name__ == "__main__":
    unittest.main(verbosity=1)
