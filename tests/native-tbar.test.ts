// SPDX-License-Identifier: GPL-2.0-or-later
// The bundled T-bar helper's driver (src/obs/native-tbar.ts) and the dial's throws on OBS's real slider
// (direct-obs-client.ts), against a stand-in helper and the fake OBS's model of OBS 33's T-bar widget.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import {
  NativeTbar,
  NativeTbarHelper,
  NativeTbarRefusal,
  NativeTbarUncertain,
  nativeTbarEligible,
  nativeTick
} from "../src/obs/native-tbar.js";
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

  it("is only used for a local OBS 33 on Windows", () => {
    expect(nativeTbarEligible("win32", "127.0.0.1", "33.0.1")).toBe(true);
    expect(nativeTbarEligible("win32", "localhost", "33.0.0")).toBe(true);
    expect(nativeTbarEligible("win32", "::1", "33.1.0")).toBe(true);
    expect(nativeTbarEligible("win32", "127.0.0.1", "33.0.1-rc1")).toBe(true);
    expect(nativeTbarEligible("win32", "192.168.1.20", "33.0.1")).toBe(false);
    expect(nativeTbarEligible("darwin", "127.0.0.1", "33.0.1")).toBe(false);
    expect(nativeTbarEligible("win32", "127.0.0.1", "32.0.4")).toBe(false);
    expect(nativeTbarEligible("win32", "127.0.0.1", "34.0.0")).toBe(false);
    expect(nativeTbarEligible("win32", "127.0.0.1", "330.0.0")).toBe(false);
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

  async function connect(options: { native?: boolean; version?: string; host?: string } = {}): Promise<void> {
    server = new FakeObsServer({ obsVersion: options.version ?? "33.0.1" });
    const port = await server.start();
    native = new FakeNative(server);
    client = new DirectObsClient(
      { host: options.host ?? "127.0.0.1", port, password: "" },
      { nativeTbar: options.native === false ? false : () => native, nativePlatform: "win32" }
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
});
