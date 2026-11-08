// SPDX-License-Identifier: GPL-2.0-or-later
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ObsFadeKeyInstanceController } from "../src/actions/obs-fade-key.js";
import { ObsFaderDialInstanceController } from "../src/actions/obs-fader-dial.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { MIX_NAMESPACE, WholeMixClient } from "../src/obs/whole-mix.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

describe("optional whole mixer controls", () => {
  it("uses one shared probe, batches signed dial ticks and never writes individual inputs", async () => {
    const server = new FakeObsServer();
    const port = await server.start();
    const obs = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const connected = once(obs, "connectionReady");
    obs.start();
    const showAlert = vi.fn(async () => {});
    const key = new ObsFadeKeyInstanceController(obs, { showAlert, setImage: async () => {} });
    const dial = new ObsFaderDialInstanceController(obs, { showAlert, setFeedback: async () => {} });
    const received: Record<string, unknown>[] = [];
    try {
      await connected;
      let enabled = false;
      obs.on("obsEvent", (type, data) => {
        if (type !== "CustomEvent" || data.namespace !== MIX_NAMESPACE || data.op === "reply") return;
        received.push(data);
        server.emitObsEvent("CustomEvent", { namespace: MIX_NAMESPACE, id: data.id, op: "reply", message: "",
          ok: true, enabled, db: data.op === "mix.fadeOut" ? null : -6 });
      });
      key.appear({ target: "all_inputs", to: 0 });
      dial.appear({ target: "all_inputs" });
      await vi.waitFor(() => expect(obs.wholeMix.state.availability).toBe("disabled"));
      expect(received.map(r => r.op)).toEqual(["mix.status"]);
      // The cached disabled state blocks the press. Its read-only recheck can discover the new opt-in.
      enabled = true;
      await key.handleKeyDown();
      expect(showAlert).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(obs.wholeMix.state.availability).toBe("ready"));
      await key.handleKeyDown();
      expect(obs.wholeMix.state.db).toBeNull();
      key.updateSettings({ target: "all_inputs", to: 1 });
      await key.handleKeyDown();
      await dial.handleRotate(-4);
      await dial.handleRotate(2);
      expect(received.filter(r => r.op !== "mix.status").map(r => [r.op, r.steps]))
        .toEqual([["mix.fadeOut", undefined], ["mix.restore", undefined], ["mix.down", 4], ["mix.up", 2]]);
      expect(new Set(received.map(r => r.id)).size).toBe(received.length);
      for (const r of received) {
        expect(r.id).toMatch(/^[a-f0-9-]{14}4[a-f0-9-]{21}$/);
        expect(Math.abs(Date.now() - Number(r.sentAtMs))).toBeLessThan(5000);
      }
      expect(server.directCallLog.some(r => r.requestType === "SetInputVolume")).toBe(false);
      key.updateSettings({ inputName: "Desktop Audio", to: 0, durationMs: 0 });
      await key.handleKeyDown();
      await vi.waitFor(() => expect(server.inputVolumes.get("Desktop Audio")).toBe(0));
    } finally {
      key.disappear();
      dial.disappear();
      obs.stop();
      await server.stop();
    }
  });

  it("drops unknown, malformed, stale and expired replies, and never repeats an unconfirmed write", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_event: Record<string, unknown>) => {});
    const mix = new WholeMixClient(() => true, send, () => {});
    const stop = mix.observe();
    const reply = (id: unknown, extra = {}) => mix.receive({ id, namespace: MIX_NAMESPACE, op: "reply",
      ok: true, enabled: true, db: 0, message: "", ...extra });
    try {
      const status = send.mock.calls[0][0];
      reply("foreign");
      reply(status.id, { namespace: "another plugin" });
      reply(status.id, { db: "0" });
      expect(mix.state.availability).toBe("offline");
      reply(status.id);
      const first = mix.command("mix.down");
      const second = mix.command("mix.up");
      reply(send.mock.calls[2][0].id, { db: -3 });
      reply(send.mock.calls[1][0].id, { db: -9 });
      await Promise.all([first, second]);
      expect(mix.state.db).toBe(-3);
      const providerError = expect(mix.command("mix.restore")).rejects.toThrow();
      reply(send.mock.calls.at(-1)![0].id, { ok: false, db: null });
      await providerError;
      expect(mix.state.availability).toBe("offline");
      mix.refresh();
      reply(send.mock.calls.at(-1)![0].id, { db: -3 });
      expect(mix.state).toEqual({ availability: "ready", db: -3 });
      const missing = expect(mix.command("mix.fadeOut")).rejects.toThrow();
      const lost = send.mock.calls.at(-1)![0];
      await vi.advanceTimersByTimeAsync(12000);
      await missing;
      reply(lost.id);
      expect(mix.state.availability).toBe("offline");
      expect(send.mock.calls.filter(([m]) => m.op === "mix.fadeOut")).toHaveLength(1);
      mix.refresh();
      const last = send.mock.calls.at(-1)![0];
      mix.reset();
      reply(last.id);
      expect(mix.state.availability).toBe("offline");
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});
