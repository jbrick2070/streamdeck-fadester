// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect, afterEach, vi } from "vitest";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import {
  PiStatePayload,
  PropertyInspectorBridge,
  sanitizeSetSlotFields
} from "../src/pi/pi-bridge.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";
import { FadesterGlobalSettings } from "../src/types/settings.js";

interface Harness {
  server: FakeObsServer;
  client: FadesterClient;
  store: FadesterStore;
  bridge: PropertyInspectorBridge;
  sent: Record<string, unknown>[];
  persisted: FadesterGlobalSettings[];
}

async function connect(opts?: ConstructorParameters<typeof FakeObsServer>[0]): Promise<Harness> {
  const server = new FakeObsServer(opts);
  const port = await server.start();
  const client = new FadesterClient({
    host: "127.0.0.1",
    port,
    password: opts?.password ?? ""
  });
  const store = new FadesterStore(client);
  const sent: Record<string, unknown>[] = [];
  const persisted: FadesterGlobalSettings[] = [];
  const bridge = new PropertyInspectorBridge(store, client, {
    sendToPropertyInspector: (p) => {
      sent.push(p);
    },
    persistGlobalSettings: async (s) => {
      persisted.push({ ...s });
    }
  });
  await new Promise<void>((resolve) => {
    client.once("statusChanged", () => resolve());
    client.start();
  });
  await new Promise((r) => setTimeout(r, 40));
  return { server, client, store, bridge, sent, persisted };
}

function lastState(h: Harness): PiStatePayload {
  const states = h.sent.filter((p) => p.event === "fadesterState");
  return states[states.length - 1] as unknown as PiStatePayload;
}

function lastReply(h: Harness, event: string): Record<string, unknown> {
  const replies = h.sent.filter((p) => p.event === event);
  return replies[replies.length - 1];
}

describe("Property Inspector bridge", () => {
  let h: Harness | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (h) {
      h.client.stop();
      await h.server.stop();
      h = null;
    }
  });

  it("never sends the password to the PI, only passwordSet, and reports profile, device, and capabilities", async () => {
    h = await connect({ password: "hunter2-not-for-pi", buildCommit: "abc1234" });
    h.bridge.broadcast();
    const state = lastState(h);
    const raw = JSON.stringify(state);
    expect(raw).not.toContain("hunter2-not-for-pi");
    expect(state.connection).toEqual({
      host: "127.0.0.1",
      port: h.server["wss"] ? state.connection.port : state.connection.port,
      passwordSet: true
    });
    expect(state.status.kind).toBe("connected");
    expect(state.status.buildCommit).toBe("abc1234");
    expect(state.profile.slug).toBe("apc40mk2");
    expect(state.profile.tier).toBe("verified");
    expect(state.profile.tierLabel).toBe("Verified on hardware");
    expect(state.device.connected).toBe(true);
    expect(state.capabilities.catalog).toBe(true);
    expect(state.capabilities.fxSlots).toBe(true);
    expect(state.knownProfiles.map((p) => p.slug)).toEqual([
      "apc40mk2",
      "apcminimk2",
      "midimix",
      "nanokontrol2",
      "launchcontrolxl",
      "generic"
    ]);
    expect(state.knownProfiles.find((p) => p.slug === "midimix")?.tierLabel).toBe(
      "Beta, untested on hardware"
    );
    expect(state.targetModes.map((m) => m.id)).toContain("filter_param");
    expect(state.slots.find((s) => s.id === "fx_1")?.filter_name).toBeDefined();
  });

  it("reports no catalog capability on Midi Fadester 0.3.0", async () => {
    h = await connect({ fadesterVersion: "0.3.0" });
    h.bridge.broadcast();
    const state = lastState(h);
    expect(state.capabilities.catalog).toBe(false);
    expect(state.capabilities.fxSlots).toBe(false);
  });

  it("sends live values separately so inspector drafts need not be rebuilt", async () => {
    h = await connect();
    h.sent.length = 0;
    await h.client.setFaderValue({ slot: "fader_2", value: 0.63 });
    await vi.waitFor(() => {
      expect(lastReply(h!, "slotValueChanged")).toMatchObject({
        slot: "fader_2", value: 0.63
      });
    });
    expect(typeof lastReply(h, "slotValueChanged").display_value).toBe("string");
    expect(h.sent.some((p) => p.event === "fadesterState")).toBe(false);
  });

  it("reports an explicit error if an older server silently ignores enabled", async () => {
    h = await connect();
    const slot = h.store.getSlot("fx_1")!;
    vi.spyOn(h.client, "setSlot").mockResolvedValue({ ...slot, enabled: true });
    await h.bridge.handleMessage({ event: "setSlot", slot: "fx_1", fields: { enabled: false } });
    expect(lastReply(h, "setSlotResult")).toMatchObject({
      ok: false,
      error: "Midi Fadester did not apply the enabled state. Update Midi Fadester to a build that supports slot enable controls."
    });
  });

  it("broadcasts calibration and confirms enabled changes from the returned slot", async () => {
    h = await connect();
    const slot = h.store.getSlot("fx_1")!;
    slot.cal_min = 3;
    slot.cal_max = 125;
    expect(h.bridge.buildStatePayload().slots.find((s) => s.id === "fx_1")).toMatchObject({ cal_min: 3, cal_max: 125 });
    vi.spyOn(h.client, "setSlot").mockResolvedValue({ ...slot, enabled: false });
    await h.bridge.handleMessage({ event: "setSlot", slot: "fx_1", fields: { enabled: false } });
    expect(lastReply(h, "setSlotResult")).toMatchObject({ ok: true, enabled: false });
  });

  it("re-saving identical host/port keeps the socket and the stored password; a typed password reconnects", async () => {
    h = await connect({ password: "pw-one" });
    const connectionsBefore = h.server.connectionCount;

    // PI re-saves host/port without a password key: no reconnect, password kept.
    await h.bridge.handleMessage({
      event: "updateGlobalSettings",
      host: "127.0.0.1",
      port: h.client.getSettings().port
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(h.server.connectionCount).toBe(connectionsBefore);
    expect(h.client.getSettings().password).toBe("pw-one");
    expect(h.persisted[h.persisted.length - 1].password).toBe("pw-one");
    expect(h.client.isConnected()).toBe(true);

    // Operator typed a new (wrong) password: reconnect happens and halts on 4009.
    await h.bridge.handleMessage({
      event: "updateGlobalSettings",
      host: "127.0.0.1",
      port: h.client.getSettings().port,
      password: "wrong"
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(h.server.connectionCount).toBe(connectionsBefore + 1);
    expect(h.client.getStatus().kind).toBe("wrong_password");
    expect(lastState(h).connection.passwordSet).toBe(true);
    expect(JSON.stringify(h.sent)).not.toContain('"wrong"');
  });

  it("testConnection re-reads state over the live socket instead of dropping it", async () => {
    h = await connect();
    const before = h.server.connectionCount;
    const calls = h.server.vendorCallLog.length;
    await h.bridge.handleMessage({ event: "testConnection" });
    expect(h.server.connectionCount).toBe(before);
    expect(h.server.vendorCallLog.length).toBe(calls + 1);
    expect(h.server.vendorCallLog[calls].requestType).toBe("get_state");
    expect(h.client.isConnected()).toBe(true);
  });

  it("round-trips get_catalog overview and per-source detail with requestId", async () => {
    h = await connect();
    await h.bridge.handleMessage({ event: "getCatalog", requestId: "r1" });
    const overview = lastReply(h, "catalog");
    expect(overview.requestId).toBe("r1");
    const data = overview.data as { scenes: unknown[]; audio_sources: unknown[]; filter_hosts: unknown[] };
    expect(data.scenes.length).toBe(2);
    expect(data.audio_sources.length).toBe(2);
    expect(data.filter_hosts.length).toBe(3);

    await h.bridge.handleMessage({ event: "getCatalog", requestId: "r2", source: "Cam 1" });
    const detail = lastReply(h, "catalog");
    expect(detail.requestId).toBe("r2");
    expect((detail.data as { filters: Array<{ name: string }> }).filters.map((f) => f.name)).toEqual([
      "Blur",
      "Crop/Pad"
    ]);
  });

  it("applies set_slot with sanitized fields, reports the updated label, and broadcasts the new state", async () => {
    h = await connect();
    const statesBefore = h.sent.filter((p) => p.event === "fadesterState").length;
    await h.bridge.handleMessage({
      event: "setSlot",
      requestId: "s1",
      slot: "fader_2",
      fields: {
        target_mode: "audio_volume",
        source_a: "Mic/Aux",
        afv: true,
        from_val: "12.5",
        bogus_key: "ignored",
        to_val: "not-a-number"
      }
    });
    const reply = lastReply(h, "setSlotResult");
    expect(reply.ok).toBe(true);
    expect(reply.slot).toBe("fader_2");
    const call = h.server.vendorCallLog.find((c) => c.requestType === "set_slot");
    expect(call?.requestData).toEqual({
      slot: "fader_2",
      target_mode: "audio_volume",
      source_a: "Mic/Aux",
      afv: true,
      from_val: 12.5
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(h.store.getSlot("fader_2")?.target_mode).toBe("audio_volume");
    expect(h.sent.filter((p) => p.event === "fadesterState").length).toBeGreaterThan(statesBefore);
  });

  it("surfaces the vendor error sentence verbatim when set_slot is rejected", async () => {
    h = await connect();
    await h.bridge.handleMessage({
      event: "setSlot",
      requestId: "s2",
      slot: "fader_3",
      fields: { target_mode: "audio_volume", source_a: "Ghost Mic" }
    });
    const reply = lastReply(h, "setSlotResult");
    expect(reply.ok).toBe(false);
    expect(reply.error).toBe(
      "Source 'Ghost Mic' not found in OBS. Choose an existing source name."
    );
  });

  it("refuses setSlot and loadProfile while offline with the connection sentence", async () => {
    h = await connect();
    await h.server.stop();
    await new Promise((r) => setTimeout(r, 60));
    expect(h.client.isConnected()).toBe(false);
    await h.bridge.handleMessage({ event: "setSlot", slot: "fader_1", fields: {} });
    expect(lastReply(h, "setSlotResult").ok).toBe(false);
    expect(String(lastReply(h, "setSlotResult").error)).toContain("OBS is not running");
    await h.bridge.handleMessage({ event: "loadProfile", name: "midimix" });
    expect(lastReply(h, "loadProfileResult").ok).toBe(false);
    await h.bridge.handleMessage({ event: "getCatalog" });
    expect(String(lastReply(h, "catalog").error)).toContain("OBS is not running");
    h.client.stop();
    h = null;
  });

  it("loads a profile and the next state broadcast reflects the new desk topology", async () => {
    h = await connect();
    await h.bridge.handleMessage({ event: "loadProfile", requestId: "p1", name: "nanokontrol2" });
    const reply = lastReply(h, "loadProfileResult");
    expect(reply.ok).toBe(true);
    expect(reply.loaded).toBe("nanokontrol2");
    expect(reply.tier).toBe("beta");
    await new Promise((r) => setTimeout(r, 40));
    const state = lastState(h);
    expect(state.profile.slug).toBe("nanokontrol2");
    expect(state.profile.tierLabel).toBe("Beta, untested on hardware");
    const cross = state.slots.find((s) => s.id === "crossfader");
    expect(cross?.available).toBe(false);
    expect(cross?.reason).toBe("Not used. Click to set up.");

    await h.bridge.handleMessage({ event: "loadProfile", requestId: "p2", name: "no-such-desk" });
    expect(lastReply(h, "loadProfileResult").ok).toBe(false);
    expect(String(lastReply(h, "loadProfileResult").error)).toContain("Unknown profile");
  });

  it("sanitizeSetSlotFields keeps only documented fields with correct types", () => {
    expect(
      sanitizeSetSlotFields("fx_1", {
        target_mode: "filter_param",
        source_a: "Cam 1",
        filter_name: "Blur",
        filter_prop: "radius",
        from_val: 0,
        to_val: "32",
        bypass_at_zero: true,
        afv: "yes",
        enabled: 1,
        curve: 5,
        cal_min: Number.NaN,
        evil: "x"
      })
    ).toEqual({
      slot: "fx_1",
      target_mode: "filter_param",
      source_a: "Cam 1",
      filter_name: "Blur",
      filter_prop: "radius",
      from_val: 0,
      to_val: 32,
      bypass_at_zero: true
    });
    expect(sanitizeSetSlotFields("master", undefined)).toEqual({ slot: "master" });
  });
});
