// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import { FilterController } from "../src/control/filter-controller.js";
import { VisualSafety } from "../src/control/visual-safety.js";
import { SampledVisualSignals, VisualSignals } from "../src/control/visual-signals.js";
import {
  MAX_QUANTIZE_WAIT_MS,
  QUANTIZE_NOTICE_MS,
  QuantizedKeyArm,
  computeBeatsDurationMs,
  isTempoUsableForQuantize,
  planQuantizedFade
} from "../src/control/quantized-fade.js";
import { AutoFadeKeyInstanceController } from "../src/actions/auto-fade-key.js";
import { ObsFadeKeyInstanceController } from "../src/actions/obs-fade-key.js";
import { ObsSceneTransitionKeyInstanceController } from "../src/actions/obs-scene-transition-key.js";
import { setLanguage } from "../src/i18n/strings.js";
import { FakeObsServer, FakeObsServerOptions } from "./helpers/fake-obs-server.js";
import { deckTable } from "./helpers/languages.js";

function makeSample(overrides: Partial<SampledVisualSignals> = {}): SampledVisualSignals {
  return {
    state: "active",
    connected: true,
    availability: "loaded",
    version: "0.7.0",
    audioPresent: true,
    rms: 0.4,
    subBass: 0.5,
    bass: 0.4,
    mid: 0.3,
    high: 0.2,
    bpm: 120,
    bpmLocked: true,
    beatPhase: 0.5,
    beatIndex: 1,
    barPhase: 0.25,
    barIndex: 4,
    beatConfidence: 0.85,
    panic: false,
    spectrum: new Array<number>(32).fill(0),
    receivedAtMs: 1_700_000_000_000,
    ...overrides
  };
}

describe("Quantized, operator-armed fades (P1-4)", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    vi.useRealTimers();
    setLanguage("en", null);
    for (const step of cleanup.splice(0)) await step();
  });

  it("computes 1/2/4/8/16 beat durations and caps wait time at 1 bar and <= 4000 ms", () => {
    expect(computeBeatsDurationMs(1, 120)).toBe(500);
    expect(computeBeatsDurationMs(2, 120)).toBe(1000);
    expect(computeBeatsDurationMs(4, 120)).toBe(2000);
    expect(computeBeatsDurationMs(8, 120)).toBe(4000);
    expect(computeBeatsDurationMs(16, 120)).toBe(8000);

    // Saved settings (0 beats + "now") run plain without NO TEMPO.
    expect(planQuantizedFade(undefined, 0, "now", 1000)).toEqual({
      mode: "plain",
      durationMs: 1000,
      waitMs: 0,
      noTempo: false
    });

    // 120 BPM locked: next_beat at beatPhase=0.2 -> 400 ms; next_bar at barPhase=0.25 -> 1500 ms.
    const s120 = makeSample({ bpm: 120, beatPhase: 0.2, barPhase: 0.25 });
    expect(planQuantizedFade(s120, 4, "now", 1000)).toEqual({
      mode: "quantized",
      durationMs: 2000,
      waitMs: 0,
      noTempo: false
    });
    expect(planQuantizedFade(s120, 4, "next_beat", 1000)).toEqual({
      mode: "quantized",
      durationMs: 2000,
      waitMs: 400,
      noTempo: false
    });
    expect(planQuantizedFade(s120, 4, "next_bar", 1000)).toEqual({
      mode: "quantized",
      durationMs: 2000,
      waitMs: 1500,
      noTempo: false
    });

    // Maximum wait is 1 bar, capped at 4000 ms even at slow BPM (e.g. 50 BPM -> 1 bar = 4800 ms -> capped at 4000 ms).
    const s60 = makeSample({ bpm: 60, barPhase: 0 });
    expect(planQuantizedFade(s60, 4, "next_bar", 1000).waitMs).toBe(MAX_QUANTIZE_WAIT_MS);
    const s50 = makeSample({ bpm: 50, barPhase: 0 });
    expect(planQuantizedFade(s50, 4, "next_bar", 1000).waitMs).toBe(MAX_QUANTIZE_WAIT_MS);
  });

  it("falls back immediately with fallbackMs and NO TEMPO on every missing/silent/low-confidence unlocked state", () => {
    const cases: Array<[string, SampledVisualSignals | undefined]> = [
      ["missing signals instance", undefined],
      ["OBS disconnected", makeSample({ connected: false, state: "disconnected" })],
      ["Visual Sidechain not loaded", makeSample({ availability: "not_loaded", state: "not_loaded" })],
      ["audio_present is false", makeSample({ audioPresent: false, state: "no_audio", bpmLocked: true })],
      ["low confidence while unlocked", makeSample({ beatConfidence: 0.15, bpmLocked: false })]
    ];

    for (const [label, sample] of cases) {
      expect(isTempoUsableForQuantize(sample), label).toBe(false);
      expect(planQuantizedFade(sample, 4, "next_bar", 750), label).toEqual({
        mode: "fallback_no_tempo",
        durationMs: 750,
        waitMs: 0,
        noTempo: true
      });
    }

    // Locked tempo WITH audio_present=true overrides low beat_confidence.
    const lockedLowConf = makeSample({ audioPresent: true, beatConfidence: 0.05, bpmLocked: true, bpm: 120, barPhase: 0.5 });
    expect(isTempoUsableForQuantize(lockedLowConf)).toBe(true);
    expect(planQuantizedFade(lockedLowConf, 4, "next_bar", 750)).toEqual({
      mode: "quantized",
      durationMs: 2000,
      waitMs: 1000,
      noTempo: false
    });
  });

  it("drives ARMED, bar fire, second-press fire-now, and hold-to-cancel deterministically on a fake clock", async () => {
    vi.useFakeTimers();
    let now = 1_700_000_000_000;
    let currentSample: SampledVisualSignals | undefined = makeSample({ bpm: 120, barPhase: 0.25 });
    const fakeSignals = {
      sample: () => currentSample
    } as unknown as VisualSignals;

    const states: Array<string | null> = [];
    const firedDurations: Array<number | undefined> = [];
    const arm = new QuantizedKeyArm(
      fakeSignals,
      () => states.push(arm.getBanner()),
      800,
      () => now
    );
    cleanup.push(() => arm.dispose());

    // 1. Arm for next_bar (1500 ms wait), tap release at 100 ms, fire at 1500 ms.
    await arm.handleKeyDown(4, "next_bar", 600, async (ms) => {
      firedDurations.push(ms);
    }, now);
    expect(arm.isArmed()).toBe(true);
    expect(arm.getBanner()).toBe("armed");
    expect(firedDurations).toEqual([]);

    now += 100;
    vi.advanceTimersByTime(100);
    await arm.handleKeyUp();
    expect(arm.isArmed()).toBe(true);
    expect(firedDurations).toEqual([]);

    now += 1400;
    vi.advanceTimersByTime(1400);
    await Promise.resolve();
    expect(arm.isArmed()).toBe(false);
    expect(arm.getBanner()).toBeNull();
    expect(firedDurations).toEqual([2000]);

    // 2. Second short press while ARMED fires immediately without double-firing later.
    await arm.handleKeyDown(4, "next_bar", 600, async (ms) => {
      firedDurations.push(ms);
    }, now);
    now += 100;
    vi.advanceTimersByTime(100);
    await arm.handleKeyUp();
    expect(arm.isArmed()).toBe(true);

    now += 300;
    vi.advanceTimersByTime(300);
    await arm.handleKeyDown(4, "next_bar", 600, async (ms) => {
      firedDurations.push(ms);
    }, now);
    now += 80;
    vi.advanceTimersByTime(80);
    await arm.handleKeyUp();
    expect(arm.isArmed()).toBe(false);
    expect(firedDurations).toEqual([2000, 2000]);

    now += 3000;
    vi.advanceTimersByTime(3000);
    expect(firedDurations).toEqual([2000, 2000]);

    // 3. Holding while ARMED cancels visibly (CANCELLED) and never fires.
    await arm.handleKeyDown(4, "next_bar", 600, async (ms) => {
      firedDurations.push(ms);
    }, now);
    now += 100;
    vi.advanceTimersByTime(100);
    await arm.handleKeyUp();
    expect(arm.isArmed()).toBe(true);

    await arm.handleKeyDown(4, "next_bar", 600, async (ms) => {
      firedDurations.push(ms);
    }, now);
    now += 850;
    vi.advanceTimersByTime(850);
    expect(arm.isArmed()).toBe(false);
    expect(arm.getBanner()).toBe("cancelled");
    await arm.handleKeyUp();
    expect(firedDurations).toEqual([2000, 2000]);

    now += QUANTIZE_NOTICE_MS + 50;
    vi.advanceTimersByTime(QUANTIZE_NOTICE_MS + 50);
    expect(arm.getBanner()).toBeNull();
    expect(firedDurations).toEqual([2000, 2000]);

    // 4. NO TEMPO fallback fires immediately and displays NO TEMPO transiently.
    currentSample = makeSample({ audioPresent: false, state: "no_audio" });
    await arm.handleKeyDown(4, "next_bar", 650, async (ms) => {
      firedDurations.push(ms);
    }, now);
    expect(firedDurations).toEqual([2000, 2000, 650]);
    expect(arm.getBanner()).toBe("no_tempo");
    now += QUANTIZE_NOTICE_MS + 50;
    vi.advanceTimersByTime(QUANTIZE_NOTICE_MS + 50);
    expect(arm.getBanner()).toBeNull();
  });

  async function setupSuite(opts: FakeObsServerOptions = { visualSidechainVendor: "tempo" }) {
    const server = new FakeObsServer(opts);
    const port = await server.start();
    const enhancedClient = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(enhancedClient);
    const directClient = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const filters = new FilterController(directClient);
    const safety = new VisualSafety(directClient, filters);
    const signals = new VisualSignals(directClient, safety);
    cleanup.push(() => enhancedClient.stop(), () => directClient.stop(), () => server.stop());

    const directReady = once(directClient, "connectionReady", { signal: AbortSignal.timeout(3000) });
    directClient.start();
    enhancedClient.ensureStarted();
    await directReady;
    await vi.waitFor(() => expect(enhancedClient.isConnected() && store.getSlots().length > 0).toBe(true));
    return { server, enhancedClient, store, directClient, signals };
  }

  function keySink() {
    const images: string[] = [];
    let alerts = 0;
    return {
      sink: {
        setImage: async (img: string) => {
          images.push(img);
        },
        showAlert: async () => {
          alerts++;
        }
      },
      images,
      alerts: () => alerts,
      lastSvg: () => {
        const uri = images.at(-1) ?? "";
        const prefix = "data:image/svg+xml;utf8,";
        return uri.startsWith(prefix) ? decodeURIComponent(uri.slice(prefix.length)) : uri;
      }
    };
  }

  it("sends quantized auto_fade ms to Midi Fadester without contract changes, shows ARMED / NO TEMPO, and never fires from audio alone", async () => {
    const { server, store, signals } = await setupSuite({ visualSidechainVendor: "tempo" });
    await vi.waitFor(() => expect(signals.getSnapshot().availability).toBe("loaded"));

    const sink = keySink();
    const ctrl = new AutoFadeKeyInstanceController(
      store,
      sink.sink,
      { slot: "fader_1", to: 1, durationMs: 750, quantizeBeats: 4, quantizeStart: "next_bar" },
      10,
      signals,
      250
    );
    cleanup.push(() => ctrl.disappear());
    ctrl.appear();

    // Audio events alone NEVER trigger auto_fade.
    server.emitVisualSidechainSignals({
      audio_present: true,
      bpm: 120,
      bpm_locked: true,
      beat_phase: 0,
      beat_index: 0,
      bar_phase: 0,
      bar_index: 1,
      beat_confidence: 0.95
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(server.vendorCallLog.filter((c) => c.requestType === "auto_fade")).toHaveLength(0);

    // Arm near the end of the bar (bar_phase = 0.92 -> ~160 ms wait): shows ARMED, then sends auto_fade { ms: 2000 }.
    server.emitVisualSidechainSignals({
      audio_present: true,
      bpm: 120,
      bpm_locked: true,
      beat_phase: 0.68,
      beat_index: 3,
      bar_phase: 0.92,
      bar_index: 2,
      beat_confidence: 0.95
    });
    await vi.waitFor(() => expect(signals.getSnapshot().barIndex).toBe(2));

    await ctrl.handleKeyDown();
    await ctrl.handleKeyUp();
    await vi.waitFor(() => expect(sink.lastSvg()).toContain(">ARMED<"));

    await vi.waitFor(() => {
      const calls = server.vendorCallLog.filter((c) => c.requestType === "auto_fade");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.requestData).toEqual({ slot: "fader_1", to: 1, ms: 2000 });
    });

    // Silence fallback: audio_present=false fires immediately with fallback 750 ms and shows NO TEMPO (KEIN TEMPO in de).
    setLanguage("de", deckTable("de"));
    server.emitVisualSidechainSignals({
      audio_present: false,
      bpm: 120,
      bpm_locked: true,
      beat_phase: 0.5,
      beat_index: 1,
      bar_phase: 0.25,
      bar_index: 3,
      beat_confidence: 0.95
    });
    await vi.waitFor(() => expect(signals.getSnapshot().audioPresent).toBe(false));

    await ctrl.handleKeyDown();
    await ctrl.handleKeyUp();
    const calls = server.vendorCallLog.filter((c) => c.requestType === "auto_fade");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.requestData).toEqual({ slot: "fader_1", to: 1, ms: 750 });
    await vi.waitFor(() => expect(sink.lastSvg()).toContain(">KEIN TEMPO<"));
  });

  it("quantizes OBS Fade and Scene & Transition keys, restores scene overrides cleanly, and honors hold-to-cancel", async () => {
    const { server, directClient, signals } = await setupSuite({ visualSidechainVendor: "tempo" });
    await vi.waitFor(() => expect(signals.getSnapshot().availability).toBe("loaded"));

    // Seed active 120 BPM locked tempo.
    server.emitVisualSidechainSignals({
      audio_present: true,
      bpm: 120,
      bpm_locked: true,
      beat_phase: 0.2,
      beat_index: 0,
      bar_phase: 0.1,
      bar_index: 10,
      beat_confidence: 0.9
    });
    await vi.waitFor(() => expect(signals.getSnapshot().barIndex).toBe(10));

    // 1. Scene & Transition: 4 beats at 120 BPM ("now") sets 2000 ms transitionDuration for the switch and restores null override after.
    const sceneSink = keySink();
    const sceneCtrl = new ObsSceneTransitionKeyInstanceController(
      directClient,
      sceneSink.sink,
      {
        sceneTarget: "Scene Preview",
        operation: "transition",
        transitionName: "__current_transition__",
        durationMs: 650,
        quantizeBeats: 4,
        quantizeStart: "now"
      },
      10,
      signals,
      120
    );
    cleanup.push(() => sceneCtrl.disappear());
    sceneCtrl.appear();

    await sceneCtrl.handleKeyDown();
    await sceneCtrl.handleKeyUp();
    expect(server.programSceneName).toBe("Scene Preview");
    expect(server.lastSceneTransitionDuration).toBe(2000);
    expect(server.sceneTransitionOverrides.get("Scene Preview")).toEqual({
      transitionName: null,
      transitionDuration: null
    });

    // Hold-to-cancel on Scene & Transition while ARMED does NOT switch Program and shows CANCELLED.
    const programBeforeHold = server.programSceneName;
    sceneCtrl.updateSettings({
      sceneTarget: "Scene 3",
      operation: "transition",
      transitionName: "__current_transition__",
      durationMs: 650,
      quantizeBeats: 4,
      quantizeStart: "next_bar"
    });
    await sceneCtrl.handleKeyDown();
    await sceneCtrl.handleKeyUp();
    await vi.waitFor(() => expect(sceneSink.lastSvg()).toContain(">ARMED<"));

    // Hold second press >= 120 ms -> CANCELLED, Program stays unchanged.
    await sceneCtrl.handleKeyDown();
    await new Promise((r) => setTimeout(r, 160));
    await sceneCtrl.handleKeyUp();
    await vi.waitFor(() => expect(sceneSink.lastSvg()).toContain(">CANCELLED<"));
    expect(server.programSceneName).toBe(programBeforeHold);

    // 2. OBS Fade key: shows "Up 2 beats" subtitle, and when unlocked with low confidence fires fallback immediately + NO TEMPO.
    const fadeSink = keySink();
    const fadeCtrl = new ObsFadeKeyInstanceController(
      directClient,
      fadeSink.sink,
      {
        target: "input_volume",
        inputName: "Desktop Audio",
        to: 1,
        durationMs: 80,
        quantizeBeats: 2,
        quantizeStart: "next_beat"
      },
      10,
      signals,
      120
    );
    cleanup.push(() => fadeCtrl.disappear());
    fadeCtrl.appear();
    await vi.waitFor(() => expect(fadeSink.lastSvg()).toContain("Up 2 beats"));

    server.emitVisualSidechainSignals({
      audio_present: true,
      bpm: 120,
      bpm_locked: false,
      beat_phase: 0.1,
      beat_index: 0,
      bar_phase: 0.1,
      bar_index: 11,
      beat_confidence: 0.12
    });
    await vi.waitFor(() => expect(signals.getSnapshot().barIndex).toBe(11));

    server.inputVolumes.set("Desktop Audio", 0.2);
    await fadeCtrl.handleKeyDown();
    await fadeCtrl.handleKeyUp();
    await vi.waitFor(() => expect(fadeSink.lastSvg()).toContain(">NO TEMPO<"));
    await vi.waitFor(() => expect(server.inputVolumes.get("Desktop Audio")).toBeCloseTo(1, 2));
  });
});
