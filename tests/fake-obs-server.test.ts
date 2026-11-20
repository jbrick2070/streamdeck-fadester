// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { OBS_WS_DEFAULT_SUBSCRIPTIONS } from "../packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.js";
import {
  FAKE_EVENT_CATEGORY, FAKE_MEDIA_STATES, FakeMediaState, FakeObsServer, PLAYLISTER_KIND, fakeEventCategory
} from "./helpers/fake-obs-server.js";

/**
 * The fake obs-websocket's media model (PLAN.md 9.1): the wire shapes of
 * obs-websocket 5.6.3 and the state rules of playlister-source.c.
 */
describe("fake OBS server: event subscriptions and unknown requests (G-05)", () => {
  let server: FakeObsServer | undefined;
  let sockets: WebSocket[] = [];
  let client: DirectObsClient | undefined;

  afterEach(async () => {
    client?.stop();
    client = undefined;
    for (const socket of sockets) socket.close();
    sockets = [];
    await server?.stop();
    server = undefined;
  });

  /** A bare obs-websocket client: identifies with `mask` (or without one), then collects events and answers. */
  async function raw(port: number, mask: number | undefined, identify = true): Promise<{ socket: WebSocket; events: string[]; answers: Array<Record<string, unknown>>; closed: number[] }> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    const events: string[] = [];
    const answers: Array<Record<string, unknown>> = [];
    const closed: number[] = [];
    socket.on("close", (code) => closed.push(code));
    const identified = new Promise<void>((resolve) => {
      socket.on("message", (data) => {
        const message = JSON.parse(String(data)) as { op: number; d: Record<string, unknown> };
        if (message.op === 0) {
          if (identify) socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, ...(mask === undefined ? {} : { eventSubscriptions: mask }) } }));
          else resolve();
        }
        if (message.op === 2) resolve();
        if (message.op === 5) events.push(String(message.d.eventType));
        if (message.op === 7) answers.push(message.d);
      });
    });
    await identified;
    return { socket, events, answers, closed };
  }

  it("sends an event only to clients that subscribed to its category, and to none that has not identified", async () => {
    server = new FakeObsServer({ missingPlugin: true });
    const port = await server.start();
    const all = await raw(port, undefined);
    const scenesOnly = await raw(port, FAKE_EVENT_CATEGORY.Scenes);
    const none = await raw(port, 0);
    const unidentified = await raw(port, undefined, false);
    server.emitObsEvent("CurrentProgramSceneChanged", { sceneName: "Scene 3" });
    server.emitObsEvent("StudioModeStateChanged", { studioModeEnabled: true });
    server.emitObsEvent("SceneTransitionStarted", { transitionName: "Fade" });
    server.emitObsEvent("InputVolumeMeters", { inputs: [] }); // high volume: not part of "All"
    server.emitVendorEvent("fader_changed", { slot: "fader_1", value: 0.5 });
    await vi.waitFor(() => expect(all.events).toHaveLength(4));
    expect(all.events).toEqual(["CurrentProgramSceneChanged", "StudioModeStateChanged", "SceneTransitionStarted", "VendorEvent"]);
    expect(scenesOnly.events).toEqual(["CurrentProgramSceneChanged"]);
    expect(none.events).toEqual([]);
    expect(unidentified.events).toEqual([]);
    expect(server.eventsNotSubscribed.get("InputVolumeMeters")).toBe(3);
  });

  it("answers a request type it does not model with 204 at once, and closes a client that asks before Identify", async () => {
    server = new FakeObsServer({ missingPlugin: true });
    const port = await server.start();
    const ok = await raw(port, undefined);
    ok.socket.send(JSON.stringify({ op: 6, d: { requestType: "NoSuchRequestHere", requestId: "x1" } }));
    await vi.waitFor(() => expect(ok.answers).toHaveLength(1));
    expect(ok.answers[0]).toMatchObject({ requestId: "x1", requestStatus: { result: false, code: 204 } });
    const early = await raw(port, undefined, false);
    early.socket.send(JSON.stringify({ op: 6, d: { requestType: "GetVersion", requestId: "x2" } }));
    await vi.waitFor(() => expect(early.closed).toEqual([4007]));
    expect(early.answers).toEqual([]);
  });

  it("the plugin subscribes to every category of every event it handles, and to nothing high-volume", async () => {
    // The mask, pinned: a category dropped from it would leave its events' handlers dead against real OBS.
    const c = FAKE_EVENT_CATEGORY;
    expect(OBS_WS_DEFAULT_SUBSCRIPTIONS).toBe(c.General | c.Config | c.Scenes | c.Inputs | c.Transitions | c.SceneItems | c.Vendors | c.Ui);
    // Every OBS event type named in the plugin's sources belongs to a subscribed category.
    const sources = ["src/obs/direct-obs-client.ts", "src/control/layer-controller.ts", "src/control/filter-controller.ts",
      "src/control/tape-decks.ts", "src/control/visual-signals.ts", "src/control/visual-safety.ts",
      "packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
    const named = new Set([...sources.matchAll(/"((?:Current|Scene|Input|Studio|Vendor|Custom|SourceFilter|MediaInput)[A-Za-z]*(?:Changed|Changing|Created|Removed|Started|Ended|Reindexed|Event))"/g)].map((match) => match[1]));
    expect(named.size).toBeGreaterThan(15);
    for (const eventType of named) expect(OBS_WS_DEFAULT_SUBSCRIPTIONS & fakeEventCategory(eventType), eventType).not.toBe(0);
    // And a connected plugin misses none of the events the tests send it.
    server = new FakeObsServer({ missingPlugin: true });
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const connected = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await connected;
    for (const eventType of ["CurrentProgramSceneChanged", "CurrentPreviewSceneChanged", "CurrentSceneCollectionChanging",
      "CurrentSceneCollectionChanged", "CurrentSceneTransitionChanged", "SceneTransitionStarted", "SceneTransitionEnded",
      "StudioModeStateChanged", "InputVolumeChanged", "SceneItemEnableStateChanged", "CustomEvent"]) {
      server.emitObsEvent(eventType, {});
    }
    expect([...server.eventsNotSubscribed.keys()]).toEqual([]);
  });
});

describe("fake OBS server: identity, capabilities and media", () => {
  let server: FakeObsServer | undefined;
  let client: DirectObsClient | undefined;

  async function connect(options?: ConstructorParameters<typeof FakeObsServer>[0]): Promise<DirectObsClient> {
    server = new FakeObsServer({ missingPlugin: true, ...options });
    const port = await server.start();
    client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const connected = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await connected;
    return client;
  }

  afterEach(async () => {
    client?.stop();
    await server?.stop();
  });

  it("lists inputs with UUID and kind, reports availableRequests and emits lifecycle events by UUID", async () => {
    const direct = await connect();
    const version = await direct.sendObsRequest("GetVersion");
    expect(version.obsWebSocketVersion).toBe("5.6.3");
    expect(version.availableRequests).toEqual(expect.arrayContaining(["GetInputList", "GetMediaInputStatus", "TriggerMediaInputAction"]));
    const list = await direct.sendObsRequest("GetInputList");
    expect(list.inputs).toEqual([
      expect.objectContaining({ inputName: "Desktop Audio", inputKind: "wasapi_output_capture", unversionedInputKind: "wasapi_output_capture" }),
      expect.objectContaining({ inputName: "Mic/Aux", inputKind: "wasapi_input_capture" })
    ]);
    const [desktop] = list.inputs as Array<{ inputUuid: string }>;
    expect(desktop.inputUuid).toMatch(/^[0-9a-f-]{36}$/);
    // The same name keeps its UUID across listings.
    expect(((await direct.sendObsRequest("GetInputList")).inputs as Array<{ inputUuid: string }>)[0].inputUuid).toBe(desktop.inputUuid);

    const events: Array<[string, Record<string, unknown>]> = [];
    direct.on("obsEvent", (type: string, data: Record<string, unknown>) => events.push([type, data]));
    const reel = server!.addPlaylister("Reel");
    expect(reel).toMatchObject({ inputName: "Reel", inputKind: PLAYLISTER_KIND, unversionedInputKind: PLAYLISTER_KIND });
    server!.renameInput(reel.inputUuid, "Main reel");
    server!.removeInput(reel.inputUuid);
    await vi.waitFor(() => expect(events.map(([type]) => type)).toEqual(expect.arrayContaining(["InputCreated", "InputNameChanged", "InputRemoved"])));
    // The returned record is a copy: the rename above did not change it.
    expect(reel.inputName).toBe("Reel");
    expect(events.find(([type]) => type === "InputCreated")?.[1]).toMatchObject({ inputName: "Reel", inputUuid: reel.inputUuid, inputKind: PLAYLISTER_KIND });
    expect(events.find(([type]) => type === "InputNameChanged")?.[1]).toEqual({ inputUuid: reel.inputUuid, oldInputName: "Reel", inputName: "Main reel" });
    expect(events.find(([type]) => type === "InputRemoved")?.[1]).toEqual({ inputName: "Main reel", inputUuid: reel.inputUuid });
    expect((await direct.sendObsRequest("GetInputList")).inputs).toHaveLength(2);

    const limited = new FakeObsServer({ missingPlugin: true, availableRequests: ["GetInputList"] });
    const port = await limited.start();
    const narrow = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    try {
      const ready = once(narrow, "statusChanged", { signal: AbortSignal.timeout(2000) });
      narrow.start();
      await ready;
      expect((await narrow.sendObsRequest("GetVersion")).availableRequests).toEqual(["GetInputList"]);
    } finally {
      narrow.stop();
      await limited.stop();
    }
  });

  it("answers GetMediaInputStatus with null cursor and duration outside PLAYING and PAUSED", async () => {
    const direct = await connect();
    const reel = server!.addPlaylister("Reel", { durationMs: 90000, cursorMs: 12345 });
    const model = server!.mediaInputs.get(reel.inputUuid)!;
    for (const state of FAKE_MEDIA_STATES) {
      model.state = state;
      const status = await direct.sendObsRequest("GetMediaInputStatus", { inputUuid: reel.inputUuid });
      expect(status.mediaState).toBe(state);
      if (state === "OBS_MEDIA_STATE_PLAYING" || state === "OBS_MEDIA_STATE_PAUSED") {
        expect(status).toMatchObject({ mediaDuration: 90000, mediaCursor: 12345 });
      } else {
        expect(status.mediaDuration, state).toBeNull();
        expect(status.mediaCursor, state).toBeNull();
      }
    }
    // Status reads are logged apart from directCallLog, which tests compare whole.
    expect(server!.mediaStatusLog).toHaveLength(FAKE_MEDIA_STATES.length);
    expect(server!.directCallLog).toEqual([]);
    // An empty list is NONE whatever the model holds.
    model.state = "OBS_MEDIA_STATE_PLAYING";
    model.items = 0;
    expect((await direct.sendObsRequest("GetMediaInputStatus", { inputUuid: reel.inputUuid })).mediaState).toBe("OBS_MEDIA_STATE_NONE");
    // A non-media kind answers NONE with nulls; an unknown UUID is 600 (ResourceNotFound).
    const [desktop] = (await direct.sendObsRequest("GetInputList")).inputs as Array<{ inputUuid: string }>;
    expect(await direct.sendObsRequest("GetMediaInputStatus", { inputUuid: desktop.inputUuid }))
      .toEqual({ mediaState: "OBS_MEDIA_STATE_NONE", mediaDuration: null, mediaCursor: null });
    await expect(direct.sendObsRequest("GetMediaInputStatus", { inputUuid: "no-such-input" }))
      .rejects.toMatchObject({ code: 600 });
    // As OBS, the fake also answers a read by name; every payload is logged raw before the lookup.
    expect((await direct.sendObsRequest("GetMediaInputStatus", { inputName: "Reel" })).mediaState).toBe("OBS_MEDIA_STATE_NONE");
    expect(server!.mediaStatusRequests.slice(-3)).toEqual([{ inputUuid: desktop.inputUuid }, { inputUuid: "no-such-input" }, { inputName: "Reel" }]);
    expect(server!.mediaStatusRequests).toHaveLength(FAKE_MEDIA_STATES.length + 4);
    await expect(direct.sendObsRequest("TriggerMediaInputAction", { inputUuid: "no-such-input", mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP" }))
      .rejects.toMatchObject({ code: 600 });
    await expect(direct.sendObsRequest("TriggerMediaInputAction", { inputUuid: reel.inputUuid, mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_FOO" }))
      .rejects.toMatchObject({ code: 400 });
  });

  it("applies each TriggerMediaInputAction as the native source does", async () => {
    const direct = await connect();
    const reel = server!.addPlaylister("Reel", { items: 3 });
    const model = server!.mediaInputs.get(reel.inputUuid)!;
    const act = async (action: string): Promise<FakeMediaState> => {
      await direct.sendObsRequest("TriggerMediaInputAction", { inputUuid: reel.inputUuid, mediaAction: `OBS_WEBSOCKET_MEDIA_INPUT_ACTION_${action}` });
      return model.state;
    };
    const from = (state: FakeMediaState, index = 0): void => { model.state = state; model.index = index; };

    // PLAY resumes PAUSED and keeps PLAYING; from STOPPED, ENDED or NONE it loads.
    from("OBS_MEDIA_STATE_PAUSED"); expect(await act("PLAY")).toBe("OBS_MEDIA_STATE_PLAYING");
    from("OBS_MEDIA_STATE_PLAYING"); expect(await act("PLAY")).toBe("OBS_MEDIA_STATE_PLAYING");
    from("OBS_MEDIA_STATE_STOPPED"); expect(await act("PLAY")).toBe("OBS_MEDIA_STATE_PLAYING");
    from("OBS_MEDIA_STATE_ENDED"); expect(await act("PLAY")).toBe("OBS_MEDIA_STATE_PLAYING");
    // PAUSE acts only while PLAYING; it is ignored in STOPPED, ENDED and NONE (playlister-source.c:1212, :1229).
    from("OBS_MEDIA_STATE_PLAYING"); expect(await act("PAUSE")).toBe("OBS_MEDIA_STATE_PAUSED");
    from("OBS_MEDIA_STATE_STOPPED"); expect(await act("PAUSE")).toBe("OBS_MEDIA_STATE_STOPPED");
    from("OBS_MEDIA_STATE_ENDED"); expect(await act("PAUSE")).toBe("OBS_MEDIA_STATE_ENDED");
    // STOP and RESTART.
    from("OBS_MEDIA_STATE_PLAYING"); expect(await act("STOP")).toBe("OBS_MEDIA_STATE_STOPPED");
    from("OBS_MEDIA_STATE_ENDED"); expect(await act("RESTART")).toBe("OBS_MEDIA_STATE_PLAYING");
    // NEXT and PREVIOUS load an item from any state and end in PLAYING; loop wraps.
    from("OBS_MEDIA_STATE_STOPPED", 0); expect(await act("NEXT")).toBe("OBS_MEDIA_STATE_PLAYING"); expect(model.index).toBe(1);
    from("OBS_MEDIA_STATE_PAUSED", 2); expect(await act("NEXT")).toBe("OBS_MEDIA_STATE_PLAYING"); expect(model.index).toBe(0);
    from("OBS_MEDIA_STATE_ENDED", 0); expect(await act("PREVIOUS")).toBe("OBS_MEDIA_STATE_PLAYING"); expect(model.index).toBe(2);
    // At either end with loop off nothing loads and the state stays.
    model.loop = false;
    from("OBS_MEDIA_STATE_PAUSED", 2); expect(await act("NEXT")).toBe("OBS_MEDIA_STATE_PAUSED"); expect(model.index).toBe(2);
    from("OBS_MEDIA_STATE_STOPPED", 0); expect(await act("PREVIOUS")).toBe("OBS_MEDIA_STATE_STOPPED"); expect(model.index).toBe(0);
    // Shuffle: NEXT past the last unplayed item is a no-op with loop off; PREVIOUS at the start of the history too.
    model.shuffle = true;
    model.shuffleRemaining = 0;
    model.shuffleHistory = 0;
    from("OBS_MEDIA_STATE_PAUSED", 1); expect(await act("NEXT")).toBe("OBS_MEDIA_STATE_PAUSED");
    expect(await act("PREVIOUS")).toBe("OBS_MEDIA_STATE_PAUSED");
    model.loop = true;
    expect(await act("PREVIOUS")).toBe("OBS_MEDIA_STATE_PAUSED");
    expect(await act("NEXT")).toBe("OBS_MEDIA_STATE_PLAYING");
    expect(await act("PREVIOUS")).toBe("OBS_MEDIA_STATE_PLAYING");
    // An empty list is NONE whatever is sent.
    const empty = server!.addPlaylister("Empty", { items: 0 });
    for (const action of ["PLAY", "PAUSE", "STOP", "RESTART", "NEXT", "PREVIOUS"]) {
      await direct.sendObsRequest("TriggerMediaInputAction", { inputUuid: empty.inputUuid, mediaAction: `OBS_WEBSOCKET_MEDIA_INPUT_ACTION_${action}` });
      expect(server!.mediaInputs.get(empty.inputUuid)!.state, action).toBe("OBS_MEDIA_STATE_NONE");
    }
    // Delays and the scripted failure serve the in-flight tests; NONE is accepted and sends nothing.
    server!.mediaFailNext = "Playlister is busy.";
    await expect(act("STOP")).rejects.toThrow("Playlister is busy.");
    expect(server!.mediaFailNext).toBe("");
    expect(await act("NONE")).toBe("OBS_MEDIA_STATE_PLAYING");
    expect(server!.directCallLog.at(-1)).toEqual({ requestType: "TriggerMediaInputAction",
      requestData: { inputUuid: reel.inputUuid, mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NONE" } });
  });
});
