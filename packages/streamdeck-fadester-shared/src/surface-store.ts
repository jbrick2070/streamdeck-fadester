// SPDX-License-Identifier: GPL-2.0-or-later
import { EventEmitter } from "node:events";
import {
  ConnectionStatusInfo,
  SurfaceBuildInfo,
  SurfaceDeviceState,
  SurfaceProfileTier,
  SurfaceSlotBase,
  SurfaceSlotValueChangeEvent,
  SurfaceStatePayload
} from "./types.js";
import { makeUnreachableStatus } from "./obs/obs-vendor-client.js";
import { LocalText, Translate, englishShared, verbatimText, wordText } from "./i18n.js";

export interface SurfaceEventClient extends EventEmitter {
  getStatus(): ConnectionStatusInfo;
}

export class SurfaceStore<
  TSlot extends SurfaceSlotBase = SurfaceSlotBase,
  TDevice extends SurfaceDeviceState = SurfaceDeviceState,
  TClient extends SurfaceEventClient = SurfaceEventClient
> extends EventEmitter {
  protected readonly client: TClient;
  private status: ConnectionStatusInfo = makeUnreachableStatus();
  private studioMode = false;
  private build: SurfaceBuildInfo | undefined;
  private profile = "";
  private profileDisplayName = "";
  private profileTier: SurfaceProfileTier = "";
  private device: TDevice;
  private slotList: TSlot[] = [];
  protected readonly slotMap = new Map<string, TSlot>();
  // Empty until OBS names them; the renderer words an empty name (R-I18N-2).
  private previewSceneName = "";
  private programSceneName = "";
  private lastErrorText: LocalText | null = null;

  public constructor(client: TClient, initialDevice?: TDevice) {
    super();
    this.client = client;
    this.status = client.getStatus();
    this.device =
      initialDevice ??
      ({
        name: "",
        connected: false,
        error: ""
      } as TDevice);

    client.on("statusChanged", (nextStatus: ConnectionStatusInfo) => {
      this.status = nextStatus;
      this.emit("changed");
    });

    client.on(
      "stateChanged",
      (state: SurfaceStatePayload<TSlot, TDevice>) => {
        this.studioMode = Boolean(state.studio_mode);
        this.build = state.build ? { ...state.build } : undefined;
        this.profile = typeof state.profile === "string" ? state.profile : "";
        this.profileDisplayName =
          typeof state.profile_display_name === "string"
            ? state.profile_display_name
            : "";
        this.profileTier =
          typeof state.profile_tier === "string" ? state.profile_tier : "";
        this.device =
          state.device ??
          ({
            name: "",
            connected: false,
            error: ""
          } as TDevice);
        this.slotList = Array.isArray(state.slots)
          ? state.slots.map((s) => ({ ...s }))
          : [];
        this.slotMap.clear();
        for (const s of this.slotList) {
          this.slotMap.set(s.id, s);
        }
        this.emit("changed");
      }
    );

    client.on("faderChanged", (ev: SurfaceSlotValueChangeEvent) => {
      const existing = this.slotMap.get(ev.slot);
      if (existing) {
        existing.value = Math.max(0, Math.min(1, ev.value));
        if (typeof ev.display_value === "string") {
          existing.display_value = ev.display_value;
        }
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

    client.on("vendorError", (comment: string, text?: LocalText) => {
      this.lastErrorText = text ?? verbatimText(comment);
      this.emit("vendorError", comment);
    });
  }

  public getClient(): TClient {
    return this.client;
  }

  public getStatus(): ConnectionStatusInfo {
    return this.status;
  }

  public isStudioMode(): boolean {
    return this.studioMode;
  }

  public getBuild(): SurfaceBuildInfo | undefined {
    return this.build;
  }

  public getProfile(): string {
    return this.profile;
  }

  public getProfileDisplayName(): string {
    return this.profileDisplayName;
  }

  public getProfileTier(): SurfaceProfileTier {
    return this.profileTier;
  }

  public getDevice(): TDevice {
    return this.device;
  }

  public getSlots(): TSlot[] {
    return this.slotList;
  }

  public getSlot(slotId: string): TSlot | undefined {
    return this.slotMap.get(slotId);
  }

  public getPreviewSceneName(): string {
    return this.previewSceneName;
  }

  public getProgramSceneName(): string {
    return this.programSceneName;
  }

  /** The last request error, worded now: an OBS or Midi Fadester comment verbatim, ours translated. */
  public getLastErrorComment(t: Translate = englishShared): string {
    return wordText(this.lastErrorText, t);
  }
}
