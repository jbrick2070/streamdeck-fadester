// SPDX-License-Identifier: GPL-2.0-or-later
// VJster deck controllers: what each action does with a turn, a press or a
// tap, and what it draws (docs/vjster/REQUIREMENTS.md R-SPD-1..6, R-QLT-1..5,
// R-TGT-2, R-BEH-3, R-BEH-4; PLAN.md 3.2, 3.8). No Stream Deck SDK here, so
// they are tested with a fake hub and a fake sink; actions.ts wires them.

import { createCoalescer, realClock, type CoalesceClock, type Coalescer } from "../shared/coalesce.js";
import type { StateReport, Target } from "../shared/protocol.js";
import { AUTO, normalizeLevels, qualityLabel, stepQuality } from "../shared/quality.js";
import { nextRate, rangeBounds, rangeFor, type RateStep } from "../shared/speed.js";
import { AD_WORD, fit, formatRate, keyImage, qualityStrip, speedStrip, statusWord, type TargetView } from "./display.js";
import type { IntentBody } from "./link-server.js";
import type {
  QualityDialSettings,
  QualityPresetSettings,
  SpeedDialSettings,
  SpeedPresetSettings,
  SpeedStepSettings,
  TargetChoice,
  TransportSettings
} from "./settings.js";

/** The hub as the controllers see it. */
export interface HubLike {
  view(target: Target): TargetView;
  send(target: Target, body: IntentBody): string | null;
}

/** Where a controller draws and complains. */
export interface Sink {
  draw(svg: string): void;
  alert(): void;
}

/** How long a request may stay unanswered before the deck shows the reported value again. */
export const PENDING_MS = 1500;

/** Which target a setting shows; "both" shows the browser (R-OBS-3). */
const shownTarget = (t: TargetChoice): Target => (t === "obs" ? "obs" : "browser");
const sendTargets = (t: TargetChoice): Target[] => (t === "both" ? ["browser", "obs"] : [shownTarget(t)]);

/** Whether the target's state stops a control: any status word but the ad's, since the page holds changes made during an ad (R-BEH-1). */
function blocked(view: TargetView, need: "speed" | "quality" | "transport"): boolean {
  const w = statusWord(view, need);
  return w !== null && w.word !== AD_WORD;
}

/** Shared plumbing: send to the chosen targets, remember the ids, alert on an error that names one. */
abstract class Base {
  protected readonly sent = new Set<string>();

  constructor(
    protected readonly hub: HubLike,
    protected readonly sink: Sink,
    protected readonly clock: CoalesceClock
  ) {}

  protected abstract get targetChoice(): TargetChoice;

  /** A key caption that names the target when it is not Chrome (Phase 2): `OBS SPEED`, `SYNC PLAYING`. */
  protected caption(word: string): string {
    const t = this.targetChoice;
    return t === "obs" ? `OBS ${word}` : t === "both" ? `SYNC ${word}` : word;
  }

  /** Send now to every chosen target; false when none is connected (R-BEH-4: the strip already says why). */
  protected sendNow(body: IntentBody): string | null {
    let first: string | null = null;
    for (const t of sendTargets(this.targetChoice)) {
      const id = this.hub.send(t, body);
      if (id !== null) {
        this.sent.add(id);
        if (this.sent.size > 64) this.sent.delete(this.sent.values().next().value as string);
        if (t === shownTarget(this.targetChoice) || first === null) first = id;
      }
    }
    return first;
  }

  protected view(): TargetView {
    return this.hub.view(shownTarget(this.targetChoice));
  }

  /** A target answered one of this action's intents with an error. */
  error(inReplyTo: string | null): void {
    if (inReplyTo !== null && this.sent.has(inReplyTo)) this.sink.alert();
  }

  abstract render(): void;
}

/**
 * Something the deck asked for and the target has not confirmed yet (PLAN.md
 * 3.2 step 1). It goes when its answer arrives, when an error answers it, or
 * PENDING_MS after it was set; then `expired` redraws, so a dim value never
 * stays on the strip for want of another event. While an ad plays, the page
 * answers at once with the old state and applies the change after the ad
 * (R-BEH-1), so the value stays until the ad is over.
 */
class Pending<T> {
  private value: { v: T; id: string | null; at: number } | null = null;
  private timer: unknown = null;
  constructor(
    private readonly clock: CoalesceClock,
    private readonly expired: () => void
  ) {}
  set(v: T): void {
    this.value = { v, id: null, at: this.clock.now() };
    this.arm();
  }
  sentAs(id: string | null): void {
    if (this.value) this.value.id = id;
  }
  /** The pending value, unless answered or stale. */
  get(state: StateReport | null): T | null {
    if (!this.value) return null;
    if (state?.adPlaying) {
      this.value.at = this.clock.now();
      this.arm();
      return this.value.v;
    }
    if (this.clock.now() - this.value.at > PENDING_MS) this.drop();
    else if (state && this.value.id !== null && state.inReplyTo === this.value.id) this.drop();
    return this.value?.v ?? null;
  }
  /** An error answered `id`; true when it was this value's request, which is then forgotten. */
  failed(id: string | null): boolean {
    if (!this.value || id === null || this.value.id !== id) return false;
    this.drop();
    return true;
  }
  clear(): void {
    this.drop();
  }
  private drop(): void {
    this.value = null;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
  private arm(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.expired();
    }, PENDING_MS + 1);
  }
}

export class SpeedDialController extends Base {
  private settings: SpeedDialSettings;
  private readonly pending: Pending<number>;
  private readonly out: Coalescer<number>;
  private turnedWhileDown = false;
  private down = false;

  constructor(hub: HubLike, sink: Sink, settings: SpeedDialSettings, clock: CoalesceClock = realClock) {
    super(hub, sink, clock);
    this.settings = settings;
    this.pending = new Pending(clock, () => this.render());
    // Last value wins, at most one per 50 ms (R-BEH-3).
    this.out = createCoalescer<number>(
      (rate) => this.pending.sentAs(this.sendNow({ type: "speed.set", rate, direct: this.settings.extended, hold: this.settings.hold })),
      50,
      clock
    );
  }

  protected get targetChoice(): TargetChoice {
    return this.settings.target;
  }

  update(settings: SpeedDialSettings): void {
    this.settings = settings;
    this.render();
  }

  private range() {
    return rangeFor(this.view().state?.availableRates, this.settings.extended);
  }

  /** A turn: one step per notch, the fine step while held (R-SPD-1). Counts from an unanswered request first. */
  rotate(ticks: number, pressed: boolean): void {
    if (pressed) this.turnedWhileDown = true;
    const view = this.view();
    if (blocked(view, "speed")) return this.sink.alert();
    const step: RateStep = pressed ? this.settings.fineStep : this.settings.step;
    const base = this.pending.get(view.state) ?? view.state?.rate ?? 1;
    const rate = nextRate(base, Math.max(-1000, Math.min(1000, Math.trunc(ticks))), step, this.range());
    this.pending.set(rate);
    this.out.push(rate);
    this.render();
  }

  pressDown(): void {
    this.down = true;
    this.turnedWhileDown = false;
  }

  /** Press and release without a turn: back to 1x (R-SPD-3). */
  pressUp(): void {
    const wasDown = this.down;
    this.down = false;
    if (!wasDown || this.turnedWhileDown) return;
    this.out.cancel();
    this.pending.set(1);
    this.pending.sentAs(this.sendNow({ type: "speed.reset" }));
    this.render();
  }

  /** A tap on the strip: play or pause, when the target can (R-SPD-3). */
  tap(): void {
    const s = this.view().state;
    if (!s?.capabilities.includes("transport")) return this.sink.alert();
    this.sendNow({ type: "transport.toggle" });
  }

  render(): void {
    const view = this.view();
    const { min, max } = rangeBounds(this.range());
    this.sink.draw(
      speedStrip({ view, target: shownTarget(this.settings.target), pending: this.pending.get(view.state), min, max, label: this.settings.label })
    );
  }

  /** An error answered a request: forget its pending value and redraw (R-BEH-4). */
  override error(inReplyTo: string | null): void {
    super.error(inReplyTo);
    if (this.pending.failed(inReplyTo)) this.render();
  }

  dispose(): void {
    this.out.cancel();
    this.pending.clear();
  }
}

export class QualityDialController extends Base {
  private settings: QualityDialSettings;
  private readonly pending: Pending<string>;
  private readonly out: Coalescer<string>;

  constructor(hub: HubLike, sink: Sink, settings: QualityDialSettings, clock: CoalesceClock = realClock) {
    super(hub, sink, clock);
    this.settings = settings;
    this.pending = new Pending(clock, () => this.render());
    this.out = createCoalescer<string>((level) => this.pending.sentAs(this.sendNow({ type: "quality.set", level, hold: this.settings.hold })), 50, clock);
  }

  protected get targetChoice(): TargetChoice {
    return this.settings.target;
  }

  update(settings: QualityDialSettings): void {
    this.settings = settings;
    this.render();
  }

  private down = false;
  private turnedWhileDown = false;

  pressDown(): void {
    this.down = true;
    this.turnedWhileDown = false;
  }

  /** Release without a turn while held: back to Auto. */
  pressUp(): void {
    const wasDown = this.down;
    this.down = false;
    if (wasDown && !this.turnedWhileDown) this.press();
  }

  /** A turn steps through the offered levels; clockwise is higher quality (R-QLT-1). */
  rotate(ticks: number, pressed = false): void {
    if (pressed) this.turnedWhileDown = true;
    const view = this.view();
    if (blocked(view, "quality")) return this.sink.alert();
    const s = view.state as StateReport;
    const levels = normalizeLevels(s.availableQualities);
    const from = this.pending.get(s) ?? s.quality;
    const level = stepQuality(levels, from, Math.max(-100, Math.min(100, Math.trunc(ticks))));
    if (level === null) return this.sink.alert();
    this.pending.set(level);
    this.out.push(level);
    this.render();
  }

  /** A press or a tap: back to Auto (R-QLT-1). */
  press(): void {
    this.out.cancel();
    this.pending.clear();
    const view = this.view();
    if (!view.state?.capabilities.includes("quality")) return this.sink.alert();
    this.sendNow({ type: "quality.reset" });
  }

  render(): void {
    const view = this.view();
    this.sink.draw(qualityStrip({ view, target: shownTarget(this.settings.target), pending: this.pending.get(view.state), label: this.settings.label }));
  }

  /** An error answered a request: forget its pending value and redraw (R-BEH-4). */
  override error(inReplyTo: string | null): void {
    super.error(inReplyTo);
    if (this.pending.failed(inReplyTo)) this.render();
  }

  dispose(): void {
    this.out.cancel();
    this.pending.clear();
  }
}

/** Keys: one press, one intent, artwork that follows the target's state. */
export class SpeedPresetController extends Base {
  constructor(hub: HubLike, sink: Sink, private settings: SpeedPresetSettings, clock: CoalesceClock = realClock) {
    super(hub, sink, clock);
  }
  protected get targetChoice(): TargetChoice {
    return this.settings.target;
  }
  update(settings: SpeedPresetSettings): void {
    this.settings = settings;
    this.render();
  }
  press(): void {
    if (blocked(this.view(), "speed")) return this.sink.alert();
    this.sendNow({ type: "speed.set", rate: this.settings.rate, direct: this.settings.extended, hold: this.settings.hold });
  }
  render(): void {
    const view = this.view();
    const rate = view.state?.rate ?? null;
    const active = rate !== null && Math.abs(rate - this.settings.rate) < 1e-6;
    const dim = blocked(view, "speed");
    this.sink.draw(keyImage({ main: formatRate(this.settings.rate), sub: this.caption(this.settings.extended ? "FX SPEED" : "SPEED"), active, dim }));
  }
}

export class SpeedStepController extends Base {
  constructor(hub: HubLike, sink: Sink, private settings: SpeedStepSettings, clock: CoalesceClock = realClock) {
    super(hub, sink, clock);
  }
  protected get targetChoice(): TargetChoice {
    return this.settings.target;
  }
  update(settings: SpeedStepSettings): void {
    this.settings = settings;
    this.render();
  }
  press(): void {
    if (blocked(this.view(), "speed")) return this.sink.alert();
    this.sendNow({ type: "speed.step", delta: this.settings.direction * this.settings.step, direct: this.settings.extended, hold: true });
  }
  render(): void {
    const view = this.view();
    const rate = view.state?.rate;
    const sign = this.settings.direction > 0 ? "+" : "-";
    this.sink.draw(
      keyImage({
        main: `${sign}${this.settings.step}`,
        sub: this.caption(rate != null ? formatRate(rate) : "SPEED"),
        active: false,
        dim: blocked(view, "speed"),
        glyph: undefined
      })
    );
  }
}

export class QualityPresetController extends Base {
  constructor(hub: HubLike, sink: Sink, private settings: QualityPresetSettings, clock: CoalesceClock = realClock) {
    super(hub, sink, clock);
  }
  protected get targetChoice(): TargetChoice {
    return this.settings.target;
  }
  update(settings: QualityPresetSettings): void {
    this.settings = settings;
    this.render();
  }
  private offered(state: StateReport | null): boolean {
    return this.settings.level === AUTO || (state?.availableQualities.includes(this.settings.level) ?? false);
  }
  press(): void {
    const view = this.view();
    if ((blocked(view, "quality")) || !this.offered(view.state)) return this.sink.alert();
    this.sendNow(
      this.settings.level === AUTO ? { type: "quality.reset" } : { type: "quality.set", level: this.settings.level, hold: this.settings.hold }
    );
  }
  render(): void {
    const view = this.view();
    const s = view.state;
    const auto = this.settings.level === AUTO;
    const active = s !== null && (auto ? s.qualityAuto === true : s.qualityAuto === false && s.quality === this.settings.level);
    const dim = (blocked(view, "quality")) || !this.offered(s);
    this.sink.draw(keyImage({ main: auto ? "AUTO" : qualityLabel(this.settings.level), sub: this.caption("QUALITY"), active, dim }));
  }
}

export class PinController extends Base {
  constructor(hub: HubLike, sink: Sink, clock: CoalesceClock = realClock) {
    super(hub, sink, clock);
  }
  protected get targetChoice(): TargetChoice {
    return "browser";
  }
  /** Pin the active tab, or unpin (R-TGT-2). */
  press(): void {
    const view = this.view();
    if (view.status !== "connected") return this.sink.alert();
    this.sendNow({ type: "pin.set", pinned: view.state?.pinned !== true });
  }
  render(): void {
    const view = this.view();
    const pinned = view.state?.pinned === true;
    // The reported tab is the pinned one, so its title is the pinned title (R-TGT-2).
    const title = pinned ? (view.state?.title ?? null) : null;
    this.sink.draw(keyImage({ main: "", sub: pinned ? (title ? fit(title, 14) : "PINNED") : "PIN TAB", active: pinned, dim: view.status !== "connected", glyph: "pin" }));
  }
}

export class TransportController extends Base {
  constructor(hub: HubLike, sink: Sink, private settings: TransportSettings, clock: CoalesceClock = realClock) {
    super(hub, sink, clock);
  }
  protected get targetChoice(): TargetChoice {
    return this.settings.target;
  }
  update(settings: TransportSettings): void {
    this.settings = settings;
    this.render();
  }
  press(): void {
    const view = this.view();
    if (blocked(view, "transport")) return this.sink.alert();
    this.sendNow({ type: "transport.toggle" });
  }
  render(): void {
    const view = this.view();
    const playing = view.state?.playing === true;
    const dim = blocked(view, "transport");
    this.sink.draw(keyImage({ main: "", sub: this.caption(playing ? "PLAYING" : "PAUSED"), active: playing, dim, glyph: playing ? "pause" : "play" }));
  }
}
