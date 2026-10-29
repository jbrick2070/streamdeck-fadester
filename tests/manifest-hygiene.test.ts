// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { profilePathForSlug, READY_LAYOUTS } from "../src/types/layouts.js";

const ROOT = process.cwd();
const PLUGIN_DIR = join(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin");

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "bin" ||
      entry.name === "release"
    ) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

describe("Step 1.1 — Manifest, Layout, Icons & Repository Hygiene", () => {
  it("validates manifest.json targets SDK 3, Node 24, Stream Deck 7.1, and direct plus optional actions", () => {
    const manifestPath = join(PLUGIN_DIR, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;

    expect(manifest.Name).toBe("Fadester for OBS");
    expect(manifest.Category).toBe("Fadester for OBS");
    const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const lockfile = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
    expect(manifest.Version).toBe(`${packageJson.version}.0`);
    expect(lockfile.version).toBe(packageJson.version);
    expect(lockfile.packages[""].version).toBe(packageJson.version);
    expect(manifest.SDKVersion).toBe(3);
    expect((manifest.Nodejs as { Version: string }).Version).toBe("24");
    expect((manifest.Software as { MinimumVersion: string }).MinimumVersion).toBe(
      "7.1"
    );

    const actions = manifest.Actions as Array<Record<string, unknown>>;
    expect(Array.isArray(actions)).toBe(true);
    expect(actions).toHaveLength(6);
    const byId = (id: string) => actions.find((entry) => entry.UUID === `com.jbrick2070.fadester-for-obs.${id}`)!;
    expect(actions.slice(0, 4).every((entry) => !String(entry.Name).includes("optional"))).toBe(true);
    expect(byId("fader").Controllers).toEqual(["Encoder"]);
    const encoderLayoutRel = (byId("fader").Encoder as { layout: string }).layout;
    expect(encoderLayoutRel).toBe("layouts/fader-cell.json");
    expect(statSync(join(PLUGIN_DIR, encoderLayoutRel)).size).toBeGreaterThan(0);
    expect(
      statSync(join(PLUGIN_DIR, String(byId("fader").PropertyInspectorPath))).size
    ).toBeGreaterThan(0);
    for (const shared of ["ui/pi-common.js", "ui/pi.css"]) {
      expect(statSync(join(PLUGIN_DIR, shared)).size).toBeGreaterThan(0);
    }
    expect(byId("auto-fade").Controllers).toEqual(["Keypad"]);
    expect(
      statSync(join(PLUGIN_DIR, String(byId("auto-fade").PropertyInspectorPath))).size
    ).toBeGreaterThan(0);
    expect(byId("obs-fader")).toMatchObject({
      UUID: "com.jbrick2070.fadester-for-obs.obs-fader",
      Controllers: ["Encoder"],
      PropertyInspectorPath: "ui/obs-fader-dial.html"
    });
    expect(byId("scene-transition")).toMatchObject({
      UUID: "com.jbrick2070.fadester-for-obs.scene-transition",
      Controllers: ["Keypad"],
      PropertyInspectorPath: "ui/obs-scene-transition-key.html"
    });
    expect(byId("obs-fade")).toMatchObject({
      UUID: "com.jbrick2070.fadester-for-obs.obs-fade",
      Controllers: ["Keypad"],
      PropertyInspectorPath: "ui/obs-fade-key.html"
    });
    expect(byId("layer-control")).toMatchObject({
      UUID: "com.jbrick2070.fadester-for-obs.layer-control",
      Controllers: ["Keypad", "Encoder"],
      PropertyInspectorPath: "ui/obs-layer-control.html"
    });
    for (const direct of actions.slice(2)) {
      expect(
        statSync(join(PLUGIN_DIR, String(direct.PropertyInspectorPath))).size
      ).toBeGreaterThan(0);
    }
  });

  it("bundles compatible editable layouts only on request and keeps ordinary source desks in fixed order", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf8"));
    const layouts = JSON.parse(readFileSync(join(ROOT, "profiles/layouts.json"), "utf8"));
    expect(manifest.Profiles).toHaveLength(layouts.length);
    expect(manifest.Profiles.map((profile: { Name: string }) => profile.Name).sort())
      .toEqual(READY_LAYOUTS.map((layout) => profilePathForSlug(layout.slug)).sort());
    for (const profile of manifest.Profiles) {
      expect(profile).toMatchObject({ AutoInstall: false, DontAutoSwitchWhenInstalled: true, Readonly: false });
      expect(statSync(join(PLUGIN_DIR, profile.Name + ".streamDeckProfile")).size).toBeGreaterThan(100);
    }
    for (const layout of layouts) {
      const bindings = new Set<string>();
      for (const entry of layout.actions) {
        const binding = JSON.stringify([
          entry.controller, entry.kind,
          Object.entries(entry.settings).sort(([left], [right]) => left.localeCompare(right))
        ]);
        expect(bindings.has(binding), `${layout.slug}: repeated binding for ${entry.label}`).toBe(false);
        bindings.add(binding);
        if (!layout.slug.includes("creative")) {
          expect(entry.settings.allowReorder).not.toBe(true);
          expect(["move_up", "move_down", "blend_next", "blend_previous", "blend_normal"])
            .not.toContain(entry.settings.operation);
        }
      }
    }
  });

  it("validates layouts/fader-cell.json defines a 200x100 full-canvas pixmap layout", () => {
    const layoutPath = join(PLUGIN_DIR, "layouts", "fader-cell.json");
    const layout = JSON.parse(readFileSync(layoutPath, "utf8")) as {
      controller: string;
      items: Array<{ key: string; type: string; rect: number[] }>;
    };

    expect(layout.controller).toBe("Encoder");
    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]).toMatchObject({
      key: "canvas",
      type: "pixmap",
      rect: [0, 0, 200, 100]
    });
  });

  it("verifies all icon files and LICENSE exist and are non-empty", () => {
    expect(statSync(join(ROOT, "LICENSE")).size).toBeGreaterThan(1000);
    const requiredFiles = [
      join(PLUGIN_DIR, "imgs", "plugin", "plugin-icon.png"),
      join(PLUGIN_DIR, "imgs", "plugin", "plugin-icon@2x.png"),
      join(PLUGIN_DIR, "imgs", "plugin", "category-icon.svg"),
      join(PLUGIN_DIR, "imgs", "actions", "fader", "icon.svg"),
      join(PLUGIN_DIR, "imgs", "actions", "fader", "key.svg"),
      join(PLUGIN_DIR, "imgs", "actions", "auto-fade", "icon.svg"),
      join(PLUGIN_DIR, "imgs", "actions", "auto-fade", "key.svg")
    ];
    for (const file of requiredFiles) {
      const st = statSync(file);
      expect(st.size).toBeGreaterThan(64);
    }
  });

  it("enforces UTF-8 no-BOM, zero 0-byte files, SPDX GPL-2.0-or-later headers, and no banned word", () => {
    const files = walkFiles(ROOT);
    const bannedWord = ["dum", "my"].join("");

    for (const file of files) {
      if (file.endsWith("START-PROMPT.md")) {
        continue;
      }
      const bytes = readFileSync(file);
      expect(bytes.length, `0-byte file: ${file}`).toBeGreaterThan(0);

      const hasBom =
        bytes.length >= 3 &&
        bytes[0] === 0xef &&
        bytes[1] === 0xbb &&
        bytes[2] === 0xbf;
      expect(hasBom, `BOM found in ${file}`).toBe(false);

      if (
        file.endsWith(".ts") ||
        file.endsWith(".js") ||
        file.endsWith(".mjs") ||
        file.endsWith(".css") ||
        file.endsWith(".html")
      ) {
        const text = bytes.toString("utf8");
        expect(
          text.includes("SPDX-License-Identifier: GPL-2.0-or-later"),
          `Missing SPDX header in ${file}`
        ).toBe(true);
        expect(
          text.toLowerCase().includes(bannedWord),
          `Banned word found in ${file}`
        ).toBe(false);
      }
    }
  });
});
