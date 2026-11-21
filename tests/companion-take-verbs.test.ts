// SPDX-License-Identifier: GPL-2.0-or-later
// Fadester Companion and the two installers never name the product's actions with a verb for "take", in any of
// their thirteen languages (QA-R305, QA-R306): the Windows window's catalog (PanelText.cs, PanelExtraText.cs) and the
// Mac-only strings (mac-strings.json), read through the generated PanelStrings.swift, which a test of its own keeps
// equal to those three; the TourBox preset's labels (presets/locales.json, and map.json for English); and the
// installers' own messages (the [CustomMessages] of the two .iss files and of installer/lang/*.isl).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TAKE_VERBS } from "./helpers/take-verbs.js";

const read = (path: string): string => readFileSync(path, "utf8").replace(/^﻿/, "");
/** A catalog's language code as the verb table names it: `pt-BR` is `pt_BR`. */
const verbKey = (locale: string): string => locale.replace("-", "_");

/** The window's catalog: every key with its thirteen texts, in PanelStrings.locales order. */
function panelCatalog(): { locales: string[]; table: Record<string, string[]> } {
  const swift = read("tourbox/macos/panel/PanelStrings.swift");
  const locales = JSON.parse(/static let locales = (\[[^\]]+\])/.exec(swift)![1]) as string[];
  const json = /static let json = #"""\n([\s\S]*?)\n"""#/.exec(swift)![1];
  return { locales, table: JSON.parse(json) as Record<string, string[]> };
}

/** `Key=Text` lines of an Inno Setup file's [CustomMessages] sections; `prefix.Key=` (a language prefix) too. */
function customMessages(path: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let inside = false;
  for (const line of read(path).split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) { inside = /^\s*\[CustomMessages\]/i.test(line); continue; }
    if (!inside || /^\s*;/.test(line)) continue;
    const match = /^\s*([A-Za-z0-9_.]+)=(.*)$/.exec(line);
    if (match) out.push([match[1], match[2]]);
  }
  return out;
}

/** The texts of one language, each with where it is: `panel:key`, `preset:action`, `installer:file:Key`. */
function textsOf(locale: string): Array<[string, string]> {
  const texts: Array<[string, string]> = [];
  const { locales, table } = panelCatalog();
  const column = locales.indexOf(locale);
  for (const [key, values] of Object.entries(table)) texts.push([`panel:${key}`, values[column]]);
  if (locale === "en") {
    const map = read("tourbox/presets/map.json");
    for (const match of map.matchAll(/"action":"([^"]+)","label":"([^"]+)"/g)) texts.push([`preset:${match[1]}`, match[2]]);
    for (const file of ["FadesterSuite.iss", "FadesterCompanion.iss"]) {
      for (const [key, text] of customMessages(join("installer", file))) if (!key.includes(".")) texts.push([`installer:${file}:${key}`, text]);
    }
  } else {
    const labels = (JSON.parse(read("tourbox/presets/locales.json")) as Record<string, Record<string, unknown>>)[locale] ?? {};
    for (const [key, value] of Object.entries(labels)) if (typeof value === "string") texts.push([`preset:${key}`, value]);
    for (const file of readdirSync(join("installer", "lang")).filter((name) => name === `${locale}.isl` || name.startsWith(`${locale}-`))) {
      for (const [key, text] of customMessages(join("installer", "lang", file))) texts.push([`installer:${file}:${key}`, text]);
    }
  }
  return texts;
}

// Ordinary speech, not a product action. Each is checked to still be a hit, so a line that no longer needs its
// exception is taken off this list.
const ALLOWED: Record<string, readonly string[]> = {
  // Turkish "geri al" is "undo".
  tr: ["panel:macMenuUndo", "preset:undo"]
};

describe("Fadester Companion's and the installers' texts (QA-R306)", () => {
  const { locales } = panelCatalog();

  it("the catalog has the thirteen languages the verb table has", () => {
    expect(locales.map(verbKey).sort()).toEqual(Object.keys(TAKE_VERBS).sort());
  });

  it.each(locales)("%s: no text uses a verb for \"take\"", (locale) => {
    const texts = textsOf(locale);
    // The window's catalog, the preset's labels and the installer's messages are all there.
    expect(texts.filter(([where]) => where.startsWith("panel:")).length).toBeGreaterThan(300);
    expect(texts.filter(([where]) => where.startsWith("preset:")).length).toBeGreaterThan(20);
    expect(texts.filter(([where]) => where.startsWith("installer:")).length).toBeGreaterThan(20);
    const pattern = TAKE_VERBS[verbKey(locale)];
    const allowed = ALLOWED[locale] ?? [];
    const hits = texts.filter(([, text]) => pattern.test(text)).map(([where]) => where);
    expect(hits.filter((where) => !allowed.includes(where)).map((where) => `${where}: ${texts.find(([w]) => w === where)![1]}`)).toEqual([]);
    expect(allowed.filter((where) => !hits.includes(where)), "allowed but no longer a hit").toEqual([]);
  });
});
