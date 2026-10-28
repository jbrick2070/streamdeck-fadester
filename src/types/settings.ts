// SPDX-License-Identifier: GPL-2.0-or-later

export interface FadesterGlobalSettings {
  [key: string]: string | number | boolean | undefined;
  host?: string;
  port?: number;
  password?: string;
}

export const DEFAULT_GLOBAL_SETTINGS: Required<FadesterGlobalSettings> = {
  host: "127.0.0.1",
  port: 4455,
  password: ""
};

export const ALL_FX_SLOT_ID = "__all_fx__" as const;

export type DialStepPerTick = 0.005 | 0.01 | 0.02 | 0.05 | 0.1;

export type ReadoutStyle = "auto" | "percent";

export const MAX_LABEL_OVERRIDE_CHARS = 14 as const;

export type DialPressAction =
  | "snap_0_100"
  | "clean_0"
  | "auto_fade_1s"
  | "auto_fade_2s"
  | "cut"
  | "finish_tbar";

export type DialLongPressAction =
  | "auto_fade_3s"
  | "clean_all_fx"
  | "finish_tbar"
  | "none";

export interface FaderDialSettings {
  [key: string]: string | number | boolean | undefined;
  slot?: string;
  stepPerTick?: DialStepPerTick;
  acceleration?: boolean;
  pressAction?: DialPressAction;
  longPressAction?: DialLongPressAction;
  showThumbnails?: boolean;
  labelOverride?: string;
  readoutStyle?: ReadoutStyle;
}

export const DEFAULT_FADER_DIAL_SETTINGS: Required<FaderDialSettings> = {
  slot: "crossfader",
  stepPerTick: 0.02,
  acceleration: true,
  pressAction: "snap_0_100",
  longPressAction: "auto_fade_3s",
  showThumbnails: true,
  labelOverride: "",
  readoutStyle: "auto"
};

export function normalizeLabelOverride(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_OVERRIDE_CHARS);
}

export function normalizeReadoutStyle(raw: unknown): ReadoutStyle {
  return raw === "percent" ? "percent" : "auto";
}

export interface AutoFadeKeySettings {
  [key: string]: string | number | boolean | undefined;
  slot?: string;
  to?: 0 | 1;
  durationMs?: number;
  labelOverride?: string;
  readoutStyle?: ReadoutStyle;
}

export const DEFAULT_AUTO_FADE_KEY_SETTINGS: Required<AutoFadeKeySettings> = {
  slot: "crossfader",
  to: 1,
  durationMs: 1000,
  labelOverride: "",
  readoutStyle: "auto"
};
