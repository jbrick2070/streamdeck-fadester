// SPDX-License-Identifier: GPL-2.0-or-later
import {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import { DirectObsClient } from "../obs/direct-obs-client.js";
import { automaticInputRoleName, migrateAutomaticInputSettings } from "../obs/automatic-targets.js";
import { customCaption } from "../obs/preset-captions.js";
import {
  DEFAULT_OBS_FADE_KEY_SETTINGS,
  ObsFadeKeySettings,
  normalizeAccent,
  normalizeDurationMs,
  normalizeLabelOverride
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import {
  renderDirectKeySvg,
  toSvgDataUri
} from "../gfx/direct-obs-renderer.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { formatNumber, t, translate } from "../i18n/strings.js";

interface KeyImageSink {
  setImage(image: string): Promise<void>;
  showAlert(): Promise<void>;
}

export class ObsFadeKeyInstanceController {
  private settings: Required<ObsFadeKeySettings>;
  private visible = false;
  private readonly rateLimiter: CellRateLimiter<string>;
  private readonly onStateChanged = (): void => this.renderNow();

  public constructor(
    private readonly client: DirectObsClient,
    private readonly sink: KeyImageSink,
    initialSettings?: ObsFadeKeySettings,
    rateLimitMs = 100
  ) {
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = new CellRateLimiter<string>(async (svg) => {
      await this.sink.setImage(toSvgDataUri(svg));
    }, rateLimitMs);
  }

  public appear(settings?: ObsFadeKeySettings): void {
    if (settings) {
      this.settings = this.mergeSettings(settings);
    }
    this.visible = true;
    this.client.on("statusChanged", this.onStateChanged);
    this.client.on("directStateChanged", this.onStateChanged);
    this.renderNow();
  }

  public disappear(): void {
    this.visible = false;
    this.rateLimiter.dispose();
    this.client.off("statusChanged", this.onStateChanged);
    this.client.off("directStateChanged", this.onStateChanged);
  }

  public updateSettings(settings: ObsFadeKeySettings): void {
    this.settings = this.mergeSettings(settings);
    this.renderNow();
  }

  public async handleKeyDown(now = Date.now()): Promise<void> {
    if (!this.settings.inputName) {
      await this.sink.showAlert();
      return;
    }
    if (!this.client.isConnected()) {
      this.client.nudgeReconnect(2000, now);
      await this.sink.showAlert();
      return;
    }
    void this.client
      .fadeInputVolume(
        this.settings.inputName,
        this.settings.to,
        this.settings.durationMs
      )
      .catch(async () => this.sink.showAlert());
  }

  private renderNow(): void {
    if (!this.visible) {
      return;
    }
    const configured = Boolean(this.settings.inputName);
    const inputName = this.client.resolveInputName(this.settings.inputName);
    const role = automaticInputRoleName(this.settings.inputName);
    const customLabel = customCaption("fade", this.settings);
    const title = customLabel || inputName || role || this.settings.inputName || t("fadeTitle");
    const up = this.settings.to === 1;
    const subtitle = !configured
      ? t("keyOpenInspector")
      : this.settings.durationMs === 0
        ? t(up ? "fadeUpNow" : "fadeDownNow")
        : t(up ? "fadeUpSeconds" : "fadeDownSeconds", { s: formatNumber(this.settings.durationMs / 1000, 3) });
    this.rateLimiter.push(
      renderDirectKeySvg({
        connected: this.client.isConnected(),
        reason: statusCellReason(this.client.getStatus(), translate),
        title,
        subtitle,
        icon: this.settings.to === 1 ? "volume-up" : "volume-down",
        configured,
        accent: this.settings.accent,
        ...(!inputName && configured ? { problem: role ? t("roleUnavailable", { role }) : t("audioInputUnavailable") } : {})
      })
    );
  }

  private mergeSettings(raw?: ObsFadeKeySettings): Required<ObsFadeKeySettings> {
    return {
      inputName: typeof raw?.inputName === "string" ? raw.inputName.trim()
        : raw?.inputName === undefined ? DEFAULT_OBS_FADE_KEY_SETTINGS.inputName : "",
      to: Number(raw?.to) === 0 ? 0 : 1,
      durationMs: normalizeDurationMs(
        raw?.durationMs,
        DEFAULT_OBS_FADE_KEY_SETTINGS.durationMs
      ),
      labelOverride: normalizeLabelOverride(raw?.labelOverride),
      accent: normalizeAccent(raw?.accent)
    };
  }
}

@action({ UUID: "com.jbrick2070.fadester-for-obs.obs-fade" })
export class ObsFadeKeyAction extends SingletonAction<ObsFadeKeySettings> {
  private readonly instances = new Map<string, ObsFadeKeyInstanceController>();

  public constructor(private readonly client: DirectObsClient) {
    super();
  }

  public override onWillAppear(ev: WillAppearEvent<ObsFadeKeySettings>): void {
    if (!ev.action.isKey()) {
      return;
    }
    const key = ev.action;
    const settings = migrateAutomaticInputSettings(ev.payload.settings);
    if (settings !== ev.payload.settings) void key.setSettings(settings);
    const controller = new ObsFadeKeyInstanceController(
      this.client,
      {
        setImage: (image) => key.setImage(image),
        showAlert: () => key.showAlert()
      },
      settings
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
}
