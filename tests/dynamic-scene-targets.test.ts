// SPDX-License-Identifier: GPL-2.0-or-later
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIRECT_SCENE_NEXT, DIRECT_SCENE_PREVIOUS, DIRECT_SCENE_RANDOM,
  DirectObsClient, sceneNamesInDisplayOrder, sceneTargetIndex
} from "../src/obs/direct-obs-client.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

describe("dynamic scene target helpers", () => {
  it("uses OBS scene indices to match the Scenes dock without mutating its response", () => {
    const items = [
      { sceneName: "Bottom", sceneIndex: 0 },
      { sceneName: "Top", sceneIndex: 2 },
      { sceneName: "Middle", sceneIndex: 1 }
    ];
    expect(sceneNamesInDisplayOrder(items)).toEqual(["Top", "Middle", "Bottom"]);
    expect(items.map((item) => item.sceneName)).toEqual(["Bottom", "Top", "Middle"]);
    expect(sceneNamesInDisplayOrder([{ sceneName: "First" }, { sceneName: "Second" }]))
      .toEqual(["First", "Second"]);
    expect(sceneNamesInDisplayOrder(undefined)).toEqual([]);
  });

  it("recognizes only complete zero-based automatic scene targets", () => {
    expect(sceneTargetIndex("__scene_index_0__")).toBe(0);
    expect(sceneTargetIndex("__scene_index_3__")).toBe(3);
    for (const target of ["Scene 1", "__scene_index_-1__", "__scene_index_1.5__", "__scene_index_0__x", ""]) {
      expect(sceneTargetIndex(target)).toBeUndefined();
    }
  });
});

describe("dynamic scene targets over OBS WebSocket", () => {
  let server: FakeObsServer | undefined;
  let client: DirectObsClient | undefined;

  async function connect(studioMode = true, configure?: (obs: FakeObsServer) => void): Promise<DirectObsClient> {
    server = new FakeObsServer({ missingPlugin: true, studioMode });
    configure?.(server);
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const ready = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await ready;
    return client;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    client?.stop();
    await server?.stop();
  });

  it("random Preview excludes Live and the previous Preview when three scenes exist", async () => {
    const direct = await connect();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    for (let press = 0; press < 8; press++) {
      const live = server!.programSceneName;
      const previousPreview = server!.previewSceneName;
      const selected = await direct.runSceneAction(DIRECT_SCENE_RANDOM, "preview");
      expect(selected).not.toBe(live);
      expect(selected).not.toBe(previousPreview);
      expect(server!.previewSceneName).toBe(selected);
      expect(server!.programSceneName).toBe(live);
    }
    expect(server!.directCallLog.every((call) => call.requestType === "SetCurrentPreviewScene")).toBe(true);
  });

  it("random scene transitions exclude the current Live scene", async () => {
    const direct = await connect(false);
    const random = vi.spyOn(Math, "random");
    for (let press = 0; press < 8; press++) {
      random.mockReturnValue(press % 2 ? 0 : 0.99);
      const oldLive = server!.programSceneName;
      const selected = await direct.runSceneAction(DIRECT_SCENE_RANDOM, "transition");
      expect(selected).not.toBe(oldLive);
      expect(server!.programSceneName).toBe(selected);
    }
  });

  it.each([
    { studio: false, operation: "transition" as const,
      next: ["Scene Preview", "Scene 3", "Scene Live", "Scene Preview"],
      previous: ["Scene Live", "Scene 3", "Scene Preview"] },
    { studio: true, operation: "preview" as const,
      next: ["Scene 3", "Scene Live", "Scene Preview", "Scene 3"],
      previous: ["Scene Preview", "Scene Live", "Scene 3"] }
  ])("queues repeated $operation Next/Previous presses and wraps at both ends", async ({ studio, operation, next, previous }) => {
    const direct = await connect(studio);
    expect(await Promise.all(next.map(() => direct.runSceneAction(DIRECT_SCENE_NEXT, operation))))
      .toEqual(next);
    expect(await Promise.all(previous.map(() => direct.runSceneAction(DIRECT_SCENE_PREVIOUS, operation))))
      .toEqual(previous);
  });

  it("resolves scene positions afresh after an OBS reorder without a catalog event", async () => {
    const direct = await connect();
    expect(await direct.runSceneAction("__scene_index_0__", "preview")).toBe("Scene Live");
    server!.sceneNames = ["Scene 3", "Scene Live", "Scene Preview"];
    expect(await direct.runSceneAction("__scene_index_0__", "preview")).toBe("Scene 3");
    expect(direct.getCatalog().scenes).toEqual(server!.sceneNames);
  });

  it("reports unavailable scene positions without writing or substituting another scene", async () => {
    const direct = await connect();
    const before = [server!.programSceneName, server!.previewSceneName];
    await expect(direct.runSceneAction("__scene_index_3__", "preview"))
      .rejects.toThrow("Scene 4 is unavailable; OBS has 3 scenes");
    expect(server!.directCallLog).toEqual([]);
    expect([server!.programSceneName, server!.previewSceneName]).toEqual(before);
  });

  it("keeps a user's named choice pinned through reordering and never substitutes for a removed choice", async () => {
    const direct = await connect(false);
    server!.sceneNames = ["Scene 3", "Scene Live", "Scene Preview"];
    expect(await direct.runSceneAction("Scene Preview", "transition")).toBe("Scene Preview");
    const writes = server!.directCallLog.length;
    server!.sceneNames = ["Scene 3", "Scene Live"];
    await expect(direct.runSceneAction("Scene Preview", "transition")).rejects.toThrow("Choose an existing OBS scene");
    expect(server!.directCallLog).toHaveLength(writes);
    // Another key can continue following positions, independently of the pin.
    expect(await direct.runSceneAction("__scene_index_0__", "transition")).toBe("Scene 3");
  });

  it("prepares Studio Mode with a distinct Preview and never takes a scene Live", async () => {
    const direct = await connect(false, (obs) => { obs.previewSceneName = obs.programSceneName; });
    const live = server!.programSceneName;
    const catalog = await direct.prepareStudioLayout();
    expect(catalog.studioMode).toBe(true);
    expect(catalog.currentPreviewScene).toBe("Scene Preview");
    expect(server!.previewSceneName).not.toBe(live);
    expect(server!.programSceneName).toBe(live);
    expect(server!.directCallLog).toEqual([
      { requestType: "SetStudioModeEnabled", requestData: { studioModeEnabled: true } },
      { requestType: "SetCurrentPreviewScene", requestData: { sceneName: "Scene Preview" } }
    ]);
  });

  it("preserves an already distinct Preview while preparing Studio Mode", async () => {
    const direct = await connect(false);
    const before = [server!.programSceneName, server!.previewSceneName];
    await direct.prepareStudioLayout();
    expect(server!.studioMode).toBe(true);
    expect([server!.programSceneName, server!.previewSceneName]).toEqual(before);
    expect(server!.directCallLog).toEqual([
      { requestType: "SetStudioModeEnabled", requestData: { studioModeEnabled: true } }
    ]);
  });

  it("enables Studio Mode for one scene without creating or switching scenes", async () => {
    const direct = await connect(false, (obs) => {
      obs.sceneNames = [obs.programSceneName];
      obs.previewSceneName = obs.programSceneName;
    });
    const catalog = await direct.prepareStudioLayout();
    expect(catalog.studioMode).toBe(true);
    expect(catalog.scenes).toEqual(["Scene Live"]);
    expect(catalog.currentProgramScene).toBe("Scene Live");
    expect(catalog.currentPreviewScene).toBe("Scene Live");
    expect(server!.directCallLog).toEqual([
      { requestType: "SetStudioModeEnabled", requestData: { studioModeEnabled: true } }
    ]);
  });
});
