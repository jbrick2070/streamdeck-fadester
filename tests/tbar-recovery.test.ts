// SPDX-License-Identifier: GPL-2.0-or-later
// The T-bar dial never gets stuck: a Preview picked mid-fade, a fade OBS already has open (the plugin restarted, a
// hand left OBS's own T-bar part-way), a timed transition running, a late "transition ended". Each case must end with
// OBS's fade closed (its transition buttons usable) and Live and Next on different scenes, with no help from anyone.
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObsFaderDialInstanceController } from "../src/actions/obs-fader-dial.js";
import { DirectObsClient, TBAR_SETTLE_MS } from "../src/obs/direct-obs-client.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

describe("the T-bar dial recovers by itself", () => {
  let server: FakeObsServer;
  const clients: DirectObsClient[] = [];

  async function start(): Promise<number> {
    server = new FakeObsServer({ missingPlugin: true });
    return server.start();
  }

  async function connect(port: number): Promise<DirectObsClient> {
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    clients.push(client);
    const ready = once(client, "statusChanged", { signal: AbortSignal.timeout(3000) });
    client.start();
    await ready;
    await vi.waitFor(() => expect(client.getCatalog().currentPreviewScene).not.toBe(""), { timeout: 3000 });
    return client;
  }

  /** The operator clicks a scene in OBS's Scenes list (Studio Mode): Preview changes and OBS says so. */
  function pickPreview(sceneName: string): void {
    server.previewSceneName = sceneName;
    server.emitObsEvent("CurrentPreviewSceneChanged", { sceneName });
  }

  const unlocked = (): void => {
    expect(server.manualTransitionActive).toBe(false); // no fade left open: OBS's transition buttons work
    expect(server.programSceneName).not.toBe(server.previewSceneName);
  };

  afterEach(async () => {
    for (const client of clients.splice(0)) client.stop();
    await server?.stop();
  });

  it("finishes the fade on screen when Preview changes mid-fade, and keeps the new pick for the next fade", async () => {
    const client = await connect(await start());
    expect(server.programSceneName).toBe("Scene Live");
    await client.nudgeTbar(0.2); // Scene Live into Scene Preview
    pickPreview("Scene 3");
    await vi.waitFor(() => expect(client.getCatalog().currentPreviewScene).toBe("Scene 3"), { timeout: 3000 });
    expect(client.getTbarScenes()).toEqual({ live: "Scene Live", next: "Scene Preview" }); // the dial says what fades
    await client.nudgeTbar(0.3);
    await client.nudgeTbar(0.5); // the end: the take
    expect(server.programSceneName).toBe("Scene Preview");
    expect(server.previewSceneName).toBe("Scene 3");
    expect(client.getCatalog().tbarPosition).toBe(0);
    unlocked();
  });

  it("carries on a fade OBS already has open after the plugin restarted mid-fade", async () => {
    const port = await start();
    const before = await connect(port);
    await before.nudgeTbar(0.4);
    before.stop(); // the plugin restarts with OBS's fade still open at 40 %
    expect(server.manualTransitionActive).toBe(true);
    const after = await connect(port);
    await vi.waitFor(() => expect(after.getCatalog().tbarPosition).toBeCloseTo(0.4, 2), { timeout: 3000 });
    expect(after.getTbarScenes().next).toBe("Scene Preview");
    await after.nudgeTbar(0.6);
    expect(server.programSceneName).toBe("Scene Preview");
    unlocked();
  });

  it("closes a fade a hand left part-way on OBS's own T-bar, even when it is turned back to cancel", async () => {
    const client = await connect(await start());
    server.moveNativeSlider(400); // a mouse let go of OBS's T-bar part-way: a release cannot cancel it now
    await client.nudgeTbar(-0.1); // picked up from where it is
    expect(client.getCatalog().tbarPosition).toBeGreaterThan(0.2);
    await client.nudgeTbar(-1); // back to the start: the cancel cannot land, so the fade is finished instead
    unlocked();
    expect(client.getCatalog().tbarPosition).toBe(0);
  });

  it("lets the dial itself take up an open fade even when OBS already names its target as both Program and Preview", async () => {
    const client = await connect(await start());
    server.moveNativeSlider(400); // a hand left OBS's T-bar part-way
    await client.refreshCatalog(); // OBS 33 now reports the fade's target as Program, which is also Preview
    expect(client.getCatalog().currentProgramScene).toBe(client.getCatalog().currentPreviewScene);
    const sink = { setFeedback: vi.fn(async () => {}), showAlert: vi.fn(async () => {}) };
    const dial = new ObsFaderDialInstanceController(client, sink, { target: "tbar" }, 1);
    await dial.handleRotate(5);
    expect(sink.showAlert).not.toHaveBeenCalled();
    expect(client.getCatalog().tbarPosition).toBeGreaterThan(0.39);
    await dial.handleDialUp(); // the press takes it
    unlocked();
  });

  it("takes the fade on screen with a press after Preview changed mid-fade, keeping the new pick", async () => {
    const client = await connect(await start());
    await client.nudgeTbar(0.3);
    pickPreview("Scene 3");
    await vi.waitFor(() => expect(client.getCatalog().currentPreviewScene).toBe("Scene 3"), { timeout: 3000 });
    await client.takeTbar();
    expect(server.programSceneName).toBe("Scene Preview");
    expect(server.previewSceneName).toBe("Scene 3");
    unlocked();
  });

  it("takes an open fade it did not start with a press", async () => {
    const client = await connect(await start());
    server.moveNativeSlider(300);
    await client.takeTbar();
    expect(server.programSceneName).toBe("Scene Preview");
    unlocked();
  });

  it("waits out a timed transition instead of taking it over", async () => {
    const client = await connect(await start());
    await new Promise((resolve) => setTimeout(resolve, 60)); // the look for an open fade made on connecting is done
    server.emitObsEvent("SceneTransitionStarted", { transitionName: "Fade" }); // OBS's Transition button
    await vi.waitFor(() => expect((client as unknown as { transitionStartedAt: number }).transitionStartedAt).toBeGreaterThan(0));
    server.cursorScript = [0.3, 0.5, 0.6, 0.7]; // the cursor moves on its own, also on the second look
    await client.nudgeTbar(0.2);
    expect(server.directCallLog.filter((call) => call.requestType === "SetTBarPosition")).toEqual([]);
    await client.nudgeTbar(0.2); // it has ended: the dial throws as usual
    expect(server.directCallLog.filter((call) => call.requestType === "SetTBarPosition").at(-1)?.requestData)
      .toEqual({ position: 0.2, release: false });
  });

  it("turns back an open fade it did not start and cancels it at the start", async () => {
    const port = await start();
    const before = await connect(port);
    await before.nudgeTbar(0.4);
    before.stop();
    const after = await connect(port);
    await vi.waitFor(() => expect(after.getCatalog().tbarPosition).toBeGreaterThan(0), { timeout: 3000 });
    await after.nudgeTbar(-0.5);
    expect(server.manualTransitionActive).toBe(false);
    expect(server.programSceneName).toBe("Scene Live"); // cancelled: Live stays live
  });

  it("does not let a late 'transition ended' move Scene loop on while a fade is still open", async () => {
    const client = await connect(await start());
    await client.nudgeTbar(0.3, true);
    server.emitObsEvent("SceneTransitionEnded", { transitionName: server.currentTransitionName });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(server.previewSceneName).toBe("Scene Preview");
    expect(client.getCatalog().tbarPosition).toBeCloseTo(0.3);
  });

  it("refuses a throw while Live and Next are the same scene, and moves again once Preview differs", async () => {
    const client = await connect(await start());
    pickPreview("Scene Live");
    await vi.waitFor(() => expect(client.getCatalog().currentPreviewScene).toBe("Scene Live"), { timeout: 3000 });
    await expect(client.nudgeTbar(0.2)).rejects.toThrow("Choose a different Next scene");
    pickPreview("Scene 3");
    await vi.waitFor(() => expect(client.getCatalog().currentPreviewScene).toBe("Scene 3"), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, TBAR_SETTLE_MS));
    await client.nudgeTbar(0.2);
    expect(server.manualTransitionActive).toBe(true);
  });

  describe("after a restart, a turn is never ignored quietly", () => {
    it("moves when OBS's transition cursor drifts with no transition running", async () => {
      const client = await connect(await start());
      await new Promise((resolve) => setTimeout(resolve, 60)); // the look for an open fade made on connecting is done
      const notes: string[] = [];
      client.on("tbarTurnIgnored", (reason: string) => notes.push(reason));
      server.cursorScript = [0.31, 0.32, 0.33, 0.34]; // drifting, and OBS never said a transition started
      await client.nudgeTbar(0.2);
      expect(server.manualTransitionActive).toBe(true);
      expect(client.getCatalog().tbarPosition).toBeCloseTo(0.2);
      expect(notes.some((note) => note.includes("cursor"))).toBe(true);
    });

    it("adopts an open manual fade across a restart even while OBS 33's manual cursor is still easing", async () => {
      const port = await start();
      const before = await connect(port);
      await before.nudgeTbar(0.45);
      before.stop();

      // OBS 33 reports Program === Preview === target while its manual cursor eases toward 0.45
      server.cursorScript = [0.22, 0.34];
      const after = await connect(port);
      await vi.waitFor(() => expect(after.getCatalog().tbarPosition).toBeCloseTo(0.34, 2), { timeout: 3000 });
      await after.nudgeTbar(0.7);
      expect(server.programSceneName).toBe("Scene Preview");
      unlocked();
    });

    it("re-reads Program and Preview before refusing a throw on a stale Live equals Next", async () => {
      const client = await connect(await start());
      pickPreview("Scene Live");
      await vi.waitFor(() => expect(client.getCatalog().currentPreviewScene).toBe("Scene Live"), { timeout: 3000 });
      server.previewSceneName = "Scene 3"; // OBS moved on; the event was lost
      await client.nudgeTbar(0.2);
      expect(server.manualTransitionActive).toBe(true);
      expect(client.getTbarScenes()).toEqual({ live: "Scene Live", next: "Scene 3" });
    });

    it("re-reads Studio Mode before refusing a turn on a stale 'off'", async () => {
      const client = await connect(await start());
      (client as unknown as { catalog: { studioMode: boolean } }).catalog.studioMode = false; // a lost event
      const sink = { setFeedback: vi.fn(async () => {}), showAlert: vi.fn(async () => {}) };
      const dial = new ObsFaderDialInstanceController(client, sink, { target: "tbar" }, 1);
      await dial.handleRotate(5);
      expect(sink.showAlert).not.toHaveBeenCalled();
      expect(server.manualTransitionActive).toBe(true);
    });

    it("drops a Scene loop step that never finished instead of holding the dial", async () => {
      const client = await connect(await start());
      const internal = client as unknown as { sceneCycle: unknown };
      internal.sceneCycle = { token: -1, live: "Scene Live", next: "Scene Preview", transition: "Fade", started: true, ended: true, endedAt: Date.now() - 5000 };
      await client.nudgeTbar(0.2, true);
      expect(server.manualTransitionActive).toBe(true);
    });

    it("caps the settle window after a take even while the dial keeps spinning", async () => {
      const client = await connect(await start());
      await client.nudgeTbar(1); // a take
      const until = Date.now() + 1800;
      while (Date.now() < until) {
        await client.nudgeTbar(0.05);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(server.manualTransitionActive).toBe(true); // the spin went on to the next throw
    });
  });
});
