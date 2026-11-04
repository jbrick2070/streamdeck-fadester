// SPDX-License-Identifier: GPL-2.0-or-later
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isOpenDeckInstall, provisionOpenDeckStarter, type OpenDeckStarterDevice } from "../src/opendeck/starter.js";
import type { Profile } from "../src/opendeck/starter-profile.js";

const uuid = "io.github.jbrick2070.fadester-for-obs";
const oldUuid = "com.jbrick2070.fadester-for-obs";
const suite = uuid + ".sdPlugin";
const root = join(import.meta.dirname, "..");
const plusName = "Fadester Scene Desk + (Regular Mode)";
let work: string, config: string, pluginDir: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "opendeck-first-run-"));
  config = join(work, "opendeck");
  pluginDir = join(config, "plugins", suite);
  mkdirSync(join(pluginDir, "opendeck"), { recursive: true });
  copyFileSync(join(root, suite, "manifest.json"), join(pluginDir, "manifest.json"));
  cpSync(join(root, suite, "imgs"), join(pluginDir, "imgs"), { recursive: true });
  copyFileSync(join(root, suite, "opendeck", "starters.json"), join(pluginDir, "opendeck", "starters.json"));
  mkdirSync(join(config, "profiles"));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

function device(type = 7, keys = 8, dials = 4, selected = "Live") {
  const id = "sd-BENCH";
  const folder = join(config, "profiles", id);
  const metadata = join(config, "profiles", id + ".json");
  mkdirSync(folder);
  writeFileSync(metadata, JSON.stringify({ selected_profile: selected, unrelated: 123 }));
  const current = join(folder, selected + ".json");
  writeFileSync(current, JSON.stringify({ keys: Array(keys).fill(null), sliders: Array(dials).fill(null), infobars: [] }));
  const args: OpenDeckStarterDevice = { pluginDir, deviceId: id, deviceType: type };
  return { args, folder, metadata, current };
}

it.each([
  [7, 8, 4, plusName, "__next_scene__"],
  [0, 15, 0, "Fadester Scene Desk 15 Keys (Regular Mode)", "__next_scene__"],
  [1, 6, 0, "Fadester Source Desk Mini (Either Mode)", undefined]
] as const)("publishes a correctly bound native profile from only the installed bundle for device type %s", (type, keys, dials, name, next) => {
  const {args, folder, current, metadata} = device(type, keys, dials);
  const saved = [current, metadata].map(f => readFileSync(f));
  expect(provisionOpenDeckStarter(args)).toEqual({ status: "created", name });
  const profile = JSON.parse(readFileSync(join(folder, name + ".json"), "utf8")) as Profile;
  expect(profile.keys).toHaveLength(keys);
  expect(profile.sliders).toHaveLength(dials);
  const key = profile.keys[1]!;
  expect(key.action.plugin).toBe(suite);
  expect(key.action.UUID).toMatch(/^io\.github\.jbrick2070\.fadester-for-obs\./);
  expect(key.context).toBe(`sd-BENCH.${name}.Keypad.1.0`);
  expect(key.action.Icon).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(key.action.property_inspector).toContain(pluginDir);
  if (next) expect(key.settings).toMatchObject({ sceneTarget: next, operation: "transition", labelOverride: "Next scene" });
  expect([current, metadata].map(f => readFileSync(f))).toEqual(saved);
  expect(readdirSync(folder).sort()).toEqual([name + ".json", "Live.json"].sort());
});

it("recognises a saved Default before the host finishes writing its selection metadata", () => {
  const {args, metadata} = device(7,8,4,"Default");
  rmSync(metadata);
  expect(provisionOpenDeckStarter(args)).toEqual({ status: "created", name: plusName });
  expect(existsSync(metadata)).toBe(false);
});

it("does not resurrect a renamed profile, clobber edits, or keep offering a new starter on reconnect", () => {
  const {args, folder} = device();
  const file = join(folder, plusName + ".json");
  writeFileSync(file, '{"keys":[],"sliders":[],"custom":"operator edit"}');
  const edited = readFileSync(file);
  expect(provisionOpenDeckStarter(args)).toEqual({ status: "exists", name: plusName });
  expect(readFileSync(file)).toEqual(edited);
  renameSync(file, join(folder, "My Scene Desk.json"));
  expect(provisionOpenDeckStarter(args)).toEqual({ status: "skipped", reason: "already-offered" });
  expect(existsSync(file)).toBe(false);
});

it("offers the renamed suite beside the old starter without changing its keys or selecting the replacement", () => {
  const {args, folder, metadata} = device(7,8,4,plusName);
  const original = join(folder, plusName + ".json");
  const legacy = JSON.parse(readFileSync(original, "utf8")) as Profile;
  const wire = { ...legacy, keys: [{ action: { uuid: oldUuid + ".scene-transition" }, settings: { labelOverride: "My live cue" } }, ...legacy.keys.slice(1)] };
  writeFileSync(original, JSON.stringify(wire));
  const name = plusName + " (New ID)";
  expect(provisionOpenDeckStarter(args)).toEqual({ status: "created", name });
  expect(readFileSync(original, "utf8")).toBe(JSON.stringify(wire));
  expect(JSON.parse(readFileSync(metadata, "utf8")).selected_profile).toBe(plusName);
  const replacement = join(folder, name + ".json");
  const newProfile = JSON.parse(readFileSync(replacement, "utf8")) as Profile;
  expect(newProfile.keys[1]?.context).toBe(`sd-BENCH.${name}.Keypad.1.0`);
  expect(newProfile.keys[1]?.action.UUID).toBe(uuid + ".scene-transition");
  writeFileSync(replacement, "My renamed-plugin edits");
  expect(provisionOpenDeckStarter(args)).toEqual({ status: "exists", name });
  expect(readFileSync(replacement, "utf8")).toBe("My renamed-plugin edits");
});

it("respects recovery files, and never creates a competing primary profile", () => {
  const { args, folder } = device();
  const target = join(folder, plusName + ".json");
  writeFileSync(target + ".bak", "existing backup");
  expect(provisionOpenDeckStarter(args)).toEqual({ status: "exists", name: plusName });
  expect(existsSync(target)).toBe(false);
  expect(readFileSync(target + ".bak", "utf8")).toBe("existing backup");
});

it("two independent plugin starts publish one intact profile", async () => {
  const { args, folder } = device();
  const program = `import { provisionOpenDeckStarter } from ${JSON.stringify(new URL("../src/opendeck/starter.ts", import.meta.url).href)};
    console.log(JSON.stringify(provisionOpenDeckStarter(JSON.parse(process.argv[1]))));`;
  const start = async () => JSON.parse((await promisify(execFile)(process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", program, JSON.stringify(args)], { cwd: root })).stdout);
  const results = await Promise.all([start(), start()]);
  expect(results.map(r => r.status).sort()).toEqual(["created", "exists"]);
  expect(readdirSync(folder).sort()).toEqual([plusName + ".json", "Live.json"].sort());
  const saved = JSON.parse(readFileSync(join(folder, plusName + ".json"), "utf8")) as Profile;
  expect(saved.keys[1]?.action.UUID).toBe(uuid + ".scene-transition");
});

it("refuses other plugin hosts, unrecognised hardware, unsafe IDs and a not-yet-initialised current profile", () => {
  const {args, current, metadata, folder} = device();
  const foreign=join(work, "Elgato", "StreamDeck", "Plugins", suite);
  mkdirSync(foreign, { recursive: true });
  expect(isOpenDeckInstall(foreign)).toBe(false);
  expect(provisionOpenDeckStarter({ ...args, pluginDir: foreign })).toMatchObject({ reason: "not-opendeck" });
  for (const deviceId of ["../elsewhere","sd-A/../../x","C:\\other","sd-BENCH.extra"]) {
    expect(provisionOpenDeckStarter({ ...args, deviceId })).toMatchObject({ reason: "store-not-ready" });
  }
  for (const change of [{ deviceType: 9 }, { deviceType: 0 }, { rows: 3, columns: 4 }]) {
    expect(provisionOpenDeckStarter({ ...args, ...change })).toMatchObject({ reason: "unsupported-device" });
  }
  rmSync(current);
  expect(provisionOpenDeckStarter(args)).toMatchObject({ reason: "store-not-ready" });
  writeFileSync(metadata, JSON.stringify({ selected_profile: "../../plugins/" + suite + "/manifest" }));
  expect(provisionOpenDeckStarter(args)).toMatchObject({ reason: "store-not-ready" });
  expect(readdirSync(folder)).toEqual([]);
});
