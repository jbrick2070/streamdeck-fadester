// SPDX-License-Identifier: GPL-2.0-or-later
import { DirectObsClient, DirectObsError } from "../obs/direct-obs-client.js";
import { pluginVersion } from "./plugin-version.js";
import { resolveAutomaticInputName } from "../obs/automatic-targets.js";
import { LayerController, LayerSettings } from "../control/layer-controller.js";
import type { TapeDecks } from "../control/tape-decks.js";
import type { VisualSignals } from "../control/visual-signals.js";
import { isLoopbackObsHost } from "../../packages/streamdeck-fadester-shared/src/obs/obs-websocket-config.js";
import {
  evaluateSetupChecklist,
  type PlaylisterPluginInfo,
  type SetupChecklistOptions,
  type SetupChecklistReport
} from "../obs/setup-checklist.js";
import { READY_LAYOUTS, readyLayoutName } from "../types/layouts.js";
import { LocalText, errorLocalText, errorText, ownText, wordText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { statusCellReason, statusSentence } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { currentLanguage, translate } from "../i18n/strings.js";
import type { LanguageState } from "../i18n/language-choice.js";
import { findOwner, isDeniedForFilter, tableSettings } from "../obs/filter-ranges.js";
import { filterSettingName } from "../actions/obs-filter-control.js";
import {
  DEFAULT_GLOBAL_SETTINGS,
  FadesterGlobalSettings
} from "../types/settings.js";

/** How long Save & test waits for a new connection attempt to end, and how often it looks. */
export const CONNECTION_TEST_LIMIT_MS = 5000;
const CONNECTION_TEST_POLL_MS = 100;

export interface DirectPiIncomingMessage {
  [key: string]: unknown;
  event?: string;
  host?: string;
  /** The page's own id for a layout or Studio Mode request; it comes back with `directSetupResult`. */
  requestId?: string;
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

/** A filter's settings as read: identities and values; the words are added at each broadcast (PLAN.md 11.1, RL-3). */
export type InspectorFilterIdentity = Omit<InspectorFilter, "settings"> & {
  settings: Array<Omit<InspectorFilterSetting, "label">>;
};

/** A filter list as the bridge keeps it: an error as a text to word, not words. */
interface StoredFilterCatalog {
  filters: InspectorFilterIdentity[];
  error: LocalText | null;
}

/** Adds the deck's words for each setting, in the active language. */
export function labelInspectorFilters(filters: readonly InspectorFilterIdentity[]): InspectorFilter[] {
  return filters.map((filter) => ({
    ...filter,
    settings: filter.settings.map(({ setting, value, table, owner }) => ({
      setting,
      label: filterSettingName(filter.filterKind, setting),
      value,
      table,
      ...(owner !== undefined ? { owner } : {})
    }))
  }));
}

/**
 * The filters on one source with the settings the deck may write: numbers only,
 * never a denied one, the range table's first (PLAN.md 10.5). Read by UUID.
 */
export async function readInspectorFilters(client: DirectObsClient, sourceUuid: string): Promise<InspectorFilter[]> {
  return labelInspectorFilters(await readInspectorFilterIdentities(client, sourceUuid));
}

/** The filters of `readInspectorFilters` without the words (what the bridge keeps). */
export async function readInspectorFilterIdentities(client: DirectObsClient, sourceUuid: string): Promise<InspectorFilterIdentity[]> {
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
    // Denied by name, or a list uniform of the shader's own text.
    const others = Object.keys(merged).filter((setting) => !table.includes(setting) && !isDeniedForFilter(filter.filterKind, setting, merged) &&
      typeof merged[setting] === "number" && Number.isFinite(merged[setting])).sort();
    // A shader with very many uniforms: the first 200 are offered (the table's always among them).
    const settings = [...table, ...others].slice(0, 200).map((setting): Omit<InspectorFilterSetting, "label"> => {
      const owner = findOwner(list, defaults, { filterName: filter.filterName, setting });
      return {
        setting,
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
  /**
   * Whether a settings page is open to receive a state. When it says no, `broadcast` builds nothing: OBS sends an
   * event per step of a fade or a dial turn, and the page state is a full copy of the catalog. Absent means yes.
   */
  isInspectorOpen?(): boolean;
  persistGlobalSettings(settings: FadesterGlobalSettings): Promise<void>;
  getDeviceType?(): number | undefined;
  getOpenDeckStarter?(): { profileName: string | null } | undefined;
  activateLayout?(slug: string): Promise<void>;
  /** The Language setting and the language the deck draws in (PLAN.md 11.1). */
  getLanguage?(): LanguageState;
  /** Configured VJster link port for the setup checklist probe (defaults to 48150). */
  getVjsterPort?(): number | undefined;
  /** Optional overrides for deterministic setup-checklist tests. */
  checklistOptions?: SetupChecklistOptions;
  /** Optional override for reading OBS's saved obs-websocket config in fixture tests. */
}

/**
 * Separate bridge and event namespace for the primary Direct OBS inspectors.
 * It never sends the stored OBS password back to a browser inspector.
 */
export class DirectObsPropertyInspectorBridge {
  private connectionQueue: Promise<void> = Promise.resolve();
  /** The filters of the sources an OBS Filter inspector asked for, by source UUID (the newest few). */
  private readonly filterCatalogs = new Map<string, StoredFilterCatalog>();
  /**
   * Counts connection resets: the inspector asks for its filters again when it changes (a reconnect may keep
   * the status "connected"), and a list read across a reset is dropped.
   */
  private filterEpoch = 0;
  /** Monotonic counter for one-shot setup checklist runs. */
  private checklistSeq = 0;
  /** Latest one-shot setup checklist report. */
  private lastChecklist: SetupChecklistReport | null = null;

  public constructor(
    private readonly client: DirectObsClient,
    private readonly transport: DirectPiTransport,
    private readonly layers?: LayerController,
    private readonly tapeDecks?: TapeDecks,
    private readonly visualSignals?: VisualSignals
  ) {
    client.on("statusChanged", () => this.broadcast());
    client.on("directStateChanged", () => this.broadcast());
    client.on("wholeMixChanged", () => this.broadcast());
    // A filter list read under another connection is stale; the page asks again.
    client.on("connectionReset", () => {
      this.filterEpoch++;
      this.filterCatalogs.clear();
      this.broadcast();
    });
    layers?.on("changed", () => this.broadcast());
    tapeDecks?.on("changed", () => this.broadcast());
    visualSignals?.on("stateChanged", () => this.broadcast());
  }

  public broadcast(): void {
    // No page open: nothing to build. A page that opens asks for the state itself (directPiReady).
    if (this.transport.isInspectorOpen?.() === false) return;
    const status = this.client.getStatus();
    const settings = this.client.getSettings();
    const catalog = this.client.getCatalog();
    const audioInputs = Object.keys(catalog.inputVolumes);
    const vsSnap = this.visualSignals?.getSnapshot();
    const playlisterPlugin: PlaylisterPluginInfo = this.lastChecklist?.playlisterPlugin ?? {
      status: "unknown",
      inputKind: "obs_playlister_source",
      version: "version unknown"
    };
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
        // The port in use when it is not the one set here: OBS's own saved port, followed while no password is typed.
        portInUse: this.client.getActivePort?.() ?? settings.port,
        // OBS on this computer: its saved port and password are used, and nothing has to be typed.
        local: isLoopbackObsHost(settings.host),
        passwordSet: settings.password.length > 0,
        // Signed in with the password OBS saved on this computer (no password typed); the password itself never travels.
        obsSaved: this.client.usesSavedObsPassword?.() ?? false
      },
      setupChecklist: this.lastChecklist,
      playlisterPlugin,
      catalog,
      pluginVersion: pluginVersion(),
      // Whether OBS's own slider follows the T-bar dial, or why not (the OBS Fader inspector's status line).
      nativeTbar: this.client.getNativeTbarStatus?.() ?? "off",
      wholeMix: this.client.wholeMix?.state,
      // Whether this OBS offers the media requests (the Playlister inspector's compatibility banner).
      mediaCapability: this.client.getMediaCapability(),
      automaticInputs: Object.fromEntries(["__audio_main__", "__audio_mic__", "__audio_aux__", "__audio_input_2__"]
        .map((target) => [target, resolveAutomaticInputName(target, audioInputs)])),
      // Worded now, so a list read before a language change reads in the new language.
      filterCatalog: Object.fromEntries([...this.filterCatalogs].map(([uuid, entry]): [string, InspectorFilterCatalog] =>
        [uuid, { filters: labelInspectorFilters(entry.filters), error: wordText(entry.error, translate) }])),
      filterEpoch: this.filterEpoch,
      layerScenes: Object.fromEntries(Object.entries(this.layers?.getCatalog() ?? {}).map(([name, scene]) =>
        [name, { ...scene, error: wordText(scene.error, translate) }])),
      ...(this.tapeDecks ? { tapeDecks: this.tapeDecks.getInspectorState() } : {}),
      ...(vsSnap
        ? {
            visualSignals: {
              availability: vsSnap.availability,
              version: vsSnap.version,
              supportsTempoGrid: vsSnap.supportsTempoGrid,
              needsTempoUpdate: vsSnap.needsTempoUpdate
            }
          }
        : {}),
      openDeckStarter: this.transport.getOpenDeckStarter?.(),
      layouts: READY_LAYOUTS.filter((layout) => layout.deviceType === this.transport.getDeviceType?.())
        .map((layout) => ({ ...layout, name: readyLayoutName(layout) })),
      language: this.transport.getLanguage?.() ?? { choice: "auto", resolved: currentLanguage() }
    });
  }

  /** Returns true only when the message belongs to a direct-OBS inspector. */
  public async handleMessage(payload: DirectPiIncomingMessage | undefined): Promise<boolean> {
    const msg = payload ?? {};
    switch (msg.event) {
      case "directPiReady":
        this.broadcast();
        void this.client.refreshNativeTbar?.(); // an opened inspector reads OBS's slider afresh
        void this.tapeDecks?.refreshDecks();
        void this.runChecklist();
        return true;
      case "directRunChecklist":
        await this.runChecklist();
        return true;
      case "directUpdateGlobalSettings":
        await this.queueConnection(() => this.updateGlobalSettings(msg));
        return true;
      case "directUseObsPassword":
        await this.queueConnection(() => this.useObsOwnPassword());
        return true;
      case "directTestConnection":
        await this.queueConnection(() => this.testConnection());
        return true;
      case "directRefreshCatalog":
        if (this.client.isConnected()) {
          await Promise.all([
            this.client.refreshCatalog(),
            this.tapeDecks?.refreshDecks()
          ]);
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
        const epoch = this.filterEpoch;
        if (sourceUuid) {
          let entry: StoredFilterCatalog;
          try {
            entry = { filters: await readInspectorFilterIdentities(this.client, sourceUuid), error: null };
          } catch (error) {
            entry = { filters: [], error: errorLocalText(error, ownText("errorFilterChoose")) };
          }
          // Read under a connection that has since been reset: stale, and the page asks again.
          if (epoch !== this.filterEpoch) {
            this.broadcast();
            return true;
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
        // The page's own id for this request goes back with the answer: an answer for the page that was open
        // before is not taken by the page open now (C-07).
        const setupId = typeof msg.requestId === "string" ? { requestId: msg.requestId } : {};
        // OpenDeck has its own starter, and a layout for another deck cannot open here: the page still gets an
        // answer, so its "Preparing…" never stays.
        if (this.transport.getOpenDeckStarter?.() || !layout || layout.deviceType !== this.transport.getDeviceType?.() ||
          !this.transport.activateLayout) {
          this.sendSetupError(undefined, setupId);
        } else {
          try {
            if (layout.obsMode === "studio") {
              if (msg.prepareStudio === true) await this.client.prepareStudioLayout();
              else if (!this.client.getCatalog().studioMode) {
                throw new DirectObsError(ownText("setupErrorStudio"), 400);
              }
            }
            await this.transport.activateLayout(layout.slug);
            this.transport.sendToPropertyInspector({ event: "directSetupResult", ok: true, ...setupId });
          } catch (error) {
            this.sendSetupError(error, setupId);
          }
        }
        return true;
      }
      case "directPrepareStudio": {
        const setupId = typeof msg.requestId === "string" ? { requestId: msg.requestId } : {};
        try {
          await this.client.prepareStudioLayout();
          this.broadcast();
          this.transport.sendToPropertyInspector({ event: "directSetupResult", ok: true, ...setupId });
        } catch (error) {
          this.sendSetupError(error, setupId);
        }
        return true;
      }
      default:
        return false;
    }
  }

  private sendSetupError(error: unknown, setupId: { requestId?: string } = {}): void {
    this.transport.sendToPropertyInspector({
      event: "directSetupResult", ok: false, ...setupId,
      error: errorText(error, ownText("setupErrorFallback"), translate)
    });
  }

  private async runChecklist(): Promise<void> {
    const seq = ++this.checklistSeq;
    const vjsterPort = this.transport.getVjsterPort?.() ?? 48150;
    const report = await evaluateSetupChecklist(this.client, {
      ...this.transport.checklistOptions,
      vjsterPort: this.transport.checklistOptions?.vjsterPort ?? vjsterPort
    });
    if (seq !== this.checklistSeq) return;
    this.lastChecklist = report;
    this.broadcast();
  }

  /**
   * The explicit way to drop a typed password: from then on the client signs in with the one OBS saved on this
   * computer, read fresh at each sign-in (an emptied password box is "no change", never "no password"). Then a test.
   */
  private async useObsOwnPassword(): Promise<void> {
    const current = this.client.getSettings();
    const next: FadesterGlobalSettings = { host: current.host, port: current.port, password: "" };
    await this.transport.persistGlobalSettings(next);
    this.client.updateSettings(next);
    await this.testConnection();
  }

  private async updateGlobalSettings(msg: DirectPiIncomingMessage): Promise<void> {
    const current = this.client.getSettings();
    const next: FadesterGlobalSettings = {
      host:
        typeof msg.host === "string" && msg.host.trim()
          ? msg.host.trim()
          : DEFAULT_GLOBAL_SETTINGS.host,
      port: Number(msg.port ?? DEFAULT_GLOBAL_SETTINGS.port),
      // A password only reaches this bridge if the operator typed it locally. Without one the save leaves the stored
      // password alone: this session may not know it (a start-up read that came late), and must never write "" over it.
      ...(typeof msg.password === "string" ? { password: msg.password } : {})
    };
    await this.transport.persistGlobalSettings(next);
    // After the save: the saver has given the client the stored password by now.
    this.client.updateSettings({ ...next, password: next.password ?? this.client.getSettings().password ?? current.password });
    this.broadcast();
  }

  /**
   * Save & test: a fresh read when connected, else a new connection attempt, waited for until OBS answers or the
   * socket closes (at most `CONNECTION_TEST_LIMIT_MS`). Then the state, and `directTestDone`, so the page can show
   * that a test ran even when its result is the sentence it showed before.
   */
  private async testConnection(): Promise<void> {
    try {
      if (this.client.isConnected()) {
        await this.client.refreshCatalog();
      } else {
        this.client.reconnectNow();
        await this.settleConnectAttempt();
      }
    } finally {
      this.broadcast();
      this.transport.sendToPropertyInspector({ event: "directTestDone" });
    }
  }

  /** Waits while the attempt's socket is open and OBS has neither connected nor refused it. */
  private async settleConnectAttempt(): Promise<void> {
    const start = Date.now();
    while (this.client.hasLiveSocket() && !this.client.isConnected() && Date.now() - start < CONNECTION_TEST_LIMIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, CONNECTION_TEST_POLL_MS));
    }
  }

  private queueConnection(run: () => Promise<void>): Promise<void> {
    const task = this.connectionQueue.catch(() => {}).then(run);
    this.connectionQueue = task;
    return task;
  }
}
