# SPDX-License-Identifier: GPL-2.0-or-later
"""Unit tests for the kit's collection (kit_collection.py) and its portable-OBS helpers
(kit_obs.py), run by tests/demo-kit-collection.test.ts. Standard library only; no OBS is
started here (the round-trip itself is `build-kit.py roundtrip`, which needs the OBS lock).
"""
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import kit_collection as kc  # noqa: E402
import kit_obs  # noqa: E402

IDS = kc.load_ids()
ROOT = "C:/Kit Check/kit-root"


def source(collection: dict, name: str) -> dict:
    return next(s for s in collection["sources"] if s["name"] == name)


def saved_like_obs(draft: dict) -> dict:
    """What a round-trip does to a draft, in small: new keys, sources reordered, its own prev_ver,
    float32 noise, Playlister resume state with the absolute path inside a string, and the
    keys each plugin writes when it loaded (kc.PLUGIN_KEYS)."""
    saved = copy.deepcopy(draft)
    saved["sources"].reverse()
    saved["modules"] = {"scripts-tool": []}
    written = {"schema_version": 1, "row_kinds": {}, "param_fader_1_seeded": "", "saved_baselines": []}
    for s in saved["sources"]:
        s["prev_ver"] = kc.OBS_33 + 1
        s["hotkeys"] = {}
        for part in [s, *s.get("filters", [])]:
            for key in kc.PLUGIN_KEYS.get(part["id"], []):
                part["settings"][key] = written[key]
        if s["id"] == "scene":
            for item in s["settings"]["items"]:
                item["pos_rel"] = {"x": -1.7777777910232544, "y": -1.0}
                item["pos"]["x"] += 1e-5
        if s["id"] == "obs_playlister_source":
            first = s["settings"]["playlist"][0]["value"]
            s["settings"].update(current_file_name=f"1-3: {first}", current_row_uuid="kit-hurdles",
                                 current_item_key="CLIP-HURDLES.MP4", current_item_occurrence=1,
                                 current_media_index=0, last_width=1280, last_height=720)
    source(saved, "Kit Beat")["volume"] = 0.2511886358261108  # as float32
    return saved


class Ids(unittest.TestCase):
    def test_the_committed_ids_follow_the_rule(self):
        self.assertEqual(kc.ids_problems(IDS), [])

    def test_uuid_is_v4_format_and_fixed(self):
        u = kc.kit_uuid("Kit Clips")
        self.assertRegex(u, r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        self.assertEqual(u, kc.kit_uuid("Kit Clips"))
        self.assertNotEqual(u, kc.kit_uuid("Kit Clips 50%"))
        # sha256("suite-demo-kit:Kit Clips"), version and variant bits set
        self.assertEqual(u, source(IDS, "Kit Clips")["uuid"])

    def test_filter_uuids_are_seeded_by_source_and_filter(self):
        a = next(f for f in source(IDS, "Layer A")["filters"] if f["name"] == "Layer Fade")
        b = next(f for f in source(IDS, "Layer B")["filters"] if f["name"] == "Layer Fade")
        self.assertEqual(a["uuid"], kc.kit_uuid("Layer A/Layer Fade"))
        self.assertNotEqual(a["uuid"], b["uuid"])

    def test_problems_are_named(self):
        bad = copy.deepcopy(IDS)
        source(bad, "Kit Motion")["uuid"] = kc.kit_uuid("something else")
        bad["scenes"][1]["items"][0]["source"] = "No Such Source"
        bad["scenes"][2]["items"][1]["id"] = 1
        bad["scenes"][3]["index"] = 7
        source(bad, "Layer B")["filters"][0]["uuid"] = source(bad, "Layer A")["filters"][0]["uuid"]
        bad["sources"].append(copy.deepcopy(source(bad, "Kit Note")))
        text = "\n".join(kc.ids_problems(bad))
        self.assertIn("Kit Motion: uuid", text)
        self.assertIn("names no kit source: No Such Source", text)
        self.assertIn("Kit Layers: item id used twice", text)
        self.assertIn("index 7 but position 3", text)
        self.assertIn("Layer B/Layer Fade: uuid", text)
        self.assertIn("name used twice: Kit Note", text)

    def test_scene_order_and_beat_everywhere_but_welcome(self):
        # K.6: six scenes; the 50 % Playlister has its own (cued and faded like any other).
        self.assertEqual([s["name"] for s in IDS["scenes"]],
                         ["Kit Welcome", "Kit Visuals", "Kit Layers", "Kit Playlister", "Kit Playlister 50%",
                          "Kit Speed Page"])
        self.assertEqual([s["index"] for s in IDS["scenes"]], list(range(6)))
        for scene in IDS["scenes"]:
            has_beat = any(i["source"] == "Kit Beat" for i in scene["items"])
            self.assertEqual(has_beat, scene["index"] > 0, scene["name"])

    def test_settings_filters_and_layout_must_cover_the_ids(self):
        bad = copy.deepcopy(IDS)
        source(bad, "Kit Motion")["filters"].append(
            {"name": "Look New", "uuid": kc.kit_uuid("Kit Motion/Look New"), "id": "x", "versioned_id": "x"})
        source(bad, "Layer B")["filters"] = []
        bad["scenes"][1]["items"].append({"id": 3, "source": "Layer A"})
        bad["scenes"][2]["items"].pop()
        bad["scenes"][5]["name"] = "Kit Other"
        bad["scenes"][5]["uuid"] = kc.kit_uuid("Kit Other")
        bad["sources"].append({"name": "Kit Extra", "uuid": kc.kit_uuid("Kit Extra"), "id": "x",
                               "versioned_id": "x"})
        text = "\n".join(kc.ids_problems(bad))
        self.assertIn("Kit Motion/Look New: no FILTERS entry", text)
        self.assertIn("FILTERS entry Layer B/Layer Fade is no filter in kit-ids.json", text)
        self.assertIn("scene Kit Visuals: item 3 (Layer A) has no LAYOUT entry", text)
        self.assertIn("scene Kit Layers: LAYOUT entry Kit Beat is no item of the scene", text)
        self.assertIn("scene Kit Other: no LAYOUT entry", text)
        self.assertIn("LAYOUT entry Kit Speed Page is no scene in kit-ids.json", text)
        self.assertIn("Kit Extra: no SETTINGS entry", text)

    def test_every_layout_entry_is_an_item(self):
        for scene in IDS["scenes"]:
            self.assertEqual([i["source"] for i in scene["items"]], list(kc.LAYOUT[scene["name"]]))


class Draft(unittest.TestCase):
    def setUp(self):
        self.draft = kc.draft_collection(IDS)

    def test_paths_are_relative_and_cover_the_kit_files(self):
        used = sorted(s[2:] for s in kc.strings(self.draft) if s.startswith("./"))
        self.assertEqual(sorted(set(used)), sorted(kc.KIT_FILES))
        self.assertFalse([s for s in kc.strings(self.draft) if kc.ABSOLUTE.search(s)])

    def test_root_paths_for_the_round_trip(self):
        rooted = kc.draft_collection(IDS, "C:\\Kit Check\\kit-root\\")
        self.assertEqual(source(rooted, "Kit Title")["settings"]["file"], "C:/Kit Check/kit-root/media/kit-title.png")
        rows = source(rooted, "Kit Clips")["settings"]["playlist"]
        self.assertEqual(rows[2]["value"], "C:/Kit Check/kit-root/media/clip-train.mp4")
        self.assertFalse([s for s in kc.strings(rooted) if s.startswith("./")])

    def test_fixed_uuids_everywhere(self):
        for entry in [*IDS["sources"], *IDS["scenes"]]:
            self.assertEqual(source(self.draft, entry["name"])["uuid"], entry["uuid"])
        motion = source(self.draft, "Kit Motion")
        self.assertEqual([f["uuid"] for f in motion["filters"]], [f["uuid"] for f in source(IDS, "Kit Motion")["filters"]])
        uuids = {s["name"]: s["uuid"] for s in self.draft["sources"]}
        for scene in IDS["scenes"]:
            for item in source(self.draft, scene["name"])["settings"]["items"]:
                self.assertEqual(item["source_uuid"], uuids[item["name"]])

    def test_beat_monitoring_and_volume(self):
        beat = source(self.draft, "Kit Beat")
        self.assertEqual(beat["monitoring_type"], 2)
        self.assertIs(beat["monitoring_enabled"], True)
        self.assertAlmostEqual(beat["volume"], 0.251188643, places=8)
        self.assertEqual(beat["prev_ver"], kc.OBS_33)
        self.assertEqual(source(self.draft, "Kit Motion")["monitoring_type"], 0)
        self.assertIs(source(self.draft, "Kit Motion")["monitoring_enabled"], False)

    def test_playlisters(self):
        full, half = source(self.draft, "Kit Clips")["settings"], source(self.draft, "Kit Clips 50%")["settings"]
        self.assertEqual([r["value"] for r in full["playlist"]],
                         ["./media/clip-hurdles.mp4", "./media/clip-sprint.mp4", "./media/clip-train.mp4"])
        self.assertEqual(half["playlist"], [{"uuid": "kit-hurdles", "value": "./media/clip-hurdles.mp4"}])
        self.assertEqual((full["speed_percent"], half["speed_percent"]), (100, 50))
        self.assertEqual((full["visibility_behavior"], half["visibility_behavior"]), (0, 0))

    def test_looks_tap_the_beat_by_name(self):
        for f in source(self.draft, "Kit Motion")["filters"]:
            if f["id"].startswith("visual_sidechain"):
                self.assertEqual((f["settings"]["tap_mode"], f["settings"]["tap_source_name"]), (7, "Kit Beat"))
                self.assertIs(f["settings"]["react_when_muted"], True)
        enabled = {f["name"]: f["enabled"] for f in source(self.draft, "Kit Motion")["filters"]}
        self.assertEqual(enabled, {"Color Correction": True, "Look Prism": True, "Look Kaleido": False,
                                   "Look Pulse": False, "Audio Modulator": True})

    def test_items_and_canvas(self):
        self.assertEqual(self.draft["resolution"], {"x": 1920, "y": 1080})
        self.assertEqual(self.draft["version"], 2)
        playlister = source(self.draft, "Kit Playlister")["settings"]["items"]
        clips = {i["name"]: i for i in playlister}
        self.assertEqual(sorted(clips), ["Kit Background", "Kit Beat", "Kit Clips", "Kit Credits", "Speed Note 100"])
        self.assertEqual(clips["Kit Clips"]["pos"], {"x": 0.0, "y": 0.0})
        self.assertEqual(clips["Kit Clips"]["bounds"], {"x": 1920.0, "y": 1080.0})
        self.assertEqual(clips["Speed Note 100"]["pos"], {"x": 60.0, "y": 40.0})
        self.assertEqual(clips["Kit Beat"]["bounds_type"], 0)
        self.assertEqual(source(self.draft, "Kit Playlister")["settings"]["id_counter"], 5)

    def test_the_50_percent_playlister_has_its_own_full_frame_scene(self):
        # K.6: no 2-up; the 50 % copy is cued and faded like any scene, with its own note and the credits.
        half = source(self.draft, "Kit Playlister 50%")["settings"]["items"]
        self.assertEqual([i["name"] for i in half],
                         ["Kit Background", "Kit Clips 50%", "Speed Note 50", "Kit Credits", "Kit Beat"])
        self.assertEqual([i["id"] for i in half], [1, 2, 3, 4, 5])
        clip = next(i for i in half if i["name"] == "Kit Clips 50%")
        self.assertEqual((clip["pos"], clip["bounds_type"], clip["bounds"]),
                         ({"x": 0.0, "y": 0.0}, 2, {"x": 1920.0, "y": 1080.0}))
        self.assertNotIn("Kit Clips 50%", [i["name"] for i in source(self.draft, "Kit Playlister")["settings"]["items"]])
        for scene_name in ("Kit Playlister", "Kit Playlister 50%"):
            names = [i["name"] for i in source(self.draft, scene_name)["settings"]["items"]]
            self.assertIn("Kit Credits", names, scene_name)

    def test_real_footage_fills_the_frame_muted(self):
        # K.6: the train under the looks, the sprint and the hurdles as the layers; no generated loop.
        for name, clip in (("Kit Motion", "clip-train"), ("Layer A", "clip-sprint"), ("Layer B", "clip-hurdles")):
            s = source(self.draft, name)
            self.assertEqual(s["settings"]["local_file"], f"./media/{clip}.mp4", name)
            self.assertIs(s["settings"]["looping"], True, name)
            self.assertIs(s["muted"], True, name)
        self.assertIs(source(self.draft, "Kit Clips")["muted"], False)
        self.assertFalse(any("kit-motion" in f or "layer-" in f for f in kc.MEDIA_FILES))
        for scene_name, item_name in (("Kit Visuals", "Kit Motion"), ("Kit Layers", "Layer A"), ("Kit Layers", "Layer B")):
            item = next(i for i in source(self.draft, scene_name)["settings"]["items"] if i["name"] == item_name)
            self.assertEqual((item["pos"], item["bounds"]), ({"x": 0.0, "y": 0.0}, {"x": 1920.0, "y": 1080.0}))

    def test_a_media_item_off_the_full_frame_is_refused(self):
        with mock.patch.dict(kc.LAYOUT, {"Kit Playlister": {**kc.LAYOUT["Kit Playlister"],
                                                            "Kit Clips": ((40, 250), (900, 506))}}):
            problems = kc.ids_problems(IDS)
        self.assertEqual(problems, ["scene Kit Playlister: Kit Clips is not full frame (K.6: no 2-up)"])


class RoundTrip(unittest.TestCase):
    def setUp(self):
        self.draft = kc.draft_collection(IDS)
        self.saved = saved_like_obs(kc.draft_collection(IDS, ROOT))

    def test_normalise_gives_back_relative_paths_and_drops_resume_state(self):
        out = kc.normalise(self.saved, ROOT)
        clips = source(out, "Kit Clips")["settings"]
        self.assertEqual(clips["playlist"][0]["value"], "./media/clip-hurdles.mp4")
        for key in kc.PLAYLISTER_RESUME_KEYS:
            self.assertNotIn(key, clips)
        self.assertEqual((clips["last_width"], clips["last_height"]), (1280, 720))
        self.assertEqual(source(out, "Kit Title")["settings"]["file"], "./media/kit-title.png")

    def test_normalise_matches_backslashes_and_case(self):
        source(self.saved, "Kit Title")["settings"]["file"] = "c:\\kit check\\kit-root\\media\\kit-title.png"
        out = kc.normalise(self.saved, ROOT)
        self.assertEqual(source(out, "Kit Title")["settings"]["file"], "./media/kit-title.png")

    def test_normalise_refuses_the_root_left_inside_a_string(self):
        source(self.saved, "Kit Note")["settings"]["text"] = f"see {ROOT}/media"
        with self.assertRaisesRegex(ValueError, "still holds the round-trip folder"):
            kc.normalise(self.saved, ROOT)

    def test_a_clean_round_trip_has_no_changes(self):
        delta = kc.diff_draft(self.draft, kc.normalise(self.saved, ROOT))
        self.assertEqual((delta["changed"], delta["missing"]), ([], []))
        self.assertIn("$.modules", delta["added"])
        self.assertIn("$.sources[Kit Beat].hotkeys", delta["added"])
        self.assertEqual(kc.check_template(kc.normalise(self.saved, ROOT), IDS), [])

    def test_changed_and_dropped_values_are_reported(self):
        source(self.saved, "Kit Beat")["monitoring_type"] = 0
        del source(self.saved, "Kit Clips 50%")["settings"]["speed_percent"]
        source(self.saved, "Kit Clips")["settings"]["playlist"].pop()
        motion = source(self.saved, "Kit Motion")
        motion["filters"] = [f for f in motion["filters"] if f["name"] != "Look Pulse"]
        delta = kc.diff_draft(self.draft, kc.normalise(self.saved, ROOT))
        self.assertIn("$.sources[Kit Beat].monitoring_type: 2 became 0", delta["changed"])
        self.assertIn("$.sources[Kit Clips 50%].settings.speed_percent", delta["missing"])
        self.assertIn("$.sources[Kit Clips].settings.playlist[kit-train]", delta["missing"])
        self.assertIn("$.sources[Kit Motion].filters[Look Pulse]", delta["missing"])

    def test_booleans_are_not_numbers(self):
        source(self.saved, "Kit Beat")["monitoring_enabled"] = 1
        delta = kc.diff_draft(self.draft, kc.normalise(self.saved, ROOT))
        self.assertIn("$.sources[Kit Beat].monitoring_enabled: True became 1", delta["changed"])

    def test_prev_ver_is_obs_owned_but_an_old_one_fails_the_template(self):
        out = kc.normalise(self.saved, ROOT)
        self.assertEqual(kc.diff_draft(self.draft, out)["changed"], [])
        source(out, "Layer A")["prev_ver"] = 0
        self.assertIn("Layer A: prev_ver 0 is older than OBS 33.0.0", kc.check_template(out, IDS))


class Template(unittest.TestCase):
    def setUp(self):
        self.good = kc.normalise(saved_like_obs(kc.draft_collection(IDS, ROOT)), ROOT)

    def problems_after(self, change) -> str:
        bad = copy.deepcopy(self.good)
        change(bad)
        return "\n".join(kc.check_template(bad, IDS))

    def test_the_committed_template_ships(self):
        if not kc.TEMPLATE_PATH.is_file():
            self.skipTest("kit-template.json not written yet (build-kit.py roundtrip)")
        template = json.loads(kc.TEMPLATE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(kc.check_template(template, IDS), [])
        self.assertEqual(kc.TEMPLATE_PATH.read_text(encoding="utf-8"), kc.dump(template))
        self.assertNotIn(b"\r", kc.TEMPLATE_PATH.read_bytes())
        self.assertFalse(kc.TEMPLATE_PATH.read_bytes().startswith(b"\xef\xbb\xbf"))

    def test_a_changed_uuid_fails(self):
        def change(c):
            source(c, "Kit Clips")["uuid"] = kc.kit_uuid("x")
        self.assertIn("Kit Clips: uuid", self.problems_after(change))

    def test_a_changed_filter_uuid_fails(self):
        def change(c):
            source(c, "Kit Motion")["filters"][1]["uuid"] = kc.kit_uuid("x")
        self.assertIn("Kit Motion/Look Prism: uuid", self.problems_after(change))

    def test_an_item_pointing_at_another_source_fails(self):
        def change(c):
            source(c, "Kit Visuals")["settings"]["items"][0]["source_uuid"] = source(c, "Layer A")["uuid"]
        self.assertIn("Kit Visuals: item Kit Motion has another source's uuid", self.problems_after(change))

    def test_an_absolute_path_fails(self):
        def change(c):
            source(c, "Kit Title")["settings"]["file"] = "D:\\media\\kit-title.png"
        text = self.problems_after(change)
        self.assertIn("absolute path: 'D:\\\\media\\\\kit-title.png'", text)
        self.assertIn("kit files no source uses: media/kit-title.png", text)

    def test_unc_and_slash_paths_fail_but_urls_pass(self):
        def change(c):
            source(c, "Kit Note")["settings"]["file"] = "\\\\server\\share\\x.txt"
            source(c, "Kit Credits")["settings"]["file"] = "/home/x.txt"
            source(c, "Speed Page")["settings"]["url"] = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
        text = self.problems_after(change)
        self.assertIn("\\\\\\\\server", text)
        self.assertIn("'/home/x.txt'", text)
        self.assertNotIn("youtube", text)

    def test_file_urls_and_long_paths_fail(self):
        def change(c):
            source(c, "Kit Title")["settings"]["file"] = "file://kit-host/media/kit-title.png"
            source(c, "Kit Note")["settings"]["file"] = "\\\\?\\C:\\kit\\x.txt"
        text = self.problems_after(change)
        self.assertIn("absolute path: 'file://kit-host/media/kit-title.png'", text)
        self.assertIn("absolute path: '\\\\\\\\?\\\\C:", text)

    def test_a_plugin_that_did_not_load_fails(self):
        def change(c):
            del source(c, "Kit Clips 50%")["settings"]["schema_version"]
            motion = source(c, "Kit Motion")
            del next(f for f in motion["filters"] if f["name"] == "Look Pulse")["settings"]["param_fader_1_seeded"]
            del next(f for f in motion["filters"] if f["name"] == "Audio Modulator")["settings"]["saved_baselines"]
        text = self.problems_after(change)
        self.assertIn("Kit Clips 50%: no schema_version written, so its plugin did not load", text)
        self.assertIn("Kit Motion/Look Pulse: no param_fader_1_seeded written", text)
        self.assertIn("Kit Motion/Audio Modulator: no saved_baselines written", text)
        self.assertNotIn("Kit Clips:", text)

    def test_an_unknown_relative_file_fails(self):
        def change(c):
            source(c, "Kit Title")["settings"]["file"] = "./media/other.png"
        text = self.problems_after(change)
        self.assertIn("files the kit does not ship: media/other.png", text)

    def test_beat_monitoring_off_fails(self):
        def change(c):
            source(c, "Kit Beat")["monitoring_enabled"] = False
        self.assertIn("Kit Beat: monitoring_type must be 2 and monitoring_enabled true", self.problems_after(change))

    def test_resume_state_left_fails(self):
        def change(c):
            source(c, "Kit Clips 50%")["settings"]["current_row_uuid"] = "kit-hurdles"
        self.assertIn("Kit Clips 50%: Playlister resume state left: current_row_uuid", self.problems_after(change))

    def test_extra_or_renamed_sources_fail(self):
        def change(c):
            source(c, "Speed Page")["name"] = "My Page"
        text = self.problems_after(change)
        self.assertIn("sources not in kit-ids.json: My Page", text)
        self.assertIn("missing: $.sources[Speed Page]", text)

    def test_wrong_collection_name_fails(self):
        def change(c):
            c["name"] = "Suite Demo Kit 2"
        self.assertIn("collection name is 'Suite Demo Kit 2'", self.problems_after(change))

    def test_dump_is_obs_style(self):
        text = kc.dump({"a": [1], "b": "\u00b7"})
        self.assertEqual(text, '{\n    "a": [\n        1\n    ],\n    "b": "\u00b7"\n}\n')


class Lock(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.lock = Path(self.dir.name) / "obs-run.lock"

    def tearDown(self):
        self.dir.cleanup()

    def test_take_and_release(self):
        token = kit_obs.take_lock(self.lock, "test", pids=lambda: [])
        self.assertEqual(self.lock.read_text(encoding="utf-8").strip(), token)
        self.assertTrue(kit_obs.release_lock(self.lock, token))
        self.assertFalse(self.lock.exists())

    def test_an_existing_lock_is_not_taken(self):
        self.lock.write_text("another agent\n", encoding="utf-8")
        with self.assertRaisesRegex(kit_obs.LockBusy, "another agent"):
            kit_obs.take_lock(self.lock, "test", pids=lambda: [])
        self.assertEqual(self.lock.read_text(encoding="utf-8"), "another agent\n")

    def test_a_running_obs_refuses_before_the_lock(self):
        with self.assertRaisesRegex(kit_obs.LockBusy, "obs64 is running"):
            kit_obs.take_lock(self.lock, "test", pids=lambda: [1234])
        self.assertFalse(self.lock.exists())

    def test_an_obs_started_meanwhile_gives_the_lock_back(self):
        answers = iter([[], [99]])
        with self.assertRaisesRegex(kit_obs.LockBusy, "started while taking"):
            kit_obs.take_lock(self.lock, "test", pids=lambda: next(answers))
        self.assertFalse(self.lock.exists())

    def test_someone_elses_lock_is_never_deleted(self):
        self.lock.write_text("another agent\n", encoding="utf-8")
        self.assertFalse(kit_obs.release_lock(self.lock, "test pid 1 at now"))
        self.assertTrue(self.lock.exists())

    def test_waiting_gives_up_after_the_deadline(self):
        self.lock.write_text("another agent\n", encoding="utf-8")
        with self.assertRaises(kit_obs.LockBusy):
            kit_obs.wait_for_lock(self.lock, "test", wait_s=0, poll_s=0, pids=lambda: [])


class Assembly(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name)
        self.core, self.plugin, self.obs = base / "core-tree", base / "plugin-build", base / "obs"
        for part in kit_obs.CORE_PARTS:
            (self.core / part).mkdir(parents=True)
            (self.core / part / f"{part}.txt").write_text(part, encoding="utf-8")
        self.plugin.mkdir()
        (self.plugin / "p.dll").write_bytes(b"dll")

    def tearDown(self):
        self.dir.cleanup()

    def test_assembles_hashes_and_writes_config(self):
        log = kit_obs.assemble(self.obs, self.core, {"p": self.plugin})
        self.assertEqual(sorted(log["core"]), ["bin", "core", "data"])
        self.assertEqual(log["plugins"]["p"]["files"], {"p.dll": kit_obs.sha256_of(self.plugin / "p.dll")})
        self.assertTrue((self.obs / "portable_mode.txt").is_file())
        cfg = self.obs / "config" / "obs-studio"
        self.assertIn("SceneCollection=Suite Demo Kit", (cfg / "global.ini").read_text(encoding="utf-8"))
        self.assertIn("EnableAutoUpdates=false", (cfg / "global.ini").read_text(encoding="utf-8"))
        profile = (cfg / "basic" / "profiles" / "Kit" / "basic.ini").read_text(encoding="utf-8")
        self.assertIn("BaseCX=1920\nBaseCY=1080", profile)
        self.assertEqual(json.loads((self.obs / "assembly.json").read_text(encoding="utf-8"))["core"], log["core"])

    def test_a_second_run_keeps_obs_written_config(self):
        kit_obs.assemble(self.obs, self.core, {"p": self.plugin})
        user = self.obs / "config" / "obs-studio" / "user.ini"
        user.write_text("written by OBS", encoding="utf-8")
        kit_obs.assemble(self.obs, self.core, {"p": self.plugin})
        self.assertEqual(user.read_text(encoding="utf-8"), "written by OBS")

    def test_a_copy_that_differs_is_refused_and_kept(self):
        kit_obs.assemble(self.obs, self.core, {"p": self.plugin})
        (self.plugin / "p.dll").write_bytes(b"newer build")
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            kit_obs.assemble(self.obs, self.core, {"p": self.plugin})
        self.assertEqual((self.obs / "plugins" / "p" / "p.dll").read_bytes(), b"dll")

    def test_keep_aside_never_deletes(self):
        f = self.obs / "x.json"
        self.obs.mkdir()
        f.write_text("1", encoding="utf-8")
        kit_obs.keep_aside(f)
        f.write_text("2", encoding="utf-8")
        kit_obs.keep_aside(f)
        self.assertEqual((self.obs / "x.json.run1").read_text(encoding="utf-8"), "1")
        self.assertEqual((self.obs / "x.json.run2").read_text(encoding="utf-8"), "2")
        self.assertFalse(f.exists())

PLUGINS = ["obs-playlister", "visual-sidechain"]
GOOD_LOG = ("11:51:35.889: Failed to load 'en-US' text for module: 'decklink-captions.dll'\n"
            "11:51:35.896: [NVIDIA Audio Effects:] NVIDIA denoiser disabled, redistributable not found or could "
            "not be loaded.\n"
            "11:51:36.975: [obs-playlister] plugin loaded successfully (version 0.5.0)\n"
            "11:51:36.976: [visual-sidechain] plugin loaded successfully (version 0.6.0)\n"
            "11:51:37.090: [obs-playlister] settings migrated to schema 1\n")


class LogFailures(unittest.TestCase):
    def test_a_good_log_with_obs_own_noise_passes(self):
        self.assertEqual(kit_obs.log_failures(GOOD_LOG, PLUGINS), [])

    def test_a_plugin_without_its_loaded_line_fails(self):
        text = GOOD_LOG.replace("[visual-sidechain] plugin loaded successfully", "[visual-sidechain] hello")
        self.assertEqual(kit_obs.log_failures(text, PLUGINS),
                         ["visual-sidechain: no '[visual-sidechain] plugin loaded successfully' line in the OBS log"])

    def test_unknown_source_types_and_plugin_failures_fail(self):
        text = GOOD_LOG + ("12:01: Source ID 'obs_playlister_source' not found\n"
                           "12:02: Failed to create source 'Kit Clips'!\n"
                           "12:03: LoadLibrary failed for '../../plugins/visual-sidechain/bin/64bit/"
                           "visual-sidechain.dll': 126\n")
        self.assertEqual(len(kit_obs.log_failures(text, PLUGINS)), 3)


class PlaceKitFiles(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name)
        self.build, self.root = base / "build", base / "kit-root"
        files = []
        for rel in kc.MEDIA_FILES:
            f = self.build / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(rel.encode("utf-8"))
            files.append({"path": rel, "sha1": hashlib.sha1(rel.encode("utf-8")).hexdigest()})
        self.manifest = {"files": files}

    def tearDown(self):
        self.dir.cleanup()

    def place(self, card=None):
        kit_obs.place_kit_files(self.root, self.build / "media", self.manifest, card)

    def test_copies_the_media_and_a_stand_in_card(self):
        self.place()
        for rel in kc.MEDIA_FILES:
            self.assertEqual((self.root / rel).read_bytes(), rel.encode("utf-8"))
        self.assertIn("round-trip stand-in", (self.root / kc.SETUP_CARD).read_text(encoding="utf-8"))
        self.place()  # a second run on the same folder only checks

    def test_a_file_missing_from_the_manifest_is_refused(self):
        self.manifest["files"].pop()
        with self.assertRaisesRegex(RuntimeError, "is not in the media manifest"):
            self.place()

    def test_a_file_that_differs_from_the_manifest_is_refused(self):
        (self.build / kc.MEDIA_FILES[2]).write_bytes(b"changed after the media step")
        with self.assertRaisesRegex(RuntimeError, "does not match the media manifest"):
            self.place()
        self.assertFalse((self.root / kc.MEDIA_FILES[2]).exists())

    def test_a_differing_target_is_refused_and_kept(self):
        target = self.root / kc.MEDIA_FILES[0]
        target.parent.mkdir(parents=True)
        target.write_bytes(b"from an earlier kit")
        with self.assertRaisesRegex(RuntimeError, "exists and differs"):
            self.place()
        self.assertEqual(target.read_bytes(), b"from an earlier kit")

    def test_an_existing_card_is_kept(self):
        self.root.mkdir()
        (self.root / kc.SETUP_CARD).write_text("the real card", encoding="utf-8")
        self.place()
        self.assertEqual((self.root / kc.SETUP_CARD).read_text(encoding="utf-8"), "the real card")

    def test_the_real_card_replaces_a_stand_in_which_is_set_aside(self):
        self.place()  # step 2: the stand-in
        real = Path(self.dir.name) / "vjster-setup.html"
        real.write_text("<!doctype html>the card that ships", encoding="utf-8")
        self.place(real)
        self.assertEqual((self.root / kc.SETUP_CARD).read_bytes(), real.read_bytes())
        aside = self.root / f"{kc.SETUP_CARD}.run1"
        self.assertIn("round-trip stand-in", aside.read_text(encoding="utf-8"))
        self.place(real)  # the same card again: nothing more is set aside
        self.assertFalse((self.root / f"{kc.SETUP_CARD}.run2").exists())


class FakeProc:
    def __init__(self, exits_on_close: bool):
        self.pid, self.returncode, self.waits, self.exits = 424242, None, 0, exits_on_close

    def wait(self, timeout=None):
        self.waits += 1
        if not self.exits and self.waits == 1:
            raise subprocess.TimeoutExpired("obs64.exe", timeout)
        self.returncode = 0
        return 0


class StopAndUnlock(unittest.TestCase):
    def test_a_clean_close_posts_wm_close_and_no_taskkill(self):
        events, user32 = [], mock.MagicMock()
        with mock.patch.object(kit_obs, "windows", return_value=[(7, "OBS 33.0.1 - Profile: Kit")]), \
                mock.patch.object(kit_obs.ctypes, "WinDLL", return_value=user32, create=True), \
                mock.patch.object(kit_obs.subprocess, "run") as run:
            kit_obs.stop_obs(FakeProc(True), events, 5)
        user32.PostMessageW.assert_called_once_with(7, 0x0010, 0, 0)
        run.assert_not_called()
        self.assertEqual([e["event"] for e in events], ["close", "exited"])

    def test_no_exit_after_the_close_is_killed_and_logged(self):
        events = []
        with mock.patch.object(kit_obs, "windows", return_value=[]), \
                mock.patch.object(kit_obs.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "taskkill used"):
                kit_obs.stop_obs(FakeProc(False), events, 5)
        run.assert_called_once_with(["taskkill", "/PID", "424242", "/T", "/F"], capture_output=True)
        self.assertEqual([e["event"] for e in events], ["taskkill"])

    def test_the_lock_is_released_when_obs_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            lock, obs, build = base / "obs-run.lock", base / "obs", base / "build"
            (obs / "config" / "obs-studio" / "basic" / "scenes").mkdir(parents=True)
            build.mkdir()
            (build / "media-manifest.json").write_text('{"files": []}', encoding="utf-8")

            def take(lock_path, owner):
                return kit_obs.take_lock(lock_path, owner, pids=lambda: [])

            with mock.patch.object(kit_obs, "assemble", return_value={"plugins": {}, "core_source": ""}), \
                    mock.patch.object(kit_obs, "place_kit_files"), \
                    mock.patch.object(kit_obs, "wait_for_lock", side_effect=take), \
                    mock.patch.object(kit_obs, "run_obs", side_effect=RuntimeError("OBS exited early with 1")):
                with self.assertRaisesRegex(RuntimeError, "exited early"):
                    kit_obs.roundtrip(obs, build, base / "kit-template.json", lock=lock)
            self.assertFalse(lock.exists())
            events = json.loads((build / "roundtrip" / "events.json").read_text(encoding="utf-8"))
            self.assertEqual([(e["event"], e.get("released")) for e in events], [("lock", None), ("unlock", True)])
            self.assertFalse((base / "kit-template.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=1)
