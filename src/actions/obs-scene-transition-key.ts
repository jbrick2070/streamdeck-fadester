// SPDX-License-Identifier: GPL-2.0-or-later
import {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
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
import {
  DEFAULT_OBS_SCENE_TRANSITION_KEY_SETTINGS,
  ObsSceneOperation,
  ObsSceneTransitionKeySettings,
  normalizeLabelOverride
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import {
  renderDirectKeySvg,
  toSvgDataUri
} from "../gfx/direct-obs-renderer.js";
import { LocalText, errorLocalText, ownText, wordText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { t, translate } from "../i18n/strings.js";

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
  private lastError: LocalText | null = null;
  private readonly rateLimiter: CellRateLimiter<string>;
  private readonly onStateChanged = (): void => {
    this.lastError = null;
    this.renderNow();
  };

  public constructor(
    private readonly client: DirectObsClient,
    private readonly sink: KeyImageSink,
    initialSettings?: ObsSceneTransitionKeySettings,
    rateLimitMs = 100
  ) {
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = new CellRateLimiter<string>(async (svg) => {
      await this.sink.setImage(toSvgDataUri(svg));
    }, rateLimitMs);
  }

  public appear(settings?: ObsSceneTransitionKeySettings): void {
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

  public updateSettings(settings: ObsSceneTransitionKeySettings): void {
    this.settings = this.mergeSettings(settings);
    this.lastError = null;
    this.renderNow();
  }

  public async handleKeyDown(now = Date.now()): Promise<void> {
    if (!this.settings.sceneTarget) {
      await this.sink.showAlert();
      return;
    }
    if (!this.client.isConnected()) {
      this.client.nudgeReconnect(2000, now);
      await this.sink.showAlert();
      return;
    }
    try {
      await this.client.runSceneAction(
        this.settings.sceneTarget,
        this.settings.operation,
        this.settings.transitionName
      );
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
    const generatedLabel = /^Scene\s*[A-D1-4]$/i.test(this.settings.labelOverride);
    const generatedRoleLabel = target === DIRECT_SCENE_NEXT && ["Next scene", "Cut next"].includes(this.settings.labelOverride)
      || target === DIRECT_SCENE_PREVIOUS && ["Prev scene", "Cut previous"].includes(this.settings.labelOverride)
      || target === DIRECT_SCENE_CURRENT_PREVIEW && ["Cut preview", "Transition"].includes(this.settings.labelOverride)
      || target === DIRECT_SCENE_RANDOM && this.settings.labelOverride === "Random";
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
    const title = this.settings.labelOverride && !(isAutomatic && generatedLabel) && !generatedRoleLabel
      ? this.settings.labelOverride
      : resolved || targetLabel(target) || t("sceneTitleFallback");
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
        configured
      })
    );
  }

  private mergeSettings(
    raw?: ObsSceneTransitionKeySettings
  ): Required<ObsSceneTransitionKeySettings> {
    return {
      sceneTarget:
        typeof raw?.sceneTarget === "string" ? raw.sceneTarget.trim() : DEFAULT_OBS_SCENE_TRANSITION_KEY_SETTINGS.sceneTarget,
      operation: normalizeOperation(raw?.operation),
      transitionName:
        typeof raw?.transitionName === "string" && raw.transitionName.trim()
          ? raw.transitionName.trim()
          : OBS_TRANSITION_CURRENT,
      labelOverride: normalizeLabelOverride(raw?.labelOverride)
    };
  }
}

@action({ UUID: "com.jbrick2070.fadester-for-obs.scene-transition" })
export class ObsSceneTransitionKeyAction extends SingletonAction<ObsSceneTransitionKeySettings> {
  private readonly instances = new Map<
    string,
    ObsSceneTransitionKeyInstanceController
  >();

  public constructor(private readonly client: DirectObsClient) {
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
    const controller = new ObsSceneTransitionKeyInstanceController(
      this.client,
      {
        setImage: (image) => key.setImage(image),
        showAlert: () => key.showAlert()
      },
      settings
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
}
