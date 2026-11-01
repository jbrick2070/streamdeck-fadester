// SPDX-License-Identifier: GPL-2.0-or-later
// VJster's Stream Deck language files (docs/vjster/REQUIREMENTS.md R-I18N-1,
// R-I18N-3, R-I18N-5; PLAN.md 8.3): every required language is there, every
// file is UTF-8 JSON without a BOM, has every text English has and no other,
// with the same placeholders, and English matches the manifest and the
// built-in deck words. Stream Deck's own `streamdeck validate` does not read
// these files, so this test does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN, placeholders } from "../src/vjster/plugin/strings.js";
import { deckLanguageFiles, localization, LOCALIZATION_ONLY, PLUGIN_DIR, REQUIRED } from "./vjster-languages.js";

/** Every text in a file by its path (`Localization.pi.port`), `_comment` entries left out. */
function texts(value: unknown, path = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "_comment") continue;
      for (const [p, t] of texts(v, path ? `${path}\u0000${k}` : k)) out.set(p, t);
    }
  } else out.set(path, value);
  return out;
}

const files = deckLanguageFiles();
const en = files.find((f) => f.lang === "en");
const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf8")) as {
  Name: string;
  Description: string;
  Category: string;
  Actions: { UUID: string; Name: string; Tooltip: string; Encoder?: { TriggerDescription?: Record<string, string> } }[];
};

describe("Stream Deck language files (R-I18N-5)", () => {
  it("has every required language", () => {
    expect(files.map((f) => f.lang)).toEqual(expect.arrayContaining([...REQUIRED.deck]));
  });

  it("matches the manifest and the built-in deck words in English", () => {
    expect(en).toBeDefined();
    const want: Record<string, unknown> = { Name: manifest.Name, Description: manifest.Description, Category: manifest.Category };
    for (const a of manifest.Actions) {
      want[a.UUID] = { Name: a.Name, Tooltip: a.Tooltip, ...(a.Encoder?.TriggerDescription ? { Encoder: { TriggerDescription: a.Encoder.TriggerDescription } } : {}) };
    }
    const { Localization: loc, ...top } = en!.json;
    expect(top).toEqual(want);
    const words = Object.fromEntries(Object.entries(loc as Record<string, unknown>).filter(([k]) => k !== "_comment" && k !== "pi"));
    expect(words).toEqual({ ...EN });
  });

  for (const f of files) {
    it(`${f.lang}.json is UTF-8 JSON without a BOM, with every English text and the same placeholders`, () => {
      expect(f.bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
      expect(Buffer.from(f.bytes.toString("utf8"), "utf8").equals(f.bytes)).toBe(true);
      const mine = texts(f.json);
      const english = texts(en!.json);
      // A language the Stream Deck app does not read has the Localization texts only (D-L4).
      const wanted = [...english.keys()].filter((p) => !LOCALIZATION_ONLY.includes(f.lang) || p.startsWith("Localization\u0000"));
      expect([...mine.keys()].sort()).toEqual(wanted.sort());
      for (const [path, text] of mine) {
        const label = `${f.lang}: ${path.split("\u0000").join(".")}`;
        expect(typeof text, label).toBe("string");
        expect((text as string).trim(), label).not.toBe("");
        expect(placeholders(text as string), label).toEqual(placeholders(english.get(path) as string));
      }
    });

    it(`${f.lang}.json says who drafted it, and keeps VJster's names out of OBS, YouTube and Google`, () => {
      expect(String(localization(f)._comment ?? "")).toMatch(/Claude Opus/);
      for (const a of manifest.Actions) {
        const entry = f.json[a.UUID] as { Name?: string } | undefined;
        expect(String(entry?.Name ?? "").toLowerCase(), `${f.lang} ${a.UUID}`).not.toMatch(/obs|youtube|google/);
      }
      if (LOCALIZATION_ONLY.includes(f.lang)) expect(Object.keys(f.json)).toEqual(["Localization"]);
      else {
        expect(f.json.Name).toBe("VJster");
        expect(f.json.Category).toBe("VJster");
      }
      for (const path of texts(localization(f)).keys()) expect(path).not.toContain(".");
    });
  }
});
