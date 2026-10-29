// SPDX-License-Identifier: GPL-2.0-or-later
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  LayerController,
  LayerSettings
} from "../src/control/layer-controller.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";

interface NativeItem {
  sceneItemId: number;
  sceneItemIndex: number;
  sourceName: string;
  sourceUuid?: string;
  sceneItemEnabled: boolean;
  sceneItemBlendMode: string | number;
}

/** A native-OBS-shaped fixture with distinct scene IDs and actual mutable
 * order. It deliberately awaits every request so lost updates can surface. */
class LayerObsFixture extends EventEmitter {
  connected = true;
  studioMode = true;
  currentProgramScene = "Live";
  currentPreviewScene = "Preview";
  readonly scenes = new Map<string, NativeItem[]>([
    ["Live", makeItems(100)],
    ["Preview", makeItems(200)],
    ["Fixed", makeItems(300)]
  ]);
  readonly writes: Array<{ requestType: string; data: Record<string, unknown> }> = [];
  readonly reads: string[] = [];
  nextReadBarrier?: { started: () => void; wait: Promise<void> };
  nextReadError?: string;

  isConnected(): boolean { return this.connected; }

  getCatalog(): Record<string, unknown> {
    return {
      studioMode: this.studioMode,
      currentProgramScene: this.currentProgramScene,
      currentPreviewScene: this.currentPreviewScene
    };
  }

  async sendObsRequest(
    requestType: string,
    data: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    await Promise.resolve();
    const sceneName = String(data.sceneName ?? "");
    const scene = this.scenes.get(sceneName);
    if (!scene) throw new Error("The scene no longer exists.");
    if (requestType === "GetSceneItemList") {
      if (this.nextReadError) {
        const error = this.nextReadError;
        this.nextReadError = undefined;
        throw new Error(error);
      }
      this.reads.push(sceneName);
      const sceneItems = scene.map((item) => ({ ...item }));
      const barrier = this.nextReadBarrier;
      this.nextReadBarrier = undefined;
      if (barrier) { barrier.started(); await barrier.wait; }
      return { sceneItems };
    }

    const item = scene.find((candidate) => candidate.sceneItemId === data.sceneItemId);
    if (!item) throw new Error("The source no longer exists.");
    this.writes.push({ requestType, data: { ...data } });
    if (requestType === "SetSceneItemEnabled") {
      item.sceneItemEnabled = data.sceneItemEnabled === true;
    } else if (requestType === "SetSceneItemBlendMode") {
      item.sceneItemBlendMode = String(data.sceneItemBlendMode);
    } else if (requestType === "SetSceneItemIndex") {
      const ordered = [...scene].sort((a, b) => a.sceneItemIndex - b.sceneItemIndex);
      ordered.splice(ordered.indexOf(item), 1);
      ordered.splice(Number(data.sceneItemIndex), 0, item);
      ordered.forEach((entry, index) => { entry.sceneItemIndex = index; });
    } else {
      throw new Error(`Unexpected request '${requestType}'.`);
    }
    return {};
  }
}

function makeItems(base: number): NativeItem[] {
  return [
    { sceneItemId: base + 1, sceneItemIndex: 0, sourceName: "Background", sceneItemEnabled: true, sceneItemBlendMode: "OBS_BLEND_NORMAL" },
    { sceneItemId: base + 2, sceneItemIndex: 1, sourceName: "Camera", sceneItemEnabled: true, sceneItemBlendMode: "OBS_BLEND_NORMAL" },
    { sceneItemId: base + 3, sceneItemIndex: 2, sourceName: "Overlay", sceneItemEnabled: true, sceneItemBlendMode: "OBS_BLEND_NORMAL" }
  ];
}

function setup(): { obs: LayerObsFixture; controller: LayerController } {
  const obs = new LayerObsFixture();
  return { obs, controller: new LayerController(obs as unknown as DirectObsClient) };
}

describe("Direct OBS shared layer controls", () => {
  it("keeps an intentionally selected source through a transient OBS reconnect", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = { scope: "fixed", sceneName: "Live" };
    obs.scenes.get("Live")![1].sourceUuid = "original-camera";
    await controller.selectLayer("Live", 102);
    obs.connected = false;
    obs.emit("statusChanged");
    obs.connected = true;
    obs.emit("statusChanged");
    await controller.refresh(settings);
    expect(controller.getScene(settings).selectedId).toBe(102);
    await controller.perform(settings, "show_hide");
    expect(obs.writes.at(-1)?.data.sceneItemId).toBe(102);

    // Reconnection must not silently accept a different source with the same ID.
    obs.connected = false;
    obs.emit("statusChanged");
    obs.scenes.get("Live")![1].sourceUuid = "different-camera";
    obs.connected = true;
    obs.emit("statusChanged");
    await controller.refresh(settings);
    expect(controller.getScene(settings).selectedId).toBe(-1);
    await expect(controller.perform(settings, "show_hide")).rejects.toThrow("no longer in this scene");
    expect(obs.writes).toHaveLength(1);
  });

  it("blocks in-flight and newly requested source actions while OBS changes scene collection", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = { scope: "fixed", sceneName: "Live" };
    let start!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    obs.nextReadBarrier = { started: start, wait };
    const beforeChange = Promise.allSettled([
      controller.perform(settings, "show_hide"),
      controller.selectLayer("Live", 102)
    ]);
    await started;
    obs.emit("obsEvent", "CurrentSceneCollectionChanging", {});
    obs.scenes.set("Live", makeItems(400));
    await expect(controller.perform(settings, "blend_next")).rejects.toThrow("collection is changing");
    await expect(controller.selectLayer("Live", 402)).rejects.toThrow("collection is changing");
    release();
    expect((await beforeChange).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(obs.writes).toEqual([]);
    obs.emit("obsEvent", "CurrentSceneCollectionChanged", {});
    await controller.perform(settings, "show_hide");
    expect(obs.writes.at(-1)?.data.sceneItemId).toBe(403);
  });

  it("discards a source selection whose lookup began before a collection change", async () => {
    const { obs, controller } = setup();
    let start!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    obs.nextReadBarrier = { started: start, wait };
    const selecting = controller.selectLayer("Live", 102);
    const rejected = expect(selecting).rejects.toThrow("connection or scene collection changed");
    await started;
    obs.emit("obsEvent", "CurrentSceneCollectionChanging", {});
    release();
    await rejected;
    obs.scenes.set("Live", makeItems(400));
    obs.emit("obsEvent", "CurrentSceneCollectionChanged", {});
    await controller.refresh({ scope: "fixed", sceneName: "Live" });
    expect(controller.getScene({ scope: "fixed", sceneName: "Live" }).selectedId).toBe(403);
  });

  it("automatically picks a source when a previously empty scene becomes populated", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = { scope: "auto" };
    obs.scenes.set("Preview", []);
    await controller.refresh(settings);
    expect(controller.getScene(settings).selectedId).toBe(-1);
    obs.scenes.set("Preview", makeItems(500));
    await controller.refresh(settings);
    expect(controller.getScene(settings).selectedId).toBe(503);
    await controller.perform(settings, "show_hide");
    expect(obs.writes.at(-1)?.data.sceneItemId).toBe(503);
  });

  it("recovers an automatic source after a transient list error and a removed default", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = { scope: "auto" };
    obs.nextReadError = "OBS source list temporarily unavailable";
    await expect(controller.refresh(settings)).rejects.toThrow("temporarily unavailable");
    await controller.refresh(settings);
    expect(controller.getScene(settings).selectedId).toBe(203);
    obs.scenes.set("Preview", obs.scenes.get("Preview")!.filter((item) => item.sceneItemId !== 203));
    await controller.refresh(settings);
    expect(controller.getScene(settings).selectedId).toBe(202);
    await controller.perform(settings, "show_hide");
    expect(obs.writes.at(-1)?.data.sceneItemId).toBe(202);
  });

  it("keeps a manual selection through list errors and never substitutes for a removed manual source", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = { scope: "auto" };
    await controller.selectLayer("Preview", 202);
    obs.nextReadError = "Temporary read failure";
    await expect(controller.refresh(settings)).rejects.toThrow("Temporary read failure");
    await controller.refresh(settings);
    expect(controller.getScene(settings).selectedId).toBe(202);
    obs.scenes.set("Preview", []);
    await controller.refresh(settings);
    obs.scenes.set("Preview", makeItems(500));
    await controller.refresh(settings);
    expect(controller.getScene(settings).selectedId).toBe(-1);
    await expect(controller.perform(settings, "show_hide")).rejects.toThrow("no longer in this scene");
    expect(obs.writes).toEqual([]);
  });

  it("validates a fixed source UUID after collection changes while allowing a rename of the same source", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = {
      scope: "fixed", sceneName: "Live", target: "fixed", sceneItemId: 102,
      sourceUuid: "camera-original", sourceName: "Camera"
    };
    obs.scenes.get("Live")![1].sourceUuid = "camera-original";
    await controller.refresh(settings);
    obs.emit("obsEvent", "CurrentSceneCollectionChanged", {});
    // Another collection reuses both the scene name and scene-item ID.
    obs.scenes.get("Live")![1].sourceUuid = "camera-different";
    await expect(controller.perform(settings, "show_hide")).rejects.toThrow("no longer in this scene");
    expect(obs.writes).toEqual([]);
    obs.scenes.get("Live")![1].sourceUuid = "camera-original";
    obs.scenes.get("Live")![1].sourceName = "Renamed camera";
    await controller.perform(settings, "show_hide");
    expect(obs.writes.at(-1)?.data.sceneItemId).toBe(102);
    expect(settings.sourceName).toBe("Camera");
  });

  it("uses saved source names when UUIDs are unavailable and keeps old ID-only bindings compatible", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = {
      scope: "fixed", sceneName: "Live", target: "fixed", sceneItemId: 102, sourceName: "Original camera"
    };
    await expect(controller.perform(settings, "blend_next")).rejects.toThrow("no longer in this scene");
    expect(obs.writes).toEqual([]);
    await controller.perform({ ...settings, sourceName: "" }, "blend_next");
    expect(obs.writes.at(-1)?.data.sceneItemId).toBe(102);
  });

  it("browses a shared scene selection in visual source order without changing OBS", async () => {
    const { obs, controller } = setup();
    await controller.refresh({ scope: "auto" });
    expect(controller.getScene({ scope: "auto" }).selectedId).toBe(203);
    await controller.perform({ scope: "auto" }, "select_next");
    expect(controller.getScene({ scope: "fixed", sceneName: "Preview" }).selectedId).toBe(202);
    await controller.perform({ scope: "fixed", sceneName: "Preview" }, "select_next");
    expect(controller.getScene({ scope: "auto" }).selectedId).toBe(201);
    await controller.perform({ scope: "auto" }, "select_next");
    expect(controller.getScene({ scope: "auto" }).selectedId).toBe(203);
    await controller.perform({ scope: "auto" }, "select_previous");
    expect(controller.getScene({ scope: "auto" }).selectedId).toBe(201);
    expect(obs.writes).toEqual([]);
  });

  it("resolves automatic controls to Preview in Studio Mode and Live in regular mode", async () => {
    const { obs, controller } = setup();
    expect(controller.resolveScene({ scope: "auto" })).toBe("Preview");
    expect(controller.resolveScene({ scope: "program" })).toBe("Live");
    expect(controller.resolveScene({ scope: "fixed", sceneName: "Fixed" })).toBe("Fixed");
    await controller.perform({ scope: "auto" }, "show_hide");
    obs.studioMode = false;
    expect(controller.resolveScene({ scope: "auto" })).toBe("Live");
    await controller.perform({ scope: "auto" }, "show_hide");
    await controller.perform({ scope: "fixed", sceneName: "Fixed" }, "show_hide");
    expect(obs.writes.map((write) => [write.data.sceneName, write.data.sceneItemId])).toEqual([
      ["Preview", 203], ["Live", 103], ["Fixed", 303]
    ]);
  });

  it("show/hides the chosen scene item using its current OBS state", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = { scope: "fixed", sceneName: "Live" };
    await controller.perform(settings, "select_next");
    await controller.perform(settings, "show_hide");
    expect(obs.writes).toEqual([
      { requestType: "SetSceneItemEnabled", data: { sceneName: "Live", sceneItemId: 102, sceneItemEnabled: false } }
    ]);
    // An OBS-side change between presses must be read before the next toggle.
    obs.scenes.get("Live")![1].sceneItemEnabled = true;
    await controller.perform(settings, "show_hide");
    expect(obs.writes.at(-1)?.data.sceneItemEnabled).toBe(false);
  });

  it("guards reordering and maps visual Up/Down to native OBS indices with bounds", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = {
      scope: "fixed", sceneName: "Live", target: "fixed", sceneItemId: 102
    };
    await expect(controller.perform(settings, "move_up")).rejects.toThrow("Enable layer reordering");
    expect(obs.writes).toEqual([]);
    await controller.perform({ ...settings, allowReorder: true }, "move_up");
    expect(obs.writes.at(-1)).toEqual({
      requestType: "SetSceneItemIndex", data: { sceneName: "Live", sceneItemId: 102, sceneItemIndex: 2 }
    });
    await controller.perform({ ...settings, allowReorder: true }, "move_up", 50);
    expect(obs.writes).toHaveLength(1); // already at the top
    await controller.perform({ ...settings, allowReorder: true }, "move_down", 50);
    expect(obs.writes.at(-1)).toEqual({
      requestType: "SetSceneItemIndex", data: { sceneName: "Live", sceneItemId: 102, sceneItemIndex: 0 }
    });
    await controller.perform({ ...settings, allowReorder: true }, "move_down");
    expect(obs.writes).toHaveLength(2); // already at the bottom
  });

  it("cycles blend modes both ways, reads external changes, and resets to Normal", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = {
      scope: "fixed", sceneName: "Live", target: "fixed", sceneItemId: 102
    };
    await controller.perform(settings, "blend_previous");
    expect(obs.writes.at(-1)?.data.sceneItemBlendMode).toBe("OBS_BLEND_DARKEN");
    await controller.perform(settings, "blend_next");
    expect(obs.writes.at(-1)?.data.sceneItemBlendMode).toBe("OBS_BLEND_NORMAL");
    obs.scenes.get("Live")![1].sceneItemBlendMode = "OBS_BLEND_MULTIPLY";
    await controller.perform(settings, "blend_next");
    expect(obs.writes.at(-1)?.data.sceneItemBlendMode).toBe("OBS_BLEND_LIGHTEN");
    await controller.perform(settings, "blend_normal");
    expect(obs.writes.at(-1)).toEqual({
      requestType: "SetSceneItemBlendMode",
      data: { sceneName: "Live", sceneItemId: 102, sceneItemBlendMode: "OBS_BLEND_NORMAL" }
    });
  });

  it("advances the native numeric Multiply mode to Lighten", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = {
      scope: "fixed", sceneName: "Live", target: "fixed", sceneItemId: 102
    };
    obs.scenes.get("Live")![1].sceneItemBlendMode = 4;
    await controller.refresh(settings);
    expect(controller.getScene(settings).layers.find((layer) => layer.sceneItemId === 102)?.blendMode)
      .toBe("OBS_BLEND_MULTIPLY");
    await controller.perform(settings, "blend_next");
    expect(obs.writes.at(-1)).toEqual({
      requestType: "SetSceneItemBlendMode",
      data: { sceneName: "Live", sceneItemId: 102, sceneItemBlendMode: "OBS_BLEND_LIGHTEN" }
    });
  });

  it("wraps native numeric Normal backwards to Darken", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = {
      scope: "fixed", sceneName: "Live", target: "fixed", sceneItemId: 102
    };
    obs.scenes.get("Live")![1].sceneItemBlendMode = 0;
    await controller.perform(settings, "blend_previous");
    expect(obs.writes.at(-1)?.data.sceneItemBlendMode).toBe("OBS_BLEND_DARKEN");
  });

  it.each([-1, 7, 1.5, "OBS_BLEND_UNKNOWN"])(
    "treats unsupported blend mode %s as Normal", async (value) => {
      const { obs, controller } = setup();
      const settings: LayerSettings = {
        scope: "fixed", sceneName: "Live", target: "fixed", sceneItemId: 102
      };
      obs.scenes.get("Live")![1].sceneItemBlendMode = value;
      await controller.refresh(settings);
      expect(controller.getScene(settings).layers.find((layer) => layer.sceneItemId === 102)?.blendMode)
        .toBe("OBS_BLEND_NORMAL");
      await controller.perform(settings, "blend_next");
      expect(obs.writes.at(-1)?.data.sceneItemBlendMode).toBe("OBS_BLEND_ADDITIVE");
    }
  );

  it("refuses missing fixed targets, absent scenes, empty scenes, and disconnected edits", async () => {
    const { obs, controller } = setup();
    await expect(controller.perform({
      scope: "fixed", sceneName: "Live", target: "fixed", sceneItemId: 999
    }, "show_hide")).rejects.toThrow("no longer in this scene");
    await expect(controller.perform({ scope: "fixed", sceneName: "Gone" }, "blend_next"))
      .rejects.toThrow("scene no longer exists");
    obs.scenes.set("Empty", []);
    await expect(controller.perform({ scope: "fixed", sceneName: "Empty" }, "show_hide"))
      .rejects.toThrow("no sources");
    obs.connected = false;
    await expect(controller.perform({ scope: "program" }, "show_hide"))
      .rejects.toThrow("not connected");
    expect(obs.writes).toEqual([]);
  });

  it("does not silently edit another layer after the selected source is removed", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = { scope: "fixed", sceneName: "Live" };
    await controller.perform(settings, "select_next");
    expect(controller.getScene(settings).selectedId).toBe(102);
    obs.scenes.set("Live", obs.scenes.get("Live")!.filter((item) => item.sceneItemId !== 102));
    await expect(controller.perform(settings, "show_hide")).rejects.toThrow("no longer in this scene");
    await controller.perform(settings, "select_next");
    expect(controller.getScene(settings).selectedId).toBe(103);
    expect(obs.writes).toEqual([]);
  });

  it.each(["statusChanged", "CurrentSceneCollectionChanged"])(
    "discards a delayed old list after %s so it cannot drive a different collection",
    async (event) => {
      const { obs, controller } = setup();
      const settings: LayerSettings = { scope: "fixed", sceneName: "Live" };
      let start!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { start = resolve; });
      const wait = new Promise<void>((resolve) => { release = resolve; });
      obs.nextReadBarrier = { started: start, wait };
      const editing = controller.perform(settings, "show_hide");
      const rejected = expect(editing).rejects.toThrow("connection or scene collection changed");
      await started;
      obs.scenes.set("Live", makeItems(400));
      if (event === "statusChanged") obs.emit("statusChanged");
      else obs.emit("obsEvent", "CurrentSceneCollectionChanged", {});
      await controller.refresh(settings);
      release();
      await rejected;
      expect(controller.getScene(settings).selectedId).toBe(403);
      expect(obs.writes).toEqual([]);
      await controller.perform(settings, "show_hide");
      expect(obs.writes.at(-1)?.data.sceneItemId).toBe(403);
    }
  );

  it("serializes rapid gestures for a scene so toggles and blend increments accumulate", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = { scope: "fixed", sceneName: "Live" };
    await Promise.all([
      controller.perform(settings, "select_next"),
      controller.perform(settings, "select_next")
    ]);
    expect(controller.getScene(settings).selectedId).toBe(101);
    await Promise.all([
      controller.perform(settings, "show_hide"),
      controller.perform(settings, "show_hide")
    ]);
    expect(obs.scenes.get("Live")![0].sceneItemEnabled).toBe(true);
    await Promise.all([
      controller.perform(settings, "blend_next"),
      controller.perform(settings, "blend_next"),
      controller.perform(settings, "blend_next")
    ]);
    expect(obs.scenes.get("Live")![0].sceneItemBlendMode).toBe("OBS_BLEND_SCREEN");
  });

  it("rejects gestures queued before a collection change instead of editing a new same-named scene", async () => {
    const { obs, controller } = setup();
    const settings: LayerSettings = { scope: "fixed", sceneName: "Live" };
    let start!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    obs.nextReadBarrier = { started: start, wait };
    const results = Promise.allSettled([
      controller.perform(settings, "show_hide"),
      controller.perform(settings, "show_hide")
    ]);
    await started;
    obs.scenes.set("Live", makeItems(400));
    obs.emit("obsEvent", "CurrentSceneCollectionChanged", {});
    release();
    expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(obs.writes).toEqual([]);
  });

  it("keeps the action queue usable after an invalid target fails", async () => {
    const { obs, controller } = setup();
    await expect(controller.perform({
      scope: "fixed", sceneName: "Live", target: "fixed", sceneItemId: 999
    }, "show_hide")).rejects.toThrow();
    await controller.perform({ scope: "fixed", sceneName: "Live" }, "show_hide");
    expect(obs.writes).toHaveLength(1);
    expect(obs.writes[0].data.sceneItemId).toBe(103);
  });
});
