// SPDX-License-Identifier: GPL-2.0-or-later
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import {
  AutoFadeRequest,
  AutoFadeResponse,
  ConnectionStatusInfo,
  FADESTER_API_VERSION,
  FADESTER_VENDOR_NAME,
  FaderChangedEvent,
  GetStateResponse,
  LoadProfileRequest,
  LoadProfileResponse,
  MIDI_FADESTER_RELEASE_URL,
  NudgeFaderRequest,
  NudgeFaderResponse,
  SetFaderValueRequest,
  SetFaderValueResponse,
  SetSlotRequest,
  SetSlotResponse,
  StateChangedEvent
} from "../types/contract.js";
import { DEFAULT_GLOBAL_SETTINGS, FadesterGlobalSettings } from "../types/settings.js";

export { FADESTER_VENDOR_NAME, FADESTER_API_VERSION, MIDI_FADESTER_RELEASE_URL };

export const OBS_WS_EVENT_SUB_SCENES = 1 << 2;
export const OBS_WS_EVENT_SUB_UI = 1 << 10;
export const OBS_WS_EVENT_SUB_VENDORS = 1 << 9;
export const OBS_WS_DEFAULT_SUBSCRIPTIONS =
  OBS_WS_EVENT_SUB_SCENES | OBS_WS_EVENT_SUB_UI | OBS_WS_EVENT_SUB_VENDORS;

export class FadesterVendorError extends Error {
  public readonly code: number;
  public readonly comment: string;

  public constructor(comment: string, code = -1) {
    super(comment);
    this.name = "FadesterVendorError";
    this.code = code;
    this.comment = comment;
  }
}

export interface FadesterClientOptions {
  baseReconnectMs?: number;
  maxReconnectMs?: number;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (data: Record<string, unknown>) => void;
  reject: (err: FadesterVendorError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function computeObsWebSocketAuth(
  password: string,
  salt: string,
  challenge: string
): string {
  const secret = createHash("sha256")
    .update(password + salt, "utf8")
    .digest("base64");
  return createHash("sha256")
    .update(secret + challenge, "utf8")
    .digest("base64");
}

export function makeUnreachableStatus(): ConnectionStatusInfo {
  return {
    kind: "obs_unreachable",
    sentence: "OBS is not running or the websocket is off (Tools > WebSocket Server Settings)",
    cellReason: "OBS is not running or websocket is off"
  };
}

export function makeWrongPasswordStatus(): ConnectionStatusInfo {
  return {
    kind: "wrong_password",
    sentence: "Wrong password. Check OBS Tools > WebSocket Server Settings > Show Connect Info.",
    cellReason: "Wrong password"
  };
}

export function makeMissingPluginStatus(): ConnectionStatusInfo {
  return {
    kind: "missing_plugin",
    sentence: "Midi Fadester is not installed in OBS",
    cellReason: "Midi Fadester is not installed in OBS",
    linkUrl: MIDI_FADESTER_RELEASE_URL
  };
}

export class FadesterClient extends EventEmitter {
  private settings: Required<FadesterGlobalSettings> = { ...DEFAULT_GLOBAL_SETTINGS };
  private readonly baseReconnectMs: number;
  private readonly maxReconnectMs: number;
  private readonly requestTimeoutMs: number;

  private ws: WebSocket | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private stopped = true;
  private haltedReason: "none" | "wrong_password" | "missing_plugin" = "none";
  private identified = false;
  private status: ConnectionStatusInfo = makeUnreachableStatus();
  private connectAttemptCount = 0;

  public constructor(
    initialSettings?: FadesterGlobalSettings,
    options?: FadesterClientOptions
  ) {
    super();
    if (initialSettings) {
      this.applySettingsObject(initialSettings);
    }
    this.baseReconnectMs = options?.baseReconnectMs ?? 1000;
    this.maxReconnectMs = options?.maxReconnectMs ?? 10000;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 4000;
  }

  public getStatus(): ConnectionStatusInfo {
    return this.status;
  }

  public getSettings(): Required<FadesterGlobalSettings> {
    return { ...this.settings };
  }

  public isConnected(): boolean {
    return this.identified && this.status.kind === "connected";
  }

  public getConnectAttemptCount(): number {
    return this.connectAttemptCount;
  }

  public start(): void {
    this.stopped = false;
    this.haltedReason = "none";
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  public stop(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.cleanupSocket();
  }

  public updateSettings(next: FadesterGlobalSettings): void {
    this.applySettingsObject(next);
    if (!this.stopped) {
      this.reconnectNow();
    }
  }

  public reconnectNow(): void {
    this.stopped = false;
    this.haltedReason = "none";
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.cleanupSocket();
    this.openSocket();
  }

  public async getState(): Promise<GetStateResponse> {
    const res = await this.callVendor<GetStateResponse>("get_state", undefined, false);
    this.emit("stateChanged", res);
    return res;
  }

  public async setFaderValue(req: SetFaderValueRequest): Promise<SetFaderValueResponse> {
    return this.callVendor<SetFaderValueResponse>("set_fader_value", {
      slot: req.slot,
      value: req.value,
      ...(req.release !== undefined ? { release: req.release } : {})
    });
  }

  public async nudgeFader(req: NudgeFaderRequest): Promise<NudgeFaderResponse> {
    return this.callVendor<NudgeFaderResponse>("nudge_fader", {
      slot: req.slot,
      delta: req.delta
    });
  }

  public async autoFade(req: AutoFadeRequest): Promise<AutoFadeResponse> {
    return this.callVendor<AutoFadeResponse>("auto_fade", {
      slot: req.slot,
      to: req.to,
      ms: req.ms
    });
  }

  public async setSlot(req: SetSlotRequest): Promise<SetSlotResponse> {
    return this.callVendor<SetSlotResponse>("set_slot", { ...req });
  }

  public async loadProfile(req: LoadProfileRequest): Promise<LoadProfileResponse> {
    return this.callVendor<LoadProfileResponse>("load_profile", { name: req.name });
  }

  public async getSourceScreenshot(
    sourceName: string,
    width = 96,
    height = 54
  ): Promise<string> {
    const data = await this.sendObsRequest("GetSourceScreenshot", {
      sourceName,
      imageFormat: "jpg",
      imageWidth: width,
      imageHeight: height,
      imageCompressionQuality: 75
    });
    const imageData = typeof data.imageData === "string" ? data.imageData : "";
    if (!imageData) {
      throw new FadesterVendorError(`Empty screenshot returned for source '${sourceName}'.`, 500);
    }
    return imageData;
  }

  public async callVendor<TResponse>(
    requestType: string,
    requestData?: Record<string, unknown>,
    resyncOnError = true
  ): Promise<TResponse> {
    let outerResponse: Record<string, unknown>;
    try {
      outerResponse = await this.sendObsRequest("CallVendorRequest", {
        vendorName: FADESTER_VENDOR_NAME,
        requestType,
        ...(requestData !== undefined ? { requestData } : {})
      });
    } catch (err) {
      const vendorErr =
        err instanceof FadesterVendorError
          ? err
          : new FadesterVendorError(String(err), -1);
      this.emit("vendorError", vendorErr.comment);
      if (resyncOnError && requestType !== "get_state" && this.identified) {
        void this.getState().catch(() => {});
      }
      throw vendorErr;
    }

    const innerData = (outerResponse.responseData ?? {}) as Record<string, unknown>;
    if (typeof innerData.error === "string" && innerData.error.length > 0) {
      const comment =
        typeof innerData.comment === "string" && innerData.comment.length > 0
          ? innerData.comment
          : innerData.error;
      const vendorErr = new FadesterVendorError(comment, 400);
      this.emit("vendorError", comment);
      if (resyncOnError && requestType !== "get_state" && this.identified) {
        void this.getState().catch(() => {});
      }
      throw vendorErr;
    }

    return innerData as TResponse;
  }

  private applySettingsObject(next: FadesterGlobalSettings): void {
    const host = (next.host ?? DEFAULT_GLOBAL_SETTINGS.host).trim() || DEFAULT_GLOBAL_SETTINGS.host;
    const rawPort = Number(next.port ?? DEFAULT_GLOBAL_SETTINGS.port);
    const port =
      Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535
        ? rawPort
        : DEFAULT_GLOBAL_SETTINGS.port;
    const password = next.password ?? DEFAULT_GLOBAL_SETTINGS.password;
    this.settings = { host, port, password };
  }

  private setStatus(next: ConnectionStatusInfo): void {
    const changed =
      this.status.kind !== next.kind ||
      this.status.sentence !== next.sentence ||
      this.status.cellReason !== next.cellReason;
    this.status = next;
    if (changed) {
      this.emit("statusChanged", next);
    }
  }

  private openSocket(): void {
    if (this.stopped || this.haltedReason !== "none") {
      return;
    }
    this.cleanupSocket();
    this.connectAttemptCount++;
    const url = `ws://${this.settings.host}:${this.settings.port}`;
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.on("message", (raw: WebSocket.RawData) => {
      if (this.ws !== socket) {
        return;
      }
      this.handleMessage(raw.toString("utf8"));
    });

    socket.on("error", () => {
      // Handled in close event
    });

    socket.on("close", (code: number) => {
      if (this.ws !== socket) {
        return;
      }
      this.ws = null;
      this.identified = false;
      this.rejectAllPending("Disconnected from OBS.");

      if (this.stopped) {
        return;
      }

      if (code === 4009) {
        this.haltedReason = "wrong_password";
        this.clearReconnectTimer();
        this.setStatus(makeWrongPasswordStatus());
        return;
      }

      if (this.haltedReason === "missing_plugin") {
        // If OBS itself closed after missing_plugin, revert to unreachable and resume backoff
        this.haltedReason = "none";
      }

      this.setStatus(makeUnreachableStatus());
      this.scheduleReconnect();
    });
  }

  private handleMessage(jsonText: string): void {
    let msg: { op?: number; d?: Record<string, unknown> };
    try {
      msg = JSON.parse(jsonText) as { op?: number; d?: Record<string, unknown> };
    } catch {
      return;
    }

    const op = msg.op;
    const d = msg.d ?? {};

    if (op === 0) {
      // Hello
      const authObj = d.authentication as { challenge?: string; salt?: string } | undefined;
      let authentication: string | undefined;
      if (authObj && typeof authObj.challenge === "string" && typeof authObj.salt === "string") {
        if (!this.settings.password) {
          // Server requires a password and user password is empty -> will fail or let server close with 4009
          authentication = computeObsWebSocketAuth("", authObj.salt, authObj.challenge);
        } else {
          authentication = computeObsWebSocketAuth(
            this.settings.password,
            authObj.salt,
            authObj.challenge
          );
        }
      }
      this.sendRaw({
        op: 1,
        d: {
          rpcVersion: 1,
          ...(authentication !== undefined ? { authentication } : {}),
          eventSubscriptions: OBS_WS_DEFAULT_SUBSCRIPTIONS
        }
      });
      return;
    }

    if (op === 2) {
      // Identified
      this.identified = true;
      void this.initializeAfterIdentify();
      return;
    }

    if (op === 5) {
      // Event
      this.handleObsEvent(d);
      return;
    }

    if (op === 7) {
      // RequestResponse
      this.handleRequestResponse(d);
    }
  }

  private async initializeAfterIdentify(): Promise<void> {
    try {
      const versionData = await this.sendObsRequest("GetVersion");
      const obsVersion =
        typeof versionData.obsStudioVersion === "string"
          ? versionData.obsStudioVersion
          : "33.0.0";

      let state: GetStateResponse;
      try {
        state = await this.callVendor<GetStateResponse>("get_state", undefined, false);
      } catch (err) {
        const vendorErr = err instanceof FadesterVendorError ? err : null;
        if (vendorErr && (vendorErr.code === 600 || vendorErr.code === 604 || vendorErr.code === 207)) {
          this.haltedReason = "missing_plugin";
          this.clearReconnectTimer();
          this.setStatus(makeMissingPluginStatus());
          return;
        }
        throw err;
      }

      if (typeof state.api_version === "number" && state.api_version > FADESTER_API_VERSION) {
        const mismatchSentence = `Midi Fadester API version ${state.api_version} is newer than supported version ${FADESTER_API_VERSION}. Update Fadester for OBS.`;
        this.setStatus({
          kind: "version_mismatch",
          sentence: mismatchSentence,
          cellReason: "Update Fadester for OBS",
          obsVersion,
          fadesterVersion: state.version
        });
        return;
      }

      this.reconnectAttempt = 0;
      this.haltedReason = "none";
      this.setStatus({
        kind: "connected",
        sentence: `Connected: OBS ${obsVersion}, Midi Fadester ${state.version}`,
        cellReason: "",
        obsVersion,
        fadesterVersion: state.version
      });
      this.emit("stateChanged", state);
      await this.refreshSceneNames(state.studio_mode);
    } catch {
      // Socket closed or initial request failed before ready
    }
  }

  private async refreshSceneNames(studioMode: boolean): Promise<void> {
    try {
      const prog = await this.sendObsRequest("GetCurrentProgramScene");
      if (typeof prog.currentProgramSceneName === "string") {
        this.emit("programSceneChanged", prog.currentProgramSceneName);
      } else if (typeof prog.sceneName === "string") {
        this.emit("programSceneChanged", prog.sceneName);
      }
    } catch {
      // Ignore if no scenes exist
    }

    if (studioMode) {
      try {
        const prev = await this.sendObsRequest("GetCurrentPreviewScene");
        if (typeof prev.currentPreviewSceneName === "string") {
          this.emit("previewSceneChanged", prev.currentPreviewSceneName);
        } else if (typeof prev.sceneName === "string") {
          this.emit("previewSceneChanged", prev.sceneName);
        }
      } catch {
        // Ignore if Studio Mode just turned off
      }
    }
  }

  private handleObsEvent(d: Record<string, unknown>): void {
    const eventType = d.eventType;
    const eventData = (d.eventData ?? {}) as Record<string, unknown>;

    if (eventType === "VendorEvent" && eventData.vendorName === FADESTER_VENDOR_NAME) {
      const vendorEventType = eventData.eventType;
      const vendorEventData = (eventData.eventData ?? {}) as Record<string, unknown>;
      if (vendorEventType === "fader_changed") {
        const ev: FaderChangedEvent = {
          slot: String(vendorEventData.slot ?? ""),
          value: Number(vendorEventData.value ?? 0),
          origin: (vendorEventData.origin as FaderChangedEvent["origin"]) ?? "api"
        };
        this.emit("faderChanged", ev);
      } else if (vendorEventType === "state_changed") {
        const state = vendorEventData as unknown as StateChangedEvent;
        this.emit("stateChanged", state);
        if (typeof state.studio_mode === "boolean") {
          void this.refreshSceneNames(state.studio_mode);
        }
      }
      return;
    }

    if (eventType === "CurrentProgramSceneChanged") {
      const name = String(eventData.sceneName ?? "");
      if (name) {
        this.emit("programSceneChanged", name);
      }
      return;
    }

    if (eventType === "CurrentPreviewSceneChanged") {
      const name = String(eventData.sceneName ?? "");
      if (name) {
        this.emit("previewSceneChanged", name);
      }
      return;
    }

    if (eventType === "StudioModeStateChanged") {
      const enabled = Boolean(eventData.studioModeEnabled);
      void this.refreshSceneNames(enabled);
    }
  }

  private handleRequestResponse(d: Record<string, unknown>): void {
    const requestId = typeof d.requestId === "string" ? d.requestId : "";
    const entry = this.pending.get(requestId);
    if (!entry) {
      return;
    }
    this.pending.delete(requestId);
    clearTimeout(entry.timer);

    const status = (d.requestStatus ?? {}) as {
      result?: boolean;
      code?: number;
      comment?: string;
    };
    if (status.result === false) {
      const code = typeof status.code === "number" ? status.code : 500;
      const comment =
        typeof status.comment === "string" && status.comment.length > 0
          ? status.comment
          : `OBS request failed (code ${code}).`;
      entry.reject(new FadesterVendorError(comment, code));
      return;
    }

    const responseData = (d.responseData ?? {}) as Record<string, unknown>;
    entry.resolve(responseData);
  }

  private sendObsRequest(
    requestType: string,
    requestData?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.identified) {
        reject(new FadesterVendorError(this.status.sentence, 500));
        return;
      }

      const requestId = `req_${this.nextRequestId++}`;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new FadesterVendorError(
            `Request '${requestType}' timed out after ${this.requestTimeoutMs} ms. Check OBS responsiveness.`,
            504
          )
        );
      }, this.requestTimeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
      this.sendRaw({
        op: 6,
        d: {
          requestType,
          requestId,
          ...(requestData !== undefined ? { requestData } : {})
        }
      });
    });
  }

  private sendRaw(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.haltedReason !== "none" || this.reconnectTimer !== null) {
      return;
    }
    const exp = Math.min(this.reconnectAttempt, 6);
    const delay = Math.min(this.baseReconnectMs * Math.pow(2, exp), this.maxReconnectMs);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new FadesterVendorError(reason, 500));
    }
    this.pending.clear();
  }

  private cleanupSocket(): void {
    this.rejectAllPending("Connection reset.");
    this.identified = false;
    if (this.ws) {
      const s = this.ws;
      this.ws = null;
      s.removeAllListeners();
      try {
        s.terminate();
      } catch {
        // Ignore
      }
    }
  }
}
