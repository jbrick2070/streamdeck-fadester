// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { presetPages, type Preset } from "../scripts/profile-checks.js";
import { fits, buildPageProfile, profileNameFor, settingsFor, writeLayouts, type DeckSize } from "../scripts/opendeck/fadester-layouts.js";
import type { PluginManifest } from "../scripts/opendeck/opendeck.js";

const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "com.jbrick2070.fadester-for-obs.sdPlugin", "manifest.json"), "utf8")) as PluginManifest;
const presets = JSON.parse(readFileSync(join(root, "profiles", "layouts.json"), "utf8")) as Preset[];
const PLUS: DeckSize = { keys: 8, dials: 4 };
const KEYS15: DeckSize = { keys: 15, dials: 0 };
const MINI: DeckSize = { keys: 6, dials: 0 };

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "opendeck-fadester-"));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

describe("which layouts a deck gets", () => {
  it("offers each deck its own layouts and no other", () => {
    const names = (deck: DeckSize): string[] => presets.filter((p) => fits(p, deck)).map((p) => p.slug);
    expect(names(PLUS).every((slug) => slug.startsWith("plus-"))).toBe(true);
    expect(names(KEYS15).every((slug) => slug.startsWith("buttons-"))).toBe(true);
    expect(names(MINI)).toEqual(["mini-source-desk"]);
    expect(names(PLUS).length).toBeGreaterThan(5);
    expect(names({ keys: 32, dials: 0 })).toEqual([]);
  });
});

describe("every ready-made layout as an OpenDeck profile", () => {
  for (const preset of presets) {
    it(`${preset.slug} places every action on a slot of its own`, () => {
      const deck: DeckSize = { keys: preset.columns * preset.rows, dials: preset.dials };
      for (const page of presetPages(preset)) {
        const name = profileNameFor(preset, page, presetPages(preset).length);
        const { profile, placed, left } = buildPageProfile(preset, page, manifest, join(work, "plugin"), "sd-X", name, deck);
        const wanted = page.actions.filter((a) => a.kind !== "page");
        expect(placed).toBe(wanted.length);
        expect(profile.keys.filter(Boolean).length + profile.sliders.filter(Boolean).length).toBe(wanted.length);
        expect(left).toHaveLength(page.actions.length - wanted.length);
        expect(profile.keys).toHaveLength(deck.keys);
        expect(profile.sliders).toHaveLength(deck.dials);
      }
    });
  }
  it("puts a key at row * columns + column and a dial at its column, with the settings and caption", () => {
    const preset = presets.find((p) => p.slug === "plus-source-desk") as Preset;
    const page = presetPages(preset)[0];
    const { profile } = buildPageProfile(preset, page, manifest, join(work, "plugin"), "sd-X", "Fadester Source Desk +", PLUS);
    const music = page.actions.find((a) => a.label === "Music down")!;
    const slot = profile.keys[music.row * preset.columns + music.column]!;
    expect(slot.action.UUID).toBe("com.jbrick2070.fadester-for-obs.obs-fade");
    expect(slot.settings).toMatchObject({ inputName: "__audio_main__", to: 0, durationMs: 1000, labelOverride: "Music down" });
    expect(slot.context).toBe(`sd-X.Fadester Source Desk +.Keypad.${music.row * preset.columns + music.column}.0`);
    const dial = page.actions.find((a) => a.controller === "Encoder" && a.column === 2)!;
    expect(profile.sliders[2]?.settings).toMatchObject({ ...dial.settings, labelOverride: dial.label ?? "" });
  });
  it("leaves the rig's Next page keys empty and says so", () => {
    const rig = presets.find((p) => p.slug === "plus-vj-rig") as Preset;
    const pages = presetPages(rig);
    expect(pages.length).toBeGreaterThan(1);
    const built = buildPageProfile(rig, pages[0], manifest, join(work, "plugin"), "sd-X", "n", PLUS);
    expect(built.left).toHaveLength(1);
    expect(built.left[0]).toMatch(/OpenDeck switches profiles itself/);
  });
  it("adds the page's accent unless the action names its own", () => {
    const page = { name: "p", accent: "teal", actions: [] };
    expect(settingsFor({ controller: "Keypad", column: 0, row: 0, kind: "fade", label: "A", settings: {} }, page)).toEqual({ accent: "teal", labelOverride: "A" });
    expect(settingsFor({ controller: "Keypad", column: 0, row: 0, kind: "fade", settings: { accent: "red" } }, page)).toEqual({ accent: "red", labelOverride: "" });
    expect(settingsFor({ controller: "Keypad", column: 0, row: 0, kind: "fade", settings: {} }, { name: "p", accent: "default", actions: [] })).toEqual({ labelOverride: "" });
  });
  it("refuses a layout that reaches past the deck", () => {
    const preset = presets.find((p) => p.slug === "plus-source-desk") as Preset;
    expect(() => buildPageProfile(preset, presetPages(preset)[0], manifest, work, "sd-X", "n", { keys: 4, dials: 4 })).toThrow(/past the deck's last slot/);
  });
});

describe("profile names", () => {
  it("are safe file names with no dot, and one per page of a rig", () => {
    const rig = presets.find((p) => p.slug === "plus-vj-rig") as Preset;
    const names = presetPages(rig).map((page) => profileNameFor(rig, page, presetPages(rig).length));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).not.toMatch(/[<>:"/\\|?*.]/);
    expect(profileNameFor({ ...rig, name: "Fadester — Source Desk + (Either Mode)" }, { name: "x", actions: [] }, 1)).toBe("Fadester Source Desk + (Either Mode)");
  });
});

describe("writeLayouts", () => {
  const plugin = (): string => join(work, "plugin");
  it("writes one profile file per page beside the deck's others, and keeps what is already there", () => {
    const config = join(work, "opendeck");
    mkdirSync(join(config, "profiles", "sd-X"), { recursive: true });
    writeFileSync(join(config, "profiles", "sd-X", "Default.json"), "{}");
    const chosen = presets.filter((p) => fits(p, PLUS));
    const first = writeLayouts(config, "sd-X", chosen, manifest, plugin(), PLUS);
    const files = readdirSync(join(config, "profiles", "sd-X"));
    expect(files).toContain("Default.json");
    expect(first.every((w) => w.status === "written")).toBe(true);
    expect(files.length).toBe(1 + first.length);
    const edited = first[0].file;
    writeFileSync(edited, "edited by hand");
    const again = writeLayouts(config, "sd-X", chosen, manifest, plugin(), PLUS);
    expect(again.every((w) => w.status === "exists")).toBe(true);
    expect(readFileSync(edited, "utf8")).toBe("edited by hand");
  });
  it("writes valid profile JSON that OpenDeck can read back", () => {
    const config = join(work, "opendeck");
    const preset = presets.find((p) => p.slug === "mini-source-desk") as Preset;
    const [written] = writeLayouts(config, "sd-M", [preset], manifest, plugin(), MINI);
    const profile = JSON.parse(readFileSync(written.file, "utf8")) as { keys: unknown[]; sliders: unknown[] };
    expect(profile.keys).toHaveLength(6);
    expect(profile.sliders).toEqual([]);
    expect(existsSync(written.file)).toBe(true);
  });
});
