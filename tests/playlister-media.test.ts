// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import type { WebSocket } from "ws";
import {
  DirectObsClient,
  DirectObsClientOptions,
  MediaTargetState,
  OBS_MEDIA_ACTIONS
} from "../src/obs/direct-obs-client.js";
import { DirectObsPropertyInspectorBridge } from "../src/pi/direct-obs-bridge.js";
import { FakeMediaInput, FakeMediaState, FakeObsInput, FakeObsServer, FakeObsServerOptions } from "./helpers/fake-obs-server.js";

/**
 * The client side of the Playlister transport (PLAN.md 9.2, R-PLT-2..5, R-PLT-7),
 * against the fake obs-websocket of 9.1. Test names follow the design's
 * Acceptance paragraph.
 */
describe("Playlister transport client", () => {
  let server: FakeObsServer | undefined;
  let client: DirectObsClient | undefined;
  const extra: Array<{ stop(): void | Promise<void> }> = [];

  type Handler = (ws: WebSocket, id: string, type: string, data: Record<string, unknown>) => Promise<void>;
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const state = (uuid: string): MediaTargetState => client!.getMediaState(uuid);
  const triggers = (fake = server!): string[] => fake.directCallLog
    .filter((call) => call.requestType === "TriggerMediaInputAction").map((call) => String(call.requestData?.mediaAction));
  const reads = (fake = server!): number => fake.mediaStatusLog.length;
  const model = (uuid: string): FakeMediaInput => server!.mediaInputs.get(uuid)!;
  const waitState = (uuid: string, predicate: (s: MediaTargetState) => boolean): Promise<void> =>
    vi.waitFor(() => expect(predicate(state(uuid)), JSON.stringify(state(uuid))).toBe(true), { timeout: 3000 });
  const waitUntil = (check: () => void): Promise<void> => vi.waitFor(check, { timeout: 3000 });
  /** Runs `after` once the fake has applied a matching action, before the client's trailing read. */
  function afterAction(fake: FakeObsServer, action: keyof typeof OBS_MEDIA_ACTIONS, after: () => void): void {
    const native = fake as unknown as { handleObsRequest: Handler };
    const original = native.handleObsRequest.bind(fake);
    native.handleObsRequest = async (ws, id, type, data) => {
      await original(ws, id, type, data);
      if (type === "TriggerMediaInputAction" && data.mediaAction === OBS_MEDIA_ACTIONS[action]) after();
    };
  }

  async function connect(server_: FakeObsServerOptions = {}, options?: DirectObsClientOptions, fake?: FakeObsServer):
    Promise<{ server: FakeObsServer; client: DirectObsClient; reel: string }> {
    const obs = fake ?? new FakeObsServer({ missingPlugin: true, ...server_ });
    const reel = obs.extraInputs.find((input) => input.inputName === "Reel")?.inputUuid ??
      obs.addPlaylister("Reel", { durationMs: 90000, cursorMs: 1000 }).inputUuid;
    const port = await obs.start();
    const direct = new DirectObsClient({ host: "127.0.0.1", port, password: "" }, options);
    const connected = once(direct, "statusChanged", { signal: AbortSignal.timeout(2000) });
    direct.start();
    await connected;
    if (!server) { server = obs; client = direct; } else { extra.push(direct, obs); }
    return { server: obs, client: direct, reel };
  }

  afterEach(async () => {
    client?.stop();
    await server?.stop();
    for (const item of extra) await item.stop();
    extra.length = 0;
    server = undefined;
    client = undefined;
  });

  it("sends the exact OBS_WEBSOCKET_MEDIA_INPUT_ACTION strings by inputUuid and reads null cursor and duration outside PLAYING and PAUSED", async () => {
    const { client: direct, reel } = await connect();
    const release = direct.watchMedia(reel);
    await waitState(reel, (s) => s.availability === "ok" && s.mediaState === "stopped");
    expect(state(reel)).toMatchObject({ mediaCursor: null, mediaDuration: null, pending: "none", queued: 0 });

    expect(await direct.mediaCommand(reel, "next")).toBe("sent");
    expect(server!.directCallLog.at(-1)).toEqual({ requestType: "TriggerMediaInputAction",
      requestData: { inputUuid: reel, mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT" } });
    await waitState(reel, (s) => s.mediaState === "playing" && s.mediaDuration === 90000 && s.mediaCursor === 0);
    expect(await direct.mediaCommand(reel, "playpause")).toBe("sent");
    expect(triggers().at(-1)).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE");
    await waitState(reel, (s) => s.mediaState === "paused" && s.mediaDuration === 90000 && s.mediaCursor === 0);
    await direct.mediaCommand(reel, "playpause");
    expect(triggers().at(-1)).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY");
    await waitState(reel, (s) => s.mediaState === "playing");
    await direct.mediaCommand(reel, "stop");
    expect(triggers().at(-1)).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP");
    await waitState(reel, (s) => s.mediaState === "stopped" && s.mediaCursor === null && s.mediaDuration === null);
    await direct.mediaCommand(reel, "restart");
    expect(triggers().at(-1)).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART");
    await direct.mediaCommand(reel, "previous");
    expect(triggers().at(-1)).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS");
    expect(triggers()).toEqual(["OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT", "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE",
      "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY", "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP",
      "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART", "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS"]);
    expect(server!.directCallLog.every((call) => call.requestData?.inputUuid === reel && !("inputName" in (call.requestData ?? {})))).toBe(true);
    // Every status read (polls, the toggle's and the post-command reads) goes by inputUuid alone too:
    // the fake would answer one by name.
    expect(server!.mediaStatusRequests.length).toBeGreaterThanOrEqual(6);
    for (const data of server!.mediaStatusRequests) expect(data).toEqual({ inputUuid: reel });

    // A held still is PLAYING with duration 0: no time is known. A cursor past the duration is clamped.
    await waitState(reel, (s) => s.mediaState === "playing");
    model(reel).durationMs = 0;
    await waitState(reel, (s) => s.mediaState === "playing" && s.mediaDuration === null && s.mediaCursor === null);
    model(reel).durationMs = 1000;
    model(reel).cursorMs = 5000;
    await waitState(reel, (s) => s.mediaDuration === 1000 && s.mediaCursor === 1000);
    release();
  });

  it("shares one 500 ms poller between two watchers of the same Playlister and stops it after the last unsubscribe, twice", async () => {
    // Both watchers exist before the connection: the poll starts on statusChanged to connected, at once.
    const obs = new FakeObsServer({ missingPlugin: true });
    const reel = obs.addPlaylister("Reel").inputUuid;
    const port = await obs.start();
    const direct = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    server = obs;
    client = direct;
    const first = direct.watchMedia(reel);
    const second = direct.watchMedia(reel);
    expect(state(reel).availability).toBe("disconnected");
    const connected = once(direct, "statusChanged", { signal: AbortSignal.timeout(2000) });
    direct.start();
    await connected;
    await waitUntil(() => expect(reads()).toBe(1));
    expect(state(reel)).toMatchObject({ availability: "ok", mediaState: "stopped" });
    await sleep(700);
    // One immediate read and one 500 ms later; two pollers would have read four times.
    expect(reads()).toBeGreaterThanOrEqual(2);
    expect(reads()).toBeLessThanOrEqual(3);
    first();
    const afterFirst = reads();
    await sleep(600);
    expect(reads()).toBeGreaterThan(afterFirst);
    second();
    second();
    first();
    const afterLast = reads();
    await sleep(700);
    expect(reads()).toBe(afterLast);
    // A new watch polls again.
    const third = direct.watchMedia(reel);
    await waitUntil(() => expect(reads()).toBeGreaterThan(afterLast));
    third();
  });

  it("sends nothing for an unbound, missing, wrong-kind, unsupported or disconnected target", async () => {
    const { client: direct, reel } = await connect();
    const unwatched = direct.watchMedia(reel);
    await waitState(reel, (s) => s.availability === "ok");
    await expect(direct.mediaCommand("", "next")).rejects.toThrow("Choose a Playlister");
    expect(state("").availability).toBe("unbound");
    await expect(direct.mediaCommand("no-such-input", "next")).rejects.toThrow("not in OBS now");
    expect(state("no-such-input").availability).toBe("missing");
    const desktop = direct.getCatalog().inputDetails.find((input) => input.inputName === "Desktop Audio")!.inputUuid;
    await expect(direct.mediaCommand(desktop, "stop")).rejects.toThrow("'Desktop Audio' is not a Playlister source.");
    expect(state(desktop).availability).toBe("wrong_kind");
    // A watch on a non-Playlister never polls.
    const wrong = direct.watchMedia(desktop);
    await sleep(300);
    expect(server!.mediaStatusLog.every((entry) => entry.inputUuid === reel)).toBe(true);
    wrong();
    // Without unversionedInputKind the versioned inputKind decides.
    server!.extraInputs.push({ inputName: "Old", inputUuid: "old-playlister", inputKind: "obs_playlister_source_v2" } as FakeObsInput);
    server!.mediaInputs.set("old-playlister", { ...model(reel) });
    await direct.refreshCatalog();
    expect(state("old-playlister").availability).toBe("ok");
    await direct.mediaCommand("old-playlister", "stop");
    expect(triggers().at(-1)).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP");
    server!.directCallLog.length = 0;

    const limited = await connect({ availableRequests: ["GetInputList", "GetMediaInputStatus"] });
    expect(limited.client.getMediaCapability()).toBe("unsupported");
    await expect(limited.client.mediaCommand(limited.reel, "next")).rejects.toThrow("Update OBS");
    expect(limited.client.getMediaState(limited.reel).availability).toBe("unsupported");
    const unsupportedWatch = limited.client.watchMedia(limited.reel);
    await sleep(200);
    expect(reads(limited.server)).toBe(0);
    unsupportedWatch();

    direct.stop();
    await waitState(reel, (s) => s.availability === "disconnected");
    await expect(direct.mediaCommand(reel, "next")).rejects.toThrow("OBS is not connected.");
    unwatched();
    expect(triggers()).toEqual([]);
    expect(triggers(limited.server)).toEqual([]);
  });

  it("captures availableRequests before the first catalog and marks media unsupported when a request is missing", async () => {
    const obs = new FakeObsServer({ missingPlugin: true });
    obs.addPlaylister("Reel");
    const port = await obs.start();
    const direct = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    server = obs;
    client = direct;
    const seen: string[] = [];
    direct.on("directStateChanged", () => seen.push(direct.getMediaCapability()));
    const connected = once(direct, "statusChanged", { signal: AbortSignal.timeout(2000) });
    direct.start();
    await connected;
    expect(seen[0]).toBe("ok");
    expect(direct.getMediaCapability()).toBe("ok");
    const payloads: Array<Record<string, unknown>> = [];
    new DirectObsPropertyInspectorBridge(direct, {
      sendToPropertyInspector: (payload) => payloads.push(payload), persistGlobalSettings: async () => {}
    }).broadcast();
    expect(payloads.at(-1)).toMatchObject({ event: "directObsState", mediaCapability: "ok" });

    const missing = await connect({ availableRequests: ["GetInputList", "TriggerMediaInputAction"] });
    expect(missing.client.getMediaCapability()).toBe("unsupported");
    // Absent or malformed availableRequests is unsupported too.
    const odd = new FakeObsServer({ missingPlugin: true });
    const native = odd as unknown as { handleObsRequest: Handler; sendResponse: (...args: unknown[]) => void };
    const original = native.handleObsRequest.bind(odd);
    native.handleObsRequest = async (ws, id, type, data) => {
      if (type === "GetVersion") {
        native.sendResponse(ws, id, type, true, 100, "", { obsVersion: "33.0.0", rpcVersion: 1, availableRequests: "GetInputList" });
        return;
      }
      await original(ws, id, type, data);
    };
    const malformed = await connect({}, undefined, odd);
    expect(malformed.client.getMediaCapability()).toBe("unsupported");
    // The capability is forgotten with the connection.
    direct.stop();
    expect(direct.getMediaCapability()).toBe("unknown");
  });

  it("applies no older status reply over a newer one, from a poll or a post-command read", async () => {
    const { client: direct, reel } = await connect();
    const release = direct.watchMedia(reel);
    await waitState(reel, (s) => s.mediaState === "stopped");
    // A poll's reply held back across a collection change is of an old generation: it never lands.
    server!.mediaStatusDelayMs = 300;
    model(reel).state = "OBS_MEDIA_STATE_PLAYING";
    await waitUntil(() => expect(server!.mediaStatusLog.at(-1)?.mediaState).toBe("OBS_MEDIA_STATE_PLAYING"));
    server!.emitObsEvent("CurrentSceneCollectionChanging", {});
    await waitState(reel, (s) => s.availability === "missing" && s.mediaState === "unknown");
    await sleep(450);
    expect(state(reel)).toMatchObject({ availability: "missing", mediaState: "unknown", mediaCursor: null });
    server!.emitObsEvent("CurrentSceneCollectionChanged", {});
    await waitState(reel, (s) => s.availability === "ok" && s.mediaState === "playing");
    // The same for a post-command read: Stop's trailing read is sent (it reads STOPPED), then the
    // collection changes before its reply lands.
    server!.mediaStatusDelayMs = 0;
    await waitState(reel, (s) => s.mediaState === "playing");
    server!.mediaStatusDelayMs = 300;
    await direct.mediaCommand(reel, "stop");
    await waitUntil(() => expect(server!.mediaStatusLog.at(-1)?.mediaState).toBe("OBS_MEDIA_STATE_STOPPED"));
    server!.emitObsEvent("CurrentSceneCollectionChanging", {});
    await waitState(reel, (s) => s.mediaState === "unknown");
    await sleep(450);
    expect(state(reel).mediaState).toBe("unknown");
    server!.mediaStatusDelayMs = 0;
    server!.emitObsEvent("CurrentSceneCollectionChanged", {});
    await waitState(reel, (s) => s.mediaState === "stopped");

    // A reply that lands after the new collection's catalog, with the Playlister back and available,
    // is still of the old generation: only the generation keeps it out.
    server!.mediaStatusDelayMs = 300;
    model(reel).state = "OBS_MEDIA_STATE_PAUSED";
    await waitUntil(() => expect(server!.mediaStatusLog.at(-1)?.mediaState).toBe("OBS_MEDIA_STATE_PAUSED"));
    model(reel).state = "OBS_MEDIA_STATE_STOPPED";
    const seen: string[] = [];
    direct.on("mediaStateChanged", (uuid: string, next: MediaTargetState) => { if (uuid === reel) seen.push(next.mediaState); });
    server!.emitObsEvent("CurrentSceneCollectionChanging", {});
    server!.emitObsEvent("CurrentSceneCollectionChanged", {});
    await waitState(reel, (s) => s.availability === "ok" && s.mediaState === "unknown");
    await sleep(400);
    server!.mediaStatusDelayMs = 0;
    await waitState(reel, (s) => s.mediaState === "stopped");
    expect(seen).not.toContain("paused");
    release();
  });

  it("drops a status reply that lands after InputRemoved and sends no status read for the removed Playlister", async () => {
    const { client: direct, reel } = await connect();
    const release = direct.watchMedia(reel);
    await waitState(reel, (s) => s.mediaState === "stopped");
    const readsOf = (uuid: string): number => server!.mediaStatusRequests.filter((data) => data.inputUuid === uuid).length;
    // A poll read is on the wire (it reads PLAYING with a time) and a Next is in flight when the Playlister leaves OBS.
    server!.mediaStatusDelayMs = 400;
    server!.mediaActionDelayMs = 150;
    model(reel).state = "OBS_MEDIA_STATE_PLAYING";
    await waitUntil(() => expect(server!.mediaStatusLog.at(-1)?.mediaState).toBe("OBS_MEDIA_STATE_PLAYING"));
    const press = direct.mediaCommand(reel, "next");
    await waitUntil(() => expect(server!.mediaActionAttempts).toBe(1));
    const removed = once(direct, "obsEvent", { signal: AbortSignal.timeout(2000) });
    server!.removeInput(reel);
    await removed;
    const gone = { availability: "missing", mediaState: "unknown", mediaCursor: null, mediaDuration: null, pending: "none" };
    expect(state(reel)).toMatchObject(gone);
    const readsAtRemoval = readsOf(reel);
    // The Next was on the wire: it was sent, and its trailing read is not.
    expect(await press).toBe("sent");
    // Both replies have landed by now: the poll's PLAYING does not paint the removed target.
    await sleep(600);
    expect(state(reel)).toMatchObject(gone);
    expect(readsOf(reel)).toBe(readsAtRemoval);
    release();

    // A toggle whose in-queue read waits behind a poll read when its Playlister leaves: quietly cancelled, nothing sent.
    server!.mediaStatusDelayMs = 0;
    server!.mediaActionDelayMs = 0;
    const bumper = server!.addPlaylister("Bumper").inputUuid;
    const releaseBumper = direct.watchMedia(bumper);
    await waitState(bumper, (s) => s.availability === "ok" && s.mediaState === "stopped");
    server!.mediaStatusDelayMs = 400;
    model(bumper).state = "OBS_MEDIA_STATE_PLAYING";
    await waitUntil(() => expect(server!.mediaStatusLog.at(-1)).toEqual({ inputUuid: bumper, mediaState: "OBS_MEDIA_STATE_PLAYING" }));
    const attempts = server!.mediaActionAttempts;
    const toggle = direct.mediaCommand(bumper, "playpause");
    const bumperRemoved = once(direct, "obsEvent", { signal: AbortSignal.timeout(2000) });
    server!.removeInput(bumper);
    await bumperRemoved;
    const bumperReads = readsOf(bumper);
    expect(await toggle).toBe("cancelled");
    await sleep(500);
    expect(server!.mediaActionAttempts).toBe(attempts);
    expect(readsOf(bumper)).toBe(bumperReads);
    expect(state(bumper)).toMatchObject(gone);
    releaseBumper();
  });

  it("cancels a target on InputRemoved by inputUuid, keeps it across a rename, and invalidates every target on a collection change and on disconnect", async () => {
    const obs = new FakeObsServer({ missingPlugin: true });
    const bumper = obs.addPlaylister("Bumper").inputUuid;
    const { client: direct, reel } = await connect({}, undefined, obs);
    const releases = [direct.watchMedia(reel), direct.watchMedia(bumper)];
    await waitState(reel, (s) => s.mediaState === "stopped");
    await waitState(bumper, (s) => s.mediaState === "stopped");

    // A rename keeps the identity and the observation.
    server!.renameInput(reel, "Main reel");
    await waitUntil(() => expect(direct.getCatalog().inputDetails.find((input) => input.inputUuid === reel)?.inputName).toBe("Main reel"));
    expect(state(reel)).toMatchObject({ availability: "ok", mediaState: "stopped" });
    expect(direct.mediaInputName(reel)).toBe("Main reel");

    // Removal is matched by inputUuid even when the name in the event is stale, and lands at once.
    server!.mediaActionDelayMs = 200;
    const presses = [direct.mediaCommand(reel, "next"), direct.mediaCommand(reel, "next"), direct.mediaCommand(reel, "previous")];
    const untouched = direct.mediaCommand(bumper, "next");
    await waitUntil(() => expect(server!.mediaActionAttempts).toBe(2));
    server!.extraInputs.splice(server!.extraInputs.findIndex((input) => input.inputUuid === reel), 1);
    const removed = once(direct, "obsEvent", { signal: AbortSignal.timeout(2000) });
    server!.emitObsEvent("InputRemoved", { inputUuid: reel, inputName: "a stale name" });
    await removed;
    expect(state(reel)).toMatchObject({ availability: "missing", pending: "none", mediaState: "unknown" });
    expect(await Promise.all(presses)).toEqual(["sent", "cancelled", "cancelled"]);
    expect(await untouched).toBe("sent");
    expect(state(bumper).availability).toBe("ok");
    expect(direct.getCatalog().inputDetails.some((input) => input.inputUuid === reel)).toBe(false);
    await waitUntil(() => expect(server!.mediaStatusLog.filter((entry) => entry.inputUuid === bumper).length).toBeGreaterThan(2));
    // The removed one is polled no more (the raw log: the fake answers a removed UUID with 600 and logs no status).
    const reelReads = server!.mediaStatusRequests.filter((data) => data.inputUuid === reel).length;
    await sleep(600);
    expect(server!.mediaStatusRequests.filter((data) => data.inputUuid === reel).length).toBe(reelReads);

    // A collection change voids every target; polls resume after the next catalog.
    server!.mediaActionDelayMs = 300;
    const voided = direct.mediaCommand(bumper, "next");
    const purged = direct.mediaCommand(bumper, "next");
    await waitUntil(() => expect(server!.mediaActionAttempts).toBe(3));
    server!.emitObsEvent("CurrentSceneCollectionChanging", {});
    await waitState(bumper, (s) => s.availability === "missing");
    expect(state(bumper)).toMatchObject({ availability: "missing", queued: 1, mediaState: "unknown" });
    expect(await purged).toBe("cancelled");
    expect(await voided).toBe("sent");
    const bumperReads = server!.mediaStatusLog.filter((entry) => entry.inputUuid === bumper).length;
    await sleep(600);
    expect(server!.mediaStatusLog.filter((entry) => entry.inputUuid === bumper).length).toBe(bumperReads);
    server!.emitObsEvent("CurrentSceneCollectionChanged", {});
    await waitState(bumper, (s) => s.availability === "ok" && s.mediaState === "playing");
    // Disconnect too.
    direct.stop();
    expect(state(bumper)).toMatchObject({ availability: "disconnected", mediaState: "unknown", queued: 0 });
    for (const release of releases) release();
  });

  it("rejects the fifth press as busy without a request, and Stop drops that Playlister's unsent presses first", async () => {
    const { client: direct, reel } = await connect({ mediaActionDelayMs: 150 });
    const release = direct.watchMedia(reel);
    await waitState(reel, (s) => s.availability === "ok");
    const presses = [direct.mediaCommand(reel, "next"), direct.mediaCommand(reel, "next"),
      direct.mediaCommand(reel, "previous"), direct.mediaCommand(reel, "next")];
    expect(state(reel).queued).toBe(4);
    await waitUntil(() => expect(server!.mediaActionAttempts).toBe(1));
    await expect(direct.mediaCommand(reel, "next")).rejects.toThrow("busy");
    expect(server!.mediaActionAttempts).toBe(1);
    expect(state(reel).queued).toBe(4);
    const stop = direct.mediaCommand(reel, "stop");
    expect(state(reel).queued).toBe(2);
    expect(await Promise.all(presses)).toEqual(["sent", "cancelled", "cancelled", "cancelled"]);
    expect(await stop).toBe("sent");
    expect(triggers()).toEqual(["OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT", "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP"]);
    expect(server!.mediaActionAttempts).toBe(2);
    await waitState(reel, (s) => s.queued === 0);
    release();
  });

  it("toggles PLAYING to PAUSE and PAUSED, STOPPED, ENDED and NONE to PLAY, refuses a toggle in ERROR, keeps a pending intent through OPENING", async () => {
    const { client: direct, reel } = await connect();
    const release = direct.watchMedia(reel);
    await waitState(reel, (s) => s.availability === "ok");
    const toggleFrom = async (from: FakeMediaState): Promise<string> => {
      model(reel).state = from;
      await direct.mediaCommand(reel, "playpause");
      const action = triggers().at(-1)!;
      // The fake applies the action, so the trailing read settles the intent.
      await waitState(reel, (s) => s.pending === "none");
      return action;
    };
    expect(await toggleFrom("OBS_MEDIA_STATE_PLAYING")).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE");
    expect(await toggleFrom("OBS_MEDIA_STATE_PAUSED")).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY");
    expect(await toggleFrom("OBS_MEDIA_STATE_STOPPED")).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY");
    expect(await toggleFrom("OBS_MEDIA_STATE_ENDED")).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY");
    model(reel).items = 0;
    expect(await toggleFrom("OBS_MEDIA_STATE_NONE")).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY");
    model(reel).items = 3;
    const sent = triggers().length;
    model(reel).state = "OBS_MEDIA_STATE_ERROR";
    await expect(direct.mediaCommand(reel, "playpause")).rejects.toThrow("unclear");
    model(reel).state = "OBS_MEDIA_STATE_OPENING";
    await expect(direct.mediaCommand(reel, "playpause")).rejects.toThrow("opening media");
    await waitState(reel, (s) => s.mediaState === "opening");
    expect(triggers()).toHaveLength(sent);
    // Stop stays available from ERROR.
    model(reel).state = "OBS_MEDIA_STATE_ERROR";
    await direct.mediaCommand(reel, "stop");
    expect(triggers().at(-1)).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP");

    // A second toggle while the first is queued is rejected as pending, never queued as a reverse toggle.
    server!.mediaStatusDelayMs = 200;
    model(reel).state = "OBS_MEDIA_STATE_PLAYING";
    const first = direct.mediaCommand(reel, "playpause");
    await expect(direct.mediaCommand(reel, "playpause")).rejects.toThrow("still pending");
    expect(await first).toBe("sent");
    expect(triggers().at(-1)).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE");
    server!.mediaStatusDelayMs = 0;
    await waitState(reel, (s) => s.pending === "none" && s.mediaState === "paused");

    // OPENING after a sent PAUSE keeps the intent; PAUSED settles it.
    model(reel).state = "OBS_MEDIA_STATE_PLAYING";
    afterAction(server!, "pause", () => { model(reel).state = "OBS_MEDIA_STATE_OPENING"; });
    await direct.mediaCommand(reel, "playpause");
    await waitState(reel, (s) => s.mediaState === "opening");
    await sleep(600);
    expect(state(reel)).toMatchObject({ mediaState: "opening", pending: "pause" });
    model(reel).state = "OBS_MEDIA_STATE_PAUSED";
    await waitState(reel, (s) => s.mediaState === "paused" && s.pending === "none");

    // NONE inside the held window of a load of ours is not the pause's outcome either.
    afterAction(server!, "pause", () => { model(reel).state = "OBS_MEDIA_STATE_NONE"; });
    await direct.mediaCommand(reel, "next");
    await waitState(reel, (s) => s.mediaState === "playing");
    await direct.mediaCommand(reel, "playpause");
    await waitState(reel, (s) => s.mediaState === "none");
    await sleep(600);
    expect(state(reel)).toMatchObject({ mediaState: "none", pending: "pause" });
    model(reel).state = "OBS_MEDIA_STATE_PAUSED";
    await waitState(reel, (s) => s.mediaState === "paused" && s.pending === "none");
    release();
  });

  it("releases PLAY after the post-command read, holds PAUSE up to 20 s, then shows unconfirmed rather than failure", async () => {
    const { client: direct, reel } = await connect({ mediaStatusDelayMs: 100 }, { mediaPauseWaitMs: 400 });
    const release = direct.watchMedia(reel);
    await waitState(reel, (s) => s.mediaState === "stopped");
    const pendings: string[] = [];
    direct.on("mediaStateChanged", (_uuid: string, next: MediaTargetState) => pendings.push(next.pending));
    expect(await direct.mediaCommand(reel, "playpause")).toBe("sent");
    expect(state(reel).pending).toBe("play");
    await waitState(reel, (s) => s.pending === "none" && s.mediaState === "playing");
    expect(pendings).toContain("play");

    // The fake keeps reporting PLAYING after the PAUSE: the intent waits, then shows unconfirmed, never an error.
    afterAction(server!, "pause", () => { model(reel).state = "OBS_MEDIA_STATE_PLAYING"; });
    expect(await direct.mediaCommand(reel, "playpause")).toBe("sent");
    expect(state(reel).pending).toBe("pause");
    await sleep(250);
    expect(state(reel)).toMatchObject({ pending: "pause", mediaState: "playing" });
    await waitState(reel, (s) => s.pending === "unconfirmed");
    expect(state(reel).mediaState).toBe("playing");
    // The next observed change clears it.
    model(reel).state = "OBS_MEDIA_STATE_PAUSED";
    await waitState(reel, (s) => s.pending === "none" && s.mediaState === "paused");
    // An explicit command clears a pending PAUSE at once.
    model(reel).state = "OBS_MEDIA_STATE_PLAYING";
    await direct.mediaCommand(reel, "playpause");
    expect(state(reel).pending).toBe("pause");
    await direct.mediaCommand(reel, "restart");
    expect(state(reel).pending).toBe("none");
    release();
  });

  it("never retries Next or Previous and never merges two accepted presses", async () => {
    const { client: direct, reel } = await connect();
    const release = direct.watchMedia(reel);
    await waitState(reel, (s) => s.availability === "ok");
    server!.mediaFailNext = "Playlister refused.";
    await expect(direct.mediaCommand(reel, "next")).rejects.toThrow("Playlister refused.");
    expect(server!.mediaActionAttempts).toBe(1);
    await sleep(100);
    expect(server!.mediaActionAttempts).toBe(1);
    expect(triggers()).toEqual([]);
    server!.mediaFailNext = "Playlister refused.";
    await expect(direct.mediaCommand(reel, "previous")).rejects.toThrow("Playlister refused.");
    expect(server!.mediaActionAttempts).toBe(2);
    const presses = [direct.mediaCommand(reel, "next"), direct.mediaCommand(reel, "next"), direct.mediaCommand(reel, "previous")];
    expect(await Promise.all(presses)).toEqual(["sent", "sent", "sent"]);
    expect(triggers()).toEqual(["OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT", "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT",
      "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS"]);
    expect(server!.mediaActionAttempts).toBe(5);
    release();
  });

  it("does not repaint a retargeted watcher from a late reply", async () => {
    const { client: direct, reel } = await connect();
    const events: Array<[string, MediaTargetState]> = [];
    direct.on("mediaStateChanged", (uuid: string, next: MediaTargetState) => events.push([uuid, next]));
    // A late poll reply after the watch was released paints nothing.
    const release = direct.watchMedia(reel);
    await waitState(reel, (s) => s.mediaState === "stopped");
    server!.mediaStatusDelayMs = 300;
    model(reel).state = "OBS_MEDIA_STATE_PLAYING";
    await waitUntil(() => expect(server!.mediaStatusLog.at(-1)?.mediaState).toBe("OBS_MEDIA_STATE_PLAYING"));
    release();
    const count = events.length;
    await sleep(450);
    expect(events.length).toBe(count);
    expect(state(reel).mediaState).toBe("unknown");
    server!.mediaStatusDelayMs = 0;

    // A command's target that lost its last watcher is never polled on the next catalog publication.
    server!.mediaActionDelayMs = 300;
    const watched = direct.watchMedia(reel);
    await waitState(reel, (s) => s.mediaState === "playing");
    const pressed = direct.mediaCommand(reel, "next");
    watched();
    // Let a poll that was on the wire settle before counting.
    await sleep(50);
    const before = reads();
    await direct.refreshCatalog();
    expect(await pressed).toBe("sent");
    await sleep(700);
    // Only the press's own trailing read.
    expect(reads() - before).toBeLessThanOrEqual(1);
  });
});
