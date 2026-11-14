// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Visual Sidechain's live signal subscription and tempo commands (P1-3):
 * - Subscribes to `visual-sidechain` `signals_changed` and `safety_changed` vendor
 *   events and reads initial state with `get_signals` on connect/reconnect.
 * - Exposes smoothed envelopes (`sub_bass`, `bass`, `mid`, `high`, `rms`, 32-band
 *   `spectrum`), tempo (`bpm`, `bpm_locked`, `beat_confidence`), locally stepped
 *   beat/bar progress (`beat_phase`, `beat_index`, `bar_phase`, `bar_index`), and
 *   plain states (`not_loaded`, `panic`, `no_audio`, `active`).
 * - Never exposes or draws raw `kick` (a 65 ms transient aliases inside the 10 Hz
 *   surface redraw cap).
 * - Sends `tap_tempo`, `lock_bpm`, `resync_downbeat`, and `set_bpm` with hotkey
 *   fallback (`visual_sidechain_tap_tempo`, `visual_sidechain_lock_bpm`,
 *   `visual_sidechain_resync_downbeat`) on obs-websocket code 604 for older builds.
 */
import { EventEmitter } from "node:events";
import { DirectObsClient, DirectObsError } from "../obs/direct-obs-client.js";
import { VS_VENDOR_NAME, VisualSafety } from "./visual-safety.js";
import { ownText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";

export const VS_TAP_TEMPO_HOTKEY = "visual_sidechain_tap_tempo";
export const VS_LOCK_BPM_HOTKEY = "visual_sidechain_lock_bpm";
export const VS_RESYNC_DOWNBEAT_HOTKEY = "visual_sidechain_resync_downbeat";

const NOT_FOUND_CODE = 600;
const INVALID_RESOURCE_TYPE_CODE = 604;
const SPECTRUM_BINS = 32;
const DEFAULT_BPM = 120;
const MIN_BPM = 30;
const MAX_BPM = 300;
/** Maximum local interpolation span without a fresh signal frame before holding position. */
const MAX_LOCAL_INTERPOLATION_SEC = 5;

export type VisualSignalsAvailability = "unknown" | "loaded" | "not_loaded";
export type VisualMeterPlainState = "disconnected" | "not_loaded" | "panic" | "no_audio" | "active";

export interface VisualSignalsSnapshot {
  readonly availability: VisualSignalsAvailability;
  readonly version: string;
  readonly audioPresent: boolean;
  readonly rms: number;
  readonly subBass: number;
  readonly bass: number;
  readonly mid: number;
  readonly high: number;
  readonly bpm: number;
  readonly bpmLocked: boolean;
  readonly beatPhase: number;
  readonly beatIndex: 0 | 1 | 2 | 3;
  readonly barPhase: number;
  readonly barIndex: number;
  readonly beatConfidence: number;
  readonly panic: boolean;
  readonly spectrum: readonly number[];
  readonly receivedAtMs: number;
}

export interface SampledVisualSignals extends VisualSignalsSnapshot {
  readonly state: VisualMeterPlainState;
  readonly connected: boolean;
}

interface TempoReply {
  api_version?: number;
  bpm?: number;
  bpm_locked?: boolean;
  beat_phase?: number;
  beat_index?: number;
  bar_phase?: number;
  bar_index?: number;
}

const ZERO_SPECTRUM: readonly number[] = Object.freeze(new Array<number>(SPECTRUM_BINS).fill(0));

function clamp01(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
}

function clampBpm(raw: unknown, fallback = DEFAULT_BPM): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(MIN_BPM, Math.min(MAX_BPM, raw))
    : fallback;
}

function positiveMod(value: number, period: number): number {
  const m = value % period;
  return m < 0 ? m + period : m;
}

function normalizeBeatIndex(raw: unknown, barPhase: number): 0 | 1 | 2 | 3 {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return (Math.trunc(positiveMod(Math.trunc(raw), 4)) as 0 | 1 | 2 | 3);
  }
  return (Math.min(3, Math.floor(clamp01(barPhase) * 4)) as 0 | 1 | 2 | 3);
}

function normalizeBarIndex(raw: unknown, fallback = 0): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? Math.trunc(raw)
    : fallback;
}

function normalizeSpectrum(raw: unknown): readonly number[] {
  if (!Array.isArray(raw)) return ZERO_SPECTRUM;
  const out = new Array<number>(SPECTRUM_BINS).fill(0);
  for (let i = 0; i < raw.length && i < SPECTRUM_BINS; i++) {
    const entry = raw[i];
    if (typeof entry === "number") {
      out[i] = clamp01(entry);
    } else if (entry !== null && typeof entry === "object") {
      const rec = entry as Record<string, unknown>;
      const bandIdx =
        typeof rec.band === "number" && Number.isInteger(rec.band) && rec.band >= 0 && rec.band < SPECTRUM_BINS
          ? rec.band
          : i;
      out[bandIdx] = clamp01(rec.value);
    }
  }
  return out;
}

function isMissingVendorOrRequest(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === NOT_FOUND_CODE || code === INVALID_RESOURCE_TYPE_CODE;
}

function emptySnapshot(nowMs: number): VisualSignalsSnapshot {
  return {
    availability: "unknown",
    version: "",
    audioPresent: false,
    rms: 0,
    subBass: 0,
    bass: 0,
    mid: 0,
    high: 0,
    bpm: DEFAULT_BPM,
    bpmLocked: false,
    beatPhase: 0,
    beatIndex: 0,
    barPhase: 0,
    barIndex: 0,
    beatConfidence: 0,
    panic: false,
    spectrum: ZERO_SPECTRUM,
    receivedAtMs: nowMs
  };
}

export class VisualSignals extends EventEmitter {
  private snapshot: VisualSignalsSnapshot;
  private connectionGen = 0;
  private remotePanic = false;

  public constructor(
    private readonly client: DirectObsClient,
    private readonly safety?: VisualSafety,
    private readonly clock: () => number = Date.now
  ) {
    super();
    this.setMaxListeners(0);
    this.snapshot = emptySnapshot(this.clock());

    client.on("connectionReset", () => {
      this.connectionGen++;
      this.remotePanic = false;
      this.snapshot = emptySnapshot(this.clock());
      this.emit("stateChanged");
    });

    client.on("connectionReady", () => {
      void this.refreshSignals();
    });

    client.on(
      "namedVendorEvent",
      (vendorName: string, eventType: string, eventData: Record<string, unknown>) => {
        if (vendorName !== VS_VENDOR_NAME) return;
        if (eventType === "signals_changed") {
          this.applySignalsPayload(eventData, false);
          return;
        }
        if (eventType === "safety_changed") {
          const prevState = this.plainState();
          const prevPanic = this.effectivePanic();
          this.remotePanic = Boolean(eventData.panic);
          this.snapshot = {
            ...this.snapshot,
            availability: "loaded",
            panic: this.effectivePanic()
          };
          if (this.plainState() !== prevState || this.effectivePanic() !== prevPanic) {
            this.emit("stateChanged");
          }
          this.emit("updated");
        }
      }
    );

    safety?.on("changed", () => {
      const nextPanic = this.effectivePanic();
      if (this.snapshot.panic !== nextPanic) {
        this.snapshot = { ...this.snapshot, panic: nextPanic };
        this.emit("stateChanged");
        this.emit("updated");
      }
    });

    if (client.isConnected()) {
      void this.refreshSignals();
    }
  }

  public getSnapshot(): VisualSignalsSnapshot {
    return this.snapshot;
  }

  /**
   * Samples the current Visual Sidechain state at `nowMs`, stepping `beatPhase`,
   * `beatIndex`, `barPhase` and `barIndex` locally from the last authoritative
   * snapshot when tempo is advancing (`audioPresent || bpmLocked`) and Panic is off.
   */
  public sample(nowMs = this.clock()): SampledVisualSignals {
    const connected = this.client.isConnected();
    const panic = this.effectivePanic();
    const snap = this.snapshot;
    let state: VisualMeterPlainState;
    if (!connected) {
      state = "disconnected";
    } else if (snap.availability === "not_loaded") {
      state = "not_loaded";
    } else if (panic) {
      state = "panic";
    } else if (!snap.audioPresent) {
      state = "no_audio";
    } else {
      state = "active";
    }

    const canAdvance =
      connected &&
      snap.availability === "loaded" &&
      !panic &&
      (snap.audioPresent || snap.bpmLocked) &&
      snap.bpm > 0;

    if (!canAdvance) {
      return {
        ...snap,
        panic,
        connected,
        state
      };
    }

    const dtSec = Math.max(0, Math.min(MAX_LOCAL_INTERPOLATION_SEC, (nowMs - snap.receivedAtMs) / 1000));
    const deltaBeats = dtSec * (snap.bpm / 60);
    const beatFromIndex = snap.beatIndex + snap.beatPhase;
    const barBeats0 = Math.abs(snap.barPhase * 4 - beatFromIndex) < 0.35 ? snap.barPhase * 4 : beatFromIndex;
    const totalBeats = barBeats0 + deltaBeats;
    const wrappedBeats = positiveMod(totalBeats, 4);
    const beatIndex = (Math.min(3, Math.floor(wrappedBeats)) as 0 | 1 | 2 | 3);
    const beatPhase = clamp01(wrappedBeats - beatIndex);
    const barPhase = clamp01(wrappedBeats / 4);
    const barIndex = snap.barIndex + Math.max(0, Math.floor(totalBeats / 4));

    return {
      ...snap,
      panic,
      beatPhase,
      beatIndex,
      barPhase,
      barIndex,
      connected,
      state
    };
  }

  public async refreshSignals(): Promise<void> {
    if (!this.client.isIdentified()) return;
    const gen = this.connectionGen;
    try {
      const reply = await this.client.callNamedVendor<Record<string, unknown>>(VS_VENDOR_NAME, "get_signals");
      if (gen !== this.connectionGen) return;
      this.applySignalsPayload(reply, true);
    } catch (error) {
      if (gen !== this.connectionGen) return;
      if (isMissingVendorOrRequest(error) && this.snapshot.availability !== "loaded") {
        this.snapshot = { ...this.snapshot, availability: "not_loaded", panic: this.effectivePanic() };
        this.emit("stateChanged");
        this.emit("updated");
      }
    }
  }

  public async tapTempo(): Promise<void> {
    await this.sendTempoCommand("tap_tempo", undefined, VS_TAP_TEMPO_HOTKEY);
  }

  public async setLockBpm(locked: boolean): Promise<void> {
    await this.sendTempoCommand("lock_bpm", { locked }, VS_LOCK_BPM_HOTKEY);
  }

  public async toggleLockBpm(): Promise<boolean> {
    const target = !this.snapshot.bpmLocked;
    await this.setLockBpm(target);
    return this.snapshot.bpmLocked;
  }

  public async resyncDownbeat(): Promise<void> {
    await this.sendTempoCommand("resync_downbeat", undefined, VS_RESYNC_DOWNBEAT_HOTKEY);
  }

  public async setBpm(bpm: number): Promise<void> {
    if (!this.client.isConnected()) throw new DirectObsError(ownText("layerErrorNotConnected"), 500);
    const clamped = clampBpm(bpm, this.snapshot.bpm);
    try {
      const reply = await this.client.callNamedVendor<TempoReply>(VS_VENDOR_NAME, "set_bpm", { bpm: clamped });
      this.applyTempoReply(reply);
    } catch (error) {
      throw this.tempoFailure(error);
    }
  }

  private async sendTempoCommand(
    requestType: "tap_tempo" | "lock_bpm" | "resync_downbeat",
    requestData: Record<string, unknown> | undefined,
    fallbackHotkey: string
  ): Promise<void> {
    if (!this.client.isConnected()) throw new DirectObsError(ownText("layerErrorNotConnected"), 500);
    try {
      const reply = await this.client.callNamedVendor<TempoReply>(VS_VENDOR_NAME, requestType, requestData);
      this.applyTempoReply(reply);
      return;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== INVALID_RESOURCE_TYPE_CODE) {
        throw this.tempoFailure(error);
      }
    }
    try {
      await this.client.triggerHotkeyByName(fallbackHotkey);
      if (requestType === "lock_bpm" && typeof requestData?.locked === "boolean") {
        this.snapshot = { ...this.snapshot, bpmLocked: requestData.locked };
        this.emit("stateChanged");
      } else if (requestType === "resync_downbeat") {
        this.snapshot = {
          ...this.snapshot,
          beatPhase: 0,
          beatIndex: 0,
          barPhase: 0,
          receivedAtMs: this.clock()
        };
        this.emit("stateChanged");
      }
      this.emit("updated");
    } catch (error) {
      throw this.tempoFailure(error);
    }
  }

  private applyTempoReply(reply: TempoReply): void {
    const prevLocked = this.snapshot.bpmLocked;
    const prevAvailability = this.snapshot.availability;
    const barPhase = reply.bar_phase !== undefined ? clamp01(reply.bar_phase) : this.snapshot.barPhase;
    this.snapshot = {
      ...this.snapshot,
      availability: "loaded",
      bpm: clampBpm(reply.bpm, this.snapshot.bpm),
      bpmLocked: typeof reply.bpm_locked === "boolean" ? reply.bpm_locked : this.snapshot.bpmLocked,
      beatPhase: reply.beat_phase !== undefined ? clamp01(reply.beat_phase) : this.snapshot.beatPhase,
      beatIndex: reply.beat_index !== undefined ? normalizeBeatIndex(reply.beat_index, barPhase) : this.snapshot.beatIndex,
      barPhase,
      barIndex: normalizeBarIndex(reply.bar_index, this.snapshot.barIndex),
      receivedAtMs: this.clock()
    };
    if (this.snapshot.bpmLocked !== prevLocked || prevAvailability !== "loaded") {
      this.emit("stateChanged");
    } else {
      this.emit("tempoChanged");
    }
    this.emit("updated");
  }

  private applySignalsPayload(raw: Record<string, unknown>, initial: boolean): void {
    const prevState = this.plainState();
    const prevLocked = this.snapshot.bpmLocked;
    const prevBpm = Math.round(this.snapshot.bpm);

    if (typeof raw.panic === "boolean") {
      this.remotePanic = raw.panic;
    }
    const rms = clamp01(raw.level ?? raw.rms);
    const audioPresent = typeof raw.audio_present === "boolean" ? raw.audio_present : rms > 0.001;
    const beatPhase = clamp01(raw.beat_phase);
    const barPhase = raw.bar_phase !== undefined
      ? clamp01(raw.bar_phase)
      : clamp01((normalizeBeatIndex(raw.beat_index, 0) + beatPhase) / 4);
    const beatIndex = normalizeBeatIndex(raw.beat_index, barPhase);

    this.snapshot = {
      availability: "loaded",
      version: initial && typeof raw.version === "string" ? raw.version : this.snapshot.version,
      audioPresent,
      rms,
      subBass: clamp01(raw.sub_bass),
      bass: clamp01(raw.bass),
      mid: clamp01(raw.mid),
      high: clamp01(raw.high),
      bpm: clampBpm(raw.bpm, this.snapshot.bpm),
      bpmLocked: Boolean(raw.bpm_locked),
      beatPhase,
      beatIndex,
      barPhase,
      barIndex: normalizeBarIndex(raw.bar_index, this.snapshot.barIndex),
      beatConfidence: clamp01(raw.beat_confidence),
      panic: this.effectivePanic(),
      spectrum: normalizeSpectrum(raw.spectrum),
      receivedAtMs: this.clock()
    };

    const nextState = this.plainState();
    if (
      initial ||
      nextState !== prevState ||
      this.snapshot.bpmLocked !== prevLocked ||
      Math.round(this.snapshot.bpm) !== prevBpm
    ) {
      this.emit("stateChanged");
    }
    this.emit("updated");
  }

  private effectivePanic(): boolean {
    return Boolean(this.remotePanic || this.safety?.isLatched());
  }

  private plainState(): VisualMeterPlainState {
    if (!this.client.isConnected()) return "disconnected";
    if (this.snapshot.availability === "not_loaded") return "not_loaded";
    if (this.effectivePanic()) return "panic";
    if (!this.snapshot.audioPresent) return "no_audio";
    return "active";
  }

  private tempoFailure(error: unknown): unknown {
    if ((error as { code?: unknown } | null)?.code === NOT_FOUND_CODE) {
      this.snapshot = { ...this.snapshot, availability: "not_loaded", panic: this.effectivePanic() };
      this.emit("stateChanged");
      return new DirectObsError(ownText("vpNotLoaded"), NOT_FOUND_CODE);
    }
    return error;
  }
}
