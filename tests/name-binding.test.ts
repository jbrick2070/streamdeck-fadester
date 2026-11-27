// SPDX-License-Identifier: GPL-2.0-or-later
// Review 2026-11-27 #7: audio, scene and fixed-scene layer controls were bound by OBS name only, so a rename in OBS
// left them "unavailable". They now keep the UUID OBS gives the input or scene, follow a rename through it, keep the
// name as what is shown and as the fallback, and record the UUID of settings saved before this without losing them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObsFadeKeyInstanceController } from "../src/actions/obs-fade-key.js";
import { ObsFaderDialInstanceController } from "../src/actions/obs-fader-dial.js";
import { ObsLayerInstanceController } from "../src/actions/obs-layer-control.js";
import { ObsSceneTransitionKeyInstanceController } from "../src/actions/obs-scene-transition-key.js";
import { LayerController, type LayerSettings } from "../src/control/layer-controller.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { followNameBinding } from "../src/obs/name-binding.js";
import type { ObsFadeKeySettings, ObsFaderDialSettings, ObsSceneTransitionKeySettings } from "../src/types/settings.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

describe("followNameBinding", () => {
  const entries = [{ name: "Mic", uuid: "u-mic" }, { name: "Music", uuid: "u-music" }];
  it("follows a rename by UUID and records the UUID of a name saved without one", () => {
    expect(followNameBinding([{ name: "Mic 2", uuid: "u-mic" }], "Mic", "u-mic")).toEqual({ name: "Mic 2", uuid: "u-mic" });
    expect(followNameBinding(entries, "Mic", "")).toEqual({ name: "Mic", uuid: "u-mic" });
    expect(followNameBinding(entries, "Mic", "u-mic")).toBeNull();
  });
  it("falls back to the name when OBS does not know the UUID, and leaves placeholders and an empty catalog alone", () => {
    expect(followNameBinding(entries, "Music", "u-elsewhere")).toEqual({ name: "Music", uuid: "u-music" });
    expect(followNameBinding(entries, "Gone", "u-gone")).toBeNull();
    expect(followNameBinding(entries, "__audio_main__", "")).toBeNull();
    expect(followNameBinding([{ name: "__next_scene__", uuid: "u" }], "__next_scene__", "")).toBeNull();
    expect(followNameBinding([], "Mic", "u-mic")).toBeNull();
  });
});

describe("controls bound by an OBS name follow a rename in OBS", () => {
  let server: FakeObsServer;
  let client: DirectObsClient;
  const cleanup: Array<() => void> = [];

  afterEach(async () => {
    for (const step of cleanup.splice(0)) step();
    client?.stop();
    await server?.stop();
  });

  async function connect(): Promise<void> {
    server = new FakeObsServer();
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" }, { baseReconnectMs: 60_000 });
    client.start();
    await vi.waitFor(() => expect(client.getStatus().kind).toBe("connected"), { timeout: 3000 });
    await vi.waitFor(() => {
      expect(client.getCatalog().inputDetails.map((input) => input.inputName)).toContain("Mic/Aux");
      expect(client.getCatalog().sceneDetails.map((scene) => scene.sceneName)).toContain("Scene 3");
    }, { timeout: 3000 });
  }

  const inputUuid = (name: string): string => client.getCatalog().inputDetails.find((input) => input.inputName === name)!.inputUuid;

  it("a fade key and an audio dial keep their input, and old settings gain its UUID with nothing lost", async () => {
    await connect();
    const mic = inputUuid("Mic/Aux");
    const keySaves: ObsFadeKeySettings[] = [];
    const old: ObsFadeKeySettings = { inputName: "Mic/Aux", to: 0, durationMs: 0, labelOverride: "My mic", accent: "teal" };
    const key = new ObsFadeKeyInstanceController(client, {
      setImage: async () => {}, showAlert: async () => {}, saveSettings: async (s) => { keySaves.push(s); }
    }, old, 1);
    key.appear(old);
    cleanup.push(() => key.disappear());
    expect(keySaves.at(-1)).toEqual({ ...old, inputUuid: mic });

    const dialSaves: ObsFaderDialSettings[] = [];
    const dial = new ObsFaderDialInstanceController(client, {
      setFeedback: async () => {}, showAlert: async () => {}, saveSettings: async (s) => { dialSaves.push(s); }
    }, { target: "input_volume", inputName: "Mic/Aux", inputUuid: mic }, 1);
    dial.appear();
    cleanup.push(() => dial.disappear());
    expect(dialSaves).toEqual([]); // already bound: nothing to save

    server.renameInput(mic, "Mic 2");
    await vi.waitFor(() => {
      expect(keySaves.at(-1)).toEqual({ ...old, inputName: "Mic 2", inputUuid: mic });
      expect(dialSaves.at(-1)).toEqual({ target: "input_volume", inputName: "Mic 2", inputUuid: mic });
    }, { timeout: 3000 });
    await vi.waitFor(() => expect(Object.keys(client.getCatalog().inputVolumes)).toContain("Mic 2"), { timeout: 3000 });

    // Both still work on the renamed input.
    server.inputVolumes.set("Mic 2", 0.5);
    await key.handleKeyDown();
    await vi.waitFor(() => expect(server.inputVolumes.get("Mic 2")).toBe(0), { timeout: 3000 });
    await dial.handleRotate(5, 10_000);
    expect(server.inputVolumes.get("Mic 2")).toBeGreaterThan(0);
  });

  it("a scene key and a fixed-scene layer control keep their scene", async () => {
    await connect();
    const scene3 = server.sceneUuidFor("Scene 3");
    const keySaves: ObsSceneTransitionKeySettings[] = [];
    const old: ObsSceneTransitionKeySettings = { sceneTarget: "Scene 3", operation: "preview", presetBindingsVersion: 1 };
    const key = new ObsSceneTransitionKeyInstanceController(client, {
      setImage: async () => {}, showAlert: async () => {}, saveSettings: async (s) => { keySaves.push(s); }
    }, old, 1);
    key.appear(old);
    cleanup.push(() => key.disappear());
    expect(keySaves.at(-1)).toEqual({ ...old, sceneUuid: scene3 });

    const layers = new LayerController(client);
    const layerSaves: LayerSettings[] = [];
    const fixed: LayerSettings = { scope: "fixed", sceneName: "Scene 3", operation: "show_hide" };
    const layer = new ObsLayerInstanceController(layers, {
      render: async () => {}, showAlert: async () => {}, saveSettings: async (s) => { layerSaves.push(s); }
    }, false, fixed);
    layer.appear();
    cleanup.push(() => layer.disappear());
    expect(layerSaves.at(-1)).toEqual({ ...fixed, sceneUuid: scene3 });

    // Placeholders are never bound to a scene.
    const nextSaves: ObsSceneTransitionKeySettings[] = [];
    const next = new ObsSceneTransitionKeyInstanceController(client, {
      setImage: async () => {}, showAlert: async () => {}, saveSettings: async (s) => { nextSaves.push(s); }
    }, { sceneTarget: "__next_scene__" }, 1);
    next.appear();
    cleanup.push(() => next.disappear());

    server.renameScene("Scene 3", "Scene Three");
    await vi.waitFor(() => {
      expect(keySaves.at(-1)).toEqual({ ...old, sceneTarget: "Scene Three", sceneUuid: scene3 });
      expect(layerSaves.at(-1)).toEqual({ ...fixed, sceneName: "Scene Three", sceneUuid: scene3 });
    }, { timeout: 3000 });
    expect(nextSaves).toEqual([]);

    // The scene key still puts its scene in Preview.
    await key.handleKeyDown();
    await vi.waitFor(() => expect(server.previewSceneName).toBe("Scene Three"), { timeout: 3000 });
  });
});
