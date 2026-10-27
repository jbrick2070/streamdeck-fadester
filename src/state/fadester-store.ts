// SPDX-License-Identifier: GPL-2.0-or-later
import { EventEmitter } from "node:events";
import {
  ConnectionStatusInfo,
  FadesterDeviceState,
  FaderChangedEvent,
  FadesterSlot,
  GetStateResponse
} from "../types/contract.js";
import { FadesterClient, makeUnreachableStatus } from "../obs/fadester-client.js";

export class FadesterStore extends EventEmitter {
  private readonly client: FadesterClient;
  private status: ConnectionStatusInfo = makeUnreachableStatus();
  private studioMode = false;
  private device: FadesterDeviceState = {
    name: "",
    connected: false,
    error: ""
  };
  private slotList: FadesterSlot[] = [];
  private readonly slotMap = new Map<string, FadesterSlot>();
  private previewSceneName = "Preview";
  private programSceneName = "Program";
  private lastErrorComment = "";

  public constructor(client: FadesterClient) {
    super();
    this.client = client;
    this.status = client.getStatus();

    client.on("statusChanged", (nextStatus: ConnectionStatusInfo) => {
      this.status = nextStatus;
      this.emit("changed");
    });

    client.on("stateChanged", (state: GetStateResponse) => {
      this.studioMode = Boolean(state.studio_mode);
      this.device = state.device ?? { name: "", connected: false, error: "" };
      this.slotList = Array.isArray(state.slots)
        ? state.slots.map((s) => ({ ...s }))
        : [];
      this.slotMap.clear();
      for (const s of this.slotList) {
        this.slotMap.set(s.id, s);
      }
      this.emit("changed");
    });

    client.on("faderChanged", (ev: FaderChangedEvent) => {
      const existing = this.slotMap.get(ev.slot);
      if (existing) {
        existing.value = Math.max(0, Math.min(1, ev.value));
        if (ev.origin === "midi") {
          existing.takeover_pending = "none";
        }
        this.emit("slotValueChanged", ev.slot, existing);
      }
    });

    client.on("programSceneChanged", (sceneName: string) => {
      this.programSceneName = sceneName;
      this.emit("scenesChanged");
    });

    client.on("previewSceneChanged", (sceneName: string) => {
      this.previewSceneName = sceneName;
      this.emit("scenesChanged");
    });

    client.on("vendorError", (comment: string) => {
      this.lastErrorComment = comment;
      this.emit("vendorError", comment);
    });
  }

  public getClient(): FadesterClient {
    return this.client;
  }

  public getStatus(): ConnectionStatusInfo {
    return this.status;
  }

  public isStudioMode(): boolean {
    return this.studioMode;
  }

  public getDevice(): FadesterDeviceState {
    return this.device;
  }

  public getSlots(): FadesterSlot[] {
    return this.slotList;
  }

  public getSlot(slotId: string): FadesterSlot | undefined {
    return this.slotMap.get(slotId);
  }

  public getPreviewSceneName(): string {
    return this.previewSceneName;
  }

  public getProgramSceneName(): string {
    return this.programSceneName;
  }

  public getLastErrorComment(): string {
    return this.lastErrorComment;
  }
}
