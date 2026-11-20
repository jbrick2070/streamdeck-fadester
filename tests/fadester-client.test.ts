// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect, afterEach } from "vitest";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";
import { MIDI_FADESTER_RELEASE_URL } from "../src/types/contract.js";
import { statusCellReason, statusSentence } from "../packages/streamdeck-fadester-shared/src/status-text.js";

function waitForEvent<T>(
  emitter: { once(ev: string, fn: (arg: T) => void): unknown },
  event: string,
  timeoutMs = 2000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for event '${event}'`)),
      timeoutMs
    );
    emitter.once(event, (val: T) => {
      clearTimeout(timer);
      resolve(val);
    });
  });
}

async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("Step 1.2 — FadesterClient & FadesterStore against FakeObsServer", () => {
  let server: FakeObsServer | null = null;
  let client: FadesterClient | null = null;

  afterEach(async () => {
    if (client) {
      client.stop();
      client = null;
    }
    if (server) {
      await server.stop();
      server = null;
    }
  });

  // A-02 / D-06: `null` parses as JSON, and reading a field of it threw outside the try, out of the socket's listener.
  it("ignores frames that are valid JSON but not a message, and goes on working", async () => {
    server = new FakeObsServer({ obsVersion: "33.0.0", fadesterVersion: "0.1.0" });
    const port = await server.start();
    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const statusPromise = waitForEvent(client, "statusChanged");
    client.start();
    await statusPromise;
    await waitUntil(() => client!.isConnected());

    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown): void => { uncaught.push(error); };
    process.on("uncaughtException", onUncaught);
    try {
      for (const frame of ["null", "null", "7", "\"text\"", "true", "[]", "[{\"op\":5}]", "{\"op\":5,\"d\":null}",
        "{\"op\":5,\"d\":7}", "{\"op\":7,\"d\":[1]}", "{\"op\":0,\"d\":\"x\"}", "not json"]) {
        server.sendRawFrame(frame);
      }
      // The frames above are read before this request's answer, on the same socket.
      const state = await client.getState();
      expect(Array.isArray(state.slots)).toBe(true);
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      process.off("uncaughtException", onUncaught);
    }
    expect(uncaught).toEqual([]);
    expect(client.isConnected()).toBe(true);
  });

  it("connects without password and populates Connected status + initial slots", async () => {
    server = new FakeObsServer({ obsVersion: "33.0.0", fadesterVersion: "0.1.0" });
    const port = await server.start();

    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(client);

    const statusPromise = waitForEvent(client, "statusChanged");
    client.start();
    await statusPromise;

    await new Promise((r) => setTimeout(r, 40));
    expect(store.getStatus().kind).toBe("connected");
    expect(statusSentence(store.getStatus())).toBe(
      "Connected: OBS 33.0.0, Midi Fadester 0.1.0"
    );
    expect(store.getSlots().length).toBeGreaterThanOrEqual(5);
    expect(store.getSlot("crossfader")?.target_mode).toBe("tbar");
  });

  it("authenticates with SHA-256 challenge-response when password is set", async () => {
    server = new FakeObsServer({ password: "correct-horse-battery" });
    const port = await server.start();

    client = new FadesterClient({
      host: "127.0.0.1",
      port,
      password: "correct-horse-battery"
    });
    const statusPromise = waitForEvent(client, "statusChanged");
    client.start();
    await statusPromise;

    expect(client.getStatus().kind).toBe("connected");
    expect(client.isConnected()).toBe(true);
  });

  it("stops retrying on close 4009 (wrong password) and shows the exact status sentence", async () => {
    server = new FakeObsServer({ password: "secret-password" });
    const port = await server.start();

    client = new FadesterClient(
      { host: "127.0.0.1", port, password: "wrong-password" },
      { baseReconnectMs: 30, maxReconnectMs: 60 }
    );
    const statusPromise = waitForEvent(client, "statusChanged");
    client.start();
    await statusPromise;

    expect(client.getStatus().kind).toBe("wrong_password");
    // The sentence says the sign-in is tried again, and how often (30 s unless set otherwise).
    expect(statusSentence(client.getStatus())).toBe(
      "Wrong password. In OBS: Tools > WebSocket Server Settings > Show Connect Info. Trying again every 30 seconds."
    );

    // Not with the normal backoff (30..60 ms here): OBS logs every refused sign-in.
    const attemptsAfterAuthFail = client.getConnectAttemptCount();
    await new Promise((r) => setTimeout(r, 150));
    expect(client.getConnectAttemptCount()).toBe(attemptsAfterAuthFail);
    // A key press does not retry a refused password either.
    expect(client.nudgeReconnect(0)).toBe(false);
    expect(client.getConnectAttemptCount()).toBe(attemptsAfterAuthFail);
  });

  it("after a refused password it keeps trying slowly, and signs in once OBS's saved password is right", async () => {
    server = new FakeObsServer({ password: "new-in-obs" });
    const port = await server.start();
    let saved = "old";
    client = new FadesterClient(
      { host: "127.0.0.1", port, password: "" },
      { baseReconnectMs: 20, maxReconnectMs: 40, wrongPasswordRetryMs: 120, readSavedPassword: () => saved }
    );
    const kinds: string[] = [];
    client.on("statusChanged", (status: { kind: string }) => kinds.push(status.kind));
    client.start();
    await waitUntil(() => client!.getStatus().kind === "wrong_password");
    const first = client.getConnectAttemptCount();
    // Two more refusals, one per slow interval; the status stays "wrong password" throughout (no flicker).
    await waitUntil(() => client!.getConnectAttemptCount() >= first + 2, 3000);
    expect(client.getStatus().kind).toBe("wrong_password");
    expect(kinds.filter((kind) => kind !== "wrong_password")).toEqual([]);
    // OBS's saved password is read again for each attempt.
    saved = "new-in-obs";
    await waitUntil(() => client!.getStatus().kind === "connected", 3000);
  });

  it("with no retry interval a refused password is never tried again by itself", async () => {
    server = new FakeObsServer({ password: "secret-password" });
    const port = await server.start();
    client = new FadesterClient({ host: "127.0.0.1", port, password: "x" }, { baseReconnectMs: 20, maxReconnectMs: 40, wrongPasswordRetryMs: 0 });
    client.start();
    await waitUntil(() => client!.getStatus().kind === "wrong_password");
    expect(statusSentence(client.getStatus())).toBe("Wrong password. In OBS: Tools > WebSocket Server Settings > Show Connect Info.");
    const attempts = client.getConnectAttemptCount();
    await new Promise((r) => setTimeout(r, 150));
    expect(client.getConnectAttemptCount()).toBe(attempts);
  });

  it("names the missing step when OBS's own saved settings say which it is", async () => {
    server = new FakeObsServer();
    const port = await server.start();
    await server.stop();
    let enabled: boolean | null = false;
    client = new FadesterClient(
      { host: "127.0.0.1", port, password: "" },
      { baseReconnectMs: 20, maxReconnectMs: 40, readSavedServer: () => ({ port, enabled }) }
    );
    client.start();
    await waitUntil(() => client!.getStatus().unreachableReason === "websocket_off");
    expect(statusSentence(client.getStatus())).toBe(
      "OBS's WebSocket server is off. In OBS: Tools > WebSocket Server Settings > Enable WebSocket server."
    );
    expect(statusCellReason(client.getStatus())).toBe("Turn on OBS WebSocket");
    // The tick was set in OBS, and still nothing answers: OBS is not running.
    enabled = true;
    await waitUntil(() => client!.getStatus().unreachableReason === "obs_not_running");
    expect(statusSentence(client.getStatus())).toBe("OBS does not answer. Start OBS.");
    expect(statusCellReason(client.getStatus())).toBe("Start OBS");
    // Nothing known (no file): the sentence that names both.
    enabled = null;
    await waitUntil(() => client!.getStatus().unreachableReason === undefined);
    expect(statusCellReason(client.getStatus())).toBe("OBS not connected");
  });

  it("follows OBS's own saved port when the configured one does not answer and no password is typed", async () => {
    server = new FakeObsServer({ password: "obs-saved" });
    const obsPort = await server.start();
    const closed = new FakeObsServer();
    const configured = await closed.start();
    await closed.stop();
    const asked: number[] = [];
    client = new FadesterClient(
      { host: "127.0.0.1", port: configured, password: "" },
      {
        baseReconnectMs: 20,
        maxReconnectMs: 40,
        readSavedServer: () => ({ port: obsPort, enabled: true }),
        readSavedPassword: (_host, port) => { asked.push(port); return port === obsPort ? "obs-saved" : ""; }
      }
    );
    client.start();
    await waitUntil(() => client!.getStatus().kind === "connected", 3000);
    expect(client.getActivePort()).toBe(obsPort);
    expect(client.getSettings().port).toBe(configured); // what the user set is not rewritten
    expect(asked).toEqual([obsPort]);
    // A typed password means "this OBS, this port": nothing is followed.
    client.stop();
    client = new FadesterClient(
      { host: "127.0.0.1", port: configured, password: "typed" },
      { baseReconnectMs: 20, maxReconnectMs: 40, readSavedServer: () => ({ port: obsPort, enabled: true }) }
    );
    client.start();
    await new Promise((r) => setTimeout(r, 200));
    expect(client.getStatus().kind).toBe("obs_unreachable");
    expect(client.getActivePort()).toBe(configured);
  });

  it("a reconnect to another address is not 'connected' until that address has answered (A-03)", async () => {
    server = new FakeObsServer();
    const port = await server.start();
    client = new FadesterClient({ host: "127.0.0.1", port, password: "" }, { baseReconnectMs: 20, maxReconnectMs: 40 });
    client.start();
    await waitUntil(() => client!.getStatus().kind === "connected");
    const closed = new FakeObsServer();
    const dead = await closed.start();
    await closed.stop();
    const kinds: string[] = [];
    client.on("statusChanged", (status: { kind: string }) => kinds.push(status.kind));
    client.updateSettings({ host: "127.0.0.1", port: dead, password: "" });
    expect(client.getStatus().kind).toBe("obs_unreachable");
    expect(kinds).toEqual(["obs_unreachable"]);
    client.updateSettings({ host: "127.0.0.1", port, password: "" });
    await waitUntil(() => client!.getStatus().kind === "connected");
  });

  it("detects missing Midi Fadester plugin (code 600) and includes the release link", async () => {
    server = new FakeObsServer({ missingPlugin: true });
    const port = await server.start();

    client = new FadesterClient(
      { host: "127.0.0.1", port, password: "" },
      { baseReconnectMs: 30 }
    );
    const statusPromise = waitForEvent(client, "statusChanged");
    client.start();
    await statusPromise;

    expect(client.getStatus().kind).toBe("missing_plugin");
    expect(statusSentence(client.getStatus())).toBe(
      "Midi Fadester is not installed in OBS"
    );
    expect(client.getStatus().linkUrl).toBe(MIDI_FADESTER_RELEASE_URL);
  });

  it("waits out OBS still loading (NotReady 207) on the same socket, connects, and never reports a missing plugin", async () => {
    const fake = new FakeObsServer();
    server = fake;
    fake.notReady = true;
    const port = await fake.start();
    const c = new FadesterClient(
      { host: "127.0.0.1", port, password: "" },
      { baseReconnectMs: 30, notReadyRetryMs: 20 }
    );
    client = c;
    const kinds: string[] = [];
    c.on("statusChanged", (status: { kind: string }) => kinds.push(status.kind));
    c.start();
    await waitUntil(() => fake.notReadyRejections >= 2);
    expect(c.getStatus().kind).not.toBe("connected");
    const attempts = c.getConnectAttemptCount();
    fake.notReady = false;
    await waitUntil(() => c.getStatus().kind === "connected");
    expect(kinds).not.toContain("missing_plugin");
    expect(c.getConnectAttemptCount()).toBe(attempts);
  });

  it("drops a connection whose first request goes unanswered, and connects again by itself", async () => {
    const fake = new FakeObsServer();
    server = fake;
    type Handler = (ws: unknown, id: string, type: string, data: Record<string, unknown>) => Promise<void>;
    const native = fake as unknown as { handleObsRequest: Handler };
    const original = native.handleObsRequest.bind(fake);
    let stalled = false;
    native.handleObsRequest = async (ws, id, type, data) => {
      if (!stalled && type === "GetVersion") {
        stalled = true; // a stalled OBS: no answer at all, and the socket stays open
        return;
      }
      await original(ws, id, type, data);
    };
    const port = await fake.start();
    const c = new FadesterClient(
      { host: "127.0.0.1", port, password: "" },
      { requestTimeoutMs: 150, baseReconnectMs: 30 }
    );
    client = c;
    c.start();
    // No key press: the client drops the half-open connection and reconnects with backoff.
    await waitUntil(() => c.getStatus().kind === "connected", 3000);
    expect(c.getConnectAttemptCount()).toBe(2);
  });

  it("reports OBS unreachable and reconnects automatically with backoff when OBS starts", async () => {
    server = new FakeObsServer();
    const port = await server.start();
    await server.stop();

    client = new FadesterClient(
      { host: "127.0.0.1", port, password: "" },
      { baseReconnectMs: 40, maxReconnectMs: 120 }
    );
    client.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(client.getStatus().kind).toBe("obs_unreachable");
    expect(statusSentence(client.getStatus())).toBe(
      "OBS is not running, or its WebSocket server is off. In OBS: Tools > WebSocket Server Settings > Enable WebSocket server."
    );

    const connectedPromise = waitForEvent(client, "statusChanged");
    await server.start(port);
    await connectedPromise;
    expect(client.getStatus().kind).toBe("connected");
  });

  it("executes all 8 contract requests and propagates 0.4 FX state and OBS-origin values", async () => {
    server = new FakeObsServer();
    const port = await server.start();

    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(client);
    const connectedPromise = waitForEvent(client, "statusChanged");
    client.start();
    await connectedPromise;

    // 1. get_state
    const state = await client.getState();
    expect(state.version).toBe("0.4.0");
    expect(state.profile).toBe("apc40mk2");
    expect(state.profile_tier).toBe("verified");
    expect(state.slots).toHaveLength(18);
    expect(state.slots.find((slot) => slot.id === "fx_1")).toMatchObject({
      kind: "fx",
      target_mode: "filter_param",
      display_value: "14.1 px"
    });

    // 2. set_fader_value (with release: true)
    const setRes = await client.setFaderValue({
      slot: "crossfader",
      value: 0.5,
      release: true
    });
    expect(setRes).toEqual({ slot: "crossfader", value: 0 });
    expect(server.tbarCompletionCount).toBe(1);

    // 3. nudge_fader
    const nudgeRes = await client.nudgeFader({
      slot: "crossfader",
      delta: 0.1
    });
    expect(nudgeRes).toEqual({ slot: "crossfader", value: 0.1 });

    // 4. auto_fade
    const fadeRes = await client.autoFade({
      slot: "fader_1",
      to: 1.0,
      ms: 1500
    });
    expect(fadeRes).toEqual({ slot: "fader_1" });

    // 5. set_slot
    const slotRes = await client.setSlot({
      slot: "fader_2",
      target_mode: "layer_opacity",
      source_a: "Cam 1",
      curve: "equal_power",
      afv: true
    });
    expect(slotRes.source_a).toBe("Cam 1");
    expect(slotRes.afv).toBe(true);

    // 6. load_profile
    const profRes = await client.loadProfile({ name: "apc40mk2" });
    expect(profRes).toEqual({ loaded: "apc40mk2", profile_tier: "verified" });

    // 7. get_catalog
    const catalog = await client.getCatalog();
    expect(catalog).toMatchObject({
      scenes: expect.any(Array),
      audio_sources: expect.any(Array),
      filter_hosts: expect.any(Array)
    });

    // 8. Profile reset cleared all filter assignments, so nothing is eligible.
    const resetRes = await client.resetFx({ ms: 0 });
    expect(resetRes).toEqual({
      eligible_count: 0,
      reset_count: 0,
      queued_unavailable_count: 0,
      ms: 0
    });
    expect(
      server.slots
        .filter((slot) => slot.kind === "fx")
        .every((slot) => slot.target_mode === "unassigned")
    ).toBe(true);

    // External fader_changed event from MIDI clears takeover_pending and updates value
    const slotUpdatePromise = waitForEvent<string>(store, "slotValueChanged");
    server.emitVendorEvent("fader_changed", {
      slot: "fader_1",
      value: 0.88,
      origin: "midi"
    });
    const updatedSlotId = await slotUpdatePromise;
    expect(updatedSlotId).toBe("fader_1");
    expect(store.getSlot("fader_1")?.value).toBe(0.88);

    // OBS Filter UI updates retain the formatted readout and origin instead of being
    // mistaken for API or MIDI movement.
    const obsSlotUpdatePromise = waitForEvent<string>(store, "slotValueChanged");
    const obsFaderChangedPromise = waitForEvent<{
      slot: string;
      value: number;
      display_value?: string;
      origin: string;
    }>(client, "faderChanged");
    server.emitVendorEvent("fader_changed", {
      slot: "fx_1",
      value: 0.5,
      display_value: "16.0 px",
      origin: "obs"
    });
    expect(await obsSlotUpdatePromise).toBe("fx_1");
    await expect(obsFaderChangedPromise).resolves.toMatchObject({
      slot: "fx_1",
      value: 0.5,
      display_value: "16.0 px",
      origin: "obs"
    });
    expect(store.getSlot("fx_1")).toMatchObject({
      value: 0.5,
      display_value: "16.0 px"
    });
  });

  it("surfaces vendor validation error comment and calls get_state after any error", async () => {
    server = new FakeObsServer();
    const port = await server.start();

    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(client);
    const connectedPromise = waitForEvent(client, "statusChanged");
    client.start();
    await connectedPromise;
    await new Promise((r) => setTimeout(r, 30));

    const getStateCallsBefore = server.vendorCallLog.filter(
      (c) => c.requestType === "get_state"
    ).length;

    await expect(
      client.setFaderValue({ slot: "fader_9", value: 0.5 })
    ).rejects.toThrow(
      "Slot 'fader_9' does not exist. Valid slots: crossfader, fader_1 .. fader_8, master, fx_1 .. fx_8."
    );

    await new Promise((r) => setTimeout(r, 30));
    const getStateCallsAfter = server.vendorCallLog.filter(
      (c) => c.requestType === "get_state"
    ).length;

    expect(store.getLastErrorComment()).toContain("Slot 'fader_9' does not exist");
    expect(getStateCallsAfter).toBeGreaterThan(getStateCallsBefore);
  });

  it("handles 0.3.0 build commit in status sentence and controller profiles without crossfader or master", async () => {
    server = new FakeObsServer({
      obsVersion: "33.0.0",
      fadesterVersion: "0.3.0",
      buildCommit: "642d6b7"
    });
    const port = await server.start();

    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(client);
    const connectedPromise = waitForEvent(client, "statusChanged");
    client.start();
    await connectedPromise;
    await new Promise((r) => setTimeout(r, 30));

    expect(statusSentence(store.getStatus())).toBe(
      "Connected: OBS 33.0.0, Midi Fadester 0.3.0 (642d6b7)"
    );
    expect(store.getProfile()).toBe("apc40mk2");
    expect(store.getProfileTier()).toBe("verified");
    expect(store.getSlots()).toHaveLength(10);
    expect(store.getSlots().some((slot) => slot.kind === "fx")).toBe(false);

    // Switch to midimix (no crossfader, master present)
    const midimixChanged = waitForEvent<void>(store, "changed");
    const midimixRes = await client.loadProfile({ name: "midimix" });
    await midimixChanged;
    expect(midimixRes).toEqual({ loaded: "midimix", profile_tier: "beta" });
    expect(store.getProfile()).toBe("midimix");
    expect(store.getProfileTier()).toBe("beta");
    expect(store.getSlot("crossfader")?.available).toBe(false);
    expect(store.getSlot("crossfader")?.reason).toBe(
      "Not used. Click to set up."
    );
    expect(store.getSlot("master")).toMatchObject({ available: false, enabled: true, target_mode: "unassigned" });

    // Switch to nanokontrol2 (no crossfader AND no master)
    const nanoChanged = waitForEvent<void>(store, "changed");
    const nanoRes = await client.loadProfile({ name: "nanokontrol2" });
    await nanoChanged;
    expect(nanoRes).toEqual({ loaded: "nanokontrol2", profile_tier: "beta" });
    expect(store.getProfile()).toBe("nanokontrol2");
    expect(store.getSlot("crossfader")?.available).toBe(false);
    expect(store.getSlot("crossfader")?.label).toBe("Disabled");
    expect(store.getSlot("crossfader")?.reason).toBe(
      "Not used. Click to set up."
    );
    expect(store.getSlot("master")?.available).toBe(false);
    expect(store.getSlot("master")?.label).toBe("Disabled");
    expect(store.getSlot("master")?.reason).toBe(
      "Not used. Click to set up."
    );
  });
});
