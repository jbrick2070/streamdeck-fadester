// SPDX-License-Identifier: GPL-2.0-or-later
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import { FaderDialInstanceController } from "../src/actions/fader-dial.js";
import { AutoFadeKeyInstanceController } from "../src/actions/auto-fade-key.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

describe("Actions against provider rail, clean, and profile semantics", () => {
  let server: FakeObsServer;
  let client: FadesterClient;

  async function connect(): Promise<FadesterStore> {
    const port = await server.start();
    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(client);
    const stateReady = once(client, "stateChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await stateReady;
    return store;
  }

  afterEach(async () => {
    client?.stop();
    await server?.stop();
  });

  it.each(["clean_0", "snap_0_100", "cut", "touch", "key"] as const)(
    "%s returns a partial T-bar to zero without completing it, even outside the crossfader slot",
    async (gesture) => {
      server = new FakeObsServer();
      Object.assign(server.slots.find((slot) => slot.id === "fader_7")!, {
        target_mode: "tbar", available: true, enabled: true, value: 0.75, parked: false
      });
      const store = await connect();
      let alerts = 0;
      if (gesture === "key") {
        const key = new AutoFadeKeyInstanceController(store, {
          setImage: async () => {}, showAlert: async () => { alerts++; }
        }, { slot: "fader_7", to: 0, durationMs: 0 });
        await key.handleKeyDown();
      } else {
        const dial = new FaderDialInstanceController(store, {
          setFeedback: async () => {}, showAlert: async () => { alerts++; }
        }, {
          slot: "fader_7", longPressAction: "none",
          pressAction: gesture === "touch" ? "clean_0" : gesture
        });
        if (gesture === "touch") await dial.handleTouchTap(10, 75);
        else await dial.handleDialUp();
      }
      const state = await client.getState();
      expect(state.slots.find((slot) => slot.id === "fader_7")).toMatchObject({
        value: 0, parked: false
      });
      expect(server.tbarAbortCount).toBe(1);
      expect(server.tbarCompletionCount).toBe(0);
      expect(alerts).toBe(0);
      expect(server.vendorCallLog.find((call) => call.requestType === "set_fader_value")?.requestData)
        .toEqual({ slot: "fader_7", value: 0, release: false });
    }
  );

  it("models explicit release as finish at logical zero, parked repeats as no-ops, and zero as abort/unpark", async () => {
    server = new FakeObsServer();
    await connect();
    await client.setFaderValue({ slot: "crossfader", value: 0.6 });
    // This intentionally unsafe request proves the fake catches the real bug.
    await expect(client.setFaderValue({ slot: "crossfader", value: 0, release: true }))
      .resolves.toEqual({ slot: "crossfader", value: 0 });
    expect(server.tbarCompletionCount).toBe(1);
    expect(server.slots[0].parked).toBe(true);
    const completedEvents = server.faderChangedCount;
    await client.setFaderValue({ slot: "crossfader", value: 1, release: true });
    expect(server.tbarCompletionCount).toBe(1);
    expect(server.faderChangedCount).toBe(completedEvents);
    await client.setFaderValue({ slot: "crossfader", value: 0, release: false });
    expect(server.slots[0].parked).toBe(false);
    expect(server.tbarAbortCount).toBe(0);
    const idleEvents = server.faderChangedCount;
    await client.setFaderValue({ slot: "crossfader", value: 0, release: false });
    expect(server.faderChangedCount).toBe(idleEvents);
    await client.setFaderValue({ slot: "crossfader", value: 0.4 });
    await client.setFaderValue({ slot: "crossfader", value: 0, release: false });
    expect(server.tbarAbortCount).toBe(1);
    expect(server.tbarCompletionCount).toBe(1);
  });

  it.each([0, 400])("reset_fx(%s) cleans enabled filters in either bank and queues unavailable filters only", async (ms) => {
    server = new FakeObsServer();
    for (const slot of server.slots) slot.target_mode = "unassigned";
    Object.assign(server.slots.find((slot) => slot.id === "fader_1")!, {
      target_mode: "filter_param", enabled: true, available: true, value: 0.4
    });
    Object.assign(server.slots.find((slot) => slot.id === "fx_1")!, {
      target_mode: "audio_volume", enabled: true, available: true, value: 0.65
    });
    Object.assign(server.slots.find((slot) => slot.id === "fx_2")!, {
      target_mode: "filter_param", enabled: false, available: false, value: 0.6
    });
    Object.assign(server.slots.find((slot) => slot.id === "fx_3")!, {
      target_mode: "filter_param", enabled: true, available: false, value: 0.8
    });
    await connect();
    await expect(client.resetFx({ ms })).resolves.toEqual({
      eligible_count: 2, reset_count: 1, queued_unavailable_count: 1, ms
    });
    expect(server.slots.find((slot) => slot.id === "fader_1")?.value).toBe(0);
    expect(server.slots.find((slot) => slot.id === "fx_1")?.value).toBe(0.65);
    expect(server.slots.find((slot) => slot.id === "fx_2")?.value).toBe(0.6);
    expect(server.slots.find((slot) => slot.id === "fx_3")?.value).toBe(0);
    expect(server.outputWriteCounts.get("fader_1")).toBe(1);
    expect(server.outputWriteCounts.has("fx_1")).toBe(false);
    expect(server.outputWriteCounts.has("fx_2")).toBe(false);
    expect(server.outputWriteCounts.has("fx_3")).toBe(false);
    expect([...server.pendingCleanSlots]).toEqual(["fx_3"]);
    server.setSlotAvailability("fx_3", true);
    expect(server.pendingCleanSlots.size).toBe(0);
    expect(server.outputWriteCounts.get("fx_3")).toBe(1);
    expect(server.slots.find((slot) => slot.id === "fx_3")?.value).toBe(0);
  });

  it("defaults new filter bindings to their catalog range, preserves omitted old bounds, and rejects invalid edits atomically", async () => {
    server = new FakeObsServer({ fadesterVersion: "0.6.0" });
    await connect();
    await client.setSlot({ slot: "fx_1", enabled: false });
    const bound = await client.setSlot({ slot: "fx_7", target_mode: "filter_param", source_a: "Cam 1", filter_name: "Blur", filter_prop: "radius", from_val: 5 });
    expect(bound).toMatchObject({ from_val: 5, to_val: 32 });
    expect(await client.setSlot({ slot: "fx_7", to_val: 20 })).toMatchObject({ from_val: 5, to_val: 20 });
    const before = { ...server.slots.find((slot) => slot.id === "fx_7")! };
    await expect(client.setSlot({ slot: "fx_7", to_val: 100 })).rejects.toThrow("within the property's range");
    expect(server.slots.find((slot) => slot.id === "fx_7")).toEqual(before);
    await expect(client.setSlot({ slot: "fx_7", filter_prop: "missing" })).rejects.toThrow("was not found");
    expect(server.slots.find((slot) => slot.id === "fx_7")).toEqual(before);
    await expect(client.setSlot({ slot: "fx_1", enabled: true })).rejects.toThrow("already controlled");
    await expect(client.setFaderValue({ slot: "fx_1", value: 0.5 })).rejects.toThrow("Not used");
  });

  it("stores values on enabled unassigned slots without output or rail snapping, but rejects disabled movement", async () => {
    server = new FakeObsServer();
    await connect();
    await client.loadProfile({ name: "apc40mk2" });
    const slot = server.slots.find((entry) => entry.id === "fader_3")!;
    expect(slot).toMatchObject({ enabled: true, target_mode: "unassigned", available: false });
    await expect(client.setFaderValue({ slot: slot.id, value: 0.37, release: true }))
      .resolves.toEqual({ slot: slot.id, value: 0.37 });
    await expect(client.nudgeFader({ slot: slot.id, delta: 0.13 }))
      .resolves.toEqual({ slot: slot.id, value: 0.5 });
    await client.autoFade({ slot: slot.id, to: 0.9, ms: 50 });
    expect(slot).toMatchObject({ value: 0.9, parked: false });
    expect(server.outputWriteCounts.has(slot.id)).toBe(false);
    expect(server.tbarCompletionCount).toBe(0);
    await client.setSlot({ slot: slot.id, enabled: false });
    const eventCount = server.faderChangedCount;
    await expect(client.setFaderValue({ slot: slot.id, value: 0.2 })).rejects.toThrow("Not used");
    await expect(client.nudgeFader({ slot: slot.id, delta: -0.1 })).rejects.toThrow("Not used");
    await expect(client.autoFade({ slot: slot.id, to: 0, ms: 50 })).rejects.toThrow("Not used");
    expect(slot.value).toBe(0.9);
    expect(server.faderChangedCount).toBe(eventCount);
    expect(server.outputWriteCounts.has(slot.id)).toBe(false);
  });

  it("reports missing catalog sources and resets all assignments on profile load", async () => {
    server = new FakeObsServer();
    await connect();
    await expect(client.getCatalog({ source: "Missing source" })).rejects.toThrow(
      "Source 'Missing source' not found. Create the source in OBS first or check its spelling."
    );
    await client.loadProfile({ name: "midimix" });
    const state = await client.getState();
    expect(state.slots).toHaveLength(18);
    expect(state.slots.every((slot) => slot.target_mode === "unassigned" && slot.value === 0)).toBe(true);
    expect(state.slots.every((slot) => !slot.source_a && !slot.source_b && !slot.filter_name && !slot.filter_prop)).toBe(true);
    expect(state.slots.find((slot) => slot.id === "crossfader")?.enabled).toBe(false);
    expect(state.slots.find((slot) => slot.id === "master")?.enabled).toBe(true);
    expect(state.slots.filter((slot) => slot.kind === "fx").every((slot) => slot.enabled)).toBe(true);
    await client.loadProfile({ name: "apc40mk2" });
    const apc = await client.getState();
    expect(apc.slots[0]).toMatchObject({ target_mode: "tbar", value: 0, available: true });
    expect(apc.slots.slice(1).every((slot) => slot.target_mode === "unassigned")).toBe(true);
  });
});
