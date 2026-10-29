// SPDX-License-Identifier: GPL-2.0-or-later
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import {
  ConnectionStatusInfo,
  DEFAULT_GLOBAL_CONNECTION_SETTINGS,
  GlobalConnectionSettings,
  ScreenshotProvider
} from "../types.js";

export const OBS_WS_EVENT_SUB_SCENES = 1 << 2;
export const OBS_WS_EVENT_SUB_INPUTS = 1 << 3;
export const OBS_WS_EVENT_SUB_TRANSITIONS = 1 << 4;
export const OBS_WS_EVENT_SUB_SCENE_ITEMS = 1 << 7;
export const OBS_WS_EVENT_SUB_UI = 1 << 10;
export const OBS_WS_EVENT_SUB_VENDORS = 1 << 9;
export const OBS_WS_DEFAULT_SUBSCRIPTIONS =
  1 | // General events.
  (1 << 1) | // Config events include scene collection changes.
  OBS_WS_EVENT_SUB_SCENES |
  OBS_WS_EVENT_SUB_INPUTS |
  OBS_WS_EVENT_SUB_TRANSITIONS |
  OBS_WS_EVENT_SUB_SCENE_ITEMS |
  OBS_WS_EVENT_SUB_UI |
  OBS_WS_EVENT_SUB_VENDORS;

export class ObsVendorError extends Error {
  public readonly code: number;
  public readonly comment: string;

  public constructor(comment: string, code = -1) {
    super(comment);
    this.name = "ObsVendorError";
    this.code = code;
    this.comment = comment;
  }
}

export interface ObsVendorClientOptions {
  vendorName?: string;
  supportedApiVersion?: number;
  pluginDisplayName?: string;
  pluginReleaseUrl?: string;
  surfaceDisplayName?: string;
  baseReconnectMs?: number;
  maxReconnectMs?: number;
  requestTimeoutMs?: number;
}

export interface ObsVendorStateMeta {
  version: string;
  build?: {
    commit?: string;
    built_at?: string;
  };
  api_version?: number;
  studio_mode: boolean;
  profile?: string;
  profile_display_name?: string;
  profile_tier?: string;
}

interface PendingRequest {
  resolve: (data: Record<string, unknown>) => void;
  reject: (err: ObsVendorError) => void;
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
    sentence:
      "OBS is not running or the websocket is off (Tools > WebSocket Server Settings)",
    cellReason: "OBS is not running or websocket is off"
  };
}

export function makeWrongPasswordStatus(): ConnectionStatusInfo {
  return {
    kind: "wrong_password",
    sentence:
      "Wrong password. Check OBS Tools > WebSocket Server Settings > Show Connect Info.",
    cellReason: "Wrong password"
  };
}

export function makeMissingPluginStatus(
  pluginDisplayName = "Midi Fadester",
  linkUrl = "https://github.com/jbrick2070/midi-fadester/releases"
): ConnectionStatusInfo {
  return {
    kind: "missing_plugin",
    sentence: `${pluginDisplayName} is not installed in OBS`,
    cellReason: `${pluginDisplayName} is not installed in OBS`,
    linkUrl
  };
}

export class ObsVendorClient<
    TState extends ObsVendorStateMeta = ObsVendorStateMeta
  >
  extends EventEmitter
  implements ScreenshotProvider
{
  protected settings: Required<GlobalConnectionSettings> = {
    ...DEFAULT_GLOBAL_CONNECTION_SETTINGS
  };
  protected readonly vendorName: string;
  protected readonly supportedApiVersion: number;
  protected readonly pluginDisplayName: string;
  protected readonly pluginReleaseUrl: string;
  protected readonly surfaceDisplayName: string;
  protected readonly baseReconnectMs: number;
  protected readonly maxReconnectMs: number;
  protected readonly requestTimeoutMs: number;

  private ws: WebSocket | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected reconnectAttempt = 0;
  private stopped = true;
  protected haltedReason: "none" | "wrong_password" | "missing_plugin" = "none";
  protected identified = false;
  protected status: ConnectionStatusInfo = makeUnreachableStatus();
  private connectAttemptCount = 0;
  private lastNudgeAt = 0;

  public constructor(
    initialSettings?: GlobalConnectionSettings,
    options?: ObsVendorClientOptions
  ) {
    super();
    if (initialSettings) {
      this.applySettingsObject(initialSettings);
    }
    this.vendorName = options?.vendorName ?? "midi-fadester";
    this.supportedApiVersion = options?.supportedApiVersion ?? 1;
    this.pluginDisplayName = options?.pluginDisplayName ?? "Midi Fadester";
    this.pluginReleaseUrl =
      options?.pluginReleaseUrl ??
      "https://github.com/jbrick2070/midi-fadester/releases";
    this.surfaceDisplayName = options?.surfaceDisplayName ?? "Fadester for OBS";
    this.baseReconnectMs = options?.baseReconnectMs ?? 1000;
    this.maxReconnectMs = options?.maxReconnectMs ?? 10000;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 4000;
  }

  public getStatus(): ConnectionStatusInfo {
    return this.status;
  }

  public getSettings(): Required<GlobalConnectionSettings> {
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

  /**
   * Applies new connection settings. Reconnects only when host, port or
   * password actually changed, so a Property Inspector re-saving the same
   * values never drops a healthy connection. Returns true when it reconnected.
   */
  public updateSettings(next: GlobalConnectionSettings): boolean {
    const before = this.settings;
    this.applySettingsObject(next);
    const changed =
      before.host !== this.settings.host ||
      before.port !== this.settings.port ||
      before.password !== this.settings.password;
    if (changed && !this.stopped) {
      this.reconnectNow();
      return true;
    }
    return false;
  }

  /**
   * Throttled reconnect for user gestures (dial ticks, key presses) while
   * offline: at most one forced reconnect per `minIntervalMs`, and never while
   * halted on a wrong password (OBS would log a failed login per gesture).
   */
  public nudgeReconnect(minIntervalMs = 2000, now = Date.now()): boolean {
    if (this.isConnected() || this.haltedReason === "wrong_password") {
      return false;
    }
    if (now - this.lastNudgeAt < minIntervalMs) {
      return false;
    }
    this.lastNudgeAt = now;
    this.reconnectNow();
    return true;
  }

  public reconnectNow(): void {
    this.stopped = false;
    this.haltedReason = "none";
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.cleanupSocket();
    this.openSocket();
  }

  public async getState(): Promise<TState> {
    const res = await this.callVendor<TState>("get_state", undefined, false);
    this.emit("stateChanged", res);
    return res;
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
      throw new ObsVendorError(
        `Empty screenshot returned for source '${sourceName}'.`,
        500
      );
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
        vendorName: this.vendorName,
        requestType,
        ...(requestData !== undefined ? { requestData } : {})
      });
    } catch (err) {
      const vendorErr = this.normalizeVendorError(err);
      this.emit("vendorError", vendorErr.comment);
      if (resyncOnError && requestType !== "get_state" && this.identified) {
        void this.getState().catch(() => {});
      }
      throw vendorErr;
    }

    const innerData = (outerResponse.responseData ?? {}) as Record<
      string,
      unknown
    >;
    if (typeof innerData.error === "string" && innerData.error.length > 0) {
      const comment =
        typeof innerData.comment === "string" && innerData.comment.length > 0
          ? innerData.comment
          : innerData.error;
      const vendorErr = this.createVendorError(comment, 400);
      this.emit("vendorError", comment);
      if (resyncOnError && requestType !== "get_state" && this.identified) {
        void this.getState().catch(() => {});
      }
      throw vendorErr;
    }

    return innerData as TResponse;
  }

  protected createVendorError(comment: string, code = -1): ObsVendorError {
    return new ObsVendorError(comment, code);
  }

  protected normalizeVendorError(err: unknown): ObsVendorError {
    return err instanceof ObsVendorError
      ? err
      : this.createVendorError(String(err), -1);
  }

  protected handleVendorEventPayload(
    vendorEventType: string,
    vendorEventData: Record<string, unknown>
  ): void {
    if (vendorEventType === "state_changed") {
      const state = vendorEventData as unknown as TState;
      this.emit("stateChanged", state);
      if (typeof state.studio_mode === "boolean") {
        void this.refreshSceneNames(state.studio_mode);
      }
    }
  }

  private applySettingsObject(next: GlobalConnectionSettings): void {
    const host =
      (next.host ?? DEFAULT_GLOBAL_CONNECTION_SETTINGS.host).trim() ||
      DEFAULT_GLOBAL_CONNECTION_SETTINGS.host;
    const rawPort = Number(
      next.port ?? DEFAULT_GLOBAL_CONNECTION_SETTINGS.port
    );
    const port =
      Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535
        ? rawPort
        : DEFAULT_GLOBAL_CONNECTION_SETTINGS.port;
    const password =
      next.password ?? DEFAULT_GLOBAL_CONNECTION_SETTINGS.password;
    this.settings = { host, port, password };
  }

  protected setStatus(next: ConnectionStatusInfo): void {
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
      msg = JSON.parse(jsonText) as {
        op?: number;
        d?: Record<string, unknown>;
      };
    } catch {
      return;
    }

    const op = msg.op;
    const d = msg.d ?? {};

    if (op === 0) {
      // Hello
      const authObj = d.authentication as
        | { challenge?: string; salt?: string }
        | undefined;
      let authentication: string | undefined;
      if (
        authObj &&
        typeof authObj.challenge === "string" &&
        typeof authObj.salt === "string"
      ) {
        if (!this.settings.password) {
          authentication = computeObsWebSocketAuth(
            "",
            authObj.salt,
            authObj.challenge
          );
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

  protected async initializeAfterIdentify(): Promise<void> {
    try {
      const versionData = await this.sendObsRequest("GetVersion");
      const obsVersion =
        typeof versionData.obsVersion === "string"
          ? versionData.obsVersion
          : typeof versionData.obsStudioVersion === "string"
            ? versionData.obsStudioVersion
            : "OBS";

      let state: TState;
      try {
        state = await this.callVendor<TState>("get_state", undefined, false);
      } catch (err) {
        const vendorErr = err instanceof ObsVendorError ? err : null;
        if (
          vendorErr &&
          (vendorErr.code === 600 ||
            vendorErr.code === 604 ||
            vendorErr.code === 207)
        ) {
          this.haltedReason = "missing_plugin";
          this.clearReconnectTimer();
          this.setStatus(
            makeMissingPluginStatus(this.pluginDisplayName, this.pluginReleaseUrl)
          );
          return;
        }
        throw err;
      }

      if (
        typeof state.api_version === "number" &&
        state.api_version > this.supportedApiVersion
      ) {
        const mismatchSentence = `${this.pluginDisplayName} API version ${state.api_version} is newer than supported version ${this.supportedApiVersion}. Update ${this.surfaceDisplayName}.`;
        this.setStatus({
          kind: "version_mismatch",
          sentence: mismatchSentence,
          cellReason: `Update ${this.surfaceDisplayName}`,
          obsVersion,
          fadesterVersion: state.version
        });
        return;
      }

      this.reconnectAttempt = 0;
      this.haltedReason = "none";
      const buildCommit =
        typeof state.build?.commit === "string" && state.build.commit.trim().length > 0
          ? state.build.commit.trim()
          : undefined;
      const versionLabel = buildCommit
        ? `${state.version} (${buildCommit})`
        : state.version;
      this.setStatus({
        kind: "connected",
        sentence: `Connected: OBS ${obsVersion}, ${this.pluginDisplayName} ${versionLabel}`,
        cellReason: "",
        obsVersion,
        fadesterVersion: state.version,
        ...(buildCommit ? { buildCommit } : {}),
        ...(typeof state.profile === "string" ? { profile: state.profile } : {}),
        ...(typeof state.profile_tier === "string"
          ? { profileTier: state.profile_tier }
          : {})
      });
      this.emit("stateChanged", state);
      await this.refreshSceneNames(state.studio_mode);
    } catch {
      // Socket closed or initial request failed before ready
    }
  }

  protected async refreshSceneNames(studioMode: boolean): Promise<void> {
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

  protected handleObsEvent(d: Record<string, unknown>): void {
    const eventType = d.eventType;
    const eventData = (d.eventData ?? {}) as Record<string, unknown>;
    this.emit("obsEvent", eventType, eventData);

    if (eventType === "VendorEvent" && eventData.vendorName === this.vendorName) {
      const vendorEventType = String(eventData.eventType ?? "");
      const vendorEventData = (eventData.eventData ?? {}) as Record<
        string,
        unknown
      >;
      this.handleVendorEventPayload(vendorEventType, vendorEventData);
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
      entry.reject(this.createVendorError(comment, code));
      return;
    }

    const responseData = (d.responseData ?? {}) as Record<string, unknown>;
    entry.resolve(responseData);
  }

  public sendObsRequest(
    requestType: string,
    requestData?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.identified) {
        reject(this.createVendorError(this.status.sentence, 500));
        return;
      }

      const requestId = `req_${this.nextRequestId++}`;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          this.createVendorError(
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
    if (
      this.stopped ||
      this.haltedReason !== "none" ||
      this.reconnectTimer !== null
    ) {
      return;
    }
    const exp = Math.min(this.reconnectAttempt, 6);
    const delay = Math.min(
      this.baseReconnectMs * Math.pow(2, exp),
      this.maxReconnectMs
    );
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
      entry.reject(this.createVendorError(reason, 500));
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
      // `ws` reports "closed before the connection was established" as an
      // asynchronous 'error' when a CONNECTING socket is terminated; with no
      // listener that would be an uncaught exception and crash the plugin.
      s.on("error", () => {});
      try {
        s.terminate();
      } catch {
        // Ignore
      }
    }
  }
}
