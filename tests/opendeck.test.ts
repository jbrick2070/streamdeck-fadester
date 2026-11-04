// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VJSTER_LAYOUT,
  applyLayout,
  buildInstance,
  configDir,
  installPlugin,
  isBuilt,
  knownDevices,
  parseArgs,
  placeLayout,
  pluginFolderName,
  selectedProfile,
  type PluginManifest,
  type Profile
} from "../scripts/opendeck/opendeck.js";

const UUID = "com.example.demo";
const manifest: PluginManifest = {
  Name: "Demo",
  UUID,
  Actions: [
    { Name: "Speed Preset", UUID: `${UUID}.preset`, Icon: "imgs/preset", PropertyInspectorPath: "ui/page.html", Controllers: ["Keypad"], States: [{ Image: "imgs/preset-key" }] },
    { Name: "Speed Step", UUID: `${UUID}.step`, PropertyInspectorPath: "ui/page.html", States: [{ Image: "imgs/step" }] },
    { Name: "Play / Pause", UUID: `${UUID}.play`, States: [{ Image: "imgs/none" }] },
    { Name: "Pin Tab", UUID: `${UUID}.pin`, States: [{ Image: "imgs/none" }] },
    { Name: "Speed", UUID: `${UUID}.speed`, Controllers: ["Encoder"], Encoder: { layout: "layouts/strip.json" }, States: [{ Image: "imgs/none" }] },
    { Name: "Quality", UUID: `${UUID}.quality`, Controllers: ["Encoder"], States: [{ Image: "imgs/none" }] }
  ]
};

let work: string;
let config: string;
let source: string;

function emptyProfile(keys = 8, sliders = 4): Profile {
  return { keys: Array(keys).fill(null), sliders: Array(sliders).fill(null), infobars: [] };
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "opendeck-test-"));
  config = join(work, "opendeck");
  source = join(work, `${UUID}.sdPlugin`);
  mkdirSync(join(source, "bin"), { recursive: true });
  mkdirSync(join(source, "imgs"), { recursive: true });
  mkdirSync(join(source, "logs"), { recursive: true });
  mkdirSync(join(source, "ui"), { recursive: true });
  writeFileSync(join(source, "bin", "plugin.js"), "// plugin");
  writeFileSync(join(source, "imgs", "preset.svg"), "<svg/>");
  writeFileSync(join(source, "imgs", "preset-key.png"), "png");
  writeFileSync(join(source, "logs", "old.log"), "a log from the Stream Deck app");
  writeFileSync(join(source, "ui", "page.html"), "<html/>");
  mkdirSync(join(config, "profiles", "sd-ABC", ), { recursive: true });
  writeFileSync(join(config, "profiles", "sd-ABC.json"), JSON.stringify({ selected_profile: "Live" }));
  writeFileSync(join(config, "profiles", "sd-ABC", "Live.json"), JSON.stringify(emptyProfile()));
});

afterEach(() => rmSync(work, { recursive: true, force: true }));

describe("configDir", () => {
  it("is the OpenDeck folder of each platform", () => {
    expect(configDir("win32", { APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "C:\\Users\\a")).toBe(join("C:\\Users\\a\\AppData\\Roaming", "opendeck"));
    expect(configDir("darwin", {}, "/Users/a")).toBe(join("/Users/a", "Library", "Application Support", "opendeck"));
    expect(configDir("linux", {}, "/home/a")).toBe(join("/home/a", ".config", "opendeck"));
    expect(configDir("linux", { XDG_CONFIG_HOME: "/x" }, "/home/a")).toBe(join("/x", "opendeck"));
  });
  it("falls back to the home folder when Windows has no APPDATA, or an empty one", () => {
    expect(configDir("win32", {}, "C:\\Users\\a")).toBe(join("C:\\Users\\a", "AppData", "Roaming", "opendeck"));
    expect(configDir("win32", { APPDATA: "" }, "C:\\Users\\a")).toBe(join("C:\\Users\\a", "AppData", "Roaming", "opendeck"));
    expect(configDir("linux", { XDG_CONFIG_HOME: "" }, "/home/a")).toBe(join("/home/a", ".config", "opendeck"));
  });
});

describe("installPlugin", () => {
  it("copies the plugin under its UUID folder and leaves the Stream Deck app's logs behind", () => {
    const target = installPlugin(source, config, UUID);
    expect(target).toBe(join(config, "plugins", pluginFolderName(UUID)));
    expect(existsSync(join(target, "bin", "plugin.js"))).toBe(true);
    expect(existsSync(join(target, "ui", "page.html"))).toBe(true);
    expect(existsSync(join(target, "logs"))).toBe(false);
  });
  it("leaves a logs folder at any depth that is not the root one in place", () => {
    mkdirSync(join(source, "ui", "logs"), { recursive: true });
    writeFileSync(join(source, "ui", "logs", "keep.txt"), "x");
    const target = installPlugin(source, config, UUID);
    expect(existsSync(join(target, "ui", "logs", "keep.txt"))).toBe(true);
    expect(existsSync(join(target, "logs"))).toBe(false);
  });
  it("can run again over an earlier copy, and a file the new build no longer ships is gone", () => {
    installPlugin(source, config, UUID);
    writeFileSync(join(source, "bin", "plugin.js"), "// newer");
    rmSync(join(source, "ui", "page.html"));
    const target = installPlugin(source, config, UUID);
    expect(readFileSync(join(target, "bin", "plugin.js"), "utf8")).toBe("// newer");
    expect(existsSync(join(target, "ui", "page.html"))).toBe(false);
  });
  it("knows whether a folder was built", () => {
    expect(isBuilt(source)).toBe(true);
    expect(isBuilt(join(work, "nowhere"))).toBe(false);
  });
  it("refuses a folder that was never built", () => {
    rmSync(join(source, "bin"), { recursive: true });
    expect(() => installPlugin(source, config, UUID)).toThrow(/npm run build/);
  });
});

describe("buildInstance", () => {
  const folder = pluginFolderName(UUID);
  it("gives the settings page an absolute path and the images as data URIs", () => {
    const pluginDir = installPlugin(source, config, UUID);
    const instance = buildInstance(manifest.Actions[0], folder, pluginDir, "sd-ABC.Live.Keypad.0.0");
    expect(instance.action.property_inspector).toBe(join(pluginDir, "ui", "page.html"));
    expect(instance.action.PropertyInspectorPath).toBeUndefined();
    expect(instance.action.plugin).toBe(folder);
    expect(String(instance.action.Icon)).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(instance.states[0].Image).toMatch(/^data:image\/png;base64,/);
    expect(instance.context).toBe("sd-ABC.Live.Keypad.0.0");
    expect(instance.settings).toEqual({});
  });
  it("keeps the manifest's own text when no image file exists, and an empty settings path when there is none", () => {
    const instance = buildInstance(manifest.Actions[2], folder, join(config, "plugins", folder), "ctx");
    expect(instance.states[0].Image).toBe("imgs/none");
    expect(instance.action.Icon).toBe("");
    expect(instance.action.property_inspector).toBe("");
  });
});

describe("placeLayout", () => {
  it("fills the free keys and dials the layout names", () => {
    const profile = emptyProfile();
    const result = placeLayout(profile, manifest, source, VJSTER_LAYOUT, "sd-ABC", "Live");
    expect(result.placed).toHaveLength(6);
    expect(profile.keys.slice(0, 4).map((k) => k?.action.Name)).toEqual(["Speed Preset", "Speed Step", "Play / Pause", "Pin Tab"]);
    expect(profile.keys.slice(4).every((k) => k === null)).toBe(true);
    expect(profile.sliders.slice(0, 2).map((s) => s?.action.Name)).toEqual(["Speed", "Quality"]);
    expect(profile.sliders[1]?.context).toBe("sd-ABC.Live.Encoder.1.0");
  });
  it("never replaces a slot that holds another action", () => {
    const profile = emptyProfile();
    const other = buildInstance(manifest.Actions[3], "other.sdPlugin", source, "ctx");
    profile.keys[0] = other;
    const result = placeLayout(profile, manifest, source, VJSTER_LAYOUT, "sd-ABC", "Live");
    expect(profile.keys[0]).toBe(other);
    expect(result.skipped).toEqual(["Speed Preset (key 1): the slot is in use"]);
    expect(result.placed).toHaveLength(5);
  });
  it("builds its own earlier entry again, keeping its settings, and says it refreshed it", () => {
    const profile = emptyProfile();
    placeLayout(profile, manifest, source, VJSTER_LAYOUT, "sd-ABC", "Live");
    (profile.keys[1] as { settings: Record<string, unknown> }).settings = { step: 0.5 };
    (profile.keys[1] as { action: Record<string, unknown> }).action.property_inspector = "ui/page.html";
    const result = placeLayout(profile, manifest, source, VJSTER_LAYOUT, "sd-ABC", "Live");
    expect(result.placed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.refreshed).toHaveLength(6);
    expect(profile.keys[1]?.settings).toEqual({ step: 0.5 });
    expect(profile.keys[1]?.action.property_inspector).toBe(join(source, "ui", "page.html"));
  });
  it("also knows an entry OpenDeck saved under its own lower-case field names", () => {
    const profile = emptyProfile();
    placeLayout(profile, manifest, source, VJSTER_LAYOUT, "sd-ABC", "Live");
    const saved = profile.keys[0] as { action: Record<string, unknown> };
    saved.action = { name: "Speed Preset", uuid: `${UUID}.preset`, plugin: pluginFolderName(UUID) };
    const result = placeLayout(profile, manifest, source, VJSTER_LAYOUT, "sd-ABC", "Live");
    expect(result.refreshed).toContain("Speed Preset (key 1)");
  });
  it("skips dials on a deck without them and names that it did", () => {
    const profile = emptyProfile(6, 0);
    const result = placeLayout(profile, manifest, source, VJSTER_LAYOUT, "sd-ABC", "Live");
    expect(result.placed).toHaveLength(4);
    expect(result.skipped).toEqual(["Speed (dial 1): not available here", "Quality (dial 2): not available here"]);
  });
  it("skips a name the plugin does not have", () => {
    const profile = emptyProfile();
    const result = placeLayout(profile, manifest, source, { keys: { 0: "Nope" }, sliders: {} }, "sd-ABC", "Live");
    expect(result.placed).toEqual([]);
    expect(result.skipped).toEqual(["Nope (key 1): not available here"]);
    expect(profile.keys[0]).toBeNull();
  });
});

describe("devices and profiles on disk", () => {
  it("lists the decks OpenDeck has profiles for", () => {
    mkdirSync(join(config, "profiles", "sd-AAA"));
    expect(knownDevices(config)).toEqual(["sd-AAA", "sd-ABC"]);
    expect(knownDevices(join(work, "nowhere"))).toEqual([]);
  });
  it("reads the selected profile, and says Default when it cannot", () => {
    expect(selectedProfile(config, "sd-ABC")).toBe("Live");
    expect(selectedProfile(config, "sd-NONE")).toBe("Default");
    writeFileSync(join(config, "profiles", "sd-ABC.json"), "not json");
    expect(selectedProfile(config, "sd-ABC")).toBe("Default");
    writeFileSync(join(config, "profiles", "sd-ABC.json"), JSON.stringify({ selected_profile: "" }));
    expect(selectedProfile(config, "sd-ABC")).toBe("Default");
  });
});

describe("applyLayout", () => {
  it("writes the placed actions into the selected profile and keeps one copy of the file as it was", () => {
    const pluginDir = installPlugin(source, config, UUID);
    const result = applyLayout(config, "sd-ABC", manifest, pluginDir, VJSTER_LAYOUT);
    expect(result.file).toBe(join(config, "profiles", "sd-ABC", "Live.json"));
    const saved = JSON.parse(readFileSync(result.file, "utf8")) as Profile;
    expect(saved.keys[0]?.action.Name).toBe("Speed Preset");
    const backup = join(config, "backups", UUID, "sd-ABC-Live.json");
    expect((JSON.parse(readFileSync(backup, "utf8")) as Profile).keys[0]).toBeNull();
    // OpenDeck reads every file in a device's profile folder as a profile: no backup goes there.
    expect(readdirSync(join(config, "profiles", "sd-ABC"))).toEqual(["Live.json"]);
  });
  it("keeps the first backup, the file as it was before any run, over later runs", () => {
    const pluginDir = installPlugin(source, config, UUID);
    applyLayout(config, "sd-ABC", manifest, pluginDir, VJSTER_LAYOUT);
    const again = applyLayout(config, "sd-ABC", manifest, pluginDir, VJSTER_LAYOUT);
    expect(again.placed).toEqual([]);
    expect(again.refreshed).toHaveLength(6);
    const backup = join(config, "backups", UUID, "sd-ABC-Live.json");
    expect((JSON.parse(readFileSync(backup, "utf8")) as Profile).keys[0]).toBeNull();
  });
  it("writes nothing when no slot could take anything", () => {
    const pluginDir = installPlugin(source, config, UUID);
    const file = join(config, "profiles", "sd-ABC", "Live.json");
    const full = emptyProfile();
    for (let i = 0; i < 8; i++) full.keys[i] = buildInstance(manifest.Actions[3], "other.sdPlugin", source, `ctx${i}`);
    for (let i = 0; i < 4; i++) full.sliders[i] = buildInstance(manifest.Actions[3], "other.sdPlugin", source, `ctx${i}`);
    writeFileSync(file, JSON.stringify(full));
    const before = readFileSync(file, "utf8");
    const result = applyLayout(config, "sd-ABC", manifest, pluginDir, VJSTER_LAYOUT);
    expect(result.skipped).toHaveLength(6);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(join(config, "backups"))).toBe(false);
  });
  it("names a profile file that is not JSON, or has no slots, and changes nothing", () => {
    const file = join(config, "profiles", "sd-ABC", "Live.json");
    writeFileSync(file, "not json");
    expect(() => applyLayout(config, "sd-ABC", manifest, source, VJSTER_LAYOUT)).toThrow(/not valid JSON/);
    writeFileSync(file, JSON.stringify({ keys: [] }));
    expect(() => applyLayout(config, "sd-ABC", manifest, source, VJSTER_LAYOUT)).toThrow(/no keys and sliders lists/);
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify({ keys: [] }));
  });
  it("says so when OpenDeck has not made the profile yet", () => {
    rmSync(join(config, "profiles", "sd-ABC", "Live.json"));
    expect(() => applyLayout(config, "sd-ABC", manifest, source, VJSTER_LAYOUT)).toThrow(/start OpenDeck with the deck connected/);
  });
});

describe("parseArgs", () => {
  it("reads a plugin name, the flags and the two values", () => {
    expect(parseArgs(["vjster", "--layout", "--dry-run", "--force", "--device", "sd-X", "--config", "C:\o"])).toEqual({
      which: "vjster",
      layout: true,
      dryRun: true,
      force: true,
      device: "sd-X",
      config: "C:\o",
      errors: []
    });
  });
  it("means all plugins when none is named", () => {
    expect(parseArgs([]).which).toBe("all");
  });
  it("reports a typo, a value that is missing or is another flag, and --layout for Fadester alone", () => {
    expect(parseArgs(["--layuot"]).errors).toEqual(["unknown argument --layuot"]);
    expect(parseArgs(["--device"]).errors).toEqual(["--device needs a value"]);
    expect(parseArgs(["--device", "--dry-run"]).errors).toEqual(["--device needs a value", ]);
    expect(parseArgs(["fadester", "--layout"]).errors).toHaveLength(1);
    expect(parseArgs(["all", "--layout"]).errors).toEqual([]);
  });
});

describe("the install command", () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", "opendeck", "install.ts"), ...args], { encoding: "utf8" });

  it("changes nothing on a dry run and says what it would do", () => {
    const result = run("all", "--layout", "--dry-run", "--config", config);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/would copy .*vjster/);
    expect(result.stdout).toMatch(/would place the VJster starter layout on sd-ABC/);
    expect(existsSync(join(config, "plugins"))).toBe(false);
    expect(readFileSync(join(config, "profiles", "sd-ABC", "Live.json"), "utf8")).toBe(JSON.stringify(emptyProfile()));
  });
  it("stops on a typo with the usage line", () => {
    const result = run("--layuot");
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/unknown argument --layuot[\s\S]*Usage:/);
  });
  it("names a missing OpenDeck folder", () => {
    const result = run("vjster", "--force", "--config", join(work, "nowhere"));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/No OpenDeck config folder/);
  });
});

describe("second-round hardening", () => {
  it("installs from a relative source folder without copying its logs", () => {
    const cwd = process.cwd();
    try {
      process.chdir(work);
      const target = installPlugin(`${UUID}.sdPlugin`, config, UUID);
      expect(existsSync(join(target, "bin", "plugin.js"))).toBe(true);
      expect(existsSync(join(target, "logs"))).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });
  it("leaves no .new folder behind and refuses to install a folder over itself", () => {
    installPlugin(source, config, UUID);
    expect(readdirSync(join(config, "plugins"))).toEqual([pluginFolderName(UUID)]);
    const inPlace = join(config, "plugins", pluginFolderName(UUID));
    expect(() => installPlugin(inPlace, config, UUID)).toThrow(/overlap/);
    expect(existsSync(join(inPlace, "bin", "plugin.js"))).toBe(true);
  });
  it("keeps the old install whole when the copy fails", () => {
    installPlugin(source, config, UUID);
    const target = join(config, "plugins", pluginFolderName(UUID));
    // A file name the OS cannot create makes the copy fail partway.
    writeFileSync(join(source, "ui", "page.html"), "<html/>");
    const bad = join(source, "ui", "x".repeat(300));
    try {
      writeFileSync(bad, "too long a name");
    } catch {
      /* the failure under test is the copy's; a platform that allows the name just copies it */
    }
    try {
      installPlugin(source, config, UUID);
    } catch {
      expect(existsSync(join(target, "bin", "plugin.js"))).toBe(true);
    }
    expect(existsSync(`${target}.new`)).toBe(false);
  });
  it("keeps the title styling a user set when it rebuilds an entry", () => {
    const profile = emptyProfile();
    placeLayout(profile, manifest, source, VJSTER_LAYOUT, "sd-ABC", "Live");
    const held = profile.keys[0] as { states: Array<Record<string, unknown>> };
    held.states[0].text_override = "FAST";
    held.states[0].colour = "#FF0000";
    held.states[0].Image = "broken";
    placeLayout(profile, manifest, source, VJSTER_LAYOUT, "sd-ABC", "Live");
    expect(profile.keys[0]?.states[0].text_override).toBe("FAST");
    expect(profile.keys[0]?.states[0].colour).toBe("#FF0000");
    expect(String(profile.keys[0]?.states[0].Image)).toMatch(/^data:image\/png;base64,/);
  });
  it("skips, not crashes on, a slot whose action is missing", () => {
    const profile = emptyProfile();
    profile.keys[0] = { context: "x", states: [], current_state: 0, settings: {}, children: null } as unknown as Profile["keys"][0];
    const result = placeLayout(profile, manifest, source, VJSTER_LAYOUT, "sd-ABC", "Live");
    expect(result.skipped).toEqual(["Speed Preset (key 1): the slot is in use"]);
  });
  it("rejects two plugin names", () => {
    expect(parseArgs(["vjster", "fadester"]).errors).toHaveLength(1);
    expect(parseArgs(["vjster", "vjster"]).errors).toEqual([]);
  });
  it("names an unknown --device and installs nothing", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", join(process.cwd(), "scripts", "opendeck", "install.ts"), "vjster", "--layout", "--force", "--config", config, "--device", "sd-NOPE"],
      { encoding: "utf8" }
    );
    expect(result.status).toBe(1);
    // A checkout that is not built stops one check earlier, at the build; either way nothing is installed.
    expect(result.stderr).toMatch(/no profile file[\s\S]*sd-ABC|no bin\/plugin\.js/);
    expect(existsSync(join(config, "plugins"))).toBe(false);
  });
});
