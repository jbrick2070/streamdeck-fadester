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
import { LocalText, LocalizedError, ownText, verbatimText } from "../i18n.js";
import { statusSentenceText, statusSignature } from "../status-text.js";

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

/**
 * A failed OBS or vendor request. A plain string is an OBS or Midi Fadester
 * text and is shown verbatim; our own messages are a key with parameters.
 * `comment` keeps the English (or verbatim) wording for logs and tests.
 */
export class ObsVendorError extends LocalizedError {
  public readonly code: number;
  public readonly comment: string;

  public constructor(comment: string | LocalText, code = -1) {
    super(comment);
    this.name = "ObsVendorError";
    this.code = code;
    this.comment = this.message;
  }
}

/**
 * obs-websocket's NotReady: OBS answers every request with it until OBS has finished loading (and during a scene
 * collection change), while its websocket already takes clients. Such a request may be tried again after a delay.
 */
export const OBS_NOT_READY = 207;

export function isObsNotReady(err: unknown): boolean {
  return err instanceof ObsVendorError && err.code === OBS_NOT_READY;
}

export interface ObsVendorClientOptions {
  vendorName?: string;
  /** Additional obs-websocket vendor names whose `VendorEvent` payloads this client accepts. */
  extraVendorNames?: readonly string[];
  supportedApiVersion?: number;
  pluginDisplayName?: string;
  pluginReleaseUrl?: string;
  surfaceDisplayName?: string;
  baseReconnectMs?: number;
  maxReconnectMs?: number;
  requestTimeoutMs?: number;
  /** First wait before a first sync that met NotReady (207) is tried again; it doubles up to 2 s. */
  notReadyRetryMs?: number;
  /** How often the link to OBS is checked with a ping. 0 turns the check off. */
  keepaliveMs?: number;
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
  return { kind: "obs_unreachable" };
}

export function makeWrongPasswordStatus(): ConnectionStatusInfo {
  return { kind: "wrong_password" };
}

export function makeMissingPluginStatus(
  pluginDisplayName = "Midi Fadester",
  linkUrl = "https://github.com/jbrick2070/midi-fadester/releases"
): ConnectionStatusInfo {
  return {
    kind: "missing_plugin",
    pluginName: pluginDisplayName,
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
  protected readonly acceptedVendorNames: ReadonlySet<string>;
  protected readonly supportedApiVersion: number;
  protected readonly pluginDisplayName: string;
  protected readonly pluginReleaseUrl: string;
  protected readonly surfaceDisplayName: string;
  protected readonly baseReconnectMs: number;
  protected readonly maxReconnectMs: number;
  protected readonly notReadyRetryMs: number;
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
  protected readonly keepaliveMs: number;
  /** Counts every message and pong from OBS: a count that has not moved means OBS said nothing meanwhile. */
  private heard = 0;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    initialSettings?: GlobalConnectionSettings,
    options?: ObsVendorClientOptions
  ) {
    super();
    if (initialSettings) {
      this.applySettingsObject(initialSettings);
    }
    this.vendorName = options?.vendorName ?? "midi-fadester";
    this.acceptedVendorNames = new Set([
      this.vendorName,
      ...(options?.extraVendorNames ?? [])
    ]);
    this.supportedApiVersion = options?.supportedApiVersion ?? 1;
    this.pluginDisplayName = options?.pluginDisplayName ?? "Midi Fadester";
    this.pluginReleaseUrl =
      options?.pluginReleaseUrl ??
      "https://github.com/jbrick2070/midi-fadester/releases";
    this.surfaceDisplayName = options?.surfaceDisplayName ?? "Fadester for OBS";
    this.baseReconnectMs = options?.baseReconnectMs ?? 1000;
    this.maxReconnectMs = options?.maxReconnectMs ?? 10000;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 4000;
    this.notReadyRetryMs = options?.notReadyRetryMs ?? 250;
    this.keepaliveMs = options?.keepaliveMs ?? 20000;
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

  /**
   * The socket is open and OBS has identified it: requests can be sent now,
   * even while the catalog read after the identify still runs (the status
   * becomes "connected" only after it). Visual Panic sends on this alone.
   */
  public isIdentified(): boolean {
    return this.identified && this.ws?.readyState === WebSocket.OPEN;
  }

  /** A socket is opening or open (the handshake may still run): a reconnect now would only restart it. */
  public hasLiveSocket(): boolean {
    return this.ws !== null && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN);
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
        ownText("errorEmptyScreenshot", { source: sourceName }),
        500
      );
    }
    return imageData;
  }

  public async callNamedVendor<TResponse>(
    vendorName: string,
    requestType: string,
    requestData?: Record<string, unknown>
  ): Promise<TResponse> {
    let outerResponse: Record<string, unknown>;
    try {
      outerResponse = await this.sendObsRequest("CallVendorRequest", {
        vendorName,
        requestType,
        ...(requestData !== undefined ? { requestData } : {})
      });
    } catch (err) {
      throw this.normalizeVendorError(err);
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
      throw this.createVendorError(comment, 400);
    }

    return innerData as TResponse;
  }

  public async callVendor<TResponse>(
    requestType: string,
    requestData?: Record<string, unknown>,
    resyncOnError = true
  ): Promise<TResponse> {
    try {
      return await this.callNamedVendor<TResponse>(
        this.vendorName,
        requestType,
        requestData
      );
    } catch (err) {
      const vendorErr = this.normalizeVendorError(err);
      this.emit("vendorError", vendorErr.comment, vendorErr.text);
      if (resyncOnError && requestType !== "get_state" && this.identified) {
        void this.getState().catch(() => {});
      }
      throw vendorErr;
    }
  }

  protected createVendorError(comment: string | LocalText, code = -1): ObsVendorError {
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
    const changed = statusSignature(this.status) !== statusSignature(next);
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
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      // An address ws cannot parse (a host typed with its port, "127.0.0.1:4455"; a bare IPv6 address) throws here,
      // synchronously. No socket and no throw: the status says OBS cannot be reached; a corrected Host reconnects.
      this.setStatus(makeUnreachableStatus());
      return;
    }
    this.ws = socket;
    this.watchLink(socket);

    socket.on("message", (raw: WebSocket.RawData) => {
      if (this.ws !== socket) {
        return;
      }
      this.heard++;
      this.handleMessage(raw.toString("utf8"));
    });

    socket.on("pong", () => {
      if (this.ws === socket) this.heard++;
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
      this.clearLinkWatch();
      this.rejectAllPending(ownText("errorDisconnected"));

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
      void this.syncAfterIdentify(this.ws);
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

  /**
   * OBS's websocket takes clients before OBS has finished loading and answers every request with NotReady (207) until it
   * has. A first sync that meets NotReady is tried again on the same socket: otherwise the client would stay identified
   * but never connected, and nothing would try again, because the socket stays open.
   */
  private async syncAfterIdentify(socket: WebSocket | null): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.initializeAfterIdentify();
        return;
      } catch (err) {
        if (!isObsNotReady(err)) {
          // A request of the first sync failed on a socket that is still open (a timeout, an error answer): drop it, so
          // the close handler reports OBS unreachable and reconnects with backoff. A closed socket is the close handler's.
          if (!this.stopped && socket !== null && this.ws === socket && socket.readyState === WebSocket.OPEN) socket.terminate();
          return;
        }
      }
      const delay = Math.min(this.notReadyRetryMs * 2 ** Math.min(attempt, 3), 2000);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (this.stopped || !socket || this.ws !== socket || socket.readyState !== WebSocket.OPEN || !this.identified) {
        return;
      }
    }
  }

  protected async initializeAfterIdentify(): Promise<void> {
    let ready = false;
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
        // 600 or 604: no such vendor or request. NotReady (207) means OBS is still loading, not a missing plugin:
        // it is rethrown below, and syncAfterIdentify tries again.
        if (
          vendorErr &&
          (vendorErr.code === 600 || vendorErr.code === 604)
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
        this.setStatus({
          kind: "version_mismatch",
          pluginName: this.pluginDisplayName,
          surfaceName: this.surfaceDisplayName,
          apiVersion: state.api_version,
          supportedApiVersion: this.supportedApiVersion,
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
      this.setStatus({
        kind: "connected",
        pluginName: this.pluginDisplayName,
        obsVersion,
        fadesterVersion: state.version,
        ...(buildCommit ? { buildCommit } : {}),
        ...(typeof state.profile === "string" ? { profile: state.profile } : {}),
        ...(typeof state.profile_tier === "string"
          ? { profileTier: state.profile_tier }
          : {})
      });
      ready = true;
      this.emit("stateChanged", state);
      await this.refreshSceneNames(state.studio_mode);
    } catch (err) {
      // Before the connection is declared ready, every failure goes back to syncAfterIdentify (NotReady: try again on
      // this socket; anything else: drop the socket). After that, a listener's error must not drop a working connection.
      if (!ready) throw err;
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

    if (eventType === "VendorEvent") {
      const vendorName =
        typeof eventData.vendorName === "string" ? eventData.vendorName : "";
      if (this.acceptedVendorNames.has(vendorName)) {
        const vendorEventType = String(eventData.eventType ?? "");
        const vendorEventData = (eventData.eventData ?? {}) as Record<
          string,
          unknown
        >;
        if (vendorName === this.vendorName) {
          this.handleVendorEventPayload(vendorEventType, vendorEventData);
        }
        this.emit(
          "namedVendorEvent",
          vendorName,
          vendorEventType,
          vendorEventData
        );
        return;
      }
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
      // OBS's own comment is shown as OBS wrote it; only our fallback is ours.
      const comment: LocalText =
        typeof status.comment === "string" && status.comment.length > 0
          ? verbatimText(status.comment)
          : ownText("errorRequestFailed", { code });
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
        reject(this.createVendorError(statusSentenceText(this.status), 500));
        return;
      }

      const requestId = `req_${this.nextRequestId++}`;
      const socket = this.ws;
      const heardWhenSent = this.heard;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        // Not one word from OBS since the request left: the link itself may be dead.
        if (this.heard === heardWhenSent) this.probeLink(socket);
        reject(
          this.createVendorError(
            ownText("errorRequestTimeout", { request: requestType, ms: this.requestTimeoutMs }),
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

  private rejectAllPending(reason: LocalText): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(this.createVendorError(reason, 500));
    }
    this.pending.clear();
  }

  /**
   * A connection can die without a close (sleep, a pulled cable, a frozen OBS): the socket stays open, every request
   * times out, and nothing reconnects. Every `keepaliveMs` the link is checked with one ping.
   */
  private watchLink(socket: WebSocket): void {
    this.clearLinkWatch();
    if (this.keepaliveMs <= 0) return;
    this.keepaliveTimer = setInterval(() => this.probeLink(socket), this.keepaliveMs);
    this.keepaliveTimer.unref?.();
  }

  /**
   * One ping. OBS's websocket answers it from its own thread, also while OBS is busy with a slow request, so a link
   * with no pong and no message is dropped; the close handler then reports OBS unreachable and reconnects.
   */
  private probeLink(socket: WebSocket): void {
    if (this.stopped || this.ws !== socket || socket.readyState !== WebSocket.OPEN || this.probeTimer !== null) return;
    const heardWhenAsked = this.heard;
    try {
      socket.ping();
    } catch {
      socket.terminate();
      return;
    }
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (this.ws === socket && socket.readyState === WebSocket.OPEN && this.heard === heardWhenAsked) socket.terminate();
    }, Math.min(this.requestTimeoutMs, 3000));
    this.probeTimer.unref?.();
  }

  private clearLinkWatch(): void {
    if (this.keepaliveTimer !== null) clearInterval(this.keepaliveTimer);
    if (this.probeTimer !== null) clearTimeout(this.probeTimer);
    this.keepaliveTimer = null;
    this.probeTimer = null;
  }

  private cleanupSocket(): void {
    this.clearLinkWatch();
    this.rejectAllPending(ownText("errorConnectionReset"));
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
