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

export type DialStepPerTick = 0.01 | 0.02 | 0.05;

export type DialPressAction =
  | "snap_0_100"
  | "auto_fade_1s"
  | "auto_fade_2s"
  | "cut"
  | "finish_tbar";

export type DialLongPressAction =
  | "auto_fade_3s"
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
}

export const DEFAULT_FADER_DIAL_SETTINGS: Required<FaderDialSettings> = {
  slot: "crossfader",
  stepPerTick: 0.02,
  acceleration: true,
  pressAction: "snap_0_100",
  longPressAction: "auto_fade_3s",
  showThumbnails: true
};

export interface AutoFadeKeySettings {
  [key: string]: string | number | boolean | undefined;
  slot?: string;
  to?: 0 | 1;
  durationMs?: number;
}

export const DEFAULT_AUTO_FADE_KEY_SETTINGS: Required<AutoFadeKeySettings> = {
  slot: "crossfader",
  to: 1,
  durationMs: 1000
};
