# SPDX-License-Identifier: GPL-2.0-or-later
"""Unit tests for the install-check's parts that need no OBS (kit_check.py), the kit zip
(kit_package.py) and check-kit.py's folder and result helpers. Run by tests/demo-kit-check.test.ts.
Standard library only; the import rules need Windows' path normalisation (GetFullPathNameW).
The live rows themselves run in check-kit.py against a portable OBS (TESTING.md).
"""
import copy
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True
KIT = Path(__file__).resolve().parent
sys.path.insert(0, str(KIT))
import kit_check as kk  # noqa: E402
import kit_collection as kc  # noqa: E402
import kit_docs as kd  # noqa: E402
import kit_package as kp  # noqa: E402

spec = importlib.util.spec_from_file_location("check_kit", KIT / "check-kit.py")
ck = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ck)

IDS = kc.load_ids()
TEMPLATE = json.loads((KIT / "kit-template.json").read_text(encoding="utf-8"))
UUID = {s["name"]: s["uuid"] for s in IDS["sources"]}
WINDOWS = os.name == "nt"


@unittest.skipUnless(WINDOWS, "OBS's Import rules are Windows path rules")
class ImportRules(unittest.TestCase):
    def test_a_dot_path_becomes_a_path_inside_the_folder(self):
        self.assertEqual(kk.check_path("./media/a.mp4", "C:/SuiteDemoKit"), r"C:\SuiteDemoKit\media\a.mp4")

    def test_a_drive_root_keeps_the_dot_path(self):
        self.assertEqual(kk.check_path("./media/a.mp4", "D:/"), "./media/a.mp4")

    def test_a_path_that_leaves_the_folder_is_kept(self):
        self.assertEqual(kk.check_path("./../x.mp4", "C:/SuiteDemoKit"), "./../x.mp4")
        # A sibling whose name starts with the folder's: inside by prefix, outside by separator.
        self.assertEqual(kk.check_path("./../SuiteDemoKit2/x.mp4", "C:/SuiteDemoKit"), "./../SuiteDemoKit2/x.mp4")
        # Another folder of the same length: a separator where the kit folder's would be, another prefix.
        self.assertEqual(kk.check_path("./../OtherFolder1/x.mp4", "C:/SuiteDemoKit"), "./../OtherFolder1/x.mp4")
        self.assertEqual(kk.full_path("C:/OtherFolder1/x.mp4")[len(r"C:\SuiteDemoKit")], "\\")

    def test_a_path_past_max_path_is_kept(self):
        root = "C:/" + "k" * 250
        self.assertEqual(kk.check_path("./media/a.mp4", root), "./media/a.mp4")
        self.assertIsNone(kk.full_path("C:/" + "k" * 300))
        self.assertIsNotNone(kk.full_path("C:/" + "k" * 200))
        # OBS's input buffer is MAX_PATH too: a long input is refused even when it would resolve short.
        self.assertIsNone(kk.full_path("C:/k/" + "../" * 90 + "x"))

    def test_every_dot_string_in_objects_and_arrays_is_translated_and_nothing_else(self):
        data = {"a": "./media/a.mp4", "b": "media/b.mp4", "c": "x./media", "rows": [{"value": "./media/c.mp4"},
                                                                                  "./media/d.mp4"], "n": 3}
        out = kk.translate_paths(data, "C:/Kit")
        self.assertEqual(out, {"a": r"C:\Kit\media\a.mp4", "b": "media/b.mp4", "c": "x./media",
                               "rows": [{"value": r"C:\Kit\media\c.mp4"}, r"C:\Kit\media\d.mp4"], "n": 3})

    def test_the_import_root_is_the_files_folder_with_forward_slashes(self):
        self.assertEqual(kk.import_root(Path("C:/SuiteDemoKit/Suite Demo Kit.json")), "C:/SuiteDemoKit")
        self.assertEqual(kk.import_root(Path("D:/Suite Demo Kit.json")), "D:/")

    def test_the_shipped_collection_imports_into_its_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "Kit"
            folder.mkdir()
            path = folder / kd.COLLECTION_FILE
            path.write_text(kc.dump(TEMPLATE), encoding="utf-8")
            out = kk.import_collection(path)
            self.assertEqual(kk.leftover_dot_paths(out), [])
            self.assertEqual(out["name"], IDS["collection"])
            self.assertEqual(kk.import_collection(path, "Suite Demo Kit 2")["name"], "Suite Demo Kit 2")
            # Apart from the paths it is the file as shipped: back to ./ it is the template again.
            self.assertEqual(kc.normalise(out, str(folder.resolve())), TEMPLATE)
            rows = next(s for s in out["sources"] if s["name"] == "Kit Clips")["settings"]["playlist"]
            self.assertEqual([r["value"] for r in rows],
                             [str(folder.resolve() / "media" / f"clip-{n}.mp4") for n in ("hurdles", "sprint", "train")])

    def test_a_file_that_is_no_collection_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "x.json"
            path.write_text(json.dumps({"name": "x", "sources": []}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "current_scene"):
                kk.import_collection(path)


class LivePaths(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.kit = Path(self.tmp.name) / "kit"
        (self.kit / "media").mkdir(parents=True)
        self.clip = self.kit / "media" / "a.mp4"
        self.clip.write_bytes(b"x")

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_paths_of_media_images_cards_and_playlist_rows(self):
        self.assertEqual(kk.setting_paths({"local_file": "a", "is_local_file": True}), ["a"])
        self.assertEqual(kk.setting_paths({"local_file": "a", "is_local_file": False, "url": "http://x"}), [])
        self.assertEqual(kk.setting_paths({"file": "t.png"}), ["t.png"])
        self.assertEqual(kk.setting_paths({"playlist": [{"value": "p"}, {"uuid": "u"}, "bad"]}), ["p"])

    def test_a_present_path_inside_the_folder_passes(self):
        self.assertEqual(kk.input_path_problems("A", {"local_file": str(self.clip)}, self.kit), [])

    def test_each_wrong_path_is_named(self):
        outside = Path(self.tmp.name) / "a.mp4"
        outside.write_bytes(b"x")
        cases = {"./media/a.mp4": "still a ./ path", "media/a.mp4": "not absolute",
                 str(outside): "outside the kit folder", str(self.kit / "media" / "gone.mp4"): "does not exist"}
        for path, why in cases.items():
            self.assertEqual(len(kk.input_path_problems("A", {"playlist": [{"value": path}]}, self.kit)), 1, path)
            self.assertIn(why, kk.input_path_problems("A", {"playlist": [{"value": path}]}, self.kit)[0])

    def test_a_sibling_folder_with_the_same_prefix_is_outside(self):
        sibling = Path(self.tmp.name) / "kit2" / "a.mp4"
        sibling.parent.mkdir()
        sibling.write_bytes(b"x")
        self.assertFalse(kk.inside(str(sibling), self.kit))
        self.assertTrue(kk.inside(str(self.clip), self.kit))

    def test_leftover_dot_paths_are_found_anywhere(self):
        self.assertEqual(kk.leftover_dot_paths({"a": [{"b": "./x"}], "c": "y"}), ["$.a[0].b: ./x"])


def profile(pages: dict) -> bytes:
    """A .streamDeckProfile in memory: {page: {(controller, "c,r"): (action uuid, settings)}}."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("P.sdProfile/manifest.json", json.dumps({"Name": "x"}))
        for page, actions in pages.items():
            controllers = {}
            for (controller, pos), (uuid, settings) in actions.items():
                controllers.setdefault(controller, {})[pos] = {"UUID": uuid, "Settings": settings}
            z.writestr(f"P.sdProfile/Profiles/{page}/manifest.json", json.dumps(
                {"Controllers": [{"Type": t, "Actions": a} for t, a in controllers.items()]}))
    return buffer.getvalue()


SCENES = {"scenes": [{"sceneName": s["name"], "sceneIndex": len(IDS["scenes"]) - 1 - i}
                     for i, s in enumerate(IDS["scenes"])]}


class FakeObs:
    """Answers the requests binding_problems makes, from kit-ids.json, like the kit's live OBS."""

    def __init__(self):
        self.filters = {(s["uuid"], f["name"]): f["versioned_id"] for s in IDS["sources"] for f in s.get("filters", [])}
        self.items = {(sc["name"], i["id"]): i["source"] for sc in IDS["scenes"] for i in sc["items"]}
        self.kinds = {s["uuid"]: s["versioned_id"] for s in IDS["sources"]}
        self.hotkeys = ["OBSBasic.Screenshot", *kk.PANIC_HOTKEYS]
        self.scenes = copy.deepcopy(SCENES)
        self.calls = []

    def __call__(self, request, data):
        self.calls.append(request)
        if request == "GetSceneList":
            return 100, self.scenes
        if request == "GetSourceFilter":
            kind = self.filters.get((data["sourceUuid"], data["filterName"]))
            return (100, {"filterKind": kind, "filterSettings": {"vs_effect_mix_pct": 50}}) if kind else (600, {})
        if request == "GetSourceFilterDefaultSettings":
            return 100, {"defaultFilterSettings": {"opacity": 1.0, "vs_audio_reactivity_pct": 100}}
        if request == "GetSceneItemSource":
            name = self.items.get((data["sceneName"], data["sceneItemId"]))
            return (100, {"sourceName": name, "sourceUuid": UUID[name]}) if name else (600, {})
        if request == "GetInputSettings":
            kind = self.kinds.get(data["inputUuid"])
            return (100, {"inputKind": kind, "inputSettings": {}}) if kind else (600, {})
        if request == "GetInputVolume":
            return (100, {"inputVolumeDb": -12}) if data["inputName"] in UUID else (600, {})
        if request == "GetHotkeyList":
            return 100, {"hotkeys": self.hotkeys}
        raise AssertionError(request)


F = kk.FADESTER
LAYOUTS = json.loads((KIT / "kit-layouts.json").read_text(encoding="utf-8"))


class Bindings(unittest.TestCase):
    def bind(self, action, settings):
        return {"page": "PAGE0000", "controller": "Keypad", "position": "0,0", "action": action, "settings": settings}

    def test_every_action_of_the_kit_layout_resolves_in_a_kit_obs(self):
        kinds = {"scene": "scene-transition", "filter": "obs-filter", "layer": "layer-control",
                 "playlister": "playlister-transport", "fader": "obs-fader", "panic": "visual-panic"}
        count = 0
        for page in LAYOUTS["fadester"]["pages"]:
            for a in page["actions"]:
                action = "com.elgato.streamdeck.page.next" if a["kind"] == "page" else F + kinds[a["kind"]]
                self.assertEqual(kk.binding_problems(self.bind(action, a["settings"]), FakeObs(), IDS), [], a)
                count += 1
        self.assertEqual(count, 36)

    def test_profile_bindings_read_every_page_and_controller(self):
        data = profile({"PAGE-A": {("Keypad", "0,0"): (F + "visual-panic", {"operation": "panic"}),
                                   ("Encoder", "1,0"): (F + "obs-fader", {"inputName": "Kit Beat"})},
                        "PAGE-B": {("Keypad", "3,1"): ("com.elgato.streamdeck.page.next", {})}})
        found = kk.profile_bindings(data)
        self.assertEqual([(b["page"], b["controller"], b["position"], b["action"]) for b in found],
                         [("PAGE-A", "Keypad", "0,0", F + "visual-panic"), ("PAGE-A", "Encoder", "1,0", F + "obs-fader"),
                          ("PAGE-B", "Keypad", "3,1", "com.elgato.streamdeck.page.next")])
        self.assertEqual(found[1]["settings"], {"inputName": "Kit Beat"})

    def test_scene_positions_follow_the_scenes_dock(self):
        self.assertEqual([s["sceneName"] for s in kk.scene_display_order(SCENES)], [s["name"] for s in IDS["scenes"]])
        obs = FakeObs()
        obs.scenes["scenes"][0]["sceneIndex"], obs.scenes["scenes"][1]["sceneIndex"] = \
            obs.scenes["scenes"][1]["sceneIndex"], obs.scenes["scenes"][0]["sceneIndex"]
        problems = kk.binding_problems(self.bind(F + "scene-transition", {"sceneTarget": "__scene_index_0__"}), obs, IDS)
        self.assertEqual(len(problems), 1)
        self.assertIn("scene position 0 is 'Kit Visuals' live, the kit's is 'Kit Welcome'", problems[0])
        self.assertIn("not a scene position", kk.binding_problems(
            self.bind(F + "scene-transition", {"sceneTarget": "Kit Welcome"}), FakeObs(), IDS)[0])
        self.assertIn("is None live", kk.binding_problems(
            self.bind(F + "scene-transition", {"sceneTarget": "__scene_index_9__"}), FakeObs(), IDS)[0])

    def filter_key(self, **change):
        settings = {"sourceUuid": UUID["Kit Motion"], "filterName": "Look Prism",
                    "filterKind": "visual_sidechain_shader_filter", "setting": "vs_effect_mix_pct"}
        return self.bind(F + "obs-filter", {**settings, **change})

    def test_a_filter_key_needs_its_filter_its_kind_and_its_setting(self):
        self.assertEqual(kk.binding_problems(self.filter_key(), FakeObs(), IDS), [])
        self.assertIn("answered 600", kk.binding_problems(self.filter_key(filterName="Look Gone"), FakeObs(), IDS)[0])
        self.assertIn("the key wants color_filter_v2",
                      kk.binding_problems(self.filter_key(filterKind="color_filter_v2", setting=None), FakeObs(), IDS)[0])
        self.assertIn("has no setting vs_nothing",
                      kk.binding_problems(self.filter_key(setting="vs_nothing"), FakeObs(), IDS)[0])
        # A default the filter has not written yet still counts as its setting.
        self.assertEqual(kk.binding_problems(self.filter_key(setting="vs_audio_reactivity_pct"), FakeObs(), IDS), [])

    def test_a_layer_key_needs_its_item_to_be_its_source(self):
        good = {"sceneName": "Kit Layers", "sceneItemId": 1, "sourceUuid": UUID["Layer A"], "sourceName": "Layer A"}
        self.assertEqual(kk.binding_problems(self.bind(F + "layer-control", good), FakeObs(), IDS), [])
        wrong = {**good, "sceneItemId": 2}
        self.assertIn("is Layer B, not the key's Layer A",
                      kk.binding_problems(self.bind(F + "layer-control", wrong), FakeObs(), IDS)[0])
        self.assertIn("answered 600", kk.binding_problems(
            self.bind(F + "layer-control", {**good, "sceneItemId": 9}), FakeObs(), IDS)[0])

    def test_a_playlister_key_needs_a_playlister_by_uuid(self):
        ok = self.bind(F + "playlister-transport", {"inputUuid": UUID["Kit Clips"], "operation": "next"})
        self.assertEqual(kk.binding_problems(ok, FakeObs(), IDS), [])
        motion = self.bind(F + "playlister-transport", {"inputUuid": UUID["Kit Motion"]})
        self.assertIn("is a ffmpeg_source, not a Playlister", kk.binding_problems(motion, FakeObs(), IDS)[0])
        gone = self.bind(F + "playlister-transport", {"inputUuid": "00000000-0000-4000-8000-000000000000"})
        self.assertIn("answered 600", kk.binding_problems(gone, FakeObs(), IDS)[0])

    def test_a_fader_needs_its_input_and_a_volume_target(self):
        self.assertEqual(kk.binding_problems(self.bind(F + "obs-fader", {"target": "input_volume",
                                                                         "inputName": "Kit Beat"}), FakeObs(), IDS), [])
        self.assertIn("answered 600", kk.binding_problems(
            self.bind(F + "obs-fader", {"target": "input_volume", "inputName": "Beat"}), FakeObs(), IDS)[0])
        self.assertIn("is not checked", kk.binding_problems(
            self.bind(F + "obs-fader", {"target": "transition"}), FakeObs(), IDS)[0])

    def test_panic_keys_need_visual_sidechains_hotkeys(self):
        self.assertEqual(kk.binding_problems(self.bind(F + "visual-panic", {}), FakeObs(), IDS), [])
        obs = FakeObs()
        obs.hotkeys = ["visual_sidechain_panic"]
        self.assertIn("no hotkey visual_sidechain_restore",
                      kk.binding_problems(self.bind(F + "visual-panic", {}), obs, IDS)[0])

    def test_vjster_keys_target_the_speed_page_and_unknown_actions_fail(self):
        for c in [*LAYOUTS["vjster"]["keys"], *LAYOUTS["vjster"]["encoders"]]:
            self.assertEqual(kk.binding_problems(self.bind(kk.VJSTER + c["kind"], c["settings"]), FakeObs(), IDS), [])
        self.assertIn("not the Speed Page's", kk.binding_problems(
            self.bind(kk.VJSTER + "speed", {"target": "browser"}), FakeObs(), IDS)[0])
        self.assertIn("does not know", kk.binding_problems(self.bind("com.other.thing", {}), FakeObs(), IDS)[0])
        self.assertIn("does not know", kk.binding_problems(self.bind(F + "obs-new", {}), FakeObs(), IDS)[0])
        self.assertEqual(kk.binding_problems(self.bind("com.elgato.streamdeck.page.next", {}), FakeObs(), IDS), [])


class Versions(unittest.TestCase):
    LOG = ("12:54:06.945: [obs-playlister] plugin loaded successfully (version 0.5.0)\n"
           "12:54:06.968: [visual-sidechain] plugin loaded successfully (version 0.6.0)\n")

    def test_the_log_gives_each_plugins_version(self):
        self.assertEqual(kk.loaded_versions(self.LOG), {"obs-playlister": "0.5.0", "visual-sidechain": "0.6.0"})

    def test_the_kits_minimums_pass_the_checked_builds(self):
        self.assertEqual(sorted(IDS["plugins"]), ["obs-playlister", "visual-sidechain"])
        self.assertEqual(kk.version_problems(kk.loaded_versions(self.LOG), IDS["plugins"]), [])

    def test_an_older_or_missing_plugin_fails_and_versions_compare_as_numbers(self):
        mins = {"visual-sidechain": {"min_version": "0.6.0"}, "obs-playlister": {"min_version": "0.5.0"}}
        problems = kk.version_problems({"visual-sidechain": "0.5.1"}, mins)
        self.assertEqual(problems, ["visual-sidechain: 0.5.1 is older than the kit's minimum 0.6.0",
                                    "obs-playlister: not loaded (no version line in the OBS log)"])
        self.assertEqual(kk.version_problems({"visual-sidechain": "0.10.0", "obs-playlister": "0.5.0"}, mins), [])


class Websocket(unittest.TestCase):
    def test_the_authentication_string_is_obs_websockets(self):
        # The worked example in obs-websocket's protocol.md (Creating an authentication string).
        self.assertEqual(kk.auth_string("supersecretpassword", "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=",
                                        "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="),
                         "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=")


class PanicRestore(unittest.TestCase):
    def test_a_key_absent_before_must_be_at_its_default_after(self):
        self.assertEqual(kk.settings_restored({"a": 1}, {"a": 1, "b": 0.18}, {"b": 0.18}), [])
        self.assertEqual(kk.settings_restored({"a": 1}, {"a": 1, "b": 0.0}, {"b": 0.18}), ["b 0.18 -> 0.0"])
        self.assertEqual(kk.settings_restored({"a": 1.0}, {"a": 1.0000001}, {}), [])
        self.assertEqual(kk.settings_restored({"a": 1, "s": "x"}, {"a": 0, "s": "y"}, {}), ["a 1 -> 0", "s 'x' -> 'y'"])

    def test_shader_uniform_defaults_are_read_from_the_shader_file(self):
        text = ('uniform float kick_zoom_amount <\n\tstring label = "Kick";\n\tfloat minimum = 0.0;\n> = 0.18;\n\n'
                'uniform int symmetry_folds <\n\tint step = 1;\n> = 6;\n'
                'uniform bool flash <\n> = true;\n'
                'float4 mainImage(VertData v_in) : TARGET { return image.Sample(texture_sampler, v_in.uv); }\n')
        self.assertEqual(kk.shader_defaults(text), {"kick_zoom_amount": 0.18, "symmetry_folds": 6.0, "flash": True})


def fake_kit(root: Path) -> Path:
    """A kit folder with the committed docs and template, small media with a manifest, and profiles."""
    kit = root / "kit"
    (kit / "build" / "media").mkdir(parents=True)
    (kit / "build" / "profiles").mkdir()
    for name in ["kit-template.json", "README.md", "CREDITS.md", kc.SETUP_CARD]:
        (kit / name).write_bytes((KIT / name).read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
    files = []
    for rel in kc.MEDIA_FILES:
        data = rel.encode("utf-8") * 3
        (kit / "build" / rel).write_bytes(data)
        files.append({"path": rel, "sha1": hashlib.sha1(data).hexdigest()})
    (kit / "build" / "media-manifest.json").write_text(json.dumps({"files": files}), encoding="utf-8")
    for name in kd.PROFILE_FILES:
        (kit / "build" / "profiles" / name).write_bytes(profile({"P": {}}))
    return kit


class Zip(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.kit = fake_kit(Path(self.tmp.name))
        self.out = Path(self.tmp.name) / "out"

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_zip_holds_what_the_readme_table_promises(self):
        listing = kp.build_zip(self.out, self.kit)
        with zipfile.ZipFile(self.out / kp.ZIP_NAME) as z:
            names = z.namelist()
        self.assertEqual(names, sorted(names))
        self.assertEqual(kk.top_level(names), kp.readme_zip_names((KIT / "README.md").read_text(encoding="utf-8")))
        self.assertEqual(sorted(n for n in names if n.startswith("media/")), sorted(kc.MEDIA_FILES))
        self.assertEqual([f["path"] for f in listing["files"]], names)
        self.assertEqual(json.loads((self.out / "kit-zip.json").read_text(encoding="utf-8")), listing)

    def test_the_collection_is_the_template_and_text_files_have_lf(self):
        kp.build_zip(self.out, self.kit)
        with zipfile.ZipFile(self.out / kp.ZIP_NAME) as z:
            self.assertEqual(json.loads(z.read(kd.COLLECTION_FILE)), TEMPLATE)
            for name in [kd.COLLECTION_FILE, "README.md", "CREDITS.md", kc.SETUP_CARD]:
                self.assertNotIn(b"\r\n", z.read(name), name)
            self.assertEqual(z.read("media/kit-beat.ogg"), b"media/kit-beat.ogg" * 3)

    def test_two_builds_give_the_same_bytes_and_a_changed_one_keeps_the_old_zip(self):
        first = kp.build_zip(self.out, self.kit)["sha256"]
        self.assertEqual(kp.build_zip(self.out, self.kit)["sha256"], first)
        self.assertFalse((self.out / f"{kp.ZIP_NAME}.run1").exists())
        (self.kit / "CREDITS.md").write_text("changed\n", encoding="utf-8")
        second = kp.build_zip(self.out, self.kit)["sha256"]
        self.assertNotEqual(second, first)
        self.assertEqual(hashlib.sha256((self.out / f"{kp.ZIP_NAME}.run1").read_bytes()).hexdigest(), first)
        self.assertEqual(hashlib.sha256((self.out / kp.ZIP_NAME).read_bytes()).hexdigest(), second)

    def test_media_off_the_manifest_or_a_missing_profile_is_refused(self):
        (self.kit / "build" / "media" / "layer-a.mp4").write_bytes(b"other")
        (self.kit / "build" / "profiles" / kd.PROFILE_FILES[1]).rename(self.kit / "build" / "elsewhere")
        with self.assertRaises(RuntimeError) as caught:
            kp.zip_entries(self.kit)
        self.assertIn("layer-a.mp4 does not match the media manifest", str(caught.exception))
        self.assertIn(f"{kd.PROFILE_FILES[1]} is missing", str(caught.exception))
        self.assertFalse(self.out.exists())


class CheckFolder(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_unzip_reuses_the_same_bytes_and_refuses_others(self):
        zpath = self.root / "k.zip"
        with zipfile.ZipFile(zpath, "w") as z:
            z.writestr("media/a.mp4", b"aaa")
            z.writestr("README.md", b"r")
        self.assertEqual(ck.unzip(zpath, self.root / "kit"), ["media/a.mp4", "README.md"])
        self.assertEqual(ck.unzip(zpath, self.root / "kit"), ["media/a.mp4", "README.md"])
        (self.root / "kit" / "README.md").write_bytes(b"edited")
        with self.assertRaisesRegex(RuntimeError, "differs from the zip's README.md"):
            ck.unzip(zpath, self.root / "kit")
        self.assertEqual((self.root / "kit" / "README.md").read_bytes(), b"edited")

    def test_the_websocket_password_is_made_once_and_another_port_is_refused(self):
        password = ck.websocket_config(self.root / "obs", 4488)
        self.assertGreaterEqual(len(password), 20)
        self.assertEqual(ck.websocket_config(self.root / "obs", 4488), password)
        with self.assertRaisesRegex(RuntimeError, "another port"):
            ck.websocket_config(self.root / "obs", 4499)

    def test_a_failing_row_is_recorded_and_the_next_still_runs(self):
        results = ck.Results(self.root / "results.jsonl")
        results.guard("first", lambda: 1 / 0)
        results.guard("second", lambda: results.add("second", True, "fine"))
        rows = [json.loads(line) for line in (self.root / "results.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual([(r["row"], r["ok"]) for r in rows], [("first", False), ("second", True)])
        self.assertIn("ZeroDivisionError", rows[0]["detail"])
        ck.Results(self.root / "results.jsonl")  # a second run sets the first file aside
        self.assertTrue((self.root / "results.jsonl.run1").exists())

    def test_the_speed_pages_key_never_reaches_the_results(self):
        line = {"event": "address", "address": "http://127.0.0.1:5/obs?v=x&hl=en#token=0123abcd"}
        self.assertEqual(ck.redact(line)["address"], "http://127.0.0.1:5/obs?v=x&hl=en#token=<not kept>")
        self.assertEqual(ck.redact({"event": "step"}), {"event": "step"})

    def test_unzip_refuses_a_name_that_leaves_the_folder(self):
        for bad in ["../escape.txt", "media/../../escape.txt", "C:/escape.txt", "/escape.txt"]:
            zpath = self.root / "bad.zip"
            with zipfile.ZipFile(zpath, "w") as z:
                z.writestr("README.md", b"r")
                z.writestr(zipfile.ZipInfo(bad), b"x")
            with self.assertRaisesRegex(RuntimeError, "would land outside", msg=bad):
                ck.unzip(zpath, self.root / "kit")
            self.assertFalse((self.root / "escape.txt").exists(), bad)
        good = self.root / "good.zip"
        with zipfile.ZipFile(good, "w") as z:
            z.writestr("media/", b"")
            z.writestr("media/a.mp4", b"a")
        self.assertEqual(ck.unzip(good, self.root / "kit2"), ["media/", "media/a.mp4"])
        self.assertEqual((self.root / "kit2" / "media" / "a.mp4").read_bytes(), b"a")

    def test_results_without_a_path_write_nothing(self):
        results = ck.Results(None)
        self.assertTrue(results.add("row", True, "fine"))
        self.assertEqual(results.rows[0]["row"], "row")
        self.assertEqual(list(self.root.iterdir()), [])

    def test_a_failed_plugins_row_stops_the_later_rows(self):
        ran = []
        results = ck.Results(self.root / "r.jsonl")
        results.run_rows([("scenes", lambda: ran.append("scenes") or results.add("scenes", True, "x")),
                          ("plugins", lambda: results.add("plugins", False, "visual-sidechain: 0.5.1 is older")),
                          ("beat-signals", lambda: ran.append("beat"))])
        self.assertEqual(ran, ["scenes"])
        self.assertEqual([(r["row"], r["ok"]) for r in results.rows],
                         [("scenes", True), ("plugins", False), ("beat-signals", False)])
        self.assertEqual(results.rows[-1]["detail"], ck.NOT_RUN)
        passing = ck.Results(None)
        passing.run_rows([("plugins", lambda: passing.add("plugins", True, "x")),
                          ("beat-signals", lambda: ran.append("beat"))])
        self.assertEqual(ran, ["scenes", "beat"])
        # A plugins row that raises is a failed gate too; another failing row does not stop the run.
        raising = ck.Results(None)
        raising.run_rows([("scenes", lambda: 1 / 0), ("plugins", lambda: 1 / 0), ("inputs", lambda: ran.append("x"))])
        self.assertEqual([r["detail"] for r in raising.rows][-1], ck.NOT_RUN)
        self.assertEqual(ran, ["scenes", "beat"])


class FakeLiveObs:
    """Just enough obs-websocket for the Check's mute, Panic and put-back logic."""

    def __init__(self, log: Path, muted: bool = False, fail: set | None = None):
        self.log, self.muted, self.fail = log, muted, fail or set()
        self.sent: list[tuple[str, dict]] = []
        self.reads = 0

    def call(self, request, data=None):
        data = data or {}
        self.sent.append((request, data))
        if request in self.fail:
            raise RuntimeError(f"{request} failed")
        if request == "GetInputMute":
            return 100, {"inputMuted": self.muted}
        if request == "GetSourceFilter":
            self.reads += 1
            if "GetSourceFilter-after-panic" in self.fail and self.reads > 2 * len(ck.VS_FILTERS):
                raise RuntimeError("the read after Panic failed")
            return 100, {"filterKind": "visual_sidechain_shader_filter", "filterSettings": {"vs_effect_mix_pct": 50}}
        if request == "GetSourceFilterDefaultSettings":
            return 100, {"defaultFilterSettings": {}}
        if request == "TriggerHotkeyByName":
            word = "Panic" if data["hotkeyName"].endswith("panic") else "Restore"
            with open(self.log, "a", encoding="utf-8") as handle:
                handle.write(f"[visual-sidechain] {word} hotkey triggered\n")
        return 100, {}

    def req(self, request, data=None):
        code, response = self.call(request, data)
        if code != 100:
            raise RuntimeError(request)
        return response

    def requests(self, name):
        return [d for r, d in self.sent if r == name]


class CheckCleanup(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.log = self.root / "obs.log"
        self.log.write_text("start\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, obs):
        check = ck.Check(obs, IDS, self.root / "kit", self.root, self.log, ck.Results(None))
        check.wait = lambda seconds: None
        return check

    def test_an_input_already_muted_is_left_muted(self):
        obs = FakeLiveObs(self.log, muted=True)
        check = self.check(obs)
        check.quiet()
        check.put_back()
        self.assertEqual(obs.requests("SetInputMute"), [])
        obs = FakeLiveObs(self.log, muted=False)
        check = self.check(obs)
        check.quiet()
        check.put_back()
        self.assertEqual([d["inputMuted"] for d in obs.requests("SetInputMute")], [True, False])

    def test_one_failing_undo_does_not_skip_the_others(self):
        obs = FakeLiveObs(self.log, fail={"SetInputSettings"})
        check = self.check(obs)
        check.quiet()
        check.undo.append(("settings", "Speed Page", {"url": "x"}))
        check.undo.append(("unmute", "Speed Page"))
        check.put_back()
        self.assertEqual([d["inputUuid"] for d in obs.requests("SetInputMute") if not d["inputMuted"]],
                         [UUID["Speed Page"], UUID["Kit Beat"]])
        row = check.r.rows[-1]
        self.assertEqual((row["row"], row["ok"]), ("put-back", False))
        self.assertIn("settings Speed Page: RuntimeError", row["detail"])
        self.assertEqual(check.undo, [])

    def test_a_read_that_fails_after_panic_still_sends_restore(self):
        obs = FakeLiveObs(self.log, fail={"GetSourceFilter-after-panic"})
        with self.assertRaisesRegex(RuntimeError, "after Panic"):
            self.check(obs).panic()
        self.assertEqual([d["hotkeyName"] for d in obs.requests("TriggerHotkeyByName")],
                         ["visual_sidechain_panic", "visual_sidechain_restore"])
        obs = FakeLiveObs(self.log)
        check = self.check(obs)
        check.panic()
        self.assertEqual([d["hotkeyName"] for d in obs.requests("TriggerHotkeyByName")],
                         ["visual_sidechain_panic", "visual_sidechain_restore"])
        self.assertEqual(check.r.rows[-1]["row"], "panic-restore")


@unittest.skipUnless(WINDOWS, "the saved collection's paths are Windows paths")
class Saved(unittest.TestCase):
    def test_a_saved_collection_passes_whatever_its_name_and_a_changed_value_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            kit = Path(tmp) / "kit"
            saved = kc.with_root(copy.deepcopy(TEMPLATE), str(kit))
            saved["name"] = "Suite Demo Kit 2"
            path = Path(tmp) / "saved.json"
            path.write_text(json.dumps(saved), encoding="utf-8")
            results = ck.Results(Path(tmp) / "r.jsonl")
            self.assertTrue(ck.saved_row(results, path, kit, IDS))
            beat = next(s for s in saved["sources"] if s["name"] == "Kit Beat")
            beat["monitoring_type"] = 0
            path.write_text(json.dumps(saved), encoding="utf-8")
            self.assertFalse(ck.saved_row(results, path, kit, IDS))
            self.assertIn("monitoring_type", results.rows[-1]["detail"])

    def test_compare_import_writes_nothing_into_the_unzip_folder_unless_told(self):
        with tempfile.TemporaryDirectory() as tmp:
            kit = Path(tmp) / "kit"
            kit.mkdir()
            path = Path(tmp) / "saved.json"
            path.write_text(json.dumps(kc.with_root(copy.deepcopy(TEMPLATE), str(kit))), encoding="utf-8")
            self.assertEqual(ck.main(["compare-import", "--file", str(path), "--kit-dir", str(kit)]), 0)
            self.assertEqual(list(kit.iterdir()), [])
            out = Path(tmp) / "compare.jsonl"
            self.assertEqual(ck.main(["compare-import", "--file", str(path), "--kit-dir", str(kit), "--out", str(out)]), 0)
            self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["row"], "compare-import")


if __name__ == "__main__":
    unittest.main(verbosity=1)
