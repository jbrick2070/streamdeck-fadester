// SPDX-License-Identifier: GPL-2.0-or-later
// The Mac Fadester Companion speaks the Windows panel's 10 languages from one catalog:
// tourbox/panel/PanelText.cs + PanelExtraText.cs (shared strings) and tourbox/macos/panel/mac-strings.json
// (Mac-only strings), generated into PanelStrings.swift by make-strings.cjs.
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const generator = require("../tourbox/macos/panel/make-strings.cjs") as {
  catalog(): Map<string, string[]>;
  swift(table: Map<string, string[]>): string;
  LOCALES: string[];
  files: { out: string; mac: string };
};
const panel = join(__dirname, "..", "tourbox", "macos", "panel");
const sources = readdirSync(panel)
  .filter((name) => name.endsWith(".swift") && name !== "PanelStrings.swift")
  .map((name) => ({ name, text: readFileSync(join(panel, name), "utf8") }));

describe("Mac panel string catalog", () => {
  const table = generator.catalog();

  it("has the Windows panel's 10 languages for every string", () => {
    expect(generator.LOCALES).toEqual(["en", "es", "fr", "zh-CN", "de", "it", "ja", "ko", "ru", "zh-TW"]);
    for (const [key, row] of table) {
      expect(row, key).toHaveLength(10);
      for (const text of row) expect(text.trim(), key).not.toBe("");
    }
  });

  it("keeps PanelStrings.swift in sync with the Windows catalog and mac-strings.json", () => {
    const committed = readFileSync(generator.files.out, "utf8").replace(/\r\n/g, "\n");
    expect(committed, "run: node tourbox/macos/panel/make-strings.cjs").toBe(generator.swift(table));
  });

  it("has every key the Swift panel asks for", () => {
    const used = new Set<string>();
    for (const { text } of sources) for (const match of text.matchAll(/\bL\("([A-Za-z0-9]+)"/g)) used.add(match[1]);
    // Keys the panel builds at run time (assignment fields, D-pad directions, control map words, the meter).
    for (const key of ["musicInput", "contentInput", "micInput", "mediaInput", "overlayScene", "overlaySource",
      "layer1Scene", "layer1Source", "layer2Scene", "layer2Source", "musicStep", "duckCeiling", "fadeTicks", "timingStep", "opacityStep",
      "up", "right", "down", "left", "press", "select", "cw", "ccw", "on", "off", "obsUrlCopied", "obsUrlCopiedBlank",
      "vsMeterLocked", "vsMeterActive"]) used.add(key);
    expect(used.size).toBeGreaterThan(150);
    expect([...used].filter((key) => !table.has(key))).toEqual([]);
  });

  it("has no Mac-only string the panel no longer uses", () => {
    const mac = JSON.parse(readFileSync(generator.files.mac, "utf8")) as { strings: Record<string, string[]> };
    const all = sources.map((s) => s.text).join("\n");
    expect(Object.keys(mac.strings).filter((key) => !all.includes(`"${key}"`))).toEqual([]);
  });

  it("puts no fixed English on the panel's labels, buttons and headings", () => {
    const fixed = /\b(label|button|heading|subheading|paragraph|checkboxWithTitle:|withTitle:|NSButton\(title:)\s*\(?"[A-Za-z]/;
    for (const { name, text } of sources) {
      const lines = text.split(/\r?\n/).filter((line) => fixed.test(line));
      expect(lines, name).toEqual([]);
    }
  });
});
