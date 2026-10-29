// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
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
});
