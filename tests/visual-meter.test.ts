// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FilterController } from "../src/control/filter-controller.js";
import { VisualSafety } from "../src/control/visual-safety.js";
import {
  VS_LOCK_BPM_HOTKEY,
  VS_RESYNC_DOWNBEAT_HOTKEY,
  VS_TAP_TEMPO_HOTKEY,
  VisualSignals
} from "../src/control/visual-signals.js";
import {
  VisualMeterForm,
  VisualMeterInstanceController,
  refreshRateIntervalMs
} from "../src/actions/visual-meter.js";
import { ObsNeoInfobarInstanceController, NeoInfobarFeedback } from "../src/actions/obs-neo-infobar.js";
import { VisualMeterSettings } from "../src/types/settings.js";
import { setLanguage } from "../src/i18n/strings.js";
import { FakeObsServer, FakeObsServerOptions } from "./helpers/fake-obs-server.js";
import { deckTable } from "./helpers/languages.js";

/**
 * Visual Sidechain Meter (P1-3): subscription to `signals_changed` and `safety_changed`,
 * plain states (`NOT LOADED`, `PANIC`, `NO AUDIO`, `disconnected`), smoothed envelopes
 * (never raw `kick`), locally stepped beat/bar progress, per-action 2/5/10 Hz redraw cap,
 * and `tap_tempo` / `lock_bpm` / `resync_downbeat` / `set_bpm` with 604 hotkey fallback.
 */
describe("Visual Sidechain Meter (P1-3)", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  async function setup(
    opts: FakeObsServerOptions = { missingPlugin: true, visualSidechainVendor: "tempo" },
    clock: () => number = Date.now
  ): Promise<{
    server: FakeObsServer;
    client: DirectObsClient;
    safety: VisualSafety;
    signals: VisualSignals;
  }> {
    const server = new FakeObsServer(opts);
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const filters = new FilterController(client);
    const safety = new VisualSafety(client, filters);
    const signals = new VisualSignals(client, safety, clock);
    cleanup.push(() => client.stop(), () => server.stop());
    const ready = once(client, "connectionReady", { signal: AbortSignal.timeout(3000) });
    client.start();
    await ready;
    return { server, client, safety, signals };
  }

  function meterSink() {
    const svgs: string[] = [];
    let alerts = 0;
    return {
      sink: {
        render: async (svg: string) => {
          svgs.push(svg);
        },
        showAlert: async () => {
          alerts++;
        }
      },
      svgs,
      alerts: (): number => alerts,
      last: (): string => svgs.at(-1) ?? "",
      waitSvg: (predicate: (svg: string) => boolean): Promise<void> =>
        vi.waitFor(() => expect(predicate(svgs.at(-1) ?? ""), svgs.at(-1)).toBe(true), { timeout: 3000 })
    };
  }

  afterEach(async () => {
    setLanguage("en", null);
    for (const step of cleanup.splice(0)) await step();
  });

  it("shows NOT LOADED across key, dial, and Neo forms when Visual Sidechain is absent", async () => {
    const { client, signals } = await setup({ missingPlugin: true, visualSidechainVendor: "none" });
    await vi.waitFor(() => expect(signals.sample().state).toBe("not_loaded"));

    const forms: Array<{ form: VisualMeterForm; viewBox: string }> = [
      { form: "key", viewBox: 'viewBox="0 0 120 120"' },
      { form: "dial", viewBox: 'viewBox="0 0 200 100"' },
      { form: "infobar", viewBox: 'viewBox="0 0 232 50"' }
    ];

    for (const { form, viewBox } of forms) {
      const s = meterSink();
      const ctrl = new VisualMeterInstanceController(signals, client, s.sink, form);
      cleanup.push(() => ctrl.disappear());
      ctrl.appear();
      await s.waitSvg((svg) => svg.includes(viewBox) && svg.includes('data-state="not_loaded"') && svg.includes(">NOT LOADED<"));
    }
  });

  it("transitions cleanly through NO AUDIO, active meter, and PANIC across key, dial (with 32-band spectrum), Neo, and ObsNeoInfobar", async () => {
    let nowMs = 1_700_000_000_000;
    const { server, client, signals } = await setup(
      { missingPlugin: true, visualSidechainVendor: "tempo" },
      () => nowMs
    );
    await vi.waitFor(() => expect(signals.getSnapshot().availability).toBe("loaded"));

    const key = meterSink();
    const dial = meterSink();
    const neo = meterSink();
    const neoTexts: NeoInfobarFeedback[] = [];

    const keyCtrl = new VisualMeterInstanceController(signals, client, key.sink, "key", { refreshRate: 10 }, () => nowMs);
    const dialCtrl = new VisualMeterInstanceController(signals, client, dial.sink, "dial", { refreshRate: 10 }, () => nowMs);
    const neoCtrl = new VisualMeterInstanceController(signals, client, neo.sink, "infobar", { refreshRate: 10 }, () => nowMs);
    const obsInfobar = new ObsNeoInfobarInstanceController(
      client,
      { setFeedback: async (fb) => { neoTexts.push(fb); } },
      16,
      signals,
      { showVisualSidechain: false }
    );
    cleanup.push(
      () => keyCtrl.disappear(),
      () => dialCtrl.disappear(),
      () => neoCtrl.disappear(),
      () => obsInfobar.disappear()
    );

    keyCtrl.appear();
    dialCtrl.appear();
    neoCtrl.appear();
    obsInfobar.appear();

    // Default `showVisualSidechain: false` preserves OBS connected on the existing Neo infobar.
    await vi.waitFor(() => expect(neoTexts.at(-1)?.status).toBe("OBS connected"));
    obsInfobar.updateSettings({ showVisualSidechain: true });
    await vi.waitFor(() => expect(neoTexts.at(-1)?.status).toBe("NO AUDIO"));

    // 1. Initial audio_present=false -> NO AUDIO across all three Visual Meter forms.
    await key.waitSvg((svg) => svg.includes('data-state="no_audio"') && svg.includes(">NO AUDIO<"));
    await dial.waitSvg((svg) => svg.includes('data-state="no_audio"') && svg.includes(">NO AUDIO<"));
    await neo.waitSvg((svg) => svg.includes('data-state="no_audio"') && svg.includes(">NO AUDIO<"));

    // 2. Active signal frame: BPM + lock icon, beat counter, 4 band bars, and 32-band { band, value } spectrum + level on the dial.
    nowMs += 200;
    const spectrum = Array.from({ length: 32 }, (_, band) => ({
      band,
      value: Number(((band + 1) / 32).toFixed(3))
    }));
    server.emitVisualSidechainSignals({
      audio_present: true,
      level: 0.42,
      sub_bass: 0.85,
      bass: 0.6,
      mid: 0.35,
      high: 0.25,
      kick: 0,
      bpm: 220,
      bpm_locked: true,
      beat_phase: 0.1,
      beat_index: 2,
      bar_phase: 0.525,
      bar_index: 7,
      beat_confidence: 0.9,
      spectrum
    });

    await key.waitSvg(
      (svg) =>
        svg.includes('data-state="active"') &&
        svg.includes(">220 BPM<") &&
        svg.includes('data-bpm-locked="true"') &&
        svg.includes('data-beat-index="2"') &&
        svg.includes('data-bands="85,60,35,25"')
    );
    await dial.waitSvg(
      (svg) =>
        svg.includes('data-state="active"') &&
        svg.includes(">220 BPM<") &&
        svg.includes('data-bpm-locked="true"') &&
        svg.includes('data-spectrum-bins="32"')
    );
    await neo.waitSvg(
      (svg) =>
        svg.includes('data-state="active"') &&
        svg.includes(">220 BPM<") &&
        svg.includes('data-bpm-locked="true"')
    );
    await vi.waitFor(() => expect(neoTexts.at(-1)?.status).toBe("220 BPM [LOCK] · Beat 3/4"));
    const activeSample = signals.sample(nowMs);
    expect(activeSample.rms).toBeCloseTo(0.42, 3);
    expect(activeSample.spectrum[0]).toBeCloseTo(1 / 32, 3);
    expect(activeSample.spectrum[31]).toBeCloseTo(1, 3);

    // 3. Never raw `kick`: changing only `kick` (0 -> 1) never alters the sampled state or SVG!
    const keySvgBeforeKick = key.last();
    const dialSvgBeforeKick = dial.last();
    const sampledBeforeKick = signals.sample(nowMs);
    nowMs += 200;
    // Keep bpmLocked=false temporarily so beatIndex doesn't advance from clock, isolating `kick`.
    server.emitVisualSidechainSignals({ bpm_locked: false, audio_present: true, beat_phase: 0.1, beat_index: 2, bar_phase: 0.525, kick: 0 });
    await key.waitSvg((svg) => !svg.includes('data-bpm-locked="true"'));
    const countBeforeKick = key.svgs.length;
    const snapNoKick = signals.sample(nowMs);
    server.emitVisualSidechainSignals({ bpm_locked: false, audio_present: true, beat_phase: 0.1, beat_index: 2, bar_phase: 0.525, kick: 1.0 });
    await new Promise((r) => setTimeout(r, 40));
    const snapWithKick = signals.sample(nowMs);
    expect("kick" in (snapWithKick as unknown as Record<string, unknown>)).toBe(false);
    expect(snapWithKick.subBass).toBe(snapNoKick.subBass);
    expect(snapWithKick.bass).toBe(snapNoKick.bass);
    expect(key.svgs.length).toBe(countBeforeKick);
    expect(keySvgBeforeKick).not.toBe("");
    expect(dialSvgBeforeKick).not.toBe("");
    expect(sampledBeforeKick.bpm).toBe(220);

    // 4. Panic overrides active state with plain PANIC, without using solid-red #EF4444 background (reserved for Panic key per R-RIG-8).
    nowMs += 200;
    server.triggerVisualSidechainSafety(true, nowMs);
    await key.waitSvg(
      (svg) =>
        svg.includes('data-state="panic"') &&
        svg.includes(">PANIC<") &&
        !svg.includes('fill="#EF4444"')
    );
    await dial.waitSvg((svg) => svg.includes('data-state="panic"') && svg.includes(">PANIC<"));
    await neo.waitSvg((svg) => svg.includes('data-state="panic"') && svg.includes(">PANIC<"));
    await vi.waitFor(() => expect(neoTexts.at(-1)?.status).toBe("PANIC"));
  });

  it("steps beat_index and bar_index locally at 120 BPM without waiting for new frames, holds in silence when unlocked, and continues when locked", async () => {
    let nowMs = 1_700_000_000_000;
    const { server, signals } = await setup(
      { missingPlugin: true, visualSidechainVendor: "tempo" },
      () => nowMs
    );
    await vi.waitFor(() => expect(signals.getSnapshot().availability).toBe("loaded"));

    server.emitVisualSidechainSignals({
      audio_present: true,
      rms: 0.3,
      bpm: 120,
      bpm_locked: false,
      beat_phase: 0.05,
      beat_index: 0,
      bar_phase: 0.0125,
      bar_index: 10,
      beat_confidence: 0.85
    });
    await vi.waitFor(() => expect(signals.sample(nowMs).state).toBe("active"));

    // 120 BPM = 500 ms per beat: +500 ms -> beat 1, +1000 ms -> beat 2, +1500 ms -> beat 3, +2000 ms -> beat 0 of bar 11.
    expect(signals.sample(nowMs).beatIndex).toBe(0);
    expect(signals.sample(nowMs + 500).beatIndex).toBe(1);
    expect(signals.sample(nowMs + 1000).beatIndex).toBe(2);
    expect(signals.sample(nowMs + 1500).beatIndex).toBe(3);
    const wrapped = signals.sample(nowMs + 2000);
    expect(wrapped.beatIndex).toBe(0);
    expect(wrapped.barIndex).toBe(11);

    // Unlocked silence: beat_index holds still and state is NO AUDIO.
    nowMs += 2000;
    server.emitVisualSidechainSignals({
      audio_present: false,
      rms: 0,
      bpm: 120,
      bpm_locked: false,
      beat_phase: 0.25,
      beat_index: 2,
      bar_phase: 0.5625,
      bar_index: 11
    });
    await vi.waitFor(() => expect(signals.sample(nowMs).state).toBe("no_audio"));
    expect(signals.sample(nowMs + 1000).beatIndex).toBe(2);

    // Locked BPM across silence: state reports NO AUDIO honestly, while beat/bar phase stays continuous for P1-4 quantization!
    server.emitVisualSidechainSignals({
      audio_present: false,
      rms: 0,
      bpm: 120,
      bpm_locked: true,
      beat_phase: 0.05,
      beat_index: 1,
      bar_phase: 0.2625,
      bar_index: 11
    });
    await vi.waitFor(() => expect(signals.getSnapshot().bpmLocked).toBe(true));
    const lockedSilent = signals.sample(nowMs + 1000);
    expect(lockedSilent.state).toBe("no_audio");
    expect(lockedSilent.beatIndex).toBe(3);
  });

  it("enforces per-action redraw rate choices (2, 5 default, 10 per second) inside the 10 Hz cap", async () => {
    expect(refreshRateIntervalMs(2)).toBe(500);
    expect(refreshRateIntervalMs(5)).toBe(200);
    expect(refreshRateIntervalMs(10)).toBe(100);

    const { server, client, signals } = await setup({ missingPlugin: true, visualSidechainVendor: "tempo" });
    await vi.waitFor(() => expect(signals.getSnapshot().availability).toBe("loaded"));

    const sink2 = meterSink();
    const sink5 = meterSink();
    const sink10 = meterSink();
    const c2 = new VisualMeterInstanceController(signals, client, sink2.sink, "key", { refreshRate: 2 });
    const c5 = new VisualMeterInstanceController(signals, client, sink5.sink, "key");
    const c10 = new VisualMeterInstanceController(signals, client, sink10.sink, "key", { refreshRate: 10 });
    cleanup.push(() => c2.disappear(), () => c5.disappear(), () => c10.disappear());

    c2.appear();
    c5.appear();
    c10.appear();
    await sink5.waitSvg((svg) => svg.includes(">NO AUDIO<"));
    // Let the initial flush interval settle so the 1 s burst starts from an open window.
    await new Promise((r) => setTimeout(r, 520));
    sink2.svgs.length = 0;
    sink5.svgs.length = 0;
    sink10.svgs.length = 0;

    // Feed 18 frames 45 ms apart (~810 ms burst after an open 520 ms quiet window).
    for (let i = 0; i < 18; i++) {
      server.emitVisualSidechainSignals({
        audio_present: true,
        level: 0.4,
        sub_bass: (i % 10) / 10,
        bass: ((i + 3) % 10) / 10,
        mid: 0.3,
        high: 0.2,
        bpm: 125,
        beat_index: i % 4,
        beat_phase: (i * 0.1) % 1
      });
      await new Promise((r) => setTimeout(r, 45));
    }

    // Over < 1 s of 18 incoming updates, each cell stays strictly inside its configured rate budget (never > 10/s).
    expect(sink2.svgs.length).toBeLessThanOrEqual(2);
    expect(sink5.svgs.length).toBeLessThanOrEqual(5);
    expect(sink10.svgs.length).toBeLessThanOrEqual(10);
    expect(sink2.svgs.length).toBeLessThan(sink5.svgs.length);
    expect(sink5.svgs.length).toBeLessThan(sink10.svgs.length);
  });

  it("sends tap_tempo, lock_bpm, resync_downbeat, and dial set_bpm via vendor API, and falls back to hotkeys on 604", async () => {
    const { server, client, signals } = await setup({ missingPlugin: true, visualSidechainVendor: "tempo" });
    await vi.waitFor(() => expect(signals.getSnapshot().availability).toBe("loaded"));

    const tapSink = meterSink();
    const lockSink = meterSink();
    const resyncSink = meterSink();
    const dialSink = meterSink();

    const tapKey = new VisualMeterInstanceController(signals, client, tapSink.sink, "key", { operation: "tap_tempo" });
    const lockKey = new VisualMeterInstanceController(signals, client, lockSink.sink, "key", { operation: "lock_bpm" });
    const resyncKey = new VisualMeterInstanceController(signals, client, resyncSink.sink, "key", { operation: "resync_downbeat" });
    const dial = new VisualMeterInstanceController(signals, client, dialSink.sink, "dial", {
      operation: "display_only",
      dialRotate: "adjust_bpm"
    } satisfies VisualMeterSettings);
    cleanup.push(() => tapKey.disappear(), () => lockKey.disappear(), () => resyncKey.disappear(), () => dial.disappear());

    tapKey.appear();
    lockKey.appear();
    resyncKey.appear();
    dial.appear();

    await tapKey.press();
    await lockKey.press();
    await resyncKey.press();
    await dial.press(); // display_only is a no-op
    await dial.rotate(8); // 120 + 8 = 128 BPM
    await dial.rotate(500); // clamped to 200 BPM

    expect(
      server.visualSidechainCallLog
        .filter((c) => ["tap_tempo", "lock_bpm", "resync_downbeat", "set_bpm"].includes(c.requestType))
        .map((c) => ({ type: c.requestType, data: c.requestData }))
    ).toEqual([
      { type: "tap_tempo", data: {} },
      { type: "lock_bpm", data: { locked: true } },
      { type: "resync_downbeat", data: {} },
      { type: "set_bpm", data: { bpm: 128 } },
      { type: "set_bpm", data: { bpm: 200 } }
    ]);
    expect(signals.getSnapshot().bpmLocked).toBe(true);
    expect(signals.getSnapshot().bpm).toBe(200);
    expect(server.hotkeyTriggerLog).toEqual([]);

    // Older Visual Sidechain build (0.7.0 pre-P1-2, returns 604 for tempo requests): falls back to frontend hotkeys!
    server.visualSidechainVendor = "safety";
    await tapKey.press();
    await lockKey.press();
    await resyncKey.press();
    expect(server.hotkeyTriggerLog.map((h) => h.hotkeyName)).toEqual([
      VS_TAP_TEMPO_HOTKEY,
      VS_LOCK_BPM_HOTKEY,
      VS_RESYNC_DOWNBEAT_HOTKEY
    ]);
  });

  it("renders plain states in the active deck language", async () => {
    const { server, client, signals } = await setup({ missingPlugin: true, visualSidechainVendor: "tempo" });
    await vi.waitFor(() => expect(signals.getSnapshot().availability).toBe("loaded"));
    setLanguage("de", deckTable("de"));

    const s = meterSink();
    const ctrl = new VisualMeterInstanceController(signals, client, s.sink, "key");
    cleanup.push(() => ctrl.disappear());
    ctrl.appear();
    await s.waitSvg((svg) => svg.includes(">KEIN TON<"));

    server.triggerVisualSidechainSafety(true);
    await s.waitSvg((svg) => svg.includes(">PANIK<"));
  });
});
