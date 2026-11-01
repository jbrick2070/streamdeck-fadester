// SPDX-License-Identifier: GPL-2.0-or-later
import { DirectObsClient, DirectObsError } from "../obs/direct-obs-client.js";
import { resolveAutomaticInputName } from "../obs/automatic-targets.js";
import { LayerController, LayerSettings } from "../control/layer-controller.js";
import { READY_LAYOUTS, readyLayoutName } from "../types/layouts.js";
import { errorText, ownText, wordText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { statusCellReason, statusSentence } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { translate } from "../i18n/strings.js";
import { findOwner, isDeniedSetting, tableSettings } from "../obs/filter-ranges.js";
import { filterSettingName } from "../actions/obs-filter-control.js";
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

/** A filter as the OBS Filter inspector lists it: its writable numeric settings, the table's first. */
export interface InspectorFilterSetting {
  setting: string;
  /** The deck's word for a table setting, or the setting's own name. */
  label: string;
  value: number;
  table: boolean;
  /** Who else drives it: a sibling Audio Modulator's name, or "" when its own Parameter Fader does. */
  owner?: string;
}

export interface InspectorFilter {
  filterName: string;
  filterKind: string;
  filterEnabled: boolean;
  settings: InspectorFilterSetting[];
}

export interface InspectorFilterCatalog {
  filters: InspectorFilter[];
  /** Why the list could not be read (an OBS text verbatim, ours worded). */
  error: string;
}

/**
 * The filters on one source with the settings the deck may write: numbers only,
 * never a denied one, the range table's first (PLAN.md 10.5). Read by UUID.
 */
export async function readInspectorFilters(client: DirectObsClient, sourceUuid: string): Promise<InspectorFilter[]> {
  const list = await client.getSourceFilterList(sourceUuid);
  const defaults: Record<string, Record<string, unknown>> = {};
  for (const kind of new Set(list.map((filter) => filter.filterKind))) {
    try {
      defaults[kind] = await client.getSourceFilterDefaultSettings(kind);
    } catch {
      defaults[kind] = {};
    }
  }
  return list.map((filter) => {
    const merged = { ...(defaults[filter.filterKind] ?? {}), ...filter.filterSettings };
    const table = tableSettings(filter.filterKind).filter((setting) => typeof merged[setting] === "number");
    const others = Object.keys(merged).filter((setting) => !table.includes(setting) && !isDeniedSetting(setting) &&
      typeof merged[setting] === "number" && Number.isFinite(merged[setting])).sort();
    // A shader with very many uniforms: the first 200 are offered (the table's always among them).
    const settings = [...table, ...others].slice(0, 200).map((setting): InspectorFilterSetting => {
      const owner = findOwner(list, defaults, { filterName: filter.filterName, setting });
      return {
        setting,
        label: filterSettingName(filter.filterKind, setting),
        value: merged[setting] as number,
        table: table.includes(setting),
        ...(owner ? { owner: owner.kind === "modulator" ? owner.filterName : "" } : {})
      };
    });
    return { filterName: filter.filterName, filterKind: filter.filterKind, filterEnabled: filter.filterEnabled, settings };
  });
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
  /** The filters of the sources an OBS Filter inspector asked for, by source UUID (the newest few). */
  private readonly filterCatalogs = new Map<string, InspectorFilterCatalog>();
  public constructor(
    private readonly client: DirectObsClient,
    private readonly transport: DirectPiTransport,
    private readonly layers?: LayerController
  ) {
    client.on("statusChanged", () => this.broadcast());
    client.on("directStateChanged", () => this.broadcast());
    // A filter list read under another connection is stale; the page asks again.
    client.on("connectionReset", () => this.filterCatalogs.clear());
    layers?.on("changed", () => this.broadcast());
  }

  public broadcast(): void {
    const status = this.client.getStatus();
    const settings = this.client.getSettings();
    const catalog = this.client.getCatalog();
    const audioInputs = Object.keys(catalog.inputVolumes);
    this.transport.sendToPropertyInspector({
      event: "directObsState",
      // Worded here, in the plugin's language; the inspectors compare only `kind`.
      status: {
        kind: status.kind,
        sentence: statusSentence(status, translate),
        cellReason: statusCellReason(status, translate),
        obsVersion: status.obsVersion ?? ""
      },
      connection: {
        host: settings.host,
        port: settings.port,
        passwordSet: settings.password.length > 0
      },
      catalog,
      // Whether this OBS offers the media requests (the Playlister inspector's compatibility banner).
      mediaCapability: this.client.getMediaCapability(),
      automaticInputs: Object.fromEntries(["__audio_main__", "__audio_mic__", "__audio_aux__", "__audio_input_2__"]
        .map((target) => [target, resolveAutomaticInputName(target, audioInputs)])),
      filterCatalog: Object.fromEntries(this.filterCatalogs),
      layerScenes: Object.fromEntries(Object.entries(this.layers?.getCatalog() ?? {}).map(([name, scene]) =>
        [name, { ...scene, error: wordText(scene.error, translate) }])),
      layouts: READY_LAYOUTS.filter((layout) => layout.deviceType === this.transport.getDeviceType?.())
        .map((layout) => ({ ...layout, name: readyLayoutName(layout) }))
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
      case "directFilterCatalog": {
        const sourceUuid = typeof msg.sourceUuid === "string" ? msg.sourceUuid : "";
        if (sourceUuid) {
          let entry: InspectorFilterCatalog;
          try {
            entry = { filters: await readInspectorFilters(this.client, sourceUuid), error: "" };
          } catch (error) {
            entry = { filters: [], error: errorText(error, ownText("errorFilterChoose"), translate) };
          }
          this.filterCatalogs.delete(sourceUuid);
          this.filterCatalogs.set(sourceUuid, entry);
          // An inspector shows one source at a time: keep a few, the newest last (the oldest goes first).
          while (this.filterCatalogs.size > 8) this.filterCatalogs.delete(this.filterCatalogs.keys().next().value!);
        }
        this.broadcast();
        return true;
      }
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
                throw new DirectObsError(ownText("setupErrorStudio"), 400);
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
      error: errorText(error, ownText("setupErrorFallback"), translate)
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
