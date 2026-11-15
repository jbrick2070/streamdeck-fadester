// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { profilePathForSlug, READY_LAYOUTS } from "../src/types/layouts.js";
import { Preset, presetPages } from "../scripts/profile-checks.js";

const ROOT = process.cwd();
const PLUGIN_DIR = join(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin");

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const tourboxRoot = join(ROOT, "tourbox");
    if (entry.isDirectory() && (full === join(tourboxRoot, "dist") ||
        (entry.name === "obj" && full.startsWith(tourboxRoot + sep)) ||
        (entry.name === "build" && full.startsWith(join(tourboxRoot, "macos") + sep)))) continue;
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "bin" ||
      entry.name === "release"
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

describe("Step 1.1 — Manifest, Layout, Icons & Repository Hygiene", () => {
  it("validates manifest.json targets SDK 3, Node 24, Stream Deck 7.6, and direct plus optional actions", () => {
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
      "7.6"
    );

    const actions = manifest.Actions as Array<Record<string, unknown>>;
    expect(Array.isArray(actions)).toBe(true);
    // Fadester's eleven (the last two optional), then VJster's seven, which the suite assembly adds (scripts/suite/assemble.ts).
    expect(actions).toHaveLength(18);
    const byId = (id: string) => actions.find((entry) => entry.UUID === `io.github.jbrick2070.fadester-for-obs.${id}`)!;
    expect(actions.slice(0, 9).every((entry) => !String(entry.Name).includes("optional"))).toBe(true);
    expect(actions.slice(9, 11).every((entry) => String(entry.Name).includes("optional"))).toBe(true);
    expect(actions.slice(11).map((entry) => entry.UUID)).toEqual(
      ["speed", "quality", "speed-preset", "speed-step", "quality-preset", "pin", "transport"].map((kind) => `io.github.jbrick2070.fadester-for-obs.vjster-${kind}`)
    );
    expect(actions.slice(11).every((entry) => String(entry.Name).startsWith("VJster "))).toBe(true);
    // The VJ rig's actions (PLAN.md 10.4, P1-3), before the two optional ones.
    expect(byId("obs-filter")).toMatchObject({
      Controllers: ["Keypad", "Encoder"],
      SupportedInMultiActions: false,
      PropertyInspectorPath: "ui/obs-filter.html",
      Icon: "imgs/actions/obs-filter/icon",
      States: [{ Image: "imgs/actions/obs-filter/key" }]
    });
    expect(Object.keys((byId("obs-filter").Encoder as { TriggerDescription: Record<string, string> }).TriggerDescription)).toEqual(["Rotate", "Push"]);
    expect(byId("visual-panic")).toMatchObject({
      Controllers: ["Keypad"],
      SupportedInMultiActions: false,
      PropertyInspectorPath: "ui/visual-panic.html",
      Icon: "imgs/actions/visual-panic/icon",
      States: [{ Image: "imgs/actions/visual-panic/key" }]
    });
    expect(byId("visual-meter")).toMatchObject({
      Controllers: ["Keypad", "Encoder", "Neo"],
      SupportedInMultiActions: false,
      PropertyInspectorPath: "ui/visual-meter.html",
      Icon: "imgs/actions/visual-meter/icon",
      States: [{ Image: "imgs/actions/visual-meter/key" }]
    });
    expect(Object.keys((byId("visual-meter").Encoder as { TriggerDescription: Record<string, string> }).TriggerDescription)).toEqual(["Rotate", "Push"]);
    for (const folder of ["obs-filter", "visual-panic", "visual-meter"]) {
      for (const icon of ["icon", "key"]) {
        expect(statSync(join(PLUGIN_DIR, "imgs", "actions", folder, `${icon}.svg`)).size).toBeGreaterThan(64);
      }
    }
    expect(byId("playlister-transport")).toMatchObject({
      Controllers: ["Keypad"],
      SupportedInMultiActions: false,
      PropertyInspectorPath: "ui/playlister-transport-key.html",
      Icon: "imgs/actions/playlister-transport/icon",
      States: [{ Image: "imgs/actions/playlister-transport/key" }]
    });
    for (const icon of ["icon", "key"]) {
      expect(statSync(join(PLUGIN_DIR, "imgs", "actions", "playlister-transport", `${icon}.svg`)).size).toBeGreaterThan(64);
    }
    expect(byId("fader").Controllers).toEqual(["Encoder"]);
    const encoderLayoutRel = (byId("fader").Encoder as { layout: string }).layout;
    expect(encoderLayoutRel).toBe("layouts/fader-cell.json");
    expect(statSync(join(PLUGIN_DIR, encoderLayoutRel)).size).toBeGreaterThan(0);
    for (const entry of actions.filter((action) => (action.Controllers as string[]).includes("Encoder"))) {
      const layout = (entry.Encoder as { layout: string }).layout;
      // Fadester's dials share one cell layout; VJster's two dials draw their own strip (docs/vjster/PLAN.md step 5).
      const wanted = String(entry.UUID).includes(".vjster-") ? "layouts/vjster-strip.json" : "layouts/fader-cell.json";
      expect(layout, `Encoder layout for ${entry.Name}`).toBe(wanted);
      expect(statSync(join(PLUGIN_DIR, layout)).size).toBeGreaterThan(0);
    }
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
      UUID: "io.github.jbrick2070.fadester-for-obs.obs-fader",
      Controllers: ["Encoder"],
      PropertyInspectorPath: "ui/obs-fader-dial.html"
    });
    expect(byId("scene-transition")).toMatchObject({
      UUID: "io.github.jbrick2070.fadester-for-obs.scene-transition",
      Controllers: ["Keypad"],
      PropertyInspectorPath: "ui/obs-scene-transition-key.html"
    });
    expect(byId("obs-fade")).toMatchObject({
      UUID: "io.github.jbrick2070.fadester-for-obs.obs-fade",
      Controllers: ["Keypad"],
      PropertyInspectorPath: "ui/obs-fade-key.html"
    });
    expect(byId("layer-control")).toMatchObject({
      UUID: "io.github.jbrick2070.fadester-for-obs.layer-control",
      Controllers: ["Keypad", "Encoder"],
      PropertyInspectorPath: "ui/obs-layer-control.html"
    });
    expect(byId("obs-neo-infobar")).toMatchObject({
      Controllers: ["Neo"],
      PropertyInspectorPath: "ui/obs-neo-infobar.html"
    });
    expect(statSync(join(PLUGIN_DIR, "ui/obs-neo-infobar.html")).size).toBeGreaterThan(0);
    for (const direct of actions.slice(2)) {
      expect(
        statSync(join(PLUGIN_DIR, String(direct.PropertyInspectorPath))).size
      ).toBeGreaterThan(0);
    }
  });

  it("defines all feedback fields within the Neo Info Bar bounds", () => {
    const layout = JSON.parse(readFileSync(join(PLUGIN_DIR, "layouts", "obs-neo-infobar.json"), "utf8")) as {
      controller: string;
      items: Array<{ key: string; type: string; rect: number[] }>;
    };
    expect(layout.controller).toBe("Neo");
    for (const key of ["live", "preview", "status"]) {
      expect(layout.items.filter((item) => item.key === key)).toEqual([
        expect.objectContaining({ type: "text" })
      ]);
    }
    for (const item of layout.items) {
      const [x, y, width, height] = item.rect;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(x + width).toBeLessThanOrEqual(232);
      expect(y + height).toBeLessThanOrEqual(50);
    }
    const meterNeo = JSON.parse(readFileSync(join(PLUGIN_DIR, "layouts", "visual-meter-neo.json"), "utf8")) as {
      controller: string;
      items: Array<{ key: string; type: string; rect: number[] }>;
    };
    expect(meterNeo.controller).toBe("Neo");
    expect(meterNeo.items).toEqual([
      expect.objectContaining({ key: "canvas", type: "pixmap", rect: [0, 0, 232, 50] })
    ]);
  });

  it("bundles compatible editable layouts only on request and keeps ordinary source desks in fixed order", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf8"));
    const layouts = JSON.parse(readFileSync(join(ROOT, "profiles/layouts.json"), "utf8")) as Preset[];
    expect(manifest.Profiles).toHaveLength(layouts.length);
    expect(manifest.Profiles.map((profile: { Name: string }) => profile.Name).sort())
      .toEqual(READY_LAYOUTS.map((layout) => profilePathForSlug(layout.slug)).sort());
    for (const profile of manifest.Profiles) {
      expect(profile).toMatchObject({ AutoInstall: false, DontAutoSwitchWhenInstalled: true, Readonly: false });
      expect(statSync(join(PLUGIN_DIR, profile.Name + ".streamDeckProfile")).size).toBeGreaterThan(100);
    }
    for (const layout of layouts) {
      // A rig repeats Panic, Restore and Next page on purpose, page after page: bindings are unique per page.
      for (const page of presetPages(layout)) {
        const bindings = new Set<string>();
        for (const entry of page.actions) {
          const binding = JSON.stringify([
            entry.controller, entry.kind,
            Object.entries(entry.settings).sort(([left], [right]) => left.localeCompare(right))
          ]);
          // In the VJ rig only, unbound filter controls are placeholders told apart by their captions (Look 1,
          // Look 2); everywhere else, and for every Playlister key, a repeated binding is an error.
          const placeholder = layout.slug.includes("vj-rig") && entry.kind === "filter" && entry.settings.sourceUuid === "";
          expect(bindings.has(binding) && !placeholder, `${layout.slug} / ${page.name}: repeated binding for ${entry.label}`).toBe(false);
          bindings.add(binding);
          // Layer order and blend modes belong to the creative labs and the VJ rig only.
          if (!layout.slug.includes("creative") && !layout.slug.includes("vj-rig")) {
            expect(entry.settings.allowReorder).not.toBe(true);
            expect(["move_up", "move_down", "blend_next", "blend_previous", "blend_normal"])
              .not.toContain(entry.settings.operation);
          }
          // The rig allows blend changes, never layer reordering.
          if (layout.slug.includes("vj-rig")) {
            expect(entry.settings.allowReorder).not.toBe(true);
            expect(["move_up", "move_down"]).not.toContain(entry.settings.operation);
          }
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

      // Google's site verification file has to stay exactly as Google issued it.
      if (/[\\/]google[0-9a-f]{16}\.html$/.test(file)) continue;

      if (
        file.endsWith(".ts") ||
        file.endsWith(".mts") ||
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
