// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FAKE_MEDIA_STATES, FakeMediaState, FakeObsServer, PLAYLISTER_KIND } from "./helpers/fake-obs-server.js";

/**
 * The fake obs-websocket's media model (PLAN.md 9.1): the wire shapes of
 * obs-websocket 5.6.3 and the state rules of playlister-source.c.
 */
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
