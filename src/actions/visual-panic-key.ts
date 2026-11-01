// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Visual Panic keys (PLAN.md 10.3, R-RIG-6): Panic sends Visual Sidechain's
 * Panic on every press, at once; Restore sends its Restore only after an 800 ms
 * hold. Every Panic key shows the deck's latch ("PANIC SENT") until a Restore
 * clears it. Panic is never gated on a page, a dial or the latch.
 */
import {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  KeyUpEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import { DirectObsClient } from "../obs/direct-obs-client.js";
import { VisualSafety } from "../control/visual-safety.js";
import { customCaption } from "../obs/preset-captions.js";
import {
  DEFAULT_VISUAL_PANIC_SETTINGS,
  VisualPanicSettings,
  normalizeAccent,
  normalizeLabelOverride,
  normalizeVisualPanicOperation
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { renderVisualPanicKeySvg, toSvgDataUri } from "../gfx/direct-obs-renderer.js";
import { DIAL_HOLD_THRESHOLD_MS } from "./dial-math.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { LocalText, errorLocalText, ownText, wordText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { translate } from "../i18n/strings.js";

interface KeyImageSink {
  setImage(image: string): Promise<void>;
  showAlert(): Promise<void>;
  showOk(): Promise<void>;
}

export class VisualPanicInstanceController {
  private settings: Required<VisualPanicSettings>;
  private visible = false;
  private readonly rateLimiter: CellRateLimiter<string>;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** This key's last failed send, cleared on the next press and when the latch changes. */
  private lastError: LocalText | null = null;
  private lastSvg = "";
  private readonly onChanged = (): void => {
    this.lastError = null;
    this.renderNow();
  };
  /** A disconnect or reconnect: an old "not loaded" may be wrong now (loading the plugin needs an OBS restart). */
  private readonly onReset = (): void => {
    this.lastError = null;
    this.renderNow();
  };
  private readonly onStatusChanged = (): void => this.renderNow();

  public constructor(
    private readonly safety: VisualSafety,
    private readonly client: DirectObsClient,
    private readonly sink: KeyImageSink,
    initialSettings?: VisualPanicSettings,
    rateLimitMs = 100,
    private readonly holdMs: number = DIAL_HOLD_THRESHOLD_MS
  ) {
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = new CellRateLimiter<string>(async (svg) => {
      await this.sink.setImage(toSvgDataUri(svg));
    }, rateLimitMs);
  }

  public appear(settings?: VisualPanicSettings): void {
    if (this.visible) this.disappear();
    if (settings) this.settings = this.mergeSettings(settings);
    this.visible = true;
    this.safety.on("changed", this.onChanged);
    this.safety.on("reset", this.onReset);
    this.client.on("statusChanged", this.onStatusChanged);
    this.renderNow();
  }

  public disappear(): void {
    this.visible = false;
    this.cancelHold();
    this.lastSvg = "";
    this.rateLimiter.dispose();
    this.safety.off("changed", this.onChanged);
    this.safety.off("reset", this.onReset);
    this.client.off("statusChanged", this.onStatusChanged);
  }

  public updateSettings(settings: VisualPanicSettings): void {
    const previous = this.settings.operation;
    this.settings = this.mergeSettings(settings);
    if (this.settings.operation !== previous) {
      this.cancelHold();
      this.lastError = null;
    }
    this.renderNow();
  }

  public async handleKeyDown(now = Date.now()): Promise<void> {
    this.lastError = null;
    if (this.settings.operation === "panic") {
      // Panic sends whenever the socket is identified, also while the catalog read after a reconnect runs.
      if (this.client.isIdentified()) {
        await this.send(() => this.safety.panic());
        return;
      }
      // A socket that is opening or identifying is never torn down by a press: it is about to be usable.
      if (!this.client.hasLiveSocket()) this.client.nudgeReconnect(2000, now);
      this.renderNow();
      await this.sink.showAlert();
      return;
    }
    if (!this.client.isConnected()) {
      this.client.nudgeReconnect(2000, now);
      this.renderNow();
      await this.sink.showAlert();
      return;
    }
    // Restore only after the hold: a brush of the key does nothing.
    this.cancelHold();
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.renderNow();
      void this.send(() => this.safety.restore(), true).catch(() => {});
    }, this.holdMs);
    this.renderNow();
  }

  public async handleKeyUp(): Promise<void> {
    if (this.settings.operation !== "restore" || !this.holdTimer) return;
    // Released too soon: nothing sent, the key says how long to hold.
    this.cancelHold();
    this.renderNow();
  }

  private async send(run: () => Promise<void>, confirm = false): Promise<void> {
    let failed = false;
    try {
      await run();
    } catch (error) {
      failed = true;
      this.lastError = errorLocalText(error, ownText("errorRequestFailed", { code: 500 }));
    }
    this.renderNow();
    if (failed) await this.sink.showAlert();
    else if (confirm) await this.sink.showOk();
  }

  private cancelHold(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private renderNow(): void {
    if (!this.visible) return;
    const svg = renderVisualPanicKeySvg({
      operation: this.settings.operation,
      connected: this.client.isConnected(),
      reason: statusCellReason(this.client.getStatus(), translate),
      latched: this.safety.isLatched(),
      holding: this.holdTimer !== null,
      holdSeconds: this.holdMs / 1000,
      accent: this.settings.accent,
      title: customCaption("panic", this.settings),
      ...(this.lastError ? { problem: wordText(this.lastError, translate) } : {})
    });
    if (svg === this.lastSvg) return;
    this.lastSvg = svg;
    this.rateLimiter.push(svg);
  }

  private mergeSettings(raw?: VisualPanicSettings): Required<VisualPanicSettings> {
    return {
      operation: normalizeVisualPanicOperation(raw?.operation ?? DEFAULT_VISUAL_PANIC_SETTINGS.operation),
      labelOverride: normalizeLabelOverride(raw?.labelOverride),
      accent: normalizeAccent(raw?.accent)
    };
  }
}

@action({ UUID: "com.jbrick2070.fadester-for-obs.visual-panic" })
export class VisualPanicKeyAction extends SingletonAction<VisualPanicSettings> {
  private readonly instances = new Map<string, VisualPanicInstanceController>();

  public constructor(private readonly safety: VisualSafety, private readonly client: DirectObsClient) {
    super();
  }

  public override onWillAppear(ev: WillAppearEvent<VisualPanicSettings>): void {
    if (!ev.action.isKey()) return;
    const key = ev.action;
    this.instances.get(key.id)?.disappear();
    const controller = new VisualPanicInstanceController(this.safety, this.client, {
      setImage: (image) => key.setImage(image),
      showAlert: () => key.showAlert(),
      showOk: () => key.showOk()
    }, ev.payload.settings);
    this.instances.set(key.id, controller);
    controller.appear(ev.payload.settings);
  }

  public override onWillDisappear(ev: WillDisappearEvent<VisualPanicSettings>): void {
    this.instances.get(ev.action.id)?.disappear();
    this.instances.delete(ev.action.id);
  }

  public override onDidReceiveSettings(ev: DidReceiveSettingsEvent<VisualPanicSettings>): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }

  public override async onKeyDown(ev: KeyDownEvent<VisualPanicSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.handleKeyDown();
  }

  public override async onKeyUp(ev: KeyUpEvent<VisualPanicSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.handleKeyUp();
  }
}
