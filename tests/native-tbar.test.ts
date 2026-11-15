// SPDX-License-Identifier: GPL-2.0-or-later
// The bundled T-bar helper's driver (src/obs/native-tbar.ts) and the dial's throws on OBS's real slider
// (direct-obs-client.ts), against a stand-in helper and the fake OBS's model of OBS 33's T-bar widget.
import { EventEmitter } from "node:events";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { DirectObsClient, TBAR_SETTLE_MS } from "../src/obs/direct-obs-client.js";
import { DirectObsPropertyInspectorBridge } from "../src/pi/direct-obs-bridge.js";
import {
  builtAxWorkerPath,
  builtUiaWorkerPath,
  NativeTbar,
  NativeTbarHelper,
  NativeTbarRefusal,
  NativeTbarTimeout,
  NativeTbarUia,
  NativeTbarUnavailable,
  NativeTbarUncertain,
  nativeTbarBlocker,
  nativeTbarEligible,
  nativeTick,
  UiaWorkerLike
} from "../src/obs/native-tbar.js";
import type { UiaWorkerRequest } from "../src/obs/uia/uia-worker.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

const FAKE_HELPER = fileURLToPath(new URL("./helpers/fake-native-slider.mjs", import.meta.url));

function helper(env: Record<string, string> = {}): NativeTbarHelper {
  Object.assign(process.env, env);
  return new NativeTbarHelper(process.execPath, 4455, [FAKE_HELPER]);
}

describe("native T-bar helper driver", () => {
  const made: NativeTbarHelper[] = [];
  afterEach(() => {
    for (const h of made.splice(0)) h.close();
    delete process.env.FAKE_SLIDER_MODE;
    delete process.env.FAKE_SLIDER_START;
    delete process.env.FAKE_SLIDER_ON_CLOSE;
  });

  it("reads and moves in normalised positions over the helper's line protocol", async () => {
    const h = helper();
    made.push(h);
    expect(await h.read()).toBe(0);
    expect(nativeTick(await h.move(0, 0.5))).toBe(512);
    expect(nativeTick(await h.read())).toBe(512);
    expect(await h.move(0.5, 1)).toBe(1);
  });

  it("refuses without writing when the slider is not where the dial left it", async () => {
    const h = helper({ FAKE_SLIDER_START: "300" });
    made.push(h);
    await expect(h.move(0, 0.4)).rejects.toBeInstanceOf(NativeTbarRefusal);
    expect(nativeTick(await h.read())).toBe(300); // nothing moved, and the helper is still usable
  });

  it("treats an unconfirmed write as uncertain and never replays it on the same helper", async () => {
    const h = helper({ FAKE_SLIDER_MODE: "unconfirmed" });
    made.push(h);
    await expect(h.move(0, 0.3)).rejects.toBeInstanceOf(NativeTbarUncertain);
    delete process.env.FAKE_SLIDER_MODE;
    expect(await h.read()).toBe(0); // a fresh helper process answers again
  });

  it("reports a helper that cannot reach OBS as a refusal", async () => {
    const h = helper({ FAKE_SLIDER_MODE: "refuse" });
    made.push(h);
    await expect(h.read()).rejects.toThrow(/main OBS window/);
  });

  it("gives up on a helper that does not answer, as uncertain", async () => {
    process.env.FAKE_SLIDER_MODE = "silent";
    const h = new NativeTbarHelper(process.execPath, 4455, [FAKE_HELPER], 300);
    made.push(h);
    await expect(h.read()).rejects.toBeInstanceOf(NativeTbarUncertain);
  });

  it("never takes a late line from a helper it let go as the next helper's answer", async () => {
    const h = helper({ FAKE_SLIDER_MODE: "unconfirmed", FAKE_SLIDER_ON_CLOSE: "OK 777" });
    made.push(h);
    // The uncertain write lets that helper go; it prints its parting line while the next one is still starting.
    await expect(h.move(0, 0.3)).rejects.toBeInstanceOf(NativeTbarUncertain);
    delete process.env.FAKE_SLIDER_MODE;
    delete process.env.FAKE_SLIDER_ON_CLOSE;
    expect(await h.read()).toBe(0);
    expect(nativeTick(await h.move(0, 0.25))).toBe(256); // and the answers that follow stay in step
  });

  it("starts no helper again once it is closed", async () => {
    const h = helper();
    made.push(h);
    expect(await h.read()).toBe(0);
    h.close();
    await expect(h.read()).rejects.toBeInstanceOf(NativeTbarRefusal);
  });

  it("is only used for a local OBS 33 on Windows and macOS", () => {
    expect(nativeTbarEligible("win32", "127.0.0.1", "33.0.1")).toBe(true);
    expect(nativeTbarEligible("win32", "localhost", "33.0.0")).toBe(true);
    expect(nativeTbarEligible("win32", "::1", "33.1.0")).toBe(true);
    expect(nativeTbarEligible("win32", "127.0.0.1", "33.0.1-rc1")).toBe(true);
    expect(nativeTbarEligible("darwin", "127.0.0.1", "33.0.1")).toBe(true);
    expect(nativeTbarEligible("darwin", "localhost", "33.0.0")).toBe(true);
    expect(nativeTbarEligible("darwin", "[::1]", "33.0.1")).toBe(true);
    expect(nativeTbarEligible("win32", "192.168.1.20", "33.0.1")).toBe(false);
    expect(nativeTbarEligible("darwin", "192.168.1.20", "33.0.1")).toBe(false);
    expect(nativeTbarEligible("linux", "127.0.0.1", "33.0.1")).toBe(false);
    expect(nativeTbarEligible("win32", "127.0.0.1", "32.0.4")).toBe(false);
    expect(nativeTbarEligible("darwin", "127.0.0.1", "32.0.4")).toBe(false);
    expect(nativeTbarEligible("win32", "127.0.0.1", "34.0.0")).toBe(false);
    expect(nativeTbarEligible("win32", "127.0.0.1", "330.0.0")).toBe(false);
  });

  it("names what keeps OBS's slider out of reach", () => {
    expect(nativeTbarBlocker("linux", "127.0.0.1", "33.0.1")).toBe("unsupportedOs");
    expect(nativeTbarBlocker("win32", "192.168.1.20", "33.0.1")).toBe("remote");
    expect(nativeTbarBlocker("darwin", "192.168.1.20", "33.0.1")).toBe("remote");
    expect(nativeTbarBlocker("win32", "localhost", "32.0.4")).toBe("version");
    expect(nativeTbarBlocker("darwin", "localhost", "32.0.4")).toBe("version");
    expect(nativeTbarBlocker("win32", "localhost", "33.0.1")).toBeUndefined();
    expect(nativeTbarBlocker("darwin", "localhost", "33.0.1")).toBeUndefined();
  });
});

/** The helper's stand-in for the dial tests: moves the fake OBS's real slider, refuses a slider that moved. */
class FakeNative implements NativeTbar {
  public moves: Array<[number, number]> = [];
  public refuseReads = false;
  public reads = 0;
  public closed = 0;
  public constructor(private readonly obs: FakeObsServer) {}
  public async read(): Promise<number> {
    this.reads++;
    if (this.refuseReads) throw new NativeTbarRefusal("Cannot find the T-bar in OBS.");
    return this.obs.nativeSlider / 1023;
  }
  public async move(from: number, to: number): Promise<number> {
    if (nativeTick(from) !== this.obs.nativeSlider) throw new NativeTbarRefusal(`T-bar moved; actual ${this.obs.nativeSlider}`);
    this.moves.push([from, to]);
    if (nativeTick(from) !== nativeTick(to)) this.obs.moveNativeSlider(nativeTick(to));
    return to;
  }
  public close(): void {
    this.closed++;
  }
}

describe("dial throws on OBS's real slider", () => {
  let server: FakeObsServer;
  let client: DirectObsClient;
  let native: FakeNative;
  let obsPort = 0;

  async function connect(options: { native?: boolean; missing?: boolean; version?: string; host?: string } = {}): Promise<void> {
    server = new FakeObsServer({ obsVersion: options.version ?? "33.0.1" });
    const port = await server.start();
    obsPort = port;
    native = new FakeNative(server);
    client = new DirectObsClient(
      { host: options.host ?? "127.0.0.1", port, password: "" },
      { nativeTbar: options.native === false ? false : options.missing ? () => undefined : () => native, nativePlatform: "win32" }
    );
    client.start();
    await vi.waitFor(() => expect(client.getStatus().kind).toBe("connected"), { timeout: 3000 });
    await vi.waitFor(() => expect(client.getCatalog().studioMode).toBe(true), { timeout: 3000 });
    await vi.waitFor(() => expect(client.getCatalog().currentPreviewScene).not.toBe(client.getCatalog().currentProgramScene), { timeout: 3000 });
  }

  afterEach(async () => {
    client?.stop();
    await server?.stop();
  });

  const tbarWrites = (): Array<Record<string, unknown>> =>
    server.directCallLog.filter((call) => call.requestType === "SetTBarPosition").map((call) => call.requestData ?? {});

  it("moves OBS's slider during the throw and takes with a release on it, without leaving Studio Mode", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    const next = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.2);
    await client.nudgeTbar(0.2);
    expect(server.nativeSlider).toBe(nativeTick(0.4));
    expect(server.manualTransitionActive).toBe(true);
    expect(tbarWrites()).toEqual([]); // positions went to the slider, not over obs-websocket
    await client.takeTbar();
    expect(server.programSceneName).toBe(next);
    expect(server.previewSceneName).toBe(live);
    expect(server.tbarCompletionCount).toBe(1);
    expect(server.nativeSlider).toBe(0);
    expect(tbarWrites()).toEqual([{ position: 1, release: true }]);
    expect(server.directCallLog.some((call) => call.requestType === "SetStudioModeEnabled")).toBe(false);
    expect(client.getCatalog().tbarPosition).toBe(0);
  });

  it("cancels back at Live with a release, keeping Program", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    await client.nudgeTbar(0.3);
    await client.setTbarPosition(0);
    expect(server.manualTransitionActive).toBe(false);
    expect(server.programSceneName).toBe(live);
    expect(tbarWrites()).toEqual([{ position: 0, release: true }]);
  });

  it("keeps the obs-websocket throw when the helper cannot reach OBS, and releases it at Live", async () => {
    await connect();
    native.refuseReads = true;
    const live = client.getCatalog().currentProgramScene;
    await client.nudgeTbar(0.25);
    expect(server.nativeSlider).toBe(0);
    expect(tbarWrites()).toEqual([{ position: 0.25, release: false }]);
    await client.setTbarPosition(0);
    expect(tbarWrites().at(-1)).toEqual({ position: 0, release: true });
    expect(server.manualTransitionActive).toBe(false);
    expect(server.programSceneName).toBe(live);
  });

  it("never uses the helper for an OBS version whose slider is unknown", async () => {
    await connect({ version: "34.0.0" });
    await client.nudgeTbar(0.2);
    expect(native.moves).toEqual([]);
    expect(tbarWrites()).toEqual([{ position: 0.2, release: false }]);
  });

  it("keeps the obs-websocket throw with a transition other than Fade", async () => {
    await connect();
    server.currentTransitionName = "Cut";
    await client.nudgeTbar(0.2);
    expect(native.moves).toEqual([]);
    expect(tbarWrites()).toEqual([{ position: 0.2, release: false }]);
  });

  it("finds OBS's slider as soon as it connects in Studio Mode, before the first turn", async () => {
    await connect();
    await vi.waitFor(() => expect(native.reads).toBeGreaterThan(0), { timeout: 3000 });
    expect(native.moves).toEqual([]);
  });

  it("takes from rest on OBS's slider: starts the blend, then releases at the end", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    const next = client.getCatalog().currentPreviewScene;
    await client.takeTbar();
    expect(server.programSceneName).toBe(next);
    expect(server.previewSceneName).toBe(live);
    expect(server.tbarCompletionCount).toBe(1);
    expect(native.moves.slice(0, 2)).toEqual([[0, 1022 / 1023], [1022 / 1023, 1]]);
    expect(tbarWrites()).toEqual([{ position: 1, release: true }]);
    expect(server.directCallLog.some((call) => call.requestType === "SetStudioModeEnabled")).toBe(false);
  });

  it("queues the scene after Next into Preview after a take on OBS's slider", async () => {
    await connect();
    const next = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.5, true);
    await client.takeTbar(true);
    expect(server.programSceneName).toBe(next);
    expect(server.previewSceneName).toBe("Scene 3");
  });

  it("keeps a throw on OBS's slider going through a late end of an earlier transition", async () => {
    await connect();
    await client.nudgeTbar(0.2);
    await client.nudgeTbar(0.2);
    server.emitObsEvent("SceneTransitionEnded", { transitionName: server.currentTransitionName });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await client.nudgeTbar(0.2);
    expect(server.nativeSlider).toBe(nativeTick(0.6));
    expect(tbarWrites()).toEqual([]);
  });

  const rest = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, TBAR_SETTLE_MS + 60));

  it("always turns right: the end takes, the rest of the spin does nothing, and after a rest the next throw starts", async () => {
    await connect();
    const first = client.getCatalog().currentProgramScene;
    const second = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.5);
    await client.nudgeTbar(0.48); // into the last 3 %: the take
    expect(server.programSceneName).toBe(second);
    expect(server.previewSceneName).toBe(first); // OBS's swap cues the scene just left
    expect(server.tbarCompletionCount).toBe(1);
    expect(client.getCatalog().tbarPosition).toBe(0);
    const moves = native.moves.length;
    const writes = server.directCallLog.length;
    await client.nudgeTbar(0.2); // the rest of the same spin
    expect(native.moves).toHaveLength(moves);
    expect(server.directCallLog).toHaveLength(writes);
    await rest();
    await client.nudgeTbar(0.3); // after a rest, right again: the next throw, toward the scene in Preview
    expect(server.nativeSlider).toBe(nativeTick(0.3));
    await client.nudgeTbar(0.7);
    expect(server.programSceneName).toBe(first);
    expect(server.tbarCompletionCount).toBe(2);
    expect(tbarWrites()).toEqual([{ position: 1, release: true }, { position: 1, release: true }]);
  });

  it("keeps ignoring a long spin past the end until the dial rests", async () => {
    await connect();
    await client.nudgeTbar(1);
    expect(server.tbarCompletionCount).toBe(1);
    const writes = server.directCallLog.length;
    for (let tick = 0; tick < 6; tick++) {
      await new Promise((resolve) => setTimeout(resolve, TBAR_SETTLE_MS / 3)); // 600 ms in all: past the window alone
      await client.nudgeTbar(0.1); // still spinning: each tick holds the window open
    }
    expect(server.directCallLog).toHaveLength(writes);
    await rest();
    await client.nudgeTbar(0.1);
    expect(server.nativeSlider).toBe(nativeTick(0.1));
  });

  it("writes nothing for a turn left at rest", async () => {
    await connect();
    await client.nudgeTbar(-0.3);
    expect(server.directCallLog.filter((call) => call.requestType === "SetTBarPosition")).toEqual([]);
    expect(native.moves).toEqual([]);
    expect(client.getCatalog().tbarPosition).toBe(0);
  });

  it("cancels a throw turned back into its first 3 %", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    await client.nudgeTbar(0.2);
    await client.nudgeTbar(-0.18);
    expect(server.programSceneName).toBe(live);
    expect(server.manualTransitionActive).toBe(false);
    expect(client.getCatalog().tbarPosition).toBe(0);
    expect(tbarWrites()).toEqual([{ position: 0, release: true }]);
  });

  it("turns right for the next throw after a press take too", async () => {
    await connect();
    await client.nudgeTbar(0.4);
    await client.takeTbar();
    await rest();
    await client.nudgeTbar(0.25);
    expect(server.nativeSlider).toBe(nativeTick(0.25));
  });

  it("works the same over obs-websocket, where OBS's slider cannot follow", async () => {
    await connect({ native: false });
    const second = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.6);
    await client.nudgeTbar(0.6);
    expect(server.programSceneName).toBe(second);
    const writes = server.directCallLog.length;
    await client.nudgeTbar(0.3);
    expect(server.directCallLog).toHaveLength(writes);
    await rest();
    await client.nudgeTbar(0.3);
    expect(server.directCallLog.filter((call) => call.requestType === "SetTBarPosition").at(-1)?.requestData)
      .toEqual({ position: 0.3, release: false });
  });

  it("tells the settings page that OBS's slider follows the dial once the helper has read it", async () => {
    await connect();
    await vi.waitFor(() => expect(client.getNativeTbarStatus()).toBe("following"), { timeout: 3000 });
    const payloads: Record<string, unknown>[] = [];
    const bridge = new DirectObsPropertyInspectorBridge(client, {
      sendToPropertyInspector: (payload) => payloads.push(payload),
      persistGlobalSettings: async () => {}
    });
    bridge.broadcast();
    expect(payloads.at(-1)).toMatchObject({ event: "directObsState", nativeTbar: "following" });
  });

  it("says why OBS's slider stays still: a transition other than Fade, a closed window, a missing helper, the OBS version", async () => {
    await connect();
    await vi.waitFor(() => expect(client.getNativeTbarStatus()).toBe("following"), { timeout: 3000 });
    server.currentTransitionName = "Cut";
    server.emitObsEvent("CurrentSceneTransitionChanged", { transitionName: "Cut" });
    await vi.waitFor(() => expect(client.getNativeTbarStatus()).toBe("transition"), { timeout: 3000 });
    server.currentTransitionName = "Fade";
    native.refuseReads = true;
    server.emitObsEvent("CurrentSceneTransitionChanged", { transitionName: "Fade" });
    await vi.waitFor(() => expect(client.getNativeTbarStatus()).toBe("unreachable"), { timeout: 3000 });
    native.refuseReads = false;
    await client.refreshNativeTbar(); // the inspector opened again, OBS's window back
    expect(client.getNativeTbarStatus()).toBe("following");
    client.stop();
    await server.stop();
    await connect({ missing: true });
    await vi.waitFor(() => expect(client.getNativeTbarStatus()).toBe("unavailable"), { timeout: 3000 });
    client.stop();
    await server.stop();
    await connect({ version: "34.0.0" });
    expect(client.getNativeTbarStatus()).toBe("version");
    client.stop();
    await server.stop();

    server = new FakeObsServer({ obsVersion: "33.0.1" });
    const macPort = await server.start();
    let denyPermission = true;
    const macNative: NativeTbar = {
      read: async () => {
        if (denyPermission) {
          throw new NativeTbarRefusal("Allow Stream Deck in Accessibility.", "permission");
        }
        return server.nativeSlider / 1023;
      },
      move: async (_from, to) => {
        server.moveNativeSlider(nativeTick(to));
        return to;
      },
      close: () => {}
    };
    client = new DirectObsClient(
      { host: "127.0.0.1", port: macPort, password: "" },
      { nativeTbar: () => macNative, nativePlatform: "darwin" }
    );
    client.start();
    await vi.waitFor(() => expect(client.getNativeTbarStatus()).toBe("permission"), { timeout: 3000 });
    denyPermission = false;
    await client.refreshNativeTbar();
    expect(client.getNativeTbarStatus()).toBe("following");
  });

  it("updates the settings page's line from a throw, without waiting for the page to reopen", async () => {
    await connect();
    await vi.waitFor(() => expect(client.getNativeTbarStatus()).toBe("following"), { timeout: 3000 });
    const states: string[] = [];
    client.on("directStateChanged", () => states.push(client.getNativeTbarStatus()));
    native.refuseReads = true; // OBS minimised meanwhile
    await client.nudgeTbar(0.2);
    expect(client.getNativeTbarStatus()).toBe("unreachable");
    expect(states).toContain("unreachable");
  });

  it("says nothing yet when the helper is slow to answer, rather than that it could not start", async () => {
    await connect();
    await vi.waitFor(() => expect(client.getNativeTbarStatus()).toBe("following"), { timeout: 3000 });
    native.read = async () => { throw new NativeTbarTimeout("The OBS slider helper did not answer."); };
    await client.refreshNativeTbar();
    expect(client.getNativeTbarStatus()).toBe("off");
  });

  it("says nothing about OBS's slider while Studio Mode is off", async () => {
    await connect();
    server.setStudioModeExternally(false);
    await vi.waitFor(() => expect(client.getCatalog().studioMode).toBe(false), { timeout: 3000 });
    expect(client.getNativeTbarStatus()).toBe("off");
  });

  it("stops a throw whose slider was moved by hand, and starts the next one from rest", async () => {
    await connect();
    await client.nudgeTbar(0.2);
    server.moveNativeSlider(700); // a mouse in OBS's window
    await expect(client.nudgeTbar(0.1)).rejects.toThrow();
    expect(client.getCatalog().tbarPosition).toBe(0);
  });

  it("ends the helper with the connection", async () => {
    await connect();
    await client.nudgeTbar(0.2);
    await server.stop();
    await vi.waitFor(() => expect(native.closed).toBeGreaterThan(0), { timeout: 3000 });
    expect(client.getCatalog().tbarPosition).toBe(0);
  });

  it("forgets the position after OBS ends the transition, but not for a late end of an earlier one", async () => {
    await connect({ native: false });
    await client.nudgeTbar(0.3);
    server.emitObsEvent("SceneTransitionEnded", { transitionName: server.currentTransitionName });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.getCatalog().tbarPosition).toBeCloseTo(0.3); // OBS's manual transition is still under way
    server.manualTransitionActive = false; // a hand let go of OBS's own T-bar
    server.emitObsEvent("SceneTransitionEnded", { transitionName: server.currentTransitionName });
    await vi.waitFor(() => expect(client.getCatalog().tbarPosition).toBe(0), { timeout: 3000 });
  });

  it("forgets a stale position when Studio Mode is turned off and on", async () => {
    await connect({ native: false });
    await client.nudgeTbar(0.3);
    expect(client.getCatalog().tbarPosition).toBeCloseTo(0.3);
    server.setStudioModeExternally(false);
    server.setStudioModeExternally(true);
    await vi.waitFor(() => expect(client.getCatalog().tbarPosition).toBe(0), { timeout: 3000 });
  });

  it("holds a mid-fade blend open on OBS's slider, reverses cleanly, and completes or cancels on command", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    const next = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.45);
    expect(server.nativeSlider).toBe(nativeTick(0.45));
    expect(server.manualTransitionActive).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120)); // hold mid-fade
    expect(server.manualTransitionActive).toBe(true);
    await client.nudgeTbar(-0.2); // reverse part-way
    expect(server.nativeSlider).toBe(nativeTick(0.25));
    expect(client.getTbarScenes()).toEqual({ live, next });
    await client.nudgeTbar(-0.24); // into cancel rail (<= 3 %)
    expect(server.manualTransitionActive).toBe(false);
    expect(server.programSceneName).toBe(live);
    expect(tbarWrites()).toEqual([{ position: 0, release: true }]);

    await rest();
    await client.nudgeTbar(0.6);
    await client.nudgeTbar(-0.3);
    expect(server.nativeSlider).toBe(nativeTick(0.3));
    await client.nudgeTbar(0.7); // reverse forward to finish
    expect(server.manualTransitionActive).toBe(false);
    expect(server.programSceneName).toBe(next);
    expect(tbarWrites()).toEqual([{ position: 0, release: true }, { position: 1, release: true }]);
    expect(server.directCallLog.some((call) => call.requestType === "SetStudioModeEnabled")).toBe(false);
  });

  it("coalesces 200 rapid encoder ticks while one UIA write is slow into <= 1 in flight + 1 pending, keeping reversals and latched endpoints", async () => {
    await connect();
    const origMove = native.move.bind(native);
    let inFlight = 0;
    let maxInFlight = 0;
    native.move = async (from: number, to: number): Promise<number> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 35));
        return await origMove(from, to);
      } finally {
        inFlight--;
      }
    };

    // 100 forward ticks (+0.005 = +0.50) then 40 reverse ticks (-0.005 = -0.20) => net 0.30
    const burst: Promise<number>[] = [];
    for (let i = 0; i < 100; i++) burst.push(client.nudgeTbar(0.005));
    for (let i = 0; i < 40; i++) burst.push(client.nudgeTbar(-0.005));
    await Promise.all(burst);
    expect(maxInFlight).toBe(1);
    expect(native.moves.length).toBeLessThanOrEqual(3);
    expect(server.nativeSlider).toBe(nativeTick(0.3));

    // Now burst past finish (+0.70 => 1.00) followed by bounce ticks (-0.05) and extra take ticks (+0.20):
    // latched take must still win and emit SetTBarPosition release:true once!
    const finishBurst: Promise<number>[] = [
      client.nudgeTbar(0.1),
      client.nudgeTbar(0.65),
      client.nudgeTbar(-0.05),
      client.nudgeTbar(0.2),
      client.nudgeTbar(0.2)
    ];
    await Promise.all(finishBurst);
    expect(maxInFlight).toBe(1);
    expect(server.manualTransitionActive).toBe(false);
    expect(tbarWrites()).toEqual([{ position: 1, release: true }]);
  });

  it("pins the chosen backend for the entire throw and never switches from toggle to native mid-throw", async () => {
    await connect();
    native.refuseReads = true; // UIA unavailable at rest => throw pins to "toggle"
    await client.nudgeTbar(0.25);
    expect(native.moves).toEqual([]);
    expect(tbarWrites()).toEqual([{ position: 0.25, release: false }]);

    native.refuseReads = false; // OBS window restored mid-throw!
    await client.nudgeTbar(0.25);
    expect(native.moves).toEqual([]); // still pinned to "toggle" for this throw
    expect(tbarWrites()).toEqual([{ position: 0.25, release: false }, { position: 0.5, release: false }]);
    await client.takeTbar();
    expect(native.moves).toEqual([]);
    expect(server.directCallLog.some((call) => call.requestType === "SetStudioModeEnabled")).toBe(true);

    // Next throw from rest picks up native cleanly!
    await rest();
    await client.nudgeTbar(0.3);
    expect(server.nativeSlider).toBe(nativeTick(0.3));
  });

  it("closes an open fade automatically via reconciliation read + release when a mid-fade step times out transiently", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    await client.nudgeTbar(0.4);
    expect(server.manualTransitionActive).toBe(true);

    const origMove = native.move.bind(native);
    let failOnce = true;
    native.move = async (from: number, to: number): Promise<number> => {
      if (failOnce) {
        failOnce = false;
        server.moveNativeSlider(512); // write landed late on OBS's slider
        throw new NativeTbarTimeout("UIA call exceeded 80 ms");
      }
      return origMove(from, to);
    };

    await client.nudgeTbar(0.1);
    expect(server.manualTransitionActive).toBe(false);
    expect(server.programSceneName).toBe(live); // reconciled back to 0 and released cleanly
    expect(tbarWrites()).toEqual([{ position: 0, release: true }]);
    expect(server.directCallLog.some((call) => call.requestType === "SetStudioModeEnabled")).toBe(false);
    expect(client.getCatalog().tbarPosition).toBe(0);
  });

  it("closes via Studio Mode toggle when the UIA backend dies mid-fade with the slider stuck mid-range: restores Program/Preview below 0.5 and finishes at >= 0.5, never leaving Transition locked", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    const next = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.45);
    expect(server.manualTransitionActive).toBe(true);
    expect(server.nativeSlider).toBe(nativeTick(0.45));

    // OBS is minimised mid-fade below 0.5: UIA can neither move nor read the slider, and slider is stuck at ~460 (in 103..920)
    const origMove = native.move.bind(native);
    native.refuseReads = true;
    native.move = async () => {
      throw new NativeTbarRefusal("The main OBS window is minimised.", "minimised");
    };

    await client.nudgeTbar(0.15);
    expect(server.manualTransitionActive).toBe(false); // Transition button is NOT locked!
    expect(server.programSceneName).toBe(live); // < 0.5 restores starting Program/Preview!
    expect(server.previewSceneName).toBe(next);
    expect(client.getCatalog().tbarPosition).toBe(0);
    expect(client.getNativeTbarStatus()).toBe("unreachable");

    // Restore window and verify >= 0.5 (0.55) finishes to Next!
    native.refuseReads = false;
    native.move = origMove;
    await client.nudgeTbar(0.55);
    expect(server.manualTransitionActive).toBe(true);
    expect(server.nativeSlider).toBe(nativeTick(0.55));
    native.refuseReads = true;
    native.move = async () => {
      throw new NativeTbarRefusal("The main OBS window is minimised.", "minimised");
    };

    await client.nudgeTbar(0.15);
    expect(server.manualTransitionActive).toBe(false);
    expect(server.programSceneName).toBe(next);
    expect(server.previewSceneName).toBe(live);
    expect(client.getCatalog().tbarPosition).toBe(0);
    expect(client.getNativeTbarStatus()).toBe("unreachable");
  });

  it("finishes a native fade when Preview changes mid-throw and preserves the newly cued Preview scene", async () => {
    await connect();
    const next = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.3);
    server.previewSceneName = "Scene 3";
    server.emitObsEvent("CurrentPreviewSceneChanged", { sceneName: "Scene 3" });
    await vi.waitFor(() => expect(client.getCatalog().currentPreviewScene).toBe("Scene 3"), { timeout: 3000 });
    await client.nudgeTbar(0.7); // finish on native slider
    expect(server.programSceneName).toBe(next);
    expect(server.previewSceneName).toBe("Scene 3");
    expect(server.manualTransitionActive).toBe(false);
    expect(server.directCallLog.some((call) => call.requestType === "SetStudioModeEnabled")).toBe(false);
  });

  it("invalidates cached UIA handles when Studio Mode turns off and on", async () => {
    await connect();
    let invalidated = 0;
    (native as NativeTbar).invalidate = () => {
      invalidated++;
    };
    server.setStudioModeExternally(false);
    server.setStudioModeExternally(true);
    await vi.waitFor(() => expect(invalidated).toBeGreaterThanOrEqual(2), { timeout: 3000 });
  });

  it("picks up an open real-slider fade after a mid-fade plugin restart and finishes or cancels it without leaving Studio Mode", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    const next = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.4);
    expect(server.manualTransitionActive).toBe(true);
    expect(server.nativeSlider).toBe(nativeTick(0.4));

    // Simulate plugin restart while OBS still holds the real slider at ~409
    const port = obsPort;
    client.stop();
    const native2 = new FakeNative(server);
    client = new DirectObsClient(
      { host: "127.0.0.1", port, password: "" },
      { nativeTbar: () => native2, nativePlatform: "win32" }
    );
    client.start();
    await vi.waitFor(() => expect(client.getStatus().kind).toBe("connected"), { timeout: 3000 });
    await vi.waitFor(() => expect(client.getCatalog().tbarPosition).toBeCloseTo(0.4, 1), { timeout: 3000 });

    // Cancel the picked-up real-slider fade back to Live!
    await client.nudgeTbar(-0.5);
    expect(server.manualTransitionActive).toBe(false);
    expect(server.nativeSlider).toBe(0);
    expect(server.programSceneName).toBe(live);
    expect(server.previewSceneName).toBe(next);
    expect(server.directCallLog.some((call) => call.requestType === "SetStudioModeEnabled")).toBe(false);
  });

  it("picks up an open real-slider fade immediately while OBS 33's manual cursor is still easing after a mouse drag or restart", async () => {
    await connect();
    await client.nudgeTbar(-0.1); // drain initial post-connect pickup
    const next = client.getCatalog().currentPreviewScene;

    // Operator drags OBS's T-bar halfway: OBS emits SceneTransitionStarted, sets Program = Next, and eases cursor 0 -> 0.5
    server.moveNativeSlider(512);
    server.emitObsEvent("SceneTransitionStarted", { transitionName: "Fade" });
    server.cursorScript = [0, 0.22, 0.34, 0.42];

    await client.nudgeTbar(0.2);
    expect(server.nativeSlider).toBe(nativeTick(512 / 1023 + 0.2));
    await client.nudgeTbar(0.35);
    expect(server.manualTransitionActive).toBe(false);
    expect(server.programSceneName).toBe(next);
    expect(server.nativeSlider).toBe(0);
    expect(server.directCallLog.some((call) => call.requestType === "SetStudioModeEnabled")).toBe(false);
  });

  it("never triggers a fallback Studio Mode toggle take when OBS's resting transition cursor is 1.0 after an ended fade", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    const next = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.3);
    expect(server.manualTransitionActive).toBe(true);

    // Suppose OBS finishes or cancels externally and rests at cursor === 1.0 (as OBS 33 does after a completed transition),
    // and then the OBS window is minimised right before the next dial tick.
    server.manualTransitionActive = false;
    server.nativeSlider = 0;
    server.programSceneName = live;
    server.previewSceneName = next;
    server.cursorScript = [1.0, 1.0];
    native.move = async () => {
      throw new NativeTbarRefusal("The main OBS window is minimised.", "minimised");
    };

    await client.nudgeTbar(0.2);
    expect(server.directCallLog.some((call) => call.requestType === "SetStudioModeEnabled")).toBe(false);
    expect(server.programSceneName).toBe(live);
    expect(client.getCatalog().tbarPosition).toBe(0);
    expect(client.getNativeTbarStatus()).toBe("unreachable");
  });

  it("drops coalesced nudges queued before an explicit cancel so they cannot reopen a cancelled fade", async () => {
    await connect();
    let releaseFirstMove!: () => void;
    const firstMoveGate = new Promise<void>((res) => {
      releaseFirstMove = res;
    });
    const origMove = native.move.bind(native);
    let gated = true;
    native.move = async (from: number, to: number) => {
      if (gated) {
        gated = false;
        await firstMoveGate;
      }
      return origMove(from, to);
    };

    const p1 = client.nudgeTbar(0.3);
    await vi.waitFor(() => expect(gated).toBe(false), { timeout: 1000 });
    const p2 = client.nudgeTbar(0.25); // coalesced while p1 is still in flight
    const cancel = client.setTbarPosition(0); // explicit cancel must drop p2!
    releaseFirstMove();
    await Promise.all([p1, p2, cancel]);

    expect(server.manualTransitionActive).toBe(false);
    expect(server.nativeSlider).toBe(0);
    expect(client.getCatalog().tbarPosition).toBe(0);
  });

  it("evaluates coalesced nudges against the actual T-bar position when an opening step waits out a timed transition", async () => {
    await connect();
    // Ensure the post-connect pickUpOpenFade check has drained before scripting the timed transition cursor.
    await client.nudgeTbar(-0.1);
    const next = client.getCatalog().currentPreviewScene;

    // OBS reports a timed transition in progress during Step 1 (4 cursor samples across pickUpOpenFadeOrRetry).
    server.emitObsEvent("SceneTransitionStarted", { transitionName: "Fade" });
    await new Promise((res) => setTimeout(res, 15));
    server.cursorScript = [0.2, 0.4, 0.6, 0.8];

    const p1 = client.nudgeTbar(0.25);
    await new Promise((res) => setTimeout(res, 10));
    // Queued while p1 is waiting out the timed transition: 0.25 + 0.8 >= 1 would prematurely latch a take if projected
    // optimistically, whereas actual tbarPosition stays 0 so Step 2 must land at 0.8 instead of taking!
    const p2 = client.nudgeTbar(0.8);
    await Promise.all([p1, p2]);

    expect(server.manualTransitionActive).toBe(true);
    expect(server.nativeSlider).toBe(nativeTick(0.8));
    expect(client.getCatalog().tbarPosition).toBeCloseTo(0.8, 2);
    expect(server.tbarCompletionCount).toBe(0);
    expect(server.programSceneName).not.toBe(next);
  });

  it("refreshes Program and Preview when a mid-restart open fade is cancelled in OBS's own window", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    const next = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.5);
    expect(server.manualTransitionActive).toBe(true);

    const port = obsPort;
    client.stop();
    const native2 = new FakeNative(server);
    client = new DirectObsClient(
      { host: "127.0.0.1", port, password: "" },
      { nativeTbar: () => native2, nativePlatform: "darwin" }
    );
    client.start();
    await vi.waitFor(() => expect(client.getStatus().kind).toBe("connected"), { timeout: 3000 });
    await vi.waitFor(() => expect(client.getCatalog().tbarPosition).toBeGreaterThan(0.4), { timeout: 3000 });
    expect(client.getCatalog().currentProgramScene).toBe(next);
    expect(client.getCatalog().currentPreviewScene).toBe(next);

    // Operator drags OBS's own T-bar back to 0: OBS cancels without emitting CurrentProgramSceneChanged.
    server.nativeSlider = 0;
    server.directTbarPosition = 0;
    server.manualTransitionActive = false;
    server.emitObsEvent("SceneTransitionEnded", { transitionName: server.currentTransitionName });

    await vi.waitFor(() => {
      expect(client.getCatalog().tbarPosition).toBe(0);
      expect(client.getCatalog().currentProgramScene).toBe(live);
      expect(client.getCatalog().currentPreviewScene).toBe(next);
    }, { timeout: 3000 });

    await client.nudgeTbar(0.25);
    expect(server.nativeSlider).toBe(nativeTick(0.25));
  });

  it("waits for OBS to restore the original Program scene when cancelling a mid-restart open fade with the dial", async () => {
    await connect();
    const live = client.getCatalog().currentProgramScene;
    const next = client.getCatalog().currentPreviewScene;
    await client.nudgeTbar(0.5);

    const port = obsPort;
    client.stop();
    const native2 = new FakeNative(server);
    client = new DirectObsClient(
      { host: "127.0.0.1", port, password: "" },
      { nativeTbar: () => native2, nativePlatform: "darwin" }
    );
    client.start();
    await vi.waitFor(() => expect(client.getStatus().kind).toBe("connected"), { timeout: 3000 });
    await vi.waitFor(() => expect(client.getCatalog().tbarPosition).toBeGreaterThan(0.4), { timeout: 3000 });

    const origSend = (client as unknown as { sendObsRequest: (type: string, data?: Record<string, unknown>) => Promise<Record<string, unknown>> }).sendObsRequest.bind(client);
    let sawRelease = false;
    let stalePollsRemaining = 2;
    vi.spyOn(client as unknown as { sendObsRequest: typeof origSend }, "sendObsRequest").mockImplementation(async (type, data) => {
      if (type === "SetTBarPosition" && data?.release === true) {
        sawRelease = true;
      }
      if (sawRelease && type === "GetCurrentProgramScene" && stalePollsRemaining > 0) {
        stalePollsRemaining--;
        return { currentProgramSceneName: next, sceneName: next };
      }
      return origSend(type, data);
    });

    await client.nudgeTbar(-0.6);
    expect(stalePollsRemaining).toBe(0);
    expect(client.getCatalog().tbarPosition).toBe(0);
    expect(client.getCatalog().currentProgramScene).toBe(live);
    expect(client.getCatalog().currentPreviewScene).toBe(next);
  });
});

class FakeUiaWorker extends EventEmitter implements UiaWorkerLike {
  public requests: UiaWorkerRequest[] = [];
  public terminated = 0;
  public slider = 0;
  public mode: "ok" | "admin" | "permission" | "minimised" | "unavailable" | "uncertain" | "hang" = "ok";
  private hungRequest: UiaWorkerRequest | null = null;

  public constructor(bootReady = true, bootError = "koffi load failed", bootDelayMs = 0) {
    super();
    const fire = (): void => {
      if (bootReady) this.emit("message", { ready: true });
      else this.emit("message", { ready: false, message: bootError });
    };
    if (bootDelayMs > 0) setTimeout(fire, bootDelayMs);
    else queueMicrotask(fire);
  }

  public postMessage(msg: UiaWorkerRequest): void {
    this.requests.push(msg);
    if (msg.op === "close" || msg.op === "forget") {
      queueMicrotask(() => this.emit("message", { seq: msg.seq, generation: msg.generation, status: "ok", value: 0 }));
      return;
    }
    if (this.mode === "hang") {
      this.hungRequest = msg;
      return;
    }
    queueMicrotask(() => this.respond(msg));
  }

  public releaseHung(landedValue = this.slider): void {
    const req = this.hungRequest;
    this.hungRequest = null;
    this.slider = landedValue;
    if (req) {
      this.emit("message", { seq: req.seq, generation: req.generation, status: "ok", value: landedValue });
    }
  }

  private respond(msg: UiaWorkerRequest): void {
    if (this.mode === "admin") {
      this.emit("message", { seq: msg.seq, generation: msg.generation, status: "refusal", message: "OBS is running as administrator.", reason: "admin" });
      return;
    }
    if (this.mode === "permission") {
      this.emit("message", { seq: msg.seq, generation: msg.generation, status: "refusal", message: "Accessibility denied.", reason: "permission" });
      return;
    }
    if (this.mode === "minimised") {
      this.emit("message", { seq: msg.seq, generation: msg.generation, status: "refusal", message: "The main OBS window is minimised.", reason: "minimised" });
      return;
    }
    if (this.mode === "unavailable") {
      this.emit("message", { seq: msg.seq, generation: msg.generation, status: "refusal", message: "COM UIA2 missing", reason: "unavailable" });
      return;
    }
    if (this.mode === "uncertain") {
      this.emit("message", { seq: msg.seq, generation: msg.generation, status: "uncertain", message: "SetValue unconfirmed" });
      return;
    }
    if (msg.op === "read") {
      this.emit("message", { seq: msg.seq, generation: msg.generation, status: "ok", value: this.slider });
      return;
    }
    if (msg.op === "move") {
      if (this.slider !== msg.expected) {
        this.emit("message", { seq: msg.seq, generation: msg.generation, status: "refusal", message: `T-bar moved; actual ${this.slider}`, reason: "moved" });
        return;
      }
      this.slider = msg.desired ?? 0;
      this.emit("message", { seq: msg.seq, generation: msg.generation, status: "ok", value: this.slider });
    }
  }

  public async terminate(): Promise<number> {
    this.terminated++;
    return 0;
  }
}

describe("NativeTbarUia worker adapter", () => {
  const adapters: NativeTbarUia[] = [];
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    delete process.env.FADESTER_NO_AX_PROMPT;
    for (const a of adapters.splice(0)) a.close();
    for (const s of servers.splice(0)) await new Promise<void>((res) => s.close(() => res()));
    for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("reads, moves, parks, invalidates, and maps refusal/unavailable/uncertain replies", async () => {
    let worker!: FakeUiaWorker;
    const uia = new NativeTbarUia(4455, {
      workerFactory: () => {
        worker = new FakeUiaWorker();
        return worker;
      }
    });
    adapters.push(uia);

    expect(await uia.read()).toBe(0);
    expect(nativeTick(await uia.move(0, 0.5))).toBe(512);
    expect(nativeTick(await uia.read())).toBe(512);

    // Park-wait: move(0, 0) polls read until OBS resets slider to 0
    worker.slider = 512;
    setTimeout(() => { worker.slider = 0; }, 40);
    expect(await uia.move(0, 0)).toBe(0);

    // Invalidate queues a forget before the next call
    uia.invalidate();
    expect(await uia.read()).toBe(0);
    expect(worker.requests.some((r) => r.op === "forget")).toBe(true);

    // Uncertain write blocks further moves until a fresh read succeeds
    worker.mode = "uncertain";
    await expect(uia.move(0, 0.4)).rejects.toBeInstanceOf(NativeTbarUncertain);
    worker.mode = "ok";
    await expect(uia.move(0, 0.4)).rejects.toBeInstanceOf(NativeTbarUncertain);
    expect(await uia.read()).toBe(0);
    expect(nativeTick(await uia.move(0, 0.25))).toBe(256);

    // Refusal reasons and unavailable mapping
    worker.mode = "admin";
    await expect(uia.read()).rejects.toMatchObject({ reason: "admin" });
    worker.mode = "permission";
    await expect(uia.read()).rejects.toMatchObject({ reason: "permission" });
    worker.mode = "unavailable";
    await expect(uia.read()).rejects.toBeInstanceOf(NativeTbarUnavailable);
  });

  it("quarantines a timed-out call as busy-tainted without terminating mid-call, drains the late reply, and clears taint only after read()", async () => {
    let worker!: FakeUiaWorker;
    const uia = new NativeTbarUia(4455, {
      callTimeoutMs: 50,
      taintDrainMs: 400,
      workerFactory: () => {
        worker = new FakeUiaWorker();
        return worker;
      }
    });
    adapters.push(uia);

    expect(await uia.read()).toBe(0);
    worker.mode = "hang";
    await expect(uia.move(0, 0.5)).rejects.toBeInstanceOf(NativeTbarTimeout);
    expect(worker.terminated).toBe(0); // NEVER terminate a COM worker mid-call!

    // Moves are refused while busy-tainted
    await expect(uia.move(0.5, 1)).rejects.toBeInstanceOf(NativeTbarUncertain);

    // Late reply arrives after 30 ms while reconciliation read() is waiting to drain
    worker.mode = "ok";
    setTimeout(() => worker.releaseHung(512), 30);
    expect(nativeTick(await uia.read())).toBe(512);

    // Taint is now cleared; moves work again
    expect(await uia.move(512 / 1023, 1)).toBe(1);
    uia.close();
    await vi.waitFor(() => expect(worker.terminated).toBe(1), { timeout: 1000 });
  });

  it("treats mid-call invalidate() as uncertain+tainted for moves, refusal for reads, and flushes forget afterwards", async () => {
    let worker!: FakeUiaWorker;
    const uia = new NativeTbarUia(4455, {
      callTimeoutMs: 500,
      workerFactory: () => {
        worker = new FakeUiaWorker();
        return worker;
      }
    });
    adapters.push(uia);

    expect(await uia.read()).toBe(0);
    const beforeReadCount = worker.requests.length;

    // Mid-flight read invalidated -> NativeTbarRefusal (not tainted)
    worker.mode = "hang";
    const reading = uia.read();
    await vi.waitFor(() => expect(worker.requests.length).toBe(beforeReadCount + 1), { timeout: 500 });
    uia.invalidate();
    worker.releaseHung(0);
    await expect(reading).rejects.toBeInstanceOf(NativeTbarRefusal);

    // Mid-flight move invalidated -> NativeTbarUncertain + tainted until read()
    const moving = uia.move(0, 0.5);
    await vi.waitFor(() => expect(worker.requests.at(-1)?.op).toBe("move"), { timeout: 500 });
    uia.invalidate();
    worker.releaseHung(512);
    await expect(moving).rejects.toBeInstanceOf(NativeTbarUncertain);

    worker.mode = "ok";
    await expect(uia.move(0.5, 1)).rejects.toBeInstanceOf(NativeTbarUncertain);
    expect(nativeTick(await uia.read())).toBe(512);
    expect(worker.requests.some((r) => r.op === "forget")).toBe(true);
    expect(await uia.move(512 / 1023, 1)).toBe(1);
  });

  it("survives a transient cold-boot timeout without permanently latching bootFailure or spawning a duplicate worker", async () => {
    let spawns = 0;
    let worker!: FakeUiaWorker;
    const uia = new NativeTbarUia(4455, {
      bootTimeoutMs: 40,
      callTimeoutMs: 500,
      workerFactory: () => {
        spawns++;
        worker = new FakeUiaWorker(true, "", 85);
        return worker;
      }
    });
    adapters.push(uia);

    await expect(uia.read()).rejects.toBeInstanceOf(NativeTbarTimeout);
    expect(spawns).toBe(1);
    expect(worker.terminated).toBe(0);

    await new Promise((res) => setTimeout(res, 70));
    expect(await uia.read()).toBe(0);
    expect(spawns).toBe(1);
  });

  it.runIf(process.platform === "win32")("boots the staged uia-worker.js + packaged koffi.node in an isolated folder outside repo node_modules", async () => {
    const isolated = mkdtempSync(join(tmpdir(), "fadester-staged-uia-"));
    tempDirs.push(isolated);

    const builtWorker = builtUiaWorkerPath();
    if (builtWorker) {
      const builtBinDir = dirname(builtWorker);
      cpSync(builtWorker, join(isolated, "uia-worker.js"));
      cpSync(join(builtBinDir, "node_modules", "koffi"), join(isolated, "node_modules", "koffi"), { recursive: true });
    } else {
      const [{ rollup }, { default: typescript }, { default: nodeResolve }, { default: commonjs }, { stageKoffi }] = await Promise.all([
        import("rollup"),
        import("@rollup/plugin-typescript"),
        import("@rollup/plugin-node-resolve"),
        import("@rollup/plugin-commonjs"),
        import("../scripts/native/stage-koffi.mjs")
      ]);
      const bundle = await rollup({
        input: "src/obs/uia/uia-worker.ts",
        external: [/^node:/, "koffi"],
        plugins: [
          typescript({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts", "packages/**/*.ts"] }),
          nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
          commonjs()
        ]
      });
      await bundle.write({
        file: join(isolated, "uia-worker.js"),
        format: "esm",
        inlineDynamicImports: true
      });
      await bundle.close();
      stageKoffi(undefined, isolated);
    }

    // Listen on an ephemeral local TCP port owned by node.exe so listenerPid + COM IUIAutomation2 run end-to-end
    // and refuse cleanly because node.exe is not obs64.exe!
    const srv = createServer();
    servers.push(srv);
    await new Promise<void>((res) => srv.listen(0, "127.0.0.1", () => res()));
    const address = srv.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    const uia = new NativeTbarUia(port, {
      workerPath: join(isolated, "uia-worker.js"),
      callTimeoutMs: 500
    });
    adapters.push(uia);

    await expect(uia.read()).rejects.toThrow(/not the OBS process/i);
  });

  it.runIf(process.platform === "darwin")("boots the staged ax-worker.js + packaged darwin koffi.node in an isolated folder outside repo node_modules", async () => {
    process.env.FADESTER_NO_AX_PROMPT = "1";
    const isolated = mkdtempSync(join(tmpdir(), "fadester-staged-ax-"));
    tempDirs.push(isolated);

    const builtWorker = builtAxWorkerPath();
    if (builtWorker) {
      const builtBinDir = dirname(builtWorker);
      cpSync(builtWorker, join(isolated, "ax-worker.js"));
      cpSync(join(builtBinDir, "node_modules", "koffi"), join(isolated, "node_modules", "koffi"), { recursive: true });
    } else {
      const [{ rollup }, { default: typescript }, { default: nodeResolve }, { default: commonjs }, { stageKoffi }] = await Promise.all([
        import("rollup"),
        import("@rollup/plugin-typescript"),
        import("@rollup/plugin-node-resolve"),
        import("@rollup/plugin-commonjs"),
        import("../scripts/native/stage-koffi.mjs")
      ]);
      const bundle = await rollup({
        input: "src/obs/ax/ax-worker.ts",
        external: [/^node:/, "koffi"],
        plugins: [
          typescript({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts", "packages/**/*.ts"] }),
          nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
          commonjs()
        ]
      });
      await bundle.write({
        file: join(isolated, "ax-worker.js"),
        format: "esm",
        inlineDynamicImports: true
      });
      await bundle.close();
      stageKoffi(undefined, isolated);
    }

    // Listen on ephemeral local TCP ports (both IPv4 127.0.0.1 and IPv4-mapped IPv6 ::ffff:127.0.0.1) owned by node so
    // libproc listenerPid + CoreFoundation CFBundle verification run end-to-end without TCC prompts and refuse cleanly!
    for (const host of ["127.0.0.1", "::ffff:127.0.0.1"]) {
      const srv = createServer();
      servers.push(srv);
      await new Promise<void>((res) => srv.listen(0, host, () => res()));
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      expect(port).toBeGreaterThan(0);

      const ax = new NativeTbarUia(port, {
        workerPath: join(isolated, "ax-worker.js"),
        callTimeoutMs: 500
      });
      adapters.push(ax);

      await expect(ax.read()).rejects.toThrow(/not the OBS process/i);
    }
  });
});
