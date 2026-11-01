// SPDX-License-Identifier: GPL-2.0-or-later
// The Suite Demo Kit's Stream Deck + profiles (demo-kit plan section 4, step 4): the Fadester
// layout through the existing validatePreset / buildProfile, the VJster page through VJster's
// own profileFiles, every key bound to the kit's fixed names and UUIDs (demo-kit/kit-ids.json),
// the files named as the README promises (kit_docs.PROFILE_FILES). Nothing is written to disk
// and nothing is imported into Stream Deck.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Preset, PresetAction, changesProgram, presetPages, validatePreset } from "../scripts/profile-checks.js";
import {
  KIT_DIR,
  KitIds,
  buildKitProfiles,
  kitBindingProblems,
  kitSpeedProblems,
  loadKit,
  promisedProfileFiles
} from "../scripts/build-kit-profiles.js";

const kit = loadKit();
const { layouts, ids, manifest } = kit;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const uuidOf = (name: string): string => ids.sources.find((source) => source.name === name)!.uuid;

/** The entries of a deflate-compressed zip, as text, read from its central directory. */
function unzip(bytes: Buffer): Map<string, string> {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i += 1) {
    const size = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extra = bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    files.set(name, inflateRawSync(bytes.subarray(start, start + size)).toString("utf8"));
    at += 46 + nameLength + extra;
  }
  return files;
}

type StoredAction = { UUID: string; Settings: Record<string, unknown>; Plugin: { UUID: string } };

/** Every action of every page of a built profile. */
function storedActions(bytes: Buffer): StoredAction[] {
  const actions: StoredAction[] = [];
  for (const [name, content] of unzip(bytes)) {
    if (!/\/Profiles\/[^/]+\/manifest\.json$/.test(name)) continue;
    const page = JSON.parse(content) as { Controllers: Array<{ Actions: Record<string, StoredAction> | null }> };
    for (const controller of page.Controllers) actions.push(...Object.values(controller.Actions ?? {}));
  }
  return actions;
}

function action(preset: Preset, page: string, controller: "Keypad" | "Encoder", column: number, row: number): PresetAction {
  const found = presetPages(preset).find((candidate) => candidate.name === page)!.actions
    .find((entry) => entry.controller === controller && entry.column === column && entry.row === row);
  if (!found) throw new Error(`no ${controller} ${column},${row} on ${page}`);
  return found;
}

/** The committed layout with one change, and the problems the kit check then finds. */
function problemsAfter(change: (preset: Preset, kitIds: KitIds) => void): string[] {
  const preset = clone(layouts.fadester);
  const kitIds = clone(ids);
  change(preset, kitIds);
  return kitBindingProblems(preset, kitIds);
}

describe("demo-kit Stream Deck profiles", () => {
  // Built inside each test, so a broken layout fails the tests that see it, not the file's collection.
  let cached: ReturnType<typeof buildKitProfiles> | undefined;
  const builtProfiles = (): ReturnType<typeof buildKitProfiles> => (cached ??= buildKitProfiles());

  it("builds the two files the README promises, by kit_docs.PROFILE_FILES", () => {
    expect(promisedProfileFiles()).toEqual(["Suite Demo Kit +.streamDeckProfile", "Suite Demo Kit Speed +.streamDeckProfile"]);
    expect(builtProfiles().map((profile) => profile.file)).toEqual(promisedProfileFiles());
    const readme = readFileSync(join(KIT_DIR, "README.md"), "utf8");
    for (const { file } of builtProfiles()) expect(readme).toContain(`\`${file}\``);
    expect(promisedProfileFiles('PROFILE_FILES = ["a +.streamDeckProfile", "b.streamDeckProfile"]\n'))
      .toEqual(["a +.streamDeckProfile", "b.streamDeckProfile"]);
    expect(() => promisedProfileFiles("PROFILES = []\n")).toThrow(/no PROFILE_FILES/);
  });

  it("builds the same bytes every time", () => {
    const again = buildKitProfiles();
    expect(again.map((profile) => profile.bytes.equals(builtProfiles().find((other) => other.file === profile.file)!.bytes))).toEqual([true, true]);
  });

  it("the Fadester layout passes validatePreset: SD+, regular mode, a three-page rig with Panic and Next page on their keys", () => {
    const preset = layouts.fadester;
    expect(() => validatePreset(preset, manifest)).not.toThrow();
    expect([preset.deviceType, preset.deviceModel, preset.columns, preset.rows, preset.dials, preset.obsMode])
      .toEqual([7, "20GBD9901", 4, 2, 4, "regular"]);
    expect(preset.rig).toEqual({ panic: [3, 1], nextPage: [0, 1] });
    expect(presetPages(preset).map((page) => [page.name, page.accent])).toEqual([["Visuals", "magenta"], ["Layers", "teal"], ["Clips", "brass"]]);
    for (const page of presetPages(preset)) {
      expect(page.actions.filter((entry) => entry.controller === "Keypad"), page.name).toHaveLength(8);
      expect(page.actions.filter((entry) => entry.controller === "Encoder"), page.name).toHaveLength(4);
      // Nothing beside Panic changes Program (the builder's own rule).
      for (const entry of page.actions.filter((candidate) => candidate.controller === "Keypad")) {
        if (Math.abs(entry.column - 3) <= 1 && Math.abs(entry.row - 1) <= 1) expect(changesProgram(entry), `${page.name} ${entry.column},${entry.row}`).toBe(false);
      }
    }
  });

  it("each page drives its scene from key 0,0, and every scene is reachable, by __scene_index_N__ with a cut", () => {
    const sceneKeys = presetPages(layouts.fadester).flatMap((page) => page.actions.filter((entry) => entry.kind === "scene"));
    expect(presetPages(layouts.fadester).map((page) => action(layouts.fadester, page.name, "Keypad", 0, 0).settings.sceneTarget))
      .toEqual(["__scene_index_1__", "__scene_index_2__", "__scene_index_3__"]);
    expect(new Set(sceneKeys.map((entry) => entry.settings.sceneTarget)))
      .toEqual(new Set(ids.scenes.map((scene) => `__scene_index_${scene.index}__`)));
    for (const entry of sceneKeys) expect(entry.settings.operation).toBe("cut");
  });

  it("every binding matches kit-ids.json and every caption is shipped or the control's own OBS name", () => {
    expect(kitBindingProblems(layouts.fadester, ids)).toEqual([]);
  });

  it("the built Fadester profile carries the kit's UUIDs and binds every kit Playlister, look, fade and layer", () => {
    const actions = storedActions(builtProfiles()[0]!.bytes);
    const fadester = actions.filter((entry) => entry.Plugin.UUID === manifest.UUID);
    const bound = (key: string): string[] => fadester.map((entry) => entry.Settings[key]).filter((v): v is string => typeof v === "string" && v !== "");
    const kitUuids = new Set(ids.sources.map((source) => source.uuid));
    for (const uuid of [...bound("inputUuid"), ...bound("sourceUuid")]) expect(kitUuids.has(uuid), uuid).toBe(true);
    expect(new Set(bound("inputUuid"))).toEqual(new Set([uuidOf("Kit Clips"), uuidOf("Kit Clips 50%")]));
    const filters = fadester.filter((entry) => entry.UUID.endsWith(".obs-filter"))
      .map((entry) => `${String(entry.Settings.sourceName)}/${String(entry.Settings.filterName)}`);
    expect(new Set(filters)).toEqual(new Set(["Kit Motion/Look Prism", "Kit Motion/Look Kaleido", "Kit Motion/Look Pulse", "Layer A/Layer Fade", "Layer B/Layer Fade"]));
    const layers = fadester.filter((entry) => entry.UUID.endsWith(".layer-control")).map((entry) => entry.Settings.sourceUuid);
    expect(layers).toEqual(expect.arrayContaining([uuidOf("Layer A"), uuidOf("Layer B")]));
    const faders = fadester.filter((entry) => entry.UUID.endsWith(".obs-fader")).map((entry) => entry.Settings.inputName);
    expect(faders).toEqual(["Kit Beat", "Kit Beat", "Kit Beat"]);
    // Restart acts on the 50 % copy; the other transport keys on the 100 % one (plan section 4).
    const transport = fadester.filter((entry) => entry.UUID.endsWith(".playlister-transport"))
      .map((entry) => [entry.Settings.operation, entry.Settings.inputName]);
    expect(transport).toEqual(expect.arrayContaining([["previous", "Kit Clips"], ["playpause", "Kit Clips"], ["next", "Kit Clips"], ["restart", "Kit Clips 50%"], ["status", "Kit Clips"]]));
    // No host, port or password in a profile (profiles/README.md).
    for (const entry of actions) expect(Object.keys(entry.Settings).filter((key) => /host|port|password|token|secret/i.test(key))).toEqual([]);
  });

  it("refuses a Playlister key on a source that is not a kit Playlister, or under another name", () => {
    expect(problemsAfter((p) => { action(p, "Clips", "Keypad", 1, 0).settings.inputUuid = uuidOf("Kit Motion"); }))
      .toEqual([expect.stringMatching(/Clips Keypad 1,0: inputUuid .* is not a kit Playlister/)]);
    expect(problemsAfter((p) => { action(p, "Clips", "Keypad", 1, 1).settings.inputName = "Kit Clips"; }))
      .toEqual([expect.stringMatching(/inputName 'Kit Clips' is not 'Kit Clips 50%'/)]);
  });

  it("refuses a filter control on a missing source, filter or kind, or a setting the deck does not ride", () => {
    expect(problemsAfter((p) => { action(p, "Visuals", "Keypad", 1, 0).settings.sourceUuid = "00000000-0000-4000-8000-000000000000"; }))
      .toEqual([expect.stringMatching(/is not a kit source/)]);
    expect(problemsAfter((p) => { action(p, "Visuals", "Keypad", 1, 0).settings.sourceName = "Kit Beat"; }))
      .toEqual([expect.stringMatching(/sourceName 'Kit Beat' is not 'Kit Motion'/)]);
    expect(problemsAfter((p) => { action(p, "Visuals", "Keypad", 2, 0).settings.filterName = "Look Spiral"; }))
      .toEqual([expect.stringMatching(/'Kit Motion' has no filter 'Look Spiral'/)]);
    expect(problemsAfter((p) => { action(p, "Layers", "Encoder", 0, 0).settings.filterKind = "color_filter"; }))
      .toEqual(expect.arrayContaining([expect.stringMatching(/filterKind 'color_filter' is not 'color_filter_v2'/)]));
    expect(problemsAfter((p) => { action(p, "Visuals", "Encoder", 1, 0).settings.setting = "vs_speed"; }))
      .toEqual(expect.arrayContaining([expect.stringMatching(/'vs_speed' is not a setting the deck rides/)]));
  });

  it("refuses a layer key whose scene item is not the source it names", () => {
    expect(problemsAfter((p) => { action(p, "Layers", "Keypad", 1, 0).settings.sceneItemId = 2; }))
      .toEqual([expect.stringMatching(/item 2 of 'Kit Layers' is 'Layer B'/)]);
    expect(problemsAfter((p) => { action(p, "Layers", "Keypad", 2, 0).settings.sceneName = "Kit Visuals"; }))
      .toEqual([expect.stringMatching(/item 2 of 'Kit Visuals' is 'Kit Beat'/)]);
    expect(problemsAfter((p) => { action(p, "Layers", "Keypad", 1, 0).settings.sceneName = "Layers"; }))
      .toEqual([expect.stringMatching(/sceneName 'Layers' is not a kit scene/)]);
    expect(problemsAfter((p) => { action(p, "Layers", "Keypad", 1, 0).settings.scope = "auto"; }))
      .toEqual([expect.stringMatching(/fixed scene and source/)]);
    expect(problemsAfter((p) => { action(p, "Layers", "Keypad", 2, 0).settings.target = "auto"; }))
      .toEqual([expect.stringMatching(/Layers Keypad 2,0: a kit layer key has a fixed scene and source/)]);
  });

  it("refuses a scene key past the kit's scenes, or captioned for another scene", () => {
    expect(problemsAfter((p) => {
      const entry = action(p, "Layers", "Keypad", 1, 1);
      entry.settings.sceneTarget = "__scene_index_5__";
      entry.label = "Scene 6";
    })).toEqual([expect.stringMatching(/'__scene_index_5__' is not __scene_index_N__ of a kit scene/)]);
    expect(problemsAfter((p) => { action(p, "Visuals", "Keypad", 0, 0).label = "Scene 3"; }))
      .toEqual([
        expect.stringMatching(/Visuals Keypad 0,0: a key to scene index 1 is captioned 'Scene 2'/),
        expect.stringMatching(/Visuals Keypad 0,0: caption 'Scene 3' is neither/)
      ]);
  });

  it("refuses a fader on a source that is not kit media, and a studio-mode kit", () => {
    expect(problemsAfter((p) => {
      const entry = action(p, "Visuals", "Encoder", 0, 0);
      entry.settings.inputName = "Kit Note";
      entry.label = "Kit Note";
    })).toEqual([expect.stringMatching(/inputName 'Kit Note' is not a kit media source/)]);
    expect(problemsAfter((p) => { p.obsMode = "studio"; })).toEqual([expect.stringMatching(/regular mode/)]);
  });

  it("refuses a custom caption, and an OBS name that is not the control's own target (plan section 15 item 1)", () => {
    expect(problemsAfter((p) => { action(p, "Visuals", "Encoder", 1, 0).label = "Prism mix"; }))
      .toEqual([expect.stringMatching(/caption 'Prism mix' is neither/)]);
    expect(problemsAfter((p) => { action(p, "Visuals", "Keypad", 1, 0).label = "Look Kaleido"; }))
      .toEqual([expect.stringMatching(/caption 'Look Kaleido' is neither/)]);
    expect(problemsAfter((p) => { action(p, "Visuals", "Keypad", 1, 0).label = "Look Prism"; })).toEqual([]);
    expect(problemsAfter((p) => { action(p, "Layers", "Keypad", 1, 0).label = "Layer A toggle"; }))
      .toEqual([expect.stringMatching(/caption 'Layer A toggle' is neither/)]);
  });

  it("the VJster page drives the OBS page: Slower, Faster, 1x, 0.5x, 2x, Play / pause and the SPEED dial", () => {
    const page = layouts.vjster;
    expect(kitSpeedProblems(page)).toEqual([]);
    expect([page.name, page.deviceType, page.model, page.columns, page.rows, page.dials]).toEqual(["Suite Demo Kit Speed +", 7, "20GBD9901", 4, 2, 4]);
    const keys = page.keys.map((slot) => [slot.kind, slot.settings?.direction ?? slot.settings?.rate ?? null, slot.settings?.step ?? null]);
    expect(keys).toEqual(expect.arrayContaining([["speed-step", -1, 0.25], ["speed-step", 1, 0.25], ["speed-preset", 1, null],
      ["speed-preset", 0.5, null], ["speed-preset", 2, null], ["transport", null, null]]));
    expect(keys).toHaveLength(6);
    expect(page.encoders.map((slot) => [slot.kind, slot.settings?.label])).toEqual([["speed", "SPEED"]]);
    const stored = storedActions(builtProfiles()[1]!.bytes);
    expect(stored).toHaveLength(7);
    for (const entry of stored) {
      expect(entry.Plugin.UUID).toBe("com.jbrick2070.vjster");
      expect(entry.Settings.target).toBe("obs");
    }
  });

  it("refuses a VJster action that does not drive the OBS page, and a VJster profile named for OBS or YouTube", () => {
    const page = clone(layouts.vjster);
    page.keys[3]!.settings = { target: "browser" };
    page.name = "Kit Speed for OBS +";
    expect(kitSpeedProblems(page)).toEqual([
      expect.stringMatching(/transport 3,0: target is not 'obs'/),
      expect.stringMatching(/names OBS or YouTube/)
    ]);
    expect(kitSpeedProblems({ ...layouts.vjster, name: "Kit youtube Speed +" })).toEqual([expect.stringMatching(/names OBS or YouTube/)]);
    expect(kitSpeedProblems({ ...layouts.vjster, name: "Kit Speed + (Robsons)" })).toEqual([]);
  });

  it("the build refuses a layout that fails validatePreset or the kit check", () => {
    const repeated = clone(kit);
    presetPages(repeated.layouts.fadester)[0]!.actions[1]!.column = 0;
    expect(() => buildKitProfiles(repeated)).toThrow(/repeated position/);
    const unbound = clone(kit);
    action(unbound.layouts.fadester, "Clips", "Keypad", 2, 0).settings.inputUuid = "";
    expect(() => buildKitProfiles(unbound)).toThrow(/do not match kit-ids\.json[\s\S]*not a kit Playlister/);
    expect(() => buildKitProfiles(kit, ["only one.streamDeckProfile"])).toThrow(/names 1 profiles/);
    // The VJster page's positions are checked by VJster's own builder (profileFiles calls validate).
    const twice = clone(kit);
    twice.layouts.vjster.keys[1]!.at = [0, 0];
    expect(() => buildKitProfiles(twice)).toThrow(/Keypad:0,0 is used twice/);
    const outside = clone(kit);
    outside.layouts.vjster.encoders[0]!.at = [4, 0];
    expect(() => buildKitProfiles(outside)).toThrow(/outside the 4x1 grid/);
  });
});
