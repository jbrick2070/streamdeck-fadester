// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Visual Sidechain Meter (P1-3):
 * - Key (120x120), Dial / Stream Deck + touch strip (200x100 with 32-band spectrum),
 *   and Stream Deck Neo Info Bar (232x50).
 * - Shows BPM with lock mark, locally stepped beat counter (beat_index 0..3),
 *   four smoothed band bars (sub_bass, bass, mid, high — never raw kick), and
 *   plain states NO AUDIO, PANIC, NOT LOADED.
 * - Key and dial press actions: tap_tempo, lock_bpm, resync_downbeat, or display_only.
 * - Per-action rate choice 2, 5 or 10 redraws/s (default 5), strictly inside the
 *   10 redraws/s per-cell cap; periodic tick pauses whenever inactive.
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
import { SampledVisualSignals, VisualSignals } from "../control/visual-signals.js";
import { customCaption } from "../obs/preset-captions.js";
import {
  DEFAULT_VISUAL_METER_SETTINGS,
  VisualMeterRefreshRate,
  VisualMeterSettings,
  normalizeAccent,
  normalizeLabelOverride,
  normalizeVisualMeterDialRotate,
  normalizeVisualMeterOperation,
  normalizeVisualMeterRefreshRate
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import {
  renderVisualMeterDialSvg,
  renderVisualMeterKeySvg,
  renderVisualMeterNeoSvg,
  toStripUri,
  toSvgDataUri
} from "../gfx/direct-obs-renderer.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { LocalText, errorLocalText, ownText, wordText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { onLanguageChanged, t, translate } from "../i18n/strings.js";

export type VisualMeterForm = "key" | "dial" | "infobar";

export interface VisualMeterSink {
  render(svg: string): Promise<void>;
  showAlert(): Promise<void>;
}

/** Converts a redraw rate choice (2, 5, 10) into its millisecond interval, capped at >= 100 ms (<= 10 Hz). */
export function refreshRateIntervalMs(rate: VisualMeterRefreshRate): number {
  return Math.max(100, Math.round(1000 / rate));
}

export class VisualMeterInstanceController {
  private settings: Required<VisualMeterSettings>;
  private visible = false;
  private offLanguage: () => void = () => {};
  private rateLimiter: CellRateLimiter<string>;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastError: LocalText | null = null;
  private lastSvg = "";

  private readonly onSignalsStateChanged = (): void => {
    this.lastError = null;
    this.syncTickTimer();
    this.renderNow();
  };

  private readonly onSignalsUpdated = (): void => {
    this.syncTickTimer();
    this.renderNow();
  };

  private readonly onTempoChanged = (): void => {
    this.renderNow();
  };

  private readonly onClientStatusChanged = (): void => {
    this.lastError = null;
    this.syncTickTimer();
    this.renderNow();
  };

  public constructor(
    private readonly signals: VisualSignals,
    private readonly client: DirectObsClient,
    private readonly sink: VisualMeterSink,
    private readonly form: VisualMeterForm,
    initialSettings?: VisualMeterSettings,
    private readonly clock: () => number = Date.now
  ) {
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = this.createLimiter(this.settings.refreshRate);
  }

  public appear(settings?: VisualMeterSettings): void {
    if (this.visible) this.disappear();
    if (settings) {
      const next = this.mergeSettings(settings);
      if (next.refreshRate !== this.settings.refreshRate) {
        this.rateLimiter.dispose();
        this.rateLimiter = this.createLimiter(next.refreshRate);
      }
      this.settings = next;
    }
    this.visible = true;
    this.offLanguage();
    this.offLanguage = onLanguageChanged(() => {
      this.lastSvg = "";
      this.renderNow();
    });
    this.signals.on("stateChanged", this.onSignalsStateChanged);
    this.signals.on("updated", this.onSignalsUpdated);
    this.signals.on("tempoChanged", this.onTempoChanged);
    this.client.on("statusChanged", this.onClientStatusChanged);
    this.syncTickTimer();
    this.renderNow();
  }

  public disappear(): void {
    this.visible = false;
    this.offLanguage();
    this.offLanguage = () => {};
    this.stopTickTimer();
    this.lastSvg = "";
    this.rateLimiter.dispose();
    this.signals.off("stateChanged", this.onSignalsStateChanged);
    this.signals.off("updated", this.onSignalsUpdated);
    this.signals.off("tempoChanged", this.onTempoChanged);
    this.client.off("statusChanged", this.onClientStatusChanged);
  }

  public updateSettings(settings: VisualMeterSettings): void {
    const next = this.mergeSettings(settings);
    const rateChanged = next.refreshRate !== this.settings.refreshRate;
    const opChanged = next.operation !== this.settings.operation;
    this.settings = next;
    if (opChanged) this.lastError = null;
    if (rateChanged) {
      this.rateLimiter.dispose();
      this.rateLimiter = this.createLimiter(next.refreshRate);
      this.stopTickTimer();
      this.syncTickTimer();
    }
    this.lastSvg = "";
    this.renderNow();
  }

  public async press(now = this.clock()): Promise<void> {
    if (this.form === "infobar" || this.settings.operation === "display_only") return;
    this.lastError = null;
    if (!this.client.isConnected()) {
      this.client.nudgeReconnect(2000, now);
      this.renderNow();
      await this.sink.showAlert();
      return;
    }
    try {
      if (this.settings.operation === "tap_tempo") {
        await this.signals.tapTempo();
      } else if (this.settings.operation === "lock_bpm") {
        await this.signals.toggleLockBpm();
      } else if (this.settings.operation === "resync_downbeat") {
        await this.signals.resyncDownbeat();
      }
    } catch (error) {
      this.lastError = errorLocalText(error, ownText("errorRequestFailed", { code: 500 }));
      this.renderNow();
      await this.sink.showAlert();
      return;
    }
    this.syncTickTimer();
    this.renderNow();
  }

  public async rotate(ticks: number, now = this.clock()): Promise<void> {
    if (this.form !== "dial" || this.settings.dialRotate !== "adjust_bpm" || !Number.isFinite(ticks) || ticks === 0) {
      return;
    }
    this.lastError = null;
    if (!this.client.isConnected()) {
      this.client.nudgeReconnect(2000, now);
      this.renderNow();
      await this.sink.showAlert();
      return;
    }
    const targetBpm = Math.max(60, Math.min(200, Math.round(this.signals.getSnapshot().bpm + ticks)));
    try {
      await this.signals.setBpm(targetBpm);
    } catch (error) {
      this.lastError = errorLocalText(error, ownText("errorRequestFailed", { code: 500 }));
      this.renderNow();
      await this.sink.showAlert();
      return;
    }
    this.renderNow();
  }

  public renderNow(now = this.clock()): void {
    if (!this.visible) return;
    const sampled = this.signals.sample(now);
    const svg = this.buildSvg(sampled);
    if (svg === this.lastSvg) return;
    this.lastSvg = svg;
    this.rateLimiter.push(svg, now);
  }

  private buildSvg(sampled: SampledVisualSignals): string {
    const caption = customCaption("meter", this.settings);
    const title = caption || this.defaultTitle();
    const subtitle = this.subtitleFor(sampled);
    const input = {
      state: sampled.state,
      reason: statusCellReason(this.client.getStatus(), translate),
      title,
      subtitle,
      bpm: sampled.bpm,
      bpmLocked: sampled.bpmLocked,
      beatIndex: sampled.beatIndex,
      subBass: sampled.subBass,
      bass: sampled.bass,
      mid: sampled.mid,
      high: sampled.high,
      spectrum: sampled.spectrum,
      accent: this.settings.accent,
      ...(this.lastError ? { problem: wordText(this.lastError, translate) } : {})
    };
    if (this.form === "dial") return renderVisualMeterDialSvg(input);
    if (this.form === "infobar") return renderVisualMeterNeoSvg(input);
    return renderVisualMeterKeySvg(input);
  }

  private defaultTitle(): string {
    if (this.form !== "key") return t("vmTitle");
    switch (this.settings.operation) {
      case "tap_tempo":
        return t("vmOpTap");
      case "lock_bpm":
        return t("vmOpLock");
      case "resync_downbeat":
        return t("vmOpResync");
      default:
        return t("vmTitle");
    }
  }

  private subtitleFor(sampled: SampledVisualSignals): string {
    if (this.form === "dial") {
      if (this.settings.operation === "display_only") {
        return t("vmBeatCount", { beat: sampled.beatIndex + 1 });
      }
      const opWord = this.settings.operation === "tap_tempo"
        ? t("vmOpTap")
        : this.settings.operation === "lock_bpm"
          ? t("vmOpLock")
          : t("vmOpResync");
      return this.settings.dialRotate === "adjust_bpm"
        ? t("vmDialHint", { op: opWord })
        : t("vmDialHintNoTurn", { op: opWord });
    }
    switch (this.settings.operation) {
      case "tap_tempo":
        return sampled.bpmLocked ? t("vmLocked") : t("vmBeatCount", { beat: sampled.beatIndex + 1 });
      case "lock_bpm":
        return sampled.bpmLocked ? t("vmLocked") : t("vmUnlocked");
      case "resync_downbeat":
        return t("vmHintResync");
      default:
        return t("vmBeatCount", { beat: sampled.beatIndex + 1 });
    }
  }

  private syncTickTimer(): void {
    if (!this.visible) {
      this.stopTickTimer();
      return;
    }
    const sampled = this.signals.sample(this.clock());
    if (sampled.state !== "active") {
      this.stopTickTimer();
      return;
    }
    if (this.tickTimer !== null) return;
    const intervalMs = refreshRateIntervalMs(this.settings.refreshRate);
    this.tickTimer = setInterval(() => {
      if (!this.visible) {
        this.stopTickTimer();
        return;
      }
      const current = this.signals.sample(this.clock());
      if (current.state !== "active") {
        this.stopTickTimer();
      }
      this.renderNow();
    }, intervalMs);
  }

  private stopTickTimer(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private createLimiter(rate: VisualMeterRefreshRate): CellRateLimiter<string> {
    return new CellRateLimiter<string>((svg) => this.sink.render(svg), refreshRateIntervalMs(rate), this.clock);
  }

  private mergeSettings(raw?: VisualMeterSettings): Required<VisualMeterSettings> {
    return {
      operation: normalizeVisualMeterOperation(raw?.operation ?? DEFAULT_VISUAL_METER_SETTINGS.operation),
      refreshRate: normalizeVisualMeterRefreshRate(raw?.refreshRate ?? DEFAULT_VISUAL_METER_SETTINGS.refreshRate),
      dialRotate: normalizeVisualMeterDialRotate(raw?.dialRotate ?? DEFAULT_VISUAL_METER_SETTINGS.dialRotate),
      labelOverride: normalizeLabelOverride(raw?.labelOverride),
      accent: normalizeAccent(raw?.accent)
    };
  }
}

@action({ UUID: "io.github.jbrick2070.fadester-for-obs.visual-meter" })
export class VisualMeterAction extends SingletonAction<VisualMeterSettings> {
  private readonly instances = new Map<string, VisualMeterInstanceController>();

  public constructor(private readonly signals: VisualSignals, private readonly client: DirectObsClient) {
    super();
  }

  public override async onWillAppear(ev: WillAppearEvent<VisualMeterSettings>): Promise<void> {
    const control = ev.action;
    const form: VisualMeterForm | null = control.isDial()
      ? "dial"
      : control.isNeoInfobar()
        ? "infobar"
        : control.isKey()
          ? "key"
          : null;
    if (!form) return;

    this.instances.get(control.id)?.disappear();
    const controller = new VisualMeterInstanceController(
      this.signals,
      this.client,
      {
        render: (svg) => {
          if (control.isDial()) return control.setFeedback({ canvas: toStripUri(svg) });
          if (control.isNeoInfobar()) return control.setFeedback({ canvas: toStripUri(svg) });
          if (control.isKey()) return control.setImage(toSvgDataUri(svg));
          return Promise.resolve();
        },
        showAlert: () => (control.isKey() || control.isDial() ? control.showAlert() : Promise.resolve())
      },
      form,
      ev.payload.settings
    );
    this.instances.set(control.id, controller);
    if (control.isNeoInfobar()) {
      await control.setFeedbackLayout("layouts/visual-meter-neo.json");
      if (this.instances.get(control.id) !== controller) return;
    }
    controller.appear(ev.payload.settings);
  }

  public override onWillDisappear(ev: WillDisappearEvent<VisualMeterSettings>): void {
    this.instances.get(ev.action.id)?.disappear();
    this.instances.delete(ev.action.id);
  }

  public override onDidReceiveSettings(ev: DidReceiveSettingsEvent<VisualMeterSettings>): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }

  public override async onKeyDown(ev: KeyDownEvent<VisualMeterSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.press();
  }

  public override async onDialDown(ev: DialDownEvent<VisualMeterSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.press();
  }

  public override async onDialRotate(ev: DialRotateEvent<VisualMeterSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.rotate(ev.payload.ticks);
  }
}
