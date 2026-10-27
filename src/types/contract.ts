// SPDX-License-Identifier: GPL-2.0-or-later

export const FADESTER_VENDOR_NAME = "midi-fadester" as const;
export const FADESTER_API_VERSION = 1 as const;
export const MIDI_FADESTER_RELEASE_URL = "https://github.com/jbrick2070/midi-fadester/releases" as const;

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
  | (string & {});

export type SlotKind = "crossfader" | "fader" | "master";

export type TargetMode =
  | "unassigned"
  | "tbar"
  | "crossfade_ab"
  | "layer_opacity"
  | "audio_volume";

export type CurveType =
  | "dip_free"
  | "full_center"
  | "equal_power"
  | "linear"
  | "cut";

export type TakeoverPending = "none" | "up" | "down";

export type FaderChangeOrigin = "midi" | "ui" | "api" | "auto_fade";

export interface FadesterDeviceState {
  name: string;
  connected: boolean;
  error: string;
}

export interface FadesterSlot {
  id: SlotId;
  name: string;
  kind: SlotKind;
  target_mode: TargetMode;
  source_a: string;
  source_b: string;
  curve: CurveType;
  afv: boolean;
  value: number;
  takeover_pending: TakeoverPending;
  label: string;
  available: boolean;
  reason: string;
}

export interface GetStateResponse {
  version: string;
  api_version?: number;
  studio_mode: boolean;
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
  target_mode?: TargetMode;
  source_a?: string;
  source_b?: string;
  curve?: CurveType;
  afv?: boolean;
}

export type SetSlotResponse = FadesterSlot;

export interface LoadProfileRequest {
  name: string;
}

export interface LoadProfileResponse {
  loaded: string | boolean;
}

export interface FaderChangedEvent {
  slot: string;
  value: number;
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
  linkUrl?: string;
}
