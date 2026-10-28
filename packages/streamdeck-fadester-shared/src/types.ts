// SPDX-License-Identifier: GPL-2.0-or-later

export type ConnectionStateKind =
  | "connected"
  | "obs_unreachable"
  | "wrong_password"
  | "missing_plugin"
  | "version_mismatch";

export type SurfaceProfileTier = "verified" | "beta" | "custom" | (string & {});

export interface SurfaceBuildInfo {
  commit: string;
  built_at: string;
}

export interface ConnectionStatusInfo {
  kind: ConnectionStateKind;
  sentence: string;
  cellReason: string;
  obsVersion?: string;
  fadesterVersion?: string;
  buildCommit?: string;
  profile?: string;
  profileTier?: SurfaceProfileTier;
  linkUrl?: string;
}

export interface GlobalConnectionSettings {
  host?: string;
  port?: number;
  password?: string;
}

export const DEFAULT_GLOBAL_CONNECTION_SETTINGS: Required<GlobalConnectionSettings> = {
  host: "127.0.0.1",
  port: 4455,
  password: ""
};

export type SurfaceSlotKind =
  | "crossfader"
  | "fader"
  | "master"
  | "fx"
  | (string & {});

export type SurfaceTargetMode =
  | "unassigned"
  | "tbar"
  | "crossfade_ab"
  | "layer_opacity"
  | "audio_volume"
  | "filter_param";

export type SurfaceTakeoverPending = "none" | "up" | "down";

export interface SurfaceSlotBase {
  id: string;
  name: string;
  kind?: SurfaceSlotKind;
  enabled?: boolean;
  target_mode: SurfaceTargetMode;
  scene?: string;
  source_a: string;
  source_b: string;
  filter_name?: string;
  filter_prop?: string;
  from_val?: number;
  to_val?: number;
  bypass_at_zero?: boolean;
  value: number;
  display_value?: string;
  cal_min?: number;
  cal_max?: number;
  takeover_pending: SurfaceTakeoverPending;
  parked?: boolean;
  label: string;
  available: boolean;
  reason: string;
}

export interface SurfaceDeviceState {
  name: string;
  connected: boolean;
  error: string;
}

export interface SurfaceStatePayload<
  TSlot extends SurfaceSlotBase = SurfaceSlotBase,
  TDevice extends SurfaceDeviceState = SurfaceDeviceState
> {
  version: string;
  build?: SurfaceBuildInfo;
  api_version?: number;
  studio_mode: boolean;
  profile?: string;
  profile_display_name?: string;
  profile_tier?: SurfaceProfileTier;
  device: TDevice;
  slots: TSlot[];
}

export interface SurfaceSlotValueChangeEvent {
  slot: string;
  value: number;
  display_value?: string;
  origin: "midi" | "ui" | "api" | "auto_fade" | "obs" | (string & {});
}

export interface ScreenshotProvider {
  isConnected(): boolean;
  getSourceScreenshot(
    sourceName: string,
    width?: number,
    height?: number
  ): Promise<string>;
}
