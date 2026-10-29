// SPDX-License-Identifier: GPL-2.0-or-later
import {
  AutoFadeRequest,
  AutoFadeResponse,
  ConnectionStatusInfo,
  FADESTER_API_VERSION,
  FADESTER_VENDOR_NAME,
  FaderChangedEvent,
  GetCatalogRequest,
  GetCatalogResponse,
  GetStateResponse,
  LoadProfileRequest,
  LoadProfileResponse,
  MIDI_FADESTER_RELEASE_URL,
  NudgeFaderRequest,
  NudgeFaderResponse,
  ResetFxRequest,
  ResetFxResponse,
  SetFaderValueRequest,
  SetFaderValueResponse,
  SetSlotRequest,
  SetSlotResponse,
  StateChangedEvent
} from "../types/contract.js";
import { FadesterGlobalSettings } from "../types/settings.js";
import {
  OBS_WS_DEFAULT_SUBSCRIPTIONS,
  OBS_WS_EVENT_SUB_SCENES,
  OBS_WS_EVENT_SUB_UI,
  OBS_WS_EVENT_SUB_VENDORS,
  ObsVendorClient,
  ObsVendorClientOptions,
  ObsVendorError,
  computeObsWebSocketAuth,
  makeMissingPluginStatus as makeSharedMissingPluginStatus,
  makeUnreachableStatus,
  makeWrongPasswordStatus
} from "../../packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.js";

export {
  FADESTER_VENDOR_NAME,
  FADESTER_API_VERSION,
  MIDI_FADESTER_RELEASE_URL,
  OBS_WS_EVENT_SUB_SCENES,
  OBS_WS_EVENT_SUB_UI,
  OBS_WS_EVENT_SUB_VENDORS,
  OBS_WS_DEFAULT_SUBSCRIPTIONS,
  computeObsWebSocketAuth,
  makeUnreachableStatus,
  makeWrongPasswordStatus
};

export function makeMissingPluginStatus(): ConnectionStatusInfo {
  return makeSharedMissingPluginStatus(
    "Midi Fadester",
    MIDI_FADESTER_RELEASE_URL
  );
}

export class FadesterVendorError extends ObsVendorError {
  public constructor(comment: string, code = -1) {
    super(comment, code);
    this.name = "FadesterVendorError";
  }
}

export type FadesterClientOptions = Pick<
  ObsVendorClientOptions,
  "baseReconnectMs" | "maxReconnectMs" | "requestTimeoutMs"
>;

export class FadesterClient extends ObsVendorClient<GetStateResponse> {
  private legacySurfaceStarted = false;

  public constructor(
    initialSettings?: FadesterGlobalSettings,
    options?: FadesterClientOptions
  ) {
    super(initialSettings, {
      ...options,
      vendorName: FADESTER_VENDOR_NAME,
      supportedApiVersion: FADESTER_API_VERSION,
      pluginDisplayName: "Midi Fadester",
      pluginReleaseUrl: MIDI_FADESTER_RELEASE_URL,
      surfaceDisplayName: "Fadester for OBS"
    });
  }

  public async setFaderValue(
    req: SetFaderValueRequest
  ): Promise<SetFaderValueResponse> {
    return this.callVendor<SetFaderValueResponse>("set_fader_value", {
      slot: req.slot,
      value: req.value,
      ...(req.release !== undefined ? { release: req.release } : {})
    });
  }

  /** Starts the optional enhanced backend once a legacy action is actually in
   * use. Direct OBS users should never get a missing-Midi-Fadester status. */
  public ensureStarted(): void {
    if (this.legacySurfaceStarted) {
      return;
    }
    this.legacySurfaceStarted = true;
    this.start();
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

  public async loadProfile(
    req: LoadProfileRequest
  ): Promise<LoadProfileResponse> {
    return this.callVendor<LoadProfileResponse>("load_profile", {
      name: req.name
    });
  }

  public async getCatalog(
    req?: GetCatalogRequest
  ): Promise<GetCatalogResponse> {
    return this.callVendor<GetCatalogResponse>(
      "get_catalog",
      req?.source !== undefined ? { source: req.source } : {}
    );
  }

  public async resetFx(req?: ResetFxRequest): Promise<ResetFxResponse> {
    return this.callVendor<ResetFxResponse>(
      "reset_fx",
      req?.ms !== undefined ? { ms: req.ms } : {}
    );
  }

  protected override createVendorError(
    comment: string,
    code = -1
  ): ObsVendorError {
    return new FadesterVendorError(comment, code);
  }

  protected override handleVendorEventPayload(
    vendorEventType: string,
    vendorEventData: Record<string, unknown>
  ): void {
    if (vendorEventType === "fader_changed") {
      const ev: FaderChangedEvent = {
        slot: String(vendorEventData.slot ?? ""),
        value: Number(vendorEventData.value ?? 0),
        ...(typeof vendorEventData.display_value === "string"
          ? { display_value: vendorEventData.display_value }
          : {}),
        origin:
          (vendorEventData.origin as FaderChangedEvent["origin"]) ?? "api"
      };
      this.emit("faderChanged", ev);
      return;
    }

    if (vendorEventType === "state_changed") {
      const state = vendorEventData as unknown as StateChangedEvent;
      this.emit("stateChanged", state);
      if (typeof state.studio_mode === "boolean") {
        void this.refreshSceneNames(state.studio_mode);
      }
    }
  }
}
