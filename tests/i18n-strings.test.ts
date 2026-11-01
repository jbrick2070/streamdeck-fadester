// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EN,
  StringKey,
  PLUGIN_LANGUAGES,
  STREAM_DECK_LANGUAGES,
  formatNumber,
  localeTag,
  lookupText,
  setLanguage,
  t,
  translate
} from "../src/i18n/strings.js";
import { templatePlaceholders, wordText } from "../packages/streamdeck-fadester-shared/src/i18n.js";
import { statusCellReason, statusSentence } from "../packages/streamdeck-fadester-shared/src/status-text.js";
import { ObsVendorClient } from "../packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.js";
import { ConnectionStatusInfo } from "../packages/streamdeck-fadester-shared/src/types.js";
import { renderAutoFadeKeySvg, renderDialCellSvg } from "../packages/streamdeck-fadester-shared/src/svg-renderer.js";
import { DirectObsError } from "../src/obs/direct-obs-client.js";
import { normalizeLanguage, readLanguageTable, useStreamDeckLanguage } from "../src/i18n/load.js";
import { buildNeoInfobarFeedback } from "../src/actions/obs-neo-infobar.js";
import { renderDirectDialSvg, renderDirectKeySvg } from "../src/gfx/direct-obs-renderer.js";
import {
  PLUGIN_DIR,
  REQUIRED_LANGUAGES,
  appReadLanguages,
  deckTable,
  languageFilePath,
  presentLanguages,
  readLanguageFile
} from "./helpers/languages.js";

const KEYS = Object.keys(EN) as StringKey[];

function useLanguage(language: string): void {
  setLanguage(language, language === "en" ? null : deckTable(language));
}

afterEach(() => setLanguage("en", null));

describe("language files (R-I18N-5)", () => {
  it("ships every required language, and only the plugin's nine languages", () => {
    const present = presentLanguages();
    for (const language of REQUIRED_LANGUAGES) expect(present, language).toContain(language);
    for (const language of present) expect(PLUGIN_LANGUAGES).toContain(language);
    // Dutch is one of them, though Stream Deck cannot select it (PLAN.md 11.1).
    expect(present).toContain("nl");
    expect(STREAM_DECK_LANGUAGES).not.toContain("nl");
  });

  it.each(presentLanguages())("%s.json is UTF-8 JSON without a BOM and has every deck key with English's placeholders", (language) => {
    const bytes = readFileSync(languageFilePath(language));
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "BOM").toBe(false);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes).length).toBeGreaterThan(0);
    const table = deckTable(language);
    expect(Object.keys(table).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      const value = table[key];
      expect(typeof value, `${language}.${key}`).toBe("string");
      expect((value as string).trim(), `${language}.${key}`).not.toBe("");
      expect(templatePlaceholders(value as string), `${language}.${key}`).toEqual(templatePlaceholders(EN[key]));
    }
  });

  it.each(appReadLanguages())("%s.json has the plugin and every action's Stream Deck texts, in the manifest's shape", (language) => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf8")) as {
      Name: string; Description: string; Category: string;
      Actions: Array<{ UUID: string; Name: string; Tooltip: string; Encoder?: { TriggerDescription?: Record<string, string> } }>;
    };
    const file = readLanguageFile(language);
    // R-ID-1: the product name is not translated.
    expect(file.Name).toBe("Fadester for OBS");
    expect(file.Category).toBe("Fadester for OBS");
    expect(typeof file.Description === "string" && file.Description.trim()).toBeTruthy();
    const uuids = Object.keys(file).filter((key) => !["Name", "Description", "Category", "Localization"].includes(key));
    expect(uuids.sort()).toEqual(manifest.Actions.map((action) => action.UUID).sort());
    for (const action of manifest.Actions) {
      const entry = file[action.UUID] as { Name?: string; Tooltip?: string; Encoder?: { TriggerDescription?: Record<string, string> } };
      expect(entry.Name?.trim(), `${language} ${action.UUID} Name`).toBeTruthy();
      expect(entry.Tooltip?.trim(), `${language} ${action.UUID} Tooltip`).toBeTruthy();
      expect(Object.keys(entry.Encoder?.TriggerDescription ?? {}).sort(), `${language} ${action.UUID} triggers`)
        .toEqual(Object.keys(action.Encoder?.TriggerDescription ?? {}).sort());
      for (const text of Object.values(entry.Encoder?.TriggerDescription ?? {})) expect(text.trim()).not.toBe("");
      if (language === "en") {
        expect(entry.Name).toBe(action.Name);
        expect(entry.Tooltip).toBe(action.Tooltip);
        expect(entry.Encoder?.TriggerDescription ?? {}).toEqual(action.Encoder?.TriggerDescription ?? {});
      }
    }
    if (language === "en") expect(file.Description).toBe(manifest.Description);
  });

  it("nl.json holds Localization only, its manifest texts come in step L.7 (D-L4), and the plugin reads it", () => {
    expect(Object.keys(readLanguageFile("nl"))).toEqual(["Localization"]);
    setLanguage("nl", readLanguageTable("nl", PLUGIN_DIR));
    expect(t("keyReady")).toBe("Gereed");
    expect(t("sceneOpCut")).toBe("Cut");
    expect(t("infobarPreview", { scene: "Camera" })).toBe("VOORBEELD  Camera");
  });

  it("en.json holds the built-in English table exactly", () => {
    expect(deckTable("en")).toEqual({ ...EN });
  });

  it("keys have no dots (the SDK reads dots as paths)", () => {
    for (const key of KEYS) expect(key).not.toContain(".");
  });
});

describe("lookup and fallback", () => {
  it("falls back to English for a missing, empty, key-echo or placeholder-broken text", () => {
    expect(lookupText({}, "sceneRoleIndex")).toBe("Scene {n}");
    expect(lookupText({ sceneRoleIndex: "" }, "sceneRoleIndex")).toBe("Scene {n}");
    expect(lookupText({ sceneRoleIndex: "sceneRoleIndex" }, "sceneRoleIndex")).toBe("Scene {n}");
    expect(lookupText({ sceneRoleIndex: "Szene" }, "sceneRoleIndex")).toBe("Scene {n}");
    expect(lookupText({ sceneRoleIndex: "Szene {count}" }, "sceneRoleIndex")).toBe("Scene {n}");
    expect(lookupText({ sceneRoleIndex: 7 }, "sceneRoleIndex")).toBe("Scene {n}");
    expect(lookupText({ sceneRoleIndex: "Szene {n}" }, "sceneRoleIndex")).toBe("Szene {n}");
  });

  it("takes Stream Deck's language and its file at start, English when it has none", () => {
    expect(normalizeLanguage("de")).toBe("de");
    expect(normalizeLanguage("zh_TW")).toBe("zh_TW");
    expect(normalizeLanguage("zh-CN")).toBe("zh_CN");
    expect(normalizeLanguage("de_AT")).toBe("de");
    expect(normalizeLanguage("pt_BR")).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
    expect(useStreamDeckLanguage("de", PLUGIN_DIR)).toBe("de");
    expect(t("keyReady")).toBe("Bereit");
    expect(readLanguageTable("de", PLUGIN_DIR)).not.toHaveProperty("pi");
    // A language Stream Deck offers but whose file is absent from this folder shows English.
    expect(useStreamDeckLanguage("de", join(PLUGIN_DIR, "ui"))).toBe("de");
    expect(t("keyReady")).toBe("Ready");
    expect(readLanguageTable("manifest", PLUGIN_DIR)).toBeNull();

    expect(normalizeLanguage("zh-Hant-HK")).toBe("zh_TW");
    expect(normalizeLanguage("zh")).toBe("zh_CN");
    // A broken file, or a Localization that is not an object, leaves English in place.
    const broken = mkdtempSync(join(tmpdir(), "fadester-i18n-"));
    try {
      writeFileSync(join(broken, "de.json"), "{ not json");
      writeFileSync(join(broken, "fr.json"), JSON.stringify({ Localization: ["Prêt"] }));
      expect(useStreamDeckLanguage("de", broken)).toBe("de");
      expect(t("keyReady")).toBe("Ready");
      expect(readLanguageTable("fr", broken)).toBeNull();
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });

  it("an unknown language or a missing file shows English", () => {
    setLanguage("xx", null);
    expect(t("keyReady")).toBe("Ready");
    expect(t("sceneRoleIndex", { n: 2 })).toBe("Scene 2");
  });

  it("fills placeholders by name, never by position", () => {
    setLanguage("xx", { layerPosition: "{state}: {i} von {n}" });
    expect(t("layerPosition", { i: 2, n: 5, state: "Sichtbar" })).toBe("Sichtbar: 2 von 5");
  });
});

describe("numbers on the deck (L.1, Fable review item 3)", () => {
  it("Dutch gives the tag nl and a decimal comma, with no Dutch table yet", () => {
    setLanguage("nl", null);
    expect(localeTag()).toBe("nl");
    expect(formatNumber(1.5)).toBe("1,5");
  });

  it("English keeps the point; Stream Deck's zh_CN becomes zh-CN", () => {
    setLanguage("en", null);
    expect(formatNumber(1.5)).toBe("1.5");
    expect(localeTag("zh_CN")).toBe("zh-CN");
  });
});

describe("German on the deck", () => {
  it("draws the Info Bar, keys and dials from the German table", () => {
    useLanguage("de");
    const catalog = {
      scenes: [], sceneDetails: [], groupDetails: [], inputs: [], inputDetails: [], transitions: [], studioMode: false, currentProgramScene: "Opening",
      currentPreviewScene: "", currentTransition: "", inputVolumes: {}, tbarPosition: 0
    };
    expect(buildNeoInfobarFeedback(true, catalog)).toEqual({
      status: "OBS verbunden", live: "LIVE  Opening", preview: "VORSCHAU  Studio-Modus aus"
    });
    const key = renderDirectKeySvg({ connected: true, reason: "", title: "", configured: false });
    expect(key).toContain("OBS-Aktion wählen");
    expect(key).toContain("Inspektor öffnen");
    const dial = renderDirectDialSvg({ connected: true, reason: "", label: "Mic", value: 0.4, configured: true });
    expect(dial).toContain("40 %");
    const mixer = renderDirectDialSvg({
      connected: true, reason: "", label: "", value: 0.5, configured: true, target: "tbar",
      studioMode: true, programSceneName: "A", previewSceneName: "B"
    });
    expect(mixer).toContain("NÄCHSTE");
    expect(mixer).toContain("Drücken: Nächste live schalten");
    expect(mixer).not.toContain("Press to take Next live");
  });

  it("words the Midi Fadester cells through the injected translator", () => {
    useLanguage("de");
    const offline = renderDialCellSvg({ status: { kind: "wrong_password" }, slotId: "crossfader", t: translate });
    expect(offline).toContain("Falsches Passwort");
    const missing = renderAutoFadeKeySvg({
      status: { kind: "connected", fadesterVersion: "0.4.0" }, slotId: "fader_9", to: 1, durationMs: 1000, t: translate
    });
    expect(missing).toContain("Slot fehlt");
    // Without a translator the shared package stays English.
    expect(renderDialCellSvg({ status: { kind: "wrong_password" }, slotId: "crossfader" })).toContain("Wrong password");
  });

  it("words statuses from their kind and parameters at render time", () => {
    const status: ConnectionStatusInfo = {
      kind: "connected", obsVersion: "33.0.0", pluginName: "Midi Fadester", fadesterVersion: "0.4.0", buildCommit: "abc1234"
    };
    expect(statusSentence(status)).toBe("Connected: OBS 33.0.0, Midi Fadester 0.4.0 (abc1234)");
    useLanguage("de");
    expect(statusSentence(status, translate)).toBe("Verbunden: OBS 33.0.0, Midi Fadester 0.4.0 (abc1234)");
    expect(statusCellReason({ kind: "obs_unreachable" }, translate)).toBe("OBS läuft nicht oder WebSocket ist aus");
    expect(statusCellReason(status, translate)).toBe("");
  });
});

describe("own and foreign texts (R-I18N-2)", () => {
  it("translates our own errors and keeps an OBS comment verbatim, even when it reads like ours", () => {
    useLanguage("de");
    const own = new DirectObsError({ key: "errorChooseScene" }, 400);
    expect(own.message).toBe("Choose an existing OBS scene first.");
    expect(wordText(own.text, translate)).toBe("Wählen Sie zuerst eine vorhandene OBS-Szene.");
    const foreign = new DirectObsError("Choose an existing OBS scene first.", 400);
    expect(wordText(foreign.text, translate)).toBe("Choose an existing OBS scene first.");
  });

  it("emits statusChanged when a status parameter changes, not only its kind", () => {
    class Probe extends ObsVendorClient {
      public push(status: ConnectionStatusInfo): void { this.setStatus(status); }
    }
    const probe = new Probe();
    const seen: ConnectionStatusInfo[] = [];
    probe.on("statusChanged", (status: ConnectionStatusInfo) => seen.push(status));
    probe.push({ kind: "connected", obsVersion: "33.0.0", pluginName: "Midi Fadester", fadesterVersion: "0.4.0" });
    probe.push({ kind: "connected", obsVersion: "33.0.0", pluginName: "Midi Fadester", fadesterVersion: "0.4.0" });
    probe.push({ kind: "connected", obsVersion: "33.0.0", pluginName: "Midi Fadester", fadesterVersion: "0.4.1" });
    expect(seen.map((status) => status.fadesterVersion)).toEqual(["0.4.0", "0.4.1"]);
  });

  it("the German table never repeats an English text where the words differ in German", () => {
    const de = readLanguageFile("de").Localization;
    // Kept terms (R-I18N-3) and placeholders-only templates may equal English.
    const kept = new Set(["Fadester", "Fader", "OBS", "LIVE", "Normal", "Linear", "Status", "—"]);
    for (const key of KEYS) {
      const english = EN[key];
      const stripped = english.replace(/\{[A-Za-z0-9_]+\}/g, "").replace(/[\s·:/()%,.—'-]/g, "");
      if (!stripped || kept.has(stripped)) continue;
      expect(de[key], key).not.toBe(english);
    }
  });
});
