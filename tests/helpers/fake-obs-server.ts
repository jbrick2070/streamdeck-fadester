// SPDX-License-Identifier: GPL-2.0-or-later
import { WebSocketServer, WebSocket } from "ws";
import { AddressInfo } from "node:net";
import {
  computeObsWebSocketAuth,
  FADESTER_VENDOR_NAME
} from "../../src/obs/fadester-client.js";
import {
  FadesterSlot,
  GetStateResponse,
  CatalogSourceFiltersResponse
} from "../../src/types/contract.js";
import { isResetFxEligible } from "../../packages/streamdeck-fadester-shared/src/fx-policy.js";

export interface FakeObsServerOptions {
  password?: string;
  obsVersion?: string;
  fadesterVersion?: string;
  buildCommit?: string;
  apiVersion?: number;
  profile?: string;
  missingPlugin?: boolean;
  studioMode?: boolean;
  screenshotDelayMs?: number;
}

interface FakeProfileMeta {
  slug: string;
  displayName: string;
  tier: "verified" | "beta" | "custom";
  hasCrossfader: boolean;
  hasMaster: boolean;
}

const FAKE_PROFILES: Record<string, FakeProfileMeta> = {
  apc40mk2: {
    slug: "apc40mk2",
    displayName: "Akai APC40 mkII",
    tier: "verified",
    hasCrossfader: true,
    hasMaster: true
  },
  apcminimk2: {
    slug: "apcminimk2",
    displayName: "Akai APC mini mk2",
    tier: "beta",
    hasCrossfader: false,
    hasMaster: true
  },
  midimix: {
    slug: "midimix",
    displayName: "Akai MIDImix",
    tier: "beta",
    hasCrossfader: false,
    hasMaster: true
  },
  nanokontrol2: {
    slug: "nanokontrol2",
    displayName: "Korg nanoKONTROL2",
    tier: "beta",
    hasCrossfader: false,
    hasMaster: false
  },
  launchcontrolxl: {
    slug: "launchcontrolxl",
    displayName: "Novation Launch Control XL",
    tier: "beta",
    hasCrossfader: false,
    hasMaster: false
  },
  generic: {
    slug: "generic",
    displayName: "Generic MIDI (Custom)",
    tier: "custom",
    hasCrossfader: true,
    hasMaster: true
  }
};

const LEGACY_VALID_SLOTS =
  "crossfader, fader_1 .. fader_8, master";
const CURRENT_VALID_SLOTS = `${LEGACY_VALID_SLOTS}, fx_1 .. fx_8`;

function formatDisplayValue(slot: Pick<FadesterSlot, "id" | "value">): string {
  const value = Math.max(0, Math.min(1, slot.value));
  switch (slot.id) {
    case "fx_1":
      return `${(value * 32).toFixed(1)} px`;
    case "fx_2":
      return `${Math.round(-100 + value * 200)}%`;
    case "fx_3":
      return `${(-60 + value * 60).toFixed(1)} dB`;
    case "fx_4":
      return value === 0 ? "0 (Off)" : `${Math.round(value * 100)}%`;
    default:
      return `${Math.round(value * 100)}%`;
  }
}

function withDisplayValue(slot: FadesterSlot): FadesterSlot {
  return {
    ...slot,
    display_value: formatDisplayValue(slot)
  };
}

function supportsFxApi(version: string): boolean {
  const [majorText = "0", minorText = "0"] = version.split(/[.-]/, 3);
  const major = Number(majorText);
  const minor = Number(minorText);
  return Number.isFinite(major) && Number.isFinite(minor) &&
    (major > 0 || (major === 0 && minor >= 4));
}

export function createDefaultSlots(
  studioMode = true,
  includeFx = true
): FadesterSlot[] {
  const baseSlots: FadesterSlot[] = [
    {
      id: "crossfader",
      name: "Crossfader",
      kind: "crossfader",
      enabled: true,
      target_mode: "tbar",
      source_a: "",
      source_b: "",
      curve: "dip_free",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "Studio Mode T-bar",
      available: studioMode,
      reason: studioMode ? "" : "Studio Mode is off"
    },
    {
      id: "fader_1",
      name: "Fader 1",
      kind: "fader",
      enabled: true,
      target_mode: "crossfade_ab",
      source_a: "Cam 1",
      source_b: "Loop 3",
      curve: "dip_free",
      afv: false,
      value: 0.42,
      takeover_pending: "none",
      label: "Cam 1 -> Loop 3",
      available: true,
      reason: ""
    },
    {
      id: "fader_2",
      name: "Fader 2",
      kind: "fader",
      enabled: true,
      target_mode: "layer_opacity",
      source_a: "Logo Overlay",
      source_b: "",
      curve: "linear",
      afv: false,
      value: 0.75,
      takeover_pending: "none",
      label: "Logo Overlay",
      available: true,
      reason: ""
    },
    {
      id: "fader_3",
      name: "Fader 3",
      kind: "fader",
      enabled: true,
      target_mode: "unassigned",
      source_a: "",
      source_b: "",
      curve: "dip_free",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "",
      available: true,
      reason: ""
    },
    ...Array.from({ length: 5 }, (_, index): FadesterSlot => ({
      id: `fader_${index + 4}`,
      name: `Fader ${index + 4}`,
      kind: "fader",
      enabled: true,
      target_mode: "unassigned",
      source_a: "",
      source_b: "",
      curve: "linear",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "",
      available: true,
      reason: ""
    })),
    {
      id: "master",
      name: "Master",
      kind: "master",
      enabled: true,
      target_mode: "audio_volume",
      source_a: "Desktop Audio",
      source_b: "",
      curve: "linear",
      afv: false,
      value: 1.0,
      takeover_pending: "none",
      label: "Desktop Audio",
      available: true,
      reason: ""
    }
  ];

  const fxSlots: FadesterSlot[] = [
    {
      id: "fx_1",
      name: "FX 1",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Cam 1",
      source_b: "",
      filter_name: "Blur",
      filter_prop: "radius",
      from_val: 0,
      to_val: 32,
      bypass_at_zero: true,
      curve: "linear",
      afv: false,
      value: 0.44,
      takeover_pending: "none",
      label: "Cam 1 • Blur • Radius",
      available: true,
      reason: ""
    },
    {
      id: "fx_2",
      name: "FX 2",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Logo Overlay",
      source_b: "",
      filter_name: "Color Correction",
      filter_prop: "saturation",
      from_val: -100,
      to_val: 100,
      bypass_at_zero: false,
      curve: "linear",
      afv: false,
      value: 0.3,
      takeover_pending: "none",
      label: "Logo Overlay • Color Correction • Saturation",
      available: true,
      reason: ""
    },
    {
      id: "fx_3",
      name: "FX 3",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Mic/Aux",
      source_b: "",
      filter_name: "Compressor",
      filter_prop: "threshold",
      from_val: -60,
      to_val: 0,
      bypass_at_zero: false,
      curve: "linear",
      afv: false,
      value: 0.9,
      takeover_pending: "none",
      label: "Mic/Aux • Compressor • Threshold",
      available: true,
      reason: ""
    },
    {
      id: "fx_4",
      name: "FX 4",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Cam 1",
      source_b: "",
      filter_name: "Crop/Pad",
      filter_prop: "left",
      from_val: 0,
      to_val: 960,
      bypass_at_zero: false,
      curve: "linear",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "Cam 1 • Crop/Pad • Left",
      available: true,
      reason: ""
    },
    {
      id: "fx_5",
      name: "FX 5",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Loop 3",
      source_b: "",
      filter_name: "Sharpen",
      filter_prop: "sharpness",
      from_val: 0,
      to_val: 1,
      bypass_at_zero: true,
      curve: "linear",
      afv: false,
      value: 0.55,
      takeover_pending: "none",
      label: "Loop 3 • Sharpen • Sharpness",
      available: true,
      reason: ""
    },
    {
      id: "fx_6",
      name: "FX 6",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Desktop Audio",
      source_b: "",
      filter_name: "Limiter",
      filter_prop: "threshold",
      from_val: -30,
      to_val: 0,
      bypass_at_zero: false,
      curve: "linear",
      afv: false,
      value: 0.7,
      takeover_pending: "none",
      label: "Desktop Audio • Limiter • Threshold",
      available: true,
      reason: ""
    },
    {
      id: "fx_7",
      name: "FX 7",
      kind: "fx",
      enabled: true,
      target_mode: "unassigned",
      source_a: "",
      source_b: "",
      curve: "linear",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "",
      available: true,
      reason: ""
    },
    {
      id: "fx_8",
      name: "FX 8",
      kind: "fx",
      enabled: true,
      target_mode: "unassigned",
      source_a: "",
      source_b: "",
      curve: "linear",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "",
      available: true,
      reason: ""
    }
  ];

  return [...baseSlots, ...(includeFx ? fxSlots : [])].map(withDisplayValue);
}

export class FakeObsServer {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private readonly salt = "fadester_salt_1234";
  private readonly challenge = "fadester_challenge_5678";

  public password: string;
  public obsVersion: string;
  public fadesterVersion: string;
  public buildCommit: string;
  public apiVersion: number;
  public profile: string;
  public missingPlugin: boolean;
  public studioMode: boolean;
  public screenshotDelayMs: number;
  public previewSceneName = "Scene Preview";
  public programSceneName = "Scene Live";
  public slots: FadesterSlot[];
  public validSources = new Set<string>([
    "Cam 1",
    "Loop 3",
    "Logo Overlay",
    "Desktop Audio",
    "Mic/Aux"
  ]);

  public vendorCallLog: Array<{
    requestType: string;
    requestData?: Record<string, unknown>;
  }> = [];
  public screenshotCallCount = 0;
  public activeScreenshotRequests = 0;
  public maxConcurrentScreenshots = 0;
  public connectionCount = 0;
  public tbarCompletionCount = 0;
  public tbarAbortCount = 0;
  public faderChangedCount = 0;
  public readonly pendingCleanSlots = new Set<string>();
  public readonly outputWriteCounts = new Map<string, number>();
  private readonly reversedTbarDials = new Set<string>();

  public constructor(opts?: FakeObsServerOptions) {
    this.password = opts?.password ?? "";
    this.obsVersion = opts?.obsVersion ?? "33.0.0";
    this.fadesterVersion = opts?.fadesterVersion ?? "0.4.0";
    this.buildCommit = opts?.buildCommit ?? "";
    this.apiVersion = opts?.apiVersion ?? 1;
    this.profile = opts?.profile ?? "apc40mk2";
    this.missingPlugin = opts?.missingPlugin ?? false;
    this.studioMode = opts?.studioMode ?? true;
    this.screenshotDelayMs = opts?.screenshotDelayMs ?? 5;
    this.slots = createDefaultSlots(
      this.studioMode,
      supportsFxApi(this.fadesterVersion)
    );
    this.applyProfileTopology(this.profile);
  }

  public async start(port = 0): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = new WebSocketServer({ host: "127.0.0.1", port });
      this.wss = server;

      server.on("connection", (ws: WebSocket) => {
        this.connectionCount++;
        this.clients.add(ws);
        ws.on("close", () => {
          this.clients.delete(ws);
        });
        ws.on("message", (raw: WebSocket.RawData) => {
          this.handleClientMessage(ws, raw.toString("utf8"));
        });

        const helloData: Record<string, unknown> = {
          obsWebSocketVersion: "5.5.2",
          rpcVersion: 1
        };
        if (this.password) {
          helloData.authentication = {
            challenge: this.challenge,
            salt: this.salt
          };
        }
        ws.send(JSON.stringify({ op: 0, d: helloData }));
      });

      server.once("listening", () => {
        const addr = server.address() as AddressInfo;
        resolve(addr.port);
      });
      server.once("error", reject);
    });
  }

  public async stop(): Promise<void> {
    for (const c of this.clients) {
      try {
        c.terminate();
      } catch {
        // Ignore
      }
    }
    this.clients.clear();
    if (!this.wss) {
      return;
    }
    const server = this.wss;
    this.wss = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  public applyProfileTopology(profileSlug: string): void {
    const meta = FAKE_PROFILES[profileSlug] ?? FAKE_PROFILES.apc40mk2;
    this.profile = meta.slug;

    const cross = this.slots.find((s) => s.id === "crossfader");
    if (cross) {
      if (!meta.hasCrossfader) {
        cross.enabled = false;
        cross.target_mode = "unassigned";
        cross.label = "Disabled";
        cross.available = false;
        cross.reason = "Not used. Click to set up.";
        cross.value = 0.0;
      } else if (meta.slug === "apc40mk2") {
        cross.enabled = true;
        cross.target_mode = "tbar";
        cross.label = "Studio Mode T-bar";
        cross.available = this.studioMode;
        cross.reason = this.studioMode ? "" : "Studio Mode is off";
      } else {
        cross.enabled = false;
        cross.target_mode = "unassigned";
        cross.label = "Unassigned";
        cross.available = false;
        cross.reason = "Not used. Click to set up.";
      }
    }

    const master = this.slots.find((s) => s.id === "master");
    if (master) {
      if (!meta.hasMaster) {
        master.enabled = false;
        master.target_mode = "unassigned";
        master.source_a = "";
        master.label = "Disabled";
        master.available = false;
        master.reason = "Not used. Click to set up.";
        master.value = 0.0;
      } else if (meta.slug === "generic") {
        master.enabled = false;
        master.target_mode = "unassigned";
        master.source_a = "";
        master.label = "Unassigned";
        master.available = false;
        master.reason = "Not used. Click to set up.";
      } else if (master.target_mode === "unassigned") {
        master.enabled = true;
        master.target_mode = "audio_volume";
        master.source_a = "Desktop Audio";
        master.label = "Desktop Audio";
        master.available = true;
        master.reason = "";
        master.value = 1.0;
      }
    }

    for (const slot of this.slots) {
      slot.display_value = formatDisplayValue(slot);
    }
  }

  private loadProfileDefaults(meta: FakeProfileMeta): void {
    this.profile = meta.slug;
    this.pendingCleanSlots.clear();
    this.reversedTbarDials.clear();
    // The initial fixture is a configured demo desk. Loading a profile replaces
    // every assignment, as mfd_engine_load_profile_defaults does in real OBS.
    this.slots = this.slots.map((slot): FadesterSlot => {
      const enabled = slot.kind === "fx" || meta.slug === "generic" ||
        (slot.id === "crossfader" ? meta.hasCrossfader :
          slot.id === "master" ? meta.hasMaster : true);
      const isTbar = meta.slug === "apc40mk2" && slot.id === "crossfader";
      return withDisplayValue({
        id: slot.id,
        name: slot.name,
        kind: slot.kind,
        enabled,
        target_mode: isTbar ? "tbar" : "unassigned",
        source_a: "",
        source_b: "",
        scene: "",
        curve: slot.kind === "fx" ? "linear" : "dip_free",
        afv: false,
        value: 0,
        takeover_pending: "none",
        parked: false,
        label: !enabled ? "Disabled" : isTbar ? "Studio Mode T-Bar" : "Unassigned",
        available: isTbar && this.studioMode,
        reason: isTbar ? (this.studioMode ? "" : "Studio Mode is off.") :
          "Not used. Click to set up."
      });
    });
  }

  public setSlotAvailability(slotId: string, available: boolean, reason = ""): void {
    const slot = this.slots.find((candidate) => candidate.id === slotId);
    if (!slot) throw new Error(`Slot '${slotId}' does not exist.`);
    slot.available = available;
    slot.reason = reason;
    if (available && this.pendingCleanSlots.delete(slotId) && isResetFxEligible(slot)) {
      slot.value = 0;
      this.recordOutputWrite(slot);
      this.emitFaderChanged(slot.id);
    }
    this.emitVendorEvent("state_changed", this.getStatePayload() as unknown as Record<string, unknown>);
  }

  private recordOutputWrite(slot: FadesterSlot): void {
    this.outputWriteCounts.set(slot.id, (this.outputWriteCounts.get(slot.id) ?? 0) + 1);
  }

  private isSlotWritable(slot: FadesterSlot): boolean {
    // The provider retains values on enabled unassigned slots without driving OBS.
    return slot.enabled !== false && (slot.target_mode === "unassigned" || slot.available);
  }

  private applyValue(slot: FadesterSlot, value: number, release: boolean, origin = "api"): void {
    if (!this.isSlotWritable(slot)) return;
    this.pendingCleanSlots.delete(slot.id);
    const wasParked = slot.parked === true;
    if (slot.target_mode === "unassigned") {
      // Unassigned slots have neither two-rail takeover nor an output binding.
      slot.value = value;
      slot.parked = false;
      this.emitFaderChanged(slot.id, origin);
      return;
    }
    if (slot.target_mode === "tbar") {
      if (release || value === 1) {
        if (wasParked) return;
        this.tbarCompletionCount++;
        slot.value = 0; // OBS completion resets the logical throw while parking it.
        slot.parked = true;
      } else if (value === 0) {
        if (slot.value === 0 && !wasParked) return;
        if (!wasParked) this.tbarAbortCount++;
        slot.value = 0;
        slot.parked = false;
      } else {
        slot.value = value;
        slot.parked = false;
      }
    } else {
      slot.value = release ? (value >= 0.5 ? 1 : 0) : value;
      slot.parked = slot.value === 0 || slot.value === 1;
    }
    this.recordOutputWrite(slot);
    this.emitFaderChanged(slot.id, origin);
    if (wasParked !== slot.parked || slot.target_mode === "tbar" && value === 0) {
      this.emitVendorEvent("state_changed", this.getStatePayload() as unknown as Record<string, unknown>);
    }
  }

  public emitFaderChanged(slotId: string, origin = "api"): void {
    const slot = this.slots.find((candidate) => candidate.id === slotId);
    if (!slot) {
      return;
    }
    this.faderChangedCount++;
    slot.display_value = formatDisplayValue(slot);
    this.emitVendorEvent("fader_changed", {
      slot: slot.id,
      value: slot.value,
      ...(supportsFxApi(this.fadesterVersion)
        ? { display_value: slot.display_value }
        : {}),
      origin
    });
  }

  private stateSlot(slot: FadesterSlot): FadesterSlot {
    const copy = { ...slot };
    if (!supportsFxApi(this.fadesterVersion)) {
      delete copy.display_value;
    }
    return copy;
  }

  public getStatePayload(): GetStateResponse {
    const meta = FAKE_PROFILES[this.profile] ?? FAKE_PROFILES.apc40mk2;
    return {
      version: this.fadesterVersion,
      ...(this.buildCommit
        ? {
            build: {
              commit: this.buildCommit,
              built_at: "2026-10-28T07:00:00Z"
            }
          }
        : {}),
      api_version: this.apiVersion,
      studio_mode: this.studioMode,
      profile: meta.slug,
      profile_display_name: meta.displayName,
      profile_tier: meta.tier,
      device: {
        name: "APC40 mkII",
        connected: true,
        error: ""
      },
      slots: this.slots.map((slot) => this.stateSlot(slot))
    };
  }

  public emitVendorEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): void {
    const payload = JSON.stringify({
      op: 5,
      d: {
        eventType: "VendorEvent",
        eventIntent: 1 << 9,
        eventData: {
          vendorName: FADESTER_VENDOR_NAME,
          eventType,
          eventData
        }
      }
    });
    for (const c of this.clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(payload);
      }
    }
  }

  public emitObsEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): void {
    const payload = JSON.stringify({
      op: 5,
      d: {
        eventType,
        eventIntent: 1 << 2,
        eventData
      }
    });
    for (const c of this.clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(payload);
      }
    }
  }

  private handleClientMessage(ws: WebSocket, text: string): void {
    const msg = JSON.parse(text) as { op: number; d: Record<string, unknown> };
    if (msg.op === 1) {
      if (this.password) {
        const expected = computeObsWebSocketAuth(
          this.password,
          this.salt,
          this.challenge
        );
        if (msg.d.authentication !== expected) {
          ws.close(4009, "Authentication failed.");
          return;
        }
      }
      ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      return;
    }

    if (msg.op === 6) {
      const requestId = String(msg.d.requestId ?? "");
      const requestType = String(msg.d.requestType ?? "");
      const requestData = (msg.d.requestData ?? {}) as Record<string, unknown>;
      void this.handleObsRequest(ws, requestId, requestType, requestData);
    }
  }

  private async handleObsRequest(
    ws: WebSocket,
    requestId: string,
    requestType: string,
    requestData: Record<string, unknown>
  ): Promise<void> {
    if (requestType === "GetVersion") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        obsStudioVersion: this.obsVersion,
        obsWebSocketVersion: "5.5.2",
        rpcVersion: 1
      });
      return;
    }

    if (requestType === "GetCurrentProgramScene") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        currentProgramSceneName: this.programSceneName,
        sceneName: this.programSceneName
      });
      return;
    }

    if (requestType === "GetCurrentPreviewScene") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        currentPreviewSceneName: this.previewSceneName,
        sceneName: this.previewSceneName
      });
      return;
    }

    if (requestType === "GetSourceScreenshot") {
      this.screenshotCallCount++;
      this.activeScreenshotRequests++;
      if (this.activeScreenshotRequests > this.maxConcurrentScreenshots) {
        this.maxConcurrentScreenshots = this.activeScreenshotRequests;
      }
      await new Promise((r) => setTimeout(r, this.screenshotDelayMs));
      this.activeScreenshotRequests--;
      const sourceName = String(requestData.sourceName ?? "");
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        imageData: `data:image/jpeg;base64,FAKE_THUMB_${Buffer.from(sourceName).toString("base64")}`
      });
      return;
    }

    if (requestType === "CallVendorRequest") {
      const vendorName = String(requestData.vendorName ?? "");
      const vReqType = String(requestData.requestType ?? "");
      const vReqData = (requestData.requestData ?? {}) as Record<string, unknown>;

      if (this.missingPlugin || vendorName !== FADESTER_VENDOR_NAME) {
        this.sendResponse(
          ws,
          requestId,
          requestType,
          false,
          600,
          `No vendor with name '${vendorName}' was found.`
        );
        return;
      }

      this.vendorCallLog.push({ requestType: vReqType, requestData: vReqData });
      const responseData = this.handleVendorCall(vReqType, vReqData);
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        vendorName,
        requestType: vReqType,
        responseData
      });
    }
  }

  private handleVendorCall(
    vReqType: string,
    vReqData: Record<string, unknown>
  ): Record<string, unknown> {
    if (vReqType === "get_state") {
      return this.getStatePayload() as unknown as Record<string, unknown>;
    }

    if (vReqType === "load_profile") {
      const name = String(vReqData.name ?? "").toLowerCase();
      const meta = FAKE_PROFILES[name];
      if (!meta) {
        const msg = `Unknown profile '${name}'. Valid profiles: apc40mk2, apcminimk2, midimix, nanokontrol2, launchcontrolxl, generic.`;
        return { error: msg, comment: msg };
      }
      this.loadProfileDefaults(meta);
      this.emitVendorEvent(
        "state_changed",
        this.getStatePayload() as unknown as Record<string, unknown>
      );
      return { loaded: meta.slug, profile_tier: meta.tier };
    }

    if (vReqType === "get_catalog") {
      if (!supportsFxApi(this.fadesterVersion)) {
        const msg =
          "The 'get_catalog' request requires Midi Fadester 0.4.0 or newer.";
        return { error: msg, comment: msg };
      }
      const source =
        typeof vReqData.source === "string" ? vReqData.source : "";
      if (!source) {
        return {
          scenes: [
            {
              name: "Scene Live",
              layers: [
                { name: "Cam 1", has_audio: false },
                { name: "Logo Overlay", has_audio: false }
              ]
            },
            {
              name: "Scene Preview",
              layers: [{ name: "Loop 3", has_audio: false }]
            }
          ],
          audio_sources: [
            { name: "Desktop Audio", db: -6 },
            { name: "Mic/Aux", db: -12 }
          ],
          filter_hosts: [
            { source: "Cam 1", is_scene: false, filter_count: 2 },
            { source: "Logo Overlay", is_scene: false, filter_count: 1 },
            { source: "Scene Live", is_scene: true, filter_count: 0 }
          ]
        };
      }
      if (source === "Cam 1") {
        return {
          source,
          is_scene: false,
          filters: [
            {
              name: "Blur",
              type_id: "box_filter",
              enabled: true,
              properties: [
                {
                  name: "radius",
                  label: "Radius",
                  type: "float",
                  min: 0,
                  max: 32,
                  step: 0.1,
                  suffix: "px",
                  current: 14.1
                }
              ]
            },
            {
              name: "Crop/Pad",
              type_id: "crop_filter",
              enabled: true,
              properties: [
                {
                  name: "left",
                  label: "Left",
                  type: "int",
                  min: 0,
                  max: 960,
                  step: 1,
                  suffix: "px",
                  current: 0
                }
              ]
            }
          ]
        };
      }
      if (source === "Logo Overlay") {
        return {
          source,
          is_scene: false,
          filters: [
            {
              name: "Color Correction",
              type_id: "color_filter",
              enabled: true,
              properties: [
                {
                  name: "saturation",
                  label: "Saturation",
                  type: "float",
                  min: -100,
                  max: 100,
                  step: 0.1,
                  suffix: "%",
                  current: -40
                }
              ]
            }
          ]
        };
      }
      const isScene = source === "Scene Live" || source === "Scene Preview";
      if (!isScene && !this.validSources.has(source)) {
        const msg = `Source '${source}' not found. Create the source in OBS first or check its spelling.`;
        return { error: msg, comment: msg };
      }
      return { source, is_scene: isScene, filters: [] };
    }

    if (vReqType === "reset_fx") {
      if (!supportsFxApi(this.fadesterVersion)) {
        const msg =
          "The 'reset_fx' request requires Midi Fadester 0.4.0 or newer.";
        return { error: msg, comment: msg };
      }
      const ms = vReqData.ms === undefined ? 0 : Number(vReqData.ms);
      if (!Number.isFinite(ms) || (ms !== 0 && (ms < 50 || ms > 20000))) {
        const msg = "Duration 'ms' must be 0 (instant) or between 50 and 20000 ms.";
        return { error: msg, comment: msg };
      }
      const eligible = this.slots.filter(isResetFxEligible);
      let queued = 0;
      for (const slot of eligible) {
        slot.value = 0;
        if (!slot.available) {
          this.pendingCleanSlots.add(slot.id);
          queued++;
        } else {
          this.pendingCleanSlots.delete(slot.id);
          this.recordOutputWrite(slot);
        }
        // Fake fades settle immediately; counts and unavailable intent still
        // follow the real provider's instant/timed request contract.
        this.emitFaderChanged(slot.id, "api");
      }
      this.emitVendorEvent("state_changed", this.getStatePayload() as unknown as Record<string, unknown>);
      return {
        eligible_count: eligible.length,
        reset_count: eligible.length - queued,
        queued_unavailable_count: queued,
        ms
      };
    }

    const slotId = String(vReqData.slot ?? "");
    const slot = this.slots.find((s) => s.id === slotId);
    if (!slot) {
      const validSlots = supportsFxApi(this.fadesterVersion)
        ? CURRENT_VALID_SLOTS
        : LEGACY_VALID_SLOTS;
      const msg = `Slot '${slotId}' does not exist. Valid slots: ${validSlots}.`;
      return { error: msg, comment: msg };
    }

    if (["set_fader_value", "nudge_fader", "auto_fade"].includes(vReqType) &&
        !this.isSlotWritable(slot)) {
      const msg = slot.reason || "This slot is unavailable. Configure it in Midi Fadester first.";
      return { error: msg, comment: msg };
    }

    if (vReqType === "set_fader_value") {
      const rawVal = Number(vReqData.value ?? 0);
      this.reversedTbarDials.delete(slot.id);
      this.applyValue(slot, Math.max(0, Math.min(1, rawVal)), vReqData.release === true);
      return { slot: slot.id, value: slot.value };
    }

    if (vReqType === "nudge_fader") {
      const delta = Number(vReqData.delta ?? 0);
      if (slot.target_mode === "tbar" && slot.parked && delta === 0) {
        return { slot: slot.id, value: slot.value };
      }
      if (slot.target_mode === "tbar" && slot.parked) {
        if (delta < 0) this.reversedTbarDials.add(slot.id);
        else this.reversedTbarDials.delete(slot.id);
      }
      const effectiveDelta = this.reversedTbarDials.has(slot.id) ? -delta : delta;
      this.applyValue(slot, Math.max(0, Math.min(1, Number((slot.value + effectiveDelta).toFixed(4)))), false);
      return { slot: slot.id, value: slot.value };
    }

    if (vReqType === "auto_fade") {
      const ms = Number(vReqData.ms ?? 0);
      const to = Number(vReqData.to ?? 1);
      if (!Number.isFinite(ms) || ms < 50 || ms > 20000) {
        const msg = "Duration 'ms' must be between 50 and 20000.";
        return { error: msg, comment: msg };
      }
      if (slot.target_mode === "tbar" && slot.available && slot.enabled !== false) {
        slot.parked = false;
      }
      this.applyValue(slot, Math.max(0, Math.min(1, to)), false, "auto_fade");
      return { slot: slot.id };
    }

    if (vReqType === "set_slot") {
      if ("enabled" in vReqData && typeof vReqData.enabled !== "boolean") {
        const msg = "Parameter 'enabled' must be a boolean.";
        return { error: msg, comment: msg };
      }
      if (
        typeof vReqData.source_a === "string" &&
        vReqData.source_a.length > 0 &&
        !this.validSources.has(vReqData.source_a)
      ) {
        const msg = `Source '${vReqData.source_a}' not found in OBS. Choose an existing source name.`;
        return { error: msg, comment: msg };
      }
      if (
        typeof vReqData.source_b === "string" &&
        vReqData.source_b.length > 0 &&
        !this.validSources.has(vReqData.source_b)
      ) {
        const msg = `Source '${vReqData.source_b}' not found in OBS. Choose an existing source name.`;
        return { error: msg, comment: msg };
      }
      const candidate = { ...slot, ...vReqData } as FadesterSlot;
      candidate.enabled = typeof vReqData.enabled === "boolean"
        ? vReqData.enabled : ("target_mode" in vReqData ? true : slot.enabled);
      const pureDisable = vReqData.enabled === false &&
        !["target_mode", "source_a", "filter_name", "filter_prop", "from_val", "to_val", "bypass_at_zero"]
          .some((key) => key in vReqData);
      let filterBounds: { from_val: number; to_val: number } | undefined;
      if (candidate.target_mode === "filter_param" && !pureDisable) {
        const detail = this.handleVendorCall("get_catalog", { source: candidate.source_a });
        if (detail.error) return detail;
        const filter = (detail as unknown as CatalogSourceFiltersResponse).filters
          ?.find((entry) => entry.name === candidate.filter_name);
        const property = filter?.properties.find((entry) => entry.name === candidate.filter_prop);
        if (!property) {
          const msg = `Filter setting '${candidate.filter_prop || ""}' on '${candidate.filter_name || ""}' was not found. Choose a numeric setting from the catalog.`;
          return { error: msg, comment: msg };
        }
        const sameBinding = slot.target_mode === "filter_param" && slot.source_a === candidate.source_a &&
          slot.filter_name === candidate.filter_name && slot.filter_prop === candidate.filter_prop;
        const from = "from_val" in vReqData ? Number(vReqData.from_val) : sameBinding ? slot.from_val! : property.min;
        const to = "to_val" in vReqData ? Number(vReqData.to_val) : sameBinding ? slot.to_val! : property.max;
        if (!Number.isFinite(from) || !Number.isFinite(to) || from < property.min || from > property.max || to < property.min || to > property.max) {
          const msg = "Filter range bounds must be finite and within the property's range.";
          return { error: msg, comment: msg };
        }
        if (Math.abs(to - from) < 1e-6) {
          const msg = "'from_val' and 'to_val' must differ so the control has a range to sweep.";
          return { error: msg, comment: msg };
        }
        const owner = candidate.enabled !== false && this.slots.find((other) => other.id !== slot.id &&
          other.enabled !== false && other.target_mode === "filter_param" && other.source_a === candidate.source_a &&
          other.filter_name === candidate.filter_name && other.filter_prop === candidate.filter_prop);
        if (owner) {
          const msg = `Setting '${candidate.filter_prop}' on '${candidate.filter_name}' is already controlled by ${owner.label || owner.id}.`;
          return { error: msg, comment: msg };
        }
        filterBounds = { from_val: from, to_val: to };
      }
      if (typeof vReqData.target_mode === "string") {
        slot.target_mode = vReqData.target_mode as FadesterSlot["target_mode"];
        slot.enabled = true;
      }
      if (typeof vReqData.enabled === "boolean") {
        slot.enabled = vReqData.enabled;
        if (!slot.enabled) this.pendingCleanSlots.delete(slot.id);
      }
      if (typeof vReqData.scene === "string") {
        slot.scene = vReqData.scene;
      }
      if (typeof vReqData.source_a === "string") {
        slot.source_a = vReqData.source_a;
      }
      if (typeof vReqData.source_b === "string") {
        slot.source_b = vReqData.source_b;
      }
      if (typeof vReqData.curve === "string") {
        slot.curve = vReqData.curve as FadesterSlot["curve"];
      }
      if (typeof vReqData.afv === "boolean") {
        slot.afv = vReqData.afv;
      }
      if (typeof vReqData.filter_name === "string") {
        slot.filter_name = vReqData.filter_name;
      }
      if (typeof vReqData.filter_prop === "string") {
        slot.filter_prop = vReqData.filter_prop;
      }
      if (typeof vReqData.from_val === "number") {
        slot.from_val = vReqData.from_val;
      }
      if (typeof vReqData.to_val === "number") {
        slot.to_val = vReqData.to_val;
      }
      if (filterBounds) Object.assign(slot, filterBounds);
      if (typeof vReqData.bypass_at_zero === "boolean") {
        slot.bypass_at_zero = vReqData.bypass_at_zero;
      }
      if (typeof vReqData.cal_min === "number") {
        slot.cal_min = vReqData.cal_min;
      }
      if (typeof vReqData.cal_max === "number") {
        slot.cal_max = vReqData.cal_max;
      }
      if (!slot.enabled || slot.target_mode === "unassigned") {
        slot.available = false;
        slot.label = slot.enabled ? "Unassigned" : "Disabled";
        slot.reason = "Not used. Click to set up.";
      } else {
        slot.available = slot.target_mode !== "tbar" || this.studioMode;
        slot.reason = slot.available ? "" : "Studio Mode is off.";
      }
      slot.display_value = formatDisplayValue(slot);
      this.emitVendorEvent(
        "state_changed",
        this.getStatePayload() as unknown as Record<string, unknown>
      );
      return this.stateSlot(slot) as unknown as Record<string, unknown>;
    }

    const msg = `Unknown vendor request '${vReqType}'.`;
    return { error: msg, comment: msg };
  }

  private sendResponse(
    ws: WebSocket,
    requestId: string,
    requestType: string,
    result: boolean,
    code: number,
    comment: string,
    responseData?: Record<string, unknown>
  ): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(
      JSON.stringify({
        op: 7,
        d: {
          requestType,
          requestId,
          requestStatus: {
            result,
            code,
            ...(comment ? { comment } : {})
          },
          ...(responseData ? { responseData } : {})
        }
      })
    );
  }
}
