// SPDX-License-Identifier: GPL-2.0-or-later
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { LayerController, LayerSettings } from "../src/control/layer-controller.js";
import { ObsLayerInstanceController } from "../src/actions/obs-layer-control.js";
import { ObsFaderDialInstanceController } from "../src/actions/obs-fader-dial.js";
import { ObsFadeKeyInstanceController } from "../src/actions/obs-fade-key.js";
import { ObsSceneTransitionKeyInstanceController } from "../src/actions/obs-scene-transition-key.js";
import {
  ObsFadeKeySettings, ObsFaderDialSettings, ObsSceneTransitionKeySettings
} from "../src/types/settings.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

type Assignment = {
  kind: "layer" | "scene" | "fader" | "fade";
  controller: "Keypad" | "Encoder";
  label: string;
  settings: Record<string, string | boolean | number>;
};
type Preset = { slug: string; obsMode: "either" | "studio" | "regular"; actions: Assignment[] };
const presets = JSON.parse(readFileSync(new URL("../profiles/layouts.json", import.meta.url), "utf8")) as Preset[];
const sceneNames = ["Opening", "Wide camera", "Close camera", "Slides", "Browser",
  "Demonstration", "Questions", "Break", "Credits", "Closing"];
const nativeBlendModes = ["OBS_BLEND_NORMAL", "OBS_BLEND_ADDITIVE", "OBS_BLEND_SUBTRACT",
  "OBS_BLEND_SCREEN", "OBS_BLEND_MULTIPLY", "OBS_BLEND_LIGHTEN", "OBS_BLEND_DARKEN"];
const expectedAudioInputs: Record<string, string> = {
  __audio_main__: "Desktop Audio", __audio_mic__: "Mic/Aux", __audio_aux__: "Browser Audio"
};

type NativeItem = {
  sceneItemId: number;
  sceneItemIndex: number;
  sourceName: string;
  sceneItemEnabled: boolean;
  sceneItemBlendMode: number;
};

/** The shared fake handles scenes/audio. This test-local adapter adds native
 * scene items on the same WebSocket, including numeric OBS blend readback. */
function addNativeLayers(server: FakeObsServer): {
  items: Map<string, NativeItem[]>;
  reset(sceneName: string): NativeItem[];
} {
  const items = new Map<string, NativeItem[]>();
  function reset(sceneName: string): NativeItem[] {
    const base = (sceneNames.indexOf(sceneName) + 1) * 100;
    const value = [
      { sceneItemId: base + 1, sceneItemIndex: 0, sourceName: "Background", sceneItemEnabled: true, sceneItemBlendMode: 0 },
      { sceneItemId: base + 2, sceneItemIndex: 1, sourceName: "Camera", sceneItemEnabled: true, sceneItemBlendMode: 4 },
      { sceneItemId: base + 3, sceneItemIndex: 2, sourceName: "Overlay", sceneItemEnabled: true, sceneItemBlendMode: 0 }
    ];
    items.set(sceneName, value);
    return value;
  }
  sceneNames.forEach(reset);
  type RequestHandler = (ws: WebSocket, id: string, type: string, data: Record<string, unknown>) => Promise<void>;
  const native = server as unknown as { handleObsRequest: RequestHandler };
  const original = native.handleObsRequest.bind(server);
  native.handleObsRequest = async (ws, requestId, requestType, requestData) => {
    if (!["GetSceneItemList", "SetSceneItemEnabled", "SetSceneItemBlendMode", "SetSceneItemIndex"].includes(requestType)) {
      return original(ws, requestId, requestType, requestData);
    }
    const scene = items.get(String(requestData.sceneName));
    const item = scene?.find((entry) => entry.sceneItemId === requestData.sceneItemId);
    const valid = !!scene && (requestType === "GetSceneItemList" || !!item);
    let responseData: Record<string, unknown> = {};
    if (valid && scene) {
      if (requestType === "GetSceneItemList") {
        responseData = { sceneItems: scene.map((entry) => ({ ...entry })) };
      } else if (item) {
        server.directCallLog.push({ requestType, requestData: { ...requestData } });
        if (requestType === "SetSceneItemEnabled") item.sceneItemEnabled = requestData.sceneItemEnabled === true;
        if (requestType === "SetSceneItemBlendMode") {
          item.sceneItemBlendMode = nativeBlendModes.indexOf(String(requestData.sceneItemBlendMode));
        }
        if (requestType === "SetSceneItemIndex") {
          const ordered = [...scene].sort((a, b) => a.sceneItemIndex - b.sceneItemIndex);
          ordered.splice(ordered.indexOf(item), 1);
          ordered.splice(Number(requestData.sceneItemIndex), 0, item);
          ordered.forEach((entry, index) => { entry.sceneItemIndex = index; });
        }
      }
    }
    ws.send(JSON.stringify({ op: 7, d: {
      requestType, requestId, requestStatus: { result: valid, code: valid ? 100 : 600 }, responseData
    } }));
  };
  return { items, reset };
}

function svg(uri: string): string {
  return decodeURIComponent(uri.replace("data:image/svg+xml;utf8,", ""));
}

describe("ready-made presets operate an existing OBS collection", () => {
  let server: FakeObsServer | undefined;
  let client: DirectObsClient | undefined;

  async function connect(studio: boolean, thirdInput = true): Promise<{
    obs: FakeObsServer; direct: DirectObsClient; layers: LayerController;
    native: ReturnType<typeof addNativeLayers>;
  }> {
    server = new FakeObsServer({ studioMode: studio, missingPlugin: true });
    server.sceneNames = [...sceneNames];
    server.programSceneName = sceneNames[0];
    server.previewSceneName = sceneNames[1];
    if (thirdInput) {
      server.inputNames.push("Browser Audio");
      server.inputVolumes.set("Browser Audio", 0.4);
    }
    const native = addNativeLayers(server);
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const ready = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await ready;
    return { obs: server, direct: client, layers: new LayerController(client), native };
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    client?.stop();
    await server?.stop();
  });

  it("starts newly added audio controls on Main while respecting explicit choices and clears", async () => {
    const { obs, direct } = await connect(false);
    const alerts = vi.fn(async () => {});
    const dial = new ObsFaderDialInstanceController(direct, {
      setFeedback: async () => {}, showAlert: alerts
    }, {});
    await dial.handleRotate(1);
    expect(obs.inputVolumes.get("Desktop Audio")).toBeCloseTo(0.82);
    dial.updateSettings({ inputName: "Mic/Aux", acceleration: false });
    await dial.handleRotate(1);
    expect(obs.inputVolumes.get("Mic/Aux")).toBeCloseTo(0.62);
    const key = new ObsFadeKeyInstanceController(direct, {
      setImage: async () => {}, showAlert: alerts
    }, { durationMs: 0 });
    await key.handleKeyDown();
    await vi.waitFor(() => expect(obs.inputVolumes.get("Desktop Audio")).toBe(1));
    const writes = obs.directCallLog.filter((entry) => entry.requestType === "SetInputVolume").length;
    dial.updateSettings({ target: "unconfigured", inputName: "" });
    key.updateSettings({ inputName: "", durationMs: 0 });
    await dial.handleRotate(1);
    await key.handleKeyDown();
    expect(alerts).toHaveBeenCalledTimes(2);
    expect(obs.directCallLog.filter((entry) => entry.requestType === "SetInputVolume")).toHaveLength(writes);
    dial.disappear(); key.disappear();
  });

  it("keeps automatic Main, Mic and Aux distinct even when OBS returns the microphone third", async () => {
    const { obs, direct } = await connect(false);
    obs.inputNames = ["Browser Audio", "Desktop Audio", "Mic/Aux"];
    await direct.refreshCatalog();
    const names = ["__audio_main__", "__audio_mic__", "__audio_aux__"].map((target) => direct.resolveInputName(target));
    expect(names).toEqual(["Desktop Audio", "Mic/Aux", "Browser Audio"]);
    expect(new Set(names).size).toBe(3);
    await direct.nudgeInputVolume("__audio_aux__", 0.1);
    expect(obs.inputVolumes.get("Browser Audio")).toBeCloseTo(0.5);
    expect(obs.inputVolumes.get("Mic/Aux")).toBe(0.6);
    // An explicitly chosen positional input keeps its original meaning.
    expect(direct.resolveInputName("__audio_input_2__")).toBe("Mic/Aux");
  });

  it.each(presets)("$slug has working assignments with its declared OBS mode", async (preset) => {
    const { obs, direct, layers, native } = await connect(preset.obsMode === "studio");
    const alerts = vi.fn(async () => {});
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    for (const entry of preset.actions) {
      const settings: Assignment["settings"] = { ...entry.settings, labelOverride: entry.label };
      if (entry.kind === "layer") {
        const layerSettings = settings as LayerSettings;
        const sceneName = layers.resolveScene(layerSettings);
        const original = native.reset(sceneName);
        const camera = original[1];
        await layers.selectLayer(sceneName, camera.sceneItemId);
        const controller = new ObsLayerInstanceController(layers,
          { render: async () => {}, showAlert: alerts }, entry.controller === "Encoder", layerSettings);
        const operation = entry.controller === "Encoder"
          ? settings.dialMode === "blend" ? "blend_next" : settings.dialMode === "order" ? "move_up" : "select_next"
          : settings.operation;
        expect(["select_next", "select_previous", "show_hide", "move_up", "move_down", "blend_next",
          "blend_previous", "blend_normal"], entry.label).toContain(operation);
        if (entry.controller === "Encoder") await controller.rotate(1); else await controller.press();
        expect(alerts, entry.label).not.toHaveBeenCalled();
        const state = layers.getScene(layerSettings);
        if (operation === "select_next") expect(state.selectedId, entry.label).toBe(original[0].sceneItemId);
        if (operation === "select_previous") expect(state.selectedId, entry.label).toBe(original[2].sceneItemId);
        if (operation === "show_hide") expect(camera.sceneItemEnabled, entry.label).toBe(false);
        if (operation === "move_up") expect(camera.sceneItemIndex, entry.label).toBe(2);
        if (operation === "move_down") expect(camera.sceneItemIndex, entry.label).toBe(0);
        if (operation === "blend_next") expect(camera.sceneItemBlendMode, entry.label).toBe(5);
        if (operation === "blend_previous") expect(camera.sceneItemBlendMode, entry.label).toBe(3);
        if (operation === "blend_normal") expect(camera.sceneItemBlendMode, entry.label).toBe(0);
        controller.disappear();
      }

      if (entry.kind === "fader") {
        if (settings.target === "input_volume") {
          expect(settings.inputName, entry.label).toBeTruthy();
          const name = expectedAudioInputs[String(settings.inputName)];
          expect(name, entry.label).toBeTruthy();
          expect(direct.resolveInputName(String(settings.inputName)), entry.label).toBe(name);
          obs.inputVolumes.set(name, 0.4);
          const controller = new ObsFaderDialInstanceController(direct,
            { setFeedback: async () => {}, showAlert: alerts }, settings as ObsFaderDialSettings);
          await controller.handleRotate(1, 1000);
          expect(obs.inputVolumes.get(name), entry.label).toBeCloseTo(0.4 + Number(settings.stepPerTick), 6);
          controller.disappear();
        } else {
          expect(settings.target).toBe("tbar");
          await direct.prepareStudioLayout();
          const controller = new ObsFaderDialInstanceController(direct,
            { setFeedback: async () => {}, showAlert: alerts }, settings as ObsFaderDialSettings);
          await controller.handleRotate(1, 1000);
          expect(obs.directTbarPosition, entry.label).toBeCloseTo(Number(settings.stepPerTick), 6);
          controller.disappear();
        }
        expect(alerts, entry.label).not.toHaveBeenCalled();
      }

      if (entry.kind === "fade") {
        expect(settings.inputName, entry.label).toBeTruthy();
        const name = expectedAudioInputs[String(settings.inputName)];
        expect(name, entry.label).toBeTruthy();
        expect(direct.resolveInputName(String(settings.inputName)), entry.label).toBe(name);
        obs.inputVolumes.set(name, 0.4);
        // Preserve the shipped target/direction; instant duration keeps this
        // assignment test fast while dedicated fade tests cover elapsed time.
        const controller = new ObsFadeKeyInstanceController(direct,
          { setImage: async () => {}, showAlert: alerts }, { ...settings, durationMs: 0 } as ObsFadeKeySettings);
        await controller.handleKeyDown();
        await vi.waitFor(() => expect(obs.inputVolumes.get(name), entry.label).toBe(Number(settings.to)),
          { interval: 2, timeout: 500 });
        expect(alerts, entry.label).not.toHaveBeenCalled();
        controller.disappear();
      }

      if (entry.kind === "scene") {
        expect(settings.sceneTarget, entry.label).toBeTruthy();
        // Reorder without an event before every press, and use ten distinctly
        // named scenes so neither saved names nor a fixed three-scene bank pass.
        obs.sceneNames.push(obs.sceneNames.shift()!);
        obs.programSceneName = obs.sceneNames[4];
        obs.previewSceneName = obs.sceneNames[6];
        const live = obs.programSceneName;
        const preview = obs.previewSceneName;
        const operation = String(settings.operation);
        const target = String(settings.sceneTarget);
        const index = /^__scene_index_(\d+)__$/.exec(target);
        const base = operation === "preview" ? preview : live;
        const expected = index ? obs.sceneNames[Number(index[1])]
          : target === "__current_preview__" ? preview
          : target === "__next_scene__" ? obs.sceneNames[(obs.sceneNames.indexOf(base) + 1) % 10]
          : target === "__previous_scene__" ? obs.sceneNames[(obs.sceneNames.indexOf(base) + 9) % 10]
          : undefined;
        const controller = new ObsSceneTransitionKeyInstanceController(direct,
          { setImage: async () => {}, showAlert: alerts }, settings as ObsSceneTransitionKeySettings);
        await controller.handleKeyDown();
        expect(alerts, entry.label).not.toHaveBeenCalled();
        const actual = operation === "preview" ? obs.previewSceneName : obs.programSceneName;
        if (target === "__random_scene__") {
          expect(actual, entry.label).not.toBe(live);
          if (operation === "preview") expect(actual, entry.label).not.toBe(preview);
        } else {
          expect(actual, entry.label).toBe(expected);
        }
        if (operation === "preview") expect(obs.programSceneName, entry.label).toBe(live);
        if (operation === "cut") expect(obs.lastSceneTransition, entry.label).toBe("Cut");
        if (operation === "transition") expect(obs.lastSceneTransition, entry.label).toBe("Fade");
        controller.disappear();
      }
    }
    expect(obs.vendorCallLog).toEqual([]);
    expect(obs.sceneNames).toHaveLength(10);
    expect(obs.directCallLog.some((call) => call.requestType.startsWith("Create"))).toBe(false);
    expect(obs.directCallLog.filter((call) => call.requestType === "SetInputVolume")
      .every((call) => obs.inputNames.includes(String(call.requestData?.inputName)))).toBe(true);
  });

  it.each([
    [0, "LIVE"], [1, "PREVIEW"], [2, "SCENE"]
  ] as const)("labels fixed scene %s by its actual OBS role", async (index, role) => {
    const { layers } = await connect(true);
    const settings: LayerSettings = { scope: "fixed", sceneName: sceneNames[index], dialMode: "blend" };
    await layers.refresh(settings);
    let image = "";
    const control = new ObsLayerInstanceController(layers, {
      render: async (value) => { image = value; }, showAlert: async () => {}
    }, true, settings);
    try {
      control.appear();
      expect(image).toContain(`>${role}: ${sceneNames[index]}</text>`);
    } finally { control.disappear(); }
  });

  it("clears an offline press error after the OBS connection recovers", async () => {
    const { layers, direct } = await connect(false);
    await layers.refresh({ scope: "auto" });
    let image = "";
    const alerts = vi.fn(async () => {});
    const control = new ObsLayerInstanceController(layers, {
      render: async (value) => { image = value; }, showAlert: alerts
    }, false, { operation: "show_hide" });
    const connection = vi.spyOn(direct, "isConnected").mockReturnValue(false);
    vi.spyOn(direct, "nudgeReconnect").mockImplementation(() => false);
    try {
      control.appear();
      await control.press();
      await vi.waitFor(() => expect(image).toContain("OBS is not connected"));
      expect(alerts).toHaveBeenCalledOnce();
      connection.mockRestore();
      direct.emit("statusChanged", direct.getStatus());
      await layers.refresh({ scope: "auto" });
      await vi.waitFor(() => expect(image).toContain("Shown · Overlay"));
      expect(image).not.toContain("OBS is not connected");
    } finally { control.disappear(); }
  });

  it("shows the actual blend selected by a key before and after a press", async () => {
    const { layers, native } = await connect(false);
    const camera = native.items.get(sceneNames[0])![1];
    await layers.selectLayer(sceneNames[0], camera.sceneItemId);
    let image = "";
    const control = new ObsLayerInstanceController(layers, {
      render: async (value) => { image = value; }, showAlert: async () => {}
    }, false, { operation: "blend_next" });
    try {
      control.appear();
      expect(image).toContain("Multiply · Camera");
      await control.press();
      await vi.waitFor(() => expect(image).toContain("Lighten · Camera"));
    } finally { control.disappear(); }
  });

  it("shows empty scenes and removed source selections without claiming OBS is disconnected", async () => {
    const { layers, native } = await connect(false);
    const sceneName = sceneNames[0];
    const items = native.items.get(sceneName)!;
    await layers.selectLayer(sceneName, items[1].sceneItemId);
    items.splice(1, 1);
    await layers.refresh({ scope: "auto" });
    let image = "";
    const control = new ObsLayerInstanceController(layers, {
      render: async (value) => { image = value; }, showAlert: async () => {}
    }, false, { operation: "show_hide" });
    try {
      control.appear();
      expect(image).toContain("Choose a source");
      expect(image).not.toContain("Connect OBS");
      native.items.set(sceneName, []);
      await layers.refresh({ scope: "auto" });
      await vi.waitFor(() => expect(image).toContain("No sources in scene"));
      expect(image).not.toContain("Loading sources");
      expect(image).not.toContain("Connect OBS");
    } finally { control.disappear(); }
  });

  it("shows resolved OBS input names for shipped captions and preserves a custom caption", async () => {
    const { direct } = await connect(false);
    let dialImage = "";
    let keyImage = "";
    const dial = new ObsFaderDialInstanceController(direct, {
      setFeedback: async (feedback) => { dialImage = svg(feedback.canvas); }, showAlert: async () => {}
    }, { target: "input_volume", inputName: "__audio_main__", labelOverride: "Music" });
    const key = new ObsFadeKeyInstanceController(direct, {
      setImage: async (image) => { keyImage = svg(image); }, showAlert: async () => {}
    }, { inputName: "__audio_main__", labelOverride: "Music down", to: 0 });
    dial.appear(); key.appear();
    expect(dialImage).toContain(">Desktop Audio</text>");
    expect(keyImage).toContain(">Desktop Audio</text>");
    expect(keyImage).toContain("Down 1s");
    dial.disappear(); key.disappear();
    const custom = new ObsFadeKeyInstanceController(direct, {
      setImage: async (image) => { keyImage = svg(image); }, showAlert: async () => {}
    }, { inputName: "__audio_main__", labelOverride: "House sound" });
    custom.appear();
    expect(keyImage).toContain(">House sound</text>");
    custom.disappear();
  });

  it("leaves missing microphone and third-input preset controls visibly unavailable without affecting Desktop Audio", async () => {
    const { obs, direct } = await connect(false, false);
    obs.inputNames = ["Desktop Audio"];
    await direct.refreshCatalog();
    const alerts = vi.fn(async () => {});
    let dialImage = "";
    let keyImage = "";
    const dial = new ObsFaderDialInstanceController(direct, {
      setFeedback: async (feedback) => { dialImage = svg(feedback.canvas); }, showAlert: alerts
    }, { target: "input_volume", inputName: "__audio_input_2__", labelOverride: "Aux" });
    const key = new ObsFadeKeyInstanceController(direct, {
      setImage: async (image) => { keyImage = svg(image); }, showAlert: alerts
    }, { inputName: "__audio_mic__", labelOverride: "Mic down", to: 0, durationMs: 0 });
    dial.appear(); key.appear();
    expect(dialImage).toContain("Audio input 3 unavailable");
    expect(keyImage).toContain("Microphone unavailable");
    await dial.handleRotate(1);
    await key.handleKeyDown();
    await vi.waitFor(() => expect(alerts).toHaveBeenCalledTimes(2), { interval: 2, timeout: 500 });
    expect(obs.directCallLog.filter((call) => call.requestType === "SetInputVolume")).toEqual([]);
    expect(obs.inputVolumes.get("Desktop Audio")).toBe(0.8);
    dial.disappear(); key.disappear();
  });
});
