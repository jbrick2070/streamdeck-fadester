// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObsNeoInfobarInstanceController } from "../src/actions/obs-neo-infobar.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

describe("Neo OBS Info Bar", () => {
  let server: FakeObsServer | undefined;
  let client: DirectObsClient | undefined;
  let controller: ObsNeoInfobarInstanceController | undefined;

  afterEach(async () => {
    controller?.disappear();
    client?.stop();
    await server?.stop();
    controller = undefined;
    client = undefined;
    server = undefined;
  });

  it("tracks real OBS scene and studio-mode events, clears stale scenes on disconnect, and reconnects", async () => {
    server = new FakeObsServer({ missingPlugin: true });
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" }, {
      baseReconnectMs: 30, maxReconnectMs: 100
    });
    const frames: Array<Record<string, unknown>> = [];
    controller = new ObsNeoInfobarInstanceController(client, {
      setFeedback: async (payload) => { frames.push({ ...payload }); }
    }, 16);
    controller.appear();
    expect(frames.at(-1)).toEqual({ status: "OBS disconnected", live: "LIVE  —", preview: "PREVIEW  —" });

    client.start();
    await vi.waitFor(() => expect(frames.at(-1)).toEqual({
      status: "OBS connected", live: "LIVE  Scene Live", preview: "PREVIEW  Scene Preview"
    }));
    server.emitObsEvent("CurrentProgramSceneChanged", { sceneName: "Camera" });
    server.emitObsEvent("CurrentPreviewSceneChanged", { sceneName: "Slides" });
    await vi.waitFor(() => expect(frames.at(-1)).toEqual({
      status: "OBS connected", live: "LIVE  Camera", preview: "PREVIEW  Slides"
    }));

    server.studioMode = false;
    server.emitObsEvent("StudioModeStateChanged", { studioModeEnabled: false });
    await vi.waitFor(() => expect(frames.at(-1)?.preview).toBe("PREVIEW  Studio Mode off"));

    // OBS may not send a preview-changed event merely because Studio Mode was
    // enabled. The action must fetch the current preview instead of displaying
    // the value cached before Studio Mode was disabled.
    server.previewSceneName = "Fresh preview";
    server.studioMode = true;
    server.emitObsEvent("StudioModeStateChanged", { studioModeEnabled: true });
    await vi.waitFor(() => expect(frames.at(-1)?.preview).toBe("PREVIEW  Fresh preview"));

    await server.stop();
    await vi.waitFor(() => expect(frames.at(-1)).toEqual({
      status: "OBS disconnected", live: "LIVE  —", preview: "PREVIEW  —"
    }));
    server = new FakeObsServer({ missingPlugin: true });
    await server.start(port);
    await vi.waitFor(() => expect(frames.at(-1)).toEqual({
      status: "OBS connected", live: "LIVE  Scene Live", preview: "PREVIEW  Scene Preview"
    }), { timeout: 3000 });
  });

  it("unsubscribes and stops updating after the Info Bar disappears", async () => {
    server = new FakeObsServer({ missingPlugin: true });
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const frames: Array<Record<string, unknown>> = [];
    controller = new ObsNeoInfobarInstanceController(client, {
      setFeedback: async (payload) => { frames.push({ ...payload }); }
    }, 16);
    const initialStatusListeners = client.listenerCount("statusChanged");
    const initialStateListeners = client.listenerCount("directStateChanged");
    controller.appear();
    expect(client.listenerCount("statusChanged")).toBe(initialStatusListeners + 1);
    expect(client.listenerCount("directStateChanged")).toBe(initialStateListeners + 1);
    controller.disappear();
    expect(client.listenerCount("statusChanged")).toBe(initialStatusListeners);
    expect(client.listenerCount("directStateChanged")).toBe(initialStateListeners);
    const count = frames.length;
    client.start();
    await vi.waitFor(() => expect(client?.isConnected()).toBe(true));
    expect(frames).toHaveLength(count);
  });
});
