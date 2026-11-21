// SPDX-License-Identifier: GPL-2.0-or-later
// The two Midi Fadester settings pages follow the plugin's one Language choice (UI review U2-19; R-LANG-3, PLAN.md
// step L.6). Until now they stayed in Stream Deck's language. Each test runs a whole shipped page, i18n.js and
// pi-common.js included, in a vm with a small DOM, and feeds it the state the plugin's own bridge builds.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { readLanguageTable } from "../src/i18n/load.js";
import { setLanguage } from "../src/i18n/strings.js";
import { PropertyInspectorBridge } from "../src/pi/pi-bridge.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import { MiniDocument, MiniElement, documentFromPage } from "./helpers/mini-dom.js";
import { PLUGIN_DIR, readLanguageFile } from "./helpers/languages.js";

const UI = join(PLUGIN_DIR, "ui");
const MIDI_PAGES = readdirSync(UI).filter((name) => name.endsWith(".html")
  && /<script src="pi-common\.js"><\/script>/.test(readFileSync(join(UI, name), "utf8")));
const MEMORY_KEY = "fadester:resolvedLanguage";
const pi = (language: string) => readLanguageFile(language).Localization.pi as Record<string, string>;

class FakeSocket {
  public static readonly OPEN = 1;
  public readyState = 1;
  public readonly sent: Array<Record<string, unknown>> = [];
  public onopen?: () => void;
  public onmessage?: (event: { data: string }) => void;
  public constructor(public readonly url: string) { sockets.push(this); }
  public send(data: string): void { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
}
let sockets: FakeSocket[] = [];

/** The state message the plugin sends a Midi Fadester page, worded in `language` as the plugin now words it. */
function stateIn(language: string, choice: string): Record<string, unknown> {
  setLanguage(language, language === "en" ? null : readLanguageTable(language, PLUGIN_DIR));
  const client = new FadesterClient({ host: "127.0.0.1", port: 1, password: "" });
  const bridge = new PropertyInspectorBridge(new FadesterStore(client), client, {
    sendToPropertyInspector: () => {},
    persistGlobalSettings: async () => {},
    getLanguage: () => ({ choice: choice as "auto", resolved: language })
  });
  return { event: "fadesterState", ...bridge.buildStatePayload() };
}

/** Opens a shipped Midi Fadester page as Stream Deck does: scripts in page order, then the socket handshake. */
function openPage(page: string, appLanguage: string, remembered?: string) {
  const html = readFileSync(join(UI, page), "utf8");
  const document: MiniDocument = documentFromPage(html);
  const memory = new Map<string, string>(remembered ? [[MEMORY_KEY, remembered]] : []);
  const localStorage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, String(value)); } };
  const context: Record<string, unknown> = { document, WebSocket: FakeSocket, console, localStorage, setTimeout: () => 0, clearTimeout: () => {} };
  context.window = context;
  createContext(context);
  sockets = [];
  for (const [, src, inline] of html.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g)) {
    runInContext(src ? readFileSync(join(UI, src), "utf8") : inline, context, { filename: src ?? `${page} (inline)` });
  }
  const connect = context.connectElgatoStreamDeckSocket as (...args: string[]) => void;
  connect("28196", "pi-uuid", "registerPropertyInspector", JSON.stringify({ application: { language: appLanguage } }),
    JSON.stringify({ action: `io.github.jbrick2070.fadester-for-obs.${page.replace(/\.html$/, "")}`, payload: { settings: {}, controller: "Keypad" } }));
  const socket = sockets[0];
  socket.onopen?.();
  return {
    memory,
    i18n: context.FadesterI18n as { language(): string },
    /** The page's first element that carries this text key. */
    textOf(key: string): string {
      const find = (element: MiniElement): MiniElement | null => {
        if (element.getAttribute("data-i18n") === key) return element;
        for (const child of element.children) { const hit = find(child); if (hit) return hit; }
        return null;
      };
      const found = find(document.documentElement);
      if (!found) throw new Error(`${page}: nothing carries ${key}`);
      return found.textContent;
    },
    receive(payload: Record<string, unknown>): void { socket.onmessage?.({ data: JSON.stringify({ event: "sendToPropertyInspector", payload }) }); }
  };
}

afterEach(() => setLanguage("en", null));

describe("the two Midi Fadester settings pages follow the Language choice", () => {
  it("there are two of them", () => {
    expect(MIDI_PAGES.sort()).toEqual(["auto-fade-key.html", "fader-dial.html"]);
  });

  for (const page of MIDI_PAGES) {
    it(`${page}: first paints in the language the plugin last resolved, not Stream Deck's`, () => {
      const p = openPage(page, "en", "de");
      expect(p.i18n.language()).toBe("de");
      expect(p.textOf("slot")).toBe(pi("de").slot);
      // Nothing remembered: Stream Deck's language, as before.
      expect(openPage(page, "fr").i18n.language()).toBe("fr");
      // Something that is not one of the plugin's languages is not a language to paint in.
      expect(openPage(page, "es", "xx").i18n.language()).toBe("es");
    });

    it(`${page}: takes the language of the plugin's state, a fixed choice Stream Deck does not offer included`, () => {
      const p = openPage(page, "en");
      expect(p.textOf("slot")).toBe(pi("en").slot);
      p.receive(stateIn("nl", "nl"));
      expect(p.i18n.language()).toBe("nl");
      expect(p.textOf("slot")).toBe(pi("nl").slot);
      expect(p.memory.get(MEMORY_KEY)).toBe("nl");
      // Back to Automatic on a German Stream Deck: the page follows again, with no reload.
      p.receive(stateIn("de", "auto"));
      expect(p.i18n.language()).toBe("de");
      expect(p.textOf("slot")).toBe(pi("de").slot);
      expect(p.memory.get(MEMORY_KEY)).toBe("de");
    });

    it(`${page}: a state without a language, or with one the page does not know, changes nothing`, () => {
      const p = openPage(page, "en", "de");
      const { language: _none, ...bare } = stateIn("de", "de");
      p.receive(bare);
      expect(p.i18n.language()).toBe("de");
      p.receive({ ...stateIn("de", "de"), language: { choice: "auto", resolved: "xx" } });
      expect(p.i18n.language()).toBe("de");
      expect(p.memory.get(MEMORY_KEY)).toBe("de");
    });
  }

  it("the plugin words what it sends these pages in its own language, with no second translator", () => {
    const source = readFileSync(join(PLUGIN_DIR, "..", "src", "plugin.ts"), "utf8");
    expect(source).not.toMatch(/midiPagesTranslate|translate:/);
    const dutch = stateIn("nl", "nl") as { targetModes: Array<{ label: string }> };
    setLanguage("en", null);
    const english = stateIn("en", "auto") as { targetModes: Array<{ label: string }> };
    expect(dutch.targetModes.map((mode) => mode.label)).not.toEqual(english.targetModes.map((mode) => mode.label));
  });
});
