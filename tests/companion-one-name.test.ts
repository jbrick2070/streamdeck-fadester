// SPDX-License-Identifier: GPL-2.0-or-later
// Fadester Companion ships under one name, on Windows and on the Mac. Up to 0.1.3 the window said Fadester
// Companion but the files did not: the app file, its folder and the release ZIP were still "Fadester for
// TourBox", the engine was FadesterTourBoxBridge and the Mac executable FadesterTourBoxPanel. That read as a
// second, TourBox-only app. These checks hold the one name in place, and the one version on the Windows files.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

// History keeps the old names; so do the two tests that name them.
const HISTORY = [
  /^docs\/history\//,
  /^CHANGELOG\.md$/,
  /^docs\/SUITE-AUDIT-2026-11-14\.md$/,
  /^tests\/companion-one-name\.test\.ts$/,
  /^tests\/vjster-ext-companion\.test\.ts$/
];
// The installers name the old files on purpose: they look for them when checking that the app is closed, and
// they delete them when updating an install made before the rename.
const INSTALLERS = [/^installer\/FadesterCompanion\.iss$/, /^installer\/FadesterSuite\.iss$/];
const NOT_TEXT = /\.(png|jpe?g|gif|webp|ico|icns|tb|zip|wav|ogg|mp3|mp4|mov|woff2?|ttf|otf|pdf|msix|exe|dll|bin|psd)$/i;

const OLD_NAMES: Array<{ what: string; pattern: RegExp }> = [
  { what: "the old app file name", pattern: /Fadester for TourBox\.exe/ },
  { what: "the old release file name", pattern: /Fadester-for-TourBox/ },
  { what: "the old engine name", pattern: /FadesterTourBoxBridge/ },
  // The Windows single-instance mutex keeps its name, so a copy from before the rename and a new one still see
  // each other; nothing else may use the old panel name.
  { what: "the old Mac executable name", pattern: /(?<!Local\\)FadesterTourBoxPanel/ },
  // "OBS Fadester for TourBox" is the preset's name inside TourBox Console and stays.
  { what: "the old product name", pattern: /(?<!OBS )Fadester for TourBox/ },
  // The screenshots folder in Pictures. (The settings folder, FadesterTourBox without a space, stays.)
  { what: "the old Pictures folder name", pattern: /Fadester TourBox/ },
  { what: "the app called a TourBox companion", pattern: /the TourBox companion/i }
];

function trackedTextFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return listed
    .split("\0")
    .filter((rel) => rel.length > 0 && !NOT_TEXT.test(rel))
    .filter((rel) => {
      try {
        return statSync(join(root, rel)).size < 2 * 1024 * 1024;
      } catch {
        return false; // listed but deleted in the working tree
      }
    });
}

describe("Fadester Companion has one name on every file", () => {
  it("uses no old name outside history and the installers' clean-up of old installs", () => {
    const found: string[] = [];
    for (const rel of trackedTextFiles()) {
      if ([...HISTORY, ...INSTALLERS].some((skip) => skip.test(rel))) continue;
      const lines = read(rel).split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const { what, pattern } of OLD_NAMES) {
          if (pattern.test(line)) found.push(`${rel}:${index + 1} has ${what}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it("builds the Windows app, folder, engine and ZIP under the one name", () => {
    const build = read("tourbox/build.ps1");
    expect(build).toContain("$bundle=Join-Path $stage 'Fadester Companion'");
    expect(build).toContain("$panel=Join-Path $bundle 'Fadester Companion.exe'");
    expect(build).toContain('"Fadester-Companion-Windows-x64-"+$Version');
    expect(build).toContain("FadesterCompanionBridge.exe");
    expect(read("tourbox/bridge/FadesterCompanionBridge.csproj")).toContain("<AssemblyName>FadesterCompanionBridge</AssemblyName>");
    expect(read("tourbox/panel/FadesterTourBox.cs")).toContain('"FadesterCompanionBridge.exe"');
    expect(read("tourbox/store/AppxManifest.xml")).toContain('Executable="Fadester Companion.exe"');
    expect(read("tourbox/store/make-msix.ps1")).toContain("'Fadester Companion.exe', 'FadesterCompanionBridge.exe'");
  });

  it("names the Mac app's executable Fadester Companion, in the bundle and in its build", () => {
    const plist = read("tourbox/macos/panel/Info.plist");
    expect(plist).toContain("<key>CFBundleExecutable</key><string>Fadester Companion</string>");
    // One version too: the Mac app says the same as the Windows app.
    const release = (JSON.parse(read("installer/components.json")) as { components: { companion: { version: string } } }).components.companion.version;
    expect(plist).toContain(`<key>CFBundleShortVersionString</key><string>${release}</string>`);
    expect(read("tourbox/macos/panel/build.sh")).toContain('-o "$app/Contents/MacOS/Fadester Companion"');
  });

  it("installs under the one name and clears the old-named files of an earlier install", () => {
    const standalone = read("installer/FadesterCompanion.iss");
    expect(standalone).toContain('Filename: "{app}\\Fadester Companion.exe"');
    expect(standalone).toContain("UninstallDisplayIcon={app}\\Fadester Companion.exe");
    const installDelete = standalone.slice(standalone.indexOf("[InstallDelete]"), standalone.indexOf("[UninstallDelete]"));
    expect(installDelete).toContain('Name: "{app}\\Fadester for TourBox.exe"');
    expect(installDelete).toContain('Name: "{app}\\FadesterTourBoxBridge.exe"');
    // Both installers refuse while the app runs, whichever names its files have.
    for (const script of [standalone, read("installer/FadesterSuite.iss")]) {
      for (const exe of ["Fadester Companion.exe", "FadesterCompanionBridge.exe", "Fadester for TourBox.exe", "FadesterTourBoxBridge.exe"]) {
        expect(script).toContain(`ProcessRunning('${exe}')`);
      }
    }
    expect(read("installer/build-suite.ps1")).toContain("'Fadester Companion.exe', 'FadesterCompanionBridge.exe', 'FadesterNativeSlider.exe'");
    // The workflows hand the installers the folder build.ps1 makes.
    expect(read(".github/workflows/release.yml")).toContain("+ '\\Fadester Companion'");
    expect(read(".github/workflows/suite-installer.yml")).toContain("$build\\Fadester Companion");
  });

  it("saves screenshots under the one name", () => {
    expect(read("tourbox/bridge/DeskActions.cs")).toContain('SpecialFolder.MyPictures), "Fadester Companion")');
  });

  it("stamps the release's version on the Windows files instead of a fixed one", () => {
    // The app file said 0.1.0.0 in every release, and the engine reported 1.0.0 over the whole-mix protocol
    // and the VJster link's /whoami.
    expect(read("tourbox/panel/FadesterTourBox.cs")).not.toMatch(/AssemblyVersion\("/);
    const build = read("tourbox/build.ps1");
    for (const attribute of ["AssemblyVersion", "AssemblyFileVersion", "AssemblyInformationalVersion"]) {
      expect(build).toContain(`System.Reflection.${attribute}(`);
    }
    expect(build).toContain('"-p:Version=$Version"');
    // Every workflow that builds the app takes its version from the one place the release does.
    for (const workflow of [".github/workflows/release.yml", ".github/workflows/tourbox-windows.yml"]) {
      const text = read(workflow);
      expect(text, workflow).toContain(".components.companion.version");
      expect(text, workflow).toContain("build.ps1 -OutDir $out -Version $v");
    }
  });
});
