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
import {
  DIRECT_SCENE_CURRENT_PREVIEW,
  DIRECT_SCENE_NEXT,
  DIRECT_SCENE_PREVIOUS,
  DIRECT_SCENE_RANDOM,
  DirectObsClient,
  OBS_TRANSITION_CURRENT,
  OBS_TRANSITION_CUT,
  automaticSceneTargetLabel,
  sceneTargetIndex
} from "../obs/direct-obs-client.js";
import { VisualSignals } from "../control/visual-signals.js";
import {
  DEFAULT_SCENE_FALLBACK_MS,
  QuantizedKeyArm
} from "../control/quantized-fade.js";
import {
  DEFAULT_OBS_SCENE_TRANSITION_KEY_SETTINGS,
  ObsSceneOperation,
  ObsSceneTransitionKeySettings,
  normalizeAccent,
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
import { LocalText, errorLocalText, ownText, wordText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { onLanguageChanged, t, translate } from "../i18n/strings.js";
import { customCaption } from "../obs/preset-captions.js";

interface KeyImageSink {
  setImage(image: string): Promise<void>;
  showAlert(): Promise<void>;
}

function normalizeOperation(raw: unknown): ObsSceneOperation {
  return raw === "preview" || raw === "cut" || raw === "transition"
    ? raw
    : DEFAULT_OBS_SCENE_TRANSITION_KEY_SETTINGS.operation;
}

function targetLabel(target: string): string {
  if (target === DIRECT_SCENE_CURRENT_PREVIEW) {
    return t("sceneTargetTakePreview");
  }
  if (target === DIRECT_SCENE_NEXT) {
    return t("sceneTargetNext");
  }
  if (target === DIRECT_SCENE_PREVIOUS) {
    return t("sceneTargetPrevious");
  }
  if (target === DIRECT_SCENE_RANDOM) return t("sceneTargetRandom");
  const automatic = automaticSceneTargetLabel(target);
  if (automatic) return automatic;
  return target;
}

/** Repair only the untouched placeholders shipped in earlier layouts.
 * Explicit scene names and custom labels always keep their existing binding. */
export function migrateScenePresetSettings(
  raw: ObsSceneTransitionKeySettings
): ObsSceneTransitionKeySettings {
  if (raw.presetBindingsVersion === 1) return raw;
  const match = /^Scene\s*([A-D1-4])$/i.exec(String(raw.labelOverride ?? "").trim());
  if (!match) return raw;
  if (typeof raw.sceneTarget === "string" && raw.sceneTarget.trim()) {
    return { ...raw, presetBindingsVersion: 1 };
  }
  const value = match[1].toUpperCase();
  const index = /[1-4]/.test(value) ? Number(value) - 1 : value.charCodeAt(0) - 65;
  return { ...raw, sceneTarget: `__scene_index_${index}__`, presetBindingsVersion: 1 };
}

export class ObsSceneTransitionKeyInstanceController {
  private settings: Required<ObsSceneTransitionKeySettings>;
  private visible = false;
  /** Unsubscribes this control from language changes (PLAN.md 11.1). */
  private offLanguage: () => void = () => {};
  private lastError: LocalText | null = null;
  private readonly rateLimiter: CellRateLimiter<string>;
  private readonly arm: QuantizedKeyArm;
  private readonly clock: () => number;
  private readonly onStateChanged = (): void => {
    if (!this.client.isConnected()) {
      this.arm.cancelSilently();
    }
    this.lastError = null;
    this.renderNow();
  };

  public constructor(
    private readonly client: DirectObsClient,
    private readonly sink: KeyImageSink,
    initialSettings?: ObsSceneTransitionKeySettings,
    rateLimitMs = 100,
    signals?: VisualSignals,
    holdMs: number = DIAL_HOLD_THRESHOLD_MS,
    clock: () => number = Date.now
  ) {
    this.clock = clock;
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = new CellRateLimiter<string>(async (svg) => {
      await this.sink.setImage(toSvgDataUri(svg));
    }, rateLimitMs, clock);
    this.arm = new QuantizedKeyArm(signals, () => this.renderNow(), holdMs, clock);
  }

  public appear(settings?: ObsSceneTransitionKeySettings): void {
    if (settings) {
      this.settings = this.mergeSettings(settings);
    }
    this.visible = true;
    this.offLanguage();
    this.offLanguage = onLanguageChanged(() => this.renderNow());
    this.client.on("statusChanged", this.onStateChanged);
    this.client.on("directStateChanged", this.onStateChanged);
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
  }

  public updateSettings(settings: ObsSceneTransitionKeySettings): void {
    const prev = this.settings;
    this.settings = this.mergeSettings(settings);
    if (
      prev.sceneTarget !== this.settings.sceneTarget ||
      prev.operation !== this.settings.operation ||
      prev.transitionName !== this.settings.transitionName ||
      prev.quantizeBeats !== this.settings.quantizeBeats ||
      prev.quantizeStart !== this.settings.quantizeStart
    ) {
      this.arm.cancelSilently();
    }
    this.lastError = null;
    this.renderNow();
  }

  public async handleKeyDown(now = this.clock()): Promise<void> {
    if (!this.arm.isArmed()) {
      if (!this.settings.sceneTarget) {
        await this.sink.showAlert();
        return;
      }
      if (!this.client.isConnected()) {
        this.client.nudgeReconnect(2000, now);
        await this.sink.showAlert();
        return;
      }
    }

    const canQuantize =
      this.settings.operation === "transition" &&
      this.settings.transitionName !== OBS_TRANSITION_CUT;

    if (!canQuantize) {
      await this.executeSceneAction(undefined);
      return;
    }

    const fallbackMs =
      this.settings.durationMs > 0
        ? this.settings.durationMs
        : this.settings.quantizeBeats > 0
          ? DEFAULT_SCENE_FALLBACK_MS
          : undefined;

    await this.arm.handleKeyDown(
      this.settings.quantizeBeats,
      this.settings.quantizeStart,
      fallbackMs,
      async (effectiveMs) => {
        if (!this.client.isConnected()) return;
        await this.executeSceneAction(effectiveMs);
      },
      now
    );
  }

  public async handleKeyUp(): Promise<void> {
    await this.arm.handleKeyUp();
  }

  private async executeSceneAction(transitionDurationMs: number | undefined): Promise<void> {
    try {
      if (transitionDurationMs !== undefined) {
        await this.client.runSceneAction(
          this.settings.sceneTarget,
          this.settings.operation,
          this.settings.transitionName,
          transitionDurationMs
        );
      } else {
        await this.client.runSceneAction(
          this.settings.sceneTarget,
          this.settings.operation,
          this.settings.transitionName
        );
      }
      this.lastError = null;
    } catch (error) {
      this.lastError = errorLocalText(error, ownText("sceneControlFailed"));
      await this.sink.showAlert();
    }
    this.renderNow();
  }

  private renderNow(): void {
    if (!this.visible) {
      return;
    }
    const configured = Boolean(this.settings.sceneTarget);
    const target = this.settings.sceneTarget;
    const catalog = this.client.getCatalog();
    const isAutomatic = sceneTargetIndex(target) !== undefined;
    // A shipped caption ("Scene 1", "Next scene") is a default: the key draws the live scene or its role.
    const customLabel = customCaption("scene", this.settings);
    let resolved = "";
    let reason = wordText(this.lastError, translate) || statusCellReason(this.client.getStatus(), translate);
    const needsStudio = this.settings.operation === "preview" || target === DIRECT_SCENE_CURRENT_PREVIEW;
    if (this.client.isConnected()) {
      if (needsStudio && !catalog.studioMode) reason = t("sceneEnableStudio");
      else if (target !== DIRECT_SCENE_RANDOM) {
        try { resolved = this.client.resolveSceneTarget(target, this.settings.operation === "preview"); }
        catch (error) { reason = wordText(errorLocalText(error, ownText("sceneUnavailable")), translate); }
        if (configured && !resolved && !reason) reason = t("sceneUnavailable");
      }
    }
    const title = customLabel || resolved || targetLabel(target) || t("sceneTitleFallback");
    // A chosen OBS transition keeps its OBS name; only our own words are translated.
    const operation = this.settings.operation === "preview"
      ? t("sceneOpPreview")
      : this.settings.operation === "cut" || this.settings.transitionName === OBS_TRANSITION_CUT
        ? t("sceneOpCut")
        : this.settings.transitionName === OBS_TRANSITION_CURRENT || !this.settings.transitionName
          ? t("sceneOpTransition")
          : this.settings.transitionName;
    const role = isAutomatic ? t("sceneRoleIndex", { n: sceneTargetIndex(target)! + 1 })
      : target === DIRECT_SCENE_NEXT ? t("sceneRoleNext")
        : target === DIRECT_SCENE_PREVIOUS ? t("sceneRolePrevious")
          : target === DIRECT_SCENE_RANDOM ? t("sceneRoleRandom")
            : target === DIRECT_SCENE_CURRENT_PREVIEW ? t("sceneRoleTake") : "";
    const subtitle = role ? t("sceneSubtitle", { role, operation }) : operation;
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
        connected: this.client.isConnected() && !reason,
        reason,
        title,
        subtitle,
        icon: target === DIRECT_SCENE_RANDOM ? "shuffle"
          : target === DIRECT_SCENE_NEXT ? "next"
            : target === DIRECT_SCENE_PREVIOUS ? "previous"
              : this.settings.operation === "cut" ? "cut"
                : this.settings.operation === "transition" ? "take" : "scene",
        configured,
        accent: this.settings.accent,
        badge
      }),
      this.clock()
    );
  }

  private mergeSettings(
    raw?: ObsSceneTransitionKeySettings
  ): Required<ObsSceneTransitionKeySettings> {
    const rawMs = Number(raw?.durationMs ?? DEFAULT_OBS_SCENE_TRANSITION_KEY_SETTINGS.durationMs);
    const rounded = Math.round(rawMs);
    const durationMs = Number.isFinite(rounded) && rounded > 0
      ? Math.max(50, Math.min(20000, rounded))
      : 0;
    return {
      sceneTarget:
        typeof raw?.sceneTarget === "string" ? raw.sceneTarget.trim() : DEFAULT_OBS_SCENE_TRANSITION_KEY_SETTINGS.sceneTarget,
      operation: normalizeOperation(raw?.operation),
      transitionName:
        typeof raw?.transitionName === "string" && raw.transitionName.trim()
          ? raw.transitionName.trim()
          : OBS_TRANSITION_CURRENT,
      durationMs,
      quantizeBeats: normalizeQuantizeBeats(raw?.quantizeBeats),
      quantizeStart: normalizeQuantizeStart(raw?.quantizeStart),
      labelOverride: normalizeLabelOverride(raw?.labelOverride),
      accent: normalizeAccent(raw?.accent)
    };
  }
}

@action({ UUID: "io.github.jbrick2070.fadester-for-obs.scene-transition" })
export class ObsSceneTransitionKeyAction extends SingletonAction<ObsSceneTransitionKeySettings> {
  private readonly instances = new Map<
    string,
    ObsSceneTransitionKeyInstanceController
  >();

  public constructor(
    private readonly client: DirectObsClient,
    private readonly signals?: VisualSignals
  ) {
    super();
  }

  public override async onWillAppear(
    ev: WillAppearEvent<ObsSceneTransitionKeySettings>
  ): Promise<void> {
    if (!ev.action.isKey()) {
      return;
    }
    const key = ev.action;
    const settings = migrateScenePresetSettings(ev.payload.settings);
    // Stream Deck can send willAppear twice for one context: the first controller stops first.
    this.instances.get(key.id)?.disappear();
    const controller = new ObsSceneTransitionKeyInstanceController(
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
    if (settings !== ev.payload.settings) await key.setSettings(settings);
  }

  public override onWillDisappear(
    ev: WillDisappearEvent<ObsSceneTransitionKeySettings>
  ): void {
    const controller = this.instances.get(ev.action.id);
    if (controller) {
      controller.disappear();
      this.instances.delete(ev.action.id);
    }
  }

  public override onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<ObsSceneTransitionKeySettings>
  ): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }

  public override async onKeyDown(
    ev: KeyDownEvent<ObsSceneTransitionKeySettings>
  ): Promise<void> {
    await this.instances.get(ev.action.id)?.handleKeyDown();
  }

  public override async onKeyUp(
    ev: KeyUpEvent<ObsSceneTransitionKeySettings>
  ): Promise<void> {
    await this.instances.get(ev.action.id)?.handleKeyUp();
  }
}
