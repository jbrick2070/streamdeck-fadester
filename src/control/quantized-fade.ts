// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Quantized, operator-armed fades (P1-4) for Auto-fade, OBS Fade, and Scene & Transition keys:
 * - Length in milliseconds (or OBS's own duration on Scene & Transition) or 1/2/4/8/16 beats.
 * - Start: now, next beat, or next bar.
 * - Non-negotiable deterministic rules:
 *   1. Every press results in the action or a visible cancel — never a silent wait.
 *   2. If Visual Sidechain is missing, `audio_present` is false, or `beat_confidence` is low
 *      while `bpm_locked` is false, fire immediately with the configured millisecond fallback
 *      and show `NO TEMPO`.
 *   3. Maximum wait is one bar, capped at 4000 ms.
 *   4. While waiting, the key shows `ARMED`; a second press fires immediately; a hold cancels
 *      visibly (`CANCELLED`) without firing.
 *   5. Nothing starts without a key press; audio never originates a Program change.
 */
import { SampledVisualSignals, VisualSignals } from "./visual-signals.js";
import { QuantizeBeats, QuantizeStart } from "../types/settings.js";
import { DIAL_HOLD_THRESHOLD_MS } from "../actions/dial-math.js";

export const MIN_QUANTIZE_CONFIDENCE = 0.35;
export const MAX_QUANTIZE_WAIT_MS = 4000;
export const QUANTIZE_NOTICE_MS = 1500;
export const DEFAULT_SCENE_FALLBACK_MS = 500;

export type QuantizeBannerState = "armed" | "no_tempo" | "cancelled" | null;

export interface QuantizedFadePlan {
  readonly mode: "plain" | "fallback_no_tempo" | "quantized";
  readonly durationMs: number | undefined;
  readonly waitMs: number;
  readonly noTempo: boolean;
}

export function isTempoUsableForQuantize(sampled: SampledVisualSignals | undefined): sampled is SampledVisualSignals {
  if (!sampled) return false;
  if (!sampled.connected || sampled.availability !== "loaded") return false;
  if (!sampled.audioPresent) return false;
  if (sampled.beatConfidence < MIN_QUANTIZE_CONFIDENCE && !sampled.bpmLocked) return false;
  return Number.isFinite(sampled.bpm) && sampled.bpm > 0;
}

export function computeBeatsDurationMs(beats: Exclude<QuantizeBeats, 0>, bpm: number): number {
  const raw = beats * (60000 / bpm);
  return Math.max(50, Math.min(20000, Math.round(raw)));
}

export function planQuantizedFade(
  sampled: SampledVisualSignals | undefined,
  beats: QuantizeBeats,
  start: QuantizeStart,
  fallbackMs: number | undefined
): QuantizedFadePlan {
  if (beats === 0 && start === "now") {
    return {
      mode: "plain",
      durationMs: fallbackMs,
      waitMs: 0,
      noTempo: false
    };
  }

  if (!isTempoUsableForQuantize(sampled)) {
    return {
      mode: "fallback_no_tempo",
      durationMs: fallbackMs,
      waitMs: 0,
      noTempo: true
    };
  }

  const beatMs = 60000 / sampled.bpm;
  const barMs = 4 * beatMs;
  const maxWaitMs = Math.min(barMs, MAX_QUANTIZE_WAIT_MS);
  const durationMs = beats !== 0 ? computeBeatsDurationMs(beats, sampled.bpm) : fallbackMs;

  let waitMs = 0;
  if (start === "next_beat") {
    const phase = Math.max(0, Math.min(1, sampled.beatPhase));
    const rem = (1 - phase) * beatMs;
    waitMs = Math.max(0, Math.min(Math.round(maxWaitMs), Math.round(rem)));
  } else if (start === "next_bar") {
    const phase = Math.max(0, Math.min(1, sampled.barPhase));
    const rem = (1 - phase) * barMs;
    waitMs = Math.max(0, Math.min(Math.round(maxWaitMs), Math.round(rem)));
  }
  if (waitMs <= 10) {
    waitMs = 0;
  }

  return {
    mode: "quantized",
    durationMs,
    waitMs,
    noTempo: false
  };
}

interface ArmedState {
  durationMs: number | undefined;
  fire: (durationMs: number | undefined) => Promise<void>;
  secondPressDown: boolean;
}

export class QuantizedKeyArm {
  private armed: ArmedState | null = null;
  private banner: Exclude<QuantizeBannerState, "armed"> = null;
  private fireTimer: ReturnType<typeof setTimeout> | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    private readonly signals: VisualSignals | undefined,
    private readonly onStateChanged: () => void,
    private readonly holdMs: number = DIAL_HOLD_THRESHOLD_MS,
    private readonly clock: () => number = Date.now
  ) {}

  public isArmed(): boolean {
    return this.armed !== null;
  }

  public getBanner(): QuantizeBannerState {
    return this.armed !== null ? "armed" : this.banner;
  }

  public cancelSilently(): void {
    const hadState = this.armed !== null || this.banner !== null;
    this.clearFireTimer();
    this.clearHoldTimer();
    this.clearNoticeTimer();
    this.armed = null;
    this.banner = null;
    if (hadState) {
      this.onStateChanged();
    }
  }

  public dispose(): void {
    this.clearFireTimer();
    this.clearHoldTimer();
    this.clearNoticeTimer();
    this.armed = null;
    this.banner = null;
  }

  public async handleKeyDown(
    beats: QuantizeBeats,
    start: QuantizeStart,
    fallbackMs: number | undefined,
    fire: (durationMs: number | undefined) => Promise<void>,
    now = this.clock()
  ): Promise<void> {
    if (this.armed !== null) {
      // A second press while ARMED: short tap (< holdMs) fires immediately on keyUp;
      // holding (>= holdMs) cancels visibly without firing. Keep fireTimer running
      // until either keyUp fires early or holdMs elapses so a press just before the
      // bar boundary never delays the bar fire.
      this.clearHoldTimer();
      this.armed.secondPressDown = true;
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null;
        if (this.armed === null) return;
        this.clearFireTimer();
        this.armed = null;
        this.showTransientNotice("cancelled");
      }, this.holdMs);
      return;
    }

    this.clearNoticeTimer();
    if (this.banner !== null) {
      this.banner = null;
    }

    const sampled = beats === 0 && start === "now" ? undefined : this.signals?.sample(now);
    const plan = planQuantizedFade(sampled, beats, start, fallbackMs);

    if (plan.noTempo) {
      this.showTransientNotice("no_tempo");
      await fire(plan.durationMs);
      return;
    }

    if (plan.waitMs === 0) {
      this.onStateChanged();
      await fire(plan.durationMs);
      return;
    }

    const entry: ArmedState = {
      durationMs: plan.durationMs,
      fire,
      secondPressDown: false
    };
    this.armed = entry;

    this.fireTimer = setTimeout(() => {
      this.fireTimer = null;
      this.clearHoldTimer();
      if (this.armed !== entry) return;
      this.armed = null;
      this.onStateChanged();
      void entry.fire(entry.durationMs).catch(() => {});
    }, plan.waitMs);

    // Holding the initial arming press past holdMs also cancels visibly without firing.
    this.clearHoldTimer();
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (this.armed !== entry) return;
      this.clearFireTimer();
      this.armed = null;
      this.showTransientNotice("cancelled");
    }, this.holdMs);

    this.onStateChanged();
  }

  public async handleKeyUp(): Promise<void> {
    this.clearHoldTimer();
    if (this.armed !== null && this.armed.secondPressDown) {
      const entry = this.armed;
      this.clearFireTimer();
      this.armed = null;
      this.onStateChanged();
      await entry.fire(entry.durationMs);
    }
  }

  private showTransientNotice(kind: "no_tempo" | "cancelled"): void {
    this.clearNoticeTimer();
    this.banner = kind;
    this.onStateChanged();
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      if (this.banner === kind) {
        this.banner = null;
        this.onStateChanged();
      }
    }, QUANTIZE_NOTICE_MS);
  }

  private clearFireTimer(): void {
    if (this.fireTimer !== null) {
      clearTimeout(this.fireTimer);
      this.fireTimer = null;
    }
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private clearNoticeTimer(): void {
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
  }
}
