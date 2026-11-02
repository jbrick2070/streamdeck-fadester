// SPDX-License-Identifier: GPL-2.0-or-later
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectObsClient, TBAR_SETTLE_MS } from "../src/obs/direct-obs-client.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

/** The fake models OBS 33.0.1: a T-bar released over obs-websocket cancels ("Manual transition
 * cancelled"), scene switches are refused while the manual transition is active, and leaving
 * Studio Mode sets Program to the throw's target in one step. The take (dial press, or the end
 * of a queue-next throw) is therefore: aim the manual transition at Next, leave and re-enter
 * Studio Mode, then set Preview (queue-next: the scene after Next; otherwise the previous Live). */
describe("Scene mixer take on OBS 33.0.1, and the optional queue-next cycle", () => {
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

  function calls(requestType: string): Array<Record<string, unknown> | undefined> {
    return server.directCallLog.filter((call) => call.requestType === requestType).map((call) => call.requestData);
  }

  function previewWrites(): Array<Record<string, unknown> | undefined> {
    return calls("SetCurrentPreviewScene");
  }

  function takeWrites(): Array<Record<string, unknown> | undefined> {
    return server.directCallLog
      .filter((call) => ["SetTBarPosition", "SetStudioModeEnabled", "SetCurrentPreviewScene"].includes(call.requestType))
      .map((call) => ({ [call.requestType]: call.requestData }));
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

  it("the old release never takes: the fake cancels like OBS 33.0.1 and Program stays", async () => {
    await connect();
    await client.nudgeTbar(0.4);
    expect(server.manualTransitionActive).toBe(true);
    await client.sendObsRequest("SetTBarPosition", { position: 1, release: true });
    expect(server.programSceneName).toBe("Scene Live");
    expect(server.manualTransitionActive).toBe(false);
  });

  it("takes Next live at the end of a throw by leaving and re-entering Studio Mode, never by a release", async () => {
    await connect();
    await client.nudgeTbar(0.4);
    const studioEvents: boolean[] = [];
    client.on("directStateChanged", () => studioEvents.push(client.getCatalog().studioMode));
    await client.takeTbar();
    expect(server.programSceneName).toBe("Scene Preview");
    expect(server.studioMode).toBe(true);
    expect(server.manualTransitionActive).toBe(false);
    expect(takeWrites()).toEqual([
      { SetTBarPosition: { position: 0.4, release: false } },
      { SetTBarPosition: { position: 1, release: false } },
      { SetStudioModeEnabled: { studioModeEnabled: false } },
      { SetStudioModeEnabled: { studioModeEnabled: true } },
      { SetCurrentPreviewScene: { sceneName: "Scene Live" } }
    ]);
    expect(calls("SetTBarPosition").some((data) => data?.release === true)).toBe(false);
    // Studio Mode never reads as off on any cell while the take runs.
    expect(studioEvents.every(Boolean)).toBe(true);
    const catalog = client.getCatalog();
    expect(catalog.studioMode).toBe(true);
    expect(catalog.tbarPosition).toBe(0);
    expect(catalog.currentProgramScene).toBe("Scene Preview");
    // The swap OBS does after its own transitions: the previous Live becomes Preview.
    expect(catalog.currentPreviewScene).toBe("Scene Live");
    expect(server.previewSceneName).toBe("Scene Live");
  });

  it("takes from rest too (a press with no throw started) by starting the manual transition first", async () => {
    await connect();
    await client.takeTbar();
    expect(server.programSceneName).toBe("Scene Preview");
    expect(server.previewSceneName).toBe("Scene Live");
    expect(takeWrites()).toEqual([
      { SetTBarPosition: { position: 1, release: false } },
      { SetStudioModeEnabled: { studioModeEnabled: false } },
      { SetStudioModeEnabled: { studioModeEnabled: true } },
      { SetCurrentPreviewScene: { sceneName: "Scene Live" } }
    ]);
  });

  it("queue-next: the take queues the scene following the newly-live scene", async () => {
    await connect();
    await client.nudgeTbar(0.4, true);
    expect(previewWrites()).toEqual([]);
    await client.takeTbar(true);
    expect(server.programSceneName).toBe("Scene Preview");
    expect(server.previewSceneName).toBe("Scene 3");
    expect(previewWrites()).toEqual([{ sceneName: "Scene 3" }]);
    expect(server.vendorCallLog).toEqual([]);
  });

  it("wraps the last scene back to the first", async () => {
    await connect();
    server.programSceneName = "Scene Preview";
    server.previewSceneName = "Scene 3";
    await client.refreshCatalog();
    await client.takeTbar(true);
    expect(server.programSceneName).toBe("Scene 3");
    expect(server.previewSceneName).toBe("Scene Live");
    expect(calls("SetCurrentProgramScene")).toEqual([]);
  });

  it("takes automatically when continuous rotation reaches the end, then ignores the settling ticks", async () => {
    await connect();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await client.nudgeTbar(0.6, true);
      await client.nudgeTbar(0.6, true);
      expect(server.programSceneName).toBe("Scene Preview");
      expect(server.previewSceneName).toBe("Scene 3");
      expect(client.getCatalog().tbarPosition).toBe(0);
      const writesAfterTake = server.directCallLog.length;
      await client.nudgeTbar(0.3, true);
      expect(server.directCallLog).toHaveLength(writesAfterTake);
      expect(client.getCatalog().tbarPosition).toBe(0);
      vi.setSystemTime(Date.now() + TBAR_SETTLE_MS + 1);
      await client.nudgeTbar(0.3, true);
      expect(calls("SetTBarPosition").at(-1)).toEqual({ position: 0.3, release: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps rotating through consecutive throws and wraps the whole scene list", async () => {
    await connect();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await client.nudgeTbar(1.1, true);
      expect(server.previewSceneName).toBe("Scene 3");
      vi.setSystemTime(Date.now() + TBAR_SETTLE_MS + 1);
      await client.nudgeTbar(1.1, true);
      expect(server.previewSceneName).toBe("Scene Live");
      expect(server.programSceneName).toBe("Scene 3");
      expect(previewWrites()).toEqual([{ sceneName: "Scene 3" }, { sceneName: "Scene Live" }]);
      expect(calls("SetStudioModeEnabled")).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the current scene order when scenes are rearranged during a throw", async () => {
    await connect();
    server.sceneNames = ["Scene Live", "Scene Preview", "Scene 3", "Scene 4"];
    await client.refreshCatalog();
    await client.setTbarPosition(0.5, false, true);
    // OBS does not reliably emit SceneListChanged on scene reordering.
    // The cached catalog would choose Scene 3; the fresh order chooses Scene 4.
    server.sceneNames = ["Scene Live", "Scene Preview", "Scene 4", "Scene 3"];
    await client.takeTbar(true);
    expect(previewWrites()).toEqual([{ sceneName: "Scene 4" }]);
    expect(server.programSceneName).toBe("Scene Preview");
  });

  it("does nothing when Live and Next are the same scene", async () => {
    await connect();
    server.previewSceneName = server.programSceneName;
    await client.refreshCatalog();
    await client.takeTbar(true);
    expect(calls("SetStudioModeEnabled")).toEqual([]);
    expect(calls("SetTBarPosition")).toEqual([]);
  });

  it("refuses a take outside Studio Mode without a write", async () => {
    server = new FakeObsServer({ studioMode: false, missingPlugin: true });
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const ready = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await ready;
    await expect(client.takeTbar()).rejects.toThrow("Studio Mode");
    expect(server.directCallLog).toEqual([]);
  });

  it("takes after the operator finished OBS's T-bar themselves, and does nothing when Preview equals Program", async () => {
    await connect();
    await client.nudgeTbar(0.4);
    // The operator released OBS's own T-bar with the mouse meanwhile: no manual transition is
    // active, the position write starts a new one toward the current Preview, and the take lands.
    server.manualTransitionActive = false;
    await client.takeTbar();
    expect(server.programSceneName).toBe("Scene Preview");
    // Preview equal to Program at the moment of the take: nothing OBS could take.
    server.previewSceneName = server.programSceneName;
    server.emitObsEvent("CurrentPreviewSceneChanged", { sceneName: server.programSceneName });
    await settle();
    await client.nudgeTbar(0.4);
    const before = server.directCallLog.length;
    await client.takeTbar();
    expect(server.directCallLog).toHaveLength(before);
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
    await settle();
    expect(previewWrites()).toEqual([]);
  });

  it("queues the next scene when OBS itself finishes a throw Fadester started (the mouse on OBS's T-bar)", async () => {
    await connect();
    await client.nudgeTbar(0.4, true);
    // OBS's own release at the end of its T-bar: Program becomes Preview, the swap, and the end event.
    server.manualTransitionActive = false;
    const oldProgram = server.programSceneName;
    server.programSceneName = server.previewSceneName;
    server.previewSceneName = oldProgram;
    server.emitObsEvent("CurrentProgramSceneChanged", { sceneName: server.programSceneName });
    server.emitObsEvent("CurrentPreviewSceneChanged", { sceneName: server.previewSceneName });
    server.emitObsEvent("SceneTransitionEnded", { transitionName: "Fade to Black" });
    await settle();
    expect(previewWrites()).toEqual([]);
    server.emitObsEvent("SceneTransitionEnded", { transitionName: "Fade" });
    await vi.waitFor(() => expect(previewWrites()).toEqual([{ sceneName: "Scene 3" }]));
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
    server.emitObsEvent("SceneTransitionEnded", { transitionName: "Fade" });
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
      server.emitObsEvent("SceneTransitionEnded", { transitionName: "Fade" });
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
    server.emitObsEvent("SceneTransitionEnded", { transitionName: "Fade" });
    await settle();
    expect(previewWrites()).toEqual([]);
  });
});
