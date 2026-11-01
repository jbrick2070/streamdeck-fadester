// SPDX-License-Identifier: GPL-2.0-or-later
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { inspectorI18nScript } from "../scripts/generate-ui-i18n.js";
import { templatePlaceholders } from "../packages/streamdeck-fadester-shared/src/i18n.js";
import { normalizeLanguage } from "../src/i18n/load.js";
import { inspectorPageScript } from "./helpers/inspector-scripts.js";
import { PLUGIN_DIR, presentLanguages, readLanguageFile } from "./helpers/languages.js";

const UI = join(PLUGIN_DIR, "ui");
const PAGES = readdirSync(UI).filter((name) => name.endsWith(".html"));
const RUNTIMES = ["direct-pi.js", "pi-common.js"];
const ui = (name: string): string => readFileSync(join(UI, name), "utf8");
const english = (): Record<string, string> => readLanguageFile("en").Localization.pi as Record<string, string>;

type I18n = {
  t(key: string, params?: Record<string, unknown>): string;
  plural(base: string, count: number, params?: Record<string, unknown>): string;
  setLanguage(language: string): string;
  languageFromInfo(info: unknown): string;
  number(value: number, digits: number): string;
};

function loadI18n(document?: unknown): I18n {
  const window: Record<string, unknown> = {};
  runInNewContext(ui("i18n.js"), { window, document });
  return window.FadesterI18n as I18n;
}

describe("inspector texts (R-I18N-5)", () => {
  it("ui/i18n.js is generated from the language files and current", () => {
    expect(ui("i18n.js").replace(/\r\n/g, "\n")).toBe(inspectorI18nScript());
  });

  it.each(presentLanguages())("%s has every inspector text with English's placeholders", (language) => {
    const table = readLanguageFile(language).Localization.pi as Record<string, unknown>;
    expect(Object.keys(table).sort()).toEqual(Object.keys(english()).sort());
    for (const [key, value] of Object.entries(english())) {
      expect(typeof table[key], `${language}.pi.${key}`).toBe("string");
      expect(String(table[key]).trim(), `${language}.pi.${key}`).not.toBe("");
      expect(templatePlaceholders(String(table[key])), `${language}.pi.${key}`).toEqual(templatePlaceholders(value));
      expect(key).not.toContain(".");
    }
  });

  it("every key the pages use exists, and every text is used", () => {
    const sources = [...PAGES, ...RUNTIMES].map(ui).join("\n");
    const used = new Set<string>();
    for (const match of sources.matchAll(/data-i18n(?:-placeholder|-label|-aria-label)?="([^"]+)"/g)) used.add(match[1]);
    // Every quoted word inside a translator call is a key, unless it is compared (=== "connected").
    for (const call of sources.matchAll(/\b(?:T|t|plural|groupLabel)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      for (const literal of call[1].matchAll(/(===\s*|!==\s*)?"([a-z][A-Za-z0-9]*)"/g)) {
        if (!literal[1]) used.add(call[0].startsWith("plural") ? `${literal[2]}One` : literal[2]);
      }
    }
    for (const key of used) expect(Object.hasOwn(english(), key), key).toBe(true);
    for (const key of Object.keys(english())) {
      const base = key.replace(/(One|Many)$/, "");
      expect(sources.includes(`"${key}"`) || sources.includes(`"${base}"`), `${key} is not used`).toBe(true);
    }
  });

  it.each(PAGES)("%s loads i18n.js before its runtime and marks its static texts", (page) => {
    const html = ui(page);
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
    const runtime = scripts.findIndex((src) => RUNTIMES.includes(src));
    expect(scripts.indexOf("i18n.js")).toBeGreaterThanOrEqual(0);
    expect(scripts.indexOf("i18n.js")).toBeLessThan(runtime);
    // Static elements with words carry a key; the two dynamic hints are filled by the page itself.
    const body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<title>[\s\S]*?<\/title>/g, "");
    for (const match of body.matchAll(/<(label|option|summary|button|h3|p|span|strong|em|div)\b([^>]*)>([^<]*[A-Za-z][^<]*)</g)) {
      const [, tag, attributes, text] = match;
      if (/id="(obs-fader-tbar-hint|obs-fader-press-hint)"/.test(attributes)) continue;
      expect(attributes, `${page}: <${tag}>${text.trim()}`).toMatch(/data-i18n=/);
    }
    for (const match of body.matchAll(/placeholder="[^"]*"([^>]*)/g)) expect(match[1]).toMatch(/data-i18n-placeholder=/);
  });
});

describe("the inspectors' translator", () => {
  it("falls back to English and fills placeholders, counts and numbers", () => {
    const i18n = loadI18n();
    expect(i18n.t("notInObsNow", { value: "Cam" })).toBe("Cam (not in OBS now)");
    expect(i18n.setLanguage("de_AT")).toBe("de");
    expect(i18n.t("notInObsNow", { value: "Cam" })).toBe("Cam (derzeit nicht in OBS)");
    expect(i18n.plural("filterHost", 1, { source: "Kamera" })).toBe("Kamera – 1 Filter");
    expect(i18n.plural("sceneBannerIndex", 3, { n: 4 })).toContain("3 Szenen");
    expect(i18n.number(-3.5, 1)).toBe("-3,5");
    expect(i18n.t("noSuchKey")).toBe("noSuchKey");
    expect(i18n.setLanguage("pt_BR")).toBe("en");
    expect(i18n.t("refresh")).toBe("Refresh");
    expect(i18n.languageFromInfo(JSON.stringify({ application: { language: "de" } }))).toBe("de");
    expect(i18n.languageFromInfo("{ broken")).toBe("en");
  });

  it("maps Stream Deck's language exactly as the plugin does", () => {
    const i18n = loadI18n();
    for (const raw of ["en", "de", "de_AT", "de-CH", "es", "fr_CA", "ja", "ko", "zh_CN", "zh-TW", "zh_Hant", "zh-HK",
      "zh_Hans_SG", "zh", "pt_BR", "", "xx"]) {
      expect(i18n.setLanguage(raw), raw).toBe(normalizeLanguage(raw));
    }
  });

  it("fills static texts, keeps marked children in place and sets <html lang>", () => {
    class Node {
      children: Node[] = [];
      attributes: Record<string, string> = {};
      text = "";
      constructor(public tag: string, attributes: Record<string, string> = {}, text = "") { this.attributes = attributes; this.text = text; }
      getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
      setAttribute(name: string, value: string): void { this.attributes[name] = value; }
      get firstChild(): Node | undefined { return this.children[0]; }
      removeChild(child: Node): void { this.children = this.children.filter((node) => node !== child); }
      appendChild(child: Node): void { this.children.push(child); }
      set textContent(value: string) { this.text = value; this.children = []; }
      get textContent(): string { return this.text + this.children.map((node) => node.textContent).join(""); }
      querySelectorAll(selector: string): Node[] {
        const name = /\[([^\]]+)\]/.exec(selector)![1];
        const all = (node: Node): Node[] => node.children.flatMap((child) => [child, ...all(child)]);
        return all(this).filter((node) => name in node.attributes);
      }
    }
    const strong = new Node("strong", { "data-slot": "action", "data-i18n": "actionObsFader" }, "OBS Fader");
    const intro = new Node("p", { "data-i18n": "mfFaderIntro" });
    intro.children = [strong];
    const input = new Node("input", { "data-i18n-placeholder": "placeholderFromObs" });
    const root = new Node("body");
    root.children = [intro, input];
    const documentElement = { lang: "en" };
    const document = Object.assign(root, { documentElement, createTextNode: (text: string) => new Node("#text", {}, text) });
    const i18n = loadI18n(document);
    i18n.setLanguage("de");
    expect(documentElement.lang).toBe("de");
    expect(intro.textContent).toBe("Dies ist die erweiterte Anbindung mit gemeinsamen Slots. Für den normalen OBS-Audiomixer und die Szenen-T-Bar wählen Sie stattdessen OBS-Fader.");
    expect(intro.children).toContain(strong);
    expect(input.attributes.placeholder).toBe("Aus OBS (leer lassen)");
  });

  it("a German inspector shows German texts from its inline script", () => {
    const html = ui("obs-fade-key.html");
    const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
      value: "", textContent: "", checked: false, className: "", style: {} as Record<string, string>, onchange: undefined as unknown
    }]));
    let render!: (settings: object, save: () => void, state: object) => void;
    const window: Record<string, unknown> = {
      initDirectObsPropertyInspector: (callback: typeof render) => { render = callback; },
      directObsFillSelect: () => {}, directObsAudioItems: () => []
    };
    runInNewContext(inspectorPageScript(html), { window, document: { activeElement: null, getElementById: (id: string) => elements.get(id) } });
    (window.FadesterI18n as I18n).setLanguage("de");
    render({ inputName: "__audio_mic__" }, () => {}, { status: { kind: "connected" }, catalog: {}, automaticInputs: { __audio_mic__: "" } });
    expect(elements.get("direct-fade-status")!.textContent).toBe("Dieser Audioeingang ist in OBS nicht verfügbar. Wählen Sie oben einen anderen Mixer-Eingang.");
  });
});
