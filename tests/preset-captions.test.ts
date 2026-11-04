// SPDX-License-Identifier: GPL-2.0-or-later
import { once } from "node:events";
import { decodeSvgUri } from "./helpers/svg-text.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CaptionAction,
  PRESET_CAPTIONS,
  customCaption,
  isGeneratedCaption
} from "../src/obs/preset-captions.js";
import { presetCaptionsScript } from "../scripts/generate-ui-i18n.js";
import { setLanguage } from "../src/i18n/strings.js";
import { escapeXml } from "../packages/streamdeck-fadester-shared/src/svg-renderer.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { LayerController, LayerSettings } from "../src/control/layer-controller.js";
import { ObsLayerInstanceController } from "../src/actions/obs-layer-control.js";
import { ObsFaderDialInstanceController } from "../src/actions/obs-fader-dial.js";
import { ObsFadeKeyInstanceController } from "../src/actions/obs-fade-key.js";
import { ObsSceneTransitionKeyInstanceController } from "../src/actions/obs-scene-transition-key.js";
import { PlaylisterTransportInstanceController } from "../src/actions/playlister-transport-key.js";
import { ObsFilterInstanceController } from "../src/actions/obs-filter-control.js";
import { VisualPanicInstanceController } from "../src/actions/visual-panic-key.js";
import { FilterController } from "../src/control/filter-controller.js";
import { VisualSafety } from "../src/control/visual-safety.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";
import { PLUGIN_DIR, deckTable } from "./helpers/languages.js";

type Assignment = {
  kind: "layer" | "scene" | "fader" | "fade" | "playlister" | "filter" | "panic";
  controller: "Keypad" | "Encoder";
  column: number;
  row: number;
  label: string;
  settings: Record<string, string | number | boolean>;
};
type Stored = Omit<Assignment, "kind" | "label"> & { kind: Assignment["kind"] | "page"; label?: string };
const presets = JSON.parse(readFileSync(new URL("../profiles/layouts.json", import.meta.url), "utf8")) as
  Array<{ slug: string; actions?: Assignment[]; pages?: Array<{ actions: Stored[] }> }>;
// Every captioned control of every page; Elgato's page keys carry no caption.
const assignments = presets.flatMap((preset) => preset.pages ? preset.pages.flatMap((page) => page.actions) : preset.actions ?? [])
  .filter((entry): entry is Assignment => entry.kind !== "page")
  // A filter control's caption context names the control it sits on (the inspector passes the same).
  .map((entry) => entry.kind === "filter" ? { ...entry, settings: { ...entry.settings, control: entry.controller === "Encoder" ? "dial" : "key" } } : entry);

function actionOf(entry: Assignment): CaptionAction {
  return entry.kind === "layer" ? entry.controller === "Encoder" ? "layerDial" : "layerKey" : entry.kind;
}

/** The inspectors' generated copy, run as the pages run it. */
function inspectorCaptions(): { isGenerated(action: string, settings: object, caption?: string): boolean } {
  const window: Record<string, unknown> = {};
  runInNewContext(readFileSync(join(PLUGIN_DIR, "ui", "preset-captions.js"), "utf8"), { window });
  return window.FadesterPresetCaptions as ReturnType<typeof inspectorCaptions>;
}

describe("bundled profile captions (R-I18N-2)", () => {
  it("lists exactly the 77 captions profiles/layouts.json stores, per action", () => {
    const stored = new Map<CaptionAction, Set<string>>();
    for (const entry of assignments) {
      const action = actionOf(entry);
      stored.set(action, (stored.get(action) ?? new Set()).add(entry.label));
    }
    let total = 0;
    for (const action of Object.keys(PRESET_CAPTIONS) as CaptionAction[]) {
      const shipped = new Set(Object.values(PRESET_CAPTIONS[action]).flatMap((entry) => entry.shipped));
      expect([...shipped].sort(), action).toEqual([...(stored.get(action) ?? [])].sort());
      total += shipped.size;
    }
    expect(total).toBe(77);
  });

  it.each(assignments.map((entry) => [entry.label, actionOf(entry), entry] as const))(
    "%s is a generated default for its %s and its context", (_label, action, entry) => {
      expect(isGeneratedCaption(action, entry.settings, entry.label)).toBe(true);
      expect(inspectorCaptions().isGenerated(action, entry.settings, entry.label)).toBe(true);
    });

  it("ships the Playlister starter with six unbound keys, two free keys and no dial (R-PLT-7)", () => {
    const starter = presets.find((preset) => preset.slug === "plus-playlister-transport") as { actions: Assignment[] };
    expect(starter.actions.map((entry) => [entry.controller, entry.settings.operation, entry.settings.inputUuid])).toEqual([
      ["Keypad", "previous", ""], ["Keypad", "next", ""], ["Keypad", "playpause", ""],
      ["Keypad", "stop", ""], ["Keypad", "restart", ""], ["Keypad", "status", ""]
    ]);
    expect(starter.actions.every((entry) => entry.kind === "playlister")).toBe(true);
    expect(starter.actions.map((entry) => `${entry.column},${entry.row}`)).toEqual(["0,0", "1,0", "2,0", "3,0", "0,1", "1,1"]);
  });

  it("matches in context only, so the same words elsewhere stay the operator's", () => {
    expect(isGeneratedCaption("scene", { sceneTarget: "__next_scene__" }, "Prev scene")).toBe(false);
    expect(isGeneratedCaption("scene", { sceneTarget: "Camera" }, "Next scene")).toBe(false);
    expect(isGeneratedCaption("scene", { sceneTarget: "__scene_index_1__" }, "Scene 1")).toBe(false);
    expect(isGeneratedCaption("scene", { sceneTarget: "__scene_index_1__" }, "Scene B")).toBe(true);
    expect(isGeneratedCaption("scene", { sceneTarget: "__random_scene__" }, "Random")).toBe(true);
    expect(isGeneratedCaption("fader", { target: "input_volume", inputName: "Desktop Audio" }, "Music")).toBe(false);
    expect(isGeneratedCaption("fader", { target: "tbar" }, "Scene transition")).toBe(true);
    expect(isGeneratedCaption("layerKey", { operation: "show_hide" }, "Next source")).toBe(false);
    expect(customCaption("layerKey", { operation: "show_hide", labelOverride: " My cue " })).toBe("My cue");
    expect(isGeneratedCaption("playlister", { operation: "next" }, "Next")).toBe(true);
    expect(isGeneratedCaption("playlister", { operation: "stop" }, "Next")).toBe(false);
    expect(isGeneratedCaption("playlister", {}, "play / pause")).toBe(true);
    expect(customCaption("playlister", { operation: "status", labelOverride: "Reel" })).toBe("Reel");
  });

  it("the inspectors' copy is current and agrees with the plugin on every caption in every context", () => {
    expect(readFileSync(join(PLUGIN_DIR, "ui", "preset-captions.js"), "utf8").replace(/\r\n/g, "\n"))
      .toBe(presetCaptionsScript());
    const ui = inspectorCaptions();
    const captions = [...new Set(Object.values(PRESET_CAPTIONS).flatMap((contexts) =>
      Object.values(contexts).flatMap((entry) => [...entry.shipped, ...entry.legacy]))), "My cue", ""];
    const contexts: Array<[CaptionAction, Record<string, string>]> = [
      ...Object.keys(PRESET_CAPTIONS.scene).map((sceneTarget) => ["scene", { sceneTarget }] as [CaptionAction, Record<string, string>]),
      ["scene", { sceneTarget: "Camera" }], ["fader", { target: "tbar" }],
      ["fader", { target: "input_volume", inputName: "__audio_input_3__" }], ["fader", { target: "input_volume", inputName: "Mic/Aux" }],
      ["fade", { inputName: "__audio_mic__" }], ["fade", { inputName: "Desktop Audio" }],
      ...Object.keys(PRESET_CAPTIONS.layerKey).map((operation) => ["layerKey", { operation }] as [CaptionAction, Record<string, string>]),
      ...Object.keys(PRESET_CAPTIONS.layerDial).map((dialMode) => ["layerDial", { dialMode }] as [CaptionAction, Record<string, string>]),
      ...Object.keys(PRESET_CAPTIONS.playlister).map((operation) => ["playlister", { operation }] as [CaptionAction, Record<string, string>]),
      ["playlister", {}],
      ...Object.keys(PRESET_CAPTIONS.panic).map((operation) => ["panic", { operation }] as [CaptionAction, Record<string, string>]),
      ["panic", {}],
      ...Object.keys(PRESET_CAPTIONS.filter).map((context) => {
        const [operation, setting] = context.split(":");
        return ["filter", operation === "dial" ? { control: "dial", setting } : { control: "key", keyOperation: operation, setting }] as
          [CaptionAction, Record<string, string>];
      }),
      ["filter", { control: "key" }], ["filter", { control: "dial", setting: "custom_low_hz" }]
    ];
    for (const [action, settings] of contexts) {
      for (const caption of captions) {
        expect(ui.isGenerated(action, settings, caption), `${action} ${JSON.stringify(settings)} ${caption}`)
          .toBe(isGeneratedCaption(action, settings, caption));
      }
    }
  });
});

// Each translated deck draws its own words for the shipped captions: German, and Dutch since step L.4 (PLAN.md 11.3).
// `same` lists the captions whose word is the same in that language (the key draws the translation, which reads like
// the stored English); `operations` the unbound Playlister keys' titles and `choose` their hint.
const CAPTION_LANGUAGES = [
  {
    name: "German", language: "de", same: ["Status"], choose: "Playlister wählen",
    operations: { previous: "Zurück", next: "Weiter", playpause: "Wiedergabe / Pause", stop: "Stopp", restart: "Neu starten", status: "Status" }
  },
  {
    name: "Dutch", language: "nl", same: ["Status"], choose: "Kies een Playlister",
    operations: { previous: "Vorige", next: "Volgende", playpause: "Afspelen / pauzeren", stop: "Stoppen", restart: "Herstarten", status: "Status" }
  }
] as const;

describe.each(CAPTION_LANGUAGES)("a $name deck shows no stored English caption", ({ language, same, choose, operations }) => {
  let server: FakeObsServer;
  let client: DirectObsClient;
  let layers: LayerController;
  let filters: FilterController;
  let safety: VisualSafety;

  beforeAll(async () => {
    server = new FakeObsServer({ studioMode: true, missingPlugin: true });
    server.sceneNames = ["Opening", "Wide camera", "Close camera", "Slides", "Browser"];
    server.programSceneName = "Opening";
    server.previewSceneName = "Wide camera";
    server.inputNames.push("Browser Audio");
    server.inputVolumes.set("Browser Audio", 0.4);
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const ready = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await ready;
    await client.refreshCatalog();
    layers = new LayerController(client);
    filters = new FilterController(client);
    safety = new VisualSafety(client, filters);
    setLanguage(language, deckTable(language));
  });

  afterAll(async () => {
    setLanguage("en", null);
    client.stop();
    await server.stop();
  });

  const distinct = [...new Map(assignments.map((entry) =>
    [JSON.stringify([entry.kind, entry.controller, entry.label, entry.settings]), entry])).values()];
  const sameWord = new Set<string>(same);
  const operationWords: Record<string, string> = operations;

  it.each(distinct.map((entry) => [entry.label, entry.kind, entry.controller, entry] as const))(
    "%s (%s %s)", (label, kind, controller, entry) => {
      const settings = { ...entry.settings, labelOverride: label };
      let image = "";
      const sink = (value: string): Promise<void> => { image = decodeSvgUri(value); return Promise.resolve(); };
      const alert = (): Promise<void> => Promise.resolve();
      let control: { appear(): void; disappear(): void };
      if (kind === "scene") control = new ObsSceneTransitionKeyInstanceController(client, { setImage: sink, showAlert: alert }, settings);
      else if (kind === "fade") control = new ObsFadeKeyInstanceController(client, { setImage: sink, showAlert: alert }, settings);
      else if (kind === "fader") control = new ObsFaderDialInstanceController(client, { setFeedback: (feedback) => sink(feedback.canvas), showAlert: alert }, settings);
      // The Playlister keys ship unbound: the translated operation word is their title.
      else if (kind === "playlister") control = new PlaylisterTransportInstanceController(client, { setImage: sink, showAlert: alert }, settings);
      // The rig's filter controls ship unbound; Panic and Restore draw their translated words.
      else if (kind === "filter") control = new ObsFilterInstanceController(filters, { render: (svg) => { image = svg; return Promise.resolve(); }, showAlert: alert },
        controller === "Encoder", settings);
      else if (kind === "panic") control = new VisualPanicInstanceController(safety, client, { setImage: sink, showAlert: alert, showOk: alert }, settings);
      else control = new ObsLayerInstanceController(layers, { render: (svg) => { image = svg; return Promise.resolve(); }, showAlert: alert },
        controller === "Encoder", settings as LayerSettings);
      control.appear();
      control.disappear();
      expect(image).toContain("<svg");
      // Layer dials never draw a caption, so for them this only proves nothing English slips in.
      if (sameWord.has(label)) expect(image).toContain(`>${escapeXml(label)}<`);
      else expect(image, image).not.toContain(`>${escapeXml(label)}<`);
      if (kind === "playlister") {
        // The unbound key's title is the operation word (in the SVG <title>, as a long one wraps), its subtitle the hint.
        expect(image).toContain(`<title>${escapeXml(operationWords[String(entry.settings.operation)])} — `);
        expect(image).toContain(`>${escapeXml(choose)}<`);
      }
    });

  it.each([
    ["scene", { sceneTarget: "__next_scene__", operation: "transition" }],
    ["fade", { inputName: "__audio_mic__", to: 1, durationMs: 500 }],
    ["fader", { target: "input_volume", inputName: "__audio_main__" }],
    ["fader", { target: "tbar" }],
    ["layer", { operation: "show_hide" }],
    ["playlister", { inputUuid: "", operation: "next" }]
  ] as const)("draws a caption the operator typed on a %s control, the same way the check above looks for", (kind, base) => {
    const settings: Record<string, string | number> = { ...base, labelOverride: "Kamera an" };
    let image = "";
    const sink = (value: string): Promise<void> => { image = decodeSvgUri(value); return Promise.resolve(); };
    const alert = (): Promise<void> => Promise.resolve();
    const control = kind === "scene" ? new ObsSceneTransitionKeyInstanceController(client, { setImage: sink, showAlert: alert }, settings)
      : kind === "fade" ? new ObsFadeKeyInstanceController(client, { setImage: sink, showAlert: alert }, settings)
        : kind === "fader" ? new ObsFaderDialInstanceController(client, { setFeedback: (feedback) => sink(feedback.canvas), showAlert: alert }, settings)
          : kind === "playlister" ? new PlaylisterTransportInstanceController(client, { setImage: sink, showAlert: alert }, settings)
            : new ObsLayerInstanceController(layers, { render: (svg) => { image = svg; return Promise.resolve(); }, showAlert: alert }, false, settings);
    control.appear();
    control.disappear();
    expect(image).toContain(">Kamera an<");
  });
});
