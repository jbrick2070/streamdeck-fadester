// SPDX-License-Identifier: GPL-2.0-or-later
// VJster plugin package: manifest, files, settings page and bundled profiles
// (docs/vjster/PLAN.md Phase 1 step 5, D-12).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { LAYOUTS, profileFiles, stableUuid, validate, zip } from "../scripts/vjster/build-profiles.js";

const ROOT = process.cwd();
const PLUGIN = join(ROOT, "com.jbrick2070.vjster.sdPlugin");
const manifest = JSON.parse(readFileSync(join(PLUGIN, "manifest.json"), "utf8")) as {
  UUID: string;
  Name: string;
  Category: string;
  CategoryIcon: string;
  Icon: string;
  CodePath: string;
  SDKVersion: number;
  Software: { MinimumVersion: string };
  Actions: {
    UUID: string;
    Name: string;
    Icon: string;
    PropertyInspectorPath: string;
    Controllers: string[];
    Encoder?: { layout: string };
    States: { Image: string }[];
  }[];
  Profiles: { Name: string; DeviceType: number; AutoInstall: boolean; DontAutoSwitchWhenInstalled: boolean }[];
};

/** Entries of a ZIP archive, inflated. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const localNameLen = buf.readUInt16LE(local + 26);
    const data = buf.subarray(local + 30 + localNameLen, local + 30 + localNameLen + size);
    out.set(name, inflateRawSync(data));
    p += 46 + nameLen;
  }
  return out;
}

describe("plugin manifest (D-12, R-ID-2)", () => {
  it("is the standalone VJster plugin, with no OBS or YouTube in its name or ids", () => {
    expect(manifest).toMatchObject({ UUID: "com.jbrick2070.vjster", Name: "VJster", Category: "VJster", SDKVersion: 3, CodePath: "bin/plugin.js" });
    expect(manifest.Software.MinimumVersion).toBe("7.1");
    for (const a of manifest.Actions) {
      expect(a.UUID.startsWith("com.jbrick2070.vjster.")).toBe(true);
      expect(`${a.Name} ${a.UUID}`.toLowerCase()).not.toMatch(/obs|youtube|google/);
    }
  });

  it("names files that exist: icons, key images, settings page, strip layout", () => {
    const has = (rel: string, exts = [".svg", ".png"]) => exts.some((e) => existsSync(join(PLUGIN, rel + e))) || existsSync(join(PLUGIN, rel));
    expect(has(manifest.Icon)).toBe(true);
    expect(has(manifest.CategoryIcon)).toBe(true);
    for (const a of manifest.Actions) {
      expect(has(a.Icon), a.Icon).toBe(true);
      for (const s of a.States) expect(has(s.Image), s.Image).toBe(true);
      expect(existsSync(join(PLUGIN, a.PropertyInspectorPath)), a.PropertyInspectorPath).toBe(true);
      if (a.Controllers.includes("Encoder")) expect(existsSync(join(PLUGIN, a.Encoder?.layout ?? "missing")), a.UUID).toBe(true);
    }
  });

  it("has a class registered for every action, and an action for every class", () => {
    const source = readFileSync(join(ROOT, "src/vjster/plugin/actions.ts"), "utf8");
    const registered = [...source.matchAll(/@action\(\{ UUID: `\$\{UUID_PREFIX\}\.([a-z-]+)` \}\)/g)].map((m) => `com.jbrick2070.vjster.${m[1]}`);
    expect(registered.sort()).toEqual(manifest.Actions.map((a) => a.UUID).sort());
  });

  it("gives the settings page a field set for every action", () => {
    const js = readFileSync(join(PLUGIN, "ui/vjster.js"), "utf8");
    for (const a of manifest.Actions) {
      const kind = a.UUID.slice("com.jbrick2070.vjster.".length);
      expect(js.includes(`"${kind}":`) || js.includes(`    ${kind}:`), kind).toBe(true);
    }
  });

  it("uses one full-canvas pixmap for the touch strip", () => {
    const layout = JSON.parse(readFileSync(join(PLUGIN, "layouts/vjster-strip.json"), "utf8"));
    expect(layout).toMatchObject({ controller: "Encoder", items: [{ key: "canvas", type: "pixmap", rect: [0, 0, 200, 100] }] });
  });
});

describe("bundled profiles", () => {
  it("lists exactly the built layouts, installed without switching to them", () => {
    expect(manifest.Profiles.map((p) => [p.Name, p.DeviceType])).toEqual(LAYOUTS.map((l) => [`profiles/${l.file}`, l.deviceType]));
    for (const p of manifest.Profiles) expect(p).toMatchObject({ AutoInstall: true, DontAutoSwitchWhenInstalled: true });
  });

  it("puts every slot inside its grid, once, with an action that supports that controller", () => {
    for (const layout of LAYOUTS) {
      expect(() => validate(layout)).not.toThrow();
      const files = profileFiles(layout);
      expect(files).toHaveLength(3);
      const page = JSON.parse(files[1].data.toString("utf8"));
      const keys = page.Controllers.find((c: { Type: string }) => c.Type === "Keypad");
      expect(Object.keys(keys.Actions ?? {})).toHaveLength(layout.keys.length);
    }
    const bad = { ...LAYOUTS[0], keys: [...LAYOUTS[0].keys, { kind: "pin" as const, at: [4, 0] as [number, number] }] };
    expect(() => validate(bad)).toThrow("outside");
    const twice = { ...LAYOUTS[0], keys: [...LAYOUTS[0].keys, LAYOUTS[0].keys[0]] };
    expect(() => validate(twice)).toThrow("twice");
  });

  it("keeps the committed profile files equal to a fresh build, and they unzip to the expected pages", () => {
    for (const layout of LAYOUTS) {
      const built = zip(profileFiles(layout));
      const committed = readFileSync(join(PLUGIN, "profiles", `${layout.file}.streamDeckProfile`));
      expect(committed.equals(built), `${layout.file} is stale: run scripts/vjster/build-profiles.ts`).toBe(true);
      const entries = unzip(committed);
      const top = JSON.parse([...entries.entries()].find(([n]) => n.endsWith(".sdProfile/manifest.json"))![1].toString("utf8"));
      expect(top).toMatchObject({ Name: layout.name, Device: { Model: layout.model }, Version: "3.0" });
      expect(entries.size).toBe(3);
    }
  });

  it("makes stable, well-formed ids", () => {
    const id = stableUuid("a", "b");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableUuid("a", "b")).toBe(id);
    expect(stableUuid("a", "c")).not.toBe(id);
  });

  it("gives the Stream Deck + layout four dials: speed, nudge, quality and FX speed", () => {
    const plus = LAYOUTS.find((l) => l.deviceType === 7)!;
    expect(plus.encoders.map((e) => [e.kind, (e.settings as { label?: string }).label])).toEqual([
      ["speed", "SPEED"],
      ["speed", "NUDGE"],
      ["quality", "QUALITY"],
      ["speed", "FX SPEED"]
    ]);
  });
});
