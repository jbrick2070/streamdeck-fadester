// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * VJLink keys and dials (BosoVR's obs-vjlink, through OBS's WebSocket): a key
 * steps or picks VJLink's presets, taps its BPM or blacks it out; a dial rides
 * one of its five macros, and its press taps the BPM or blacks it out. Each
 * control reads VJLink's state while it is on screen (src/control/vjlink.ts).
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
import { VjlinkController, VjlinkState } from "../control/vjlink.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { DirectKeyIcon, renderDirectKeySvg, renderFilterDialSvg, toStripUri, toSvgDataUri } from "../gfx/direct-obs-renderer.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { LocalText, errorLocalText, ownText, wordText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { StringKey, onLanguageChanged, t, translate } from "../i18n/strings.js";
import { VjlinkDialPress, VjlinkMacro, VjlinkSettings, normalizeVjlinkSettings } from "../types/settings.js";

export interface VjlinkSink {
  render(svg: string): Promise<void>;
  showAlert(): Promise<void>;
}

export const VJLINK_MACRO_WORDS: Record<VjlinkMacro, StringKey> = {
  energy: "vjlinkMacroEnergy",
  chaos: "vjlinkMacroChaos",
  speed: "vjlinkMacroSpeed",
  color: "vjlinkMacroColor",
  react: "vjlinkMacroReact"
};

const PRESS_HINTS: Record<VjlinkDialPress, StringKey> = {
  tap: "vjlinkPressTap",
  blackout: "vjlinkPressBlackout",
  none: "pressDisabled"
};

/** The running preset as a key's subtitle: "Preset 3", the effect's id without a preset, or a reading word. */
export function vjlinkPresetText(state: VjlinkState): string {
  if (state.presetIndex === null) return t("vjlinkReading");
  if (state.presetIndex < 0) return state.effectId || t("vjlinkNoPreset");
  return t("vjlinkPresetNumber", { n: state.presetIndex + 1 });
}

export class VjlinkInstanceController {
  private settings: Required<VjlinkSettings>;
  private visible = false;
  /** Unsubscribes this control from language changes (PLAN.md 11.1). */
  private offLanguage: () => void = () => {};
  private releaseWatch: () => void = () => {};
  private readonly limiter: CellRateLimiter<string>;
  /** This control's last refused press or turn, cleared by the next one and by a reconnect. */
  private lastError: LocalText | null = null;
  private lastSvg = "";
  private readonly onChanged = (): void => this.render();
  private readonly onStatusChanged = (): void => {
    this.lastError = null;
    this.render();
  };

  public constructor(
    private readonly vjlink: VjlinkController,
    private readonly sink: VjlinkSink,
    private readonly dial: boolean,
    settings?: VjlinkSettings,
    rateLimitMs = 100
  ) {
    this.settings = normalizeVjlinkSettings(settings);
    this.limiter = new CellRateLimiter<string>((svg) => this.sink.render(svg), rateLimitMs);
  }

  public appear(settings?: VjlinkSettings): void {
    if (this.visible) this.disappear();
    if (settings) this.settings = normalizeVjlinkSettings(settings);
    this.visible = true;
    this.offLanguage();
    this.offLanguage = onLanguageChanged(() => this.render());
    this.vjlink.on("changed", this.onChanged);
    this.vjlink.client.on("statusChanged", this.onStatusChanged);
    this.releaseWatch = this.vjlink.watch();
    this.render();
  }

  public disappear(): void {
    this.visible = false;
    this.offLanguage();
    this.offLanguage = () => {};
    this.releaseWatch();
    this.releaseWatch = () => {};
    this.lastSvg = "";
    this.limiter.dispose();
    this.vjlink.off("changed", this.onChanged);
    this.vjlink.client.off("statusChanged", this.onStatusChanged);
  }

  public updateSettings(settings: VjlinkSettings): void {
    const before = this.actionSignature();
    this.settings = normalizeVjlinkSettings(settings);
    if (this.actionSignature() !== before) this.lastError = null;
    this.render();
  }

  public async keyDown(now = Date.now()): Promise<void> {
    this.lastError = null;
    const s = this.settings;
    if (s.keyOperation === "preset" && !s.presetName) {
      this.lastError = ownText("vjlinkChoosePreset");
      this.render();
      await this.sink.showAlert();
      return;
    }
    await this.run(() => {
      switch (s.keyOperation) {
        case "next": return this.vjlink.nextPreset();
        case "previous": return this.vjlink.previousPreset();
        case "preset": return this.vjlink.selectPreset(s.presetName);
        case "tap": return this.vjlink.tapBpm();
        case "blackout": return this.vjlink.toggleBlackout();
      }
    }, now);
  }

  public async rotate(ticks: number, now = Date.now()): Promise<void> {
    if (!ticks) return;
    this.lastError = null;
    const delta = ticks * this.settings.stepPercent / 100;
    await this.run(() => this.vjlink.stepMacro(this.settings.macro, delta), now);
  }

  public async dialDown(now = Date.now()): Promise<void> {
    const press = this.settings.dialPress;
    if (press === "none") return;
    this.lastError = null;
    await this.run(() => press === "tap" ? this.vjlink.tapBpm() : this.vjlink.toggleBlackout(), now);
  }

  /** Everything that says what a press or a turn does: not the caption, not the accent. */
  private actionSignature(): string {
    const { labelOverride: _label, accent: _accent, ...rest } = this.settings;
    return JSON.stringify(rest);
  }

  private async run(job: () => Promise<void>, now: number): Promise<void> {
    const client = this.vjlink.client;
    if (!client.isConnected()) {
      client.nudgeReconnect(2000, now);
      this.render();
      await this.sink.showAlert();
      return;
    }
    try {
      await job();
    } catch (error) {
      this.lastError = errorLocalText(error, ownText("errorRequestFailed", { code: 500 }));
      this.render();
      await this.sink.showAlert();
      return;
    }
    this.render();
  }

  private render(): void {
    if (!this.visible) return;
    const state = this.vjlink.getState();
    const client = this.vjlink.client;
    const connected = client.isConnected();
    const reason = statusCellReason(client.getStatus(), translate);
    const problem = this.lastError ? wordText(this.lastError, translate)
      : state.availability === "missing" ? t("vjlinkMissing") : "";
    const caption = this.settings.labelOverride;
    const svg = this.dial
      ? this.renderDial(state, caption, connected, reason, problem)
      : this.renderKey(state, caption, connected, reason, problem);
    if (svg === this.lastSvg) return;
    this.lastSvg = svg;
    this.limiter.push(svg);
  }

  private renderDial(state: VjlinkState, caption: string, connected: boolean, reason: string, problem: string): string {
    const s = this.settings;
    const value = state.macros[s.macro];
    const hint = state.availability === "loading" ? t("vjlinkReading")
      : state.blackout ? t("vjlinkBlackoutOnHint") : t(PRESS_HINTS[s.dialPress]);
    return renderFilterDialSvg({
      connected,
      reason,
      configured: true,
      title: caption || t(VJLINK_MACRO_WORDS[s.macro]),
      filterName: "VJLink",
      value: value === null ? "—" : `${Math.round(value * 100)} %`,
      position: value ?? 0,
      enabled: state.blackout === null ? null : !state.blackout,
      hint,
      ...(problem ? { problem } : {}),
      accent: s.accent
    });
  }

  private renderKey(state: VjlinkState, caption: string, connected: boolean, reason: string, problem: string): string {
    const s = this.settings;
    let icon: DirectKeyIcon;
    let title: string;
    let subtitle: string;
    let badge: { text: string; on: boolean } | undefined;
    switch (s.keyOperation) {
      case "next":
        icon = "next";
        title = caption || t("vjlinkOpNext");
        subtitle = vjlinkPresetText(state);
        break;
      case "previous":
        icon = "previous";
        title = caption || t("vjlinkOpPrevious");
        subtitle = vjlinkPresetText(state);
        break;
      case "preset":
        icon = "scene";
        title = caption || s.presetName || t("vjlinkOpPreset");
        subtitle = t("vjlinkOpPreset");
        break;
      case "tap":
        icon = "wave";
        title = caption || t("vjlinkOpTap");
        subtitle = state.bpm !== null && state.bpm > 0 ? t("vjlinkBpm", { bpm: Math.round(state.bpm) }) : t("vjlinkTapHint");
        break;
      default:
        icon = state.blackout ? "look-off" : "look-on";
        title = caption || t("vjlinkOpBlackout");
        subtitle = state.blackout === null ? t("vjlinkReading")
          : t(state.blackout ? "vjlinkBlackoutOnHint" : "vjlinkBlackoutOffHint");
        if (state.blackout !== null && connected && !problem) {
          badge = { text: t(state.blackout ? "filterOn" : "filterOff"), on: state.blackout };
        }
    }
    const configured = s.keyOperation !== "preset" || s.presetName !== "";
    return renderDirectKeySvg({
      connected,
      reason,
      configured,
      icon,
      title,
      ...(configured ? {} : { unboundSubtitle: t("vjlinkChoosePreset") }),
      subtitle,
      ...(problem ? { problem } : {}),
      accent: s.accent,
      ...(badge ? { badge } : {})
    });
  }
}

@action({ UUID: "io.github.jbrick2070.fadester-for-obs.vjlink" })
export class VjlinkControlAction extends SingletonAction<VjlinkSettings> {
  private readonly instances = new Map<string, VjlinkInstanceController>();

  public constructor(private readonly vjlink: VjlinkController) {
    super();
  }

  public override onWillAppear(ev: WillAppearEvent<VjlinkSettings>): void {
    const control = ev.action;
    const dial = control.isDial();
    if (!dial && !control.isKey()) return;
    this.instances.get(control.id)?.disappear();
    const controller = new VjlinkInstanceController(this.vjlink, {
      render: (svg) => control.isDial() ? control.setFeedback({ canvas: toStripUri(svg) })
        : control.isKey() ? control.setImage(toSvgDataUri(svg)) : Promise.resolve(),
      showAlert: () => control.showAlert()
    }, dial, ev.payload.settings);
    this.instances.set(control.id, controller);
    controller.appear(ev.payload.settings);
  }

  public override onWillDisappear(ev: WillDisappearEvent<VjlinkSettings>): void {
    this.instances.get(ev.action.id)?.disappear();
    this.instances.delete(ev.action.id);
  }

  public override onDidReceiveSettings(ev: DidReceiveSettingsEvent<VjlinkSettings>): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }

  public override async onDialRotate(ev: DialRotateEvent<VjlinkSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.rotate(ev.payload.ticks);
  }

  public override async onDialDown(ev: DialDownEvent<VjlinkSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.dialDown();
  }

  // No onTouchTap: a tap on the strip never moves a macro (no jumps), as with the OBS Filter dial.

  public override async onKeyDown(ev: KeyDownEvent<VjlinkSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.keyDown();
  }
}
