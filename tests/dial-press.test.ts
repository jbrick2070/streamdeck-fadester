// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from "vitest";
import { ObsFaderDialInstanceController } from "../src/actions/obs-fader-dial.js";
import { LayerController } from "../src/control/layer-controller.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { ObsFaderDialSettings } from "../src/types/settings.js";

function setup(settings: ObsFaderDialSettings = {}, withLayers = true) {
  const calls: string[] = [];
  const catalog = {
    studioMode: true,
    currentProgramScene: "Live",
    currentPreviewScene: "Next",
    tbarPosition: 0.4,
    inputVolumes: {}
  };
  const client = {
    isConnected: vi.fn(() => true),
    getCatalog: vi.fn(() => catalog),
    nudgeReconnect: vi.fn(),
    setTbarPosition: vi.fn(async (..._args: unknown[]) => { calls.push("finish"); }),
    nudgeInputVolume: vi.fn(async () => {}),
    nudgeTbar: vi.fn(async () => {})
  };
  const layers = {
    perform: vi.fn(async (..._args: unknown[]) => { calls.push("source"); })
  };
  const sink = { setFeedback: vi.fn(async () => {}), showAlert: vi.fn(async () => {}) };
  const controller = new ObsFaderDialInstanceController(
    client as unknown as DirectObsClient,
    sink,
    settings,
    1,
    withLayers ? layers as unknown as LayerController : undefined
  );
  return { controller, client, catalog, layers, sink, calls };
}

describe("Configurable direct dial press", () => {
  it("preserves the old defaults: scene dial finishes, audio dial does nothing", async () => {
    const scene = setup({ target: "tbar", autoQueueNextScene: true }, false);
    await scene.controller.handleDialUp();
    expect(scene.client.setTbarPosition).toHaveBeenCalledWith(1, true, true);
    expect(scene.sink.showAlert).not.toHaveBeenCalled();

    const audio = setup({ target: "input_volume" }, false);
    await audio.controller.handleDialUp();
    expect(audio.client.setTbarPosition).not.toHaveBeenCalled();
    expect(audio.client.isConnected).not.toHaveBeenCalled();
    expect(audio.sink.showAlert).not.toHaveBeenCalled();
  });

  it.each([
    ["next_blend", "blend_next"],
    ["previous_blend", "blend_previous"],
    ["normal_blend", "blend_normal"],
    ["toggle_source", "show_hide"]
  ] as const)("%s acts on the shared selected source without a mixer input", async (pressAction, operation) => {
    const h = setup({ target: "input_volume", inputName: "", pressAction });
    await h.controller.handleDialUp();
    expect(h.layers.perform).toHaveBeenCalledWith({ scope: "auto", target: "selected" }, operation);
    expect(h.client.setTbarPosition).not.toHaveBeenCalled();
    expect(h.sink.showAlert).not.toHaveBeenCalled();
    // Rotation still needs a real mixer-input binding.
    await h.controller.handleRotate(1);
    expect(h.client.nudgeInputVolume).not.toHaveBeenCalled();
    expect(h.sink.showAlert).toHaveBeenCalledOnce();
  });

  it("changes the selected source blend before finishing the scene transition", async () => {
    const h = setup({ target: "tbar", pressAction: "next_blend_and_finish", autoQueueNextScene: true });
    await h.controller.handleDialUp();
    expect(h.calls).toEqual(["source", "finish"]);
    expect(h.layers.perform).toHaveBeenCalledWith({ scope: "fixed", sceneName: "Next", target: "selected" }, "blend_next");
    expect(h.client.setTbarPosition).toHaveBeenCalledWith(1, true, true);
  });

  it.each(["same_scene", "studio_off", "audio_target"] as const)(
    "rejects combined press before any layer change when %s",
    async (condition) => {
      const h = setup({ target: condition === "audio_target" ? "input_volume" : "tbar", pressAction: "next_blend_and_finish" });
      if (condition === "same_scene") h.catalog.currentPreviewScene = "Live";
      if (condition === "studio_off") h.catalog.studioMode = false;
      await h.controller.handleDialUp();
      expect(h.layers.perform).not.toHaveBeenCalled();
      expect(h.client.setTbarPosition).not.toHaveBeenCalled();
      expect(h.sink.showAlert).toHaveBeenCalledOnce();
    }
  );

  it("does not transition if the blend request fails", async () => {
    const h = setup({ target: "tbar", pressAction: "next_blend_and_finish" });
    h.layers.perform.mockRejectedValueOnce(new Error("Selected layer was removed."));
    await h.controller.handleDialUp();
    expect(h.client.setTbarPosition).not.toHaveBeenCalled();
    expect(h.sink.showAlert).toHaveBeenCalledOnce();
  });

  it("does not take a different scene live if Preview changes while the blend request is pending", async () => {
    const h = setup({ target: "tbar", pressAction: "next_blend_and_finish" });
    h.layers.perform.mockImplementationOnce(async () => { h.catalog.currentPreviewScene = "Changed elsewhere"; });
    await h.controller.handleDialUp();
    expect(h.client.setTbarPosition).not.toHaveBeenCalled();
    expect(h.sink.showAlert).toHaveBeenCalledOnce();
  });

  it("alerts without side effects when OBS or the layer backend is unavailable", async () => {
    const offline = setup({ target: "input_volume", pressAction: "next_blend" });
    offline.client.isConnected.mockReturnValue(false);
    await offline.controller.handleDialUp(12345);
    expect(offline.client.nudgeReconnect).toHaveBeenCalledWith(2000, 12345);
    expect(offline.layers.perform).not.toHaveBeenCalled();
    expect(offline.sink.showAlert).toHaveBeenCalledOnce();

    const absent = setup({ target: "tbar", pressAction: "next_blend_and_finish" }, false);
    await absent.controller.handleDialUp();
    expect(absent.client.setTbarPosition).not.toHaveBeenCalled();
    expect(absent.sink.showAlert).toHaveBeenCalledOnce();
  });

  it("disabled presses do nothing, including while disconnected", async () => {
    const h = setup({ target: "tbar", pressAction: "none" });
    h.client.isConnected.mockReturnValue(false);
    await h.controller.handleDialUp();
    expect(h.client.isConnected).not.toHaveBeenCalled();
    expect(h.layers.perform).not.toHaveBeenCalled();
    expect(h.client.setTbarPosition).not.toHaveBeenCalled();
    expect(h.sink.showAlert).not.toHaveBeenCalled();
  });
});
