// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * OBS Filter controls (PLAN.md 10.4, R-RIG-1): a dial rides one filter
 * setting relative to a fresh read; its press drops and returns the value or
 * toggles the filter; a touch tap does nothing. A key toggles the filter, sets
 * a value over a time, or steps up or down. Every read and write goes through
 * the filter controller and its safety rules (src/control/filter-controller.ts).
 */
import {
  action,
  DialDownEvent,
  DialRotateEvent,
  DialUpEvent,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import { FilterController, FilterTarget, FilterTargetState } from "../control/filter-controller.js";
import { FilterRange, rangePosition, resolveRange, restValue, settingLabel } from "../obs/filter-ranges.js";
import { customCaption } from "../obs/preset-captions.js";
import { ObsFilterSettings, NormalizedObsFilterSettings, normalizeObsFilterSettings } from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { DirectKeyIcon, renderDirectKeySvg, renderFilterDialSvg, toStripUri, toSvgDataUri } from "../gfx/direct-obs-renderer.js";
import { computeDialDelta } from "./dial-math.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { LocalText, errorLocalText, ownText, wordText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { StringKey, formatNumber, onLanguageChanged, t, translate } from "../i18n/strings.js";

interface FilterSink {
  render(svg: string): Promise<void>;
  showAlert(): Promise<void>;
}

/** The dial's step per tick, as a fraction of the range (2 %, accelerated as the other dials). */
const DIAL_STEP = 0.02;
const DROP_MS = 500;

/** The value as the deck draws it: a percent as is, a 0..1 fraction as a percent, else the number. */
export function formatFilterValue(value: number, range: FilterRange): string {
  if (range.unit === "percent") return t("percent", { n: formatNumber(Math.round(value)) });
  if (range.unit === "fraction") return t("percent", { n: formatNumber(Math.round(value * 100)) });
  return formatNumber(value, range.integer ? 0 : 2);
}

/** A setting's short name: the table's translated word, else the setting's own name (an OBS name, verbatim). */
export function filterSettingName(kind: string, setting: string): string {
  const label = settingLabel(kind, setting);
  return label ? t(label.key, label.n !== undefined ? { n: label.n } : undefined) : setting;
}

export class ObsFilterInstanceController {
  private settings: NormalizedObsFilterSettings;
  private visible = false;
  /** Unsubscribes this control from language changes (PLAN.md 11.1). */
  private offLanguage: () => void = () => {};
  private releaseWatch: () => void = () => {};
  private readonly limiter: CellRateLimiter<string>;
  private lastError: LocalText | null = null;
  /** A notice the next change clears ("Glide cancelled" after a retarget). */
  private notice: StringKey | null = null;
  /** A drop this control started and has not returned yet (it returns even when hidden). */
  private droppedTarget: FilterTarget | null = null;
  private lastRotateAt = 0;
  private lastSvg = "";
  private readonly onChanged = (key: string): void => {
    if (key && key !== `${this.settings.sourceUuid}\u0000${this.settings.filterName}`) return;
    this.clearSettledError();
    this.render();
  };
  private readonly onStatusChanged = (): void => {
    this.clearSettledError();
    this.render();
  };

  public constructor(
    private readonly filters: FilterController,
    private readonly sink: FilterSink,
    private readonly dial: boolean,
    settings?: ObsFilterSettings,
    rateLimitMs = 100
  ) {
    this.settings = normalizeObsFilterSettings(settings);
    this.limiter = new CellRateLimiter<string>((svg) => this.sink.render(svg), rateLimitMs);
  }

  public appear(settings?: ObsFilterSettings): void {
    if (this.visible) this.disappear();
    if (settings) this.settings = normalizeObsFilterSettings(settings);
    this.visible = true;
    this.offLanguage();
    this.offLanguage = onLanguageChanged(() => this.render());
    this.filters.on("changed", this.onChanged);
    this.filters.client.on("statusChanged", this.onStatusChanged);
    this.releaseWatch = this.filters.watch(this.target());
    this.render();
  }

  public disappear(): void {
    this.visible = false;
    this.offLanguage();
    this.offLanguage = () => {};
    // Glides finish their return when their page is hidden.
    this.finishDrop();
    this.releaseWatch();
    this.releaseWatch = () => {};
    this.lastSvg = "";
    this.limiter.dispose();
    this.filters.off("changed", this.onChanged);
    this.filters.client.off("statusChanged", this.onStatusChanged);
  }

  public updateSettings(settings: ObsFilterSettings): void {
    const before = this.target();
    const beforeAction = this.actionSignature();
    this.settings = normalizeObsFilterSettings(settings);
    const after = this.target();
    if (this.actionSignature() !== beforeAction) {
      // A changed target or operation cancels this control's glide or drop where it stands, visibly
      // (a new caption or accent does not).
      this.notice = this.filters.cancel(before) ? "filterGlideCancelled" : null;
      this.droppedTarget = null;
      this.lastError = null;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      this.releaseWatch();
      this.releaseWatch = this.visible ? this.filters.watch(after) : () => {};
    }
    this.render();
  }

  /** Everything that says what a press or a turn does: not the caption, not the accent. */
  private actionSignature(): string {
    const { labelOverride: _label, accent: _accent, ...rest } = this.settings;
    return JSON.stringify(rest);
  }

  /** A refused press stays on the control until what refused it is gone (as the other controls do). */
  private clearSettledError(): void {
    if (!this.lastError || !this.filters.client.isConnected()) return;
    const state = this.filters.getState(this.target());
    if (state.availability === "ok" && !state.latched) this.lastError = null;
  }

  /** A dial turn rides the setting; a turn cancels a glide or a drop on it. */
  public async rotate(ticks: number, now = Date.now()): Promise<void> {
    if (!Number.isFinite(ticks) || ticks === 0) return;
    const elapsed = this.lastRotateAt > 0 ? now - this.lastRotateAt : 999;
    this.lastRotateAt = now;
    const delta = computeDialDelta(ticks, DIAL_STEP, true, elapsed);
    this.droppedTarget = null;
    await this.run(() => this.filters.nudge(this.target(), delta, now));
  }

  /** Dial down: drop (or toggle); the drop returns on dial up. */
  public async dialDown(): Promise<void> {
    if (this.settings.dialPress === "toggle") {
      await this.run(() => this.filters.toggleEnabled(this.target()));
      return;
    }
    if (this.settings.dialPress !== "drop_return") return;
    const target = this.target();
    this.droppedTarget = target;
    await this.run(() => this.filters.dropStart(target, DROP_MS));
  }

  public async dialUp(): Promise<void> {
    this.finishDrop();
  }

  public async keyDown(): Promise<void> {
    const target = this.target();
    switch (this.settings.keyOperation) {
      case "toggle": await this.run(() => this.filters.toggleEnabled(target)); break;
      case "set": await this.run(() => this.filters.glideTo(target, this.settings.value, this.settings.durationMs)); break;
      case "step_up": await this.run(() => this.filters.step(target, this.settings.stepPct / 100)); break;
      case "step_down": await this.run(() => this.filters.step(target, -this.settings.stepPct / 100)); break;
    }
  }

  private finishDrop(): void {
    const target = this.droppedTarget;
    this.droppedTarget = null;
    if (!target) return;
    void this.filters.dropReturn(target, DROP_MS).catch(async (error: unknown) => {
      // A refused return (now driven, a read error, the filter gone) leaves the setting at rest: say so,
      // unless Panic latched it (the latch is already drawn, and Restore is the way back).
      if (this.filters.getState(target).latched) return;
      if (JSON.stringify(target) !== JSON.stringify(this.target())) return;
      this.lastError = errorLocalText(error, ownText("errorRequestFailed", { code: 500 }));
      if (!this.visible) return;
      await this.sink.showAlert();
      this.render();
    });
  }

  private async run(task: () => Promise<unknown>): Promise<void> {
    this.lastError = null;
    this.notice = null;
    if (!this.settings.sourceUuid || !this.settings.filterName) {
      await this.sink.showAlert();
      this.render();
      return;
    }
    if (!this.filters.client.isConnected()) {
      this.filters.client.nudgeReconnect();
      await this.sink.showAlert();
      this.render();
      return;
    }
    try {
      await task();
    } catch (error) {
      this.lastError = errorLocalText(error, ownText("errorRequestFailed", { code: 500 }));
      await this.sink.showAlert();
    }
    this.render();
  }

  private target(): FilterTarget {
    const s = this.settings;
    // A key that toggles has no setting; a dial or a value key has one.
    const setting = !this.dial && s.keyOperation === "toggle" ? "" : s.setting;
    return {
      sourceUuid: s.sourceUuid, filterName: s.filterName, filterKind: s.filterKind, setting,
      ...(s.rangeMin !== undefined ? { rangeMin: s.rangeMin } : {}),
      ...(s.rangeMax !== undefined ? { rangeMax: s.rangeMax } : {}),
      ...(s.integer ? { integer: true } : {})
    };
  }

  /** Why the control cannot act now, in the deck's words, or "". */
  private problem(state: FilterTargetState): string {
    // A dial or a value key bound to a filter but not to a setting.
    if (!this.settings.setting && (this.dial || this.settings.keyOperation !== "toggle")) return t("filterChooseSetting");
    // The latch is the state now; a refused press is older news.
    if (state.latched && state.availability !== "unbound") return t("filterLatched");
    if (this.lastError) return wordText(this.lastError, translate);
    // A failed read or write of this filter, OBS's own text or ours. A write fails after the turn or press returned, so
    // this is where it shows; the next successful read or write clears it (filter-controller.ts).
    // A filter gone from OBS keeps the deck's own localized word below, not OBS's English text.
    if (state.error && state.availability !== "missing") return wordText(state.error, translate);
    switch (state.availability) {
      case "missing": return t("filterMissing");
      case "wrong_kind": return t("filterWrongKind");
      case "error": return state.error ? wordText(state.error, translate) : t("filterMissing");
      case "denied": return t("filterDenied");
      case "needs_range": return t("filterNeedsRange");
      case "no_value": return t("filterNoValue");
      case "out_of_range": return t("filterOutOfRange");
      case "owned": return state.owner?.kind === "fader" ? t("filterOwnedFader")
        : t("filterOwnedModulator", { filter: state.owner?.filterName ?? "" });
      default: return "";
    }
  }

  private render(): void {
    if (!this.visible) return;
    const s = this.settings;
    const target = this.target();
    const state = this.filters.getState(target);
    const connected = this.filters.client.isConnected();
    const reason = statusCellReason(this.filters.client.getStatus(), translate);
    const configured = state.availability !== "unbound";
    const caption = customCaption("filter", { ...s, control: this.dial ? "dial" : "key" });
    const problem = configured && connected ? this.problem(state) : "";
    const notice = this.notice ? t(this.notice) : "";
    const svg = this.dial ? this.renderDial(state, caption, connected, reason, configured, problem, notice)
      : this.renderKey(state, caption, connected, reason, configured, problem, notice);
    if (svg === this.lastSvg) return;
    this.lastSvg = svg;
    this.limiter.push(svg);
  }

  private renderDial(state: FilterTargetState, caption: string, connected: boolean, reason: string, configured: boolean,
    problem: string, notice: string): string {
    const s = this.settings;
    const name = s.setting ? filterSettingName(s.filterKind, s.setting) : t("filterSettingNone");
    const value = state.value !== null && state.range ? state.value : null;
    const pressHints: Record<NormalizedObsFilterSettings["dialPress"], StringKey> = {
      drop_return: "filterPressDrop", toggle: "filterPressToggle", none: "pressDisabled"
    };
    return renderFilterDialSvg({
      connected, reason, configured,
      title: caption || name,
      filterName: s.filterName,
      value: value !== null && state.range ? formatFilterValue(value, state.range) : "—",
      position: value !== null && state.range ? rangePosition(value, state.range) : 0,
      enabled: state.enabled,
      hint: notice || t(pressHints[s.dialPress]),
      ...(problem ? { problem } : {}),
      accent: s.accent
    });
  }

  private renderKey(state: FilterTargetState, caption: string, connected: boolean, reason: string, configured: boolean,
    problem: string, notice: string): string {
    const s = this.settings;
    const name = s.setting ? filterSettingName(s.filterKind, s.setting) : "";
    let icon: DirectKeyIcon;
    let title: string;
    let subtitle: string;
    if (s.keyOperation === "toggle") {
      icon = state.enabled ? "look-on" : "look-off";
      title = caption || s.filterName || t("filterOpLook");
      subtitle = state.enabled === null ? t("filterReading") : t(state.enabled ? "filterOn" : "filterOff");
    } else if (s.keyOperation === "set") {
      // The range is known from the settings alone, so the key does not change once OBS answers.
      const resolved = resolveRange(s.filterKind, s.setting, s);
      const range = resolved.ok ? resolved.range : null;
      const atRest = range ? s.value === restValue(range) || s.value <= range.min : s.value <= 0;
      const atTop = range ? s.value >= range.max : false;
      icon = atRest ? "still" : atTop ? "full-react" : "wave";
      title = caption || name || t("filterOpSet");
      subtitle = t("filterSetTo", { value: range ? formatFilterValue(s.value, range) : formatNumber(s.value),
        s: formatNumber(s.durationMs / 1000) });
    } else {
      icon = s.keyOperation === "step_up" ? "wave-up" : "wave-down";
      title = caption || t(s.keyOperation === "step_up" ? "filterOpStepUp" : "filterOpStepDown", { setting: name || t("filterSettingNone") });
      subtitle = state.value !== null && state.range ? formatFilterValue(state.value, state.range) : t("filterReading");
    }
    return renderDirectKeySvg({
      connected, reason, configured, icon, title,
      ...(configured ? {} : { unboundSubtitle: t("filterChoose") }),
      subtitle: notice || subtitle,
      ...(problem ? { problem } : {}),
      accent: s.accent,
      ...(s.keyOperation === "toggle" && state.enabled !== null && !problem && connected
        ? { badge: { text: t(state.enabled ? "filterOn" : "filterOff"), on: state.enabled } } : {})
    });
  }
}

@action({ UUID: "io.github.jbrick2070.fadester-for-obs.obs-filter" })
export class ObsFilterControlAction extends SingletonAction<ObsFilterSettings> {
  private readonly instances = new Map<string, ObsFilterInstanceController>();

  public constructor(private readonly filters: FilterController) {
    super();
  }

  public override onWillAppear(ev: WillAppearEvent<ObsFilterSettings>): void {
    const control = ev.action;
    const dial = control.isDial();
    if (!dial && !control.isKey()) return;
    this.instances.get(control.id)?.disappear();
    const controller = new ObsFilterInstanceController(this.filters, {
      render: (svg) => control.isDial() ? control.setFeedback({ canvas: toStripUri(svg) })
        : control.isKey() ? control.setImage(toSvgDataUri(svg)) : Promise.resolve(),
      showAlert: () => control.showAlert()
    }, dial, ev.payload.settings);
    this.instances.set(control.id, controller);
    controller.appear(ev.payload.settings);
  }

  public override onWillDisappear(ev: WillDisappearEvent<ObsFilterSettings>): void {
    this.instances.get(ev.action.id)?.disappear();
    this.instances.delete(ev.action.id);
  }

  public override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ObsFilterSettings>): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }

  public override async onDialRotate(ev: DialRotateEvent<ObsFilterSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.rotate(ev.payload.ticks);
  }

  public override async onDialDown(ev: DialDownEvent<ObsFilterSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.dialDown();
  }

  public override async onDialUp(ev: DialUpEvent<ObsFilterSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.dialUp();
  }

  // No onTouchTap: a tap on the strip never moves a filter (no jumps, R-RIG-1).

  public override async onKeyDown(ev: KeyDownEvent<ObsFilterSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.keyDown();
  }
}
