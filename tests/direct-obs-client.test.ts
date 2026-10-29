// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import type { WebSocket } from "ws";
import {
  DIRECT_SCENE_CURRENT_PREVIEW,
  DIRECT_SCENE_NEXT,
  DirectObsClient
} from "../src/obs/direct-obs-client.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";
import { ObsFaderDialInstanceController } from "../src/actions/obs-fader-dial.js";

describe("Direct OBS client", () => {
  let server: FakeObsServer | undefined;
  let client: DirectObsClient | undefined;

  async function connect(missingPlugin = true): Promise<DirectObsClient> {
    server = new FakeObsServer({ missingPlugin });
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const connected = once(client, "statusChanged", {
      signal: AbortSignal.timeout(2000)
    });
    client.start();
    await connected;
    return client;
  }

  afterEach(async () => {
    client?.stop();
    await server?.stop();
  });

  /** Delay an older native response while a newer discovery can finish. */
  function holdNextVolume() {
    let release!: () => void;
    let notify!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { notify = resolve; });
    type Handler = (ws: WebSocket, id: string, type: string, data: Record<string, unknown>) => Promise<void>;
    const native = server! as unknown as { handleObsRequest: Handler };
    const original = native.handleObsRequest.bind(server);
    let pending = true;
    native.handleObsRequest = async (ws, id, type, data) => {
      if (pending && type === "GetInputVolume") {
        pending = false;
        notify();
        await held;
      }
      await original(ws, id, type, data);
    };
    return { release, started };
  }

  it("keeps newer renamed inputs when an older catalog response completes late", async () => {
    const direct = await connect();
    const delayed = holdNextVolume();
    const older = direct.refreshCatalog();
    await delayed.started;
    server!.inputNames = ["Renamed Music", "Mic/Aux"];
    server!.inputVolumes.set("Renamed Music", 0.45);
    await direct.refreshCatalog();
    expect(direct.resolveInputName("__audio_main__")).toBe("Renamed Music");
    delayed.release();
    await older;
    expect(direct.getCatalog().inputs).toEqual(["Renamed Music", "Mic/Aux"]);
    expect(direct.resolveInputName("Desktop Audio")).toBe("");
    expect(direct.resolveInputName("__audio_main__")).toBe("Renamed Music");
  });

  it("keeps live OBS scene and audio events that arrive during catalog discovery", async () => {
    const direct = await connect();
    const delayed = holdNextVolume();
    const older = direct.refreshCatalog();
    await delayed.started;
    server!.programSceneName = "Scene 3";
    server!.previewSceneName = "Scene Live";
    server!.inputVolumes.set("Mic/Aux", 0.3);
    server!.emitObsEvent("CurrentProgramSceneChanged", { sceneName: "Scene 3" });
    server!.emitObsEvent("CurrentPreviewSceneChanged", { sceneName: "Scene Live" });
    server!.emitObsEvent("InputVolumeChanged", { inputName: "Mic/Aux", inputVolumeMul: 0.3 });
    await vi.waitFor(() => expect(direct.getCatalog().currentProgramScene).toBe("Scene 3"));
    delayed.release();
    await older;
    expect(direct.getCatalog()).toMatchObject({
      currentProgramScene: "Scene 3", currentPreviewScene: "Scene Live", inputVolumes: { "Mic/Aux": 0.3 }
    });
  });

  it("discards an in-flight scene press and its queued successor when the collection changes", async () => {
    const direct = await connect();
    let release!: () => void;
    let notify!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { notify = resolve; });
    type Handler = (ws: WebSocket, id: string, type: string, data: Record<string, unknown>) => Promise<void>;
    const native = server! as unknown as { handleObsRequest: Handler };
    const original = native.handleObsRequest.bind(server);
    let pending = true;
    native.handleObsRequest = async (ws, id, type, data) => {
      if (pending && type === "GetSceneList") { pending = false; notify(); await held; }
      await original(ws, id, type, data);
    };
    const first = direct.runSceneAction(DIRECT_SCENE_NEXT, "transition");
    const firstRejected = expect(first).rejects.toThrow(/changed/i);
    await started;
    const second = direct.runSceneAction(DIRECT_SCENE_NEXT, "transition");
    const secondRejected = expect(second).rejects.toThrow(/changed/i);
    server!.emitObsEvent("CurrentSceneCollectionChanging", {});
    server!.sceneNames = ["New Live", "New Next"];
    server!.programSceneName = "New Live";
    server!.previewSceneName = "New Next";
    server!.emitObsEvent("CurrentSceneCollectionChanged", {});
    await vi.waitFor(() => expect(direct.getCatalog().scenes).toEqual(["New Live", "New Next"]));
    release();
    await Promise.all([firstRejected, secondRejected]);
    expect(server!.programSceneName).toBe("New Live");
    expect(server!.directCallLog.filter((call) => call.requestType === "SetCurrentProgramScene")).toEqual([]);
    expect(await direct.runSceneAction(DIRECT_SCENE_NEXT, "transition")).toBe("New Next");
  });

  it("does not restore an old scene transition override into a new collection", async () => {
    const direct = await connect();
    let release!: () => void;
    let notify!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { notify = resolve; });
    type Handler = (ws: WebSocket, id: string, type: string, data: Record<string, unknown>) => Promise<void>;
    const native = server! as unknown as { handleObsRequest: Handler };
    const original = native.handleObsRequest.bind(server);
    let pending = true;
    native.handleObsRequest = async (ws, id, type, data) => {
      if (pending && type === "SetSceneSceneTransitionOverride") {
        pending = false;
        await original(ws, id, type, data);
        notify();
        await held;
        return;
      }
      await original(ws, id, type, data);
    };
    const action = direct.runSceneAction("Scene 3", "cut");
    const rejected = expect(action).rejects.toThrow(/changed/i);
    await started;
    server!.emitObsEvent("CurrentSceneCollectionChanging", {});
    server!.emitObsEvent("CurrentSceneCollectionChanged", {});
    await vi.waitFor(() => expect(direct.getCatalog().scenes).toEqual(server!.sceneNames));
    release();
    await rejected;
    expect(server!.directCallLog.filter((call) => call.requestType === "SetCurrentProgramScene")).toEqual([]);
    expect(server!.directCallLog.filter((call) => call.requestType === "SetSceneSceneTransitionOverride")).toHaveLength(1);
  });

  it("rejects controls throughout a collection change and accepts them after OBS finishes", async () => {
    const direct = await connect();
    const changing = once(direct, "directStateChanged", { signal: AbortSignal.timeout(2000) });
    server!.emitObsEvent("CurrentSceneCollectionChanging", {});
    await changing;
    // A late volume event during loading must not make audio controls usable.
    server!.emitObsEvent("InputVolumeChanged", { inputName: "Desktop Audio", inputVolumeMul: 0.8 });
    await vi.waitFor(() => expect(direct.getCatalog().inputVolumes["Desktop Audio"]).toBe(0.8));
    const before = server!.directCallLog.length;
    await expect(direct.runSceneAction(DIRECT_SCENE_NEXT, "transition")).rejects.toThrow(/changed/i);
    await expect(direct.nudgeTbar(0.1)).rejects.toThrow(/changed/i);
    await expect(direct.prepareStudioLayout()).rejects.toThrow(/changed/i);
    await expect(direct.nudgeInputVolume("Desktop Audio", 0.1)).rejects.toThrow(/changed/i);
    await expect(direct.fadeInputVolume("Desktop Audio", 0, 0)).rejects.toThrow(/changed/i);
    await expect(direct.getInputVolume("Desktop Audio")).rejects.toThrow(/changed/i);
    expect(server!.directCallLog).toHaveLength(before);
    server!.emitObsEvent("CurrentSceneCollectionChanged", {});
    await vi.waitFor(() => expect(direct.getCatalog().scenes).toEqual(server!.sceneNames));
    await direct.nudgeInputVolume("Desktop Audio", 0.1);
    expect(server!.inputVolumes.get("Desktop Audio")).toBeCloseTo(0.9);
    expect(await direct.runSceneAction(DIRECT_SCENE_NEXT, "preview")).toBe("Scene 3");
  });

  it("does not republish a catalog from the previous connection after reconnecting", async () => {
    const direct = await connect();
    const delayed = holdNextVolume();
    const older = direct.refreshCatalog();
    await delayed.started;
    server!.inputNames = ["New Music", "New Microphone"];
    server!.inputVolumes.set("New Music", 0.5);
    server!.inputVolumes.set("New Microphone", 0.3);
    direct.reconnectNow();
    await vi.waitFor(() => expect(direct.getCatalog().inputs).toEqual(["New Music", "New Microphone"]));
    delayed.release();
    await older;
    expect(direct.resolveInputName("__audio_main__")).toBe("New Music");
    expect(direct.resolveInputName("__audio_mic__")).toBe("New Microphone");
    expect(direct.resolveInputName("Desktop Audio")).toBe("");
  });

  it("discards an old collection snapshot while discovering the new collection", async () => {
    const direct = await connect();
    const delayed = holdNextVolume();
    const older = direct.refreshCatalog();
    await delayed.started;
    server!.emitObsEvent("CurrentSceneCollectionChanging", {});
    await vi.waitFor(() => expect(direct.getCatalog().inputs).toEqual([]));
    server!.inputNames = ["Show Music"];
    server!.inputVolumes.set("Show Music", 0.75);
    server!.emitObsEvent("CurrentSceneCollectionChanged", {});
    await vi.waitFor(() => expect(direct.resolveInputName("__audio_main__")).toBe("Show Music"));
    delayed.release();
    await older;
    expect(direct.getCatalog().inputs).toEqual(["Show Music"]);
    expect(direct.resolveInputName("Desktop Audio")).toBe("");
  });

  it("discards active and queued gestures instead of writing a same-named input in a new collection", async () => {
    const direct = await connect();
    const delayed = holdNextVolume();
    const active = direct.nudgeInputVolume("Desktop Audio", 0.1);
    const queued = direct.setInputVolume("Desktop Audio", 0.9);
    const results = Promise.allSettled([active, queued]);
    await delayed.started;
    server!.emitObsEvent("CurrentSceneCollectionChanging", {});
    await vi.waitFor(() => expect(direct.getCatalog().inputs).toEqual([]));
    server!.inputVolumes.set("Desktop Audio", 0.25);
    server!.emitObsEvent("CurrentSceneCollectionChanged", {});
    await vi.waitFor(() => expect(direct.getCatalog().inputVolumes["Desktop Audio"]).toBe(0.25));
    delayed.release();
    expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(server!.directCallLog.filter((entry) => entry.requestType === "SetInputVolume")).toEqual([]);
    expect(server!.inputVolumes.get("Desktop Audio")).toBe(0.25);
    await direct.setInputVolume("Desktop Audio", 0.7);
    expect(server!.inputVolumes.get("Desktop Audio")).toBe(0.7);
  });

  it.each(["CurrentSceneCollectionChanging", "InputRemoved"])(
    "stops an old input fade at %s before a same-named input can be reused",
    async (eventType) => {
      const direct = await connect();
      const fade = direct.fadeInputVolume("Desktop Audio", 0, 500);
      await vi.waitFor(() => expect(server!.directCallLog.some((entry) => entry.requestType === "SetInputVolume")).toBe(true));
      server!.emitObsEvent(eventType, { inputName: "Desktop Audio" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const writesAtBoundary = server!.directCallLog.filter((entry) => entry.requestType === "SetInputVolume").length;
      await fade;
      expect(server!.directCallLog.filter((entry) => entry.requestType === "SetInputVolume")).toHaveLength(writesAtBoundary);
    }
  );

  it("connects to plain OBS without issuing a Midi Fadester vendor request", async () => {
    const direct = await connect(true);
    expect(direct.getStatus()).toMatchObject({
      kind: "connected",
      obsVersion: "33.0.0"
    });
    expect(direct.getCatalog()).toMatchObject({
      scenes: ["Scene Live", "Scene Preview", "Scene 3"],
      inputs: ["Desktop Audio", "Mic/Aux"],
      transitions: ["Cut", "Fade", "Fade to Black"],
      studioMode: true
    });
    expect(server?.vendorCallLog).toEqual([]);
  });

  it("keeps the scene mixer idle when Live and Next refer to the same scene", async () => {
    const direct = await connect();
    server!.previewSceneName = server!.programSceneName;
    await direct.refreshCatalog();
    let alerts = 0;
    const dial = new ObsFaderDialInstanceController(direct, {
      setFeedback: async () => {}, showAlert: async () => { alerts++; }
    }, { target: "tbar" });
    await dial.handleRotate(3);
    await dial.handleDialUp();
    expect(alerts).toBe(2);
    expect(server!.directCallLog.filter((call) => call.requestType === "SetTBarPosition")).toEqual([]);
  });

  it("uses native OBS requests for mixer, T-bar, and selected scene transitions", async () => {
    const direct = await connect();
    await direct.nudgeInputVolume("Mic/Aux", 0.1);
    await direct.setTbarPosition(0.4, false);
    await direct.runSceneAction(DIRECT_SCENE_NEXT, "transition", "Fade to Black");

    expect(server?.inputVolumes.get("Mic/Aux")).toBeCloseTo(0.7, 5);
    expect(server?.directTbarPosition).toBeCloseTo(0.4, 5);
    expect(server?.programSceneName).toBe("Scene Preview");
    expect(server?.directCallLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestType: "SetInputVolume",
          requestData: { inputName: "Mic/Aux", inputVolumeMul: 0.7 }
        }),
        expect.objectContaining({
          requestType: "SetTBarPosition",
          requestData: { position: 0.4, release: false }
        }),
        expect.objectContaining({
          requestType: "SetSceneSceneTransitionOverride",
          requestData: {
            sceneName: "Scene Preview",
            transitionName: "Fade to Black",
            transitionDuration: null
          }
        }),
        expect.objectContaining({ requestType: "SetCurrentProgramScene" })
      ])
    );
    expect(server?.lastSceneTransition).toBe("Fade to Black");
    expect(server?.currentTransitionName).toBe("Fade");
    expect(server?.vendorCallLog).toEqual([]);
  });

  it("refuses a T-bar command outside Studio Mode without a write", async () => {
    server = new FakeObsServer({ studioMode: false, missingPlugin: true });
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const connected = once(client, "statusChanged", {
      signal: AbortSignal.timeout(2000)
    });
    client.start();
    await connected;

    await expect(client.setTbarPosition(0.5)).rejects.toThrow("Studio Mode");
    expect(server.directCallLog.some((call) => call.requestType === "SetTBarPosition")).toBe(false);
  });

  it("takes the scene selected in Preview and restores a destination transition override after a true Cut", async () => {
    const direct = await connect();
    server!.sceneTransitionOverrides.set("Scene 3", {
      transitionName: "Fade to Black", transitionDuration: 1750
    });
    await direct.runSceneAction(DIRECT_SCENE_NEXT, "preview");
    expect(server?.previewSceneName).toBe("Scene 3");
    await direct.runSceneAction(DIRECT_SCENE_CURRENT_PREVIEW, "cut");
    expect(server?.programSceneName).toBe("Scene 3");
    expect(server?.lastSceneTransition).toBe("Cut");
    expect(server?.sceneTransitionOverrides.get("Scene 3")).toEqual({
      transitionName: "Fade to Black", transitionDuration: 1750
    });
    expect(direct.getCatalog().currentPreviewScene).toBe("Scene Live");
  });

  it("restores the destination scene override when a scene switch fails", async () => {
    const direct = await connect();
    server!.sceneTransitionOverrides.set("Scene 3", {
      transitionName: "Fade", transitionDuration: 500
    });
    server!.failNextProgramSwitch = true;
    await expect(direct.runSceneAction("Scene 3", "cut")).rejects.toThrow("Switch failed");
    expect(server?.sceneTransitionOverrides.get("Scene 3")).toEqual({
      transitionName: "Fade", transitionDuration: 500
    });
    // A failed command must not poison the action queue.
    await direct.runSceneAction("Scene 3", "cut");
    expect(server?.programSceneName).toBe("Scene 3");
  });

  it("runs a selected transition in regular mode and reserves Preview for Studio Mode", async () => {
    server = new FakeObsServer({ studioMode: false, missingPlugin: true });
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const ready = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start(); await ready;
    await client.runSceneAction("Scene 3", "transition", "Fade to Black");
    expect(server.programSceneName).toBe("Scene 3");
    expect(server.lastSceneTransition).toBe("Fade to Black");
    await expect(client.runSceneAction("Scene Live", "preview")).rejects.toThrow("Studio Mode");
    await expect(client.runSceneAction(DIRECT_SCENE_CURRENT_PREVIEW, "cut")).rejects.toThrow("Studio Mode");
  });

  it("accumulates rapid scene presses and mixer/T-bar ticks instead of losing their increments", async () => {
    const direct = await connect();
    await Promise.all([
      direct.nudgeInputVolume("Mic/Aux", 0.02),
      direct.nudgeInputVolume("Mic/Aux", 0.02),
      direct.nudgeInputVolume("Mic/Aux", 0.02)
    ]);
    expect(server?.inputVolumes.get("Mic/Aux")).toBeCloseTo(0.66, 5);
    await Promise.all([
      direct.nudgeTbar(0.02), direct.nudgeTbar(0.02), direct.nudgeTbar(0.02)
    ]);
    expect(server?.directTbarPosition).toBeCloseTo(0.06, 5);
    await Promise.all([
      direct.runSceneAction(DIRECT_SCENE_NEXT, "preview"),
      direct.runSceneAction(DIRECT_SCENE_NEXT, "preview")
    ]);
    expect(server?.previewSceneName).toBe("Scene Live");
  });

  it("lets a new manual volume move cancel an in-flight fade without a late overwrite", async () => {
    const direct = await connect();
    const fading = direct.fadeInputVolume("Mic/Aux", 0, 250);
    await new Promise((resolve) => setTimeout(resolve, 90));
    await direct.setInputVolume("Mic/Aux", 0.9);
    await fading;
    expect(server?.inputVolumes.get("Mic/Aux")).toBeCloseTo(0.9, 5);
    expect(server?.directCallLog.at(-1)).toMatchObject({
      requestType: "SetInputVolume",
      requestData: { inputName: "Mic/Aux", inputVolumeMul: 0.9 }
    });
  });

  it("resolves automatic mixer roles to real OBS inputs and cancels fades through either binding", async () => {
    const direct = await connect();
    expect(direct.resolveInputName("__audio_main__")).toBe("Desktop Audio");
    expect(direct.resolveInputName("__audio_mic__")).toBe("Mic/Aux");
    await direct.nudgeInputVolume("__audio_main__", -0.1);
    expect(server!.inputVolumes.get("Desktop Audio")).toBeCloseTo(0.7, 5);
    const fading = direct.fadeInputVolume("__audio_mic__", 0, 250);
    await new Promise((resolve) => setTimeout(resolve, 90));
    await direct.setInputVolume("Mic/Aux", 0.9);
    await fading;
    expect(server!.inputVolumes.get("Mic/Aux")).toBeCloseTo(0.9, 5);
    expect(server!.directCallLog.filter((call) => call.requestType === "SetInputVolume")
      .every((call) => !String(call.requestData?.inputName).startsWith("__audio_"))).toBe(true);
  });

  it("leaves an unavailable automatic mixer role inactive instead of changing another input", async () => {
    const direct = await connect();
    server!.inputNames = ["Desktop Audio"];
    await direct.refreshCatalog();
    await expect(direct.fadeInputVolume("__audio_mic__", 0, 0)).rejects.toThrow("Microphone is unavailable");
    await expect(direct.nudgeInputVolume("__audio_input_2__", 0.1)).rejects.toThrow("unavailable");
    expect(server!.directCallLog.filter((call) => call.requestType === "SetInputVolume")).toEqual([]);
  });
});
