// SPDX-License-Identifier: GPL-2.0-or-later
// VJster settings page in Stream Deck's language (docs/vjster/PLAN.md 8.4,
// R-I18N-1..3): ui/i18n.js is current with the `Localization.pi` objects of
// the language files, every text the page uses exists in English, the page's
// built-in English matches en.json, and the page, run in a small stand-in DOM,
// shows German for "de", English for a language without a file, fills
// placeholders, counts one and many, and never stores the default label.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PI_STRINGS_FILE, piStringsSource, piTables } from "../scripts/vjster/make-pi-strings.js";
import { PLUGIN_DIR } from "./vjster-languages.js";

const html = readFileSync(join(PLUGIN_DIR, "ui", "vjster.html"), "utf8");
const js = readFileSync(join(PLUGIN_DIR, "ui", "vjster.js"), "utf8");
// A Windows checkout may have CRLF line endings; compare as stored (LF).
const i18n = readFileSync(PI_STRINGS_FILE, "utf8").replace(/\r\n/g, "\n");
const tables = piTables();

/** The keys the page uses: data-i18n attributes, t("..."), and "@key" or label keys in its field tables. */
function usedKeys(): string[] {
  const keys = new Set<string>();
  for (const m of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) keys.add(m[1]);
  for (const m of js.matchAll(/\bt\("([A-Za-z]+)"/g)) keys.add(m[1]);
  for (const m of js.matchAll(/"@([A-Za-z]+)"/g)) keys.add(m[1]);
  for (const m of js.matchAll(/\["[a-zA-Z]+", "(field[A-Za-z]+)"/g)) keys.add(m[1]);
  for (const m of js.matchAll(/t\(s\.badIds === 1 \? "([A-Za-z]+)" : "([A-Za-z]+)"/g)) keys.add(m[1]).add(m[2]);
  return [...keys].sort();
}

interface FakeElement {
  tag: string;
  id: string;
  attrs: Record<string, string>;
  children: FakeElement[];
  textContent: string;
  value: string;
  checked: boolean;
  className: string;
  listeners: Record<string, ((e: unknown) => void)[]>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  appendChild(c: FakeElement): FakeElement;
  select(): void;
}

function element(tag: string, attrs: Record<string, string> = {}): FakeElement {
  const e: FakeElement = {
    tag,
    id: attrs.id ?? "",
    attrs: { ...attrs },
    children: [],
    value: "",
    checked: false,
    className: attrs.class ?? "",
    listeners: {},
    get textContent() {
      return this.children.length > 0 ? this.children.map((c) => c.textContent).join("") : this.attrs["\u0000text"] ?? "";
    },
    set textContent(v: string) {
      this.children = [];
      this.attrs["\u0000text"] = v;
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    select() {}
  } as FakeElement;
  return e;
}

/** Load the page in a fresh context; returns the document, what it sent, and a way to talk to it. */
function loadPage(language: string, action: string, settings: Record<string, unknown> = {}) {
  const all: FakeElement[] = [];
  // The page's own elements: every tag with an id or a data-i18n attribute, with its English text.
  for (const m of html.matchAll(/<([a-z0-9]+)((?:\s+[a-z0-9-]+(?:="[^"]*")?)*)\s*\/?>(?:([^<]*)<\/\1>)?/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([a-z0-9-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
    if (!attrs.id && !("data-i18n" in attrs) && !("data-i18n-placeholder" in attrs)) continue;
    const e = element(m[1], attrs);
    e.textContent = m[3] ?? "";
    all.push(e);
  }
  const root = element("html", { lang: "en" });
  const sent: Record<string, unknown>[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    send(data: string) {
      sent.push(JSON.parse(data));
    }
  }
  let socket: FakeSocket | null = null;
  const window: Record<string, unknown> = { setTimeout: () => 0 };
  const document = {
    documentElement: root,
    getElementById: (id: string) => all.find((e) => e.id === id) ?? null,
    createElement: (tag: string) => element(tag),
    querySelectorAll: (sel: string) => {
      const attr = /^\[([a-z0-9-]+)\]$/.exec(sel)?.[1];
      return attr ? all.filter((e) => e.getAttribute(attr) !== null) : [];
    }
  };
  const context = {
    window,
    document,
    navigator: {},
    WebSocket: function (this: unknown) {
      socket = new FakeSocket();
      return socket;
    } as unknown,
    JSON,
    Object,
    String,
    Number
  };
  (context.WebSocket as { OPEN: number }).OPEN = 1;
  runInNewContext(i18n, context);
  runInNewContext(js, context);
  const info = JSON.stringify({ application: { language } });
  const actionInfo = JSON.stringify({ action: `com.jbrick2070.vjster.${action}`, payload: { settings } });
  (window.connectElgatoStreamDeckSocket as (...a: unknown[]) => void)(1, "ctx", "registerPropertyInspector", info, actionInfo);
  const fields = all.find((e) => e.id === "fields")!;
  const toPage = (payload: Record<string, unknown>) => socket!.onmessage!({ data: JSON.stringify({ event: "sendToPropertyInspector", payload }) });
  const byId = (id: string) => all.find((e) => e.id === id)!;
  const fromDeck = (message: Record<string, unknown>) => socket!.onmessage!({ data: JSON.stringify(message) });
  return { root, fields, sent, toPage, fromDeck, byId, all };
}

/** Every text in the rendered fields, depth first. */
function fieldTexts(e: FakeElement): string[] {
  const own = e.children.length === 0 && e.textContent ? [e.textContent] : [];
  return [...own, ...e.children.flatMap(fieldTexts)];
}

describe("the settings page's texts (PLAN.md 8.4)", () => {
  it("has a current ui/i18n.js, written from the language files", () => {
    expect(i18n, "run node --import tsx scripts/vjster/make-pi-strings.ts").toBe(piStringsSource());
    expect(i18n.startsWith("// SPDX-License-Identifier: GPL-2.0-or-later\n")).toBe(true);
    expect(Object.keys(tables)).toEqual(expect.arrayContaining(["en", "de"]));
  });

  it("finds every text it uses in English, and the deck words it shows as placeholders", () => {
    const used = usedKeys();
    expect(used.length).toBeGreaterThan(40);
    expect(used.filter((k) => !(k in tables.en.pi))).toEqual([]);
    expect(Object.keys(tables.en.pi).filter((k) => !used.includes(k))).toEqual([]);
    for (const [lang, t] of Object.entries(tables)) expect(Object.keys(t.deck).sort(), lang).toEqual(["fxSpeed", "quality", "speed"]);
  });

  it("keeps its built-in English equal to en.json", () => {
    for (const m of html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)) expect(m[2], m[1]).toBe(tables.en.pi[m[1]]);
    for (const m of html.matchAll(/placeholder="([^"]*)" data-i18n-placeholder="([^"]+)"/g)) expect(m[1], m[2]).toBe(tables.en.pi[m[2]]);
  });

  it("shows German for Stream Deck in German, with placeholders filled and one and many counted", () => {
    const page = loadPage("de", "speed");
    expect(page.root.getAttribute("lang")).toBe("de");
    expect(page.byId("save-global").textContent).toBe("Verbindung speichern");
    expect(page.byId("ext").getAttribute("placeholder")).toBe("jede Erweiterung");
    const texts = fieldTexts(page.fields);
    expect(texts).toEqual(expect.arrayContaining(["Diese Aktion", "Beschriftung", "Schritt beim Drehen", "Chrome-Tab", "OBS-Seite", "Beide", "0.25x"]));
    // No text is shown as its bare key, which is what a missing text would look like.
    const keys = new Set(Object.keys(tables.en.pi));
    expect([...texts, ...page.all.map((e) => e.textContent)].filter((x) => keys.has(x))).toEqual([]);
    page.toPage({ event: "status", port: 48151, portInUse: true, browser: "extension-off", extensionIds: [], badIds: 0, obsPage: true, obs: "page-off" });
    expect(page.byId("status").textContent).toBe("Port 48151 wird von einem anderen Programm belegt");
    expect(page.byId("obs-status").textContent).toBe("Keine OBS-Seite verbunden");
    page.toPage({ event: "status", port: 1, browser: "connected", extensionIds: ["a", "b"], badIds: 1, obsPage: false });
    expect(page.byId("status").textContent).toBe("1 Eintrag ignoriert: keine Chrome-Erweiterungs-ID");
    expect(page.byId("obs-status").textContent).toBe("Diese Kopie des Plugins hat keine OBS-Seite");
    page.toPage({ event: "status", port: 1, browser: "connected", extensionIds: ["a", "b", "c"], badIds: 2, obsPage: true, obs: "connected" });
    expect(page.byId("status").textContent).toBe("2 Einträge ignoriert: keine Chrome-Erweiterungs-IDs");
    page.toPage({ event: "status", port: 1, browser: "connected", extensionIds: ["a"], badIds: 1, obsPage: true, obs: "connected" });
    expect(page.byId("status").textContent).toBe("Kein Eintrag ist eine Chrome-Erweiterungs-ID: keine Erweiterung kann sich verbinden");
  });

  it("shows the default label as a placeholder in the deck's language and never stores it (R-I18N-2)", () => {
    const page = loadPage("de", "speed", { extended: true });
    const label = (function find(e: FakeElement): FakeElement | undefined {
      return e.tag === "input" && e.getAttribute("maxlength") === "16" ? e : e.children.map(find).find(Boolean);
    })(page.fields)!;
    expect(label.value).toBe("");
    expect(label.getAttribute("placeholder")).toBe("FX-TEMPO");
    label.value = "  ";
    label.listeners.change[0]({});
    const saved = page.sent.filter((m) => m.event === "setSettings").at(-1) as { payload: Record<string, unknown> };
    expect(saved.payload).toEqual({ extended: true });
    label.value = "WARP";
    label.listeners.change[0]({});
    expect((page.sent.filter((m) => m.event === "setSettings").at(-1) as { payload: Record<string, unknown> }).payload).toEqual({ extended: true, label: "WARP" });
    // Settings from Stream Deck redraw the fields, still in German, with the placeholder that fits them.
    page.fromDeck({ event: "didReceiveSettings", payload: { settings: { extended: false } } });
    const again = (function find(e: FakeElement): FakeElement | undefined {
      return e.tag === "input" && e.getAttribute("maxlength") === "16" ? e : e.children.map(find).find(Boolean);
    })(page.fields)!;
    expect(again.getAttribute("placeholder")).toBe("TEMPO");
    expect(fieldTexts(page.fields)).toContain("Schritt beim Drehen");
    expect(fieldTexts(loadPage("de", "quality").fields)).toContain("Stufe beim nächsten Video beibehalten");
  });

  it("falls back to English for a language without a file, and to the base language for a regional one", () => {
    const page = loadPage("it", "pin");
    expect(page.root.getAttribute("lang")).toBe("en");
    expect(page.byId("save-global").textContent).toBe("Save link settings");
    expect(fieldTexts(page.fields)).toEqual([tables.en.pi.pinNote]);
    expect(loadPage("de_AT", "transport").byId("obs-copy").textContent).toBe("Adresse kopieren");
  });
});
