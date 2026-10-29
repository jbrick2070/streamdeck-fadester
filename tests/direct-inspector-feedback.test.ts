// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/** Execute the shipped inline inspector callback with its observed OBS state. */
function inspector(file: string) {
  const html = readFileSync(`com.jbrick2070.fadester-for-obs.sdPlugin/ui/${file}`, "utf8");
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
    value: "", textContent: "", checked: false, className: "", style: {} as Record<string, string>,
    onchange: undefined as (() => void) | undefined,
    querySelector: () => ({ textContent: "", disabled: false })
  }]));
  const saved: Array<Record<string, unknown>> = [];
  let render!: (settings: Record<string, unknown>, save: (patch: Record<string, unknown>) => void, state: Record<string, unknown>) => void;
  runInNewContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join("\n"), {
    document: { activeElement: null, getElementById: (id: string) => elements.get(id) },
    window: {
      initDirectObsPropertyInspector: (callback: typeof render) => { render = callback; },
      directObsFillSelect: (element: { value: string }, _items: unknown, selected: string) => { element.value = selected; },
      directObsAudioItems: () => [], directObsRefreshLayers: () => {}
    }
  });
  return { render: (settings: Record<string, unknown>, state: Record<string, unknown>) => render(settings, (patch) => saved.push(patch), state),
    text: (id: string) => elements.get(id)!.textContent,
    value: (id: string) => elements.get(id)!.value,
    change: (id: string, value: string) => { const element = elements.get(id)!; element.value = value; element.onchange?.(); }, saved };
}

describe("direct inspector feedback", () => {
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

  it("describes the configured T-bar press rather than always promising a take", () => {
    const h = inspector("obs-fader-dial.html");
    const state = { status: { kind: "connected" }, catalog: { studioMode: true } };
    h.render({ target: "tbar", pressAction: "none" }, state);
    expect(h.text("obs-fader-tbar-hint")).toContain("Dial press is disabled");
    expect(h.text("obs-fader-tbar-hint")).not.toContain("Press to take");
    h.render({ target: "tbar", pressAction: "toggle_source" }, state);
    expect(h.text("obs-fader-tbar-hint")).toContain("show or hide");
    expect(h.text("obs-fader-press-hint")).not.toContain("then takes Next live");
    h.render({ target: "tbar", pressAction: "finish_transition" }, state);
    expect(h.text("obs-fader-tbar-hint")).toContain("Press to take NEXT live");
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
