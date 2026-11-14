// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Language setting on the deck (PLAN.md 11 step L.1, R-LANG-1..4): the
 * resolver, the merged save queue, start-up, the page's pick, the redraw of
 * every visible control, and the filter lists worded at each broadcast.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { decodeSvgUri } from "./helpers/svg-text.js";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EN, PLUGIN_LANGUAGES, STREAM_DECK_LANGUAGES, currentLanguage, onLanguageChanged, setLanguage, t, translatorFor } from "../src/i18n/strings.js";
import { CURVE_LABELS, TARGET_MODE_LABELS } from "../src/types/contract.js";
import { useStreamDeckLanguage } from "../src/i18n/load.js";
import { LanguageChoiceController, normalizeChoice, resolveLanguage } from "../src/i18n/language-choice.js";
import { GlobalSettingsPort, GlobalSettingsStore, NOT_READ_MESSAGE, NOT_SAVED_MESSAGE, START_READ_TIMEOUT_MS, connectionChange, connectionSaver } from "../src/settings/global-store.js";
import type { FadesterGlobalSettings } from "../src/types/settings.js";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { LayerController } from "../src/control/layer-controller.js";
import { FilterController } from "../src/control/filter-controller.js";
import { VisualSafety } from "../src/control/visual-safety.js";
import { FaderDialAction } from "../src/actions/fader-dial.js";
import { AutoFadeKeyAction } from "../src/actions/auto-fade-key.js";
import { ObsFaderDialAction } from "../src/actions/obs-fader-dial.js";
import { ObsFadeKeyAction } from "../src/actions/obs-fade-key.js";
import { ObsSceneTransitionKeyAction } from "../src/actions/obs-scene-transition-key.js";
import { ObsLayerControlAction } from "../src/actions/obs-layer-control.js";
import { ObsNeoInfobarAction } from "../src/actions/obs-neo-infobar.js";
import { PlaylisterTransportKeyAction } from "../src/actions/playlister-transport-key.js";
import { ObsFilterControlAction } from "../src/actions/obs-filter-control.js";
import { VisualPanicKeyAction } from "../src/actions/visual-panic-key.js";
import { VisualMeterAction } from "../src/actions/visual-meter.js";
import { VisualSignals } from "../src/control/visual-signals.js";
import { DirectObsPropertyInspectorBridge, InspectorFilterCatalog } from "../src/pi/direct-obs-bridge.js";
import { PropertyInspectorBridge } from "../src/pi/pi-bridge.js";
import { FakeObsServer, VS_MODULATOR_KIND, VS_SHADER_KIND } from "./helpers/fake-obs-server.js";
import { deckTable } from "./helpers/languages.js";
import { LANGUAGE_CHOICE_CASES } from "./helpers/language-choice-cases.js";

/** A stand-in Dutch table: every English text marked, placeholders kept (the real `nl.json` comes in L.4). */
const FIXTURE_NL: Record<string, string> = Object.fromEntries(Object.entries(EN).map(([key, text]) => [key, `NL ${text}`]));

let fixtureDir = "";

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "fadester-language-choice-"));
  writeFileSync(join(fixtureDir, "nl.json"), JSON.stringify({ Localization: { ...FIXTURE_NL, pi: { pageOnly: "x" } } }));
  writeFileSync(join(fixtureDir, "de.json"), JSON.stringify({ Localization: deckTable("de") }));
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

/** Stream Deck's global settings as the plugin sees them: a write replaces the whole object, and nothing is echoed. */
class FakeSettingsPort implements GlobalSettingsPort {
  public data: FadesterGlobalSettings;
  public readonly writes: FadesterGlobalSettings[] = [];
  public reads = 0;
  public constructor(initial: FadesterGlobalSettings = {}, private readonly writeDelayMs = 0) {
    this.data = { ...initial };
  }
  public async getGlobalSettings(): Promise<FadesterGlobalSettings> {
    this.reads++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ...this.data };
  }
  public async setGlobalSettings(settings: FadesterGlobalSettings): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
    this.data = { ...settings };
    this.writes.push({ ...settings });
  }
}

const CONNECTION = { host: "10.0.0.7", port: 4460, password: "s3cret" };

beforeEach(() => {
  setLanguage("en", null);
});

afterEach(() => {
  vi.useRealTimers();
  setLanguage("en", null);
});

describe("the resolver", () => {
  it("offers Stream Deck's languages and Dutch", () => {
    expect([...PLUGIN_LANGUAGES]).toEqual([...STREAM_DECK_LANGUAGES, "nl"]);
  });

  it.each(LANGUAGE_CHOICE_CASES)("stored $stored with Stream Deck in $app draws $resolved", ({ stored, app, resolved, choice, unknown }) => {
    const normalized = normalizeChoice(stored);
    expect(normalized).toEqual({ choice, unknown });
    expect(resolveLanguage(normalized.choice, app)).toBe(resolved);
  });

  it("keeps Automatic's own rule for Stream Deck's language", () => {
    expect(resolveLanguage("auto", "de_AT")).toBe("de");
    expect(resolveLanguage("auto", "zh-Hant-HK")).toBe("zh_TW");
    expect(resolveLanguage("auto", "pt_BR")).toBe("en");
    // Stream Deck cannot select Dutch: under Automatic it is English, as before.
    expect(resolveLanguage("auto", "nl")).toBe("en");
    expect(resolveLanguage("auto", "nl-NL")).toBe("en");
  });
});

describe("the global settings store", () => {
  it("a language save, then a connection save, keeps every key", async () => {
    const port = new FakeSettingsPort({ other: "kept" });
    const store = new GlobalSettingsStore(port);
    await store.start();
    await store.patch({ language: "nl" });
    await store.patch(connectionChange(CONNECTION));
    expect(port.data).toEqual({ other: "kept", language: "nl", ...CONNECTION });
  });

  it("a connection save, then a language save, keeps every key", async () => {
    const port = new FakeSettingsPort({ other: "kept" });
    const store = new GlobalSettingsStore(port);
    await store.start();
    await store.patch(connectionChange(CONNECTION));
    await store.patch({ language: "de" });
    expect(port.data).toEqual({ other: "kept", ...CONNECTION, language: "de" });
  });

  it("two saves at once are written one after the other, the second with the first's keys", async () => {
    const port = new FakeSettingsPort({ other: "kept" }, 20);
    const store = new GlobalSettingsStore(port);
    await store.start();
    const both = Promise.all([store.patch({ language: "nl" }), store.patch(connectionChange(CONNECTION))]);
    await both;
    expect(port.writes).toEqual([
      { other: "kept", language: "nl" },
      { other: "kept", language: "nl", ...CONNECTION }
    ]);
    expect(port.data).toEqual({ other: "kept", language: "nl", ...CONNECTION });
  });

  it("a save made before the start-up read waits for it and keeps what was stored", async () => {
    const port = new FakeSettingsPort({ ...CONNECTION, other: "kept" });
    const store = new GlobalSettingsStore(port);
    const saved = store.patch({ language: "nl" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(port.writes).toEqual([]);
    await store.start();
    await saved;
    expect(port.data).toEqual({ ...CONNECTION, other: "kept", language: "nl" });
    expect(port.reads).toBe(1);
  });

  it("settings that arrive from Stream Deck replace what is known; a connection save sends only its keys", async () => {
    const port = new FakeSettingsPort({ language: "de" });
    const store = new GlobalSettingsStore(port);
    await store.start();
    store.replace({ language: "ja", host: "127.0.0.1" });
    await store.patch(connectionChange({ port: 4470 }));
    expect(port.data).toEqual({ language: "ja", host: "127.0.0.1", port: 4470 });
    expect(connectionChange({ host: "h", port: 1, password: "", language: "nl" })).toEqual({ host: "h", port: 1, password: "" });
  });

  it("a failed start-up read lets saves run, in memory and logged, and writes nothing of its own", async () => {
    const writes: FadesterGlobalSettings[] = [];
    const logs: string[] = [];
    const store = new GlobalSettingsStore({
      getGlobalSettings: async () => { throw new Error("no answer"); },
      setGlobalSettings: async (settings) => { writes.push({ ...settings }); }
    }, START_READ_TIMEOUT_MS, (message) => { logs.push(message); });
    await expect(store.start()).resolves.toEqual({});
    await expect(store.patch({ language: "nl" })).resolves.toEqual({ language: "nl" });
    expect(store.snapshot()).toEqual({ language: "nl" });
    // The whole object is not known: writing { language } as the whole object would erase host, port and password.
    expect(writes).toEqual([]);
    expect(logs).toEqual([NOT_READ_MESSAGE]);
    // Once Stream Deck sends the settings, the held save is merged and written once.
    store.replace({ ...CONNECTION, other: "kept" });
    await store.patch({ language: "de" });
    expect(writes).toEqual([{ ...CONNECTION, other: "kept", language: "nl" }, { ...CONNECTION, other: "kept", language: "de" }]);
  });

  it("a start-up read that never answers holds no save once Stream Deck sends the settings", async () => {
    const writes: FadesterGlobalSettings[] = [];
    const store = new GlobalSettingsStore({
      getGlobalSettings: () => new Promise<never>(() => {}),
      setGlobalSettings: async (settings) => { writes.push({ ...settings }); }
    });
    void store.start();
    const saved = store.patch({ language: "nl" });
    store.replace({ ...CONNECTION, other: "kept" });
    await expect(saved).resolves.toEqual({ ...CONNECTION, other: "kept", language: "nl" });
    expect(writes).toEqual([{ ...CONNECTION, other: "kept", language: "nl" }]);
  });

  it("a start-up read that never answers times out; saves then run in memory, logged, and never write only their change", async () => {
    vi.useFakeTimers();
    const writes: FadesterGlobalSettings[] = [];
    const logs: string[] = [];
    const store = new GlobalSettingsStore({
      getGlobalSettings: () => new Promise<never>(() => {}),
      setGlobalSettings: async (settings) => { writes.push({ ...settings }); }
    }, 50, (message) => { logs.push(message); });
    const started = store.start();
    const saved = store.patch({ language: "de" });
    await vi.advanceTimersByTimeAsync(49);
    let done = false;
    void saved.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(started).resolves.toEqual({});
    await expect(saved).resolves.toEqual({ language: "de" });
    await store.patch(connectionChange({ port: 4470 }));
    expect(store.snapshot()).toEqual({ language: "de", port: 4470 });
    expect(writes).toEqual([]);
    expect(logs).toEqual([NOT_READ_MESSAGE, NOT_READ_MESSAGE]);
  });

  it("a start-up read answering after the timeout is merged with the saves held meanwhile, written once, not discarded", async () => {
    vi.useFakeTimers();
    const writes: FadesterGlobalSettings[] = [];
    let answer!: (settings: FadesterGlobalSettings) => void;
    const store = new GlobalSettingsStore({
      getGlobalSettings: () => new Promise((resolve) => { answer = resolve; }),
      setGlobalSettings: async (settings) => { writes.push({ ...settings }); }
    }, 50);
    const started = store.start();
    await vi.advanceTimersByTimeAsync(50);
    await started;
    await store.patch({ language: "nl" });
    await store.patch(connectionChange({ password: "new" }));
    expect(writes).toEqual([]);
    answer({ ...CONNECTION, language: "de", other: "late" });
    await vi.advanceTimersByTimeAsync(0);
    // The stored host and port survive; the held language and password stand over the stored ones.
    const merged = { ...CONNECTION, other: "late", language: "nl", password: "new" };
    expect(store.snapshot()).toEqual(merged);
    expect(writes).toEqual([merged]);
    // Later saves write as usual, from the merged object.
    await store.patch({ language: "ja" });
    expect(writes).toEqual([merged, { ...merged, language: "ja" }]);
  });

  it("settings Stream Deck sends while the read is out are newer than the held saves: a held key they carry gives way", async () => {
    vi.useFakeTimers();
    const writes: FadesterGlobalSettings[] = [];
    const store = new GlobalSettingsStore({
      getGlobalSettings: () => new Promise<never>(() => {}),
      setGlobalSettings: async (settings) => { writes.push({ ...settings }); }
    }, 50);
    const started = store.start();
    await vi.advanceTimersByTimeAsync(50);
    await started;
    await store.patch(connectionChange({ port: 4470 }));
    await store.patch({ language: "nl" });
    expect(writes).toEqual([]);
    // A settings page saved port 4480 meanwhile: Stream Deck's object carries it, and it stands over the held 4470.
    store.replace({ ...CONNECTION, port: 4480, other: "kept" });
    await vi.advanceTimersByTimeAsync(0);
    const merged = { ...CONNECTION, port: 4480, other: "kept", language: "nl" };
    expect(store.snapshot()).toEqual(merged);
    expect(writes).toEqual([merged]);
    // Nothing held once every held key gave way: no write of its own.
    const quiet = new GlobalSettingsStore({
      getGlobalSettings: () => new Promise<never>(() => {}),
      setGlobalSettings: async (settings) => { writes.push({ ...settings }); }
    }, 50);
    void quiet.start();
    await vi.advanceTimersByTimeAsync(50);
    await quiet.patch(connectionChange({ port: 4470 }));
    quiet.replace({ ...CONNECTION, port: 4480 });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    expect(quiet.snapshot()).toEqual({ ...CONNECTION, port: 4480 });
  });

  it("a refused write of the held saves is logged and held again for the next write; so is a refused save", async () => {
    vi.useFakeTimers();
    const writes: FadesterGlobalSettings[] = [];
    const logs: string[] = [];
    let refuse = true;
    let answer!: (settings: FadesterGlobalSettings) => void;
    const store = new GlobalSettingsStore({
      getGlobalSettings: () => new Promise((resolve) => { answer = resolve; }),
      setGlobalSettings: async (settings) => {
        if (refuse) throw new Error("refused");
        writes.push({ ...settings });
      }
    }, 50, (message) => { logs.push(message); });
    const started = store.start();
    await vi.advanceTimersByTimeAsync(50);
    await started;
    await store.patch({ language: "nl" });
    answer({ ...CONNECTION, other: "late" });
    await vi.advanceTimersByTimeAsync(0);
    expect(logs).toEqual([NOT_READ_MESSAGE, NOT_SAVED_MESSAGE]);
    expect(writes).toEqual([]);
    // Stream Deck sends the settings: the held language goes out with them.
    refuse = false;
    store.replace({ ...CONNECTION, other: "sent" });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual([{ ...CONNECTION, other: "sent", language: "nl" }]);
    // A refused save of a known store: rejected to its caller, logged, carried by the next write.
    refuse = true;
    await expect(store.patch(connectionChange({ port: 4470 }))).rejects.toThrow("refused");
    expect(logs).toEqual([NOT_READ_MESSAGE, NOT_SAVED_MESSAGE, NOT_SAVED_MESSAGE]);
    refuse = false;
    // Stream Deck's object carries no port, so the held port rides along (one that carried a port would win).
    store.replace({ host: CONNECTION.host, password: CONNECTION.password, other: "again" });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.at(-1)).toEqual({ host: CONNECTION.host, password: CONNECTION.password, other: "again", port: 4470 });
  });

  it("a start-up read answering after Stream Deck sent the settings replaces nothing", async () => {
    vi.useFakeTimers();
    const writes: FadesterGlobalSettings[] = [];
    let answer!: (settings: FadesterGlobalSettings) => void;
    const store = new GlobalSettingsStore({
      getGlobalSettings: () => new Promise((resolve) => { answer = resolve; }),
      setGlobalSettings: async (settings) => { writes.push({ ...settings }); }
    }, 50);
    const started = store.start();
    await vi.advanceTimersByTimeAsync(50);
    await started;
    store.replace({ ...CONNECTION, language: "ja" });
    answer({ language: "de", other: "late" });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.snapshot()).toEqual({ ...CONNECTION, language: "ja" });
    expect(writes).toEqual([]);
  });

  it("a start-up read answering after the timeout fills in what is known when nothing was saved", async () => {
    vi.useFakeTimers();
    let answer!: (settings: FadesterGlobalSettings) => void;
    const store = new GlobalSettingsStore({
      getGlobalSettings: () => new Promise((resolve) => { answer = resolve; }),
      setGlobalSettings: async () => {}
    }, 50);
    const started = store.start();
    await vi.advanceTimersByTimeAsync(50);
    await started;
    answer({ ...CONNECTION, language: "de" });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.snapshot()).toEqual({ ...CONNECTION, language: "de" });
  });

  it("the pages' connection saver saves through the queue and tells both clients", async () => {
    const port = new FakeSettingsPort({ language: "nl", other: "kept" });
    const store = new GlobalSettingsStore(port);
    const told: FadesterGlobalSettings[][] = [[], []];
    const save = connectionSaver(store, told.map((list) => ({ updateSettings: (settings: FadesterGlobalSettings) => { list.push(settings); } })));
    const saving = save({ ...CONNECTION, language: "ja" } as FadesterGlobalSettings);
    await store.start();
    await saving;
    expect(port.data).toEqual({ language: "nl", other: "kept", ...CONNECTION });
    expect(told.map((list) => list.length)).toEqual([1, 1]);
  });

  it("the saver still tells the clients when Stream Deck refuses the write, and reports the refusal", async () => {
    const port = new FakeSettingsPort({ language: "nl" });
    const store = new GlobalSettingsStore(port);
    await store.start();
    port.setGlobalSettings = async () => { throw new Error("refused"); };
    const told: FadesterGlobalSettings[] = [];
    const save = connectionSaver(store, [{ updateSettings: (settings: FadesterGlobalSettings) => { told.push(settings); } }]);
    await expect(save({ ...CONNECTION } as FadesterGlobalSettings)).rejects.toThrow("refused");
    expect(told).toHaveLength(1);
    expect(store.snapshot()).toMatchObject(CONNECTION);
  });

  it("plugin.ts answers a failed settings page message with a log line, not an unhandled rejection", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/plugin.ts"), "utf8");
    expect(source).toMatch(/await bridge\.handleMessage\(payload\);\s*\}\)\(\)\.catch\(/);
  });

  it("plugin.ts writes global settings only through the store's port and saves connections with the saver", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/plugin.ts"), "utf8");
    // The one whole-object write is the store's own port; any other would bypass the merge (RL-1).
    expect(source.match(/setGlobalSettings\(/g)?.length).toBe(1);
    expect(source).toContain("setGlobalSettings: (settings) => streamDeck.settings.setGlobalSettings(settings)");
    expect(source).toContain("const persistSharedConnection = connectionSaver(settingsStore, [enhancedClient, directClient]);");
    expect(source.match(/persistGlobalSettings: persistSharedConnection/g)?.length).toBe(2);
    expect(source).toContain("settingsStore.replace(ev.settings);");
    // A save held because the start-up read did not answer is logged (RL-1).
    expect(source).toContain("}, START_READ_TIMEOUT_MS, (message) => streamDeck.logger.warn(message));");
  });
});

function choiceController(port: FakeSettingsPort, appLanguage: string) {
  const store = new GlobalSettingsStore(port);
  const logs: string[] = [];
  let broadcasts = 0;
  const controller = new LanguageChoiceController({
    store, appLanguage, dir: fixtureDir,
    broadcast: () => { broadcasts++; },
    log: (message) => { logs.push(message); }
  });
  return { store, controller, logs, broadcasts: () => broadcasts };
}

describe("the Language setting", () => {
  it("start-up applies a stored Dutch, and keeps the connection", async () => {
    const port = new FakeSettingsPort({ ...CONNECTION, language: "nl" });
    const { store, controller } = choiceController(port, "en");
    useStreamDeckLanguage("en", fixtureDir);
    await store.start();
    await controller.start();
    expect(currentLanguage()).toBe("nl");
    expect(t("infobarConnected")).toBe(`NL ${EN.infobarConnected}`);
    expect(controller.state()).toEqual({ choice: "nl", resolved: "nl" });
    expect(port.writes).toEqual([]);
  });

  it("setLanguageChoice saves the choice and applies it; Automatic goes back to Stream Deck's language", async () => {
    const port = new FakeSettingsPort({ ...CONNECTION });
    const { store, controller, broadcasts } = choiceController(port, "de");
    useStreamDeckLanguage("de", fixtureDir);
    await store.start();
    await controller.start();
    expect(controller.state()).toEqual({ choice: "auto", resolved: "de" });

    await expect(controller.handleMessage({ event: "setLanguageChoice", choice: "nl" })).resolves.toBe(true);
    expect(port.data).toEqual({ ...CONNECTION, language: "nl" });
    expect(currentLanguage()).toBe("nl");
    expect(controller.state()).toEqual({ choice: "nl", resolved: "nl" });
    expect(broadcasts()).toBe(1);

    await controller.handleMessage({ event: "setLanguageChoice", choice: "auto" });
    expect(port.data).toEqual({ ...CONNECTION, language: "auto" });
    expect(currentLanguage()).toBe("de");
    expect(t("keyReady")).toBe("Bereit");
    expect(controller.state()).toEqual({ choice: "auto", resolved: "de" });
    expect(broadcasts()).toBe(2);

    // A fixed language equal to Stream Deck's is still a choice of its own.
    await controller.handleMessage({ event: "setLanguageChoice", choice: "de" });
    expect(controller.state()).toEqual({ choice: "de", resolved: "de" });
    expect(port.data.language).toBe("de");
  });

  it("a pick whose save fails still applies, is broadcast and is logged without the value", async () => {
    const port = new FakeSettingsPort({ ...CONNECTION });
    port.setGlobalSettings = async () => { throw new Error("write refused"); };
    const { store, controller, logs, broadcasts } = choiceController(port, "en");
    await store.start();
    await controller.start();
    await expect(controller.handleMessage({ event: "setLanguageChoice", choice: "nl" })).resolves.toBe(true);
    expect(currentLanguage()).toBe("nl");
    expect(controller.state()).toEqual({ choice: "nl", resolved: "nl" });
    expect(broadcasts()).toBe(1);
    expect(logs).toEqual(["language choice not saved"]);
  });

  it("a pick the pages do not offer changes nothing; other messages are not its own", async () => {
    const port = new FakeSettingsPort({ language: "nl" });
    const { store, controller, broadcasts } = choiceController(port, "en");
    await store.start();
    await controller.start();
    for (const choice of ["pt_BR", "NL", 7, undefined]) {
      await expect(controller.handleMessage({ event: "setLanguageChoice", choice })).resolves.toBe(true);
    }
    expect(port.writes).toEqual([]);
    expect(currentLanguage()).toBe("nl");
    expect(broadcasts()).toBe(4);
    await expect(controller.handleMessage({ event: "directPiReady" })).resolves.toBe(false);
    await expect(controller.handleMessage(undefined)).resolves.toBe(false);
  });

  it("an unknown stored value acts as Automatic, stays stored, and is logged once without the value", async () => {
    const port = new FakeSettingsPort({ language: "pt_BR" });
    const { store, controller, logs } = choiceController(port, "de");
    useStreamDeckLanguage("de", fixtureDir);
    await store.start();
    await controller.start();
    expect(currentLanguage()).toBe("de");
    expect(controller.state()).toEqual({ choice: "auto", resolved: "de" });
    store.replace({ language: "pt_BR" });
    controller.settingsReceived();
    expect(logs).toEqual(["unknown language choice"]);
    expect(logs.join(" ")).not.toContain("pt_BR");
    expect(port.data).toEqual({ language: "pt_BR" });
    expect(port.writes).toEqual([]);
  });

  it("a fixed language whose file is missing draws English", async () => {
    const empty = mkdtempSync(join(tmpdir(), "fadester-language-empty-"));
    try {
      const store = new GlobalSettingsStore(new FakeSettingsPort({ language: "nl" }));
      const controller = new LanguageChoiceController({ store, appLanguage: "en", dir: empty, broadcast: () => {} });
      await store.start();
      await controller.start();
      expect(controller.state()).toEqual({ choice: "nl", resolved: "nl" });
      expect(t("keyReady")).toBe(EN.keyReady);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("only a changed language tells the controls", () => {
    const heard: string[] = [];
    const off = onLanguageChanged((language) => heard.push(language));
    setLanguage("de", deckTable("de"));
    setLanguage("de", deckTable("de"));
    setLanguage("nl", FIXTURE_NL);
    off();
    setLanguage("en", null);
    expect(heard).toEqual(["de", "nl"]);
  });
});

interface FakeContext {
  draws: string[];
  event: never;
}

function fakeContext(id: string, kind: "key" | "dial" | "infobar"): FakeContext {
  const draws: string[] = [];
  const action = {
    id,
    isKey: () => kind === "key",
    isDial: () => kind === "dial",
    isNeoInfobar: () => kind === "infobar",
    setImage: async (image: string) => { draws.push(image); },
    setFeedback: async (feedback: unknown) => { const canvas = (feedback as { canvas?: unknown }).canvas; draws.push(typeof canvas === "string" ? decodeSvgUri(canvas) : JSON.stringify(feedback)); },
    setFeedbackLayout: async () => {},
    setSettings: async () => {},
    showAlert: async () => {},
    showOk: async () => {}
  };
  return { draws, event: { action, payload: { settings: {} } } as never };
}

interface DeckAction {
  onWillAppear(ev: never): unknown;
  onWillDisappear(ev: never): unknown;
}

/** Every action of the plugin, built as `plugin.ts` builds them, with OBS never reached. */
function allActions(): { actions: Array<{ name: string; action: DeckAction; kind: "key" | "dial" | "infobar" }>; stop(): void } {
  const enhanced = new FadesterClient({ host: "127.0.0.1", port: 1, password: "" });
  enhanced.ensureStarted = () => {};
  const store = new FadesterStore(enhanced);
  const direct = new DirectObsClient({ host: "127.0.0.1", port: 1, password: "" });
  const layers = new LayerController(direct);
  const filters = new FilterController(direct);
  const safety = new VisualSafety(direct, filters);
  const signals = new VisualSignals(direct, safety);
  const meterAction = new VisualMeterAction(signals, direct);
  const filterAction = new ObsFilterControlAction(filters);
  const layerAction = new ObsLayerControlAction(layers);
  return {
    actions: [
      { name: "Fader dial", action: new FaderDialAction(store), kind: "dial" },
      { name: "Auto-fade key", action: new AutoFadeKeyAction(store), kind: "key" },
      { name: "OBS fader dial", action: new ObsFaderDialAction(direct, layers), kind: "dial" },
      { name: "OBS fade key", action: new ObsFadeKeyAction(direct), kind: "key" },
      { name: "Scene key", action: new ObsSceneTransitionKeyAction(direct), kind: "key" },
      { name: "Layer key", action: layerAction, kind: "key" },
      { name: "Layer dial", action: layerAction, kind: "dial" },
      { name: "Neo Info Bar", action: new ObsNeoInfobarAction(direct, signals), kind: "infobar" },
      { name: "Playlister key", action: new PlaylisterTransportKeyAction(direct), kind: "key" },
      { name: "Filter key", action: filterAction, kind: "key" },
      { name: "Filter dial", action: filterAction, kind: "dial" },
      { name: "Visual Panic key", action: new VisualPanicKeyAction(safety, direct), kind: "key" },
      { name: "Visual Meter key", action: meterAction, kind: "key" },
      { name: "Visual Meter dial", action: meterAction, kind: "dial" },
      { name: "Visual Meter Neo", action: meterAction, kind: "infobar" }
    ] as Array<{ name: string; action: DeckAction; kind: "key" | "dial" | "infobar" }>,
    stop() {
      enhanced.stop();
      direct.stop();
    }
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(500);
}

describe("the redraw on a language change", () => {
  it("every action redraws each visible context once, also after willAppear twice, and stops after willDisappear", async () => {
    vi.useFakeTimers();
    const { actions, stop } = allActions();
    try {
      const contexts = actions.map(({ name, action, kind }, index) => {
        const once = fakeContext(`once-${index}`, kind);
        const twice = fakeContext(`twice-${index}`, kind);
        return { name, action, once, twice };
      });
      for (const { action, once, twice } of contexts) {
        await action.onWillAppear(once.event);
        await action.onWillAppear(twice.event);
        await action.onWillAppear(twice.event);
      }
      await settle();
      const before = contexts.map(({ once, twice }) => [once.draws.length, twice.draws.length]);
      for (const [index, { name }] of contexts.entries()) {
        expect(before[index]![0], `${name} drew on appear`).toBeGreaterThan(0);
      }

      setLanguage("nl", FIXTURE_NL);
      await settle();
      for (const [index, { name, once, twice }] of contexts.entries()) {
        expect([once.draws.length, twice.draws.length], name).toEqual([before[index]![0] + 1, before[index]![1] + 1]);
        expect(once.draws.at(-1), `${name} draws in Dutch`).toContain("NL");
      }

      for (const { action, once, twice } of contexts) {
        await action.onWillDisappear(once.event);
        await action.onWillDisappear(twice.event);
      }
      const hidden = contexts.map(({ once, twice }) => [once.draws.length, twice.draws.length]);
      setLanguage("de", deckTable("de"));
      await settle();
      expect(contexts.map(({ once, twice }) => [once.draws.length, twice.draws.length])).toEqual(hidden);
    } finally {
      for (const { action, kind } of actions) await action.onWillDisappear(fakeContext("none", kind).event);
      stop();
    }
  });

  it("Automatic at start-up sends no extra image or feedback, nor does the same language set again", async () => {
    vi.useFakeTimers();
    useStreamDeckLanguage("de", fixtureDir);
    const { actions, stop } = allActions();
    const contexts = actions.map(({ name, action, kind }, index) => ({ name, action, context: fakeContext(`auto-${index}`, kind) }));
    try {
      for (const { action, context } of contexts) await action.onWillAppear(context.event);
      await settle();
      const before = contexts.map(({ context }) => context.draws.length);

      for (const stored of [{}, { language: "auto" }, { language: "de" }, { language: "pt_BR" }]) {
        const store = new GlobalSettingsStore({ getGlobalSettings: async () => stored, setGlobalSettings: async () => {} });
        const controller = new LanguageChoiceController({ store, appLanguage: "de", dir: fixtureDir, broadcast: () => {} });
        await store.start();
        await controller.start();
        await settle();
        expect(currentLanguage()).toBe("de");
      }
      setLanguage("de", deckTable("de"));
      await settle();
      expect(contexts.map(({ context }) => context.draws.length)).toEqual(before);
    } finally {
      for (const { action, context } of contexts) await action.onWillDisappear(context.event);
      stop();
    }
  });
});

describe("both page broadcasts and both savers", () => {
  it("the Midi Fadester page's state carries the Language setting too", () => {
    const enhanced = new FadesterClient({ host: "127.0.0.1", port: 1, password: "" });
    const payloads: Array<Record<string, unknown>> = [];
    let language = { choice: "nl", resolved: "nl" };
    const bridge = new PropertyInspectorBridge(new FadesterStore(enhanced), enhanced, {
      sendToPropertyInspector: (payload) => { payloads.push(payload); },
      persistGlobalSettings: async () => {},
      getLanguage: () => language as never
    });
    bridge.broadcast();
    expect(payloads.at(-1)).toMatchObject({ event: "fadesterState", language: { choice: "nl", resolved: "nl" } });
    language = { choice: "auto", resolved: "de" };
    bridge.broadcast();
    expect(payloads.at(-1)!.language).toEqual({ choice: "auto", resolved: "de" });
    // Without a Language setting given, it says what the deck draws in.
    setLanguage("ja", null);
    const plain = new PropertyInspectorBridge(new FadesterStore(enhanced), enhanced, {
      sendToPropertyInspector: () => {},
      persistGlobalSettings: async () => {}
    });
    expect(plain.buildStatePayload().language).toEqual({ choice: "auto", resolved: "ja" });
  });

  it("the two Midi Fadester pages are worded in Stream Deck's language when given its translator (R-LANG-3)", () => {
    setLanguage("nl", deckTable("nl"));
    // Keys whose Dutch differs from the English, so each page shows which table worded it.
    for (const key of ["modeTbar", "curveEqualPower", "statusUnreachable"] as const) expect(t(key)).not.toBe(EN[key]);
    const enhanced = new FadesterClient({ host: "127.0.0.1", port: 1, password: "" });
    const page = (translate?: (key: string) => string) => new PropertyInspectorBridge(new FadesterStore(enhanced), enhanced, {
      sendToPropertyInspector: () => {},
      persistGlobalSettings: async () => {},
      ...(translate ? { translate } : {})
    }).buildStatePayload();
    const modes = Object.values(TARGET_MODE_LABELS);
    const curves = Object.values(CURVE_LABELS);
    // An English Stream Deck: wholly English, though the plugin's own language is Dutch.
    const english = page(translatorFor({}));
    expect(english.targetModes.map((mode) => mode.label)).toEqual(modes.map((key) => EN[key]));
    expect(english.curves.map((curve) => curve.label)).toEqual(curves.map((key) => EN[key]));
    expect(english.status.sentence).toBe(EN.statusUnreachable);
    // Without a translator of its own (as before): the plugin's language.
    const dutch = page();
    expect(dutch.targetModes.map((mode) => mode.label)).toEqual(modes.map((key) => t(key)));
    expect(dutch.curves.map((curve) => curve.label)).toEqual(curves.map((key) => t(key)));
    expect(dutch.status.sentence).toBe(t("statusUnreachable"));
  });

  it("a page's connection save and a language pick at once keep every key, with plugin.ts's saver", async () => {
    const port = new FakeSettingsPort({ language: "de", other: "kept" }, 15);
    const { store, controller } = choiceController(port, "en");
    const enhanced = new FadesterClient({ host: "127.0.0.1", port: 1, password: "" });
    enhanced.ensureStarted = () => {};
    const bridge = new PropertyInspectorBridge(new FadesterStore(enhanced), enhanced, {
      sendToPropertyInspector: () => {},
      persistGlobalSettings: connectionSaver(store, [enhanced]),
      getLanguage: () => controller.state()
    });
    // Both arrive before the start-up read has answered.
    const saves = Promise.all([
      bridge.handleMessage({ event: "updateGlobalSettings", host: CONNECTION.host, port: CONNECTION.port, password: CONNECTION.password }),
      controller.handleMessage({ event: "setLanguageChoice", choice: "nl" })
    ]);
    await store.start();
    await saves;
    expect(port.data).toEqual({ other: "kept", ...CONNECTION, language: "nl" });
    expect(port.writes.every((written) => written.other === "kept")).toBe(true);
    expect(currentLanguage()).toBe("nl");
  });
});

describe("the filter lists on the settings page", () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0)) await step();
  });

  it("a list read before a language change is broadcast in the new language, driven settings too", async () => {
    const server = new FakeObsServer({ missingPlugin: true });
    const scene = server.sceneUuidFor("Scene Live");
    server.addFilter(scene, { filterName: "Aura", filterKind: VS_SHADER_KIND, filterSettings: { vs_effect_mix_pct: 40 } });
    server.addFilter(scene, { filterName: "Pulse", filterKind: VS_MODULATOR_KIND, filterSettings: { slot_2_target_filter: "Aura", slot_2_target_setting: "vs_audio_reactivity_pct" } });
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    cleanup.push(() => client.stop(), () => server.stop());
    const connected = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await connected;
    const payloads: Array<Record<string, unknown>> = [];
    let language = { choice: "auto", resolved: "en" };
    const bridge = new DirectObsPropertyInspectorBridge(client, {
      sendToPropertyInspector: (payload) => { payloads.push(payload); },
      persistGlobalSettings: async () => {},
      getLanguage: () => language as never
    });
    await bridge.handleMessage({ event: "directFilterCatalog", sourceUuid: scene });
    const missingSource = "00000000-0000-4000-8000-0000000000aa";
    await bridge.handleMessage({ event: "directFilterCatalog", sourceUuid: missingSource });
    const labels = () => {
      const catalog = (payloads.at(-1)!.filterCatalog as Record<string, InspectorFilterCatalog>)[scene]!;
      const aura = catalog.filters.find((filter) => filter.filterName === "Aura")!;
      const pulse = catalog.filters.find((filter) => filter.filterName === "Pulse")!;
      const setting = (name: string) => aura.settings.find((entry) => entry.setting === name)!;
      return { mix: setting("vs_effect_mix_pct").label, driven: setting("vs_audio_reactivity_pct"), mod: pulse.settings[0]!.label };
    };
    expect(labels().mix).toBe("Effect mix");
    expect(labels().driven).toMatchObject({ label: "Reactivity", owner: "Pulse" });
    expect(payloads.at(-1)!.language).toEqual({ choice: "auto", resolved: "en" });

    setLanguage("nl", FIXTURE_NL);
    language = { choice: "nl", resolved: "nl" };
    bridge.broadcast();
    expect(labels().mix).toBe(`NL ${EN.filterSettingEffectMix}`);
    expect(labels().driven).toMatchObject({ label: `NL ${EN.filterSettingReactivity}`, owner: "Pulse", table: true });
    expect(labels().mod).toBe("NL Mod 1 amount");
    // OBS's own words stay as OBS wrote them.
    const missing = (payloads.at(-1)!.filterCatalog as Record<string, InspectorFilterCatalog>)[missingSource]!;
    expect(missing.error).toContain("No source was found");
    expect(payloads.at(-1)!.language).toEqual({ choice: "nl", resolved: "nl" });
  });

  it("our own error on a list is worded at each broadcast", async () => {
    const client = new DirectObsClient({ host: "127.0.0.1", port: 1, password: "" });
    cleanup.push(() => client.stop());
    const payloads: Array<Record<string, unknown>> = [];
    const bridge = new DirectObsPropertyInspectorBridge(client, {
      sendToPropertyInspector: (payload) => { payloads.push(payload); },
      persistGlobalSettings: async () => {}
    });
    await bridge.handleMessage({ event: "directFilterCatalog", sourceUuid: "uuid-x" });
    const error = () => (payloads.at(-1)!.filterCatalog as Record<string, InspectorFilterCatalog>)["uuid-x"]!.error;
    const english = error();
    expect(english).not.toBe("");
    expect(english.startsWith("NL ")).toBe(false);
    setLanguage("nl", FIXTURE_NL);
    bridge.broadcast();
    expect(error()).toBe(`NL ${english}`);
    // Without a Language setting given, the broadcast still says what the deck draws in.
    expect(payloads.at(-1)!.language).toEqual({ choice: "auto", resolved: "nl" });
  });
});
