// SPDX-License-Identifier: GPL-2.0-or-later
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

describe("Optional scene mixer queue-next cycle", () => {
  let server: FakeObsServer;
  let client: DirectObsClient;

  async function connect(): Promise<void> {
    server = new FakeObsServer({ missingPlugin: true });
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const ready = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await ready;
  }

  function previewWrites(): Array<Record<string, unknown> | undefined> {
    return server.directCallLog.filter((call) => call.requestType === "SetCurrentPreviewScene")
      .map((call) => call.requestData);
  }

  function completeTransition(transitionName = "Fade"): void {
    const oldProgram = server.programSceneName;
    server.programSceneName = server.previewSceneName;
    server.previewSceneName = oldProgram;
    server.emitObsEvent("CurrentProgramSceneChanged", { sceneName: server.programSceneName });
    server.emitObsEvent("CurrentPreviewSceneChanged", { sceneName: server.previewSceneName });
    server.emitObsEvent("SceneTransitionEnded", { transitionName });
  }

  // Allows a no-op/cancellation event to cross the real WebSocket before
  // asserting that it issued no Preview mutation.
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 35));
  }

  afterEach(async () => {
    client?.stop();
    await server?.stop();
  });

  it("waits for OBS completion, then queues the scene following the newly-live scene", async () => {
    await connect();
    await client.nudgeTbar(0.4, true);
    expect(previewWrites()).toEqual([]);
    await client.setTbarPosition(1, true, true);
    expect(previewWrites()).toEqual([]);
    completeTransition();
    await vi.waitFor(() => expect(server.previewSceneName).toBe("Scene 3"));
    expect(server.programSceneName).toBe("Scene Preview");
    expect(previewWrites()).toEqual([{ sceneName: "Scene 3" }]);
    expect(server.vendorCallLog).toEqual([]);
  });

  it("wraps the last scene back to the first without starting another fade", async () => {
    await connect();
    server.programSceneName = "Scene Preview";
    server.previewSceneName = "Scene 3";
    await client.refreshCatalog();
    await client.setTbarPosition(1, true, true);
    completeTransition();
    await vi.waitFor(() => expect(server.previewSceneName).toBe("Scene Live"));
    expect(server.programSceneName).toBe("Scene 3");
    expect(server.directCallLog.filter((call) => call.requestType === "SetCurrentProgramScene")).toEqual([]);
    expect(server.directCallLog.filter((call) => call.requestType === "SetTBarPosition")).toHaveLength(1);
  });

  it("releases the native T-bar automatically when continuous rotation reaches the end", async () => {
    await connect();
    await client.nudgeTbar(0.6, true);
    await client.nudgeTbar(0.6, true);
    expect(server.directCallLog.filter((call) => call.requestType === "SetTBarPosition").at(-1))
      .toMatchObject({ requestData: { position: 1, release: true } });
    completeTransition();
    await vi.waitFor(() => expect(server.previewSceneName).toBe("Scene 3"));
    expect(client.getCatalog().tbarPosition).toBe(0);
  });

  it("follows the manual transition OBS actually starts when Cut falls back to Fade", async () => {
    await connect();
    server.currentTransitionName = "Cut";
    await client.refreshCatalog();
    await client.nudgeTbar(0.4, true);
    server.emitObsEvent("SceneTransitionStarted", { transitionName: "Fade" });
    await settle();
    await client.nudgeTbar(0.7, true);
    completeTransition("Fade");
    await vi.waitFor(() => expect(server.previewSceneName).toBe("Scene 3"));
    expect(server.programSceneName).toBe("Scene Preview");
    expect(previewWrites()).toEqual([{ sceneName: "Scene 3" }]);
  });

  it("keeps rotating through consecutive throws and wraps the whole scene list", async () => {
    await connect();
    await client.nudgeTbar(1.1, true);
    server.emitObsEvent("SceneTransitionStarted", { transitionName: "Fade" });
    completeTransition();
    await vi.waitFor(() => expect(server.previewSceneName).toBe("Scene 3"));
    expect(client.getCatalog().tbarPosition).toBe(0);

    await client.nudgeTbar(1.1, true);
    server.emitObsEvent("SceneTransitionStarted", { transitionName: "Fade" });
    completeTransition();
    await vi.waitFor(() => expect(server.previewSceneName).toBe("Scene Live"));
    expect(server.programSceneName).toBe("Scene 3");
    expect(previewWrites()).toEqual([{ sceneName: "Scene 3" }, { sceneName: "Scene Live" }]);
    expect(server.directCallLog.filter((call) => call.requestType === "SetTBarPosition"))
      .toEqual([
        { requestType: "SetTBarPosition", requestData: { position: 1, release: true } },
        { requestType: "SetTBarPosition", requestData: { position: 1, release: true } }
      ]);
  });

  it("uses the current scene order when scenes are rearranged during a throw", async () => {
    await connect();
    server.sceneNames = ["Scene Live", "Scene Preview", "Scene 3", "Scene 4"];
    await client.refreshCatalog();
    await client.setTbarPosition(0.5, false, true);
    // OBS does not reliably emit SceneListChanged on scene reordering.
    // The cached catalog would choose Scene 3; the fresh order chooses Scene 4.
    server.sceneNames = ["Scene Live", "Scene Preview", "Scene 4", "Scene 3"];
    await client.setTbarPosition(1, true, true);
    completeTransition();
    await vi.waitFor(() => expect(previewWrites()).toEqual([{ sceneName: "Scene 4" }]));
    expect(server.programSceneName).toBe("Scene Preview");
  });

  it("leaves normal mixer behavior alone when queue-next is off", async () => {
    await connect();
    await client.setTbarPosition(1, true);
    completeTransition();
    await settle();
    expect(previewWrites()).toEqual([]);
    expect(server.previewSceneName).toBe("Scene Live");
  });

  it("does not advance after a canceled throw or after the option is disabled", async () => {
    await connect();
    await client.setTbarPosition(0.4, false, true);
    await client.setTbarPosition(0, false, true);
    server.emitObsEvent("SceneTransitionEnded", { transitionName: "Fade" });
    await settle();
    expect(previewWrites()).toEqual([]);

    await client.setTbarPosition(0.4, false, true);
    await client.setTbarPosition(0.7, false, false);
    completeTransition();
    await settle();
    expect(previewWrites()).toEqual([]);
  });

  it("ignores the wrong transition and consumes the matching completion only once", async () => {
    await connect();
    await client.setTbarPosition(1, true, true);
    server.emitObsEvent("SceneTransitionEnded", { transitionName: "Fade to Black" });
    await settle();
    expect(previewWrites()).toEqual([]);
    completeTransition();
    await vi.waitFor(() => expect(previewWrites()).toEqual([{ sceneName: "Scene 3" }]));
    server.emitObsEvent("SceneTransitionEnded", { transitionName: "Fade" });
    server.emitObsEvent("SceneTransitionEnded", { transitionName: "Fade" });
    await settle();
    expect(previewWrites()).toHaveLength(1);
  });

  it("does not overwrite an operator's unrelated Preview selection", async () => {
    await connect();
    await client.setTbarPosition(0.4, false, true);
    server.previewSceneName = "Scene 3";
    server.emitObsEvent("CurrentPreviewSceneChanged", { sceneName: "Scene 3" });
    await settle();
    completeTransition();
    await settle();
    expect(previewWrites()).toEqual([]);
  });

  it.each(["StudioModeStateChanged", "CurrentSceneCollectionChanging"])(
    "cancels an armed cycle when %s arrives",
    async (eventType) => {
      await connect();
      await client.setTbarPosition(0.4, false, true);
      server.emitObsEvent(eventType, eventType === "StudioModeStateChanged" ? { studioModeEnabled: false } : {});
      await settle();
      completeTransition();
      await settle();
      expect(previewWrites()).toEqual([]);
    }
  );

  it("clears a stopped connection's pending cycle before a later session", async () => {
    await connect();
    await client.setTbarPosition(0.4, false, true);
    client.stop();
    client.start();
    await vi.waitFor(() => expect(server.connectionCount).toBe(2));
    await vi.waitFor(() => expect(client.isConnected()).toBe(true));
    completeTransition();
    await settle();
    expect(previewWrites()).toEqual([]);
  });
});
