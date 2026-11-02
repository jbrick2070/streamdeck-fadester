# SPDX-License-Identifier: GPL-2.0-or-later
"""Unit tests for the kit's texts (kit_docs.py): CREDITS.md, the setup card, the README and the
on-screen speed and credit texts. Run by tests/demo-kit-docs.test.ts. Standard library only.
That the committed CREDITS.md is what the stock list gives is tested in test_build_kit.py,
which has the stock clip table.
"""
import copy
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
KIT = Path(__file__).resolve().parent
sys.path.insert(0, str(KIT))
import kit_collection as kc  # noqa: E402
import kit_docs as kd  # noqa: E402

IDS = kc.load_ids()
CARD = (KIT / kc.SETUP_CARD).read_text(encoding="utf-8")
README = (KIT / "README.md").read_text(encoding="utf-8")
CREDITS = (KIT / "CREDITS.md").read_text(encoding="utf-8")

CLIPS = [
    {"out": "clip-a.mp4", "changes": "cut to 8 s, audio removed",
     "source": {"title": "File:A race.webm", "page": "https://commons.example/wiki/File:A_race.webm",
                "artist": "Someone", "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0",
                "start": 4.6, "seconds": 8}},
    {"out": "clip-b.mp4", "changes": "cut to 8 s, audio removed",
     "source": {"title": "File:B train.ogv", "page": "https://commons.example/wiki/File:B_train.ogv",
                "artist": "Another", "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0",
                "start": 3, "seconds": 8}},
]


TEXT_SUFFIXES = {".py", ".md", ".html", ".json"}


def committed_files() -> list[Path]:
    """Every text file of the kit's source (not build/, which is never committed) and the
    vitest wrappers that run the kit's tests."""
    kit_files = [p for p in KIT.iterdir() if p.is_file() and p.suffix in TEXT_SUFFIXES]
    return sorted(kit_files) + sorted((KIT.parent / "tests").glob("demo-kit-*.test.ts"))


class Credits(unittest.TestCase):
    def test_a_clip_gets_every_credit_field(self):
        text = kd.render_credits(CLIPS)
        self.assertEqual(kd.credits_problems(text, CLIPS), [])
        section = text[text.index("### media/clip-a.mp4"):text.index("### media/clip-b.mp4")]
        for want in ["“A race”", "`File:A race.webm`", "Author: Someone",
                     "Licence: CC BY 3.0, https://creativecommons.org/licenses/by/3.0",
                     "Source page: https://commons.example/wiki/File:A_race.webm",
                     "Part used: 4.6 s to 12.6 s of the original", "Changes: cut to 8 s, audio removed"]:
            self.assertIn(want, section)

    def test_our_media_and_the_youtube_video_are_credited(self):
        # K.6: the beat and the title image; the three generated loops are no longer made.
        self.assertEqual([name for name, _ in kd.ORIGINALS], ["media/kit-beat.ogg", "media/kit-title.png"])
        text = kd.render_credits(CLIPS)
        for name, _ in kd.ORIGINALS:
            self.assertIn(f"`{name}`", text)
        self.assertIn(f"{kd.OUR_LICENSE}, {kd.OUR_LICENSE_URL}", text)
        self.assertIn(kd.YOUTUBE_CREDIT["watch"], text)
        self.assertIn(kd.YOUTUBE_CREDIT["license_url"], text)
        self.assertTrue(text.endswith("\n") and not text.endswith("\n\n"))

    def test_display_titles(self):
        self.assertEqual(kd.display_title("File:100 metres hurdles.webm"), "100 metres hurdles")
        self.assertEqual(kd.display_title("File:B train.OGV"), "B train")
        self.assertEqual(kd.display_title("No prefix"), "No prefix")

    def test_a_missing_page_or_licence_url_is_named(self):
        text = kd.render_credits(CLIPS)
        broken = text.replace(CLIPS[1]["source"]["page"], "https://elsewhere")
        self.assertEqual(kd.credits_problems(broken, CLIPS),
                         [f"clip-b.mp4: CREDITS.md does not give its page ({CLIPS[1]['source']['page']})"])
        broken = text.replace("Licence: CC BY 3.0, https://creativecommons.org/licenses/by/3.0", "Licence: CC BY 3.0")
        self.assertIn("clip-a.mp4: CREDITS.md does not give its licence", kd.credits_problems(broken, CLIPS)[0])

    def test_a_fact_in_another_clips_section_does_not_count(self):
        clips = copy.deepcopy(CLIPS)
        clips[1]["source"]["artist"] = "Someone"  # B's author only appears in A's section
        text = kd.render_credits(CLIPS)
        self.assertEqual(kd.credits_problems(text, clips),
                         ["clip-b.mp4: CREDITS.md does not give its author (Someone)"])

    def test_a_clip_without_a_section_is_named(self):
        text = kd.render_credits(CLIPS[:1])
        self.assertEqual(kd.credits_problems(text, CLIPS), ["clip-b.mp4: no section in CREDITS.md"])

    def test_credits_read_back_into_the_same_file(self):
        text = kd.render_credits(CLIPS)
        self.assertEqual(kd.parse_credits(text), CLIPS)
        self.assertEqual(kd.render_credits(kd.parse_credits(CREDITS)), CREDITS)

    def test_a_section_not_in_the_rendered_form_is_refused(self):
        broken = kd.render_credits(CLIPS).replace("Part used: 3 s to 11 s", "Part used: the start")
        with self.assertRaisesRegex(ValueError, "media/clip-b.mp4"):
            kd.parse_credits(broken)

    def test_the_committed_credits_name_every_original_and_the_video(self):
        for name, _ in kd.ORIGINALS:
            self.assertIn(f"`{name}`", CREDITS)
        self.assertIn(kd.YOUTUBE_CREDIT["watch"], CREDITS)


class OnScreen(unittest.TestCase):
    def test_each_clip_needs_title_author_and_licence(self):
        line = "Clips: “A race” by Someone, CC BY 3.0 · “B train” by Another, CC BY 4.0"
        self.assertEqual(kd.on_screen_problems(line, CLIPS), [])
        self.assertEqual(kd.on_screen_problems(line.replace("CC BY 4.0", "CC BY 3.0"), CLIPS),
                         ["clip-b.mp4: the on-screen credits do not say “B train” by Another, CC BY 4.0"])

    def test_the_kit_credits_point_to_the_file(self):
        self.assertIn("CREDITS.md", kc.TEXTS["Kit Credits"])


class SpeedTexts(unittest.TestCase):
    def test_the_kit_texts_say_what_is_true(self):
        self.assertEqual(kd.speed_text_problems(kc.TEXTS), [])

    def test_playlister_speed_must_be_called_a_setting_that_restarts(self):
        texts = dict(kc.TEXTS, **{"Speed Note 50": "50 %: the hurdles clip. Live speed: see the Speed Page scene."})
        problems = kd.speed_text_problems(texts)
        self.assertEqual(problems, ["Speed Note 50 does not say 'Playlister speed is a setting: changing it restarts "
                                    "the clip'"])

    def test_each_playlister_note_is_one_line_since_k6(self):
        for name in ("Speed Note 100", "Speed Note 50"):
            self.assertNotIn("\n", kc.TEXTS[name])
            texts = dict(kc.TEXTS, **{name: kc.TEXTS[name].replace(". ", ".\n", 1)})
            self.assertIn(f"{name} is more than one line; since K.6 it sits over the full-frame clip",
                          kd.speed_text_problems(texts))

    def test_the_100_note_says_which_playlister_the_keys_drive(self):
        texts = dict(kc.TEXTS, **{"Speed Note 100": "100 %: the three clips."})
        self.assertEqual(kd.speed_text_problems(texts),
                         ["Speed Note 100 does not say 'Previous, Play / pause and Next'"])

    def test_vjster_range_and_the_video_credit_are_needed(self):
        texts = dict(kc.TEXTS, **{"Speed Page Note": "VJster: speed from the deck, live in OBS"})
        problems = kd.speed_text_problems(texts)
        self.assertIn("Speed Page Note does not say '0.25x to 2x'", problems)
        self.assertIn("Speed Page Note does not say 'Blender Foundation'", problems)

    def test_no_live_factor_on_a_playlister_text_and_nothing_past_2x(self):
        texts = dict(kc.TEXTS)
        texts["Speed Note 100"] = "100 %: or 0.5x live"
        texts["Speed Page Note"] = kc.TEXTS["Speed Page Note"].replace("0.25x to 2x", "0.25x to 2x (4x soon)")
        problems = kd.speed_text_problems(texts)
        self.assertIn("Speed Note 100 promises a live speed (an 'x' factor); only VJster has one", problems)
        self.assertIn("Speed Page Note promises more than 2x; the OBS page plays at most 2x", problems)

    def test_the_welcome_text_names_no_scene(self):
        # Scene keys draw "Scene N", never the scene's name (plan section 15 item 1).
        for scene in IDS["scenes"]:
            self.assertNotIn(scene["name"], kc.TEXTS["Kit Note"])


class SetupCard(unittest.TestCase):
    def test_the_committed_card_is_static_and_complete(self):
        self.assertEqual(kd.setup_card_problems(CARD), [])

    def test_anything_loaded_or_run_is_named(self):
        for added in ['<script>alert(1)</script>', '<link rel="stylesheet" href="x.css">',
                      '<img src="https://example.com/a.png">', "<style>@import 'x.css';</style>",
                      '<div style="background:url(a.png)"></div>', '<a href="https://example.com">x</a>']:
            broken = CARD.replace("</main>", added + "</main>")
            self.assertTrue(any("loads or runs" in p for p in kd.setup_card_problems(broken)), added)

    def test_a_missing_step_is_named(self):
        self.assertEqual(kd.setup_card_problems(CARD.replace("Keep the link on", "Keep it on")),
                         ["the card does not say 'Keep the link on'"])
        self.assertIn("the card does not say 'aqz-KE-bpKQ'",
                      kd.setup_card_problems(CARD.replace("aqz-KE-bpKQ", "another")))

    def test_size_charset_and_canvas(self):
        self.assertIn("the card is over 6000 bytes", kd.setup_card_problems(CARD + "<!--" + "x" * 6000 + "-->"))
        self.assertIn("the card does not declare UTF-8",
                      kd.setup_card_problems(CARD.replace('<meta charset="utf-8">', "")))
        self.assertIn("the card is not laid out at the Speed Page's 1280x720",
                      kd.setup_card_problems(CARD.replace("width: 1280px; height: 720px", "width: 100%")))

    def test_the_collection_shows_the_card(self):
        settings = kc.SETTINGS["Speed Page"]
        self.assertEqual(settings["local_file"], f"./{kc.SETUP_CARD}")
        self.assertEqual((settings["width"], settings["height"]), (1280, 720))
        self.assertTrue(settings["is_local_file"])


class Readme(unittest.TestCase):
    def test_the_committed_readme_is_complete(self):
        self.assertEqual(kd.readme_problems(README, IDS), [])

    def test_every_do_not_rename_name_must_be_in_the_box(self):
        ids = copy.deepcopy(IDS)
        ids["do_not_rename"].append("Kit Secret")
        self.assertEqual(kd.readme_problems(README, ids), ["the do-not-rename box does not name Kit Secret"])
        outside = README.replace("> `Kit Beat`, ", "> ")
        self.assertIn("the do-not-rename box does not name Kit Beat", kd.readme_problems(outside, IDS))

    def test_the_drive_root_and_path_notes_are_needed(self):
        problems = kd.readme_problems(README.replace("260 characters", "a few characters"), IDS)
        self.assertEqual(problems, ["the README does not say '260 characters'"])

    def test_every_scene_is_named(self):
        problems = kd.readme_problems(README.replace("Kit Speed Page", "Speed scene"), IDS)
        self.assertEqual(problems, ["the README does not name scene Kit Speed Page"])
        self.assertEqual(kd.readme_problems(README.replace("Kit Playlister 50%", "Kit Playlister"), IDS),
                         ["the README does not name scene Kit Playlister 50%"])

    def test_the_readme_says_studio_mode_cue_and_fade(self):
        # K.6: the profile is a Studio Mode layout; a scene key cues, the dial fades.
        for words in ("Studio Mode", "cues that scene in Preview", "fade it in with the dial"):
            self.assertIn(f"the README does not say {words!r}", kd.readme_problems(README.replace(words, "x"), IDS))
        self.assertNotIn("first key cuts to", README)
        self.assertIn(f"Suite Demo Kit {kd.KIT_VERSION}", README)
        self.assertEqual(kd.KIT_VERSION, "1.1")


class Hygiene(unittest.TestCase):
    def test_utf8_without_bom_and_no_banned_words(self):
        # Line ends are git's business (a checkout may give CRLF); read_text() reads either.
        names = [p.name for p in committed_files()]
        for must in ["README.md", "CREDITS.md", kc.SETUP_CARD, "kit_docs.py", "test_kit_docs.py",
                     "build-kit.py", "kit-template.json", "demo-kit-docs.test.ts"]:
            self.assertIn(must, names)
        for path in committed_files():
            data = path.read_bytes()
            self.assertFalse(data.startswith(b"\xef\xbb\xbf"), path.name)
            data.decode("utf-8")
            self.assertNotIn(b"dum" + b"my", data.lower(), path.name)


if __name__ == "__main__":
    unittest.main(verbosity=1)
