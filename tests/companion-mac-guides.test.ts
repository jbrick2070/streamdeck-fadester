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
