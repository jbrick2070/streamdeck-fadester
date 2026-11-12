// SPDX-License-Identifier: GPL-2.0-or-later
import {
  action,
  DialRotateEvent,
  DialUpEvent,
  DidReceiveSettingsEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import { mixProblem } from "../obs/whole-mix.js";
import { DirectObsClient } from "../obs/direct-obs-client.js";
import { automaticInputRoleName, migrateAutomaticInputSettings } from "../obs/automatic-targets.js";
import { customCaption } from "../obs/preset-captions.js";
import { LayerController, LayerOperation } from "../control/layer-controller.js";
import {
  DEFAULT_OBS_FADER_DIAL_SETTINGS,
  ObsFaderDialSettings,
  ObsFaderTarget,
  ObsFaderPressAction,
  normalizeAccent,
  normalizeLabelOverride
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import {
  renderDirectDialSvg,
  toStripUri
} from "../gfx/direct-obs-renderer.js";
import { computeDialDelta, normalizeStepPerTick } from "./dial-math.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { StringKey, formatNumber, onLanguageChanged, t, translate } from "../i18n/strings.js";

interface DialFeedbackSink {
  setFeedback(feedback: { canvas: string }): Promise<void>;
  showAlert(): Promise<void>;
}

function normalizeTarget(raw: unknown): ObsFaderTarget {
  if (raw === undefined) return DEFAULT_OBS_FADER_DIAL_SETTINGS.target;
  return raw === "input_volume" || raw === "tbar" || raw === "all_inputs" ? raw : "unconfigured";
}

export class ObsFaderDialInstanceController {
  private settings: Required<ObsFaderDialSettings>;
  private readonly rateLimiter: CellRateLimiter<string>;
  private visible = false;
  /** Unsubscribes this control from language changes (PLAN.md 11.1). */
  private offMix?: () => void;
  private offLanguage: () => void = () => {};
  private lastRotateAt = 0;

  private readonly onStateChanged = (): void => this.renderNow();

  public constructor(
    private readonly client: DirectObsClient,
    private readonly sink: DialFeedbackSink,
    initialSettings?: ObsFaderDialSettings,
    rateLimitMs = 100,
    private readonly layers?: LayerController
  ) {
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = new CellRateLimiter<string>(async (svg) => {
      await this.sink.setFeedback({ canvas: toStripUri(svg) });
    }, rateLimitMs);
  }

  public appear(settings?: ObsFaderDialSettings): void {
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
    if (this.settings.autoQueueNextScene) this.client.cancelSceneCycle();
    this.rateLimiter.dispose();
    this.client.off("statusChanged", this.onStateChanged);
    this.client.off("directStateChanged", this.onStateChanged);
    this.client.off("wholeMixChanged", this.onStateChanged);
    this.syncMixObserver();
  }

  public updateSettings(settings: ObsFaderDialSettings): void {
    if (this.settings.autoQueueNextScene && (settings.autoQueueNextScene !== true || settings.target !== "tbar")) this.client.cancelSceneCycle();
    this.settings = this.mergeSettings(settings);
    this.syncMixObserver();
    this.renderNow();
  }

  public async handleRotate(ticks: number, now = Date.now()): Promise<void> {
    if (!(await this.ensureReady(now))) {
      return;
    }
    if (this.settings.target === "all_inputs") {
      if (!Number.isInteger(ticks) || ticks === 0) return;
      try { await this.client.wholeMix.command(ticks > 0 ? "mix.up" : "mix.down", Math.min(32, Math.abs(ticks))); }
      catch { await this.sink.showAlert(); }
      return;
    }
    const elapsed = this.lastRotateAt > 0 ? now - this.lastRotateAt : 999;
    this.lastRotateAt = now;
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
      if (this.settings.target === "input_volume") {
        await this.client.nudgeInputVolume(this.settings.inputName, delta);
      } else {
        await this.client.nudgeTbar(delta, this.settings.autoQueueNextScene);
      }
    } catch {
      await this.sink.showAlert();
    }
  }

  /** Presses can finish a scene transition or act on the source selected by
   * the deck. Source commands do not require a mixer-input binding. */
  public async handleDialUp(now = Date.now()): Promise<void> {
    const pressAction = this.settings.pressAction;
    if (pressAction === "none") return;
    // Preserve the original default: pressing an audio dial does nothing.
    if (pressAction === "finish_transition" && this.settings.target !== "tbar") return;

    const finishesTransition = pressAction === "finish_transition" || pressAction === "next_blend_and_finish";
    if (finishesTransition) {
      // Validate the entire combined operation before changing a layer.
      if (this.settings.target !== "tbar") {
        await this.sink.showAlert();
        return;
      }
      if (!(await this.ensureReady(now))) return;
      // A combined press changes a layer before it takes: refuse it first when there is nothing to take.
      const catalog = this.client.getCatalog();
      const scenes = this.client.getTbarScenes?.() ?? { live: catalog.currentProgramScene, next: catalog.currentPreviewScene };
      if (pressAction === "next_blend_and_finish" && (!scenes.next || scenes.live === scenes.next)) {
        await this.sink.showAlert();
        return;
      }
    } else if (!(await this.ensureConnected(now))) {
      return;
    }

    const beforePress = { ...this.client.getCatalog() };
    try {
      const operation: LayerOperation | undefined =
        pressAction === "next_blend" || pressAction === "next_blend_and_finish" ? "blend_next" :
          pressAction === "previous_blend" ? "blend_previous" :
            pressAction === "normal_blend" ? "blend_normal" :
              pressAction === "toggle_source" ? "show_hide" : undefined;
      if (operation) {
        if (!this.layers) {
          await this.sink.showAlert();
          return;
        }
        await this.layers.perform(finishesTransition
          ? { scope: "fixed", sceneName: beforePress.currentPreviewScene, target: "selected" }
          : { scope: "auto", target: "selected" }, operation);
      }
      if (finishesTransition) {
        const current = this.client.getCatalog();
        if (!current.studioMode || current.currentPreviewScene !== beforePress.currentPreviewScene ||
          current.currentProgramScene !== beforePress.currentProgramScene) {
          await this.sink.showAlert();
          return;
        }
        await this.client.takeTbar(this.settings.autoQueueNextScene);
      }
    } catch {
      await this.sink.showAlert();
    }
  }

  private async ensureConnected(now: number): Promise<boolean> {
    if (this.client.isConnected()) return true;
    this.client.nudgeReconnect(2000, now);
    await this.sink.showAlert();
    return false;
  }

  private async ensureReady(now: number): Promise<boolean> {
    if (this.settings.target === "unconfigured") {
      await this.sink.showAlert();
      return false;
    }
    if (this.settings.target === "input_volume" && !this.settings.inputName) {
      await this.sink.showAlert();
      return false;
    }
    if (!(await this.ensureConnected(now))) return false;
    if (this.settings.target === "input_volume" && !this.client.resolveInputName(this.settings.inputName)) {
      await this.sink.showAlert();
      return false;
    }
    if (this.settings.target === "tbar" && !this.client.getCatalog().studioMode &&
      !(await this.client.confirmStudioMode?.())) {
      await this.sink.showAlert();
      return false;
    }
    // Live and Next being the same scene is the client's call, made after it has taken up a fade OBS left open: a
    // check here, on Program and Preview as last heard, could refuse the very turn that would close that fade.
    return true;
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
    const catalog = this.client.getCatalog();
    const all = this.settings.target === "all_inputs";
    const configured =
      all || this.settings.target === "tbar" ||
      (this.settings.target === "input_volume" && Boolean(this.settings.inputName));
    const isTbar = this.settings.target === "tbar";
    const tbarScenes = this.client.getTbarScenes?.() ?? { live: catalog.currentProgramScene, next: catalog.currentPreviewScene };
    const inputName = isTbar || all ? "" : this.client.resolveInputName(this.settings.inputName);
    const inputRole = automaticInputRoleName(this.settings.inputName);
    const mix = all ? this.client.wholeMix.state : undefined;
    const value = mix ? (mix.db === null ? 0 : Math.pow(10, mix.db / 20)) : isTbar
      ? catalog.tbarPosition
      : catalog.inputVolumes[inputName] ?? 0;
    // A shipped caption ("Scene blend", "Music") is a default: the dial draws its role instead.
    const customLabel = customCaption("fader", this.settings);
    // The T-bar's own name is a default, not a label: the scene mixer then draws its press hint.
    const label = customLabel ||
      (all ? t("mixAll") : isTbar ? "" : inputName || inputRole || this.settings.inputName || t("faderDefault"));
    const pressHints: Partial<Record<ObsFaderPressAction, StringKey>> = {
      next_blend: "pressNextBlend",
      previous_blend: "pressPreviousBlend",
      normal_blend: "pressNormalBlend",
      toggle_source: "pressShowHide",
      next_blend_and_finish: "pressBlendTake",
      none: "pressDisabled"
    };
    const pressHint = pressHints[this.settings.pressAction];
    this.rateLimiter.push(
      renderDirectDialSvg({
        connected: this.client.isConnected(),
        reason: statusCellReason(this.client.getStatus(), translate),
        label,
        value,
        configured,
        problem: mix ? mixProblem(mix) : !isTbar && configured && !inputName
          ? inputRole ? t("roleUnavailable", { role: inputRole }) : t("audioInputUnavailable") : undefined,
        valueLabel: mix ? t("mixDb", { db: mix.db === null ? "−∞" : formatNumber(mix.db, 1) }) : undefined,
        target: this.settings.target,
        accent: this.settings.accent,
        ...(pressHint ? { pressHint: t(pressHint) } : {}),
        ...(isTbar ? {
          studioMode: catalog.studioMode,
          // An open fade's own scenes: a Preview picked mid-fade is for the next one.
          programSceneName: tbarScenes.live,
          previewSceneName: tbarScenes.next,
          autoQueueNextScene: this.settings.autoQueueNextScene
        } : {})
      })
    );
  }

  private mergeSettings(raw?: ObsFaderDialSettings): Required<ObsFaderDialSettings> {
    const validPressActions: ObsFaderPressAction[] = [
      "finish_transition", "next_blend", "previous_blend", "normal_blend",
      "toggle_source", "next_blend_and_finish", "none"
    ];
    return {
      target: normalizeTarget(raw?.target),
      inputName: typeof raw?.inputName === "string" ? raw.inputName.trim()
        : raw?.inputName === undefined ? DEFAULT_OBS_FADER_DIAL_SETTINGS.inputName : "",
      stepPerTick: normalizeStepPerTick(Number(raw?.stepPerTick)),
      acceleration:
        raw?.acceleration !== undefined
          ? Boolean(raw.acceleration)
          : DEFAULT_OBS_FADER_DIAL_SETTINGS.acceleration,
      labelOverride: normalizeLabelOverride(raw?.labelOverride),
      autoQueueNextScene: raw?.autoQueueNextScene === true,
      pressAction: validPressActions.includes(raw?.pressAction as ObsFaderPressAction)
        ? raw!.pressAction! : DEFAULT_OBS_FADER_DIAL_SETTINGS.pressAction,
      accent: normalizeAccent(raw?.accent)
    };
  }
}

@action({ UUID: "io.github.jbrick2070.fadester-for-obs.obs-fader" })
export class ObsFaderDialAction extends SingletonAction<ObsFaderDialSettings> {
  private readonly instances = new Map<string, ObsFaderDialInstanceController>();

  public constructor(private readonly client: DirectObsClient, private readonly layers?: LayerController) {
    super();
  }

  public override onWillAppear(ev: WillAppearEvent<ObsFaderDialSettings>): void {
    if (!ev.action.isDial()) {
      return;
    }
    const dial = ev.action;
    const settings = migrateAutomaticInputSettings(ev.payload.settings);
    if (settings !== ev.payload.settings) void dial.setSettings(settings);
    // Stream Deck can send willAppear twice for one context: the first controller stops first.
    this.instances.get(dial.id)?.disappear();
    const controller = new ObsFaderDialInstanceController(
      this.client,
      {
        setFeedback: (feedback) => dial.setFeedback(feedback),
        showAlert: () => dial.showAlert()
      },
      settings,
      100,
      this.layers
    );
    this.instances.set(dial.id, controller);
    controller.appear(settings);
  }

  public override onWillDisappear(ev: WillDisappearEvent<ObsFaderDialSettings>): void {
    const controller = this.instances.get(ev.action.id);
    if (controller) {
      controller.disappear();
      this.instances.delete(ev.action.id);
    }
  }

  public override onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<ObsFaderDialSettings>
  ): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }

  public override async onDialRotate(
    ev: DialRotateEvent<ObsFaderDialSettings>
  ): Promise<void> {
    await this.instances.get(ev.action.id)?.handleRotate(ev.payload.ticks);
  }

  public override async onDialUp(ev: DialUpEvent<ObsFaderDialSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.handleDialUp();
  }
}
