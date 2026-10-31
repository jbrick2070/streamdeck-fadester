// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: how a page applies intents to its video
// (docs/vjster/REQUIREMENTS.md R-SPD-1..4, R-QLT-1..7, R-BEH-1, R-BEH-3, R-INT-4;
// PLAN.md 3.7). Pure logic over a MediaControl, so it is tested without a
// browser; youtube.ts and generic-video.ts are the two real controls.

import { createCoalescer, realClock, type CoalesceClock, type Coalescer } from "../../src/vjster/shared/coalesce.js";
import type { Capability, Intent } from "../../src/vjster/shared/protocol.js";
import { AUTO, normalizeLevels, resolveHeldLevel, stepQuality } from "../../src/vjster/shared/quality.js";
import { clampRate, isRateStep, nextRate, rangeFor, RESET_RATE } from "../../src/vjster/shared/speed.js";
import { NO_VIDEO, cleanPageState, type PageState } from "./page-state.js";

/** One page's video, as the adapter sees it. */
export interface MediaControl {
  readonly kind: "youtube" | "video";
  /** The player offers quality control (YouTube's quality methods are all there, R-QLT-2). */
  readonly canQuality: boolean;
  /** The rate the element is playing at. */
  elementRate(): number | null;
  /** Rates the player offers; empty for a plain video element. */
  availableRates(): number[];
  /** The level playing now, or null without quality control. */
  quality(): string | null;
  /** `auto` or the fixed level; null without quality control. */
  preferredQuality(): string | null;
  /** Levels as the player reports them, `auto` included. */
  availableQualities(): string[];
  title(): string | null;
  playing(): boolean;
  adShowing(): boolean;
  /** Through the player's API where there is one (the site's menu follows), else the element. */
  setRate(rate: number): void;
  /** Straight to the element (extended range, R-SPD-2). May throw NotSupportedError. */
  setElementRate(rate: number): void;
  setQuality(level: string): void;
  setQualityAuto(): void;
  play(): void;
  pause(): void;
}

/**
 * A report the adapter sends: the page state, the intent it answers or null,
 * and whether the page's video has played since the adapter started.
 */
export type Report =
  | { readonly kind: "state"; readonly state: PageState; readonly inReplyTo: string | null; readonly played: boolean }
  | { readonly kind: "error"; readonly code: "no-video" | "unsupported"; readonly message: string; readonly inReplyTo: string | null };

/** Ids of intents held during an ad, by what they change (R-BEH-1). */
type HeldKind = "speed" | "quality" | "transport";

export interface AdapterOptions {
  /** How often a quality change is read back, and for how long (R-QLT-3). */
  qualityPollMs?: number;
  qualityPollForMs?: number;
  /** Skip an unsolicited report that says the same as the last one sent. */
  dedupe?: boolean;
  clock?: CoalesceClock;
}

/**
 * What a quality read-back waits for: a given level; a held level, resolved
 * again against the offered levels on every tick and re-applied until the
 * player keeps it (after navigation); or any change from the level playing
 * when it started (Auto).
 */
type QualityWait = { readonly level: string } | { readonly held: string } | { readonly from: string | null };

export class Adapter {
  private readonly coalescedReport: Coalescer<null>;
  private readonly held = new Map<HeldKind, Intent>();
  /** A level to re-apply after navigation (R-QLT-7). */
  private heldLevel: string | null = null;
  /** A rate written to the element that must survive the element being replaced (R-SPD-4). */
  private heldElementRate: number | null = null;
  /** The last rate written straight to the element; shown with the R-SPD-2 marker. */
  private directRate: number | null = null;
  private wasAd = false;
  private played = false;
  private lastSent: string | null = null;
  private pollTimer: unknown = null;
  private readonly qualityPollMs: number;
  private readonly qualityPollForMs: number;
  private readonly dedupe: boolean;
  private readonly clock: CoalesceClock;

  constructor(
    private readonly control: () => MediaControl | null,
    private readonly send: (report: Report) => void,
    options: AdapterOptions = {}
  ) {
    this.clock = options.clock ?? realClock;
    this.qualityPollMs = options.qualityPollMs ?? 500;
    this.qualityPollForMs = options.qualityPollForMs ?? 5000;
    this.dedupe = options.dedupe ?? false;
    // Unsolicited reports from bursts of media events coalesce (R-BEH-3).
    this.coalescedReport = createCoalescer<null>(() => this.report(null), 50, this.clock);
  }

  /** The page state now, cleaned to the sender rules; no video when the player throws. */
  snapshot(): PageState {
    const c = this.control();
    if (!c) return NO_VIDEO;
    try {
      const elementRate = c.elementRate();
      const quality = c.kind === "youtube" && c.canQuality;
      const capabilities: Capability[] = quality ? ["speed", "quality", "transport"] : ["speed", "transport"];
      const preferred = quality ? c.preferredQuality() : null;
      const direct = this.directRate !== null && elementRate !== null && Math.abs(elementRate - this.directRate) < 1e-9;
      const state = cleanPageState({
        rate: elementRate,
        rateDirect: direct,
        availableRates: c.availableRates(),
        quality: quality ? c.quality() : null,
        availableQualities: quality ? c.availableQualities() : [],
        qualityAuto: quality ? preferred === AUTO : null,
        title: c.title(),
        playing: c.playing(),
        adPlaying: c.adShowing(),
        capabilities
      });
      if (state.playing) this.played = true;
      return state;
    } catch {
      return NO_VIDEO;
    }
  }

  /** Something about the video changed (play, pause, rate, metadata): report it, coalesced. */
  changed(): void {
    const ad = this.adShowing();
    if (this.wasAd && !ad) {
      this.releaseHeld();
      this.reapplyHeldRate(false);
    }
    this.wasAd = ad;
    this.coalescedReport.push(null);
  }

  /** Report now, even if nothing changed (the worker restarted or the link reopened). */
  refresh(): void {
    this.report(null, true);
  }

  /** The page navigated in place (yt-navigate-finish): re-apply a held level (R-QLT-7), then report. */
  navigated(): void {
    const c = this.control();
    if (c && c.kind === "youtube" && c.canQuality && this.heldLevel !== null && !this.adShowing()) {
      const held = this.heldLevel;
      const level = this.safelyGet(() => resolveHeldLevel(held, normalizeLevels(c.availableQualities())));
      if (level !== null) this.safely(() => c.setQuality(level));
      // The level list may still be empty, and the player may reset its preference after this
      // event (V-9): keep resolving and re-applying while the read-back runs.
      this.pollQuality({ held });
    }
    this.elementReplaced();
  }

  /** The element was replaced or reloaded its metadata: re-apply a held element rate (R-SPD-4). */
  elementReplaced(): void {
    if (!this.adShowing()) this.reapplyHeldRate(true);
    this.changed();
  }

  /** Apply one validated intent and answer it (R-INT-4). */
  handle(intent: Intent): void {
    try {
      this.handleUnsafe(intent);
    } catch {
      this.send({ kind: "error", code: "unsupported", message: "the page failed to apply the change", inReplyTo: intent.id });
    }
  }

  /** Stop timers; the adapter is being thrown away. */
  dispose(): void {
    this.coalescedReport.cancel();
    if (this.pollTimer !== null) this.clock.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private handleUnsafe(intent: Intent): void {
    const c = this.control();
    if (intent.type === "state.get") return this.report(intent.id);
    if (intent.type === "pin.set") return this.report(intent.id); // the service worker owns pins
    if (!c) return this.send({ kind: "error", code: "no-video", message: "no video on this page", inReplyTo: intent.id });

    const kind = kindOf(intent);
    if (kind === "quality" && !(c.kind === "youtube" && c.canQuality)) {
      return this.send({ kind: "error", code: "unsupported", message: "quality control needs the YouTube player", inReplyTo: intent.id });
    }
    if (c.adShowing()) {
      // Never change anything during an ad (R-BEH-1): hold the latest intent of
      // each kind, apply it when the ad ends, and answer with the ad state now.
      this.wasAd = true;
      if (kind === "transport" && this.held.get("transport")) this.held.delete("transport"); // two toggles cancel
      else this.held.set(kind, intent);
      return this.report(intent.id);
    }
    const ok = this.apply(c, intent);
    if (!ok) return this.send({ kind: "error", code: "unsupported", message: "the page refused the change", inReplyTo: intent.id });
    this.report(intent.id);
  }

  private apply(c: MediaControl, intent: Intent): boolean {
    switch (intent.type) {
      case "speed.set":
        return this.setSpeed(c, intent.rate, intent.direct, intent.hold);
      case "speed.step": {
        const step = Math.abs(intent.delta);
        if (!isRateStep(step)) return false;
        const range = rangeFor(c.availableRates(), intent.direct);
        const current = c.elementRate() ?? RESET_RATE;
        return this.setSpeed(c, nextRate(current, Math.sign(intent.delta), step, range), intent.direct, intent.hold);
      }
      case "speed.reset":
        this.heldElementRate = null;
        this.directRate = null;
        return this.safely(() => {
          c.setRate(RESET_RATE);
          if (c.kind === "youtube" && c.elementRate() !== RESET_RATE) c.setElementRate(RESET_RATE);
        });
      case "quality.set":
        if (intent.level === AUTO) return this.qualityAuto(c);
        return this.setLevel(c, intent.level, intent.hold);
      case "quality.step": {
        const levels = normalizeLevels(c.availableQualities());
        const preferred = c.preferredQuality();
        const from = preferred !== null && preferred !== AUTO ? preferred : c.quality();
        const level = stepQuality(levels, from, intent.direction);
        if (level === null) return false;
        return this.setLevel(c, level, intent.hold);
      }
      case "quality.reset":
        return this.qualityAuto(c);
      case "transport.toggle":
        return this.safely(() => (c.playing() ? c.pause() : c.play()));
      case "state.get":
      case "pin.set":
        return true;
    }
  }

  private setSpeed(c: MediaControl, rate: number, direct: boolean, hold: boolean): boolean {
    const target = clampRate(rate, rangeFor(c.availableRates(), direct));
    const toElement = direct || c.kind === "video";
    const ok = this.safely(() => {
      if (direct && c.kind === "youtube") return c.setElementRate(target);
      c.setRate(target);
      // After a direct write the player may think it is already at `target` and
      // skip the element; make sure the element really plays at `target`.
      if (c.kind === "youtube" && c.elementRate() !== target) c.setElementRate(target);
    });
    if (!ok) return false;
    this.directRate = direct && c.kind === "youtube" ? target : null;
    // YouTube carries an API rate to the next video by itself (V-9); an element rate needs holding.
    this.heldElementRate = hold && toElement ? target : null;
    return true;
  }

  private setLevel(c: MediaControl, level: string, hold: boolean): boolean {
    if (!normalizeLevels(c.availableQualities()).includes(level)) return false;
    const ok = this.safely(() => c.setQuality(level));
    if (!ok) return false;
    this.heldLevel = hold ? level : null;
    this.pollQuality({ level });
    return true;
  }

  private qualityAuto(c: MediaControl): boolean {
    this.heldLevel = null;
    const from = this.safelyGet(() => c.quality());
    const ok = this.safely(() => c.setQualityAuto());
    // Under Auto the player settles on a level a moment later (F-4): read it back like a fixed one (R-QLT-3).
    if (ok) this.pollQuality({ from });
    return ok;
  }

  /** Re-apply a held element rate; `always` writes it even when the element already plays it. */
  private reapplyHeldRate(always: boolean): void {
    const c = this.control();
    const rate = this.heldElementRate;
    if (!c || rate === null) return;
    if (!always && this.safelyGet(() => c.elementRate()) === rate) return;
    this.safely(() => (this.directRate !== null ? c.setElementRate(rate) : c.setRate(rate)));
  }

  /** Read the level back until it lands, or give up (R-QLT-3); report when it lands or at the end. */
  private pollQuality(wait: QualityWait): void {
    if (this.pollTimer !== null) this.clock.clearTimeout(this.pollTimer);
    const started = this.clock.now();
    const tick = (): void => {
      this.pollTimer = null;
      const c = this.control();
      if (!c) return;
      const playing = this.safelyGet(() => c.quality());
      if ("level" in wait) {
        if (playing === wait.level) return this.report(null);
      } else if ("held" in wait) {
        const level = this.safelyGet(() => resolveHeldLevel(wait.held, normalizeLevels(c.availableQualities())));
        const preferred = this.safelyGet(() => c.preferredQuality());
        if (level !== null && playing === level && preferred === level) return this.report(null);
        if (level !== null && preferred !== level && !this.adShowing()) this.safely(() => c.setQuality(level));
      } else if (playing !== wait.from) {
        return this.report(null);
      }
      if (this.clock.now() - started >= this.qualityPollForMs) return this.report(null);
      this.pollTimer = this.clock.setTimeout(tick, this.qualityPollMs);
    };
    this.pollTimer = this.clock.setTimeout(tick, this.qualityPollMs);
  }

  private releaseHeld(): void {
    const c = this.control();
    if (!c) return;
    const order: HeldKind[] = ["speed", "quality", "transport"];
    for (const kind of order) {
      const intent = this.held.get(kind);
      if (!intent) continue;
      this.held.delete(kind);
      this.safely(() => this.apply(c, intent));
    }
  }

  private adShowing(): boolean {
    return this.safelyGet(() => this.control()?.adShowing() ?? false) ?? false;
  }

  private report(inReplyTo: string | null, force = false): void {
    const state = this.snapshot();
    if (this.dedupe && inReplyTo === null && !force) {
      const text = JSON.stringify([state, this.played]);
      if (text === this.lastSent) return;
      this.lastSent = text;
    } else {
      this.lastSent = JSON.stringify([state, this.played]);
    }
    this.send({ kind: "state", state, inReplyTo, played: this.played });
  }

  private safely(fn: () => unknown): boolean {
    try {
      fn();
      return true;
    } catch {
      return false;
    }
  }

  private safelyGet<T>(fn: () => T): T | null {
    try {
      return fn();
    } catch {
      return null;
    }
  }
}

function kindOf(intent: Intent): HeldKind {
  if (intent.type.startsWith("speed.")) return "speed";
  if (intent.type.startsWith("quality.")) return "quality";
  return "transport";
}
