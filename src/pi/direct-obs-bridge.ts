// SPDX-License-Identifier: GPL-2.0-or-later
import { DirectObsClient } from "../obs/direct-obs-client.js";
import { resolveAutomaticInputName } from "../obs/automatic-targets.js";
import { LayerController, LayerSettings } from "../control/layer-controller.js";
import { READY_LAYOUTS } from "../types/layouts.js";
import {
  DEFAULT_GLOBAL_SETTINGS,
  FadesterGlobalSettings
} from "../types/settings.js";

export interface DirectPiIncomingMessage {
  [key: string]: unknown;
  event?: string;
  host?: string;
  port?: number | string;
  password?: string;
}

export interface DirectPiTransport {
  sendToPropertyInspector(payload: Record<string, unknown>): void;
  persistGlobalSettings(settings: FadesterGlobalSettings): Promise<void>;
  getDeviceType?(): number | undefined;
  activateLayout?(slug: string): Promise<void>;
}

/**
 * Separate bridge and event namespace for the primary Direct OBS inspectors.
 * It never sends the stored OBS password back to a browser inspector.
 */
export class DirectObsPropertyInspectorBridge {
  private connectionQueue: Promise<void> = Promise.resolve();
  public constructor(
    private readonly client: DirectObsClient,
    private readonly transport: DirectPiTransport,
    private readonly layers?: LayerController
  ) {
    client.on("statusChanged", () => this.broadcast());
    client.on("directStateChanged", () => this.broadcast());
    layers?.on("changed", () => this.broadcast());
  }

  public broadcast(): void {
    const status = this.client.getStatus();
    const settings = this.client.getSettings();
    const catalog = this.client.getCatalog();
    const audioInputs = Object.keys(catalog.inputVolumes);
    this.transport.sendToPropertyInspector({
      event: "directObsState",
      status: {
        kind: status.kind,
        sentence: status.sentence,
        cellReason: status.cellReason,
        obsVersion: status.obsVersion ?? ""
      },
      connection: {
        host: settings.host,
        port: settings.port,
        passwordSet: settings.password.length > 0
      },
      catalog,
      automaticInputs: Object.fromEntries(["__audio_main__", "__audio_mic__", "__audio_aux__", "__audio_input_2__"]
        .map((target) => [target, resolveAutomaticInputName(target, audioInputs)])),
      layerScenes: this.layers?.getCatalog() ?? {},
      layouts: READY_LAYOUTS.filter((layout) => layout.deviceType === this.transport.getDeviceType?.())
    });
  }

  /** Returns true only when the message belongs to a direct-OBS inspector. */
  public async handleMessage(payload: DirectPiIncomingMessage | undefined): Promise<boolean> {
    const msg = payload ?? {};
    switch (msg.event) {
      case "directPiReady":
        this.broadcast();
        return true;
      case "directUpdateGlobalSettings":
        await this.queueConnection(() => this.updateGlobalSettings(msg));
        return true;
      case "directTestConnection":
        await this.queueConnection(() => this.testConnection());
        return true;
      case "directRefreshCatalog":
        if (this.client.isConnected()) {
          await this.client.refreshCatalog();
        }
        this.broadcast();
        return true;
      case "directLayerCatalog":
        try {
          await this.layers?.refresh(msg as LayerSettings);
        } catch {
          // The layer catalog carries the OBS error beside its target picker.
        }
        this.broadcast();
        return true;
      case "directSelectLayer":
        try {
          await this.layers?.selectLayer(String(msg.sceneName ?? ""), Number(msg.sceneItemId));
        } catch {
          // Source lists and selected ID are refreshed in the inspector.
        }
        this.broadcast();
        return true;
      case "directActivateLayout": {
        const layout = READY_LAYOUTS.find((entry) => entry.slug === msg.slug);
        if (layout && layout.deviceType === this.transport.getDeviceType?.() && this.transport.activateLayout) {
          try {
            if (layout.obsMode === "studio") {
              if (msg.prepareStudio === true) await this.client.prepareStudioLayout();
              else if (!this.client.getCatalog().studioMode) {
                throw new Error("Use Enable Studio Mode & open layout to prepare this desk.");
              }
            }
            await this.transport.activateLayout(layout.slug);
            this.transport.sendToPropertyInspector({ event: "directSetupResult", ok: true });
          } catch (error) {
            this.sendSetupError(error);
          }
        }
        return true;
      }
      case "directPrepareStudio":
        try {
          await this.client.prepareStudioLayout();
          this.broadcast();
          this.transport.sendToPropertyInspector({ event: "directSetupResult", ok: true });
        } catch (error) {
          this.sendSetupError(error);
        }
        return true;
      default:
        return false;
    }
  }

  private sendSetupError(error: unknown): void {
    this.transport.sendToPropertyInspector({
      event: "directSetupResult", ok: false,
      error: error instanceof Error ? error.message : "Could not prepare this OBS layout."
    });
  }

  private async updateGlobalSettings(msg: DirectPiIncomingMessage): Promise<void> {
    const current = this.client.getSettings();
    const next: FadesterGlobalSettings = {
      host:
        typeof msg.host === "string" && msg.host.trim()
          ? msg.host.trim()
          : DEFAULT_GLOBAL_SETTINGS.host,
      port: Number(msg.port ?? DEFAULT_GLOBAL_SETTINGS.port),
      // A password only reaches this bridge if the operator typed it locally.
      password: typeof msg.password === "string" ? msg.password : current.password
    };
    await this.transport.persistGlobalSettings(next);
    this.client.updateSettings(next);
    this.broadcast();
  }

  private async testConnection(): Promise<void> {
    if (this.client.isConnected()) {
      await this.client.refreshCatalog();
    } else {
      this.client.reconnectNow();
    }
    this.broadcast();
  }

  private queueConnection(run: () => Promise<void>): Promise<void> {
    const task = this.connectionQueue.catch(() => {}).then(run);
    this.connectionQueue = task;
    return task;
  }
}
