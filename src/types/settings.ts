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

/** New direct controls follow automatic OBS targets. Explicit empty choices
 * remain unconfigured, and manual bindings always take precedence. */
export type ObsFaderTarget = "unconfigured" | "input_volume" | "tbar";
export type ObsFaderPressAction =
  | "finish_transition"
  | "next_blend"
  | "previous_blend"
  | "normal_blend"
  | "toggle_source"
  | "next_blend_and_finish"
  | "none";

export interface ObsFaderDialSettings {
  [key: string]: string | number | boolean | undefined;
  target?: ObsFaderTarget;
  inputName?: string;
  stepPerTick?: DialStepPerTick;
  acceleration?: boolean;
  labelOverride?: string;
  autoQueueNextScene?: boolean;
  pressAction?: ObsFaderPressAction;
}

export const DEFAULT_OBS_FADER_DIAL_SETTINGS: Required<ObsFaderDialSettings> = {
  target: "input_volume",
  inputName: "__audio_main__",
  stepPerTick: 0.02,
  acceleration: true,
  labelOverride: "",
  autoQueueNextScene: false,
  pressAction: "finish_transition"
};

export interface ObsFadeKeySettings {
  [key: string]: string | number | boolean | undefined;
  inputName?: string;
  to?: 0 | 1;
  durationMs?: number;
  labelOverride?: string;
}

export const DEFAULT_OBS_FADE_KEY_SETTINGS: Required<ObsFadeKeySettings> = {
  inputName: "__audio_main__",
  to: 1,
  durationMs: 1000,
  labelOverride: ""
};

export type ObsSceneOperation = "preview" | "cut" | "transition";

export interface ObsSceneTransitionKeySettings {
  [key: string]: string | number | boolean | undefined;
  /** A scene name, __next_scene__, or __previous_scene__. */
  sceneTarget?: string;
  operation?: ObsSceneOperation;
  /** __current_transition__, __cut__, or an OBS transition name. */
  transitionName?: string;
  labelOverride?: string;
}

export const DEFAULT_OBS_SCENE_TRANSITION_KEY_SETTINGS: Required<ObsSceneTransitionKeySettings> = {
  sceneTarget: "__next_scene__",
  operation: "transition",
  transitionName: "__current_transition__",
  labelOverride: ""
};

export function normalizeDurationMs(raw: unknown, fallback = 1000): number {
  const rounded = Math.round(Number(raw ?? fallback));
  if (!Number.isFinite(rounded)) {
    return fallback;
  }
  return rounded === 0 ? 0 : Math.max(50, Math.min(20000, rounded));
}
