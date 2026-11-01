// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEXT_PAGE_ACTION,
  PAGE_PLUGIN,
  PluginManifest,
  Preset,
  buildProfile,
  changesProgram,
  checkRigRules,
  presetPages,
  validatePreset,
  zip
} from "../scripts/profile-checks.js";
import { READY_LAYOUTS, profilePathForSlug } from "../src/types/layouts.js";
import { PLUGIN_DIR } from "./helpers/languages.js";

/**
 * The VJ rig profiles (PLAN.md 10.6, R-RIG-7): four pages each, Panic on one
 * key on every page with nothing that changes Program beside it, Elgato's
 * Next page key in its exact shape, and a byte-stable build.
 */
const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf8")) as PluginManifest;
const presets = JSON.parse(readFileSync("profiles/layouts.json", "utf8")) as Preset[];
const rigs = presets.filter((preset) => preset.slug.includes("vj-rig"));
const clone = (preset: Preset): Preset => JSON.parse(JSON.stringify(preset)) as Preset;

describe("VJ rig profiles", () => {
  it("ships a Stream Deck + rig and a 15-key rig, Studio Mode, four pages each, in the picker", () => {
    expect(rigs.map((rig) => [rig.slug, rig.deviceType, rig.obsMode, presetPages(rig).map((page) => page.name)])).toEqual([
      ["plus-vj-rig", 7, "studio", ["Perform", "Layers", "Visuals", "Scenes"]],
      ["buttons-vj-rig", 0, "studio", ["Perform", "Layers", "Visuals", "Scenes"]]
    ]);
    expect(rigs.map((rig) => presetPages(rig).map((page) => page.accent ?? "default"))).toEqual([
      ["brass", "teal", "magenta", "default"], ["brass", "teal", "magenta", "default"]
    ]);
    for (const rig of rigs) expect(READY_LAYOUTS.some((layout) => layout.slug === rig.slug && layout.obsMode === "studio")).toBe(true);
  });

  it.each(rigs.map((rig) => [rig.slug, rig] as const))("%s holds Panic and Next page on their keys on every page, nothing that changes Program beside Panic", (_slug, rig) => {
    const [panicColumn, panicRow] = rig.rig!.panic;
    const [nextColumn, nextRow] = rig.rig!.nextPage;
    // Panic bottom right, Next page bottom left (PLAN.md 10).
    expect([panicColumn, panicRow]).toEqual([rig.columns - 1, rig.rows - 1]);
    expect([nextColumn, nextRow]).toEqual([0, rig.rows - 1]);
    for (const page of presetPages(rig)) {
      const key = (column: number, row: number) => page.actions.find((entry) => entry.controller === "Keypad" && entry.column === column && entry.row === row);
      expect(key(panicColumn, panicRow), page.name).toMatchObject({ kind: "panic", label: "PANIC", settings: { operation: "panic" } });
      expect(key(nextColumn, nextRow), page.name).toMatchObject({ kind: "page", settings: {} });
      expect(key(nextColumn, nextRow)!.label, page.name).toBeUndefined();
      for (const entry of page.actions.filter((candidate) => candidate.controller === "Keypad")) {
        const beside = Math.abs(entry.column - panicColumn) <= 1 && Math.abs(entry.row - panicRow) <= 1;
        const program = entry.kind === "scene" && ["cut", "transition"].includes(String(entry.settings.operation));
        expect(beside && program, `${page.name}: ${entry.label} at ${entry.column},${entry.row}`).toBe(false);
      }
      // Every key and every dial is in use (a full rig).
      expect(page.actions.filter((entry) => entry.controller === "Keypad")).toHaveLength(rig.columns * rig.rows);
      expect(page.actions.filter((entry) => entry.controller === "Encoder")).toHaveLength(rig.dials);
    }
    // The 15-key rig keeps Restore on every page too.
    if (rig.slug === "buttons-vj-rig") {
      for (const page of presetPages(rig)) {
        expect(page.actions.find((entry) => entry.column === 4 && entry.row === 1), page.name).toMatchObject({ kind: "panic", settings: { operation: "restore" } });
      }
    }
    expect(() => validatePreset(rig, manifest)).not.toThrow();
  });

  it("refuses a page without Panic, Panic moved, Next page missing, and a Cut or Transition beside Panic", () => {
    const rig = rigs[0]!;
    const withoutPanic = clone(rig);
    withoutPanic.pages![2]!.actions = withoutPanic.pages![2]!.actions.filter((entry) => !(entry.kind === "panic" && entry.settings.operation === "panic"));
    expect(() => checkRigRules(withoutPanic)).toThrow(/Visuals: Panic must sit on key 3,1/);
    const restoreThere = clone(rig);
    const panicKey = restoreThere.pages![1]!.actions.find((entry) => entry.kind === "panic")!;
    panicKey.settings = { operation: "restore" };
    expect(() => checkRigRules(restoreThere)).toThrow(/Layers: Panic must sit/);
    const noNextPage = clone(rig);
    noNextPage.pages![3]!.actions = noNextPage.pages![3]!.actions.filter((entry) => entry.kind !== "page");
    expect(() => checkRigRules(noNextPage)).toThrow(/Scenes: Next page must sit on key 0,1/);
    for (const operation of ["cut", "transition"]) {
      const cutBeside = clone(rig);
      const neighbour = cutBeside.pages![0]!.actions.find((entry) => entry.controller === "Keypad" && entry.column === 2 && entry.row === 1)!;
      Object.assign(neighbour, { kind: "scene", label: "Cut preview", settings: { sceneTarget: "__current_preview__", operation } });
      expect(() => checkRigRules(cutBeside), operation).toThrow(/changes Program next to Panic/);
      expect(changesProgram(neighbour)).toBe(true);
    }
    // A Preview key beside Panic is fine: it does not change Program.
    const previewBeside = clone(rig);
    Object.assign(previewBeside.pages![0]!.actions.find((entry) => entry.controller === "Keypad" && entry.column === 2 && entry.row === 1)!,
      { kind: "scene", label: "Next scene", settings: { sceneTarget: "__next_scene__", operation: "preview" } });
    expect(() => checkRigRules(previewBeside)).not.toThrow();
  });

  it.each(rigs.map((rig) => [rig.slug, rig] as const))("%s writes four pages with Elgato's Next page key in its exact shape, byte for byte the same each build", (_slug, rig) => {
    const built = buildProfile(rig, manifest);
    const again = buildProfile(rig, manifest);
    expect(zip(again.files).equals(zip(built.files))).toBe(true);
    // The bundled archive is this build.
    expect(readFileSync(join(PLUGIN_DIR, `${profilePathForSlug(rig.slug)}.streamDeckProfile`)).equals(zip(built.files))).toBe(true);
    const root = JSON.parse(built.files[0]!.content) as { Name: string; Pages: { Current: string; Default: string; Pages: string[] }; Version: string };
    expect(root.Name).toBe(rig.name);
    expect(root.Version).toBe("3.0");
    expect(root.Pages.Pages).toHaveLength(4);
    expect(new Set(root.Pages.Pages).size).toBe(4);
    expect(root.Pages.Current).toBe(root.Pages.Pages[0]);
    expect(root.Pages.Pages).not.toContain(root.Pages.Default);
    // Root, four pages, the default page.
    expect(built.files).toHaveLength(6);
    const pages = built.files.slice(1, 5).map((file) => JSON.parse(file.content) as {
      Name: string; Controllers: Array<{ Type: string; Actions: Record<string, Record<string, unknown>> | null }>;
    });
    expect(pages.map((page) => page.Name)).toEqual(["Perform", "Layers", "Visuals", "Scenes"]);
    const nextKey = `${rig.rig!.nextPage[0]},${rig.rig!.nextPage[1]}`;
    const actionIds = new Set<string>();
    pages.forEach((page, index) => {
      const keys = page.Controllers.find((controller) => controller.Type === "Keypad")!.Actions!;
      const { ActionID, ...pageKey } = keys[nextKey]!;
      expect(pageKey).toEqual({
        LinkedTitle: true, Name: "Next Page", Plugin: { ...PAGE_PLUGIN }, Resources: null, Settings: {}, State: 0, States: [{}], UUID: NEXT_PAGE_ACTION
      });
      expect(PAGE_PLUGIN).toEqual({ Name: "Pages", UUID: "com.elgato.streamdeck.page", Version: "1.0" });
      for (const controller of page.Controllers) {
        for (const [position, action] of Object.entries(controller.Actions ?? {})) {
          expect(actionIds.has(String(action.ActionID)), `${index} ${position}`).toBe(false);
          actionIds.add(String(action.ActionID));
          if (action.UUID === NEXT_PAGE_ACTION) continue;
          // Every Fadester control carries its page's accent and its caption; none is bound to the author's OBS.
          const settings = action.Settings as Record<string, unknown>;
          const accent = presetPages(rig)[index]!.accent;
          if (accent) expect(settings.accent, `${index} ${position}`).toBe(accent);
          else expect(settings).not.toHaveProperty("accent");
          expect(typeof settings.labelOverride).toBe("string");
          if ("sourceUuid" in settings) expect(settings.sourceUuid).toBe("");
          if ("inputUuid" in settings) expect(settings.inputUuid).toBe("");
          expect((action.Plugin as { UUID: string }).UUID).toBe(manifest.UUID);
        }
      }
    });
    // Keys and dials in use count the busiest page.
    expect(built.catalogEntry).toMatchObject({ keysUsed: rig.columns * rig.rows, dialsUsed: rig.dials, pages: ["Perform", "Layers", "Visuals", "Scenes"] });
    expect(manifest as unknown as { Profiles: Array<{ Name: string }> }).toHaveProperty("Profiles");
    expect((manifest as unknown as { Profiles: Array<{ Name: string }> }).Profiles.map((profile) => profile.Name)).toContain(built.path);
  });

  it("builds a one-page profile as before (its page and action identities unchanged)", () => {
    const scene = presets.find((preset) => preset.slug === "plus-scene-desk")!;
    const built = buildProfile(scene, manifest);
    expect(readFileSync(join(PLUGIN_DIR, `${profilePathForSlug(scene.slug)}.streamDeckProfile`)).equals(zip(built.files))).toBe(true);
    expect(built.files).toHaveLength(3);
    expect(built.catalogEntry).not.toHaveProperty("pages");
  });
});
