// SPDX-License-Identifier: GPL-2.0-or-later
import {
  action,
  DialDownEvent,
  DialRotateEvent,
  DialUpEvent,
  DidReceiveSettingsEvent,
  SingletonAction,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import { FadesterStore } from "../state/fadester-store.js";
import {
  DEFAULT_FADER_DIAL_SETTINGS,
  DialLongPressAction,
  DialPressAction,
  FaderDialSettings,
  normalizeLabelOverride,
  normalizeReadoutStyle
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { ThumbnailFetcher } from "../gfx/thumbnail-fetcher.js";
import { renderDialCellSvg, toSvgDataUri } from "../gfx/svg-renderer.js";
import {
  computeDialDelta,
  DIAL_HOLD_THRESHOLD_MS,
  mapTouchTapToRequest,
  normalizeStepPerTick,
  resolveDialLongPressCommand,
  resolveDialPressCommand,
  ResolvedDialCommand
} from "./dial-math.js";

export interface DialFeedbackSink {
  setFeedback(feedback: { canvas: string }): Promise<void>;
  showAlert(): Promise<void>;
}

export class FaderDialInstanceController {
  private readonly store: FadesterStore;
  private readonly sink: DialFeedbackSink;
  private settings: Required<FaderDialSettings>;
  private readonly rateLimiter: CellRateLimiter<string>;
  private readonly thumbnailFetcher: ThumbnailFetcher;
  private lastRotateTime = 0;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private holdingForLongPress = false;
  private longPressFired = false;
  private visible = false;

  private readonly onStoreChanged = (): void => {
    this.syncThumbnailsAndRender();
  };

  private readonly onSlotValueChanged = (slotId: string): void => {
    if (slotId === this.settings.slot) {
      this.renderNow();
    }
  };

  public constructor(
    store: FadesterStore,
    sink: DialFeedbackSink,
    initialSettings?: FaderDialSettings,
    rateLimitMs = 100,
    thumbnailIntervalMs = 750
  ) {
    this.store = store;
    this.sink = sink;
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = new CellRateLimiter<string>(async (svg) => {
      await this.sink.setFeedback({ canvas: toSvgDataUri(svg) });
    }, rateLimitMs);
    this.thumbnailFetcher = new ThumbnailFetcher(
      store.getClient(),
      () => {
        this.renderNow();
      },
      thumbnailIntervalMs
    );
  }

  public appear(settings?: FaderDialSettings): void {
    if (settings) {
      this.settings = this.mergeSettings(settings);
    }
    this.visible = true;
    this.store.on("changed", this.onStoreChanged);
    this.store.on("scenesChanged", this.onStoreChanged);
    this.store.on("slotValueChanged", this.onSlotValueChanged);
    this.syncThumbnailsAndRender();
  }

  public disappear(): void {
    this.visible = false;
    this.clearHoldTimer();
    this.holdingForLongPress = false;
    this.thumbnailFetcher.stop();
    this.rateLimiter.dispose();
    this.store.off("changed", this.onStoreChanged);
    this.store.off("scenesChanged", this.onStoreChanged);
    this.store.off("slotValueChanged", this.onSlotValueChanged);
  }

  public updateSettings(settings: FaderDialSettings): void {
    this.settings = this.mergeSettings(settings);
    this.syncThumbnailsAndRender();
  }

  public getSettings(): Required<FaderDialSettings> {
    return { ...this.settings };
  }

  public async handleRotate(ticks: number, now = Date.now()): Promise<void> {
    if (!(await this.ensureReady(now))) {
      return;
    }

    const elapsed = this.lastRotateTime > 0 ? now - this.lastRotateTime : 999;
    this.lastRotateTime = now;

    const delta = computeDialDelta(
      ticks,
      this.settings.stepPerTick,
      this.settings.acceleration,
      elapsed
    );
    if (delta === 0) {
      return;
    }

    try {
      await this.store.getClient().nudgeFader({
        slot: this.settings.slot,
        delta
      });
    } catch {
      await this.sink.showAlert();
    }
  }

  public handleDialDown(): void {
    this.clearHoldTimer();
    this.longPressFired = false;

    if (this.settings.longPressAction === "none") {
      this.holdingForLongPress = false;
      return;
    }

    this.holdingForLongPress = true;
    this.renderNow();

    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.holdingForLongPress = false;
      this.longPressFired = true;
      this.renderNow();
      void this.executeLongPress();
    }, DIAL_HOLD_THRESHOLD_MS);
  }

  public async handleDialUp(): Promise<void> {
    const wasHolding = this.holdingForLongPress;
    this.clearHoldTimer();
    this.holdingForLongPress = false;
    if (wasHolding) {
      this.renderNow();
    }

    if (this.longPressFired) {
      this.longPressFired = false;
      return;
    }

    if (!(await this.ensureReady())) {
      return;
    }

    const slot = this.store.getSlot(this.settings.slot);
    const currentValue = slot?.value ?? 0;
    const cmd = resolveDialPressCommand(
      this.settings.slot,
      currentValue,
      this.settings.pressAction,
      slot?.target_mode
    );
    await this.executeCommand(cmd);
  }

  public async handleTouchTap(tapX: number, tapY: number): Promise<void> {
    if (!(await this.ensureReady())) {
      return;
    }

    const slot = this.store.getSlot(this.settings.slot);
    const targetMode = slot?.target_mode ?? "unassigned";
    const thumbs = this.thumbnailFetcher.getLatest();
    const hasThumbs =
      this.settings.showThumbnails &&
      Boolean(thumbs.thumbnailA || thumbs.thumbnailB);

    const req = mapTouchTapToRequest(
      this.settings.slot,
      tapX,
      tapY,
      targetMode,
      hasThumbs
    );
    try {
      await this.store.getClient().setFaderValue(req);
    } catch {
      await this.sink.showAlert();
    }
  }

  /**
   * Offline: one throttled reconnect nudge plus an alert, no request.
   * Slot known and unavailable: alert only, so OBS never sees a request the
   * engine would reject (and we skip the error-driven resync).
   */
  private async ensureReady(now = Date.now()): Promise<boolean> {
    const client = this.store.getClient();
    if (!client.isConnected()) {
      client.nudgeReconnect(2000, now);
      await this.sink.showAlert();
      return false;
    }
    const slot = this.store.getSlot(this.settings.slot);
    if (slot && !slot.available) {
      await this.sink.showAlert();
      return false;
    }
    return true;
  }

  public renderSvgString(): string {
    const slot = this.store.getSlot(this.settings.slot);
    const thumbs = this.thumbnailFetcher.getLatest();
    const holdLabel =
      this.settings.longPressAction === "clean_all_fx"
        ? "HOLD CLEAN FX"
        : this.settings.longPressAction === "finish_tbar"
          ? "HOLD FINISH"
          : "HOLD 3s FADE";
    return renderDialCellSvg({
      status: this.store.getStatus(),
      slot,
      slotId: this.settings.slot,
      previewSceneName: this.store.getPreviewSceneName(),
      programSceneName: this.store.getProgramSceneName(),
      showThumbnails: this.settings.showThumbnails,
      thumbnailA: thumbs.thumbnailA,
      thumbnailB: thumbs.thumbnailB,
      holdingForLongPress: this.holdingForLongPress,
      holdLabel,
      labelOverride: this.settings.labelOverride,
      readoutStyle: this.settings.readoutStyle
    });
  }

  private syncThumbnailsAndRender(): void {
    const slot = this.store.getSlot(this.settings.slot);
    this.thumbnailFetcher.syncSlotState(
      this.visible,
      this.store.getClient().isConnected(),
      this.settings.showThumbnails,
      slot
    );
    this.renderNow();
  }

  private renderNow(): void {
    if (!this.visible) {
      return;
    }
    const svg = this.renderSvgString();
    this.rateLimiter.push(svg);
  }

  private async executeLongPress(): Promise<void> {
    // Clean All FX is slot-independent; everything else needs the slot ready.
    const slotIndependent = this.settings.longPressAction === "clean_all_fx";
    if (slotIndependent) {
      if (!this.store.getClient().isConnected()) {
        await this.sink.showAlert();
        return;
      }
    } else if (!(await this.ensureReady())) {
      return;
    }
    const slot = this.store.getSlot(this.settings.slot);
    const currentValue = slot?.value ?? 0;
    const cmd = resolveDialLongPressCommand(
      this.settings.slot,
      currentValue,
      this.settings.longPressAction
    );
    if (cmd) {
      await this.executeCommand(cmd);
    }
  }

  private async executeCommand(cmd: ResolvedDialCommand): Promise<void> {
    try {
      if (cmd.kind === "set_fader_value") {
        await this.store.getClient().setFaderValue(cmd.request);
      } else if (cmd.kind === "reset_fx") {
        await this.store.getClient().resetFx(cmd.request);
      } else {
        await this.store.getClient().autoFade(cmd.request);
      }
    } catch {
      await this.sink.showAlert();
    }
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private mergeSettings(raw?: FaderDialSettings): Required<FaderDialSettings> {
    const validPress: readonly DialPressAction[] = [
      "snap_0_100",
      "clean_0",
      "auto_fade_1s",
      "auto_fade_2s",
      "cut",
      "finish_tbar"
    ];
    const validLongPress: readonly DialLongPressAction[] = [
      "auto_fade_3s",
      "clean_all_fx",
      "finish_tbar",
      "none"
    ];
    const pressAction =
      raw?.pressAction && validPress.includes(raw.pressAction)
        ? raw.pressAction
        : DEFAULT_FADER_DIAL_SETTINGS.pressAction;
    const longPressAction =
      raw?.longPressAction && validLongPress.includes(raw.longPressAction)
        ? raw.longPressAction
        : DEFAULT_FADER_DIAL_SETTINGS.longPressAction;

    return {
      slot: (raw?.slot && String(raw.slot).trim()) || DEFAULT_FADER_DIAL_SETTINGS.slot,
      stepPerTick: normalizeStepPerTick(Number(raw?.stepPerTick)),
      acceleration:
        raw?.acceleration !== undefined
          ? Boolean(raw.acceleration)
          : DEFAULT_FADER_DIAL_SETTINGS.acceleration,
      pressAction,
      longPressAction,
      showThumbnails:
        raw?.showThumbnails !== undefined
          ? Boolean(raw.showThumbnails)
          : DEFAULT_FADER_DIAL_SETTINGS.showThumbnails,
      labelOverride: normalizeLabelOverride(raw?.labelOverride),
      readoutStyle: normalizeReadoutStyle(raw?.readoutStyle)
    };
  }
}

@action({ UUID: "com.jbrick2070.fadester-for-obs.fader" })
export class FaderDialAction extends SingletonAction<FaderDialSettings> {
  private readonly store: FadesterStore;
  private readonly instances = new Map<string, FaderDialInstanceController>();

  public constructor(store: FadesterStore) {
    super();
    this.store = store;
  }

  public override async onWillAppear(
    ev: WillAppearEvent<FaderDialSettings>
  ): Promise<void> {
    if (!ev.action.isDial()) {
      return;
    }
    const dialAction = ev.action;
    const ctrl = new FaderDialInstanceController(
      this.store,
      {
        setFeedback: (fb) => dialAction.setFeedback(fb),
        showAlert: () => dialAction.showAlert()
      },
      ev.payload.settings
    );
    this.instances.set(dialAction.id, ctrl);
    ctrl.appear(ev.payload.settings);
  }

  public override onWillDisappear(
    ev: WillDisappearEvent<FaderDialSettings>
  ): void {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      ctrl.disappear();
      this.instances.delete(ev.action.id);
    }
  }

  public override onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<FaderDialSettings>
  ): void {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      ctrl.updateSettings(ev.payload.settings);
    }
  }

  public override async onDialRotate(
    ev: DialRotateEvent<FaderDialSettings>
  ): Promise<void> {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      await ctrl.handleRotate(ev.payload.ticks);
    }
  }

  public override onDialDown(ev: DialDownEvent<FaderDialSettings>): void {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      ctrl.handleDialDown();
    }
  }

  public override async onDialUp(
    ev: DialUpEvent<FaderDialSettings>
  ): Promise<void> {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      await ctrl.handleDialUp();
    }
  }

  public override async onTouchTap(
    ev: TouchTapEvent<FaderDialSettings>
  ): Promise<void> {
    const ctrl = this.instances.get(ev.action.id);
    if (ctrl) {
      const [tapX, tapY] = ev.payload.tapPos;
      await ctrl.handleTouchTap(tapX, tapY);
    }
  }
}
