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
import { DirectObsClient } from "../obs/direct-obs-client.js";
import { automaticInputLabel, isAutomaticInputPresetLabel, migrateAutomaticInputSettings } from "../obs/automatic-targets.js";
import { LayerController, LayerOperation } from "../control/layer-controller.js";
import {
  DEFAULT_OBS_FADER_DIAL_SETTINGS,
  ObsFaderDialSettings,
  ObsFaderTarget,
  ObsFaderPressAction,
  normalizeLabelOverride
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import {
  renderDirectDialSvg,
  toSvgDataUri
} from "../gfx/direct-obs-renderer.js";
import { computeDialDelta, normalizeStepPerTick } from "./dial-math.js";

interface DialFeedbackSink {
  setFeedback(feedback: { canvas: string }): Promise<void>;
  showAlert(): Promise<void>;
}

function normalizeTarget(raw: unknown): ObsFaderTarget {
  if (raw === undefined) return DEFAULT_OBS_FADER_DIAL_SETTINGS.target;
  return raw === "input_volume" || raw === "tbar" ? raw : "unconfigured";
}

export class ObsFaderDialInstanceController {
  private settings: Required<ObsFaderDialSettings>;
  private readonly rateLimiter: CellRateLimiter<string>;
  private visible = false;
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
      await this.sink.setFeedback({ canvas: toSvgDataUri(svg) });
    }, rateLimitMs);
  }

  public appear(settings?: ObsFaderDialSettings): void {
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
    if (this.settings.autoQueueNextScene) this.client.cancelSceneCycle();
    this.rateLimiter.dispose();
    this.client.off("statusChanged", this.onStateChanged);
    this.client.off("directStateChanged", this.onStateChanged);
  }

  public updateSettings(settings: ObsFaderDialSettings): void {
    if (this.settings.autoQueueNextScene && (settings.autoQueueNextScene !== true || settings.target !== "tbar")) this.client.cancelSceneCycle();
    this.settings = this.mergeSettings(settings);
    this.renderNow();
  }

  public async handleRotate(ticks: number, now = Date.now()): Promise<void> {
    if (!(await this.ensureReady(now))) {
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
        await this.client.setTbarPosition(1, true, this.settings.autoQueueNextScene);
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
    if (this.settings.target === "tbar" && !this.client.getCatalog().studioMode) {
      await this.sink.showAlert();
      return false;
    }
    const catalog = this.client.getCatalog();
    if (this.settings.target === "tbar" && catalog.currentProgramScene === catalog.currentPreviewScene) {
      await this.sink.showAlert();
      return false;
    }
    return true;
  }

  private renderNow(): void {
    if (!this.visible) {
      return;
    }
    const catalog = this.client.getCatalog();
    const configured =
      this.settings.target === "tbar" ||
      (this.settings.target === "input_volume" && Boolean(this.settings.inputName));
    const isTbar = this.settings.target === "tbar";
    const inputName = isTbar ? "" : this.client.resolveInputName(this.settings.inputName);
    const inputRole = automaticInputLabel(this.settings.inputName)?.replace(" (automatic)", "");
    const value = isTbar
      ? catalog.tbarPosition
      : catalog.inputVolumes[inputName] ?? 0;
    const customLabel = isAutomaticInputPresetLabel(this.settings.inputName, this.settings.labelOverride) ? "" : this.settings.labelOverride;
    const label = customLabel ||
      (isTbar ? "Scene transition" : inputName || inputRole || this.settings.inputName || "OBS fader");
    const pressHints: Partial<Record<ObsFaderPressAction, string>> = {
      next_blend: "Press: next blend",
      previous_blend: "Press: previous blend",
      normal_blend: "Press: Normal blend",
      toggle_source: "Press: show / hide",
      next_blend_and_finish: "Press: blend + take Next live",
      none: "Press disabled"
    };
    this.rateLimiter.push(
      renderDirectDialSvg({
        connected: this.client.isConnected(),
        reason: this.client.getStatus().cellReason,
        label,
        value,
        configured,
        ...(!isTbar && configured && !inputName ? { problem: inputRole ? `${inputRole} unavailable` : "Audio input unavailable" } : {}),
        target: this.settings.target,
        ...(pressHints[this.settings.pressAction] ? { pressHint: pressHints[this.settings.pressAction] } : {}),
        ...(isTbar ? {
          studioMode: catalog.studioMode,
          programSceneName: catalog.currentProgramScene,
          previewSceneName: catalog.currentPreviewScene,
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
        ? raw!.pressAction! : DEFAULT_OBS_FADER_DIAL_SETTINGS.pressAction
    };
  }
}

@action({ UUID: "com.jbrick2070.fadester-for-obs.obs-fader" })
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
