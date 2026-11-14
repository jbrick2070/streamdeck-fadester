// SPDX-License-Identifier: GPL-2.0-or-later
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ObsFadeKeyInstanceController } from "../src/actions/obs-fade-key.js";
import { ObsFaderDialInstanceController } from "../src/actions/obs-fader-dial.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { MIX_NAMESPACE, WholeMixClient, mixProblem } from "../src/obs/whole-mix.js";
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

  it("pins the first provider.id for the session and refuses to act if a second provider answers", async () => {
    const send = vi.fn(async (_event: Record<string, unknown>) => {});
    const mix = new WholeMixClient(() => true, send, () => {});
    const stop = mix.observe();
    const providerA = { id: "11111111-1111-4111-8111-111111111111", name: "Fadester Companion", version: "1.0.0" };
    const providerB = { id: "22222222-2222-4222-8222-222222222222", name: "Fadester Companion", version: "1.0.0" };
    const reply = (id: unknown, extra: Record<string, unknown> = {}) =>
      mix.receive({
        id,
        namespace: MIX_NAMESPACE,
        op: "reply",
        ok: true,
        enabled: true,
        db: -6,
        message: "All mixer inputs: -6.0 dB.",
        ...extra
      });
    try {
      const status = send.mock.calls[0][0];
      // Malformed provider metadata is ignored cleanly without pinning.
      reply(status.id, { provider: { id: "", name: "Fadester Companion", version: "1.0.0" } });
      expect(mix.state.availability).toBe("offline");

      // Provider A answers first and is pinned for the session; a second reply to the same request ID from Provider B latches conflict.
      reply(status.id, { provider: providerA });
      expect(mix.state).toEqual({ availability: "ready", db: -6 });
      reply(status.id, { provider: providerB, db: -9 });
      expect(mix.state).toEqual({ availability: "conflict", db: null });
      expect(mixProblem(mix.state)).toBe("Two mix providers are answering");

      const callsBefore = send.mock.calls.length;
      await expect(mix.command("mix.down", 1)).rejects.toThrow("Two mix providers are answering");
      expect(send.mock.calls.length).toBe(callsBefore);

      // Even if Provider A answers again during the same session, conflict stays latched until session reset.
      reply(status.id, { provider: providerA, db: -3 });
      expect(mix.state).toEqual({ availability: "conflict", db: null });

      // Resetting the session clears the pin; also verify conflict when Provider B answers an in-flight command first.
      mix.reset();
      expect(mix.state.availability).toBe("offline");
      mix.refresh();
      const status2 = send.mock.calls.at(-1)![0];
      reply(status2.id, { provider: providerA, db: 0 });
      expect(mix.state).toEqual({ availability: "ready", db: 0 });

      const inFlight = mix.command("mix.fadeOut");
      const cmdReq = send.mock.calls.at(-1)![0];
      const rejected = expect(inFlight).rejects.toThrow("Two mix providers are answering");
      reply(cmdReq.id, { provider: providerB, db: null });
      await rejected;
      expect(mix.state).toEqual({ availability: "conflict", db: null });
    } finally {
      stop();
    }
  });
});
