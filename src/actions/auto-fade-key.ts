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
import { FadesterStore } from "../state/fadester-store.js";
import { VisualSignals } from "../control/visual-signals.js";
import { QuantizedKeyArm } from "../control/quantized-fade.js";
import {
  ALL_FX_SLOT_ID,
  AutoFadeKeySettings,
  DEFAULT_AUTO_FADE_KEY_SETTINGS,
  normalizeLabelOverride,
  normalizeQuantizeBeats,
  normalizeQuantizeStart,
  normalizeReadoutStyle
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { renderAutoFadeKeySvg, toSvgDataUri } from "../gfx/svg-renderer.js";
import { onLanguageChanged, t, translate } from "../i18n/strings.js";
import { DIAL_HOLD_THRESHOLD_MS, shouldReleaseRail } from "./dial-math.js";

export interface KeyImageSink {
  setImage(image: string): Promise<void>;
  showAlert(): Promise<void>;
}

export class AutoFadeKeyInstanceController {
  private readonly store: FadesterStore;
  private readonly sink: KeyImageSink;
  private settings: Required<AutoFadeKeySettings>;
  private readonly rateLimiter: CellRateLimiter<string>;
  private readonly arm: QuantizedKeyArm;
  private readonly clock: () => number;
  private visible = false;
  /** Unsubscribes this control from language changes (PLAN.md 11.1). */
  private offLanguage: () => void = () => {};

  private readonly onStoreChanged = (): void => {
    if (!this.store.getClient().isConnected()) {
      this.arm.cancelSilently();
    }
    this.renderNow();
  };

  private readonly onSlotValueChanged = (slotId: string): void => {
    if (slotId === this.settings.slot || this.settings.slot === ALL_FX_SLOT_ID) {
      this.renderNow();
    }
  };

  public constructor(
    store: FadesterStore,
    sink: KeyImageSink,
    initialSettings?: AutoFadeKeySettings,
    rateLimitMs = 100,
    signals?: VisualSignals,
    holdMs: number = DIAL_HOLD_THRESHOLD_MS,
    clock: () => number = Date.now
  ) {
    this.store = store;
    this.sink = sink;
    this.clock = clock;
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = new CellRateLimiter<string>(async (svg) => {
      await this.sink.setImage(toSvgDataUri(svg));
    }, rateLimitMs, clock);
    this.arm = new QuantizedKeyArm(signals, () => this.renderNow(), holdMs, clock);
  }

  public appear(settings?: AutoFadeKeySettings): void {
    if (settings) {
      this.settings = this.mergeSettings(settings);
    }
    this.visible = true;
    this.offLanguage();
    this.offLanguage = onLanguageChanged(() => this.renderNow());
    this.store.on("changed", this.onStoreChanged);
    this.store.on("slotValueChanged", this.onSlotValueChanged);
    this.renderNow();
  }

  public disappear(): void {
    this.visible = false;
    this.offLanguage();
    this.offLanguage = () => {};
    this.arm.dispose();
    this.rateLimiter.dispose();
    this.store.off("changed", this.onStoreChanged);
    this.store.off("slotValueChanged", this.onSlotValueChanged);
  }

  public updateSettings(settings: AutoFadeKeySettings): void {
    const prev = this.settings;
    this.settings = this.mergeSettings(settings);
    if (
      prev.slot !== this.settings.slot ||
      prev.to !== this.settings.to ||
      prev.quantizeBeats !== this.settings.quantizeBeats ||
      prev.quantizeStart !== this.settings.quantizeStart
    ) {
      this.arm.cancelSilently();
    }
    this.renderNow();
  }

  public getSettings(): Required<AutoFadeKeySettings> {
    return { ...this.settings };
  }

  public async handleKeyDown(now = this.clock()): Promise<void> {
    if (!this.arm.isArmed()) {
      const client = this.store.getClient();
      if (!client.isConnected()) {
        client.nudgeReconnect(2000, now);
        await this.sink.showAlert();
        return;
      }

      if (this.settings.slot !== ALL_FX_SLOT_ID) {
        const slot = this.store.getSlot(this.settings.slot);
        if (slot && !slot.available) {
          await this.sink.showAlert();
          return;
        }
      }
    }

    await this.arm.handleKeyDown(
      this.settings.quantizeBeats,
      this.settings.quantizeStart,
      this.settings.durationMs,
      async (effectiveMs) => {
        if (!this.store.getClient().isConnected()) return;
        const ms = effectiveMs ?? this.settings.durationMs;
        try {
          if (this.settings.slot === ALL_FX_SLOT_ID) {
            await this.store.getClient().resetFx({ ms });
            return;
          }

          if (ms === 0) {
            await this.store.getClient().setFaderValue({
              slot: this.settings.slot,
              value: this.settings.to,
              release: shouldReleaseRail(
                this.settings.to,
                this.store.getSlot(this.settings.slot)?.target_mode
              )
            });
            return;
          }

          await this.store.getClient().autoFade({
            slot: this.settings.slot,
            to: this.settings.to,
            ms
          });
        } catch {
          await this.sink.showAlert();
        }
      },
      now
    );
  }

  public async handleKeyUp(): Promise<void> {
    await this.arm.handleKeyUp();
  }

  public renderSvgString(): string {
    const slot = this.store.getSlot(this.settings.slot);
    const bannerKind = this.arm.getBanner();
    const statusBanner =
      bannerKind === "armed"
        ? { text: t("quantizeArmed"), active: true }
        : bannerKind === "no_tempo"
          ? { text: t("quantizeNoTempo"), active: false }
          : bannerKind === "cancelled"
            ? { text: t("quantizeCancelled"), active: false }
            : undefined;
    return renderAutoFadeKeySvg({
      status: this.store.getStatus(),
      slot,
      slots: this.store.getSlots(),
      slotId: this.settings.slot,
      to: this.settings.to,
      durationMs: this.settings.durationMs,
      labelOverride: this.settings.labelOverride,
      readoutStyle: this.settings.readoutStyle,
      statusBanner,
      t: translate
    });
  }

  private renderNow(): void {
    if (!this.visible) {
      return;
    }
    this.rateLimiter.push(this.renderSvgString(), this.clock());
  }

  private mergeSettings(
    raw?: AutoFadeKeySettings
  ): Required<AutoFadeKeySettings> {
    const slot =
      (raw?.slot && String(raw.slot).trim()) || DEFAULT_AUTO_FADE_KEY_SETTINGS.slot;
    const to: 0 | 1 = Number(raw?.to) === 0 ? 0 : 1;
    const rawMs = Number(raw?.durationMs ?? DEFAULT_AUTO_FADE_KEY_SETTINGS.durationMs);
    const rounded = Math.round(rawMs);
    const durationMs = Number.isFinite(rounded)
      ? rounded === 0
        ? 0
        : Math.max(50, Math.min(20000, rounded))
      : DEFAULT_AUTO_FADE_KEY_SETTINGS.durationMs;
    return {
      slot,
      to,
      durationMs,
      quantizeBeats: normalizeQuantizeBeats(raw?.quantizeBeats),
      quantizeStart: normalizeQuantizeStart(raw?.quantizeStart),
      labelOverride: normalizeLabelOverride(raw?.labelOverride),
      readoutStyle: normalizeReadoutStyle(raw?.readoutStyle)
    };
  }
}

@action({ UUID: "io.github.jbrick2070.fadester-for-obs.auto-fade" })
export class AutoFadeKeyAction extends SingletonAction<AutoFadeKeySettings> {
  private readonly store: FadesterStore;
  private readonly signals?: VisualSignals;
  private readonly instances = new Map<string, AutoFadeKeyInstanceController>();

  public constructor(store: FadesterStore, signals?: VisualSignals) {
    super();
    this.store = store;
    this.signals = signals;
  }

  public override onWillAppear(
    ev: WillAppearEvent<AutoFadeKeySettings>
  ): void {
    if (!ev.action.isKey()) {
      return;
    }
    this.store.getClient().ensureStarted();
    const keyAction = ev.action;
    // Stream Deck can send willAppear twice for one context: the first controller stops first.
    this.instances.get(keyAction.id)?.disappear();
    const ctrl = new AutoFadeKeyInstanceController(
      this.store,
      {
        setImage: (img) => keyAction.setImage(img),
        showAlert: () => keyAction.showAlert()
      },
      ev.payload.settings,
      100,
      this.signals
    );
    this.instances.set(keyAction.id, ctrl);
    ctrl.appear(ev.payload.settings);
  }

  public override onWillDisappear(
    ev: WillDisappearEvent<AutoFadeKeySettings>
  ): void {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      ctrl.disappear();
      this.instances.delete(ev.action.id);
    }
  }

  public override onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<AutoFadeKeySettings>
  ): void {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      ctrl.updateSettings(ev.payload.settings);
    }
  }

  public override async onKeyDown(
    ev: KeyDownEvent<AutoFadeKeySettings>
  ): Promise<void> {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      await ctrl.handleKeyDown();
    }
  }

  public override async onKeyUp(
    ev: KeyUpEvent<AutoFadeKeySettings>
  ): Promise<void> {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      await ctrl.handleKeyUp();
    }
  }
}
