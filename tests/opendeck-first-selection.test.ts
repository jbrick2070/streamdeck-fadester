// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main } from "../scripts/opendeck/install.js";

// Exercise the real CLI and profile writes without a built bundle or a running host.
vi.mock("node:child_process", async (load) => ({
  ...await load<typeof import("node:child_process")>(),
  execFileSync: () => {
    if (process.platform === "win32") return "No tasks are running which match the specified criteria.";
    throw Object.assign(new Error("No running OpenDeck"), { status: 1 });
  }
}));
vi.mock("../scripts/opendeck/opendeck.js", async (load) => ({
  ...await load<typeof import("../scripts/opendeck/opendeck.js")>(), isBuilt: () => true,
  installPlugin: (_source: string, config: string, uuid: string) => {
    const path = join(config, "plugins", uuid + ".sdPlugin");
    mkdirSync(path, { recursive: true });
    return path;
  }
}));

const dev = "sd-SAMPLE";
const initial = '{"extra":{"keep":true}, "selected_profile":"Default"}\n';
let config: string;
const selector = () => join(config, "profiles", dev + ".json");
const deckFolder = () => join(config, "profiles", dev);
const selected = () => JSON.parse(readFileSync(selector(), "utf8")).selected_profile;
function put(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}
function deck(keys = 8, dials = 4) {
  put(join(deckFolder(), "Default.json"), { keys: Array(keys).fill(null), sliders: Array(dials).fill(null), infobars: [] });
  writeFileSync(selector(), initial);
}
const install = (...args: string[]) => main(["suite", "--config", config, "--fadester-layouts", "fit", ...args]);
beforeEach(() => {
  config = mkdtempSync(join(tmpdir(), "fadester-first-selection-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); rmSync(config, { recursive: true, force: true }); });

it.each([
  [8, 4, "Fadester Scene Desk + (Regular Mode)"],
  [15, 0, "Fadester Scene Desk 15 Keys (Regular Mode)"],
  [6, 0, "Fadester Source Desk Mini (Either Mode)"]
] as const)("selects a newly written starter for %i keys and %i dials without losing device metadata", (keys, dials, profile) => {
  deck(keys, dials);
  expect(install("--layout")).toBe(0);
  expect(JSON.parse(readFileSync(selector(), "utf8"))).toEqual({ extra: { keep: true }, selected_profile: profile });
  expect(existsSync(join(deckFolder(), profile + ".json"))).toBe(true);
  expect(JSON.parse(readFileSync(join(deckFolder(), "Default.json"), "utf8")).keys[0].action.Name).toBe("VJster Speed Preset");
  // The original bytes are recoverable, and a reinstall respects a subsequent manual switch.
  const suite = JSON.parse(readFileSync(join(deckFolder(), profile + ".json"), "utf8")).keys[0].action.plugin.replace(/\.sdPlugin$/, "");
  expect(readFileSync(join(config, "backups", suite, dev + "-selection.json"), "utf8")).toBe(initial);
  writeFileSync(selector(), initial);
  expect(install()).toBe(0);
  expect(selected()).toBe("Default");
});

it.each(["occupied", "other profile", "app mapping", "legacy suite", "current suite", "ambiguous device", "forced", "dry run"])(
  "preserves the original selection for %s", (reason) => {
    deck();
    if (reason === "occupied") put(join(deckFolder(), "Default.json"), {keys:Array(8).fill(null), sliders:Array(4).fill(null), infobars:[{}]});
    if (reason === "other profile") put(join(deckFolder(), "Working.json"), {});
    if (reason === "app mapping") put(join(config,"applications.json"), { OBS: { [dev]: "Default" } });
    if (reason === "legacy suite") mkdirSync(join(config,"plugins","com.jbrick2070.fadester-for-obs.sdPlugin"),{recursive:true});
    if (reason === "current suite") mkdirSync(join(config,"plugins","io.github.jbrick2070.fadester-for-obs.sdPlugin"),{recursive:true});
    if (reason === "ambiguous device") mkdirSync(join(config,"profiles","sd-Z"));
    const flags = reason === "forced" ? ["--force"] : reason === "dry run" ? ["--dry-run"] : [];
    expect(install(...flags)).toBe(0);
    expect(readFileSync(selector(), "utf8")).toBe(initial);
    if (reason === "dry run") expect(existsSync(join(config,"plugins"))).toBe(false);
  }
);
