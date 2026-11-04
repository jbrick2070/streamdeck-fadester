// SPDX-License-Identifier: GPL-2.0-or-later
import {
  action, DialRotateEvent, DialUpEvent, DidReceiveSettingsEvent, KeyDownEvent,
  SingletonAction, TouchTapEvent, WillAppearEvent, WillDisappearEvent
} from "@elgato/streamdeck";
import { BLEND_MODES, LayerController, LayerOperation, LayerSettings, matchesLayerIdentity, normalizeLayerSettings } from "../control/layer-controller.js";
import { toStripUri, toSvgDataUri } from "../gfx/svg-renderer.js";
import { accentColor, boxText, renderDirectKeySvg } from "../gfx/direct-obs-renderer.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { PLAYLISTER_PALETTE as P } from "../../packages/streamdeck-fadester-shared/src/palette.js";
import { LocalText, errorLocalText, ownText, wordText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { StringKey, onLanguageChanged, t, translate } from "../i18n/strings.js";
import { customCaption } from "../obs/preset-captions.js";

/** The key title of each operation, by key. */
export const LAYER_OPERATION_LABELS: Record<LayerOperation, StringKey> = {
  select_next: "layerOpNextSource", select_previous: "layerOpPreviousSource", move_up: "layerOpUp",
  move_down: "layerOpDown", show_hide: "layerOpShowHide", blend_next: "layerOpNextBlend",
  blend_previous: "layerOpPreviousBlend", blend_normal: "layerOpNormalBlend"
};
interface LayerSink {
  render(svg: string): Promise<void>;
  showAlert(): Promise<void>;
}

export class ObsLayerInstanceController {
  private settings: Required<LayerSettings>;
  private unwatch: (() => void) | undefined;
  private readonly limiter: CellRateLimiter<string>;
  private lastError: LocalText | null = null;
  private visible = false;
  /** Unsubscribes this control from language changes (PLAN.md 11.1). */
  private offLanguage: () => void = () => {};
  private readonly onChanged = (): void => {
    if (this.layers.client.isConnected() && !this.layers.getScene(this.settings).error) this.lastError = null;
    this.render();
  };

  public constructor(
    private readonly layers: LayerController,
    private readonly sink: LayerSink,
    private readonly dial: boolean,
    settings?: LayerSettings
  ) {
    this.settings = normalizeLayerSettings(settings);
    this.limiter = new CellRateLimiter((svg) => sink.render(svg), 100);
  }

  public appear(): void {
    this.visible = true;
    this.offLanguage();
    this.offLanguage = onLanguageChanged(() => this.render());
    this.layers.on("changed", this.onChanged);
    this.layers.client.on("statusChanged", this.onChanged);
    this.layers.client.on("directStateChanged", this.onChanged);
    this.unwatch = this.layers.watch(this.settings);
    this.render();
  }

  public disappear(): void {
    this.visible = false;
    this.offLanguage();
    this.offLanguage = () => {};
    this.unwatch?.();
    this.layers.off("changed", this.onChanged);
    this.layers.client.off("statusChanged", this.onChanged);
    this.layers.client.off("directStateChanged", this.onChanged);
    this.limiter.dispose();
  }

  public updateSettings(settings: LayerSettings): void {
    this.unwatch?.();
    this.settings = normalizeLayerSettings(settings);
    this.lastError = null;
    if (this.visible) this.unwatch = this.layers.watch(this.settings);
    this.render();
  }

  public async press(): Promise<void> {
    const operation = this.dial ? (this.settings.dialMode === "blend" ? "blend_normal" : "show_hide") : this.settings.operation;
    await this.perform(operation);
  }

  public async rotate(ticks: number): Promise<void> {
    if (!Number.isFinite(ticks) || ticks === 0) return;
    const forward = ticks > 0;
    const operation = this.settings.dialMode === "blend" ? (forward ? "blend_next" : "blend_previous") :
      this.settings.dialMode === "order" ? (forward ? "move_up" : "move_down") :
        forward ? "select_next" : "select_previous";
    await this.perform(operation, Math.abs(ticks));
  }

  private async perform(operation: LayerOperation, steps = 1): Promise<void> {
    try {
      await this.layers.perform(this.dial && this.settings.dialMode === "select_layer"
        ? { ...this.settings, target: "selected" } : this.settings, operation, steps);
      this.lastError = null;
    } catch (error) {
      this.lastError = errorLocalText(error, ownText("layerControlFailed"));
      if (!this.layers.client.isConnected()) this.layers.client.nudgeReconnect();
      await this.sink.showAlert();
    }
    this.render();
  }

  private render(): void {
    if (!this.visible) return;
    const state = this.layers.getScene(this.settings);
    const fixedTarget = this.settings.target === "fixed" && (!this.dial || this.settings.dialMode !== "select_layer");
    const id = fixedTarget
      ? this.settings.sceneItemId : state.selectedId;
    const layer = state.layers.find((entry) => entry.sceneItemId === id &&
      (!fixedTarget || matchesLayerIdentity(entry, this.settings)));
    const reason = wordText(this.lastError ?? state.error, translate) ||
      statusCellReason(this.layers.client.getStatus(), translate);
    const connected = this.layers.client.isConnected();
    const loaded = Boolean(this.layers.getCatalog()[state.sceneName]);
    const missingSource = t(!connected ? "layerConnectObs" : !state.sceneName ? "layerChooseScene" :
      !loaded ? "layerLoading" : fixedTarget && this.settings.sceneItemId >= 0 && !layer ? "layerFixedUnavailable" :
        state.layers.length ? "layerChooseSource" : "layerNoSources");
    const name = layer ? layer.sourceName || t("sourceFallback") : missingSource;
    const blend = t(BLEND_MODES.find((entry) => entry.id === layer?.blendMode)?.label ?? "blendNormal");
    const operationLabel = t(LAYER_OPERATION_LABELS[this.settings.operation]);
    const shownState = t(layer?.enabled ? "layerShown" : "layerHidden");
    if (!this.dial) {
      const operation = this.settings.operation;
      const icon = operation === "select_next" ? "source-next" : operation === "select_previous" ? "source-previous" :
        operation === "move_up" ? "layer-up" : operation === "move_down" ? "layer-down" :
          operation === "blend_normal" ? "reset" : operation.startsWith("blend_") ? "blend" : layer?.enabled ? "hide" : "show";
      this.limiter.push(renderDirectKeySvg({
        connected: connected && !reason,
        configured: true,
        reason,
        icon,
        accent: this.settings.accent,
        // A shipped caption ("Prev source") is a default: the key draws its translated operation.
        title: customCaption("layerKey", this.settings) || operationLabel,
        subtitle: layer ? t("layerKeySubtitle", { state: operation.startsWith("blend_") ? blend : shownState, source: name }) : missingSource,
        ...(!layer && connected ? { problem: missingSource } : {})
      }));
      return;
    }
    const index = state.layers.findIndex((entry) => entry.sceneItemId === id);
    const modeLabel = this.settings.dialMode === "blend" ? t("layerBlendMode", { mode: blend }) :
      this.settings.dialMode === "order" ? t(this.settings.allowReorder ? "layerTurnReorder" : "layerReorderDisabled") :
        t("layerPosition", { i: index + 1, n: state.layers.length, state: shownState });
    const catalog = this.layers.client.getCatalog();
    const live = state.sceneName === catalog.currentProgramScene;
    const preview = catalog.studioMode && state.sceneName === catalog.currentPreviewScene;
    const sceneRole = t(live ? "layerRoleLive" : preview ? "layerRolePreview" : "layerRoleScene");
    const footer = t(layer ? this.settings.dialMode === "blend" ? "pressNormalBlend" : "pressShowHide" :
      !connected ? "layerFooterConnect" : !state.sceneName ? "layerFooterChooseScene" : !loaded ? "layerFooterWaiting" :
        !state.layers.length ? "layerFooterAddSources" : this.settings.dialMode === "select_layer" ? "layerFooterBrowse" :
          this.settings.target === "fixed" ? "layerFooterChooseSource" : "layerFooterSelectOnDeck");
    // Each row is fitted to the dial's 176 px by width (R-I18N-4).
    const header = boxText(state.sceneName ? t("layerHeader", { role: sceneRole, scene: state.sceneName }) : t("layerHeaderNone"), 11, 176);
    const sourceText = boxText(name, 16, 176);
    const statusText = boxText(reason || (layer ? modeLabel : missingSource), 13, 176);
    const footerText = boxText(footer, 10, 176);
    this.limiter.push([
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">',
      `<defs><linearGradient id="layerBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P.bgTop}"/><stop offset="100%" stop-color="${P.bgBottom}"/></linearGradient></defs>`,
      `<rect x="2" y="2" width="196" height="96" rx="11" fill="url(#layerBg)" stroke="${reason || !layer ? P.accentYellow : accentColor(this.settings.accent)}" stroke-width="3"/>`,
      `<text x="100" y="22" text-anchor="middle" fill="${live ? P.programRed : preview ? P.previewGreen : accentColor(this.settings.accent)}" ${header.attrs}>${header.text}</text>`,
      `<text x="100" y="47" text-anchor="middle" fill="${P.whiteGlyph}" ${sourceText.attrs} font-weight="700">${sourceText.text}</text>`,
      `<text x="100" y="69" text-anchor="middle" fill="${reason || !layer ? P.accentYellow : P.mutedText}" ${statusText.attrs}>${statusText.text}</text>`,
      `<text x="100" y="89" text-anchor="middle" fill="${P.accentYellow}" ${footerText.attrs}>${footerText.text}</text>`,
      '</svg>'
    ].join(""));
  }
}

@action({ UUID: "io.github.jbrick2070.fadester-for-obs.layer-control" })
export class ObsLayerControlAction extends SingletonAction<LayerSettings> {
  private readonly instances = new Map<string, ObsLayerInstanceController>();
  public constructor(private readonly layers: LayerController) { super(); }

  public override onWillAppear(ev: WillAppearEvent<LayerSettings>): void {
    const control = ev.action;
    const dial = control.isDial();
    if (!dial && !control.isKey()) return;
    // Stream Deck can send willAppear twice for one context: the first controller stops first.
    this.instances.get(control.id)?.disappear();
    const controller = new ObsLayerInstanceController(this.layers, {
      render: (svg) => control.isDial() ? control.setFeedback({ canvas: toStripUri(svg) }) :
        control.isKey() ? control.setImage(toSvgDataUri(svg)) : Promise.resolve(),
      showAlert: () => control.showAlert()
    }, dial, ev.payload.settings);
    this.instances.set(control.id, controller);
    controller.appear();
  }
  public override onWillDisappear(ev: WillDisappearEvent<LayerSettings>): void {
    this.instances.get(ev.action.id)?.disappear();
    this.instances.delete(ev.action.id);
  }
  public override onDidReceiveSettings(ev: DidReceiveSettingsEvent<LayerSettings>): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }
  public override async onKeyDown(ev: KeyDownEvent<LayerSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.press();
  }
  public override async onDialUp(ev: DialUpEvent<LayerSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.press();
  }
  public override async onTouchTap(ev: TouchTapEvent<LayerSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.press();
  }
  public override async onDialRotate(ev: DialRotateEvent<LayerSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.rotate(ev.payload.ticks);
  }
}
