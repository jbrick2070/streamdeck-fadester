// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { DirectObsPropertyInspectorBridge, InspectorFilterCatalog } from "../src/pi/direct-obs-bridge.js";
import { COLOR_FILTER_KIND, FakeObsServer, VS_MODULATOR_KIND, VS_SHADER_KIND } from "./helpers/fake-obs-server.js";
import { inspectorPageScript } from "./helpers/inspector-scripts.js";

type Item = { value: string; text: string };
type Fill = { items: Item[]; selected: string; placeholder: string };

/** Runs the shipped OBS Filter inspector's inline callback with an observed state (PLAN.md 10.5). */
function inspector(controller: "Keypad" | "Encoder") {
  const html = readFileSync("com.jbrick2070.fadester-for-obs.sdPlugin/ui/obs-filter.html", "utf8");
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
    value: "", textContent: "", className: "", checked: false, disabled: false, style: {} as Record<string, string>,
    onchange: undefined as (() => void) | undefined, onclick: undefined as (() => void) | undefined
  }]));
  const fills = new Map<string, Fill>();
  const saved: Array<Record<string, unknown>> = [];
  const filterRequests: string[] = [];
  let render!: (settings: Record<string, unknown>, save: (patch: Record<string, unknown>) => void, state: Record<string, unknown>) => void;
  runInNewContext(inspectorPageScript(html), {
    document: { activeElement: null, getElementById: (id: string) => elements.get(id) },
    window: {
      directObsController: controller,
      initDirectObsPropertyInspector: (callback: typeof render) => { render = callback; },
      directObsFillSelect: (element: { value: string }, items: Item[], selected: string, placeholder: string) => {
        const id = [...elements].find(([, entry]) => entry === element)?.[0] ?? "";
        element.value = selected;
        fills.set(id, { items, selected, placeholder });
      },
      directObsRefresh: () => {},
      directObsRefreshFilters: (uuid: string) => { filterRequests.push(uuid); }
    }
  });
  return {
    render: (settings: Record<string, unknown>, state: Record<string, unknown> | null) => render(settings, (patch) => saved.push(patch), state as never),
    fill: (id: string) => fills.get(id)!,
    text: (id: string) => elements.get(id)!.textContent,
    shown: (id: string) => elements.get(id)!.style.display !== "none",
    value: (id: string) => elements.get(id)!.value,
    change: (id: string, value: string) => { const element = elements.get(id)!; element.value = value; element.onchange?.(); },
    click: (id: string) => elements.get(id)!.onclick?.(),
    saved, filterRequests
  };
}

describe("OBS Filter inspector", () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0)) await step();
  });

  it("lists only numeric settings the deck may write, the table first, marks the driven ones, and reads by UUID", async () => {
    const server = new FakeObsServer({ missingPlugin: true });
    const scene = server.sceneUuidFor("Scene Live");
    server.addFilter(scene, {
      filterName: "Aura", filterKind: VS_SHADER_KIND, filterSettings: {
        vs_effect_mix_pct: 40, glow_amount: 0.5, max_flash_rate_hz: 3, onset_threshold: 0.3, flash_color: 4294967295,
        param_fader_1_target: "glow_amount", param_fader_1_slot: 2, preset_shader: "fft-spectral-aura.shader"
      }
    });
    server.addFilter(scene, { filterName: "Pulse", filterKind: VS_MODULATOR_KIND, filterSettings: { slot_2_target_filter: "Aura", slot_2_target_setting: "vs_audio_reactivity_pct" } });
    server.addFilter(scene, { filterName: "Grade", filterKind: COLOR_FILTER_KIND });
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    cleanup.push(() => client.stop(), () => server.stop());
    const connected = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await connected;
    const payloads: Array<Record<string, unknown>> = [];
    const bridge = new DirectObsPropertyInspectorBridge(client, {
      sendToPropertyInspector: (payload) => { payloads.push(payload); },
      persistGlobalSettings: async () => {}
    });
    await bridge.handleMessage({ event: "directFilterCatalog", sourceUuid: scene });
    const catalog = (payloads.at(-1)!.filterCatalog as Record<string, InspectorFilterCatalog>)[scene]!;
    expect(catalog.error).toBe("");
    const [aura, pulse, grade] = catalog.filters;
    expect(aura!.filterKind).toBe(VS_SHADER_KIND);
    expect(aura!.settings.map((entry) => entry.setting)).toEqual(["vs_effect_mix_pct", "vs_audio_reactivity_pct", "custom_high_hz", "custom_low_hz", "glow_amount"]);
    expect(aura!.settings.slice(0, 2).map((entry) => [entry.label, entry.value, entry.table])).toEqual([["Effect mix", 40, true], ["Reactivity", 100, true]]);
    expect(aura!.settings.find((entry) => entry.setting === "vs_audio_reactivity_pct")!.owner).toBe("Pulse");
    expect(aura!.settings.find((entry) => entry.setting === "glow_amount")!.owner).toBe("");
    expect(aura!.settings.find((entry) => entry.setting === "vs_effect_mix_pct")).not.toHaveProperty("owner");
    expect(pulse!.settings.slice(0, 8).map((entry) => entry.setting)).toEqual(Array.from({ length: 8 }, (_, i) => `slot_${i + 1}_amount_pct`));
    expect(pulse!.settings.some((entry) => /enabled|rate_divider|signal|depth_fader|custom_mode|target/.test(entry.setting))).toBe(false);
    expect(grade!.settings.map((entry) => entry.setting)).toEqual(["opacity", "brightness", "contrast", "gamma", "hue_shift", "saturation"]);
    // Never a setting the deck does not write, whatever the filter holds.
    for (const filter of catalog.filters) {
      for (const denied of ["max_flash_rate_hz", "onset_threshold", "flash_color", "param_fader_1_slot", "preset_shader", "color_add", "color_multiply", "mix_fader_slot"]) {
        expect(filter.settings.map((entry) => entry.setting), `${filter.filterName} ${denied}`).not.toContain(denied);
      }
    }
    // By UUID, never by name; a missing source says so.
    expect(server.filterRequestLog.filter((entry) => entry.requestType === "GetSourceFilterList").every((entry) => entry.requestData.sourceUuid === scene && !("sourceName" in entry.requestData))).toBe(true);
    await bridge.handleMessage({ event: "directFilterCatalog", sourceUuid: "00000000-0000-4000-8000-0000000000aa" });
    const missing = (payloads.at(-1)!.filterCatalog as Record<string, InspectorFilterCatalog>)["00000000-0000-4000-8000-0000000000aa"]!;
    expect(missing.filters).toEqual([]);
    expect(missing.error).toContain("No source was found");
  });

  it("saves UUID, filter name and kind, never resolves by name, needs a range off the table, and shows each banner", () => {
    const scene = { sceneName: "Scene Live", sceneUuid: "uuid-scene" };
    const group = { groupName: "Overlays", groupUuid: "uuid-group" };
    const camera = { inputUuid: "uuid-camera", inputName: "Camera", inputKind: "dshow_input", unversionedInputKind: "dshow_input" };
    const aura = {
      filterName: "Aura", filterKind: VS_SHADER_KIND, filterEnabled: true, settings: [
        { setting: "vs_effect_mix_pct", label: "Effect mix", value: 40, table: true },
        { setting: "vs_audio_reactivity_pct", label: "Reactivity", value: 100, table: true, owner: "Pulse" },
        { setting: "glow_amount", label: "glow_amount", value: 0.5, table: false }
      ]
    };
    const pulse = { filterName: "Pulse", filterKind: VS_MODULATOR_KIND, filterEnabled: true, settings: [{ setting: "slot_1_amount_pct", label: "Mod 1 amount", value: 100, table: true }] };
    const base = { status: { kind: "connected" }, catalog: { sceneDetails: [scene], groupDetails: [group], inputDetails: [camera] } };
    const state = { ...base, filterCatalog: { "uuid-scene": { filters: [aura, pulse], error: "" } } };
    const h = inspector("Encoder");
    // A page opened while OBS is away asks for the filters again once it is back.
    const offline = { status: { kind: "obs_unreachable" }, catalog: {} };

    // Before the first state the page renders and promises nothing.
    h.render({}, null);
    expect(h.fill("fx-source").items).toEqual([]);
    h.render({}, base);
    expect(h.fill("fx-source")).toEqual({
      items: [{ value: "uuid-scene", text: "Scene: Scene Live" }, { value: "uuid-group", text: "Group: Overlays" }, { value: "uuid-camera", text: "Source: Camera" }],
      selected: "", placeholder: "Choose a source"
    });
    expect(h.text("fx-status")).toBe("Choose the source that holds the filter.");
    expect(h.shown("fx-press-row")).toBe(true);
    expect(h.shown("fx-operation-row")).toBe(false);

    // A chosen source's filters are asked for once, by UUID.
    h.render({ sourceUuid: "uuid-scene", sourceName: "Scene Live" }, base);
    h.render({ sourceUuid: "uuid-scene", sourceName: "Scene Live" }, base);
    expect(h.filterRequests).toEqual(["uuid-scene"]);
    h.render({ sourceUuid: "uuid-scene", sourceName: "Scene Live" }, offline);
    h.render({ sourceUuid: "uuid-scene", sourceName: "Scene Live" }, base);
    expect(h.filterRequests).toEqual(["uuid-scene", "uuid-scene"]);
    h.render({ sourceUuid: "uuid-scene", sourceName: "Scene Live" }, state);
    expect(h.fill("fx-filter").items).toEqual([
      { value: "Aura", text: "Aura (Visual Sidechain: Shader Filter)" },
      { value: "Pulse", text: "Pulse (Visual Sidechain: Audio Modulator)" }
    ]);
    expect(h.text("fx-status")).toBe("Choose one of the source's filters.");
    h.change("fx-source", "uuid-camera");
    expect(h.saved.at(-1)).toEqual({ sourceUuid: "uuid-camera", sourceName: "Camera", filterName: "", filterKind: "", setting: "" });
    h.change("fx-filter", "Aura");
    expect(h.saved.at(-1)).toEqual({ filterName: "Aura", filterKind: VS_SHADER_KIND, setting: "" });

    const bound = { sourceUuid: "uuid-scene", sourceName: "Scene Live", filterName: "Aura", filterKind: VS_SHADER_KIND };
    h.render(bound, state);
    expect(h.fill("fx-setting").items).toEqual([
      { value: "vs_effect_mix_pct", text: "Effect mix" },
      { value: "vs_audio_reactivity_pct", text: "Reactivity (driven by Pulse)" },
      { value: "glow_amount", text: "glow_amount (set a range)" }
    ]);
    expect(h.text("fx-status")).toBe("Choose the setting to control.");
    h.change("fx-setting", "vs_effect_mix_pct");
    expect(h.saved.at(-1)).toEqual({ setting: "vs_effect_mix_pct", rangeMin: undefined, rangeMax: undefined, integer: undefined });
    expect(Object.keys(h.saved.at(-1)!)).toEqual(["setting", "rangeMin", "rangeMax", "integer"]);
    h.render({ ...bound, setting: "vs_effect_mix_pct" }, state);
    expect(h.shown("fx-status")).toBe(false);
    expect(h.shown("fx-custom-range")).toBe(false);
    h.render({ ...bound, setting: "vs_audio_reactivity_pct" }, state);
    expect(h.text("fx-status")).toBe("Pulse drives this setting, so the deck never writes it. Unbind it there first.");
    // Off the table the range is required.
    h.render({ ...bound, setting: "glow_amount" }, state);
    expect(h.shown("fx-custom-range")).toBe(true);
    expect(h.text("fx-status")).toBe("This setting is not in the deck's range table: type the range it may move in.");
    h.change("fx-range-min", "0");
    expect(h.saved.at(-1)).toEqual({ rangeMin: 0 });
    h.render({ ...bound, setting: "glow_amount", rangeMin: 0, rangeMax: 2 }, state);
    expect(h.shown("fx-status")).toBe(false);
    // Another setting never inherits that range.
    h.change("fx-setting", "vs_effect_mix_pct");
    expect(h.saved.at(-1)).toEqual({ setting: "vs_effect_mix_pct" });
    expect(Object.keys(h.saved.at(-1)!)).toEqual(["setting", "rangeMin", "rangeMax", "integer"]);
    // The modulator amount takes one of three ranges.
    h.render({ ...bound, filterName: "Pulse", filterKind: VS_MODULATOR_KIND, setting: "slot_1_amount_pct", rangeMin: -100, rangeMax: 100 }, state);
    expect(h.shown("fx-preset-row")).toBe(true);
    expect(h.shown("fx-custom-range")).toBe(false);
    expect(h.value("fx-range-preset")).toBe("-100:100");
    h.change("fx-range-preset", "-100:0");
    expect(h.saved.at(-1)).toEqual({ rangeMin: -100, rangeMax: 0 });
    h.render({ ...bound, filterName: "Pulse", filterKind: VS_MODULATOR_KIND, setting: "slot_1_amount_pct" }, state);
    expect(h.value("fx-range-preset")).toBe("");
    expect(h.text("fx-status")).toBe("Choose the range this amount may move in.");

    // A missing source keeps a row with the stored name, never the UUID; a renamed filter is missing.
    h.render({ ...bound, sourceUuid: "uuid-gone", sourceName: "Old scene" }, state);
    expect(h.fill("fx-source").items.at(-1)).toEqual({ value: "uuid-gone", text: "Old scene (not in OBS now)" });
    expect(h.fill("fx-source").items.some((item) => item.text.includes("uuid-gone"))).toBe(false);
    expect(h.text("fx-status")).toBe("The chosen source is not in OBS now.");
    h.render({ ...bound, filterName: "Aura renamed" }, state);
    expect(h.text("fx-status")).toBe("No filter of that name on the source now. A renamed filter must be chosen again.");
    h.render({ ...bound, filterKind: COLOR_FILTER_KIND }, state);
    expect(h.text("fx-status")).toBe("This filter is now of another kind. Choose it again to control it.");
  });

  it("keys: an on/off key needs no setting; a set key offers the current value", () => {
    const aura = { filterName: "Aura", filterKind: VS_SHADER_KIND, filterEnabled: true, settings: [{ setting: "vs_effect_mix_pct", label: "Effect mix", value: 62, table: true }] };
    const state = {
      status: { kind: "connected" }, catalog: { sceneDetails: [{ sceneName: "Scene Live", sceneUuid: "uuid-scene" }] },
      filterCatalog: { "uuid-scene": { filters: [aura], error: "" } }
    };
    const bound = { sourceUuid: "uuid-scene", filterName: "Aura", filterKind: VS_SHADER_KIND };
    const h = inspector("Keypad");
    h.render(bound, state);
    expect(h.shown("fx-operation-row")).toBe(true);
    expect(h.shown("fx-press-row")).toBe(false);
    expect(h.shown("fx-setting-row")).toBe(false);
    expect(h.shown("fx-status")).toBe(false);
    h.change("fx-operation", "set");
    expect(h.saved.at(-1)).toEqual({ keyOperation: "set" });
    h.render({ ...bound, keyOperation: "set", setting: "vs_effect_mix_pct", value: 0, durationMs: 2000 }, state);
    expect(h.shown("fx-value-row")).toBe(true);
    expect(h.value("fx-duration")).toBe("2000");
    h.click("fx-use-current");
    expect(h.saved.at(-1)).toEqual({ value: 62 });
    h.render({ ...bound, keyOperation: "step_up", setting: "vs_effect_mix_pct" }, state);
    expect(h.shown("fx-step-row")).toBe(true);
    expect(h.value("fx-step")).toBe("10");
  });
});
