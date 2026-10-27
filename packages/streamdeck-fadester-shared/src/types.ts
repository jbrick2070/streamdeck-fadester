// SPDX-License-Identifier: GPL-2.0-or-later

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

export type SurfaceTargetMode =
  | "unassigned"
  | "tbar"
  | "crossfade_ab"
  | "layer_opacity"
  | "audio_volume";

export type SurfaceTakeoverPending = "none" | "up" | "down";

export interface SurfaceSlotBase {
  id: string;
  name: string;
  target_mode: SurfaceTargetMode;
  source_a: string;
  source_b: string;
  value: number;
  takeover_pending: SurfaceTakeoverPending;
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
  api_version?: number;
  studio_mode: boolean;
  device: TDevice;
  slots: TSlot[];
}

export interface SurfaceSlotValueChangeEvent {
  slot: string;
  value: number;
  origin: "midi" | "ui" | "api" | "auto_fade" | (string & {});
}

export interface ScreenshotProvider {
  isConnected(): boolean;
  getSourceScreenshot(
    sourceName: string,
    width?: number,
    height?: number
  ): Promise<string>;
}
