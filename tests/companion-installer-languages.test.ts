// SPDX-License-Identifier: GPL-2.0-or-later
// Fadester Suite Setup and the Fadester Companion installer open in the suite's 13 languages. English is in each
// script's [CustomMessages]; the other twelve are in installer/lang/<code>.isl, shared by both scripts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const installer = join(__dirname, "..", "installer");
const others = ["de", "es", "fr", "it", "ja", "ko", "nl", "pt-BR", "ru", "tr", "zh-CN", "zh-TW"];

/** The keys and texts of a file's [CustomMessages] section. */
function customMessages(text: string): Map<string, string> {
  const found = new Map<string, string>();
  let inside = false;
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (line.startsWith("[")) { inside = line.trim() === "[CustomMessages]"; continue; }
    if (!inside || line.startsWith(";") || line.trim() === "") continue;
    const at = line.indexOf("=");
    expect(at, line).toBeGreaterThan(0);
    const key = line.slice(0, at);
    expect(found.has(key), `${key} twice`).toBe(false);
    found.set(key, line.slice(at + 1));
  }
  return found;
}
const placeholders = (text: string) => [...new Set(text.match(/%[1-9n]/g) ?? [])].sort().join(" ");

const suite = readFileSync(join(installer, "FadesterSuite.iss"), "utf8");
const companion = readFileSync(join(installer, "FadesterCompanion.iss"), "utf8");
const english = new Map([...customMessages(suite), ...customMessages(companion)]);

describe("installer languages", () => {
  it("lists the suite's 13 languages once, for both setups", () => {
    const list = readFileSync(join(installer, "lang", "languages.iss"), "utf8");
    const names = [...new Set([...list.matchAll(/^Name: "([a-z]+)"/gm)].map((m) => m[1]))].sort();
    expect(names).toEqual(["de", "en", "es", "fr", "it", "ja", "ko", "nl", "ptbr", "ru", "tr", "zhcn", "zhtw"]);
    for (const code of others) expect(list, code).toContain(`lang\\${code}.isl`);
    for (const script of [suite, companion]) {
      expect(script).toContain('#include "lang\\languages.iss"');
      // "no": never a language question; "auto" asks when Windows speaks none of the 13.
      expect(script).toContain("ShowLanguageDialog=no");
    }
  });

  it("says the same thing in English in both scripts where they share a message", () => {
    const a = customMessages(suite), b = customMessages(companion);
    for (const [key, text] of b) if (a.has(key)) expect(a.get(key), key).toBe(text);
  });

  it("uses only messages that exist", () => {
    for (const script of [suite, companion]) {
      const mine = customMessages(script);
      const used = [...script.matchAll(/\{cm:([A-Za-z]+)[,}]/g), ...script.matchAll(/CustomMessage\('([A-Za-z]+)'\)/g),
        ...script.matchAll(/, '(Note[A-Za-z]+)', /g)].map((m) => m[1]);
      expect(used.length).toBeGreaterThan(3);
      expect(used.filter((key) => !mine.has(key))).toEqual([]);
      expect([...mine.keys()].filter((key) => !used.includes(key))).toEqual([]);
    }
  });

  it.each(others)("%s has every message, with the same values filled in", (code) => {
    const raw = readFileSync(join(installer, "lang", `${code}.isl`));
    // Inno Setup reads a language file as UTF-8 only when it starts with the byte-order mark.
    expect([raw[0], raw[1], raw[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const mine = customMessages(raw.toString("utf8"));
    expect([...mine.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, text] of mine) {
      expect(text.trim(), key).not.toBe("");
      expect(text, key).not.toBe(english.get(key));
      expect(placeholders(text), key).toBe(placeholders(english.get(key)!));
      // Product names stay as they are.
      for (const name of ["Fadester Companion", "Midi Fadester", "Fadester for OBS", "Playlister", "VJster", "OpenDeck", "Stream Deck", "Visual Sidechain", "48150"]) {
        if (english.get(key)!.includes(name)) expect(text, `${key}: ${name}`).toContain(name);
      }
    }
  });

  it.each(["zh-CN", "zh-TW"])("%s translates the setup pages Inno Setup has no file for", (code) => {
    const raw = readFileSync(join(installer, "lang", `${code}-pages.isl`));
    expect([raw[0], raw[1], raw[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = raw.toString("utf8");
    expect(text).toContain("[LangOptions]");
    for (const key of ["ButtonNext", "ButtonInstall", "ButtonFinish", "ButtonCancel", "WelcomeLabel1", "WizardSelectComponents",
      "WizardReady", "WizardPreparing", "WizardInstalling", "FinishedHeadingLabel", "ClickFinish", "ConfirmUninstall"]) {
      expect(text, key).toMatch(new RegExp(`^${key}=.*[\\u4e00-\\u9fff]`, "m"));
    }
  });
});
