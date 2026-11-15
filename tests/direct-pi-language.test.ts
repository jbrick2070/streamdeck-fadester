// SPDX-License-Identifier: GPL-2.0-or-later
// The Language section of the direct settings pages (PLAN.md 11.3, step L.2; R-LANG-3, R-LANG-4).
// Each test runs a whole shipped page, i18n.js and direct-pi.js included, in a vm with a small DOM.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PLUGIN_LANGUAGES } from "../src/i18n/strings.js";
import { MiniDocument, MiniElement, documentFromPage } from "./helpers/mini-dom.js";
import { PLUGIN_DIR, readLanguageFile } from "./helpers/languages.js";

const UI = join(PLUGIN_DIR, "ui");
const DIRECT_PAGES = readdirSync(UI).filter((name) => name.endsWith(".html")
  && /<script src="direct-pi\.js"><\/script>/.test(readFileSync(join(UI, name), "utf8")));
const MEMORY_KEY = "fadester:resolvedLanguage";
const ENDONYMS = ["English", "Deutsch", "Español", "Français", "日本語", "한국어", "简体中文", "繁體中文", "Nederlands"];
const en = readLanguageFile("en").Localization.pi as Record<string, string>;
const de = readLanguageFile("de").Localization.pi as Record<string, string>;
const nl = readLanguageFile("nl").Localization.pi as Record<string, string>;

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

interface PageOptions {
  appLanguage?: string;
  memory?: Record<string, string>;
  storageThrows?: boolean;
  settings?: Record<string, unknown>;
}

/** Opens a shipped direct page as Stream Deck does: scripts in page order, then the socket handshake. */
function openPage(page: string, options: PageOptions = {}) {
  const html = readFileSync(join(UI, page), "utf8");
  const document: MiniDocument = documentFromPage(html);
  const memory = new Map(Object.entries(options.memory ?? {}));
  const localStorage = options.storageThrows
    ? { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }
    : { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, String(value)); } };
  // The page's timers, run by the test when it says so.
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const setTimeout = (fn: () => void): number => { timers.set(nextTimer, fn); return nextTimer++; };
  const clearTimeout = (id: number): void => { timers.delete(id); };
  const context: Record<string, unknown> = { document, WebSocket: FakeSocket, console, localStorage, setTimeout, clearTimeout };
  context.window = context;
  createContext(context);
  sockets = [];
  for (const [, src, inline] of html.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g)) {
    runInContext(src ? readFileSync(join(UI, src), "utf8") : inline, context, { filename: src ?? `${page} (inline)` });
  }
  const connect = context.connectElgatoStreamDeckSocket as (...args: string[]) => void;
  const action = `io.github.jbrick2070.fadester-for-obs.${page.replace(/\.html$/, "")}`;
  connect("28196", "pi-uuid", "registerPropertyInspector",
    JSON.stringify({ application: { language: options.appLanguage ?? "en" } }),
    JSON.stringify({ action, payload: { settings: options.settings ?? {}, controller: "Keypad" } }));
  const socket = sockets[0];
  socket.onopen?.();
  const byId = (id: string): MiniElement => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`${page}: no #${id}`);
    return element;
  };
  return {
    document, socket, memory, byId,
    /** Runs every timer the page has waiting. */
    runTimers(): void {
      const due = [...timers.values()];
      timers.clear();
      for (const fn of due) fn();
    },
    i18n: context.FadesterI18n as { language(): string; t(key: string): string },
    /** A message from the plugin, as Stream Deck relays it. */
    receive(payload: Record<string, unknown>): void {
      socket.onmessage?.({ data: JSON.stringify({ event: "sendToPropertyInspector", payload }) });
    },
    toPlugin: () => socket.sent.filter((message) => message.event === "sendToPlugin").map((message) => message.payload as Record<string, unknown>)
  };
}

/** A `directObsState` as `DirectObsPropertyInspectorBridge.broadcast` sends it. */
function state(language: { choice: unknown; resolved: unknown } | undefined, extra: Record<string, unknown> = {}) {
  return {
    event: "directObsState",
    status: { kind: "connected", sentence: "Connected", cellReason: "", obsVersion: "33.0.0" },
    connection: { host: "127.0.0.1", port: 4455, passwordSet: true },
    catalog: { inputVolumes: { Mic: 1 }, studioMode: false },
    automaticInputs: { __audio_main__: "Desktop Audio", __audio_mic__: "Mic", __audio_aux__: "", __audio_input_2__: "" },
    filterCatalog: {}, filterEpoch: 0, layerScenes: {}, layouts: [],
    ...(language ? { language } : {}),
    ...extra
  };
}

it.each([
  ["obs-fade-key.html", "direct-fade-status", "obs-fade-duration-row"],
  ["obs-fader-dial.html", "direct-target-status", "obs-fader-step-row"]
])("shows owner availability and hides source-only settings for the whole mix on %s", (file, banner, row) => {
  const page = openPage(file, { settings: { target: "all_inputs" } });
  for (const [availability, key] of [["offline", "mixOffline"], ["disabled", "mixDisabled"], ["ready", "mixHint"]]) {
    page.receive(state({ choice: "de", resolved: "de" }, { wholeMix: { availability, db: -6 } }));
    expect(page.byId(banner).textContent).toBe(de[key]);
    expect(page.byId(row).style.display).toBe("none");
  }
  if (file === "obs-fade-key.html") {
    expect(page.byId("obs-fade-up").textContent).toBe(de.mixRestore);
    expect(page.byId("obs-fade-down").textContent).toBe(de.mixFadeOut);
  }
});

/**
 * Every English page text still shown that the target language (German unless
 * named) has its own word for: the elements' own text, placeholders and labels.
 * Values with placeholders never match, so this covers whole texts only.
 */
function englishLeft(document: MiniDocument, target: Record<string, string> = de): string[] {
  const english = new Set(Object.keys(en).filter((key) => target[key] && target[key] !== en[key]).map((key) => en[key]));
  const shown: string[] = [];
  for (const element of document.documentElement.descendants()) {
    if (element.tag === "script" || element.tag === "style") continue;
    const own = element.childNodes.filter((node) => !(node instanceof MiniElement)).map((node) => node.textContent).join("").trim();
    for (const text of [own, element.getAttribute("placeholder"), element.getAttribute("aria-label"), element.getAttribute("label")]) {
      if (text && english.has(text.trim())) shown.push(`${element.tag}#${element.id}: ${text.trim()}`);
    }
  }
  return shown;
}

function headings(document: MiniDocument): string[] {
  return document.querySelectorAll("h3").map((heading) => heading.textContent);
}

describe("the direct pages' Language section (R-LANG-1, R-LANG-6)", () => {
  it("finds every direct page", () => {
    expect(DIRECT_PAGES.length).toBe(9);
  });

  it.each(DIRECT_PAGES)("%s has the section: Automatic, the nine by their own names, the note", (page) => {
    const h = openPage(page);
    const select = h.byId("direct-language");
    expect(select.tag).toBe("select");
    expect(select.options.map((option) => option.value)).toEqual(["auto", ...PLUGIN_LANGUAGES]);
    expect(select.options.map((option) => option.textContent)).toEqual([en.languageAuto, ...ENDONYMS]);
    expect(select.value).toBe("auto");
    expect(h.byId("direct-language-note").textContent).toBe(en.languageNote);
    // Its own heading, plugin-wide, before the OBS connection.
    const all = headings(h.document);
    const language = all.indexOf(`${en.languageHeading} ${en.scopeAllControls}`);
    expect(language).toBeGreaterThanOrEqual(0);
    expect(language).toBeLessThan(all.indexOf(`${en.connHeading} ${en.scopeAllControls}`));
  });

  it("the endonyms are never translated", () => {
    const h = openPage("obs-fade-key.html");
    h.receive(state({ choice: "de", resolved: "de" }));
    // Since step L.4 German has its own Automatic text.
    expect(de.languageAuto).toBe("Automatisch (Sprache von Stream Deck)");
    expect(h.byId("direct-language").options.map((option) => option.textContent)).toEqual([de.languageAuto, ...ENDONYMS]);
  });
});

describe("a Language change (R-LANG-4)", () => {
  it("is sent to the plugin, not written by the page", () => {
    const h = openPage("obs-fade-key.html");
    h.receive(state({ choice: "auto", resolved: "en" }));
    const before = h.socket.sent.length;
    const select = h.byId("direct-language");
    select.value = "nl";
    select.onchange?.();
    const sent = h.socket.sent.slice(before);
    expect(sent).toEqual([{ action: "io.github.jbrick2070.fadester-for-obs.obs-fade-key", event: "sendToPlugin", context: "pi-uuid",
      payload: { event: "setLanguageChoice", choice: "nl" } }]);
    // The page neither saves the choice in the control's settings nor in the global settings.
    expect(h.socket.sent.some((message) => message.event === "setSettings" || message.event === "setGlobalSettings")).toBe(false);
  });

  it("refills the open page in place when the plugin's broadcast brings another language", () => {
    const h = openPage("obs-fade-key.html", { settings: { inputName: "Gone" } });
    h.receive(state({ choice: "auto", resolved: "en" }));
    expect(h.byId("direct-conn-summary").textContent).toBe(en.connEdit);
    expect(h.byId("direct-fade-status").textContent).toBe(en.fadeInputUnavailable);
    // The operator's page: a host typed but not yet saved (still focused), the layouts section opened,
    // the connection editor closed, and a result banner from an earlier action.
    const host = h.byId("direct-conn-host");
    host.value = "192.168.1.20";
    h.document.activeElement = host;
    const layouts = h.document.querySelectorAll("details").find((details) => details.id !== "direct-conn-editor")!;
    layouts.open = true;
    const editor = h.byId("direct-conn-editor");
    editor.open = false;
    h.receive({ event: "directSetupResult", ok: true });
    expect(h.byId("direct-setup-status").textContent).toBe(en.setupDone);

    h.receive(state({ choice: "de", resolved: "de" }, { connection: { host: "127.0.0.1", port: 4455, passwordSet: true } }));

    expect(h.i18n.language()).toBe("de");
    expect(h.document.documentElement.lang).toBe("de");
    // Static texts.
    expect(headings(h.document)).toContain(`${de.connHeading} ${de.scopeAllControls}`);
    expect(headings(h.document)).toContain(`${de.fadeHeading} ${de.scopeThisKey}`);
    // Dynamic texts: the shared summary and hint, and the page's own banner.
    expect(h.byId("direct-conn-summary").textContent).toBe(de.connEdit);
    expect(h.byId("direct-conn-hint").textContent).toBe(de.connHintSaved);
    expect(h.byId("direct-fade-status").textContent).toBe(de.fadeInputUnavailable);
    expect(h.byId("direct-conn-password").placeholder).toBe(de.passwordPlaceholderSaved);
    // What the operator was doing stays; the one-off banner goes.
    expect(host.value).toBe("192.168.1.20");
    expect(layouts.open).toBe(true);
    expect(editor.open).toBe(false);
    expect(h.byId("direct-setup-status").textContent).toBe("");
    expect(h.byId("direct-setup-status").style.display).toBe("none");
    expect(h.byId("direct-language").value).toBe("de");
  });

  it.each(DIRECT_PAGES)("%s refills every text, static and drawn, into German", (page) => {
    const h = openPage(page);
    h.receive(state({ choice: "auto", resolved: "en" }));
    // Not vacuous: the English page shows texts German translates.
    expect(englishLeft(h.document).length).toBeGreaterThan(0);
    h.receive(state({ choice: "de", resolved: "de" }));
    expect(englishLeft(h.document)).toEqual([]);
    expect(h.byId("direct-conn-summary").textContent).toBe(de.connEdit);
    expect(h.byId("direct-conn-hint").textContent).toBe(de.connHintSaved);
  });

  it.each(DIRECT_PAGES)("%s refills every text, static and drawn, into Dutch (step L.4)", (page) => {
    const h = openPage(page);
    h.receive(state({ choice: "auto", resolved: "en" }));
    expect(englishLeft(h.document, nl).length).toBeGreaterThan(0);
    h.receive(state({ choice: "nl", resolved: "nl" }));
    expect(englishLeft(h.document, nl)).toEqual([]);
    expect(h.byId("direct-conn-summary").textContent).toBe(nl.connEdit);
    expect(h.byId("direct-conn-hint").textContent).toBe(nl.connHintSaved);
  });

  it("refills into Dutch from nl.json's page table, with its own <html lang>", () => {
    const h = openPage("obs-fade-key.html", { appLanguage: "de" });
    h.receive(state({ choice: "nl", resolved: "nl" }));
    expect(h.i18n.language()).toBe("nl");
    expect(h.document.documentElement.lang).toBe("nl");
    expect(headings(h.document)).toContain(`${nl.connHeading} ${nl.scopeAllControls}`);
    expect(headings(h.document)).toContain(`${nl.languageHeading} ${nl.scopeAllControls}`);
    expect(h.byId("direct-language-note").textContent).toBe(nl.languageNote);
    expect(h.byId("direct-language").value).toBe("nl");
    // The select's Automatic is worded, the nine endonyms are not.
    expect(h.byId("direct-language").options.map((option) => option.textContent)).toEqual([nl.languageAuto, ...ENDONYMS]);
  });

  it("keeps a result banner when the language stays the same", () => {
    const h = openPage("obs-fade-key.html");
    h.receive(state({ choice: "auto", resolved: "en" }));
    h.receive({ event: "directSetupResult", ok: true });
    h.receive(state({ choice: "en", resolved: "en" }));
    expect(h.byId("direct-setup-status").textContent).toBe(en.setupDone);
  });
});

describe("the select follows the stored choice", () => {
  it("reopening with a fixed English shows English, not Automatic", () => {
    const h = openPage("obs-fader-dial.html");
    h.receive(state({ choice: "en", resolved: "en" }));
    expect(h.byId("direct-language").value).toBe("en");
    expect(h.byId("direct-language").shownText).toBe("English");
  });

  it("fixed English to Automatic updates the select, with the same language drawn", () => {
    const h = openPage("obs-fader-dial.html");
    // The operator picks German, then English, then Automatic (Stream Deck in English).
    h.receive(state({ choice: "de", resolved: "de" }));
    h.receive(state({ choice: "en", resolved: "en" }));
    expect(h.byId("direct-language").value).toBe("en");
    h.receive(state({ choice: "auto", resolved: "en" }));
    expect(h.byId("direct-language").value).toBe("auto");
    expect(h.i18n.language()).toBe("en");
  });

  it("an unknown stored value shows Automatic", () => {
    const h = openPage("obs-fader-dial.html");
    h.receive(state({ choice: "en", resolved: "en" }));
    h.receive(state({ choice: "pt_BR", resolved: "en" }));
    expect(h.byId("direct-language").value).toBe("auto");
  });

  it("a state without `language` leaves the page as it is", () => {
    const h = openPage("obs-fader-dial.html");
    h.receive(state(undefined));
    expect(h.byId("direct-language").value).toBe("auto");
    expect(h.i18n.language()).toBe("en");
    expect(h.memory.has(MEMORY_KEY)).toBe(false);
  });
});

describe("Automatic on the pages (R-LANG-2)", () => {
  it.each(["nl", "nl-NL", "pt_BR"])("Stream Deck in %s gives English", (appLanguage) => {
    const h = openPage("obs-fade-key.html", { appLanguage });
    expect(h.i18n.language()).toBe("en");
    expect(headings(h.document)).toContain(`${en.connHeading} ${en.scopeAllControls}`);
    h.receive(state({ choice: "auto", resolved: "en" }));
    expect(h.i18n.language()).toBe("en");
  });

  it("Stream Deck in German still gives German, as before", () => {
    const h = openPage("obs-fade-key.html", { appLanguage: "de_AT" });
    expect(h.i18n.language()).toBe("de");
    expect(headings(h.document)).toContain(`${de.connHeading} ${de.scopeAllControls}`);
  });
});

describe("first paint from the remembered language (D-L5, no hold)", () => {
  it("remembers each resolved language under the plugin's own key", () => {
    const h = openPage("obs-fade-key.html");
    h.receive(state({ choice: "de", resolved: "de" }));
    expect(h.memory.get(MEMORY_KEY)).toBe("de");
    h.receive(state({ choice: "auto", resolved: "en" }));
    expect(h.memory.get(MEMORY_KEY)).toBe("en");
    expect([...h.memory.keys()]).toEqual([MEMORY_KEY]);
  });

  it("does not remember a resolved language the page refused", () => {
    const h = openPage("obs-fade-key.html");
    h.receive(state({ choice: "de", resolved: "de" }));
    h.receive(state({ choice: "auto", resolved: "pt_BR" }));
    expect(h.i18n.language()).toBe("de");
    expect(h.memory.get(MEMORY_KEY)).toBe("de");
  });

  it("paints in the remembered language before the plugin answers", () => {
    const h = openPage("obs-fade-key.html", { appLanguage: "en", memory: { [MEMORY_KEY]: "de" } });
    expect(h.i18n.language()).toBe("de");
    expect(h.document.documentElement.lang).toBe("de");
    expect(headings(h.document)).toContain(`${de.connHeading} ${de.scopeAllControls}`);
    // The plugin's first answer settles it.
    h.receive(state({ choice: "auto", resolved: "en" }));
    expect(h.i18n.language()).toBe("en");
    expect(headings(h.document)).toContain(`${en.connHeading} ${en.scopeAllControls}`);
  });

  it.each(["pt_BR", "NL", "nl-NL", "", "{\"lang\":\"de\"}"])("a remembered %j that is not one of the nine gives Stream Deck's language", (stale) => {
    const h = openPage("obs-fade-key.html", { appLanguage: "de", memory: { [MEMORY_KEY]: stale } });
    expect(h.i18n.language()).toBe("de");
  });

  it("another plugin's remembered language is not used", () => {
    const h = openPage("obs-fade-key.html", { appLanguage: "en", memory: { "vjster:resolvedLanguage": "de" } });
    expect(h.i18n.language()).toBe("en");
  });

  it("works without storage", () => {
    const h = openPage("obs-fade-key.html", { appLanguage: "de", storageThrows: true });
    expect(h.i18n.language()).toBe("de");
    h.receive(state({ choice: "fr", resolved: "fr" }));
    expect(h.i18n.language()).toBe("fr");
  });
});

describe("the shared sections say what happened", () => {
  const offline = { status: { kind: "obs_unreachable", sentence: "OBS is off", cellReason: "" } };
  const studioLayout = { slug: "plus-scene-desk", name: "[Studio Mode] Scene Desk +", obsMode: "studio", deviceType: 7 };
  const regularLayout = { slug: "plus-scene-regular", name: "[Regular Mode] Scene Desk +", obsMode: "regular", deviceType: 7 };

  it("Save & test says a test runs until the plugin reports it done, even when the result is the same sentence", () => {
    const h = openPage("obs-fade-key.html");
    h.receive(state({ choice: "auto", resolved: "en" }, offline));
    expect(h.byId("direct-conn-status").textContent).toBe("OBS is off");
    h.byId("direct-conn-test").onclick?.();
    expect(h.toPlugin().map((payload) => payload.event)).toEqual(["directPiReady", "directUpdateGlobalSettings", "directTestConnection"]);
    expect(h.byId("direct-conn-status").textContent).toBe(en.connTesting);
    // The button stays usable: a test never blocks the page.
    expect(h.byId("direct-conn-test").disabled).toBe(false);
    // The state the save sends back, before the test has ended, keeps the line.
    h.receive(state({ choice: "auto", resolved: "en" }, offline));
    expect(h.byId("direct-conn-status").textContent).toBe(en.connTesting);
    // A language change meanwhile words the line anew.
    h.receive(state({ choice: "de", resolved: "de" }, offline));
    expect(h.byId("direct-conn-status").textContent).toBe(de.connTesting);
    h.receive({ event: "directTestDone" });
    expect(h.byId("direct-conn-status").textContent).toBe("OBS is off");
  });

  it("a test the plugin never reports done ends after the page's limit", () => {
    const h = openPage("obs-fade-key.html");
    h.receive(state({ choice: "auto", resolved: "en" }, offline));
    h.byId("direct-conn-test").onclick?.();
    expect(h.byId("direct-conn-status").textContent).toBe(en.connTesting);
    h.runTimers();
    expect(h.byId("direct-conn-status").textContent).toBe("OBS is off");
    // A late report changes nothing.
    h.receive({ event: "directTestDone" });
    expect(h.byId("direct-conn-status").textContent).toBe("OBS is off");
  });

  it("a Studio Mode layout's button says why it is off while OBS is not connected", () => {
    const h = openPage("obs-fade-key.html");
    h.receive(state({ choice: "auto", resolved: "en" }, { ...offline, layouts: [studioLayout, regularLayout] }));
    const picker = h.byId("direct-layout");
    const hint = h.byId("direct-layout-hint");
    picker.value = studioLayout.slug;
    picker.onchange?.();
    expect(h.byId("direct-layout-open").disabled).toBe(true);
    expect(hint.textContent).toBe(en.layoutNeedsObs);
    expect(hint.style.display).toBe("");
    // A regular layout needs no OBS to open: no reason line.
    picker.value = regularLayout.slug;
    picker.onchange?.();
    expect(h.byId("direct-layout-open").disabled).toBe(false);
    expect(hint.style.display).toBe("none");
    // Connected, the Studio layout's button is on and the line goes.
    picker.value = studioLayout.slug;
    h.receive(state({ choice: "auto", resolved: "en" }, { layouts: [studioLayout, regularLayout] }));
    expect(h.byId("direct-layout-open").disabled).toBe(false);
    expect(hint.textContent).toBe("");
    expect(hint.style.display).toBe("none");
  });

  it("opening a layout and preparing Studio Mode each say what was done", () => {
    const h = openPage("obs-fader-dial.html", { settings: { target: "tbar" } });
    h.receive(state({ choice: "auto", resolved: "en" }, { layouts: [regularLayout] }));
    const picker = h.byId("direct-layout");
    picker.value = regularLayout.slug;
    picker.onchange?.();
    h.byId("direct-layout-open").onclick?.();
    expect(h.toPlugin().at(-1)).toEqual({ event: "directActivateLayout", slug: regularLayout.slug, prepareStudio: false });
    h.receive({ event: "directSetupResult", ok: true });
    expect(h.byId("direct-setup-status").textContent).toBe(en.setupDone);
    h.byId("direct-studio-prepare").onclick?.();
    expect(h.toPlugin().at(-1)).toEqual({ event: "directPrepareStudio" });
    h.receive({ event: "directSetupResult", ok: true });
    expect(h.byId("direct-setup-status").textContent).toBe(en.studioPrepared);
    // A failure shows the plugin's own sentence.
    h.byId("direct-layout-open").onclick?.();
    h.receive({ event: "directSetupResult", ok: false, error: "Could not prepare this OBS layout." });
    expect(h.byId("direct-setup-status").textContent).toBe("Could not prepare this OBS layout.");
  });
});
