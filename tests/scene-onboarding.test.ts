// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  migrateScenePresetSettings,
  ObsSceneTransitionKeyInstanceController
} from "../src/actions/obs-scene-transition-key.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { DirectObsPropertyInspectorBridge } from "../src/pi/direct-obs-bridge.js";

describe("Scene layout onboarding", () => {
  it("lets newly added scene keys advance automatically while honoring cleared and fixed choices", async () => {
    const client = new DirectObsClient();
    vi.spyOn(client, "isConnected").mockReturnValue(true);
    const run = vi.spyOn(client, "runSceneAction").mockResolvedValue("Next destination");
    const alerts = vi.fn(async () => {});
    const key = new ObsSceneTransitionKeyInstanceController(client, {
      setImage: async () => {}, showAlert: alerts
    }, {});
    await key.handleKeyDown();
    expect(run).toHaveBeenLastCalledWith("__next_scene__", "transition", "__current_transition__");
    key.updateSettings({ sceneTarget: "Fixed camera" });
    await key.handleKeyDown();
    expect(run).toHaveBeenLastCalledWith("Fixed camera", "transition", "__current_transition__");
    key.updateSettings({ sceneTarget: "" });
    await key.handleKeyDown();
    expect(alerts).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("shows the automatic default in the inspector and saves user choices as explicit bindings", () => {
    const html = readFileSync("com.jbrick2070.fadester-for-obs.sdPlugin/ui/obs-scene-transition-key.html", "utf8");
    type Element = { value: string; textContent: string; className: string; style: Record<string, string>; onchange?: () => void };
    const elements = new Map<string, Element>([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
      value: "", textContent: "", className: "", style: {}
    }]));
    let render!: (settings: Record<string, unknown>, save: (patch: Record<string, unknown>) => void, state: Record<string, unknown>) => void;
    const selected: Record<string, string> = {};
    runInNewContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join("\n"), {
      document: { activeElement: null, getElementById: (id: string) => elements.get(id) },
      window: {
        initDirectObsPropertyInspector: (callback: typeof render) => { render = callback; },
        directObsFillSelect: (element: Element, _items: unknown[], value: string) => {
          const id = [...elements].find(([, entry]) => entry === element)?.[0];
          if (id) selected[id] = value;
        }
      }
    });
    const save = vi.fn();
    const state = { status: { kind: "connected" }, catalog: { scenes: ["Opening", "Camera"], studioMode: false } };
    render({}, save, state);
    expect(selected["obs-scene-target"]).toBe("__next_scene__");
    render({ sceneTarget: "" }, save, state);
    expect(selected["obs-scene-target"]).toBe("");
    render({ sceneTarget: "Camera" }, save, state);
    expect(selected["obs-scene-target"]).toBe("Camera");
    const target = elements.get("obs-scene-target")!;
    target.value = "";
    target.onchange!();
    expect(save).toHaveBeenCalledWith({ sceneTarget: "", presetBindingsVersion: 1 });
  });

  it("repairs old untouched scene placeholders while preserving explicit names, custom labels, and later clears", () => {
    expect(migrateScenePresetSettings({ sceneTarget: "", labelOverride: "Scene B", operation: "preview" }))
      .toMatchObject({ sceneTarget: "__scene_index_1__", presetBindingsVersion: 1, operation: "preview" });
    expect(migrateScenePresetSettings({ labelOverride: "Scene 3" }).sceneTarget).toBe("__scene_index_2__");
    const named = { sceneTarget: "My intro", labelOverride: "Scene A" };
    expect(migrateScenePresetSettings(named).sceneTarget).toBe("My intro");
    const custom = { sceneTarget: "", labelOverride: "Camera" };
    expect(migrateScenePresetSettings(custom)).toBe(custom);
    const cleared = { sceneTarget: "", labelOverride: "Scene 1", presetBindingsVersion: 1 };
    expect(migrateScenePresetSettings(cleared)).toBe(cleared);
  });

  it("shows the actual OBS scene name for an automatic numbered shortcut", async () => {
    const client = new DirectObsClient();
    vi.spyOn(client, "isConnected").mockReturnValue(true);
    vi.spyOn(client, "getStatus").mockReturnValue({ kind: "connected", sentence: "Connected", cellReason: "" });
    vi.spyOn(client, "resolveSceneTarget").mockReturnValue("Camera closeup");
    vi.spyOn(client, "getCatalog").mockReturnValue({ ...client.getCatalog(), studioMode: true });
    const images: string[] = [];
    const key = new ObsSceneTransitionKeyInstanceController(client, {
      setImage: async (image) => { images.push(image); }, showAlert: async () => {}
    }, { sceneTarget: "__scene_index_0__", labelOverride: "Scene 1", operation: "preview" }, 1);
    key.appear();
    await vi.waitFor(() => expect(images).toHaveLength(1));
    const svg = decodeURIComponent(images[0].split(",").slice(1).join(","));
    expect(svg).toContain("Camera closeup");
    expect(svg).toContain("Scene 1 · Preview");
    expect(svg).not.toContain("__scene_index_");
    key.disappear();
  });

  it("previews the actual next destination while preserving a custom caption", async () => {
    const client = new DirectObsClient();
    vi.spyOn(client, "isConnected").mockReturnValue(true);
    vi.spyOn(client, "getStatus").mockReturnValue({ kind: "connected", sentence: "Connected", cellReason: "" });
    vi.spyOn(client, "resolveSceneTarget").mockReturnValue("Ending slate");
    vi.spyOn(client, "getCatalog").mockReturnValue({ ...client.getCatalog(), studioMode: true });
    const images: string[] = [];
    const key = new ObsSceneTransitionKeyInstanceController(client, {
      setImage: async (image) => { images.push(image); }, showAlert: async () => {}
    }, { sceneTarget: "__next_scene__", labelOverride: "Next scene", operation: "preview" }, 1);
    key.appear();
    await vi.waitFor(() => expect(images).toHaveLength(1));
    expect(decodeURIComponent(images[0])).toContain("Ending slate");
    expect(decodeURIComponent(images[0])).toContain("Next · Preview");
    key.updateSettings({ sceneTarget: "__next_scene__", labelOverride: "My next cue", operation: "preview" });
    await vi.waitFor(() => expect(images).toHaveLength(2));
    expect(decodeURIComponent(images[1])).toContain("My next cue");
    key.disappear();
  });

  it("requires the explicit Studio setup action before changing OBS mode and opening its layout", async () => {
    const client = new DirectObsClient();
    const prepare = vi.spyOn(client, "prepareStudioLayout").mockResolvedValue({ ...client.getCatalog(), studioMode: true });
    const activate = vi.fn(async () => {});
    const payloads: Record<string, unknown>[] = [];
    const bridge = new DirectObsPropertyInspectorBridge(client, {
      sendToPropertyInspector: (payload) => payloads.push(payload),
      persistGlobalSettings: async () => {},
      getDeviceType: () => 7,
      activateLayout: activate
    });
    await bridge.handleMessage({ event: "directActivateLayout", slug: "plus-scene-desk" });
    expect(prepare).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(payloads.at(-1)).toMatchObject({ event: "directSetupResult", ok: false });
    await bridge.handleMessage({ event: "directActivateLayout", slug: "plus-scene-desk", prepareStudio: true });
    expect(prepare).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith("plus-scene-desk");
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(activate.mock.invocationCallOrder[0]);
  });

  it("keeps regular and either-mode layouts from changing OBS Studio Mode, and reports setup errors", async () => {
    const client = new DirectObsClient();
    const prepare = vi.spyOn(client, "prepareStudioLayout").mockRejectedValue(new Error("OBS is disconnected."));
    const activate = vi.fn(async () => {});
    const payloads: Record<string, unknown>[] = [];
    const bridge = new DirectObsPropertyInspectorBridge(client, {
      sendToPropertyInspector: (payload) => payloads.push(payload),
      persistGlobalSettings: async () => {}, getDeviceType: () => 7, activateLayout: activate
    });
    await bridge.handleMessage({ event: "directActivateLayout", slug: "plus-source-desk", prepareStudio: true });
    await bridge.handleMessage({ event: "directActivateLayout", slug: "plus-scene-regular", prepareStudio: true });
    expect(prepare).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledTimes(2);
    await bridge.handleMessage({ event: "directPrepareStudio" });
    expect(payloads.at(-1)).toEqual({ event: "directSetupResult", ok: false, error: "OBS is disconnected." });
  });
});
