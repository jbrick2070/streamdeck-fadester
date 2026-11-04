// SPDX-License-Identifier: GPL-2.0-or-later
// VJster inside the Fadester plugin (docs/SUITE.md): the generated files are current, every path the suite manifest names exists,
// every language says the seven new actions, and the assembly repairs a folder that has drifted.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LANGUAGES, assemble, differences, wanted } from "../scripts/suite/assemble.js";
import { VJSTER_KINDS, suiteActionId } from "../src/suite/actions.js";

const ROOT = join(import.meta.dirname, "..");
const SUITE = join(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin");
const VJSTER = join(ROOT, "com.jbrick2070.vjster.sdPlugin");
const read = (path: string): { Actions: Array<Record<string, unknown>> } & Record<string, unknown> => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the two plugin folders (sources only), for a test that breaks things. */
function copyOfPlugins(): string {
  const dir = mkdtempSync(join(tmpdir(), "suite-assemble-"));
  temps.push(dir);
  for (const folder of ["com.jbrick2070.fadester-for-obs.sdPlugin", "com.jbrick2070.vjster.sdPlugin"]) {
    cpSync(join(ROOT, folder), join(dir, folder), { recursive: true, filter: (from) => !/[\\/](bin|logs)([\\/]|$)/.test(from.slice(join(ROOT, folder).length)) });
  }
  return dir;
}

describe("the suite plugin's generated files", () => {
  it("are current (run npm run suite:assemble)", () => {
    expect(differences(ROOT)).toEqual([]);
  });

  it("add VJster's seven actions to the manifest under the suite's ids, named VJster first", () => {
    const manifest = read(join(SUITE, "manifest.json"));
    const added = manifest.Actions.filter((action) => String(action.UUID).startsWith(suiteActionId("")));
    expect(added.map((action) => action.UUID)).toEqual(VJSTER_KINDS.map((kind) => suiteActionId(kind)));
    expect(added.every((action) => String(action.Name).startsWith("VJster "))).toBe(true);
    expect(new Set(manifest.Actions.map((action) => action.UUID)).size).toBe(manifest.Actions.length);
    // Stream Deck wants every action id to start with the plugin's own.
    for (const action of manifest.Actions) expect(String(action.UUID).startsWith(`${manifest.UUID}.`)).toBe(true);
  });

  it("name only files that exist: icons, key images, settings pages and strip layouts", () => {
    const manifest = read(join(SUITE, "manifest.json"));
    for (const action of manifest.Actions) {
      expect(existsSync(join(SUITE, `${action.Icon as string}.svg`)), `${action.UUID} icon`).toBe(true);
      for (const state of action.States as Array<{ Image: string }>) expect(existsSync(join(SUITE, `${state.Image}.svg`)), `${action.UUID} key`).toBe(true);
      expect(existsSync(join(SUITE, action.PropertyInspectorPath as string)), `${action.UUID} page`).toBe(true);
      const encoder = action.Encoder as { layout?: string } | undefined;
      if (encoder?.layout) expect(existsSync(join(SUITE, encoder.layout)), `${action.UUID} layout`).toBe(true);
    }
  });

  it("are said in every language that has manifest texts, and the VJster plugin's own files sit beside it", () => {
    for (const language of LANGUAGES) {
      const file = read(join(SUITE, `${language}.json`)) as Record<string, unknown>;
      const textual = Object.keys(file).some((key) => key !== "Localization");
      for (const kind of VJSTER_KINDS) {
        if (textual) expect(String((file[suiteActionId(kind)] as { Name?: string })?.Name ?? ""), `${language} ${kind}`).toMatch(/^VJster .+/);
        else expect(file, `${language} holds Localization only (D-L4)`).not.toHaveProperty(suiteActionId(kind));
      }
      expect(readFileSync(join(SUITE, "vjster", `${language}.json`), "utf8")).toBe(readFileSync(join(VJSTER, `${language}.json`), "utf8"));
    }
  });

  it("give the VJster plugin its own manifest where it starts, because the SDK reads manifest.json from there", () => {
    expect(readFileSync(join(SUITE, "vjster", "manifest.json"), "utf8")).toBe(readFileSync(join(VJSTER, "manifest.json"), "utf8"));
    expect(read(join(SUITE, "vjster", "manifest.json")).Actions.map((action) => action.UUID)).toEqual(read(join(VJSTER, "manifest.json")).Actions.map((action) => action.UUID));
  });
});

describe("the assembly", () => {
  it("lists what has drifted and puts it right", () => {
    const dir = copyOfPlugins();
    expect(differences(dir)).toEqual([]);
    rmSync(join(dir, "com.jbrick2070.fadester-for-obs.sdPlugin", "imgs", "actions", "vjster-pin", "key.svg"));
    writeFileSync(join(dir, "com.jbrick2070.fadester-for-obs.sdPlugin", "ui", "vjster", "vjster.css"), "changed");
    const manifestPath = join(dir, "com.jbrick2070.fadester-for-obs.sdPlugin", "manifest.json");
    const manifest = read(manifestPath);
    manifest.Actions = manifest.Actions.filter((action) => !String(action.UUID).endsWith("vjster-transport"));
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    expect(differences(dir).sort()).toEqual(["imgs/actions/vjster-pin/key.svg", "manifest.json", "ui/vjster/vjster.css"]);
    expect(assemble(dir).sort()).toEqual(["imgs/actions/vjster-pin/key.svg", "manifest.json", "ui/vjster/vjster.css"]);
    expect(differences(dir)).toEqual([]);
    expect(assemble(dir)).toEqual([]);
  });

  it("owns exactly forty files, all inside the suite plugin's folder", () => {
    const files = wanted(ROOT);
    expect([...files.keys()].every((path) => !path.startsWith("../"))).toBe(true);
    expect(files.has("manifest.json")).toBe(true);
    // The manifest, VJster's manifest, two language files for each of nine languages, fourteen images, the layout, and five page files.
    expect(files.size).toBe(40);
  });

  it("stops, rather than guess, when VJster's settings page changes shape", () => {
    const dir = copyOfPlugins();
    const page = join(dir, "com.jbrick2070.vjster.sdPlugin", "ui", "vjster.html");
    writeFileSync(page, readFileSync(page, "utf8").replace('<script src="vjster.js"></script>', '<script src="other.js"></script>'));
    expect(() => differences(dir)).toThrow(/vjster\.js/);
  });

  it("keeps Fadester's own actions exactly as they were", () => {
    const manifest = read(join(SUITE, "manifest.json"));
    const own = manifest.Actions.filter((action) => !String(action.UUID).startsWith(suiteActionId("")));
    expect(own).toHaveLength(10);
    expect(own[0].UUID).toBe("com.jbrick2070.fadester-for-obs.obs-neo-infobar");
  });
});
