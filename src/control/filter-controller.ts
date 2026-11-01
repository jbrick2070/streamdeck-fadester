// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Reads and writes filter settings for the OBS Filter controls (PLAN.md 10.2,
 * R-RIG-1..5) with every safety rule of the VJ rig's review:
 *
 * - identity is `sourceUuid` + `filterName` + `filterKind`: a read of another
 *   kind is refused, a missing filter (600) is missing and never another one;
 * - reads are `GetSourceFilter` merged over the kind's defaults, on appear, on
 *   a press, at a gesture start and 1.5 s after the last write (no polling, no
 *   Filters subscription: the Audio Modulator changes its targets every frame);
 * - ownership is re-read (`GetSourceFilterList`) at every gesture start and
 *   before every glide: a setting a sibling Audio Modulator targets or the
 *   Shader Filter's Parameter Fader binds is never written;
 * - pending values merge per filter into one `overlay: true` patch, one write
 *   in flight per filter, at least 50 ms apart (200 ms for an Audio Modulator),
 *   at most 20 writes a second in all, each moving a setting at most 10 % of its
 *   range (one step for a whole-number range); a 50 ms drain carries the rest of
 *   a fast flick;
 * - glides (set, drop-and-return) run at 20 Hz under the same cap and are
 *   cancelled per setting; a turn on the same setting cancels one;
 * - a disconnect, reconnect or scene collection change bumps a generation that
 *   cancels glides, queued values and replies in flight;
 * - while Visual Panic is latched nothing of a Visual Sidechain filter is
 *   written and its glides stop.
 */
import { EventEmitter } from "node:events";
import { DirectObsClient, DirectObsError, DirectObsFilterInfo } from "../obs/direct-obs-client.js";
import {
  ExplicitRange,
  FilterOwner,
  FilterRange,
  SLEW_FRACTION,
  VS_MODULATOR_FILTER_KIND,
  clampToRange,
  findOwner,
  isVisualSidechainKind,
  resolveRange,
  restValue,
  slewStep,
  writableValue
} from "../obs/filter-ranges.js";
import { LocalText, errorLocalText, ownText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";

/** One filter setting the deck controls; `setting` is empty for an enabled toggle. */
export interface FilterTarget extends ExplicitRange {
  sourceUuid: string;
  filterName: string;
  filterKind: string;
  setting: string;
}

export type FilterAvailability =
  | "unbound" | "disconnected" | "loading" | "missing" | "wrong_kind" | "error"
  | "denied" | "needs_range" | "owned" | "no_value" | "ok";

/** What a control draws: observed values only. */
export interface FilterTargetState {
  availability: FilterAvailability;
  /** The setting's value as last read or written; null when OBS has none. */
  value: number | null;
  enabled: boolean | null;
  range: FilterRange | null;
  owner: FilterOwner | null;
  /** True while Visual Panic is latched and this is a Visual Sidechain filter. */
  latched: boolean;
  /** A glide (set, drop or return) is moving this setting. */
  gliding: boolean;
  /** The last failed read or write of this filter (an OBS text or ours). */
  error: LocalText | null;
}

export interface FilterControllerOptions {
  writeIntervalMs?: number;
  modulatorWriteIntervalMs?: number;
  maxWritesPerSecond?: number;
  slewFraction?: number;
  gestureIdleMs?: number;
  settleReadMs?: number;
  glideTickMs?: number;
}

export type GlideOutcome = "done" | "cancelled";

interface FilterRecord {
  key: string;
  sourceUuid: string;
  filterName: string;
  /** The kind the deck was bound to; a read showing another one is refused. */
  filterKind: string;
  read: "unknown" | "ok" | "missing" | "wrong_kind" | "error";
  /** The filter's settings merged over its kind's defaults, our writes applied. */
  values: Record<string, unknown>;
  enabled: boolean | null;
  error: LocalText | null;
  /** The newest wanted value per setting, merged into one patch per write. */
  pending: Map<string, number>;
  ranges: Map<string, FilterRange>;
  owners: Map<string, FilterOwner | null>;
  inFlight: boolean;
  lastWriteAt: number;
  /** Writes sent so far, and the number of the last write that carried each setting. */
  writes: number;
  writtenIn: Map<string, number>;
  drainTimer: ReturnType<typeof setTimeout> | null;
  settleTimer: ReturnType<typeof setTimeout> | null;
}

interface Gesture {
  lastTurnAt: number;
  /** Why this gesture's fresh read refused the setting; kept for the idle time, so a refused turn sends no reads. */
  error: unknown;
  /** Turns (as a fraction of the range) that arrived before the fresh read landed. */
  early: number;
  /** The wanted value once the fresh read landed (clamped, rounded only when written). */
  wanted: number | null;
  ready: Promise<void>;
  failed: boolean;
}

interface Glide {
  token: number;
  timer: ReturnType<typeof setInterval> | null;
  resolve: (outcome: GlideOutcome) => void;
}

interface Drop {
  /** The value to return to, once the drop's fresh read landed (null: nothing to return to). */
  saved: Promise<number | null>;
  /** Its return glide is under way; a new drop meanwhile keeps the value saved first. */
  returning: boolean;
}

const MISSING_CODE = 600;

function filterKey(sourceUuid: string, filterName: string): string {
  return `${sourceUuid}\u0000${filterName}`;
}

function settingKey(sourceUuid: string, filterName: string, setting: string): string {
  return `${filterKey(sourceUuid, filterName)}\u0000${setting}`;
}

export class FilterController extends EventEmitter {
  private readonly records = new Map<string, FilterRecord>();
  /** The targets visible controls show, re-read on every reconnect and collection change. */
  private readonly watched = new Map<number, FilterTarget>();
  private watchId = 0;
  private readonly gestures = new Map<string, Gesture>();
  private readonly glides = new Map<string, Glide>();
  private readonly drops = new Map<string, Drop>();
  private generation = 0;
  private glideToken = 0;
  private globalNextWriteAt = 0;
  private panicLatched = false;
  private readonly writeIntervalMs: number;
  private readonly modulatorWriteIntervalMs: number;
  private readonly globalIntervalMs: number;
  private readonly slewFraction: number;
  private readonly gestureIdleMs: number;
  private readonly settleReadMs: number;
  private readonly glideTickMs: number;

  public constructor(public readonly client: DirectObsClient, options: FilterControllerOptions = {}) {
    super();
    this.setMaxListeners(0);
    this.writeIntervalMs = options.writeIntervalMs ?? 50;
    this.modulatorWriteIntervalMs = options.modulatorWriteIntervalMs ?? 200;
    this.globalIntervalMs = 1000 / (options.maxWritesPerSecond ?? 20);
    this.slewFraction = options.slewFraction ?? SLEW_FRACTION;
    this.gestureIdleMs = options.gestureIdleMs ?? 1000;
    this.settleReadMs = options.settleReadMs ?? 1500;
    this.glideTickMs = options.glideTickMs ?? 50;
    // Disconnect, stop and reconnect (a reconnect keeps the status, so statusChanged is not enough).
    client.on("connectionReset", () => this.invalidate());
    client.on("connectionReady", () => this.refreshWatched());
    client.on("obsEvent", (type: string) => {
      if (type === "CurrentSceneCollectionChanging" || type === "CurrentSceneCollectionChanged") {
        this.invalidate();
        // After the client has taken the event (it clears its collection-changing flag after this listener).
        if (type === "CurrentSceneCollectionChanged") queueMicrotask(() => this.refreshWatched());
      }
    });
  }

  // ---- The Visual Panic latch (src/control/visual-safety.ts sets it) ----

  public setPanicLatched(latched: boolean): void {
    if (this.panicLatched === latched) return;
    this.panicLatched = latched;
    if (latched) {
      // Stop everything aimed at a Visual Sidechain filter: Restore would overwrite it anyway.
      for (const record of this.records.values()) {
        if (!isVisualSidechainKind(record.filterKind)) continue;
        record.pending.clear();
        this.cancelFilterWork(record.key);
      }
    }
    this.emit("changed", "");
  }

  public isPanicLatched(): boolean {
    return this.panicLatched;
  }

  // ---- Observation ----

  /** A control that shows a target: read it now (and on every reconnect), released idempotently. */
  public watch(target: FilterTarget): () => void {
    if (!target.sourceUuid || !target.filterName) return () => {};
    const id = ++this.watchId;
    this.watched.set(id, { ...target });
    void this.refresh(target).catch(() => {});
    return () => { this.watched.delete(id); };
  }

  /** A fresh read of the filter and, for a setting, of who else drives it. */
  public async refresh(target: FilterTarget): Promise<void> {
    if (!target.sourceUuid || !target.filterName || !this.client.isConnected()) return;
    const generation = this.generation;
    const record = this.recordFor(target);
    await this.readFilter(record, generation);
    if (target.setting && record.read === "ok") await this.readOwnership(record, target.setting, generation);
  }

  public getState(target: FilterTarget): FilterTargetState {
    const base: FilterTargetState = {
      availability: "ok", value: null, enabled: null, range: null, owner: null, latched: false, gliding: false, error: null
    };
    if (!target.sourceUuid || !target.filterName) return { ...base, availability: "unbound" };
    if (!this.client.isConnected()) return { ...base, availability: "disconnected" };
    const record = this.records.get(filterKey(target.sourceUuid, target.filterName));
    const latched = this.panicLatched && isVisualSidechainKind(target.filterKind);
    if (!record || record.filterKind !== target.filterKind) return { ...base, availability: "loading", latched };
    const state: FilterTargetState = { ...base, enabled: record.enabled, latched, error: record.error };
    if (record.read === "unknown") return { ...state, availability: "loading" };
    if (record.read !== "ok") return { ...state, availability: record.read };
    if (!target.setting) return state;
    const resolved = resolveRange(target.filterKind, target.setting, target);
    if (!resolved.ok) return { ...state, availability: resolved.reason };
    const raw = record.values[target.setting];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    const owner = record.owners.get(target.setting) ?? null;
    return {
      ...state, range: resolved.range, value, owner,
      gliding: this.glides.has(settingKey(target.sourceUuid, target.filterName, target.setting)),
      availability: raw !== undefined && value === null ? "denied" : owner ? "owned" : value === null ? "no_value" : "ok"
    };
  }

  // ---- Writing ----

  /**
   * A dial turn: relative to a fresh read at the start of a gesture (a turn
   * after the idle time), and to the wanted value within it. A turn cancels a
   * glide or a drop on the same setting.
   */
  public async nudge(target: FilterTarget, deltaFraction: number, now = Date.now()): Promise<void> {
    if (!Number.isFinite(deltaFraction) || deltaFraction === 0) return;
    const range = this.requireWritable(target);
    const key = settingKey(target.sourceUuid, target.filterName, target.setting);
    this.cancelGlide(key);
    this.drops.delete(key);
    let gesture = this.gestures.get(key);
    if (gesture && now - gesture.lastTurnAt <= this.gestureIdleMs && gesture.failed) {
      gesture.lastTurnAt = now;
      throw gesture.error;
    }
    if (!gesture || now - gesture.lastTurnAt > this.gestureIdleMs) {
      const generation = this.generation;
      const record = this.recordFor(target);
      const created: Gesture = { lastTurnAt: now, error: null, early: 0, wanted: null, failed: false, ready: Promise.resolve() };
      created.ready = (async () => {
        try {
          await this.readFilter(record, generation);
          await this.readOwnership(record, target.setting, generation);
          this.requireReady(record, target, generation);
          const value = record.values[target.setting] as number;
          created.wanted = clampToRange(value + created.early * (range.max - range.min), range);
        } catch (error) {
          created.failed = true;
          created.error = error;
          throw error;
        }
      })();
      gesture = created;
      this.gestures.set(key, gesture);
    }
    gesture.lastTurnAt = now;
    if (gesture.wanted === null) {
      gesture.early += deltaFraction;
      await gesture.ready;
    } else {
      gesture.wanted = clampToRange(gesture.wanted + deltaFraction * (range.max - range.min), range);
    }
    if (this.gestures.get(key) !== gesture || gesture.wanted === null) return;
    this.requireWritable(target);
    this.setPending(this.recordFor(target), target.setting, gesture.wanted, range);
  }

  /** Glides a setting to a value over a time (20 Hz, under the slew cap); a fresh read and ownership check first. */
  public async glideTo(target: FilterTarget, value: number, durationMs: number): Promise<GlideOutcome> {
    return this.runGlide(target, this.requireWritable(target), () => value, durationMs);
  }

  /** Moves a setting by a fraction of its range from a fresh read (a step key). */
  public async step(target: FilterTarget, deltaFraction: number): Promise<GlideOutcome> {
    const range = this.requireWritable(target);
    return this.runGlide(target, range, (from) => from + deltaFraction * (range.max - range.min), 0);
  }

  /**
   * The first half of drop-and-return: saves the value read fresh and glides
   * to the rest value (the range's value nearest 0, so 0 for a bipolar range).
   * A drop while the previous one is still returning keeps the value saved first.
   */
  public async dropStart(target: FilterTarget, durationMs = 500): Promise<GlideOutcome> {
    const range = this.requireWritable(target);
    const key = settingKey(target.sourceUuid, target.filterName, target.setting);
    const earlier = this.drops.get(key);
    let resolveSaved: (value: number | null) => void = () => {};
    const drop: Drop = earlier
      ? { saved: earlier.saved, returning: false }
      : { saved: new Promise((resolve) => { resolveSaved = resolve; }), returning: false };
    this.drops.set(key, drop);
    try {
      return await this.runGlide(target, range, () => restValue(range), durationMs, (from) => resolveSaved(from));
    } catch (error) {
      if (this.drops.get(key) === drop) this.drops.delete(key);
      throw error;
    } finally {
      // A drop whose read failed or was cancelled has nothing to return to.
      resolveSaved(null);
    }
  }

  /** The second half: back to the saved value. Nothing when a turn or a retarget cancelled the drop. */
  public async dropReturn(target: FilterTarget, durationMs = 500): Promise<GlideOutcome> {
    const key = settingKey(target.sourceUuid, target.filterName, target.setting);
    const drop = this.drops.get(key);
    if (!drop || drop.returning) return "cancelled";
    drop.returning = true;
    const saved = await drop.saved;
    if (this.drops.get(key) !== drop || !drop.returning) return "cancelled";
    if (saved === null) {
      this.drops.delete(key);
      return "cancelled";
    }
    try {
      const outcome = await this.glideTo(target, saved, durationMs);
      if (this.drops.get(key) === drop && drop.returning) this.drops.delete(key);
      return outcome;
    } catch (error) {
      if (this.drops.get(key) === drop) this.drops.delete(key);
      throw error;
    }
  }

  /** True while a drop on this setting waits for (or runs) its return. */
  public isDropped(target: FilterTarget): boolean {
    return this.drops.has(settingKey(target.sourceUuid, target.filterName, target.setting));
  }

  /** Cancels a glide and a drop on one setting (a retarget); the value stays where it is. */
  public cancel(target: FilterTarget): boolean {
    const key = settingKey(target.sourceUuid, target.filterName, target.setting);
    const had = this.glides.has(key) || this.drops.has(key);
    this.cancelGlide(key);
    this.drops.delete(key);
    this.gestures.delete(key);
    return had;
  }

  /** Turns the filter on or off from a fresh read of its enabled state, never from the cached picture. */
  public async toggleEnabled(target: Pick<FilterTarget, "sourceUuid" | "filterName" | "filterKind">): Promise<boolean> {
    this.requireBound(target);
    if (this.panicLatched && isVisualSidechainKind(target.filterKind)) throw new DirectObsError(ownText("filterLatched"), 409);
    const generation = this.generation;
    const record = this.recordFor(target);
    await this.readFilter(record, generation);
    this.requireReady(record, { ...target, setting: "" }, generation);
    if (this.panicLatched && isVisualSidechainKind(target.filterKind)) throw new DirectObsError(ownText("filterLatched"), 409);
    const next = record.enabled !== true;
    await this.client.setSourceFilterEnabled(target.sourceUuid, target.filterName, next);
    if (generation !== this.generation) throw new DirectObsError(ownText("errorControlChanged"), 400);
    record.enabled = next;
    this.emit("changed", record.key);
    return next;
  }

  // ---- Internals ----

  private async runGlide(target: FilterTarget, range: FilterRange, toValue: (from: number) => number, durationMs: number,
    onFrom?: (from: number) => void): Promise<GlideOutcome> {
    const key = settingKey(target.sourceUuid, target.filterName, target.setting);
    this.cancelGlide(key);
    this.gestures.delete(key);
    const token = ++this.glideToken;
    const generation = this.generation;
    // Claimed before the read, so a second glide or a turn meanwhile cancels this one.
    let settle: (outcome: GlideOutcome) => void = () => {};
    const done = new Promise<GlideOutcome>((resolve) => { settle = resolve; });
    this.glides.set(key, { token, timer: null, resolve: settle });
    this.emit("changed", filterKey(target.sourceUuid, target.filterName));
    const record = this.recordFor(target);
    try {
      await this.readFilter(record, generation);
      await this.readOwnership(record, target.setting, generation);
      this.requireReady(record, target, generation);
    } catch (error) {
      // Cancelled while it read: a quiet outcome, not an error.
      if (this.glides.get(key)?.token !== token) return "cancelled";
      this.glides.delete(key);
      this.emit("changed", record.key);
      throw error;
    }
    const glide = this.glides.get(key);
    if (!glide || glide.token !== token) return "cancelled";
    const from = record.values[target.setting] as number;
    onFrom?.(from);
    const to = clampToRange(toValue(from), range);
    const startedAt = Date.now();
    const step = (): void => {
      const current = this.glides.get(key);
      if (!current || current.token !== token) return;
      if (generation !== this.generation || (this.panicLatched && isVisualSidechainKind(target.filterKind))) {
        this.cancelGlide(key);
        return;
      }
      const progress = durationMs > 0 ? Math.min(1, (Date.now() - startedAt) / durationMs) : 1;
      this.setPending(record, target.setting, from + (to - from) * progress, range);
      if (progress >= 1) {
        if (current.timer) clearInterval(current.timer);
        this.glides.delete(key);
        current.resolve("done");
        this.emit("changed", record.key);
      }
    };
    glide.timer = setInterval(step, this.glideTickMs);
    glide.timer.unref?.();
    step();
    return done;
  }

  private recordFor(target: Pick<FilterTarget, "sourceUuid" | "filterName" | "filterKind">): FilterRecord {
    const key = filterKey(target.sourceUuid, target.filterName);
    let record = this.records.get(key);
    if (record && record.filterKind !== target.filterKind) {
      // Rebound to another kind: what was read under the old binding does not apply.
      this.cancelFilterWork(key);
      if (record.drainTimer) clearTimeout(record.drainTimer);
      if (record.settleTimer) clearTimeout(record.settleTimer);
      this.records.delete(key);
      record = undefined;
    }
    if (!record) {
      record = {
        key, sourceUuid: target.sourceUuid, filterName: target.filterName, filterKind: target.filterKind,
        read: "unknown", values: {}, enabled: null, error: null, pending: new Map(), ranges: new Map(),
        owners: new Map(), inFlight: false, lastWriteAt: 0, writes: 0, writtenIn: new Map(),
        drainTimer: null, settleTimer: null
      };
      this.records.set(key, record);
    }
    return record;
  }

  private requireBound(target: Pick<FilterTarget, "sourceUuid" | "filterName">): void {
    if (!target.sourceUuid || !target.filterName) throw new DirectObsError(ownText("errorFilterChoose"), 400);
    if (!this.client.isConnected()) throw new DirectObsError(ownText("layerErrorNotConnected"), 500);
  }

  /** Bound, connected, not latched, a writable setting with a range: everything checkable before a request. */
  private requireWritable(target: FilterTarget): FilterRange {
    this.requireBound(target);
    if (this.panicLatched && isVisualSidechainKind(target.filterKind)) throw new DirectObsError(ownText("filterLatched"), 409);
    const resolved = resolveRange(target.filterKind, target.setting, target);
    if (!resolved.ok) throw new DirectObsError(ownText(resolved.reason === "denied" ? "filterDenied" : "filterNeedsRange"), 400);
    return resolved.range;
  }

  /** After a fresh read: the filter is there, of its kind, the setting has a number and nobody else drives it. */
  private requireReady(record: FilterRecord, target: FilterTarget, generation: number): void {
    if (generation !== this.generation) throw new DirectObsError(ownText("errorControlChanged"), 400);
    if (record.read === "missing") throw new DirectObsError(ownText("filterMissing"), 404);
    if (record.read === "wrong_kind") throw new DirectObsError(ownText("filterWrongKind"), 409);
    if (record.read !== "ok") throw new DirectObsError(record.error ?? ownText("errorRequestFailed", { code: 500 }), 500);
    if (this.panicLatched && isVisualSidechainKind(record.filterKind)) throw new DirectObsError(ownText("filterLatched"), 409);
    if (!target.setting) return;
    const raw = record.values[target.setting];
    if (raw !== undefined && typeof raw !== "number") throw new DirectObsError(ownText("filterDenied"), 400);
    if (typeof raw !== "number" || !Number.isFinite(raw)) throw new DirectObsError(ownText("filterNoValue"), 400);
    const owner = record.owners.get(target.setting);
    if (owner) throw new DirectObsError(owner.kind === "fader" ? ownText("filterOwnedFader")
      : ownText("filterOwnedModulator", { filter: owner.filterName }), 409);
  }

  /** `GetSourceFilter` merged over the kind's defaults; the kind must be the bound one. */
  private async readFilter(record: FilterRecord, generation: number): Promise<void> {
    const writesBefore = record.writes;
    let info: DirectObsFilterInfo;
    let defaults: Record<string, unknown> = {};
    try {
      info = await this.client.getSourceFilter(record.sourceUuid, record.filterName);
      if (info.filterKind === record.filterKind) defaults = await this.client.getSourceFilterDefaultSettings(info.filterKind);
    } catch (error) {
      if (generation !== this.generation || this.records.get(record.key) !== record) return;
      const code = (error as { code?: unknown }).code;
      record.read = code === MISSING_CODE ? "missing" : "error";
      record.error = code === MISSING_CODE ? null : errorLocalText(error, ownText("errorRequestFailed", { code: 500 }));
      this.emit("changed", record.key);
      return;
    }
    if (generation !== this.generation || this.records.get(record.key) !== record) return;
    if (info.filterKind !== record.filterKind) {
      record.read = "wrong_kind";
      record.error = null;
      this.emit("changed", record.key);
      return;
    }
    const previous = record.values;
    record.read = "ok";
    record.error = null;
    record.enabled = info.filterEnabled;
    record.values = { ...defaults, ...info.filterSettings };
    // A write sent after this read was sent is newer than what the read saw.
    for (const [setting, write] of record.writtenIn) {
      if (write > writesBefore && setting in previous) record.values[setting] = previous[setting];
    }
    this.emit("changed", record.key);
  }

  /** `GetSourceFilterList` on the source: who else drives this setting (sibling modulators, the shader's fader). */
  private async readOwnership(record: FilterRecord, setting: string, generation: number): Promise<void> {
    if (record.read !== "ok") return;
    const filters = await this.client.getSourceFilterList(record.sourceUuid);
    const kinds = [...new Set(filters.map((filter) => filter.filterKind)
      .filter((kind) => kind === VS_MODULATOR_FILTER_KIND || kind === record.filterKind))];
    const defaults: Record<string, Record<string, unknown>> = {};
    for (const kind of kinds) defaults[kind] = await this.client.getSourceFilterDefaultSettings(kind);
    if (generation !== this.generation || this.records.get(record.key) !== record) return;
    record.owners.set(setting, findOwner(filters, defaults, { filterName: record.filterName, setting }));
    this.emit("changed", record.key);
  }

  private setPending(record: FilterRecord, setting: string, value: number, range: FilterRange): void {
    record.pending.set(setting, writableValue(value, range));
    record.ranges.set(setting, range);
    if (record.settleTimer) {
      clearTimeout(record.settleTimer);
      record.settleTimer = null;
    }
    this.scheduleDrain(record);
  }

  private intervalFor(record: FilterRecord): number {
    return record.filterKind === VS_MODULATOR_FILTER_KIND ? this.modulatorWriteIntervalMs : this.writeIntervalMs;
  }

  private scheduleDrain(record: FilterRecord): void {
    if (record.drainTimer || record.pending.size === 0) return;
    const now = Date.now();
    const wait = Math.max(0, record.lastWriteAt + this.intervalFor(record) - now, this.globalNextWriteAt - now);
    record.drainTimer = setTimeout(() => {
      record.drainTimer = null;
      void this.drain(record);
    }, wait);
    record.drainTimer.unref?.();
  }

  /** One merged patch per filter, each setting moved at most one slew step toward its newest wanted value. */
  private async drain(record: FilterRecord): Promise<void> {
    if (record.pending.size === 0 || this.records.get(record.key) !== record) return;
    // One write in flight per filter: the reply schedules the next one.
    if (record.inFlight) return;
    if (this.panicLatched && isVisualSidechainKind(record.filterKind)) {
      record.pending.clear();
      return;
    }
    const now = Date.now();
    if (now < this.globalNextWriteAt || now < record.lastWriteAt + this.intervalFor(record)) {
      this.scheduleDrain(record);
      return;
    }
    const generation = this.generation;
    const patch: Record<string, number> = {};
    for (const [setting, wanted] of record.pending) {
      const range = record.ranges.get(setting)!;
      const raw = record.values[setting];
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        // Nothing known to slew from (a read replaced the values): never jump, wait for the next gesture.
        record.pending.delete(setting);
        continue;
      }
      const limit = slewStep(range, this.slewFraction);
      const next = writableValue(raw + Math.max(-limit, Math.min(limit, wanted - raw)), range);
      if (Math.abs(wanted - next) < 1e-9 || next === raw) record.pending.delete(setting);
      // A value OBS already has is not sent again (a turn pinned at a rail).
      if (next !== raw) patch[setting] = next;
    }
    if (Object.keys(patch).length === 0) return;
    record.inFlight = true;
    record.lastWriteAt = now;
    record.writes++;
    for (const setting of Object.keys(patch)) record.writtenIn.set(setting, record.writes);
    this.globalNextWriteAt = now + this.globalIntervalMs;
    let stale = false;
    try {
      await this.client.setSourceFilterSettings(record.sourceUuid, record.filterName, patch);
      stale = generation !== this.generation || this.records.get(record.key) !== record;
      if (!stale) {
        Object.assign(record.values, patch);
        record.error = null;
      }
    } catch (error) {
      stale = generation !== this.generation || this.records.get(record.key) !== record;
      if (!stale) {
        // A refused write drops the queued values; the next read shows what OBS has.
        record.pending.clear();
        const code = (error as { code?: unknown }).code;
        if (code === MISSING_CODE) record.read = "missing";
        record.error = errorLocalText(error, ownText("errorRequestFailed", { code: 500 }));
      }
    } finally {
      record.inFlight = false;
    }
    if (stale) {
      // Values of the new generation waited for this reply.
      this.scheduleDrain(record);
      return;
    }
    this.emit("changed", record.key);
    if (record.pending.size > 0) this.scheduleDrain(record);
    else this.scheduleSettleRead(record, generation);
  }

  /** 1.5 s after the last write, read what OBS has (rounding, an edit in OBS meanwhile). */
  private scheduleSettleRead(record: FilterRecord, generation: number): void {
    if (record.settleTimer) clearTimeout(record.settleTimer);
    record.settleTimer = setTimeout(() => {
      record.settleTimer = null;
      if (generation !== this.generation || record.inFlight || record.pending.size > 0) return;
      void this.readFilter(record, generation);
    }, this.settleReadMs);
    record.settleTimer.unref?.();
  }

  private cancelGlide(key: string): void {
    const glide = this.glides.get(key);
    if (!glide) return;
    if (glide.timer) clearInterval(glide.timer);
    this.glides.delete(key);
    glide.resolve("cancelled");
  }

  /** Every glide, drop and gesture on one filter (its key is a prefix of their keys). */
  private cancelFilterWork(recordKey: string): void {
    const prefix = `${recordKey}\u0000`;
    for (const key of [...this.glides.keys()]) if (key.startsWith(prefix)) this.cancelGlide(key);
    for (const key of [...this.drops.keys()]) if (key.startsWith(prefix)) this.drops.delete(key);
    for (const key of [...this.gestures.keys()]) if (key.startsWith(prefix)) this.gestures.delete(key);
  }

  /** Disconnect, reconnect or a collection change: nothing queued, gliding or in flight survives. */
  private invalidate(): void {
    this.generation++;
    for (const key of [...this.glides.keys()]) this.cancelGlide(key);
    this.drops.clear();
    this.gestures.clear();
    for (const record of this.records.values()) {
      if (record.drainTimer) clearTimeout(record.drainTimer);
      if (record.settleTimer) clearTimeout(record.settleTimer);
      record.drainTimer = null;
      record.settleTimer = null;
      record.pending.clear();
      record.owners.clear();
      record.writtenIn.clear();
      record.read = "unknown";
      record.values = {};
      record.enabled = null;
      record.error = null;
    }
    this.emit("changed", "");
  }

  private refreshWatched(): void {
    const seen = new Set<string>();
    for (const target of this.watched.values()) {
      const id = JSON.stringify([target.sourceUuid, target.filterName, target.filterKind, target.setting]);
      if (seen.has(id)) continue;
      seen.add(id);
      void this.refresh(target).catch(() => {});
    }
  }
}
