// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Tape Deck action (P1-6):
 * - Key (120x120) and Dial / Stream Deck + touch strip (200x100).
 * - Dial rotation rides speed along Visual Sidechain's 11-rung ladder (25%..800%).
 * - Key and dial press execute one configurable operation: Play / pause,
 *   Cue to start, Normal speed, Speed up, or Speed down.
 * - Face shows speed in both forms ("150% (1.5x)"), playing or paused state,
 *   and plain states NOT LOADED (Visual Sidechain absent) and NO DECK (none found).
 * - Event-driven via `decks_changed` (no polling loops) and rate-limited to at
 *   most 10 redraws per second per cell (100 ms CellRateLimiter).
 */
import {
  action,
  DialDownEvent,
  DialRotateEvent,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import { DirectObsClient } from "../obs/direct-obs-client.js";
import { SampledTapeDeck, TapeDecks } from "../control/tape-decks.js";
import { customCaption } from "../obs/preset-captions.js";
import {
  DEFAULT_TAPE_DECK_SETTINGS,
  TapeDeckOperation,
  TapeDeckSettings,
  normalizeAccent,
  normalizeLabelOverride,
  normalizeTapeDeckOperation
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import {
  renderTapeDeckDialSvg,
  renderTapeDeckKeySvg,
  toStripUri,
  toSvgDataUri
} from "../gfx/direct-obs-renderer.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import {
  LocalText,
  errorLocalText,
  ownText,
  wordText
} from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { onLanguageChanged, t, translate } from "../i18n/strings.js";

export type TapeDeckForm = "key" | "dial";

export interface TapeDeckSink {
  render(svg: string): Promise<void>;
  showAlert(): Promise<void>;
}

/** 100 ms minimum interval strictly caps redraws at <= 10 per second per cell (SD/REQUIREMENTS.md). */
export const TAPE_DECK_CELL_MIN_INTERVAL_MS = 100;

export class TapeDeckInstanceController {
  private settings: Required<TapeDeckSettings>;
  private visible = false;
  private offLanguage: () => void = () => {};
  private rateLimiter: CellRateLimiter<string>;
  private lastError: LocalText | null = null;
  private lastSvg = "";

  private readonly onDecksChanged = (): void => {
    this.renderNow();
  };

  private readonly onClientStatusChanged = (): void => {
    this.lastError = null;
    this.renderNow();
  };

  public constructor(
    private readonly decks: TapeDecks,
    private readonly client: DirectObsClient,
    private readonly sink: TapeDeckSink,
    private readonly form: TapeDeckForm,
    initialSettings?: TapeDeckSettings,
    private readonly clock: () => number = Date.now,
    minIntervalMs = TAPE_DECK_CELL_MIN_INTERVAL_MS
  ) {
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = this.createLimiter(Math.max(TAPE_DECK_CELL_MIN_INTERVAL_MS, minIntervalMs));
  }

  public appear(settings?: TapeDeckSettings): void {
    if (this.visible) this.disappear();
    if (settings) {
      this.settings = this.mergeSettings(settings);
    }
    this.visible = true;
    this.offLanguage();
    this.offLanguage = onLanguageChanged(() => {
      this.lastSvg = "";
      this.renderNow();
    });
    this.decks.on("changed", this.onDecksChanged);
    this.client.on("statusChanged", this.onClientStatusChanged);
    this.renderNow();
  }

  public disappear(): void {
    this.visible = false;
    this.offLanguage();
    this.offLanguage = () => {};
    this.lastSvg = "";
    this.rateLimiter.dispose();
    this.decks.off("changed", this.onDecksChanged);
    this.client.off("statusChanged", this.onClientStatusChanged);
  }

  public updateSettings(settings: TapeDeckSettings): void {
    const next = this.mergeSettings(settings);
    if (next.deck !== this.settings.deck || next.operation !== this.settings.operation) {
      this.lastError = null;
    }
    this.settings = next;
    this.lastSvg = "";
    this.renderNow();
  }

  public async press(now = this.clock()): Promise<void> {
    this.lastError = null;
    if (!this.client.isConnected()) {
      this.client.nudgeReconnect(2000, now);
      this.renderNow(now);
      await this.sink.showAlert();
      return;
    }
    try {
      await this.decks.executeOperation(this.settings.deck, this.settings.operation);
    } catch (error) {
      this.lastError = errorLocalText(error, ownText("errorRequestFailed", { code: 500 }));
      this.renderNow(now);
      await this.sink.showAlert();
      return;
    }
    this.renderNow(now);
  }

  public async rotate(ticks: number, now = this.clock()): Promise<void> {
    if (this.form !== "dial" || !Number.isFinite(ticks) || Math.trunc(ticks) === 0) {
      return;
    }
    this.lastError = null;
    if (!this.client.isConnected()) {
      this.client.nudgeReconnect(2000, now);
      this.renderNow(now);
      await this.sink.showAlert();
      return;
    }
    try {
      await this.decks.stepSpeed(this.settings.deck, Math.trunc(ticks));
    } catch (error) {
      this.lastError = errorLocalText(error, ownText("errorRequestFailed", { code: 500 }));
      this.renderNow(now);
      await this.sink.showAlert();
      return;
    }
    this.renderNow(now);
  }

  public renderNow(now = this.clock()): void {
    if (!this.visible) return;
    const sampled = this.decks.sample(this.settings.deck);
    const svg = this.buildSvg(sampled);
    if (svg === this.lastSvg) return;
    this.lastSvg = svg;
    this.rateLimiter.push(svg, now);
  }

  private buildSvg(sampled: SampledTapeDeck): string {
    const caption = customCaption("tapeDeck", this.settings);
    const title = caption || this.defaultTitle(sampled);
    const subtitle = this.subtitleFor(sampled);
    const problemText = this.lastError
      ? wordText(this.lastError, translate)
      : sampled.deckCommandUnsupported
        ? t("tdNeedsUpdate")
        : "";
    const input = {
      state: sampled.state,
      reason: statusCellReason(this.client.getStatus(), translate),
      title,
      subtitle,
      speedPercent: sampled.speedPercent,
      speedLabel: sampled.speedLabel,
      transport: sampled.transport,
      accent: this.settings.accent,
      ...(problemText ? { problem: problemText } : {})
    };
    return this.form === "dial" ? renderTapeDeckDialSvg(input) : renderTapeDeckKeySvg(input);
  }

  private defaultTitle(sampled: SampledTapeDeck): string {
    if (this.form === "dial") {
      return sampled.deck?.source || this.settings.deck || t("tdTitle");
    }
    return this.operationLabel(this.settings.operation);
  }

  private operationLabel(op: TapeDeckOperation): string {
    switch (op) {
      case "play_pause":
        return t("tdOpPlayPause");
      case "cue_to_start":
        return t("tdOpCue");
      case "normal_speed":
        return t("tdOpNormal");
      case "speed_up":
        return t("tdOpSpeedUp");
      case "speed_down":
        return t("tdOpSpeedDown");
    }
  }

  private subtitleFor(sampled: SampledTapeDeck): string {
    if (sampled.state === "disconnected") {
      return statusCellReason(this.client.getStatus(), translate);
    }
    if (sampled.state === "not_loaded") {
      return t("vpNotLoaded");
    }
    if (sampled.state === "no_deck") {
      return this.settings.deck || t("tdChooseDeck");
    }
    if (this.form === "dial") {
      return t("tdDialHint", { op: this.operationLabel(this.settings.operation) });
    }
    return sampled.deck?.source || t("tdTitle");
  }

  private createLimiter(intervalMs: number): CellRateLimiter<string> {
    return new CellRateLimiter<string>(
      async (svg) => {
        if (!this.visible) return;
        await this.sink.render(svg);
      },
      intervalMs,
      this.clock
    );
  }

  private mergeSettings(raw?: TapeDeckSettings): Required<TapeDeckSettings> {
    const d = DEFAULT_TAPE_DECK_SETTINGS;
    return {
      deck: typeof raw?.deck === "string" ? raw.deck.trim() : d.deck,
      operation: normalizeTapeDeckOperation(raw?.operation),
      labelOverride: normalizeLabelOverride(raw?.labelOverride),
      accent: normalizeAccent(raw?.accent)
    };
  }
}

@action({ UUID: "io.github.jbrick2070.fadester-for-obs.tape-deck" })
export class TapeDeckAction extends SingletonAction<TapeDeckSettings> {
  private readonly instances = new Map<string, TapeDeckInstanceController>();

  public constructor(
    private readonly decks: TapeDecks,
    private readonly client: DirectObsClient
  ) {
    super();
  }

  public override onWillAppear(ev: WillAppearEvent<TapeDeckSettings>): void {
    const control = ev.action;
    const form: TapeDeckForm | null = control.isDial() ? "dial" : control.isKey() ? "key" : null;
    if (!form) return;

    const existing = this.instances.get(control.id);
    if (existing) {
      existing.disappear();
      this.instances.delete(control.id);
    }
    const sink: TapeDeckSink = {
      render: (svg: string) => {
        if (control.isDial()) return control.setFeedback({ canvas: toStripUri(svg) });
        if (control.isKey()) return control.setImage(toSvgDataUri(svg));
        return Promise.resolve();
      },
      showAlert: () => (control.isKey() || control.isDial() ? control.showAlert() : Promise.resolve())
    };
    const ctrl = new TapeDeckInstanceController(
      this.decks,
      this.client,
      sink,
      form,
      ev.payload.settings
    );
    this.instances.set(control.id, ctrl);
    ctrl.appear();
  }

  public override onWillDisappear(ev: WillDisappearEvent<TapeDeckSettings>): void {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      ctrl.disappear();
      this.instances.delete(ev.action.id);
    }
  }

  public override onDidReceiveSettings(ev: DidReceiveSettingsEvent<TapeDeckSettings>): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }

  public override async onKeyDown(ev: KeyDownEvent<TapeDeckSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.press();
  }

  public override async onDialDown(ev: DialDownEvent<TapeDeckSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.press();
  }

  public override async onDialRotate(ev: DialRotateEvent<TapeDeckSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.rotate(ev.payload.ticks);
  }
}
