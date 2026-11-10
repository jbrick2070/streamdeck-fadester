// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from "vitest";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { DirectObsPropertyInspectorBridge } from "../src/pi/direct-obs-bridge.js";
import { FadesterGlobalSettings } from "../src/types/settings.js";

describe("Shared direct OBS connection settings", () => {
  it("preserves a newly entered password across overlapping blur and save events without exposing it to any inspector", async () => {
    const client = new DirectObsClient({ password: "old-test-password" });
    const persisted: FadesterGlobalSettings[] = [];
    const payloads: Record<string, unknown>[] = [];
    let release!: () => void;
    let started!: () => void;
    const saving = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const bridge = new DirectObsPropertyInspectorBridge(client, {
      sendToPropertyInspector: (payload) => payloads.push(payload),
      async persistGlobalSettings(settings) {
        persisted.push({ ...settings });
        if (persisted.length === 1) { started(); await gate; }
      }
    });
    const first = bridge.handleMessage({ event: "directUpdateGlobalSettings", password: "new-test-password" });
    await saving;
    const duplicate = bridge.handleMessage({ event: "directUpdateGlobalSettings", host: "127.0.0.1", port: 4455 });
    release();
    await Promise.all([first, duplicate]);
    expect(persisted.map((entry) => entry.password)).toEqual(["new-test-password", "new-test-password"]);
    expect(client.getSettings().password).toBe("new-test-password");
    const anotherInspector = new DirectObsPropertyInspectorBridge(client, {
      sendToPropertyInspector: (payload) => payloads.push(payload),
      persistGlobalSettings: async () => {}
    });
    anotherInspector.broadcast();
    expect(payloads.at(-1)?.connection).toMatchObject({ passwordSet: true });
    expect(JSON.stringify(payloads)).not.toContain("new-test-password");
    expect(JSON.stringify(payloads)).not.toContain("old-test-password");
  });

  it("saves a Host typed with its port without failing, and tells the page OBS cannot be reached", async () => {
    const client = new DirectObsClient({ host: "127.0.0.1", port: 1, password: "" }, { baseReconnectMs: 60_000 });
    const payloads: Record<string, unknown>[] = [];
    const bridge = new DirectObsPropertyInspectorBridge(client, {
      sendToPropertyInspector: (payload) => payloads.push(payload),
      persistGlobalSettings: async () => {}
    });
    client.start();
    try {
      await bridge.handleMessage({ event: "directUpdateGlobalSettings", host: "127.0.0.1:4455", port: 4455 });
      expect(client.getStatus().kind).toBe("obs_unreachable");
      expect(payloads.at(-1)).toMatchObject({ event: "directObsState", status: { kind: "obs_unreachable" } });
    } finally {
      client.stop();
    }
  });
});

describe("Save & test tells the page when the test is over", () => {
  function bridgeFor(client: DirectObsClient, extra: Record<string, unknown> = {}) {
    const payloads: Record<string, unknown>[] = [];
    const bridge = new DirectObsPropertyInspectorBridge(client, {
      sendToPropertyInspector: (payload) => payloads.push(payload),
      persistGlobalSettings: async () => {},
      ...extra
    });
    return { bridge, payloads, events: () => payloads.map((payload) => payload.event) };
  }

  it("waits while the new attempt's socket is open, then sends the state and directTestDone", async () => {
    const client = new DirectObsClient();
    const reconnect = vi.spyOn(client, "reconnectNow").mockImplementation(() => {});
    let openChecks = 3;
    vi.spyOn(client, "hasLiveSocket").mockImplementation(() => openChecks-- > 0);
    const { bridge, events } = bridgeFor(client);
    await bridge.handleMessage({ event: "directTestConnection" });
    expect(reconnect).toHaveBeenCalledOnce();
    // Looked again until the socket had closed.
    expect(openChecks).toBeLessThan(0);
    expect(events()).toEqual(["directObsState", "directTestDone"]);
  });

  it("when connected reads OBS again, and reports the test over even when that read fails", async () => {
    const client = new DirectObsClient();
    vi.spyOn(client, "isConnected").mockReturnValue(true);
    const reconnect = vi.spyOn(client, "reconnectNow").mockImplementation(() => {});
    vi.spyOn(client, "refreshCatalog").mockRejectedValue(new Error("Request timed out."));
    const { bridge, events } = bridgeFor(client);
    await expect(bridge.handleMessage({ event: "directTestConnection" })).rejects.toThrow("Request timed out.");
    expect(reconnect).not.toHaveBeenCalled();
    expect(events()).toEqual(["directObsState", "directTestDone"]);
  });

  it("ends with a real refused connection: the socket closes, OBS is unreachable, the test is over", async () => {
    const client = new DirectObsClient({ host: "127.0.0.1", port: 1, password: "" }, { baseReconnectMs: 60_000 });
    const { bridge, payloads, events } = bridgeFor(client);
    client.start();
    try {
      await bridge.handleMessage({ event: "directTestConnection" });
      expect(client.hasLiveSocket()).toBe(false);
      expect(events().slice(-2)).toEqual(["directObsState", "directTestDone"]);
      expect(payloads.at(-2)).toMatchObject({ status: { kind: "obs_unreachable" } });
    } finally {
      client.stop();
    }
  }, 10_000);

  it("answers a layout it cannot open here, so the page never stays on Preparing", async () => {
    const client = new DirectObsClient();
    const activate = vi.fn(async () => {});
    const { bridge, payloads } = bridgeFor(client, { getDeviceType: () => 7, activateLayout: activate });
    // A 15-key layout on a Stream Deck +, and a slug no layout has.
    for (const slug of ["buttons-source-desk", "no-such-layout"]) {
      await bridge.handleMessage({ event: "directActivateLayout", slug });
      expect(payloads.at(-1)).toEqual({ event: "directSetupResult", ok: false, error: "Could not prepare this OBS layout." });
    }
    expect(activate).not.toHaveBeenCalled();
  });
});
