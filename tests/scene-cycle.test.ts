// SPDX-License-Identifier: GPL-2.0-or-later
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectObsClient, TBAR_SETTLE_MS } from "../src/obs/direct-obs-client.js";
import { FakeObsServer, FakeObsServerOptions } from "./helpers/fake-obs-server.js";

/** The fake models OBS 33.0.1: a T-bar released over obs-websocket cancels ("Manual transition
 * cancelled"), scene switches are refused while the manual transition is active, and leaving
 * Studio Mode sets Program to the throw's target in one step. The take (dial press, or the end
 * of a queue-next throw) is therefore: aim the manual transition at Next, leave and re-enter
 * Studio Mode, then set Preview (queue-next: the scene after Next; otherwise the previous Live). */
describe("Scene mixer take on OBS 33.0.1, and the optional queue-next cycle", () => {
  let server: FakeObsServer;
  let client: DirectObsClient;

  async function connect(opts: FakeObsServerOptions = {}, requestTimeoutMs?: number): Promise<void> {
    server = new FakeObsServer({ missingPlugin: true, ...opts });
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "", requestTimeoutMs });
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

  // Waits until the client has gone quiet: no directStateChanged for `quietMs` (at most `maxMs`). A take's own
  // trailing events (the fake announces the new Preview after answering) can land after takeTbar resolves, later
  // on a slow runner, and must not be counted as something a later event did.
  async function quiet(quietMs = 80, maxMs = 400): Promise<void> {
    let last = Date.now();
    const seen = (): void => { last = Date.now(); };
    client.on("directStateChanged", seen);
    const start = Date.now();
    try {
      while (Date.now() - last < quietMs && Date.now() - start < maxMs) await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      client.off("directStateChanged", seen);
    }
  }

  // The client handles messages in the order they arrive, so an event the fake sent before this request's
  // answer has been handled when it returns, however slow the machine.
  async function roundTrip(): Promise<void> {
    await client.sendObsRequest("GetStudioModeEnabled");
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

  it("takes nothing, and says so, when Live and Next are the same scene", async () => {
    await connect();
    server.previewSceneName = server.programSceneName;
    await client.refreshCatalog();
    await expect(client.takeTbar(true)).rejects.toThrow("Choose a different Next scene");
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
  it("re-enters Studio Mode once more when the first attempt fails, and the take completes", async () => {
    await connect({ studioEnableFailures: 1 });
    await client.nudgeTbar(0.4);
    await client.takeTbar();
    expect(server.studioMode).toBe(true);
    expect(server.programSceneName).toBe("Scene Preview");
    expect(calls("SetStudioModeEnabled")).toEqual([
      { studioModeEnabled: false }, { studioModeEnabled: true }, { studioModeEnabled: true }
    ]);
    expect(client.getCatalog().studioMode).toBe(true);
  });

  it("gives up after the retry with a message every cell can show, and reads Studio Mode as off", async () => {
    await connect({ studioEnableFailures: 2 });
    await client.nudgeTbar(0.4);
    const states: boolean[] = [];
    client.on("directStateChanged", () => states.push(client.getCatalog().studioMode));
    await expect(client.takeTbar()).rejects.toThrow("Studio Mode could not be enabled");
    expect(calls("SetStudioModeEnabled")).toEqual([
      { studioModeEnabled: false }, { studioModeEnabled: true }, { studioModeEnabled: true }
    ]);
    expect(server.studioMode).toBe(false);
    expect(client.getCatalog().studioMode).toBe(false);
    expect(client.getCatalog().tbarPosition).toBe(0);
    expect(states.at(-1)).toBe(false);
  });

  it("always re-enters Studio Mode even when the collection changes between the two requests", async () => {
    await connect({ studioDisableDelayMs: 60 });
    await client.nudgeTbar(0.4);
    const take = client.takeTbar();
    await new Promise((resolve) => setTimeout(resolve, 20));
    server.emitObsEvent("CurrentSceneCollectionChanging", {});
    await expect(take).rejects.toThrow(/changed/i);
    expect(server.studioMode).toBe(true);
    expect(calls("SetStudioModeEnabled")).toEqual([{ studioModeEnabled: false }, { studioModeEnabled: true }]);
  });

  it("always re-enters Studio Mode even when the leave request times out", async () => {
    await connect({ dropStudioDisableResponse: true }, 80);
    await client.nudgeTbar(0.4);
    await expect(client.takeTbar()).rejects.toThrow(/timed out|time/i);
    expect(calls("SetStudioModeEnabled")).toEqual([{ studioModeEnabled: false }, { studioModeEnabled: true }]);
    expect(server.studioMode).toBe(true);
    expect(server.programSceneName).toBe("Scene Preview");
    expect(client.getCatalog().studioMode).toBe(true);
  });

  it("is unharmed by its own Studio Mode events arriving after the answers: Preview stays known", async () => {
    await connect({ deferStudioModeEvents: true });
    await client.nudgeTbar(0.4);
    await client.takeTbar();
    await quiet(); // well inside the take's grace for its own Studio Mode events (TBAR_STUDIO_EVENT_GRACE_MS)
    expect(client.getCatalog().currentPreviewScene).toBe("Scene Live");
    const states: boolean[] = [];
    client.on("directStateChanged", () => states.push(client.getCatalog().studioMode));
    server.flushStudioModeEvents();
    await roundTrip();
    await settle();
    expect(states).toEqual([]);
    expect(client.getCatalog().studioMode).toBe(true);
    expect(client.getCatalog().currentPreviewScene).toBe("Scene Live");
    // A stray repeat of the known state later changes nothing either.
    server.emitObsEvent("StudioModeStateChanged", { studioModeEnabled: true });
    await roundTrip();
    await settle();
    expect(states).toEqual([]);
    expect(client.getCatalog().currentPreviewScene).toBe("Scene Live");
  });

  it("treats a press in the settle window as the end of the last take, like the trailing ticks", async () => {
    await connect();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await client.nudgeTbar(1.1, true);
      expect(calls("SetStudioModeEnabled")).toHaveLength(2);
      await client.takeTbar(true);
      expect(calls("SetStudioModeEnabled")).toHaveLength(2);
      expect(server.programSceneName).toBe("Scene Preview");
      vi.setSystemTime(Date.now() + TBAR_SETTLE_MS + 1);
      await client.takeTbar(true);
      expect(calls("SetStudioModeEnabled")).toHaveLength(4);
      expect(server.programSceneName).toBe("Scene 3");
    } finally {
      vi.useRealTimers();
    }
  });
});
