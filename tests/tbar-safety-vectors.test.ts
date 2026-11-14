// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DirectObsClient,
  NATIVE_CANCEL_MAX_TICK,
  NATIVE_FINISH_MIN_TICK,
  TBAR_RAIL,
  TBAR_SETTLE_MS
} from "../src/obs/direct-obs-client.js";
import {
  NATIVE_TBAR_MAX,
  NativeTbar,
  NativeTbarRefusal,
  NativeTbarTimeout,
  nativeTbarEligible,
  nativeTick
} from "../src/obs/native-tbar.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

interface TbarSafetyVectors {
  contract_version: number;
  constants: {
    slider_max: number;
    obs_finish_min_tick: number;
    obs_cancel_max_tick: number;
    controller_rail_zone: number;
    companion_edge: number;
    midi_start_deadband: number;
  };
  tick_vectors: Array<{
    id: string;
    normalized: number;
    tick: number;
    obs_release_zone: "cancel" | "open" | "finish";
  }>;
  release_once_vectors: Array<{
    id: string;
    steps: Array<{ position: number }>;
    contract_expected: {
      releases: number;
      post_release_writes: number;
      final_scene: "preview" | "program";
      transition_left_open: boolean;
    };
  }>;
  failure_vectors: Array<{
    id: string;
    kind: "pre_write_refusal" | "mid_throw_uncertain";
    throw_position: number;
    attempt_position: number;
    contract_expected: {
      writes_replayed: number;
      needs_operator_reset: boolean;
      transition_left_open: boolean;
      outcome: string;
      final_scene?: "program" | "preview";
      companion_final_scene?: "program" | "preview";
    };
    known_divergences?: Record<string, { decision_id: string }>;
  }>;
  reconnect_vectors: Array<{
    id: string;
    samples: Array<{ cursor: number }>;
    reconnect_transition?: string;
    contract_expected: { action: "adopt_open_throw" | "leave_alone" };
    known_divergences?: Record<string, { decision_id: string }>;
  }>;
  version_gate_vectors: Array<{
    id: string;
    platform: string;
    host: string;
    obs_version: string;
    contract_expected: { eligible: boolean };
    known_divergences?: Record<string, { decision_id: string }>;
  }>;
  controller_disconnect_vectors: Array<{
    id: string;
    throw_position: number;
    contract_expected: { slot_state: string; transition_left_open: boolean };
    known_divergences?: Record<string, { decision_id: string }>;
  }>;
}

const vectorsPath = resolve(process.cwd(), "tests/vectors/tbar-safety.json");
const contractDocPath = resolve(process.cwd(), "docs/TBAR-SAFETY-CONTRACT.md");
const vectors: TbarSafetyVectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as TbarSafetyVectors;

function classifyReleaseZone(tick: number): "cancel" | "open" | "finish" {
  if (tick <= NATIVE_CANCEL_MAX_TICK) return "cancel";
  if (tick >= NATIVE_FINISH_MIN_TICK) return "finish";
  return "open";
}

class ScriptedNative implements NativeTbar {
  public moves: Array<[number, number]> = [];
  public refuseAllWrites = false;
  public dead = false;
  public failOnMoveAttempt = -1;
  private moveAttempts = 0;

  public constructor(private readonly obs: FakeObsServer) {}

  public async read(): Promise<number> {
    if (this.dead) throw new NativeTbarTimeout("Native helper exited.");
    return this.obs.nativeSlider / NATIVE_TBAR_MAX;
  }

  public async move(from: number, to: number): Promise<number> {
    this.moveAttempts++;
    if (this.refuseAllWrites) {
      throw new NativeTbarRefusal("The main OBS window is minimised.", "minimised");
    }
    if (this.dead || (this.failOnMoveAttempt > 0 && this.moveAttempts >= this.failOnMoveAttempt)) {
      this.dead = true;
      throw new NativeTbarTimeout("Native helper stopped answering mid-throw.");
    }
    if (nativeTick(from) !== this.obs.nativeSlider) {
      throw new NativeTbarRefusal(`T-bar moved; actual ${this.obs.nativeSlider}`, "moved");
    }
    this.moves.push([from, to]);
    if (nativeTick(from) !== nativeTick(to)) {
      this.obs.moveNativeSlider(nativeTick(to));
    }
    return to;
  }

  public close(): void {
    // No-op in headless tests.
  }
}

describe("shared T-bar safety contract vectors (Stream Deck)", () => {
  let server: FakeObsServer | undefined;
  let client: DirectObsClient | undefined;
  let native: ScriptedNative | undefined;
  let port = 0;

  async function connectClient(obsVersion = "33.0.1"): Promise<{
    server: FakeObsServer;
    client: DirectObsClient;
    native: ScriptedNative;
  }> {
    server = new FakeObsServer({ obsVersion });
    port = await server.start();
    native = new ScriptedNative(server);
    const activeNative = native;
    client = new DirectObsClient(
      { host: "127.0.0.1", port, password: "" },
      { nativeTbar: () => activeNative, nativePlatform: "win32" }
    );
    client.start();
    await vi.waitFor(() => expect(client!.getStatus().kind).toBe("connected"), { timeout: 3000 });
    await vi.waitFor(() => expect(client!.getCatalog().studioMode).toBe(true), { timeout: 3000 });
    await vi.waitFor(
      () => expect(client!.getCatalog().currentPreviewScene).not.toBe(client!.getCatalog().currentProgramScene),
      { timeout: 3000 }
    );
    return { server, client, native };
  }

  afterEach(async () => {
    client?.stop();
    client = undefined;
    await server?.stop();
    server = undefined;
    native = undefined;
  });

  it("keeps constants and recorded decision IDs synchronized with docs/TBAR-SAFETY-CONTRACT.md", () => {
    expect(vectors.contract_version).toBe(1);
    expect(NATIVE_TBAR_MAX).toBe(vectors.constants.slider_max);
    expect(NATIVE_FINISH_MIN_TICK).toBe(vectors.constants.obs_finish_min_tick);
    expect(NATIVE_CANCEL_MAX_TICK).toBe(vectors.constants.obs_cancel_max_tick);
    expect(TBAR_RAIL).toBe(vectors.constants.controller_rail_zone);

    const doc = readFileSync(contractDocPath, "utf8");
    for (const decisionId of ["DEC-1", "DEC-2", "DEC-3", "DEC-4"]) {
      expect(doc).toContain(decisionId);
    }
    for (const group of [
      vectors.failure_vectors,
      vectors.reconnect_vectors,
      vectors.version_gate_vectors,
      vectors.controller_disconnect_vectors
    ]) {
      for (const entry of group) {
        expect(entry.known_divergences).toBeUndefined();
      }
    }
  });

  it.each(vectors.tick_vectors)("maps tick vector $id ($normalized -> $tick, $obs_release_zone)", (vec) => {
    const tick = nativeTick(vec.normalized);
    expect(tick).toBe(vec.tick);
    expect(classifyReleaseZone(tick)).toBe(vec.obs_release_zone);
  });

  it.each(vectors.version_gate_vectors)(
    "evaluates version/locality gate vector $id ($platform, $host, $obs_version)",
    (vec) => {
      expect(nativeTbarEligible(vec.platform, vec.host, vec.obs_version)).toBe(vec.contract_expected.eligible);
    }
  );

  it.each(vectors.release_once_vectors)("enforces release-once vector $id", async (vec) => {
    const h = await connectClient();
    const initialProgram = h.client.getCatalog().currentProgramScene;
    const initialPreview = h.client.getCatalog().currentPreviewScene;

    let current = 0;
    let releasedAtCallLogIndex = -1;
    let releasedAtNativeMoveCount = -1;

    for (let i = 1; i < vec.steps.length; i++) {
      const target = vec.steps[i].position;
      const delta =
        target >= 1 ? 1 : target <= 0 ? -(current > 0 ? current + 0.1 : 0.1) : Number((target - current).toFixed(6));
      await h.client.nudgeTbar(delta);
      current = h.client.getCatalog().tbarPosition;
      const releaseCountNow = h.server.directCallLog.filter(
        (call) => call.requestType === "SetTBarPosition" && call.requestData?.release === true
      ).length;
      if (releasedAtCallLogIndex < 0 && releaseCountNow > 0) {
        releasedAtCallLogIndex = h.server.directCallLog.length;
        releasedAtNativeMoveCount = h.native.moves.length;
      }
    }

    const releaseCalls = h.server.directCallLog.filter(
      (call) => call.requestType === "SetTBarPosition" && call.requestData?.release === true
    );
    const postReleaseObsWrites =
      releasedAtCallLogIndex >= 0
        ? h.server.directCallLog
            .slice(releasedAtCallLogIndex)
            .filter((call) => call.requestType === "SetTBarPosition").length
        : 0;
    const postReleaseSliderMoves =
      releasedAtNativeMoveCount >= 0 ? h.native.moves.length - releasedAtNativeMoveCount : 0;

    expect(releaseCalls).toHaveLength(vec.contract_expected.releases);
    expect(postReleaseObsWrites + postReleaseSliderMoves).toBe(vec.contract_expected.post_release_writes);
    expect(h.server.manualTransitionActive).toBe(vec.contract_expected.transition_left_open);
    expect(h.server.programSceneName).toBe(
      vec.contract_expected.final_scene === "preview" ? initialPreview : initialProgram
    );
  });

  it.each(vectors.failure_vectors)("satisfies failure recovery vector $id ($kind)", async (vec) => {
    const h = await connectClient();
    const initialProgram = h.client.getCatalog().currentProgramScene;
    const initialPreview = h.client.getCatalog().currentPreviewScene;

    if (vec.kind === "pre_write_refusal") {
      // Wait for initial post-connect probe to finish, then refuse before any native write lands.
      await vi.waitFor(() => expect(h.native.moves).toHaveLength(0), { timeout: 1000 });
      h.native.refuseAllWrites = true;
      await h.client.nudgeTbar(vec.attempt_position);
      // Stream Deck falls back cleanly to obs-websocket and cancels cleanly without any operator reset latch.
      await h.client.setTbarPosition(0);
      expect(h.native.moves).toHaveLength(vec.contract_expected.writes_replayed);
      expect(h.server.manualTransitionActive).toBe(vec.contract_expected.transition_left_open);
      // Next operation works immediately with no reset required.
      await expect(h.client.takeTbar()).resolves.toBe(0);
      return;
    }

    // Mid-throw helper death at 10%, 30%, 49%, 50%, 60%, 90%, or 95%:
    await h.client.nudgeTbar(vec.throw_position);
    expect(h.server.manualTransitionActive).toBe(true);
    expect(h.server.nativeSlider).toBe(nativeTick(vec.throw_position));

    const movesBeforeFailure = h.native.moves.length;
    h.native.failOnMoveAttempt = movesBeforeFailure + 1;

    const delta = vec.attempt_position >= 1 ? 1 : Number((vec.attempt_position - vec.throw_position).toFixed(6));
    await h.client.nudgeTbar(delta);

    expect(h.native.moves.length - movesBeforeFailure).toBe(vec.contract_expected.writes_replayed);
    expect(h.server.manualTransitionActive).toBe(vec.contract_expected.transition_left_open);
    expect(h.client.getCatalog().tbarPosition).toBe(0);

    const expectedScene = vec.contract_expected.final_scene ?? vec.contract_expected.companion_final_scene;
    expect(expectedScene).toBeDefined();
    if (expectedScene === "program") {
      expect(h.server.programSceneName).toBe(initialProgram);
      expect(h.server.previewSceneName).toBe(initialPreview);
      expect(h.server.tbarCompletionCount).toBe(0);
      expect(
        h.server.directCallLog.some(
          (call) => call.requestType === "SetTBarPosition" && call.requestData?.position === 1
        )
      ).toBe(false);
    } else {
      expect(h.server.programSceneName).toBe(initialPreview);
      expect(h.server.previewSceneName).toBe(initialProgram);
    }

    // Zero operator reset required: a subsequent take works immediately (after any post-take settle window).
    if (expectedScene === "preview") {
      await new Promise((res) => setTimeout(res, TBAR_SETTLE_MS + 40));
    }
    const nextExpectedProgram = h.client.getCatalog().currentPreviewScene;
    await expect(h.client.takeTbar()).resolves.toBe(0);
    expect(h.server.programSceneName).toBe(nextExpectedProgram);
  });

  it("never commits a Program change below 0.5 (0.10, 0.49), even if the failed attempt aimed for take, and commits at >= 0.5 (0.50, 0.90)", async () => {
    for (const throwPos of [0.1, 0.49]) {
      const h = await connectClient();
      const live = h.client.getCatalog().currentProgramScene;
      const next = h.client.getCatalog().currentPreviewScene;

      await h.client.nudgeTbar(throwPos);
      expect(h.server.nativeSlider).toBe(nativeTick(throwPos));
      h.native.dead = true;

      // Attempt a full spin to 1.0 while native is dead: last known slider position is still < 0.5,
      // so recoverFailedNativeThrow must restore Program/Preview without committing a take!
      await h.client.nudgeTbar(1);

      expect(h.server.manualTransitionActive).toBe(false);
      expect(h.server.programSceneName).toBe(live);
      expect(h.server.previewSceneName).toBe(next);
      expect(h.client.getCatalog().currentProgramScene).toBe(live);
      expect(h.client.getCatalog().currentPreviewScene).toBe(next);
      expect(h.server.tbarCompletionCount).toBe(0);
      expect(
        h.server.directCallLog.some(
          (call) => call.requestType === "SetTBarPosition" && call.requestData?.position === 1
        )
      ).toBe(false);

      h.client.stop();
      await h.server.stop();
      client = undefined;
      server = undefined;
    }

    for (const throwPos of [0.5, 0.9]) {
      const h = await connectClient();
      const live = h.client.getCatalog().currentProgramScene;
      const next = h.client.getCatalog().currentPreviewScene;

      await h.client.nudgeTbar(throwPos);
      expect(h.server.nativeSlider).toBe(nativeTick(throwPos));
      h.native.dead = true;

      await h.client.nudgeTbar(0.05);

      expect(h.server.manualTransitionActive).toBe(false);
      expect(h.server.programSceneName).toBe(next);
      expect(h.server.previewSceneName).toBe(live);
      expect(h.client.getCatalog().currentProgramScene).toBe(next);
      expect(h.client.getCatalog().currentPreviewScene).toBe(live);

      h.client.stop();
      await h.server.stop();
      client = undefined;
      server = undefined;
    }
  });

  it("keeps near-rail release unchanged at 0.10 (tick 102) and 0.90 (tick 921) when read() remains reachable", async () => {
    for (const [throwPos, expectedReleasePos, expectPreviewCommitted] of [
      [0.1, 0, false],
      [0.9, 1, true]
    ] as const) {
      const h = await connectClient();
      const live = h.client.getCatalog().currentProgramScene;
      const next = h.client.getCatalog().currentPreviewScene;

      await h.client.nudgeTbar(throwPos);
      expect(h.server.nativeSlider).toBe(nativeTick(throwPos));

      // Move fails while read() still succeeds: near-rail release closes on the real slider without toggling Studio Mode.
      h.native.move = async () => {
        throw new NativeTbarTimeout("Move timed out while slider stayed at near-rail tick.");
      };
      await h.client.nudgeTbar(0.05);

      expect(h.server.manualTransitionActive).toBe(false);
      expect(h.server.directCallLog.some((call) => call.requestType === "SetStudioModeEnabled")).toBe(false);
      expect(
        h.server.directCallLog
          .filter((call) => call.requestType === "SetTBarPosition")
          .map((call) => call.requestData)
      ).toEqual([{ position: expectedReleasePos, release: true }]);
      expect(h.server.programSceneName).toBe(expectPreviewCommitted ? next : live);
      expect(h.server.previewSceneName).toBe(expectPreviewCommitted ? live : next);

      h.client.stop();
      await h.server.stop();
      client = undefined;
      server = undefined;
    }
  });

  it("restores Program/Preview below 0.5 (0.10, 0.49) and finishes at >= 0.5 (0.50, 0.90) on reconnect native loss", async () => {
    for (const [throwPos, expectFinish] of [
      [0.1, false],
      [0.49, false],
      [0.5, true],
      [0.9, true]
    ] as const) {
      // Case A: Native control is already lost when the client reconnects.
      const h1 = await connectClient();
      const live1 = h1.client.getCatalog().currentProgramScene;
      const next1 = h1.client.getCatalog().currentPreviewScene;

      await h1.client.nudgeTbar(throwPos);
      expect(h1.server.manualTransitionActive).toBe(true);

      h1.native.dead = true;
      h1.client.reconnectNow();

      await vi.waitFor(
        () => {
          expect(h1.server.manualTransitionActive).toBe(false);
          expect(h1.server.studioMode).toBe(true);
          expect(h1.server.programSceneName).toBe(expectFinish ? next1 : live1);
          expect(h1.server.previewSceneName).toBe(expectFinish ? live1 : next1);
          expect(h1.client.getCatalog().currentProgramScene).toBe(expectFinish ? next1 : live1);
          expect(h1.client.getCatalog().currentPreviewScene).toBe(expectFinish ? live1 : next1);
          expect(h1.client.getCatalog().tbarPosition).toBe(0);
        },
        { timeout: 3000 }
      );

      h1.client.stop();
      await h1.server.stop();
      client = undefined;
      server = undefined;

      // Case B: Reconnect adopts the open throw while healthy, then OBS switches to Cut / native fails on the next turn.
      const h2 = await connectClient();
      const live2 = h2.client.getCatalog().currentProgramScene;
      const next2 = h2.client.getCatalog().currentPreviewScene;

      await h2.client.nudgeTbar(throwPos);
      expect(h2.server.manualTransitionActive).toBe(true);

      h2.client.reconnectNow();
      await vi.waitFor(() => expect(h2.client.getCatalog().tbarPosition).toBeCloseTo(throwPos, 1), { timeout: 3000 });
      expect(h2.server.manualTransitionActive).toBe(true);

      h2.server.currentTransitionName = "Cut";
      h2.native.dead = true;
      await h2.client.nudgeTbar(0.05);

      expect(h2.server.manualTransitionActive).toBe(false);
      expect(h2.server.programSceneName).toBe(expectFinish ? next2 : live2);
      expect(h2.server.previewSceneName).toBe(expectFinish ? live2 : next2);
      expect(h2.client.getCatalog().tbarPosition).toBe(0);

      h2.client.stop();
      await h2.server.stop();
      client = undefined;
      server = undefined;
    }

    for (const [throwPos, expectFinish] of [
      [0.49, false],
      [0.5, true]
    ] as const) {
      // Case C: Unexpected socket drop triggers statusChanged("reconnecting") and automatic backoff reconnect.
      const h3 = await connectClient();
      const live3 = h3.client.getCatalog().currentProgramScene;
      const next3 = h3.client.getCatalog().currentPreviewScene;

      await h3.client.nudgeTbar(throwPos);
      expect(h3.server.manualTransitionActive).toBe(true);

      h3.native.dead = true;
      h3.server.dropClients();

      await vi.waitFor(
        () => {
          expect(h3.client.getStatus().kind).toBe("connected");
          expect(h3.server.manualTransitionActive).toBe(false);
          expect(h3.server.studioMode).toBe(true);
          expect(h3.server.programSceneName).toBe(expectFinish ? next3 : live3);
          expect(h3.server.previewSceneName).toBe(expectFinish ? live3 : next3);
          expect(h3.client.getCatalog().currentProgramScene).toBe(expectFinish ? next3 : live3);
          expect(h3.client.getCatalog().currentPreviewScene).toBe(expectFinish ? live3 : next3);
          expect(h3.client.getCatalog().tbarPosition).toBe(0);
        },
        { timeout: 4000 }
      );

      h3.client.stop();
      await h3.server.stop();
      client = undefined;
      server = undefined;
    }
  });

  it.each(vectors.reconnect_vectors)("satisfies reconnect vector $id", async (vec) => {
    const h = await connectClient();

    if (vec.contract_expected.action === "adopt_open_throw") {
      const openPos = vec.samples[0].cursor;
      await h.client.nudgeTbar(openPos);
      expect(h.server.manualTransitionActive).toBe(true);
      expect(h.server.nativeSlider).toBe(nativeTick(openPos));

      // Reconnect while the manual fade sits motionless at openPos.
      h.client.stop();
      if (vec.reconnect_transition) {
        h.server.currentTransitionName = vec.reconnect_transition;
      }
      const native2 = new ScriptedNative(h.server);
      client = new DirectObsClient(
        { host: "127.0.0.1", port, password: "" },
        { nativeTbar: () => native2, nativePlatform: "win32" }
      );
      client.start();
      await vi.waitFor(() => expect(client!.getStatus().kind).toBe("connected"), { timeout: 3000 });
      await vi.waitFor(() => expect(client!.getCatalog().tbarPosition).toBeCloseTo(openPos, 1), { timeout: 3000 });
      expect(h.server.manualTransitionActive).toBe(true);
      return;
    }

    // Moving timed transition: native slider stays at 0, cursor moves across the sample window.
    h.server.nativeSlider = 0;
    h.server.cursorScript = [vec.samples[0].cursor, vec.samples[1].cursor, vec.samples[0].cursor, vec.samples[1].cursor];
    h.server.emitObsEvent("SceneTransitionStarted", { transitionName: "Fade" });
    const callCountBefore = h.server.directCallLog.filter((call) => call.requestType === "SetTBarPosition").length;

    await h.client.nudgeTbar(0.2);
    const callCountAfter = h.server.directCallLog.filter((call) => call.requestType === "SetTBarPosition").length;
    expect(callCountAfter).toBe(callCountBefore);
    expect(h.native.moves).toEqual([]);
    expect(h.client.getCatalog().tbarPosition).toBe(0);
  });
});
