// SPDX-License-Identifier: GPL-2.0-or-later
import {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  KeyUpEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import { mixProblem } from "../obs/whole-mix.js";
import { DirectObsClient } from "../obs/direct-obs-client.js";
import { VisualSignals } from "../control/visual-signals.js";
import { QuantizedKeyArm } from "../control/quantized-fade.js";
import { automaticInputRoleName, migrateAutomaticInputSettings } from "../obs/automatic-targets.js";
import { customCaption } from "../obs/preset-captions.js";
import {
  DEFAULT_OBS_FADE_KEY_SETTINGS,
  ObsFadeKeySettings,
  normalizeAccent,
  normalizeDurationMs,
  normalizeLabelOverride,
  normalizeQuantizeBeats,
  normalizeQuantizeStart
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import {
  renderDirectKeySvg,
  toSvgDataUri
} from "../gfx/direct-obs-renderer.js";
import { DIAL_HOLD_THRESHOLD_MS } from "./dial-math.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { formatNumber, onLanguageChanged, t, translate } from "../i18n/strings.js";

interface KeyImageSink {
  setImage(image: string): Promise<void>;
  showAlert(): Promise<void>;
}

export class ObsFadeKeyInstanceController {
  private settings: Required<ObsFadeKeySettings>;
  private visible = false;
  /** Unsubscribes this control from language changes (PLAN.md 11.1). */
  private offMix?: () => void;
  private offLanguage: () => void = () => {};
  private readonly rateLimiter: CellRateLimiter<string>;
  private readonly arm: QuantizedKeyArm;
  private readonly onStateChanged = (): void => {
    if (!this.client.isConnected()) {
      this.arm.cancelSilently();
    }
    this.renderNow();
  };

  public constructor(
    private readonly client: DirectObsClient,
    private readonly sink: KeyImageSink,
    initialSettings?: ObsFadeKeySettings,
    rateLimitMs = 100,
    signals?: VisualSignals,
    holdMs: number = DIAL_HOLD_THRESHOLD_MS,
    private readonly clock: () => number = Date.now
  ) {
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = new CellRateLimiter<string>(async (svg) => {
      await this.sink.setImage(toSvgDataUri(svg));
    }, rateLimitMs, clock);
    this.arm = new QuantizedKeyArm(signals, () => this.renderNow(), holdMs, clock);
  }

  public appear(settings?: ObsFadeKeySettings): void {
    if (settings) {
      this.settings = this.mergeSettings(settings);
    }
    this.visible = true;
    this.offLanguage();
    this.offLanguage = onLanguageChanged(() => this.renderNow());
    this.client.on("statusChanged", this.onStateChanged);
    this.client.on("directStateChanged", this.onStateChanged);
    this.client.on("wholeMixChanged", this.onStateChanged);
    this.syncMixObserver();
    this.renderNow();
  }

  public disappear(): void {
    this.visible = false;
    this.offLanguage();
    this.offLanguage = () => {};
    this.arm.dispose();
    this.rateLimiter.dispose();
    this.client.off("statusChanged", this.onStateChanged);
    this.client.off("directStateChanged", this.onStateChanged);
    this.client.off("wholeMixChanged", this.onStateChanged);
    this.syncMixObserver();
  }

  public updateSettings(settings: ObsFadeKeySettings): void {
    const prev = this.settings;
    this.settings = this.mergeSettings(settings);
    if (
      prev.target !== this.settings.target ||
      prev.inputName !== this.settings.inputName ||
      prev.to !== this.settings.to ||
      prev.quantizeBeats !== this.settings.quantizeBeats ||
      prev.quantizeStart !== this.settings.quantizeStart
    ) {
      this.arm.cancelSilently();
    }
    this.syncMixObserver();
    this.renderNow();
  }

  public async handleKeyDown(now = this.clock()): Promise<void> {
    const all = this.settings.target === "all_inputs";
    if (!this.arm.isArmed()) {
      if (!all && !this.settings.inputName) {
        await this.sink.showAlert();
        return;
      }
      if (!this.client.isConnected()) {
        this.client.nudgeReconnect(2000, now);
        await this.sink.showAlert();
        return;
      }
    }

    const beats = all ? 0 : this.settings.quantizeBeats;
    await this.arm.handleKeyDown(
      beats,
      this.settings.quantizeStart,
      this.settings.durationMs,
      async (effectiveMs) => {
        if (!this.client.isConnected()) return;
        if (all) {
          try { await this.client.wholeMix.command(this.settings.to ? "mix.restore" : "mix.fadeOut"); }
          catch { await this.sink.showAlert(); }
          return;
        }
        void this.client
          .fadeInputVolume(
            this.settings.inputName,
            this.settings.to,
            effectiveMs ?? this.settings.durationMs
          )
          .catch(async () => this.sink.showAlert());
      },
      now
    );
  }

  public async handleKeyUp(): Promise<void> {
    await this.arm.handleKeyUp();
  }

  private syncMixObserver(): void {
    if (this.visible && this.settings.target === "all_inputs") {
      this.offMix ??= this.client.wholeMix.observe();
    } else {
      this.offMix?.();
      this.offMix = undefined;
    }
  }

  private renderNow(): void {
    if (!this.visible) {
      return;
    }
    const all = this.settings.target === "all_inputs";
    const configured = all || Boolean(this.settings.inputName);
    const inputName = all ? "" : this.client.resolveInputName(this.settings.inputName);
    const role = automaticInputRoleName(this.settings.inputName);
    const customLabel = customCaption("fade", this.settings);
    const title = customLabel || (all ? t("mixAll") : inputName || role || this.settings.inputName || t("fadeTitle"));
    const up = this.settings.to === 1;
    const subtitle = all ? t(up ? "mixRestore" : "mixFadeOut") : !configured
      ? t("keyOpenInspector")
      : this.settings.quantizeBeats > 0
        ? t(up ? "fadeUpBeats" : "fadeDownBeats", { n: this.settings.quantizeBeats })
        : this.settings.durationMs === 0
          ? t(up ? "fadeUpNow" : "fadeDownNow")
          : t(up ? "fadeUpSeconds" : "fadeDownSeconds", { s: formatNumber(this.settings.durationMs / 1000, 3) });
    const bannerKind = this.arm.getBanner();
    const badge =
      bannerKind === "armed"
        ? { text: t("quantizeArmed"), on: true }
        : bannerKind === "no_tempo"
          ? { text: t("quantizeNoTempo"), on: false }
          : bannerKind === "cancelled"
            ? { text: t("quantizeCancelled"), on: false }
            : undefined;
    this.rateLimiter.push(
      renderDirectKeySvg({
        connected: this.client.isConnected(),
        reason: statusCellReason(this.client.getStatus(), translate),
        title,
        subtitle,
        icon: this.settings.to === 1 ? "volume-up" : "volume-down",
        configured,
        accent: this.settings.accent,
        badge,
        problem: all ? mixProblem(this.client.wholeMix.state) : !inputName && configured
          ? role ? t("roleUnavailable", { role }) : t("audioInputUnavailable") : undefined
      }),
      this.clock()
    );
  }

  private mergeSettings(raw?: ObsFadeKeySettings): Required<ObsFadeKeySettings> {
    return {
      target: raw?.target === "all_inputs" ? "all_inputs" : "input_volume",
      inputName: typeof raw?.inputName === "string" ? raw.inputName.trim()
        : raw?.inputName === undefined ? DEFAULT_OBS_FADE_KEY_SETTINGS.inputName : "",
      to: Number(raw?.to) === 0 ? 0 : 1,
      durationMs: normalizeDurationMs(
        raw?.durationMs,
        DEFAULT_OBS_FADE_KEY_SETTINGS.durationMs
      ),
      quantizeBeats: normalizeQuantizeBeats(raw?.quantizeBeats),
      quantizeStart: normalizeQuantizeStart(raw?.quantizeStart),
      labelOverride: normalizeLabelOverride(raw?.labelOverride),
      accent: normalizeAccent(raw?.accent)
    };
  }
}

@action({ UUID: "io.github.jbrick2070.fadester-for-obs.obs-fade" })
export class ObsFadeKeyAction extends SingletonAction<ObsFadeKeySettings> {
  private readonly instances = new Map<string, ObsFadeKeyInstanceController>();

  public constructor(
    private readonly client: DirectObsClient,
    private readonly signals?: VisualSignals
  ) {
    super();
  }

  public override onWillAppear(ev: WillAppearEvent<ObsFadeKeySettings>): void {
    if (!ev.action.isKey()) {
      return;
    }
    const key = ev.action;
    const settings = migrateAutomaticInputSettings(ev.payload.settings);
    if (settings !== ev.payload.settings) void key.setSettings(settings);
    // Stream Deck can send willAppear twice for one context: the first controller stops first.
    this.instances.get(key.id)?.disappear();
    const controller = new ObsFadeKeyInstanceController(
      this.client,
      {
        setImage: (image) => key.setImage(image),
        showAlert: () => key.showAlert()
      },
      settings,
      100,
      this.signals
    );
    this.instances.set(key.id, controller);
    controller.appear(settings);
  }

  public override onWillDisappear(ev: WillDisappearEvent<ObsFadeKeySettings>): void {
    const controller = this.instances.get(ev.action.id);
    if (controller) {
      controller.disappear();
      this.instances.delete(ev.action.id);
    }
  }

  public override onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<ObsFadeKeySettings>
  ): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }

  public override async onKeyDown(ev: KeyDownEvent<ObsFadeKeySettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.handleKeyDown();
  }

  public override async onKeyUp(ev: KeyUpEvent<ObsFadeKeySettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.handleKeyUp();
  }
}
