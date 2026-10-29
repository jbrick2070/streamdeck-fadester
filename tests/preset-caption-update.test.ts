// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { ObsFadeKeyInstanceController } from "../src/actions/obs-fade-key.js";

/** Run the real inspector callback and invoke its target selection handler. */
function change(file: string, id: string, settings: Record<string, unknown>, value: string): Record<string, unknown> {
  const html = readFileSync(`com.jbrick2070.fadester-for-obs.sdPlugin/ui/${file}`, "utf8");
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
    value: "", textContent: "", checked: false, className: "", style: {} as Record<string, string>,
    querySelector: () => ({ textContent: "", disabled: false }), onchange: () => {}
  }]));
  let render!: (settings: Record<string, unknown>, save: (update: Record<string, unknown>) => void, state: object) => void;
  runInNewContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join("\n"), {
    document: { activeElement: null, getElementById: (name: string) => elements.get(name) },
    window: {
      initDirectObsPropertyInspector: (callback: typeof render) => { render = callback; },
      directObsFillSelect: () => {}, directObsAudioItems: () => [], directObsRefreshLayers: () => {}
    }
  });
  let update: Record<string, unknown> = {};
  render(settings, (value) => { update = value; }, { status: { kind: "connected" }, catalog: { studioMode: true } });
  const element = elements.get(id)!;
  element.value = value;
  element.onchange();
  return update;
}

describe("preset captions when an operator changes targets", () => {
  it.each([
    ["__audio_main__", "Music down"], ["__audio_mic__", "Mic down"],
    ["__audio_aux__", "Aux up"], ["__audio_input_2__", "Aux down"]
  ])("removes the shipped %s caption when its audio target changes", (inputName, labelOverride) => {
    expect(change("obs-fade-key.html", "obs-fade-input", { inputName, labelOverride }, "Desktop Audio"))
      .toEqual({ inputName: "Desktop Audio", labelOverride: "" });
  });

  it("preserves a custom caption and a reselected unchanged binding", () => {
    expect(change("obs-fade-key.html", "obs-fade-input", { inputName: "__audio_mic__", labelOverride: "My voice" }, "Desktop Audio"))
      .toEqual({ inputName: "Desktop Audio" });
    expect(change("obs-fade-key.html", "obs-fade-input", { inputName: "__audio_mic__", labelOverride: "Mic down" }, "__audio_mic__"))
      .toEqual({ inputName: "__audio_mic__" });
  });

  it("shows the newly selected input on the real key image", () => {
    const previous = { inputName: "__audio_mic__", labelOverride: "Mic down", to: 0 as const };
    const update = change("obs-fade-key.html", "obs-fade-input", previous, "Desktop Audio");
    const client = new DirectObsClient();
    vi.spyOn(client, "isConnected").mockReturnValue(true);
    vi.spyOn(client, "getStatus").mockReturnValue({ kind: "connected", sentence: "Connected", cellReason: "" });
    vi.spyOn(client, "resolveInputName").mockImplementation((name) => name);
    let image = "";
    const key = new ObsFadeKeyInstanceController(client, {
      setImage: async (value) => { image = decodeURIComponent(value); }, showAlert: async () => {}
    }, { ...previous, ...update });
    key.appear();
    expect(image).toContain(">Desktop Audio</text>");
    expect(image).not.toContain("Mic down");
    key.disappear();
  });

  it("releases outdated dial role captions when changing audio or dial mode", () => {
    expect(change("obs-fader-dial.html", "obs-fader-input", { target: "input_volume", inputName: "__audio_main__", labelOverride: "Music" }, "Mic/Aux"))
      .toEqual({ inputName: "Mic/Aux", labelOverride: "" });
    expect(change("obs-fader-dial.html", "obs-fader-target", { target: "tbar", labelOverride: "Scene blend" }, "input_volume"))
      .toEqual({ target: "input_volume", labelOverride: "" });
    expect(change("obs-fader-dial.html", "obs-fader-target", { target: "tbar", labelOverride: "My mix" }, "input_volume"))
      .toEqual({ target: "input_volume" });
  });

  it.each([
    ["__scene_index_0__", "Scene 1"], ["__scene_index_1__", "Scene B"],
    ["__previous_scene__", "Prev scene"], ["__next_scene__", "Cut next"],
    ["__current_preview__", "Transition"], ["__random_scene__", "Random scene"]
  ])("releases the shipped %s label when selecting a fixed scene", (sceneTarget, labelOverride) => {
    expect(change("obs-scene-transition-key.html", "obs-scene-target", { sceneTarget, labelOverride }, "Camera"))
      .toEqual({ sceneTarget: "Camera", presetBindingsVersion: 1, labelOverride: "" });
  });

  it("keeps an operator-written scene caption and deliberate clear", () => {
    expect(change("obs-scene-transition-key.html", "obs-scene-target", { sceneTarget: "__next_scene__", labelOverride: "My cue" }, ""))
      .toEqual({ sceneTarget: "", presetBindingsVersion: 1 });
  });
});
