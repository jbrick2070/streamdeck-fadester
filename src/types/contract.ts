// SPDX-License-Identifier: GPL-2.0-or-later

export const FADESTER_VENDOR_NAME = "midi-fadester" as const;
export const FADESTER_API_VERSION = 1 as const;
export const MIDI_FADESTER_RELEASE_URL =
  "https://github.com/jbrick2070/midi-fadester/releases" as const;

export const CONTROLLER_PROFILES = [
  "apc40mk2",
  "apcminimk2",
  "midimix",
  "nanokontrol2",
  "launchcontrolxl",
  "generic"
] as const;

export type ControllerProfileSlug =
  | (typeof CONTROLLER_PROFILES)[number]
  | (string & {});

export type ProfileTier = "verified" | "beta" | "custom" | (string & {});

/**
 * Profile metadata as documented in API-CONTRACT.md (`load_profile`). This is
 * the contract's list, not a hardware discovery: Midi Fadester has no
 * `list_profiles` request, so only the *active* profile reported by
 * `get_state` is treated as truth about the connected desk. Only `apc40mk2`
 * is verified on physical hardware.
 */
export interface ControllerProfileMeta {
  slug: (typeof CONTROLLER_PROFILES)[number];
  displayName: string;
  tier: "verified" | "beta" | "custom";
}

export const CONTROLLER_PROFILE_META: readonly ControllerProfileMeta[] = [
  { slug: "apc40mk2", displayName: "Akai APC40 mkII", tier: "verified" },
  { slug: "apcminimk2", displayName: "Akai APC mini mk2", tier: "beta" },
  { slug: "midimix", displayName: "Akai MIDImix", tier: "beta" },
  { slug: "nanokontrol2", displayName: "Korg nanoKONTROL2", tier: "beta" },
  {
    slug: "launchcontrolxl",
    displayName: "Novation Launch Control XL",
    tier: "beta"
  },
  { slug: "generic", displayName: "Generic MIDI (Custom)", tier: "custom" }
];

export const PROFILE_TIER_LABELS: Record<string, string> = {
  verified: "Verified on hardware",
  beta: "Beta, untested on hardware",
  custom: "Custom"
};

export interface FadesterBuildInfo {
  commit: string;
  built_at: string;
}

export type SlotId =
  | "crossfader"
  | "fader_1"
  | "fader_2"
  | "fader_3"
  | "fader_4"
  | "fader_5"
  | "fader_6"
  | "fader_7"
  | "fader_8"
  | "master"
  | "fx_1"
  | "fx_2"
  | "fx_3"
  | "fx_4"
  | "fx_5"
  | "fx_6"
  | "fx_7"
  | "fx_8"
  | (string & {});

export type SlotKind = "crossfader" | "fader" | "master" | "fx";

export type TargetMode =
  | "unassigned"
  | "tbar"
  | "crossfade_ab"
  | "layer_opacity"
  | "audio_volume"
  | "filter_param";

export type CurveType =
  | "dip_free"
  | "full_center"
  | "equal_power"
  | "linear"
  | "cut";

export type TakeoverPending = "none" | "up" | "down";

export type FaderChangeOrigin =
  | "midi"
  | "ui"
  | "api"
  | "auto_fade"
  | "obs"
  | (string & {});

export interface FadesterDeviceState {
  name: string;
  connected: boolean;
  error: string;
}

export interface FadesterSlot {
  id: SlotId;
  name: string;
  kind: SlotKind;
  enabled?: boolean;
  target_mode: TargetMode;
  scene?: string;
  source_a: string;
  source_b: string;
  filter_name?: string;
  filter_prop?: string;
  from_val?: number;
  to_val?: number;
  bypass_at_zero?: boolean;
  curve: CurveType;
  afv: boolean;
  value: number;
  display_value?: string;
  cal_min?: number;
  cal_max?: number;
  takeover_pending: TakeoverPending;
  parked?: boolean;
  label: string;
  available: boolean;
  reason: string;
}

export interface GetStateResponse {
  version: string;
  build?: FadesterBuildInfo;
  api_version?: number;
  studio_mode: boolean;
  profile?: ControllerProfileSlug;
  profile_display_name?: string;
  profile_tier?: ProfileTier;
  device: FadesterDeviceState;
  slots: FadesterSlot[];
}

export interface SetFaderValueRequest {
  slot: string;
  value: number;
  release?: boolean;
}

export interface SetFaderValueResponse {
  slot: string;
  value: number;
}

export interface NudgeFaderRequest {
  slot: string;
  delta: number;
}

export interface NudgeFaderResponse {
  slot: string;
  value: number;
}

export interface AutoFadeRequest {
  slot: string;
  to: number;
  ms: number;
}

export interface AutoFadeResponse {
  slot: string;
}

export interface SetSlotRequest {
  slot: string;
  enabled?: boolean;
  target_mode?: TargetMode;
  scene?: string;
  source_a?: string;
  source_b?: string;
  filter_name?: string;
  filter_prop?: string;
  from_val?: number;
  to_val?: number;
  bypass_at_zero?: boolean;
  curve?: CurveType;
  afv?: boolean;
  cal_min?: number;
  cal_max?: number;
}

export type SetSlotResponse = FadesterSlot;

export interface LoadProfileRequest {
  name: ControllerProfileSlug;
}

export interface LoadProfileResponse {
  loaded: string | boolean;
  profile_tier?: ProfileTier;
}

export interface GetCatalogRequest {
  source?: string;
}

export interface CatalogLayerItem {
  name: string;
  has_audio: boolean;
}

export interface CatalogSceneItem {
  name: string;
  layers: CatalogLayerItem[];
}

export interface CatalogAudioSourceItem {
  name: string;
  db: number;
}

export interface CatalogFilterHostItem {
  source: string;
  is_scene: boolean;
  filter_count: number;
}

export interface CatalogOverviewResponse {
  scenes: CatalogSceneItem[];
  audio_sources: CatalogAudioSourceItem[];
  filter_hosts: CatalogFilterHostItem[];
}

export interface CatalogNumericPropertyItem {
  name: string;
  label: string;
  type: "float" | "int";
  min: number;
  max: number;
  step: number;
  suffix: string;
  current: number;
}

export interface CatalogFilterItem {
  name: string;
  type_id: string;
  enabled: boolean;
  properties: CatalogNumericPropertyItem[];
}

export interface CatalogSourceFiltersResponse {
  source: string;
  is_scene: boolean;
  filters: CatalogFilterItem[];
}

export type GetCatalogResponse =
  | CatalogOverviewResponse
  | CatalogSourceFiltersResponse;

export interface ResetFxRequest {
  ms?: number;
}

export interface ResetFxResponse {
  eligible_count: number;
  reset_count: number;
  queued_unavailable_count: number;
  ms: number;
}

export interface FaderChangedEvent {
  slot: string;
  value: number;
  display_value?: string;
  origin: FaderChangeOrigin;
}

export type StateChangedEvent = GetStateResponse;

export interface VendorErrorPayload {
  error: string;
  comment: string;
}

export type ConnectionStateKind =
  | "connected"
  | "obs_unreachable"
  | "wrong_password"
  | "missing_plugin"
  | "version_mismatch";

export interface ConnectionStatusInfo {
  kind: ConnectionStateKind;
  sentence: string;
  cellReason: string;
  obsVersion?: string;
  fadesterVersion?: string;
  buildCommit?: string;
  profile?: ControllerProfileSlug;
  profileTier?: ProfileTier;
  linkUrl?: string;
}

/** Operator-facing words for `target_mode`, per MIDI-FADESTER-UI.md. */
export const TARGET_MODE_LABELS: Record<TargetMode, string> = {
  unassigned: "Not used",
  tbar: "Switch scenes (T-bar)",
  crossfade_ab: "Mix two layers",
  layer_opacity: "Show or hide a layer",
  audio_volume: "Volume",
  filter_param: "Filter setting (FX)"
};

export const CURVE_LABELS: Record<CurveType, string> = {
  dip_free: "Dip-free (picture never darkens)",
  full_center: "Full center",
  equal_power: "Equal power",
  linear: "Linear",
  cut: "Cut"
};

/** Parses "0.4.0" style versions; returns [major, minor] or null. */
export function parseFadesterVersion(
  version: string | undefined
): [number, number] | null {
  if (!version) {
    return null;
  }
  const [majorText = "", minorText = ""] = version.split(/[.-]/, 3);
  const major = Number(majorText);
  const minor = Number(minorText);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return null;
  }
  return [major, minor];
}

/** `get_catalog` and `reset_fx` were added in Midi Fadester 0.4.0. */
export function supportsCatalogApi(
  version: string | undefined,
  slots: readonly { kind?: string }[] = []
): boolean {
  const parsed = parseFadesterVersion(version);
  if (parsed) {
    const [major, minor] = parsed;
    if (major > 0 || minor >= 4) {
      return true;
    }
  }
  return slots.some((s) => s.kind === "fx");
}
