// SPDX-License-Identifier: GPL-2.0-or-later
// Fadester Companion for Mac: the translated quick starts and presets it bundles, and the helper names macOS shows
// in System Settings → Privacy & Security → Accessibility.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(__dirname, "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const locales = Object.keys(JSON.parse(read("tourbox/presets/locales.json")) as Record<string, unknown>).sort();

describe("Mac quick starts", () => {
  it("has one Mac quick start per preset language, and nothing else", () => {
    const guides = readdirSync(join(repo, "tourbox/macos/panel/guide")).sort();
    expect(guides).toEqual(locales.map((locale) => `${locale}.html`).sort());
  });

  for (const locale of locales) {
    it(`${locale}: Mac-only, in its language, linked to the full guide`, () => {
      const page = read(`tourbox/macos/panel/guide/${locale}.html`);
      expect(page).toContain(`<html lang="${locale}">`);
      expect(page).toContain('href="quickstart.css"');
      expect(page).toContain('href="../START-HERE.html"');
      expect(page).toContain('href="../START-HERE.html#recovery"');
      expect(page).toContain(`--language ${locale}`);
      expect(page).toMatch(/(Option|Opción|Opzione) \+ /u); // Control + Option + Shift, with the keys named as Apple names them
      // No Windows-only content: no game controller, Windows build, .exe, PowerShell or Start menu.
      for (const windowsOnly of ["Windows x64", "XInput", "Xbox", ".exe", "PowerShell", "presets/" + locale]) {
        expect(page, windowsOnly).not.toContain(windowsOnly);
      }
      expect(page).toContain("Fadester Companion T-bar");
      expect(page).toContain("Fadester Companion Shortcuts");
    });
  }

  it("START-HERE links every translation and has the recovery anchor", () => {
    const generator = read("tourbox/macos/panel/make-guide.py");
    expect(generator).toContain('<h2 id="recovery">');
    expect(generator).toContain('guide/{code}.html');
    expect(generator).not.toMatch(/experimental/i);
  });

  it("build.sh and package.sh bundle each language's Mac preset and quick start", () => {
    const build = read("tourbox/macos/panel/build.sh");
    expect(build).toContain("build_macos.py\" --check --localized-out");
    expect(build).toContain('cp "guide/$locale.html" "$resources/guide/"');
    const pack = read("tourbox/macos/package.sh");
    expect(pack).toContain('test -f "$shipped/Contents/Resources/presets/$locale/OBS Fadester for TourBox.tb"');
    expect(pack).toContain('test -f "$check/Fadester Companion/guide/$locale.html"');
  });
});

describe("what macOS shows when it asks for the Downloads folder (QA-R202)", () => {
  const apple = ["en", "de", "es", "fr", "it", "ja", "ko", "nl", "pt-BR", "ru", "tr", "zh-Hans", "zh-Hant"];
  it("is said in the suite's 13 languages, each in its own words, and the build carries and checks them", () => {
    const folders = readdirSync(join(repo, "tourbox/macos/panel/lproj")).sort();
    expect(folders).toEqual(apple.map((language) => `${language}.lproj`).sort());
    const sentences = apple.map((language) => {
      const table = read(`tourbox/macos/panel/lproj/${language}.lproj/InfoPlist.strings`);
      const sentence = /^"NSDownloadsFolderUsageDescription" = "([^"]+)";\r?$/m.exec(table)?.[1] ?? "";
      expect(sentence, language).toContain("Fadester Companion");
      expect(sentence, language).toContain("TourBox Console");
      return sentence;
    });
    expect(new Set(sentences).size).toBe(13);
    expect(read("tourbox/macos/panel/Info.plist")).toContain(`<string>${sentences[0]}</string>`);
    const build = read("tourbox/macos/panel/build.sh");
    expect(build).toContain('cp "$folder/InfoPlist.strings" "$resources/$(basename "$folder")/InfoPlist.strings"');
    expect(build).toContain("Expected 13 InfoPlist.strings languages");
    // The app's own self-test reads each one from the built bundle.
    expect(read("tourbox/macos/panel/HostController.swift")).toContain('language + ".lproj/InfoPlist.strings"');
  });

  it("the guides do not state the preset's file name as the only one (QA-R201)", () => {
    for (const locale of locales) expect(read(`tourbox/macos/panel/guide/${locale}.html`), locale).toContain("<code>OBS Fadester for TourBox 2.tb</code>");
    expect(read("tourbox/macos/panel/make-guide.py").split("OBS Fadester for TourBox 2.tb").length - 1).toBe(2);
    const strings = JSON.parse(read("tourbox/macos/panel/mac-strings.json")) as { strings: Record<string, string[]> };
    for (const key of ["macImportSteps", "macImportWhySaved"]) {
      for (const text of strings.strings[key]) {
        expect(text, key).toContain("{1}");
        expect(text, key).not.toContain(".tb");
      }
    }
    const swift = read("tourbox/macos/panel/ShowMe.swift");
    expect(swift).not.toContain('text("OBS Fadester for TourBox.tb"');
    expect(swift).toContain("text(fileName, at:");
  });
});

describe("Mac helper names", () => {
  const files = [
    "tourbox/macos/panel/HostController.swift", "tourbox/macos/panel/build.sh", "tourbox/macos/package.sh",
    "tourbox/macos/native/Info.plist", "tourbox/macos/native/build.sh", "tourbox/macos/native/Main.swift",
    "tourbox/macos/input/Info.plist", "tourbox/macos/input/build.sh", "tourbox/macos/panel/Info.plist",
    ".github/workflows/tourbox-macos.yml",
  ];
  it("ships plain names and bundle IDs, without \"Experimental\"", () => {
    for (const file of files) expect(read(file), file).not.toMatch(/experimental/i);
    expect(read("tourbox/macos/native/Info.plist")).toContain("<string>Fadester Companion T-bar</string>");
    expect(read("tourbox/macos/input/Info.plist")).toContain("<string>Fadester Companion Shortcuts</string>");
    expect(read("tourbox/macos/panel/HostController.swift")).toContain('runtime/Fadester Companion T-bar.app');
    expect(read("tourbox/macos/panel/HostController.swift")).toContain('runtime/Fadester Companion Shortcuts.app');
  });
});
