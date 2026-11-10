// SPDX-License-Identifier: GPL-2.0-or-later
// The VJster settings page's Language section (docs/vjster/PLAN.md 9, design
// 4 to 6; R-LANG-3..6, R-LANG-8): the plugin keeps the choice and the page
// only asks for a change; the plugin's answer re-words the page in place,
// keeping what the operator typed; the page never writes the language through
// its own copy of the settings, and what that copy omits the plugin keeps;
// malformed page texts show English.
import type { JsonObject } from "@elgato/utils";
import { describe, expect, it } from "vitest";
import { piTables } from "../scripts/vjster/make-pi-strings.js";
import { repairPageWrite } from "../src/vjster/plugin/global-sync.js";
import { globalSettings } from "../src/vjster/plugin/settings.js";
import { fieldTexts, loadPage, type FakeElement } from "./helpers/vjster-pi-dom.js";

const tables = piTables();
const IDS = ["abcdefghijklmnopabcdefghijklmnop"];
const TOKEN = "0123456789abcdef0123456789abcdef";

/** The first element in the rendered fields that matches. */
function find(e: FakeElement, match: (x: FakeElement) => boolean): FakeElement | undefined {
  return match(e) ? e : e.children.map((c) => find(c, match)).find(Boolean);
}

const toPlugin = (sent: Record<string, unknown>[]) =>
  sent.filter((m) => m.event === "sendToPlugin").map((m) => (m as { payload: Record<string, unknown> }).payload);
const globalWrites = (sent: Record<string, unknown>[]) =>
  sent.filter((m) => m.event === "setGlobalSettings").map((m) => (m as { payload: Record<string, unknown> }).payload);

describe("the Language section (R-LANG-1, R-LANG-6)", () => {
  it("offers Automatic and the nine languages in their own names, with the note", () => {
    const page = loadPage("en", "speed");
    expect(page.byId("language")).toBeDefined();
    const html = page.all.filter((e) => e.getAttribute("data-i18n") === "languageNote");
    expect(html.map((e) => e.textContent)).toEqual([tables.en.pi.languageNote]);
    expect(tables.en.pi.languageNote).toBe(
      "Applies to all VJster controls. Stream Deck's own menus, action list, tooltips and dial hints stay in Stream Deck's language. The OBS page and the Chrome extension keep their own language."
    );
    expect(tables.en.pi.languageBadge).toBe("all VJster controls");
  });

  it("stays disabled until the plugin says which language holds", () => {
    const page = loadPage("en", "speed");
    const picker = page.byId("language") as FakeElement & { disabled?: boolean };
    expect(picker.getAttribute("disabled")).not.toBeNull();
    page.toPage({ event: "language", choice: "auto", resolved: "en" });
    expect(picker.disabled).toBe(false);
    expect(picker.value).toBe("auto");
  });

  it("asks the plugin for a change, writes no settings itself, and changes only on the answer (M-V-92)", () => {
    const page = loadPage("en", "pin");
    const picker = page.byId("language");
    page.toPage({ event: "language", choice: "auto", resolved: "en" });
    picker.value = "de";
    picker.listeners.change[0]({ target: picker });
    expect(toPlugin(page.sent).at(-1)).toEqual({ event: "setLanguage", choice: "de" });
    expect(globalWrites(page.sent)).toEqual([]);
    expect(page.byId("save-global").textContent).toBe("Save link settings");
    page.toPage({ event: "language", choice: "de", resolved: "de" });
    expect(page.root.getAttribute("lang")).toBe("de");
    expect(page.byId("save-global").textContent).toBe("Verbindung speichern");
    expect(picker.value).toBe("de");
  });

  it("shows Automatic for a choice it does not offer, and back to Automatic from a fixed language", () => {
    const page = loadPage("de", "pin");
    const picker = page.byId("language");
    page.toPage({ event: "language", choice: "en", resolved: "en" });
    expect(picker.value).toBe("en");
    expect(page.byId("save-global").textContent).toBe("Save link settings");
    page.toPage({ event: "language", choice: "pt_BR", resolved: "de" });
    expect(picker.value).toBe("auto");
    expect(page.byId("save-global").textContent).toBe("Verbindung speichern");
  });

  it("takes Dutch as the page language, from nl.json's page table", () => {
    const page = loadPage("de", "pin");
    page.toPage({ event: "language", choice: "nl", resolved: "nl" });
    expect(page.root.getAttribute("lang")).toBe("nl");
    expect(tables.nl?.pi.saveLink).toBe("Verbinding opslaan");
    expect(page.byId("save-global").textContent).toBe("Verbinding opslaan");
  });

  it("ignores a resolved language that is not one of the nine", () => {
    const page = loadPage("de", "pin");
    page.toPage({ event: "language", choice: "auto", resolved: "../en" });
    expect(page.root.getAttribute("lang")).toBe("de");
  });
});

describe("a language change re-words the page in place (R-LANG-4)", () => {
  it("re-labels the action fields and keeps unfinished label and number input", () => {
    const speed = loadPage("en", "speed", { label: "WARP" });
    const label = find(speed.fields, (e) => e.tag === "input" && e.getAttribute("maxlength") === "16")!;
    label.value = "WAR"; // typed, not yet saved (no change event)
    speed.toPage({ event: "language", choice: "de", resolved: "de" });
    expect(fieldTexts(speed.fields)).toEqual(expect.arrayContaining(["Diese Aktion", "Beschriftung", "Schritt beim Drehen", "Chrome-Tab", "OBS-Seite"]));
    expect(find(speed.fields, (e) => e.tag === "input" && e.getAttribute("maxlength") === "16")).toBe(label);
    expect(label.value).toBe("WAR");
    expect(label.getAttribute("placeholder")).toBe("TEMPO");

    const preset = loadPage("en", "speed-preset", { rate: 2 });
    const rate = find(preset.fields, (e) => e.tag === "input" && e.getAttribute("type") === "number")!;
    rate.value = "2.5";
    preset.toPage({ event: "language", choice: "de", resolved: "de" });
    expect(fieldTexts(preset.fields)).toContain("Tempo (0.1 bis 16)");
    expect(rate.value).toBe("2.5");
    expect(preset.sent.filter((m) => m.event === "setSettings")).toEqual([]);
  });

  it("re-words the connected, bad-id and OBS status from the last report and asks again", () => {
    const page = loadPage("en", "transport");
    page.toPage({ event: "status", port: 50123, browser: "connected", extensionIds: IDS, badIds: 0, obsPage: true, obs: "connected" });
    expect(page.byId("status").textContent).toBe("Chrome extension connected");
    const before = toPlugin(page.sent).filter((m) => m.event === "status").length;
    page.toPage({ event: "language", choice: "de", resolved: "de" });
    expect(page.byId("status").textContent).toBe("Chrome-Erweiterung verbunden");
    expect(page.byId("obs-status").textContent).toBe("OBS-Seite verbunden");
    expect(toPlugin(page.sent).filter((m) => m.event === "status").length).toBe(before + 1);

    page.toPage({ event: "status", port: 50123, browser: "connected", extensionIds: ["a", "b"], badIds: 1, obsPage: true, obs: "page-off" });
    page.toPage({ event: "language", choice: "fr", resolved: "fr" });
    expect(page.byId("status").textContent).toBe(tables.fr.pi.badIdOne.replace("{n}", "1"));
    expect(page.byId("obs-status").textContent).toBe(tables.fr.pi.obsWaiting);
  });

  it("leaves typed port and extension ids alone until they are saved, and while the box has focus", () => {
    const page = loadPage("en", "pin");
    page.toPage({ event: "status", port: 50123, browser: "connected", extensionIds: IDS, badIds: 0, obsPage: true, obs: "connected" });
    expect(page.byId("port").value).toBe("50123");
    page.byId("ext").value = "abc";
    page.byId("ext").listeners.input[0]({});
    page.toPage({ event: "language", choice: "de", resolved: "de" });
    page.toPage({ event: "status", port: 50123, browser: "connected", extensionIds: IDS, badIds: 0, obsPage: true, obs: "connected" });
    expect(page.byId("ext").value).toBe("abc");
    expect(page.byId("status").textContent).toBe("Chrome-Erweiterung verbunden");
    // Saved: the next report fills the boxes again.
    page.byId("save-global").listeners.click[0]({});
    page.toPage({ event: "status", port: 50123, browser: "connected", extensionIds: IDS, badIds: 0, obsPage: true, obs: "connected" });
    expect(page.byId("ext").value).toBe(IDS.join(", "));
    // In the port box: left alone.
    page.document.activeElement = page.byId("port");
    page.byId("port").value = "5012";
    page.toPage({ event: "status", port: 50123, browser: "connected", extensionIds: IDS, badIds: 0, obsPage: true, obs: "connected" });
    expect(page.byId("port").value).toBe("5012");
  });
});

describe("the page's writes never lose a key (R-LANG-8)", () => {
  it("changes language before the global settings arrive; a keep-on write then keeps the port and the allow list", () => {
    const page = loadPage("en", "pin");
    page.toPage({ event: "language", choice: "de", resolved: "de" });
    const keepOn = page.byId("obs-always");
    keepOn.checked = true;
    keepOn.listeners.change[0]({ target: keepOn });
    const written = globalWrites(page.sent).at(-1)!;
    expect(written).toEqual({ obsAlwaysOn: true });
    // The plugin keeps what the write omits (standalone.ts's repair).
    const known = globalSettings({ port: 50123, extensionIds: IDS, obsToken: TOKEN, language: "de" });
    const { settings, changed } = repairPageWrite(written as JsonObject, known, () => "f".repeat(32));
    expect(changed).toBe(true);
    expect(settings).toEqual({ obsAlwaysOn: true, port: 50123, extensionIds: IDS, obsToken: TOKEN, language: "de" });
  });

  it("never writes the language through its own copy, even a stale one", () => {
    const page = loadPage("en", "pin");
    page.fromDeck({ event: "didReceiveGlobalSettings", payload: { settings: { port: 50123, extensionIds: IDS, obsToken: TOKEN, language: "de" } } });
    page.toPage({ event: "language", choice: "fr", resolved: "fr" });
    page.toPage({ event: "status", port: 50123, browser: "connected", extensionIds: IDS, badIds: 0, obsPage: true, obs: "connected" });
    const keepOn = page.byId("obs-always");
    keepOn.checked = false;
    keepOn.listeners.change[0]({ target: keepOn });
    page.byId("save-global").listeners.click[0]({});
    const writes = globalWrites(page.sent);
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      expect(w).not.toHaveProperty("language");
      expect(w.extensionIds).toEqual(IDS);
    }
    // The stale copy's "de" never comes back: the plugin keeps the "fr" it saved.
    const known = globalSettings({ port: 50123, extensionIds: IDS, obsToken: TOKEN, language: "fr" });
    expect(repairPageWrite(writes[0] as JsonObject, known, () => "x").settings.language).toBe("fr");
  });
});

describe("the Save link button before the plugin's first report", () => {
  it("writes no port and no empty allow list from boxes the plugin never filled", () => {
    const page = loadPage("en", "pin");
    page.toPage({ event: "language", choice: "de", resolved: "de" });
    page.byId("save-global").listeners.click[0]({});
    expect(globalWrites(page.sent)).toEqual([{}]);
    // Typed by the operator: written as typed, an emptied list included.
    page.byId("ext").value = "";
    page.byId("ext").listeners.input[0]({});
    page.byId("port").value = "50124";
    page.byId("port").listeners.input[0]({});
    page.byId("save-global").listeners.click[0]({});
    expect(globalWrites(page.sent).at(-1)).toEqual({ port: 50124, extensionIds: [] });
  });

  it("writes no allow list when only the port was typed, in a box focused before the first report", () => {
    const page = loadPage("en", "pin");
    page.document.activeElement = page.byId("port");
    page.toPage({ event: "status", port: 50123, browser: "connected", extensionIds: IDS, badIds: 0, obsPage: true, obs: "connected" });
    // The focused port box was left alone; the extension box was filled.
    expect(page.byId("port").value).not.toBe("50123");
    expect(page.byId("ext").value).toBe(IDS.join(", "));
    page.byId("port").value = "50124";
    page.byId("port").listeners.input[0]({});
    page.byId("save-global").listeners.click[0]({});
    expect(globalWrites(page.sent).at(-1)).toEqual({ port: 50124, extensionIds: IDS });
  });

  it("writes no empty allow list when only the port was typed, before any report (M-V-94g)", () => {
    const page = loadPage("en", "pin");
    page.document.activeElement = page.byId("port");
    page.byId("port").value = "50124";
    page.byId("port").listeners.input[0]({});
    page.byId("save-global").listeners.click[0]({});
    expect(globalWrites(page.sent).at(-1)).toEqual({ port: 50124 });
  });

  it("writes no port when only the allow list was typed, before any report", () => {
    const page = loadPage("en", "pin");
    page.document.activeElement = page.byId("ext");
    page.byId("ext").value = IDS[0];
    page.byId("ext").listeners.input[0]({});
    page.byId("save-global").listeners.click[0]({});
    expect(globalWrites(page.sent).at(-1)).toEqual({ extensionIds: IDS });
  });
});

describe("malformed page texts show English (R-LANG-5)", () => {
  it("uses English for a blank text, a key echo and a wrong placeholder", () => {
    const page = loadPage("de", "pin", {}, {
      patchStrings: (t) => {
        t.de.pi.saveLink = "   ";
        t.de.pi.copy = "copy";
        t.de.pi.statusPortInUse = "Port {portnummer} belegt";
        t.de.pi.port = "";
      }
    });
    expect(page.byId("save-global").textContent).toBe("Save link settings");
    expect(page.byId("obs-copy").textContent).toBe("Copy address");
    expect(page.all.find((e) => e.getAttribute("data-i18n") === "port")!.textContent).toBe("Port");
    page.toPage({ event: "status", port: 50123, portInUse: true, browser: "extension-off", extensionIds: [], badIds: 0, obsPage: true, obs: "page-off" });
    expect(page.byId("status").textContent).toBe("Port 50123 is in use. Another program with VJster may be running: Fadester for OBS, the VJster plugin or Fadester Companion. Keep only one.");
    // A good German text still shows.
    expect(page.byId("obs-status").textContent).toBe("Keine OBS-Seite verbunden");
  });
});
