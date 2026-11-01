// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page notes in the operator's language (docs/vjster/REQUIREMENTS.md
// R-I18N-1, R-I18N-3, R-I18N-5; PLAN.md 8.6): every required language has
// every note with English's placeholders, a language tag finds its table, the
// page takes its language from hl= before the browser's, and an unknown or
// malformed language falls back to English.
import { describe, expect, it } from "vitest";
import { bootPage, type BootEnv } from "../vjster-page/src/page-boot.js";
import { readParams } from "../vjster-page/src/page-params.js";
import { note, NOTE_KEYS, NOTES, pageLanguage } from "../vjster-page/src/page-text.js";
import { REQUIRED } from "./vjster-languages.js";

const VIDEO = "aqz-KE-bpKQ";
const TOKEN = "0123456789abcdef0123456789abcdef";
const holes = (text: string): string[] => [...text.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]).sort();

/** A start-up environment that records what the page shows and the language it sets. */
function env(search: string, hash: string, language?: string, failScript = false) {
  const shown: string[] = [];
  const langs: string[] = [];
  const timers: (() => void)[] = [];
  const e: BootEnv = {
    location: { search, hash, port: "48150", pathname: "/obs", origin: "http://127.0.0.1:48150" },
    replaceAddress: () => undefined,
    show: (text) => void shown.push(text),
    language,
    setLanguage: (l) => void langs.push(l),
    addScript: (_src, onError) => {
      if (failScript) onError();
    },
    onApiReady: () => undefined,
    createPlayer: () => null,
    openSocket: () => ({ readyState: 0, send: () => undefined, close: () => undefined, onopen: null, onclose: null, onerror: null, onmessage: null }),
    timers: { setTimeout: (fn) => timers.push(fn), clearTimeout: () => undefined },
    random: () => 0
  };
  return { e, shown, langs };
}

describe("the OBS page's notes (PLAN.md 8.6)", () => {
  it("has every required language, each with every note and English's placeholders", () => {
    expect(Object.keys(NOTES)).toEqual(expect.arrayContaining([...REQUIRED.page]));
    for (const [lang, table] of Object.entries(NOTES)) {
      expect(lang).toMatch(/^[a-z]{2}(_[A-Z]{2})?$/);
      expect(Object.keys(table).sort(), lang).toEqual([...NOTE_KEYS].sort());
      for (const key of NOTE_KEYS) {
        const text = table[key] as string;
        expect(text.trim(), `${lang} ${key}`).not.toBe("");
        expect(holes(text), `${lang} ${key}`).toEqual(holes(NOTES.en[key] as string));
        expect(text, `${lang} ${key}`).toMatch(/^VJster\s?: /);
      }
    }
  });

  it("finds the table for a language tag, a region, a script or an alias, else English", () => {
    expect(["de", "de-AT", "de_CH", "DE", " de "].map(pageLanguage)).toEqual(["de", "de", "de", "de", "de"]);
    expect(["en-US", "it-IT", "xx", "", null, undefined, "-", "1"].map(pageLanguage)).toEqual(Array(8).fill("en"));
    // Chinese and Portuguese go to the table they belong to once it exists; English until then.
    const zhCN = "zh_CN" in NOTES ? "zh_CN" : "en";
    const zhTW = "zh_TW" in NOTES ? "zh_TW" : "en";
    expect(["zh", "zh-CN", "zh-Hans", "zh-SG"].map(pageLanguage)).toEqual(Array(4).fill(zhCN));
    expect(["zh-TW", "zh-HK", "zh-Hant", "zh-Hant-TW", "zh-Hant-CN"].map(pageLanguage)).toEqual(Array(5).fill(zhTW));
    expect(pageLanguage("zh-Hans-HK")).toBe(zhCN);
    expect(["constructor", "__proto__", "toString"].map(pageLanguage)).toEqual(["en", "en", "en"]);
    expect(pageLanguage("pt-BR")).toBe("pt_BR" in NOTES ? "pt_BR" : "en");
  });

  it("fills the seconds and falls back to English for a language it lacks", () => {
    expect(note("de", "retry", { s: "30" })).toBe("VJster: Der YouTube-Player konnte nicht geladen werden; neuer Versuch in 30 s.");
    expect(note("xx", "retry", { s: "2" })).toBe("VJster: YouTube's player could not be loaded; trying again in 2 s.");
    expect(note("de", "retry", { s: "{s}" })).toContain("in {s} s.");
  });

  it("reads hl= from the address and refuses a malformed one", () => {
    expect(readParams(`?v=${VIDEO}&hl=zh_CN`, "", "").hl).toBe("zh_CN");
    expect(readParams(`?v=${VIDEO}&hl=pt-BR`, "", "").hl).toBe("pt-BR");
    for (const bad of ["", "d", "de<x>", "de_CH_x_y_z", "a".repeat(40)]) expect(readParams(`?v=${VIDEO}&hl=${encodeURIComponent(bad)}`, "", "").hl).toBeNull();
  });

  it("speaks the address's language first, then the browser's, then English, and sets the page's lang", () => {
    const fromAddress = env(`?v=${VIDEO}&hl=de`, "", "en-US");
    expect(bootPage(fromAddress.e)).toBeNull();
    expect(fromAddress.shown).toEqual([note("de", "noToken")]);
    expect(fromAddress.langs).toEqual(["de"]);

    const fromBrowser = env("?hl=bad!", `#token=${TOKEN}`, "de-DE");
    bootPage(fromBrowser.e);
    expect(fromBrowser.shown).toEqual([note("de", "noVideo")]);

    const neither = env(`?v=${VIDEO}`, "");
    bootPage(neither.e);
    expect(neither.shown[0]).toMatch(/no token/);
    expect(neither.langs).toEqual(["en"]);

    const retry = env(`?v=${VIDEO}&hl=de`, `#token=${TOKEN}`, undefined, true);
    const page = bootPage(retry.e);
    expect(retry.shown).toEqual(["VJster: Der YouTube-Player konnte nicht geladen werden; neuer Versuch in 2 s."]);
    page?.stop();
  });
});
