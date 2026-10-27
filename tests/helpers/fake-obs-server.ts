// SPDX-License-Identifier: GPL-2.0-or-later
import { WebSocketServer, WebSocket } from "ws";
import { AddressInfo } from "node:net";
import {
  computeObsWebSocketAuth,
  FADESTER_VENDOR_NAME
} from "../../src/obs/fadester-client.js";
import {
  FadesterSlot,
  GetStateResponse
} from "../../src/types/contract.js";

export interface FakeObsServerOptions {
  password?: string;
  obsVersion?: string;
  fadesterVersion?: string;
  apiVersion?: number;
  missingPlugin?: boolean;
  studioMode?: boolean;
  screenshotDelayMs?: number;
}

export function createDefaultSlots(studioMode = true): FadesterSlot[] {
  return [
    {
      id: "crossfader",
      name: "Crossfader",
      kind: "crossfader",
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
    {
      id: "master",
      name: "Master",
      kind: "master",
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
}

export class FakeObsServer {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private readonly salt = "fadester_salt_1234";
  private readonly challenge = "fadester_challenge_5678";

  public password: string;
  public obsVersion: string;
  public fadesterVersion: string;
  public apiVersion: number;
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
    "Desktop Audio"
  ]);

  public vendorCallLog: Array<{
    requestType: string;
    requestData?: Record<string, unknown>;
  }> = [];
  public screenshotCallCount = 0;
  public activeScreenshotRequests = 0;
  public maxConcurrentScreenshots = 0;
  public connectionCount = 0;

  public constructor(opts?: FakeObsServerOptions) {
    this.password = opts?.password ?? "";
    this.obsVersion = opts?.obsVersion ?? "33.0.0";
    this.fadesterVersion = opts?.fadesterVersion ?? "0.1.0";
    this.apiVersion = opts?.apiVersion ?? 1;
    this.missingPlugin = opts?.missingPlugin ?? false;
    this.studioMode = opts?.studioMode ?? true;
    this.screenshotDelayMs = opts?.screenshotDelayMs ?? 5;
    this.slots = createDefaultSlots(this.studioMode);
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

  public getStatePayload(): GetStateResponse {
    return {
      version: this.fadesterVersion,
      api_version: this.apiVersion,
      studio_mode: this.studioMode,
      device: {
        name: "APC40 mkII",
        connected: true,
        error: ""
      },
      slots: this.slots.map((s) => ({ ...s }))
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
      const name = String(vReqData.name ?? "");
      if (name !== "apc40mk2") {
        const msg = `Profile '${name}' does not exist. Valid profiles: apc40mk2.`;
        return { error: msg, comment: msg };
      }
      return { loaded: true };
    }

    const slotId = String(vReqData.slot ?? "");
    const slot = this.slots.find((s) => s.id === slotId);
    if (!slot) {
      const msg = `Slot '${slotId}' does not exist. Valid slots: crossfader, fader_1 .. fader_8, master.`;
      return { error: msg, comment: msg };
    }

    if (vReqType === "set_fader_value") {
      const rawVal = Number(vReqData.value ?? 0);
      slot.value = Math.max(0, Math.min(1, rawVal));
      this.emitVendorEvent("fader_changed", {
        slot: slot.id,
        value: slot.value,
        origin: "api"
      });
      return { slot: slot.id, value: slot.value };
    }

    if (vReqType === "nudge_fader") {
      const delta = Number(vReqData.delta ?? 0);
      slot.value = Math.max(0, Math.min(1, Number((slot.value + delta).toFixed(4))));
      this.emitVendorEvent("fader_changed", {
        slot: slot.id,
        value: slot.value,
        origin: "api"
      });
      return { slot: slot.id, value: slot.value };
    }

    if (vReqType === "auto_fade") {
      const ms = Number(vReqData.ms ?? 0);
      const to = Number(vReqData.to ?? 1);
      if (!Number.isFinite(ms) || ms < 50 || ms > 20000) {
        const msg = "Duration 'ms' must be between 50 and 20000.";
        return { error: msg, comment: msg };
      }
      slot.value = Math.max(0, Math.min(1, to));
      this.emitVendorEvent("fader_changed", {
        slot: slot.id,
        value: slot.value,
        origin: "auto_fade"
      });
      return { slot: slot.id };
    }

    if (vReqType === "set_slot") {
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
      if (typeof vReqData.target_mode === "string") {
        slot.target_mode = vReqData.target_mode as FadesterSlot["target_mode"];
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
      this.emitVendorEvent(
        "state_changed",
        this.getStatePayload() as unknown as Record<string, unknown>
      );
      return { ...slot } as unknown as Record<string, unknown>;
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
