// SPDX-License-Identifier: GPL-2.0-or-later
import {
  CONTROLLER_PROFILE_META,
  CURVE_LABELS,
  CurveType,
  FadesterSlot,
  PROFILE_TIER_LABELS,
  SetSlotRequest,
  supportsCatalogApi,
  TARGET_MODE_LABELS,
  TargetMode
} from "../types/contract.js";
import { FadesterClient, FadesterVendorError } from "../obs/fadester-client.js";
import { FadesterStore } from "../state/fadester-store.js";
import { errorText, ownText, type TextParams } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { statusCellReason, statusSentence } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { currentLanguage, translate } from "../i18n/strings.js";
import type { LanguageState } from "../i18n/language-choice.js";
import {
  DEFAULT_GLOBAL_SETTINGS,
  FadesterGlobalSettings
} from "../types/settings.js";

/**
 * What the Property Inspector receives. The password never travels here:
 * `connection.passwordSet` says whether one is stored.
 */
export interface PiStatePayload {
  event: "fadesterState";
  status: {
    kind: string;
    sentence: string;
    cellReason: string;
    linkUrl: string;
    obsVersion: string;
    fadesterVersion: string;
    buildCommit: string;
  };
  connection: { host: string; port: number; passwordSet: boolean };
  studioMode: boolean;
  profile: {
    slug: string;
    displayName: string;
    tier: string;
    tierLabel: string;
  };
  device: { name: string; connected: boolean; error: string };
  knownProfiles: Array<{
    slug: string;
    displayName: string;
    tier: string;
    tierLabel: string;
  }>;
  targetModes: Array<{ id: TargetMode; label: string }>;
  curves: Array<{ id: CurveType; label: string }>;
  capabilities: { catalog: boolean; resetFx: boolean; fxSlots: boolean };
  slots: PiSlot[];
  lastErrorComment: string;
  /** The Language setting and the language the deck draws in (PLAN.md 11.1). */
  language: LanguageState;
}

export type PiSlot = Pick<
  FadesterSlot,
  | "id"
  | "name"
  | "label"
  | "kind"
  | "enabled"
  | "target_mode"
  | "scene"
  | "source_a"
  | "source_b"
  | "filter_name"
  | "filter_prop"
  | "from_val"
  | "to_val"
  | "bypass_at_zero"
  | "cal_min"
  | "cal_max"
  | "curve"
  | "afv"
  | "value"
  | "display_value"
  | "available"
  | "reason"
>;

export interface PiIncomingMessage {
  [key: string]: unknown;
  event?: string;
  requestId?: string;
  host?: string;
  port?: number | string;
  password?: string;
  source?: string;
  name?: string;
  slot?: string;
  fields?: Record<string, unknown>;
}

export interface PiTransport {
  /** Sends a payload to the visible Property Inspector, if any. */
  sendToPropertyInspector(payload: Record<string, unknown>): void;
  /** Persists shared settings in Stream Deck. */
  persistGlobalSettings(settings: FadesterGlobalSettings): Promise<void>;
  /** The Language setting and the language the deck draws in (PLAN.md 11.1). */
  getLanguage?(): LanguageState;
  /** Words for the two Midi Fadester pages, which stay in Stream Deck's language until they get the Language choice (R-LANG-3, PLAN.md step L.6); the plugin's own translator when absent. */
  translate?: (key: string, params?: TextParams) => string;
}

const SET_SLOT_STRING_FIELDS = [
  "target_mode",
  "scene",
  "source_a",
  "source_b",
  "filter_name",
  "filter_prop",
  "curve"
] as const;
const SET_SLOT_NUMBER_FIELDS = ["from_val", "to_val", "cal_min", "cal_max"] as const;
const SET_SLOT_BOOLEAN_FIELDS = ["enabled", "bypass_at_zero", "afv"] as const;

/**
 * Picks only the documented `set_slot` fields with the right types, so the PI
 * cannot send unknown keys to OBS and a wrong type is dropped here instead of
 * becoming a vendor validation error there.
 */
export function sanitizeSetSlotFields(
  slot: string,
  raw: Record<string, unknown> | undefined
): SetSlotRequest {
  const req: SetSlotRequest = { slot };
  if (!raw) {
    return req;
  }
  const out = req as unknown as Record<string, unknown>;
  for (const key of SET_SLOT_STRING_FIELDS) {
    const v = raw[key];
    if (typeof v === "string") {
      out[key] = v;
    }
  }
  for (const key of SET_SLOT_NUMBER_FIELDS) {
    const v = raw[key];
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof n === "number" && Number.isFinite(n)) {
      out[key] = n;
    }
  }
  for (const key of SET_SLOT_BOOLEAN_FIELDS) {
    const v = raw[key];
    if (typeof v === "boolean") {
      out[key] = v;
    }
  }
  return req;
}

export class PropertyInspectorBridge {
  private connectionQueue: Promise<void> = Promise.resolve();
  private readonly store: FadesterStore;
  private readonly client: FadesterClient;
  private readonly transport: PiTransport;

  public constructor(
    store: FadesterStore,
    client: FadesterClient,
    transport: PiTransport
  ) {
    this.store = store;
    this.client = client;
    this.transport = transport;
    store.on("changed", () => this.broadcast());
    store.on("vendorError", () => this.broadcast());
    store.on("slotValueChanged", (slotId: string) => {
      const slot = this.store.getSlot(slotId);
      if (slot) {
        this.transport.sendToPropertyInspector({
          event: "slotValueChanged",
          slot: slot.id,
          value: slot.value,
          display_value: slot.display_value
        });
      }
    });
  }

  private get tr(): (key: string, params?: TextParams) => string {
    return this.transport.translate ?? translate;
  }

  public buildStatePayload(): PiStatePayload {
    const status = this.store.getStatus();
    const settings = this.client.getSettings();
    const device = this.store.getDevice();
    const slots = this.store.getSlots();
    const catalog = supportsCatalogApi(status.fadesterVersion, slots);
    const tier = this.store.getProfileTier();
    const tierLabel = (id: string): string => PROFILE_TIER_LABELS[id] ? this.tr(PROFILE_TIER_LABELS[id]) : id;
    return {
      event: "fadesterState",
      // Worded here, in the pages' language (Stream Deck's until step L.6); the inspectors compare only `kind`.
      status: {
        kind: status.kind,
        sentence: statusSentence(status, this.tr),
        cellReason: statusCellReason(status, this.tr),
        linkUrl: status.linkUrl ?? "",
        obsVersion: status.obsVersion ?? "",
        fadesterVersion: status.fadesterVersion ?? "",
        buildCommit: status.buildCommit ?? ""
      },
      connection: {
        host: settings.host,
        port: settings.port,
        passwordSet: settings.password.length > 0
      },
      studioMode: this.store.isStudioMode(),
      profile: {
        slug: this.store.getProfile(),
        // The generic profile is ours to name; the controller profiles keep their product names.
        displayName: this.store.getProfile() === "generic" ? this.tr("profileGeneric") : this.store.getProfileDisplayName(),
        tier,
        tierLabel: tierLabel(tier)
      },
      device: {
        name: device.name,
        connected: Boolean(device.connected),
        error: device.error
      },
      knownProfiles: CONTROLLER_PROFILE_META.map((p) => ({
        slug: p.slug,
        displayName: p.slug === "generic" ? this.tr("profileGeneric") : p.displayName,
        tier: p.tier,
        tierLabel: tierLabel(p.tier)
      })),
      targetModes: (Object.keys(TARGET_MODE_LABELS) as TargetMode[]).map(
        (id) => ({ id, label: this.tr(TARGET_MODE_LABELS[id]) })
      ),
      curves: (Object.keys(CURVE_LABELS) as CurveType[]).map((id) => ({
        id,
        label: this.tr(CURVE_LABELS[id])
      })),
      capabilities: {
        catalog,
        resetFx: catalog,
        fxSlots: slots.some((s) => s.kind === "fx")
      },
      slots: slots.map((s) => ({
        id: s.id,
        name: s.name,
        label: s.label,
        kind: s.kind,
        enabled: s.enabled,
        target_mode: s.target_mode,
        scene: s.scene ?? "",
        source_a: s.source_a,
        source_b: s.source_b,
        filter_name: s.filter_name ?? "",
        filter_prop: s.filter_prop ?? "",
        from_val: s.from_val,
        to_val: s.to_val,
        bypass_at_zero: s.bypass_at_zero,
        cal_min: s.cal_min,
        cal_max: s.cal_max,
        curve: s.curve,
        afv: s.afv,
        value: s.value,
        display_value: s.display_value,
        available: s.available,
        reason: s.reason
      })),
      lastErrorComment: this.store.getLastErrorComment(this.tr),
      language: this.transport.getLanguage?.() ?? { choice: "auto", resolved: currentLanguage() }
    };
  }

  public broadcast(): void {
    this.transport.sendToPropertyInspector(
      this.buildStatePayload() as unknown as Record<string, unknown>
    );
  }

  public async handleMessage(
    payload: PiIncomingMessage | undefined
  ): Promise<void> {
    const msg = payload ?? {};
    switch (msg.event) {
      case "piReady":
        this.client.ensureStarted();
        this.broadcast();
        return;
      case "updateGlobalSettings":
        await this.queueConnection(() => this.handleUpdateGlobalSettings(msg));
        return;
      case "testConnection":
        await this.queueConnection(() => this.handleTestConnection());
        return;
      case "getCatalog":
        await this.handleGetCatalog(msg);
        return;
      case "setSlot":
        await this.handleSetSlot(msg);
        return;
      case "loadProfile":
        await this.handleLoadProfile(msg);
        return;
      default:
        return;
    }
  }

  /** Merges host/port, and the password only when the PI sent one. */
  public async handleUpdateGlobalSettings(
    msg: PiIncomingMessage
  ): Promise<void> {
    const current = this.client.getSettings();
    const next: FadesterGlobalSettings = {
      host:
        typeof msg.host === "string" && msg.host.trim()
          ? msg.host.trim()
          : DEFAULT_GLOBAL_SETTINGS.host,
      port: Number(msg.port ?? DEFAULT_GLOBAL_SETTINGS.port),
      password:
        typeof msg.password === "string" ? msg.password : current.password
    };
    await this.transport.persistGlobalSettings(next);
    this.client.updateSettings(next);
    this.broadcast();
  }

  /**
   * Connected: re-read `get_state` without dropping the socket. Offline or
   * halted: force one reconnect attempt now.
   */
  public async handleTestConnection(): Promise<void> {
    if (this.client.isConnected()) {
      try {
        await this.client.getState();
      } catch {
        // vendorError is already broadcast through the store
      }
      this.broadcast();
      return;
    }
    this.client.reconnectNow();
    this.broadcast();
  }

  public async handleGetCatalog(msg: PiIncomingMessage): Promise<void> {
    const source = typeof msg.source === "string" ? msg.source : "";
    const reply: Record<string, unknown> = {
      event: "catalog",
      requestId: msg.requestId ?? "",
      source
    };
    if (!this.client.isConnected()) {
      reply.error = statusSentence(this.store.getStatus(), this.tr);
      this.transport.sendToPropertyInspector(reply);
      return;
    }
    try {
      reply.data = await this.client.getCatalog(
        source ? { source } : undefined
      );
    } catch (err) {
      reply.error = this.errorSentence(err);
    }
    this.transport.sendToPropertyInspector(reply);
  }

  public async handleSetSlot(msg: PiIncomingMessage): Promise<void> {
    const slot = typeof msg.slot === "string" ? msg.slot.trim() : "";
    const reply: Record<string, unknown> = {
      event: "setSlotResult",
      requestId: msg.requestId ?? "",
      slot
    };
    if (!slot) {
      reply.ok = false;
      reply.error = this.tr("piChooseSlot");
      this.transport.sendToPropertyInspector(reply);
      return;
    }
    if (!this.client.isConnected()) {
      reply.ok = false;
      reply.error = statusSentence(this.store.getStatus(), this.tr);
      this.transport.sendToPropertyInspector(reply);
      return;
    }
    try {
      const request = sanitizeSetSlotFields(slot, msg.fields);
      const updated = await this.client.setSlot(request);
      if (typeof request.enabled === "boolean" && updated.enabled !== request.enabled) {
        throw new FadesterVendorError(ownText("piEnabledNotApplied"));
      }
      reply.ok = true;
      reply.enabled = updated.enabled;
      reply.label = updated.label;
      reply.available = updated.available;
      reply.reason = updated.reason;
    } catch (err) {
      reply.ok = false;
      reply.error = this.errorSentence(err);
    }
    this.transport.sendToPropertyInspector(reply);
  }

  public async handleLoadProfile(msg: PiIncomingMessage): Promise<void> {
    const name = typeof msg.name === "string" ? msg.name.trim() : "";
    const reply: Record<string, unknown> = {
      event: "loadProfileResult",
      requestId: msg.requestId ?? "",
      name
    };
    if (!this.client.isConnected()) {
      reply.ok = false;
      reply.error = statusSentence(this.store.getStatus(), this.tr);
      this.transport.sendToPropertyInspector(reply);
      return;
    }
    try {
      const res = await this.client.loadProfile({ name });
      reply.ok = true;
      reply.loaded = res.loaded;
      reply.tier = res.profile_tier ?? "";
    } catch (err) {
      reply.ok = false;
      reply.error = this.errorSentence(err);
    }
    this.transport.sendToPropertyInspector(reply);
  }

  /** A Midi Fadester or OBS comment verbatim; our own messages in the pages' language. */
  private errorSentence(err: unknown): string {
    return errorText(err, { verbatim: String(err) }, this.tr);
  }

  private queueConnection(run: () => Promise<void>): Promise<void> {
    const task = this.connectionQueue.catch(() => {}).then(run);
    this.connectionQueue = task;
    return task;
  }
}
