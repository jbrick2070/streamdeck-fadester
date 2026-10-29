// SPDX-License-Identifier: GPL-2.0-or-later
import {
  action, DialRotateEvent, DialUpEvent, DidReceiveSettingsEvent, KeyDownEvent,
  SingletonAction, TouchTapEvent, WillAppearEvent, WillDisappearEvent
} from "@elgato/streamdeck";
import { BLEND_MODES, LayerController, LayerOperation, LayerSettings, matchesLayerIdentity, normalizeLayerSettings } from "../control/layer-controller.js";
import { escapeXml, toSvgDataUri, truncateLabel } from "../gfx/svg-renderer.js";
import { renderDirectKeySvg, textFitAttributes } from "../gfx/direct-obs-renderer.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { PLAYLISTER_PALETTE as P } from "../../packages/streamdeck-fadester-shared/src/palette.js";

export const LAYER_OPERATION_LABELS: Record<LayerOperation, string> = {
  select_next: "Next source", select_previous: "Previous source", move_up: "Layer up",
  move_down: "Layer down", show_hide: "Show / hide", blend_next: "Next blend",
  blend_previous: "Previous blend", blend_normal: "Normal blend"
};
interface LayerSink {
  render(svg: string): Promise<void>;
  showAlert(): Promise<void>;
}

export class ObsLayerInstanceController {
  private settings: Required<LayerSettings>;
  private unwatch: (() => void) | undefined;
  private readonly limiter: CellRateLimiter<string>;
  private lastError = "";
  private visible = false;
  private readonly onChanged = (): void => {
    if (this.layers.client.isConnected() && !this.layers.getScene(this.settings).error) this.lastError = "";
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
    this.layers.on("changed", this.onChanged);
    this.layers.client.on("statusChanged", this.onChanged);
    this.layers.client.on("directStateChanged", this.onChanged);
    this.unwatch = this.layers.watch(this.settings);
    this.render();
  }

  public disappear(): void {
    this.visible = false;
    this.unwatch?.();
    this.layers.off("changed", this.onChanged);
    this.layers.client.off("statusChanged", this.onChanged);
    this.layers.client.off("directStateChanged", this.onChanged);
    this.limiter.dispose();
  }

  public updateSettings(settings: LayerSettings): void {
    this.unwatch?.();
    this.settings = normalizeLayerSettings(settings);
    this.lastError = "";
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
      this.lastError = "";
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "OBS control failed.";
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
    const reason = this.lastError || state.error || this.layers.client.getStatus().cellReason;
    const connected = this.layers.client.isConnected();
    const loaded = Boolean(this.layers.getCatalog()[state.sceneName]);
    const missingSource = !connected ? "Connect OBS" : !state.sceneName ? "Choose a scene" :
      !loaded ? "Loading sources…" : fixedTarget && this.settings.sceneItemId >= 0 && !layer ? "Fixed source unavailable" :
        state.layers.length ? "Choose a source" : "No sources in scene";
    const name = layer?.sourceName || missingSource;
    const blend = BLEND_MODES.find((entry) => entry.id === layer?.blendMode)?.label || "Normal";
    const operationLabel = LAYER_OPERATION_LABELS[this.settings.operation];
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
        title: this.settings.labelOverride || operationLabel,
        subtitle: layer ? `${operation.startsWith("blend_") ? blend : layer.enabled ? "Shown" : "Hidden"} · ${name}` : missingSource,
        ...(!layer && connected ? { problem: missingSource } : {})
      }));
      return;
    }
    const index = state.layers.findIndex((entry) => entry.sceneItemId === id);
    const modeLabel = this.settings.dialMode === "blend" ? `Blend: ${blend}` :
      this.settings.dialMode === "order" ? (this.settings.allowReorder ? "Turn: reorder layers" : "Reorder is disabled") :
        `${index + 1} / ${state.layers.length} · ${layer?.enabled ? "Shown" : "Hidden"}`;
    const catalog = this.layers.client.getCatalog();
    const live = state.sceneName === catalog.currentProgramScene;
    const preview = catalog.studioMode && state.sceneName === catalog.currentPreviewScene;
    const sceneRole = live ? "LIVE" : preview ? "PREVIEW" : "SCENE";
    const footer = layer ? this.settings.dialMode === "blend" ? "Press: Normal blend" : "Press: show / hide" :
      !connected ? "Connect OBS to control" : !state.sceneName ? "Choose scene in inspector" : !loaded ? "Waiting for OBS sources" :
        !state.layers.length ? "Add sources in OBS" : this.settings.dialMode === "select_layer" ? "Turn to browse sources" :
          this.settings.target === "fixed" ? "Choose source in inspector" : "Select a source on the deck";
    const header = truncateLabel(state.sceneName ? `${sceneRole}: ${state.sceneName}` : "OBS SOURCES", 30);
    const sourceText = truncateLabel(name, 22);
    const statusText = truncateLabel(reason || (layer ? modeLabel : missingSource), 27);
    const footerText = truncateLabel(footer, 30);
    this.limiter.push([
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">',
      `<defs><linearGradient id="layerBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P.bgTop}"/><stop offset="100%" stop-color="${P.bgBottom}"/></linearGradient></defs>`,
      `<rect x="2" y="2" width="196" height="96" rx="11" fill="url(#layerBg)" stroke="${reason || !layer ? P.accentYellow : P.accentPurple}" stroke-width="3"/>`,
      `<text x="100" y="22" text-anchor="middle" fill="${live ? P.programRed : preview ? P.previewGreen : P.accentPurple}" font-family="Segoe UI,Arial,sans-serif" font-size="11" ${textFitAttributes(header, 176, 11)}>${escapeXml(header)}</text>`,
      `<text x="100" y="47" text-anchor="middle" fill="${P.whiteGlyph}" font-family="Segoe UI,Arial,sans-serif" font-size="16" font-weight="700" ${textFitAttributes(sourceText, 176, 16)}>${escapeXml(sourceText)}</text>`,
      `<text x="100" y="69" text-anchor="middle" fill="${reason || !layer ? P.accentYellow : P.mutedText}" font-family="Segoe UI,Arial,sans-serif" font-size="13" ${textFitAttributes(statusText, 176, 13)}>${escapeXml(statusText)}</text>`,
      `<text x="100" y="89" text-anchor="middle" fill="${P.accentYellow}" font-family="Segoe UI,Arial,sans-serif" font-size="10" ${textFitAttributes(footerText, 176, 10)}>${escapeXml(footerText)}</text>`,
      '</svg>'
    ].join(""));
  }
}

@action({ UUID: "com.jbrick2070.fadester-for-obs.layer-control" })
export class ObsLayerControlAction extends SingletonAction<LayerSettings> {
  private readonly instances = new Map<string, ObsLayerInstanceController>();
  public constructor(private readonly layers: LayerController) { super(); }

  public override onWillAppear(ev: WillAppearEvent<LayerSettings>): void {
    const control = ev.action;
    const dial = control.isDial();
    if (!dial && !control.isKey()) return;
    const controller = new ObsLayerInstanceController(this.layers, {
      render: (svg) => control.isDial() ? control.setFeedback({ canvas: toSvgDataUri(svg) }) :
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
