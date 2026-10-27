// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect, afterEach } from "vitest";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";
import { MIDI_FADESTER_RELEASE_URL } from "../src/types/contract.js";

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
    expect(store.getStatus().sentence).toBe(
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
    expect(client.getStatus().sentence).toBe(
      "Wrong password. Check OBS Tools > WebSocket Server Settings > Show Connect Info."
    );

    const attemptsAfterAuthFail = client.getConnectAttemptCount();
    await new Promise((r) => setTimeout(r, 150));
    expect(client.getConnectAttemptCount()).toBe(attemptsAfterAuthFail);
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
    expect(client.getStatus().sentence).toBe(
      "Midi Fadester is not installed in OBS"
    );
    expect(client.getStatus().linkUrl).toBe(MIDI_FADESTER_RELEASE_URL);
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
    expect(client.getStatus().sentence).toBe(
      "OBS is not running or the websocket is off (Tools > WebSocket Server Settings)"
    );

    const connectedPromise = waitForEvent(client, "statusChanged");
    await server.start(port);
    await connectedPromise;
    expect(client.getStatus().kind).toBe("connected");
  });

  it("executes all 6 contract requests and updates state on fader_changed and state_changed", async () => {
    server = new FakeObsServer();
    const port = await server.start();

    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(client);
    const connectedPromise = waitForEvent(client, "statusChanged");
    client.start();
    await connectedPromise;

    // 1. get_state
    const state = await client.getState();
    expect(state.version).toBe("0.1.0");

    // 2. set_fader_value (with release: true)
    const setRes = await client.setFaderValue({
      slot: "crossfader",
      value: 0.5,
      release: true
    });
    expect(setRes).toEqual({ slot: "crossfader", value: 0.5 });

    // 3. nudge_fader
    const nudgeRes = await client.nudgeFader({
      slot: "crossfader",
      delta: 0.1
    });
    expect(nudgeRes).toEqual({ slot: "crossfader", value: 0.6 });

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
    expect(profRes).toEqual({ loaded: true });

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
      "Slot 'fader_9' does not exist. Valid slots: crossfader, fader_1 .. fader_8, master."
    );

    await new Promise((r) => setTimeout(r, 30));
    const getStateCallsAfter = server.vendorCallLog.filter(
      (c) => c.requestType === "get_state"
    ).length;

    expect(store.getLastErrorComment()).toContain("Slot 'fader_9' does not exist");
    expect(getStateCallsAfter).toBeGreaterThan(getStateCallsBefore);
  });
});
