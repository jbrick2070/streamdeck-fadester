// SPDX-License-Identifier: GPL-2.0-or-later
// VJster Chrome extension languages (docs/vjster/REQUIREMENTS.md R-I18N-1,
// R-I18N-3, R-I18N-5; PLAN.md 8.5): every required `_locales` language is
// there, each messages.json is Chrome's format with the same messages and
// placeholders as English, every message the manifest and the options page use
// exists, the page's built-in English matches, and the page is filled from
// chrome.i18n with English kept where a message is missing.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { message, translatePage, type GetMessage } from "../vjster-extension/src/i18n.js";
import { REQUIRED, ROOT } from "./vjster-languages.js";

const EXT = join(ROOT, "vjster-extension");
const LOCALES = join(EXT, "_locales");
type Messages = Record<string, { message: string; description?: string; placeholders?: Record<string, { content: string; example?: string }> }>;

const raw = (lang: string): Buffer => readFileSync(join(LOCALES, lang, "messages.json"));
const read = (lang: string): Messages => JSON.parse(raw(lang).toString("utf8")) as Messages;
const langs = readdirSync(LOCALES).sort();
const en = read("en");
const html = readFileSync(join(EXT, "options.html"), "utf8");
const options = readFileSync(join(EXT, "src", "options.ts"), "utf8");
const manifest = readFileSync(join(EXT, "manifest.json"), "utf8");

/** The `$NAME$` placeholders a message uses, sorted. */
const named = (text: string): string[] => [...new Set([...text.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) => m[1].toLowerCase()))].sort();

/** Chrome's lookup for one language: its message with `$1`.. and `$NAME$` filled, else English, else "". */
function chromeLike(lang: string): GetMessage {
  const mine = read(lang);
  return (name, subs = []) => {
    const m = mine[name] ?? en[name];
    if (!m) return "";
    return m.message.replace(/\$([A-Za-z0-9_]+)\$/g, (all, p: string) => {
      const content = m.placeholders?.[p.toLowerCase()]?.content ?? all;
      return content.replace(/\$([1-9])/g, (_x, n: string) => subs[Number(n) - 1] ?? "");
    });
  };
}

describe("Chrome extension languages (R-I18N-5)", () => {
  it("has every required language, and English as the default", () => {
    expect(langs).toEqual(expect.arrayContaining([...REQUIRED.chrome]));
    expect(JSON.parse(manifest).default_locale).toBe("en");
    for (const lang of langs) expect(lang).toMatch(/^[a-z]{2}(_[A-Z]{2})?$/);
  });

  for (const lang of langs) {
    it(`${lang}: messages.json is Chrome's format, UTF-8 without a BOM, with English's messages and placeholders`, () => {
      const bytes = raw(lang);
      expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
      expect(Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)).toBe(true);
      const mine = read(lang);
      expect(Object.keys(mine).sort()).toEqual(Object.keys(en).sort());
      for (const [name, entry] of Object.entries(mine)) {
        expect(name).toMatch(/^[A-Za-z0-9_]+$/);
        expect(Object.keys(entry).every((k) => ["message", "description", "placeholders"].includes(k)), name).toBe(true);
        expect(typeof entry.message, name).toBe("string");
        expect(entry.message.trim(), name).not.toBe("");
        expect(named(entry.message), `${lang} ${name}`).toEqual(named(en[name].message));
        expect(Object.keys(entry.placeholders ?? {}).sort(), name).toEqual(named(entry.message));
        expect(entry.placeholders ?? {}, `${lang} ${name}`).toEqual(en[name].placeholders ?? {});
        // A lone $ would be read as a placeholder; Chrome writes a dollar as $$.
        expect(entry.message.replace(/\$\$|\$[A-Za-z0-9_]+\$/g, ""), name).not.toContain("$");
      }
      expect(mine.htmlLang.message).toBe(lang.replace("_", "-"));
      // Chrome refuses a manifest description over 132 characters.
      expect([...mine.extDescription.message].length).toBeLessThanOrEqual(132);
    });
  }

  it("has every message the manifest, the options page and its script use, and uses every message", () => {
    const used = new Set<string>();
    for (const m of manifest.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
    for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
    for (const m of options.matchAll(/status\(\s*"([A-Za-z0-9_]+)"/g)) used.add(m[1]);
    for (const m of options.matchAll(/\? "([A-Za-z0-9_]+)" : "([A-Za-z0-9_]+)"/g)) used.add(m[1]).add(m[2]);
    used.add("htmlLang");
    expect([...used].filter((k) => !(k in en))).toEqual([]);
    expect(Object.keys(en).filter((k) => !used.has(k))).toEqual([]);
  });

  it("keeps the options page's built-in English equal to en/messages.json", () => {
    const pairs = [...html.matchAll(/data-i18n="([^"]+)">([^<]*)</g)];
    expect(pairs.length).toBeGreaterThan(6);
    for (const m of pairs) expect(m[2].replace(/&#39;/g, "'"), m[1]).toBe(en[m[1]].message);
  });

  it("fills the page in Chrome's language, keeps English where a message is missing, and fills placeholders", () => {
    const nodes = [
      { attr: "portLabel", textContent: "Link port" as string | null },
      { attr: "save", textContent: "Save" as string | null },
      { attr: "notThere", textContent: "English stays" as string | null }
    ];
    let lang = "";
    const doc = {
      documentElement: { setAttribute: (_n: string, v: string) => (lang = v) },
      querySelectorAll: () => nodes.map((n) => ({ getAttribute: () => n.attr, get textContent() { return n.textContent; }, set textContent(v: string | null) { n.textContent = v; } }))
    };
    translatePage(doc, chromeLike("de"));
    expect(lang).toBe("de");
    expect(nodes.map((n) => n.textContent)).toEqual(["Verbindungsport", "Speichern", "English stays"]);
    expect(message(chromeLike("de"), "statusSaved", ["48151"])).toBe("Gespeichert. VJster verbindet sich jetzt mit Port 48151.");
    expect(message(chromeLike("en"), "statusBadPort", ["48150"])).toBe("Use a whole number from 1024 to 65535; 48150 is the default.");
    expect(message(() => "", "statusSaved", ["1"])).toBe("statusSaved");
  });
});
