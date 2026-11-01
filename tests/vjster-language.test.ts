// SPDX-License-Identifier: GPL-2.0-or-later
// VJster's Language choice on the plugin side (docs/vjster/PLAN.md 9, step L.3;
// R-LANG-1, R-LANG-2, R-LANG-4, R-LANG-5, R-LANG-8): the shared resolver cases,
// VJster's own Automatic baseline, the deck words read from its own files and
// replaced in place, a change redrawing every instance, and the plugin-wide
// settings writes that never lose a key, the extension allow list above all.
import type { JsonObject } from "@elgato/utils";
import { describe, expect, it } from "vitest";
import { normalizeChoice as fadesterChoice, resolveLanguage as fadesterResolve } from "../src/i18n/language-choice.js";
import { PinAction, TransportAction } from "../src/vjster/plugin/actions.js";
import { GlobalSaver, keepOmitted, repairPageWrite } from "../src/vjster/plugin/global-sync.js";
import { Hub, type ServerLike } from "../src/vjster/plugin/hub.js";
import { appMapping, DeckLanguage, deckStrings, normalizeChoice, PLUGIN_LANGUAGES, readLocalization, resolveLanguage } from "../src/vjster/plugin/language.js";
import { globalSettings, type GlobalSettings } from "../src/vjster/plugin/settings.js";
import { EN } from "../src/vjster/plugin/strings.js";
import { LANGUAGE_CHOICE_CASES } from "./helpers/language-choice-cases.js";
import { PLUGIN_DIR } from "./vjster-languages.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasFile = (lang: string) => readLocalization(lang, PLUGIN_DIR) !== null;
const IDS = ["abcdefghijklmnopabcdefghijklmnop", "ponmlkjihgfedcbaponmlkjihgfedcba"];
const TOKEN = "0123456789abcdef0123456789abcdef";

describe("the Language choice resolves as Fadester's does (D-L2)", () => {
  it("lists Stream Deck's eight languages and Dutch, as Fadester does", async () => {
    const { PLUGIN_LANGUAGES: fadester } = await import("../src/i18n/strings.js");
    expect([...PLUGIN_LANGUAGES]).toEqual([...fadester]);
  });

  for (const c of LANGUAGE_CHOICE_CASES) {
    it(`stored ${JSON.stringify(c.stored)} with Stream Deck in ${c.app} draws ${c.resolved}`, () => {
      const mine = normalizeChoice(c.stored);
      expect(mine).toEqual({ choice: c.choice, unknown: c.unknown });
      expect(resolveLanguage(mine.choice, c.app, hasFile)).toBe(c.resolved);
      // The same case through Fadester's resolver.
      const theirs = fadesterChoice(c.stored);
      expect(theirs).toEqual(mine);
      expect(fadesterResolve(theirs.choice, c.app)).toBe(c.resolved);
    });
  }
});

describe("VJster's own Automatic baseline (R-LANG-2)", () => {
  it("keeps today's rule: the exact code, its base, then English; zh-CN stays English", () => {
    expect(appMapping("zh-CN", hasFile)).toBe("en");
    expect(appMapping("zh_CN", hasFile)).toBe("zh_CN");
    expect(appMapping("de_AT", hasFile)).toBe("de");
    expect(appMapping("de-AT", hasFile)).toBe("de");
    expect(appMapping("it", hasFile)).toBe("en");
    expect(appMapping("", hasFile)).toBe("en");
    expect(appMapping(undefined, hasFile)).toBe("en");
    // Dutch is a choice, never Automatic's guess: until nl.json exists, Stream Deck in nl stays English.
    expect(appMapping("nl", () => false)).toBe("en");
  });

  it("reads only language codes, never a path", () => {
    expect(readLocalization("de", PLUGIN_DIR)).not.toBeNull();
    expect(readLocalization("../en", PLUGIN_DIR)).toBeNull();
    expect(readLocalization("en/../de", PLUGIN_DIR)).toBeNull();
    expect(readLocalization("xx", PLUGIN_DIR)).toBeNull();
  });

  it("builds the same deck words as the SDK's lookup did, from the files", () => {
    const de = readLocalization("de", PLUGIN_DIR)!;
    const words = deckStrings("de_AT", (l) => readLocalization(l, PLUGIN_DIR));
    expect(words.pinTab).toBe(de.pinTab);
    expect(deckStrings("zh-CN", (l) => readLocalization(l, PLUGIN_DIR))).toEqual({ ...EN });
  });
});

/** A DeckLanguage over tables in memory. */
function deckOver(tables: Record<string, Record<string, unknown>>, appLanguage = "en", log?: (m: string) => void) {
  return new DeckLanguage({ appLanguage, dir: "unused", read: (l) => tables[l] ?? null, log });
}

describe("the deck words follow the choice (R-LANG-4, R-LANG-5)", () => {
  const tables = {
    en: { pinTab: "PIN TAB", paused: "PAUSED" },
    de: { pinTab: "ANHEFTEN", paused: "PAUSE", playing: "   ", speed: "speed", captionObs: "OBS" }
  };

  it("changes the one table in place and tells the listeners once per change", () => {
    const deck = deckOver(tables);
    const table = deck.strings;
    let told = 0;
    deck.onChange(() => told++);
    expect(deck.apply(undefined)).toBe(false);
    expect(deck.apply("auto")).toBe(false);
    expect(told).toBe(0);
    expect(deck.apply("de")).toBe(true);
    expect(deck.strings).toBe(table);
    expect(table.pinTab).toBe("ANHEFTEN");
    expect(deck.apply("de")).toBe(false);
    expect(told).toBe(1);
    expect(deck.apply("auto")).toBe(true);
    expect(table.pinTab).toBe("PIN TAB");
    expect(told).toBe(2);
  });

  it("gives English for a blank text, a key echo and a dropped placeholder", () => {
    const deck = deckOver(tables);
    deck.apply("de");
    expect(deck.strings.playing).toBe(EN.playing);
    expect(deck.strings.speed).toBe(EN.speed);
    expect(deck.strings.captionObs).toBe(EN.captionObs);
    expect(deck.strings.paused).toBe("PAUSE");
  });

  it("draws Dutch from nl.json, English where it has no file yet", () => {
    const deck = deckOver(tables);
    deck.apply("nl");
    expect(deck.resolved).toBe("nl");
    expect(deck.choice).toBe("nl");
    expect(deck.strings).toEqual({ ...EN });
    const withDutch = deckOver({ ...tables, nl: { pinTab: "VASTZETTEN" } });
    withDutch.apply("nl");
    expect(withDutch.strings.pinTab).toBe("VASTZETTEN");
  });

  it("treats an unknown value as Automatic, logged once without the value", () => {
    const logged: string[] = [];
    const deck = deckOver(tables, "de", (m) => logged.push(m));
    expect(deck.resolved).toBe("de");
    expect(deck.apply("pt_BR")).toBe(false);
    deck.apply("NL");
    deck.apply(42);
    expect(deck.choice).toBe("auto");
    expect(deck.resolved).toBe("de");
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toMatch(/pt_BR|NL|42/);
  });
});

/** A link server that never connects, for a hub the actions can use. */
function idleServer(): ServerLike {
  let running = false;
  return {
    get running() {
      return running;
    },
    async start() {
      running = true;
    },
    async stop() {
      running = false;
    },
    on: () => () => undefined,
    isConnected: () => false,
    send: () => null
  };
}

/** A key on the deck as the SDK hands it to an action. */
function key(id: string, images: Map<string, string>) {
  return {
    id,
    isDial: () => false,
    setImage: (uri: string) => {
      images.set(id, decodeURIComponent(uri.slice(uri.indexOf(",") + 1)));
      return Promise.resolve();
    },
    showAlert: () => Promise.resolve()
  };
}

describe("a change redraws every instance (R-LANG-4)", () => {
  it("draws every key of every action again in the new language", async () => {
    const deck = deckOver({ en: {}, de: { pinTab: "ANHEFTEN", paused: "PAUSE", playing: "LÄUFT" } });
    const hub = new Hub({ port: 1 }, () => idleServer(), 0);
    const actions = [new PinAction(hub, deck.strings, deck), new TransportAction(hub, deck.strings, deck)];
    const images = new Map<string, string>();
    const contexts = ["pin-1", "pin-2", "transport-1", "transport-2"];
    for (const [i, id] of contexts.entries()) {
      const action = actions[i < 2 ? 0 : 1];
      action.onWillAppear({ action: key(id, images), payload: { settings: {} } } as never);
    }
    await sleep(250);
    expect(images.get("pin-1")).toContain("PIN TAB");
    expect(images.get("transport-2")).toMatch(/PAUSED|PLAYING/);
    deck.apply("de");
    await sleep(250);
    expect(images.get("pin-1")).toContain("ANHEFTEN");
    expect(images.get("pin-2")).toContain("ANHEFTEN");
    expect(images.get("transport-1")).toMatch(/PAUSE|LÄUFT/);
    expect(images.get("transport-2")).not.toMatch(/PAUSED|PLAYING/);
    for (const [i, id] of contexts.entries()) actions[i < 2 ? 0 : 1].onWillDisappear({ action: { id } } as never);
  });
});

/** What the plugin applies, with the allow list, a port, a token and a language. */
function known(extra: Record<string, unknown> = {}): GlobalSettings {
  return globalSettings({ port: 50123, extensionIds: IDS, obsToken: TOKEN, obsAlwaysOn: true, language: "de", ...extra });
}

describe("a settings page's write keeps what it omits (R-LANG-8)", () => {
  it("keeps the port, the allow list, the language, keep-on and the token when the page had no settings yet", () => {
    // The page changed language before Stream Deck sent it the global settings, then ticked keep-on: it writes only that.
    const { settings, changed } = repairPageWrite({ obsAlwaysOn: false }, known(), () => "f".repeat(32));
    expect(changed).toBe(true);
    expect(settings).toEqual({ obsAlwaysOn: false, port: 50123, extensionIds: IDS, language: "de", obsToken: TOKEN });
  });

  it("keeps the language when a stale page copy has none", () => {
    const stale = { port: 50123, extensionIds: IDS, obsToken: TOKEN, obsAlwaysOn: true };
    const { settings, changed } = repairPageWrite(stale, known({ language: "nl" }), () => "f".repeat(32));
    expect(changed).toBe(true);
    expect(globalSettings(settings).language).toBe("nl");
  });

  it("keeps an unknown stored language as stored until the next pick (R-LANG-5)", () => {
    expect(keepOmitted({}, known({ language: "pt_BR" })).language).toBe("pt_BR");
    expect(keepOmitted({}, known({ language: undefined }))).not.toHaveProperty("language");
  });

  it("takes what the page did write, an emptied allow list included", () => {
    const { settings, changed } = repairPageWrite({ port: 50124, extensionIds: [], obsToken: TOKEN, obsAlwaysOn: true, language: "fr" }, known(), () => "x");
    expect(changed).toBe(false);
    expect(settings.extensionIds).toEqual([]);
    expect(settings.port).toBe(50124);
    expect(settings.language).toBe("fr");
  });

  it("makes a token when neither the page nor the plugin has one", () => {
    expect(repairPageWrite({}, known({ obsToken: undefined }), () => "e".repeat(32)).settings.obsToken).toBe("e".repeat(32));
  });
});

/** A pretend Stream Deck store for the saver, with a plugin that applies what is saved. */
function store(initial: JsonObject, read?: () => Promise<JsonObject>) {
  let stored: JsonObject = { ...initial };
  let current = globalSettings(stored);
  const writes: JsonObject[] = [];
  const saver = new GlobalSaver({
    read: read ?? (async () => ({ ...stored })),
    write: async (s) => {
      await sleep(1);
      writes.push({ ...s });
      stored = { ...s };
    },
    current: () => current,
    apply: async (s) => {
      current = s;
    },
    readTimeoutMs: 20
  });
  return {
    saver,
    writes,
    stored: () => stored,
    /** A settings page wrote: Stream Deck stores it and the plugin applies it. */
    pageWrite(s: JsonObject) {
      stored = { ...s };
      current = globalSettings(stored);
    }
  };
}

describe("the plugin's own saves never lose a key (R-LANG-8)", () => {
  it("keeps both when the keep-on auto-save races a language save", async () => {
    const s = store({ port: 50123, extensionIds: IDS, obsToken: TOKEN });
    await Promise.all([s.saver.save({ obsAlwaysOn: true }), s.saver.save({ language: "de" })]);
    expect(s.stored()).toEqual({ port: 50123, extensionIds: IDS, obsToken: TOKEN, obsAlwaysOn: true, language: "de" });
  });

  it("reads afresh for each save, so a page write in between is kept", async () => {
    const s = store({ port: 50123, extensionIds: IDS, obsToken: TOKEN });
    await s.saver.save({ language: "de" });
    s.pageWrite({ port: 50200, extensionIds: [IDS[0]], obsToken: TOKEN, language: "de" });
    await s.saver.save({ language: "fr" });
    expect(s.stored()).toEqual({ port: 50200, extensionIds: [IDS[0]], obsToken: TOKEN, language: "fr" });
  });

  // The allow list: an empty list lets any extension connect (settings.ts), so no language change may write one
  // where the stored or known list has ids, whatever the read gives back.
  const reads: [string, (stored: JsonObject) => Promise<JsonObject>][] = [
    ["a fresh read", async (stored) => ({ ...stored })],
    ["a read with no allow list", async (stored) => Object.fromEntries(Object.entries(stored).filter(([k]) => k !== "extensionIds"))],
    ["a read with an empty allow list", async (stored) => ({ ...stored, extensionIds: [] })],
    ["a read whose allow list holds no id", async (stored) => ({ ...stored, extensionIds: " , " })],
    ["a read whose allow list is not a list", async (stored) => ({ ...stored, extensionIds: 7 })],
    ["an empty read", async () => ({})],
    ["a read that fails", async () => Promise.reject(new Error("no answer"))],
    ["a read that never answers", () => new Promise(() => undefined)],
    ["a read that is not an object", async () => null as never]
  ];
  for (const [name, read] of reads) {
    it(`never writes an empty allow list for a language change, after ${name}`, async () => {
      const initial: JsonObject = { port: 50123, extensionIds: IDS, obsToken: TOKEN, obsAlwaysOn: true };
      let stored: JsonObject = initial;
      const s = store(initial, () => read(stored));
      for (const choice of ["de", "nl", "auto", "zh_TW", "en"]) {
        await s.saver.save({ language: choice });
        stored = s.stored();
      }
      expect(s.writes).toHaveLength(5);
      for (const w of s.writes) {
        expect(w.extensionIds).toEqual(IDS);
        expect(w.port).toBe(50123);
        expect(w.obsToken).toBe(TOKEN);
      }
      expect(s.writes.map((w) => w.language)).toEqual(["de", "nl", "auto", "zh_TW", "en"]);
    });
  }

  it("keeps a list the settings page emptied on purpose, and a stored list it has not applied yet", async () => {
    const s = store({ port: 50123, extensionIds: IDS, obsToken: TOKEN });
    s.pageWrite({ port: 50123, extensionIds: [], obsToken: TOKEN });
    await s.saver.save({ language: "de" });
    expect(s.writes.at(-1)!.extensionIds).toEqual([]);
    // The page stored a new list the plugin has not applied: the stored one stands, not the known one.
    const t = store({ port: 50123, extensionIds: IDS, obsToken: TOKEN }, async () => ({ port: 50123, extensionIds: [IDS[0].replace("a", "b")], obsToken: TOKEN }));
    await t.saver.save({ language: "fr" });
    expect(t.writes.at(-1)!.extensionIds).toEqual([IDS[0].replace("a", "b")]);
  });

  it("leaves the allow list out when there is none, so any extension stays allowed as before", async () => {
    const s = store({ port: 50123, obsToken: TOKEN });
    await s.saver.save({ language: "de" });
    expect(s.writes[0]).not.toHaveProperty("extensionIds");
  });

  it("goes on after a failed write", async () => {
    let fail = true;
    let stored: JsonObject = { extensionIds: IDS };
    const saver = new GlobalSaver({
      read: async () => ({ ...stored }),
      write: async (s) => {
        if (fail) {
          fail = false;
          throw new Error("refused");
        }
        stored = { ...s };
      },
      current: () => globalSettings(stored),
      apply: async () => undefined
    });
    await expect(saver.save({ language: "de" })).rejects.toThrow("refused");
    await saver.save({ language: "fr" });
    expect(stored).toMatchObject({ extensionIds: IDS, language: "fr" });
  });
});
