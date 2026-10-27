// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
  it("validates manifest.json targets SDK 3, Node 24, Stream Deck 7.1, and 2 launch actions", () => {
    const manifestPath = join(PLUGIN_DIR, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;

    expect(manifest.Name).toBe("Fadester for OBS");
    expect(manifest.Category).toBe("Fadester for OBS");
    expect(manifest.SDKVersion).toBe(3);
    expect((manifest.Nodejs as { Version: string }).Version).toBe("24");
    expect((manifest.Software as { MinimumVersion: string }).MinimumVersion).toBe(
      "7.1"
    );

    const actions = manifest.Actions as Array<Record<string, unknown>>;
    expect(Array.isArray(actions)).toBe(true);
    expect(actions).toHaveLength(2);
    expect(actions[0].UUID).toBe("com.jbrick2070.fadester-for-obs.fader");
    expect(actions[0].Controllers).toEqual(["Encoder"]);
    const encoderLayoutRel = (actions[0].Encoder as { layout: string }).layout;
    expect(encoderLayoutRel).toBe("layouts/fader-cell.json");
    expect(statSync(join(PLUGIN_DIR, encoderLayoutRel)).size).toBeGreaterThan(0);
    expect(
      statSync(join(PLUGIN_DIR, String(actions[0].PropertyInspectorPath))).size
    ).toBeGreaterThan(0);
    expect(actions[1].UUID).toBe("com.jbrick2070.fadester-for-obs.auto-fade");
    expect(actions[1].Controllers).toEqual(["Keypad"]);
    expect(
      statSync(join(PLUGIN_DIR, String(actions[1].PropertyInspectorPath))).size
    ).toBeGreaterThan(0);
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
