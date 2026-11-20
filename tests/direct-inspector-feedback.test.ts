// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { inspectorPageScript } from "./helpers/inspector-scripts.js";
import { describe, expect, it } from "vitest";

/** Execute the shipped inline inspector callback with its observed OBS state. */
function inspector(file: string) {
  const html = readFileSync(`io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/${file}`, "utf8");
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
    value: "", textContent: "", checked: false, className: "", style: {} as Record<string, string>,
    onchange: undefined as (() => void) | undefined,
    querySelector: () => ({ textContent: "", disabled: false })
  }]));
  const saved: Array<Record<string, unknown>> = [];
  let render!: (settings: Record<string, unknown>, save: (patch: Record<string, unknown>) => void, state: Record<string, unknown>) => void;
  runInNewContext(inspectorPageScript(html), {
    document: { activeElement: null, getElementById: (id: string) => elements.get(id) },
    window: {
      initDirectObsPropertyInspector: (callback: typeof render) => { render = callback; },
      directObsFillSelect: (element: { value: string }, _items: unknown, selected: string) => { element.value = selected; },
      directObsAudioItems: () => [], directObsRefreshLayers: () => {}, directObsFold: () => {}
    }
  });
  return { render: (settings: Record<string, unknown>, state: Record<string, unknown>) => render(settings, (patch) => saved.push(patch), state),
    text: (id: string) => elements.get(id)!.textContent,
    display: (id: string) => elements.get(id)!.style.display,
    value: (id: string) => elements.get(id)!.value,
    change: (id: string, value: string) => { const element = elements.get(id)!; element.value = value; element.onchange?.(); }, saved };
}

/** The Auto-fade page's own callback (a Midi Fadester page: pi-common.js is stubbed), with the saved settings. */
function autoFadeInspector(settings: Record<string, unknown>) {
  const html = readFileSync("io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/auto-fade-key.html", "utf8");
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
    value: "", textContent: "", style: {} as Record<string, string>, onchange: undefined as (() => void) | undefined
  }]));
  const saved: Array<Record<string, unknown>> = [];
  const window: Record<string, unknown> = {
    initFadesterPropertyInspector: (callback: (settings: Record<string, unknown>, save: (patch: Record<string, unknown>) => void) => void) => {
      callback(settings, (patch) => saved.push(patch));
    }
  };
  runInNewContext(inspectorPageScript(html), { document: { activeElement: null, getElementById: (id: string) => elements.get(id) }, window });
  return { saved, value: (id: string) => elements.get(id)!.value,
    change: (id: string, value: string) => { const element = elements.get(id)!; element.value = value; element.onchange?.(); } };
}

describe("direct inspector feedback", () => {
  // C-05: Number("") is 0, and 0 ms is an instant fade (on the Scene key: OBS's own transition duration).
  it("keeps the saved fade length when the Duration box is emptied (OBS Fade, Scene & Transition, Auto-fade)", () => {
    const state = { status: { kind: "connected" }, catalog: { inputVolumes: { Mic: 1 }, scenes: [], transitions: [] } };
    const fade = inspector("obs-fade-key.html");
    fade.render({ inputName: "Mic", durationMs: 2500 }, state);
    fade.change("obs-fade-duration", "");
    expect(fade.saved).toEqual([]);
    expect(fade.value("obs-fade-duration")).toBe("2500");
    fade.change("obs-fade-duration", "750");
    expect(fade.saved).toEqual([{ durationMs: 750 }]);
    // 0 typed on purpose is still "instant".
    fade.change("obs-fade-duration", "0");
    expect(fade.saved.at(-1)).toEqual({ durationMs: 0 });
    const fresh = inspector("obs-fade-key.html");
    fresh.render({ inputName: "Mic" }, state);
    fresh.change("obs-fade-duration", "");
    expect(fresh.saved).toEqual([]);
    expect(fresh.value("obs-fade-duration")).toBe("1000");

    const scene = inspector("obs-scene-transition-key.html");
    scene.render({ durationMs: 800 }, state);
    scene.change("obs-scene-duration", "");
    expect(scene.saved).toEqual([]);
    expect(scene.value("obs-scene-duration")).toBe("800");
    scene.change("obs-scene-duration", "1200");
    expect(scene.saved).toEqual([{ durationMs: 1200 }]);

    const auto = autoFadeInspector({ slot: "fader_1", durationMs: 4000 });
    auto.change("duration-input", "");
    expect(auto.saved).toEqual([]);
    expect(auto.value("duration-input")).toBe("4000");
    auto.change("duration-input", "600");
    auto.change("duration-input", "");
    expect(auto.saved).toEqual([{ durationMs: 600 }]);
    expect(auto.value("duration-input")).toBe("600");
  });

  it("saves a fixed source identity and displays a reused item ID as unavailable until explicitly reassigned", () => {
    const h = inspector("obs-layer-control.html");
    const item = { sceneItemId: 2, sourceName: "Camera", sourceUuid: "original-camera" };
    const scene = { layers: [item], selectedId: 2 };
    const state = { status: { kind: "connected" }, catalog: { currentProgramScene: "Opening" }, layerScenes: { Opening: scene } };
    const settings = { operation: "show_hide", scope: "fixed", sceneName: "Opening", target: "fixed", sceneItemId: -1 };
    h.render(settings, state);
    h.change("layer-item", "2");
    expect(h.saved.at(-1)).toEqual({ sceneItemId: 2, sourceUuid: "original-camera", sourceName: "Camera" });
    const bound = { ...settings, ...h.saved.at(-1) };
    item.sourceUuid = "different-camera";
    h.render(bound, state);
    expect(h.text("layer-status")).toContain("Saved source unavailable");
    expect(h.value("layer-item")).toBe("__missing_fixed_source__");
    expect(h.saved).toHaveLength(1);
    h.change("layer-item", "2");
    expect(h.saved.at(-1)).toEqual({ sceneItemId: 2, sourceUuid: "different-camera", sourceName: "Camera" });
  });

  it("describes the configured T-bar press, never as a take", () => {
    const h = inspector("obs-fader-dial.html");
    const state = { status: { kind: "connected" }, catalog: { studioMode: true } };
    h.render({ target: "tbar", pressAction: "none" }, state);
    expect(h.text("obs-fader-tbar-hint")).toContain("Dial press is disabled");
    expect(h.text("obs-fader-tbar-hint")).not.toContain("Preview to Program");
    h.render({ target: "tbar", pressAction: "toggle_source" }, state);
    expect(h.text("obs-fader-tbar-hint")).toContain("show or hide");
    expect(h.text("obs-fader-press-hint")).not.toContain("puts Preview on Program");
    h.render({ target: "tbar", pressAction: "finish_transition" }, state);
    expect(h.text("obs-fader-tbar-hint")).toBe("Turn to fade Preview into Program. Press: Preview to Program. Needs Studio Mode.");
    for (const press of ["none", "toggle_source", "finish_transition", "next_blend_and_finish"]) {
      h.render({ target: "tbar", pressAction: press }, state);
      expect(h.text("obs-fader-tbar-hint") + h.text("obs-fader-press-hint")).not.toMatch(/\btakes?\b/i);
    }
  });

  it("says under the T-bar settings whether OBS's own slider follows the dial, and why not", () => {
    const h = inspector("obs-fader-dial.html");
    const base = { status: { kind: "connected" }, catalog: { studioMode: true } };
    h.render({ target: "tbar" }, { ...base, nativeTbar: "following" });
    expect(h.text("obs-fader-slider-status")).toBe("OBS's on-screen T-bar moves with this dial.");
    h.render({ target: "tbar" }, { ...base, nativeTbar: "unreachable" });
    expect(h.text("obs-fader-slider-status")).toContain("not minimised");
    expect(h.text("obs-fader-slider-status")).toContain("Fading still works.");
    h.render({ target: "tbar" }, { ...base, nativeTbar: "permission" });
    expect(h.text("obs-fader-slider-status")).toContain("Accessibility");
    expect(h.text("obs-fader-slider-status")).toContain("Fading still works.");
    h.render({ target: "tbar" }, { ...base, nativeTbar: "unsupportedOs" });
    expect(h.text("obs-fader-slider-status")).toContain("Windows and macOS");
    h.render({ target: "tbar" }, { ...base, nativeTbar: "transition" });
    expect(h.text("obs-fader-slider-status")).toContain("Fade transition");
    h.render({ target: "tbar" }, { ...base, nativeTbar: "off" });
    expect(h.text("obs-fader-slider-status")).toBe("");
    h.render({ target: "input_volume" }, { ...base, nativeTbar: "following" });
    expect(h.text("obs-fader-slider-status")).toBe("");
  });

  it("distinguishes loaded empty scenes, removed selections, and fixed targets", () => {
    const h = inspector("obs-layer-control.html");
    const scene = { layers: [] as Array<{ sceneItemId: number; sourceName: string }>, selectedId: -1 };
    const state = { status: { kind: "connected" }, catalog: { currentProgramScene: "Opening" }, layerScenes: { Opening: scene } };
    h.render({ operation: "show_hide" }, state);
    expect(h.text("layer-status")).toContain("No sources in Opening");
    scene.layers.push({ sceneItemId: 1, sourceName: "Camera" }, { sceneItemId: 2, sourceName: "Overlay" });
    h.render({ operation: "show_hide" }, state);
    expect(h.text("layer-status")).toContain("Choose a source");
    expect(h.text("layer-status")).not.toContain("Loading");
    scene.selectedId = 1;
    h.render({ operation: "show_hide", scope: "fixed", sceneName: "Opening", target: "fixed", sceneItemId: 2 }, state);
    expect(h.text("layer-status")).toContain("Fixed source: Overlay");
    expect(h.text("layer-status")).not.toContain("Camera");
  });
});
