// SPDX-License-Identifier: GPL-2.0-or-later
import {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import { FadesterStore } from "../state/fadester-store.js";
import {
  ALL_FX_SLOT_ID,
  AutoFadeKeySettings,
  DEFAULT_AUTO_FADE_KEY_SETTINGS,
  normalizeLabelOverride,
  normalizeReadoutStyle
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { renderAutoFadeKeySvg, toSvgDataUri } from "../gfx/svg-renderer.js";
import { shouldReleaseRail } from "./dial-math.js";

export interface KeyImageSink {
  setImage(image: string): Promise<void>;
  showAlert(): Promise<void>;
}

export class AutoFadeKeyInstanceController {
  private readonly store: FadesterStore;
  private readonly sink: KeyImageSink;
  private settings: Required<AutoFadeKeySettings>;
  private readonly rateLimiter: CellRateLimiter<string>;
  private visible = false;

  private readonly onStoreChanged = (): void => {
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
    rateLimitMs = 100
  ) {
    this.store = store;
    this.sink = sink;
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = new CellRateLimiter<string>(async (svg) => {
      await this.sink.setImage(toSvgDataUri(svg));
    }, rateLimitMs);
  }

  public appear(settings?: AutoFadeKeySettings): void {
    if (settings) {
      this.settings = this.mergeSettings(settings);
    }
    this.visible = true;
    this.store.on("changed", this.onStoreChanged);
    this.store.on("slotValueChanged", this.onSlotValueChanged);
    this.renderNow();
  }

  public disappear(): void {
    this.visible = false;
    this.rateLimiter.dispose();
    this.store.off("changed", this.onStoreChanged);
    this.store.off("slotValueChanged", this.onSlotValueChanged);
  }

  public updateSettings(settings: AutoFadeKeySettings): void {
    this.settings = this.mergeSettings(settings);
    this.renderNow();
  }

  public getSettings(): Required<AutoFadeKeySettings> {
    return { ...this.settings };
  }

  public async handleKeyDown(now = Date.now()): Promise<void> {
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

    try {
      if (this.settings.slot === ALL_FX_SLOT_ID) {
        await this.store.getClient().resetFx({ ms: this.settings.durationMs });
        return;
      }

      if (this.settings.durationMs === 0) {
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
        ms: this.settings.durationMs
      });
    } catch {
      await this.sink.showAlert();
    }
  }

  public renderSvgString(): string {
    const slot = this.store.getSlot(this.settings.slot);
    return renderAutoFadeKeySvg({
      status: this.store.getStatus(),
      slot,
      slots: this.store.getSlots(),
      slotId: this.settings.slot,
      to: this.settings.to,
      durationMs: this.settings.durationMs,
      labelOverride: this.settings.labelOverride,
      readoutStyle: this.settings.readoutStyle
    });
  }

  private renderNow(): void {
    if (!this.visible) {
      return;
    }
    this.rateLimiter.push(this.renderSvgString());
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
      labelOverride: normalizeLabelOverride(raw?.labelOverride),
      readoutStyle: normalizeReadoutStyle(raw?.readoutStyle)
    };
  }
}

@action({ UUID: "com.jbrick2070.fadester-for-obs.auto-fade" })
export class AutoFadeKeyAction extends SingletonAction<AutoFadeKeySettings> {
  private readonly store: FadesterStore;
  private readonly instances = new Map<string, AutoFadeKeyInstanceController>();

  public constructor(store: FadesterStore) {
    super();
    this.store = store;
  }

  public override onWillAppear(
    ev: WillAppearEvent<AutoFadeKeySettings>
  ): void {
    if (!ev.action.isKey()) {
      return;
    }
    const keyAction = ev.action;
    const ctrl = new AutoFadeKeyInstanceController(
      this.store,
      {
        setImage: (img) => keyAction.setImage(img),
        showAlert: () => keyAction.showAlert()
      },
      ev.payload.settings
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
}
