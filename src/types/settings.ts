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

/**
 * One accent per rig page for borders, glyphs and dial bars (PLAN.md 10.4,
 * R-RIG-8); `default` draws today's Fadester violet, byte for byte. Red is not
 * offered: a solid red key means Panic, a red outline Cut.
 */
export type AccentName = "default" | "brass" | "teal" | "magenta";

export const ACCENT_NAMES: readonly AccentName[] = ["default", "brass", "teal", "magenta"];

export function normalizeAccent(raw: unknown): AccentName {
  return (ACCENT_NAMES as readonly unknown[]).includes(raw) ? raw as AccentName : "default";
}

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
export type ObsFaderTarget = "unconfigured" | "input_volume" | "tbar" | "all_inputs";
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
  accent?: AccentName;
}

export const DEFAULT_OBS_FADER_DIAL_SETTINGS: Required<ObsFaderDialSettings> = {
  target: "input_volume",
  inputName: "__audio_main__",
  stepPerTick: 0.02,
  acceleration: true,
  labelOverride: "",
  autoQueueNextScene: false,
  pressAction: "finish_transition",
  accent: "default"
};

export interface ObsFadeKeySettings {
  [key: string]: string | number | boolean | undefined;
  target?: "input_volume" | "all_inputs";
  inputName?: string;
  to?: 0 | 1;
  durationMs?: number;
  labelOverride?: string;
  accent?: AccentName;
}

export const DEFAULT_OBS_FADE_KEY_SETTINGS: Required<ObsFadeKeySettings> = {
  target: "input_volume",
  inputName: "__audio_main__",
  to: 1,
  durationMs: 1000,
  labelOverride: "",
  accent: "default"
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
  accent?: AccentName;
}

export const DEFAULT_OBS_SCENE_TRANSITION_KEY_SETTINGS: Required<ObsSceneTransitionKeySettings> = {
  sceneTarget: "__next_scene__",
  operation: "transition",
  transitionName: "__current_transition__",
  labelOverride: "",
  accent: "default"
};

/** The six Playlister transport operations; `status` only shows the state (R-PLT-1). */
export type PlaylisterOperation = "previous" | "next" | "playpause" | "stop" | "restart" | "status";

export const PLAYLISTER_OPERATIONS: readonly PlaylisterOperation[] = ["previous", "next", "playpause", "stop", "restart", "status"];

export interface PlaylisterTransportSettings {
  [key: string]: string | number | boolean | undefined;
  /** The OBS input's UUID; the only thing that resolves the target. */
  inputUuid?: string;
  operation?: PlaylisterOperation;
  /** The source's name when it was chosen, shown in the inspector only. */
  inputName?: string;
  labelOverride?: string;
  accent?: AccentName;
}

export const DEFAULT_PLAYLISTER_TRANSPORT_SETTINGS: Required<PlaylisterTransportSettings> = {
  inputUuid: "",
  operation: "playpause",
  inputName: "",
  labelOverride: "",
  accent: "default"
};

export function normalizePlaylisterOperation(raw: unknown): PlaylisterOperation {
  return (PLAYLISTER_OPERATIONS as readonly unknown[]).includes(raw)
    ? raw as PlaylisterOperation : DEFAULT_PLAYLISTER_TRANSPORT_SETTINGS.operation;
}

/** Visual Sidechain's Panic (instant) or Restore (after a hold), PLAN.md 10.3. */
export type VisualPanicOperation = "panic" | "restore";

export interface VisualPanicSettings {
  [key: string]: string | number | boolean | undefined;
  operation?: VisualPanicOperation;
  labelOverride?: string;
  /** Restore's accent; Panic is always red. */
  accent?: AccentName;
}

export const DEFAULT_VISUAL_PANIC_SETTINGS: Required<VisualPanicSettings> = {
  operation: "panic",
  labelOverride: "",
  accent: "default"
};

export function normalizeVisualPanicOperation(raw: unknown): VisualPanicOperation {
  return raw === "restore" ? "restore" : "panic";
}

/** Visual Sidechain Meter key/dial action (P1-3): tap tempo, BPM lock toggle, downbeat resync, or display-only. */
export type VisualMeterOperation = "tap_tempo" | "lock_bpm" | "resync_downbeat" | "display_only";
export const VISUAL_METER_OPERATIONS: readonly VisualMeterOperation[] = [
  "tap_tempo",
  "lock_bpm",
  "resync_downbeat",
  "display_only"
];

/** Per-action redraw rate choice in redraws per second (P1-3): 2, 5 or 10 (default 5, strictly inside 10 Hz cap). */
export type VisualMeterRefreshRate = 2 | 5 | 10;
export const VISUAL_METER_REFRESH_RATES: readonly VisualMeterRefreshRate[] = [2, 5, 10];

/** Dial rotation behaviour on Visual Sidechain Meter: 1 BPM per tick or disabled. */
export type VisualMeterDialRotate = "adjust_bpm" | "none";

export interface VisualMeterSettings {
  [key: string]: string | number | boolean | undefined;
  operation?: VisualMeterOperation;
  refreshRate?: VisualMeterRefreshRate;
  dialRotate?: VisualMeterDialRotate;
  labelOverride?: string;
  accent?: AccentName;
}

export const DEFAULT_VISUAL_METER_SETTINGS: Required<VisualMeterSettings> = {
  operation: "tap_tempo",
  refreshRate: 5,
  dialRotate: "adjust_bpm",
  labelOverride: "",
  accent: "default"
};

export function normalizeVisualMeterOperation(raw: unknown): VisualMeterOperation {
  return (VISUAL_METER_OPERATIONS as readonly unknown[]).includes(raw)
    ? raw as VisualMeterOperation
    : DEFAULT_VISUAL_METER_SETTINGS.operation;
}

export function normalizeVisualMeterRefreshRate(raw: unknown): VisualMeterRefreshRate {
  const n = Number(raw);
  return n === 2 || n === 5 || n === 10 ? n : DEFAULT_VISUAL_METER_SETTINGS.refreshRate;
}

export function normalizeVisualMeterDialRotate(raw: unknown): VisualMeterDialRotate {
  return raw === "none" ? "none" : "adjust_bpm";
}

export interface ObsNeoInfobarSettings {
  [key: string]: string | number | boolean | undefined;
  showVisualSidechain?: boolean;
}

export const DEFAULT_OBS_NEO_INFOBAR_SETTINGS: Required<ObsNeoInfobarSettings> = {
  showVisualSidechain: false
};

/** What an OBS Filter dial's press does (PLAN.md 10.4): nothing, drop-and-return, or the filter on/off. */
export type ObsFilterDialPress = "none" | "drop_return" | "toggle";
/** What an OBS Filter key does: the filter on/off, a value over a time, or a step. */
export type ObsFilterKeyOperation = "toggle" | "set" | "step_up" | "step_down";

export interface ObsFilterSettings {
  [key: string]: string | number | boolean | undefined;
  /** The scene's, group's or input's UUID: the only thing that resolves the source. */
  sourceUuid?: string;
  /** The source's name when chosen, shown in the inspector only. */
  sourceName?: string;
  filterName?: string;
  /** The filter's versioned kind when chosen; a filter of another kind is refused. */
  filterKind?: string;
  setting?: string;
  /** An explicit range, needed off the range table (and for an Audio Modulator amount). */
  rangeMin?: number;
  rangeMax?: number;
  integer?: boolean;
  dialPress?: ObsFilterDialPress;
  keyOperation?: ObsFilterKeyOperation;
  /** A set key's target, in the setting's own units (0..100 for a mix, 0..1 for opacity). */
  value?: number;
  durationMs?: number;
  /** A step key's step, in percent of the range. */
  stepPct?: number;
  labelOverride?: string;
  accent?: AccentName;
}

/** Settings as a control uses them; the explicit range stays absent when not typed. */
export interface NormalizedObsFilterSettings {
  sourceUuid: string;
  sourceName: string;
  filterName: string;
  filterKind: string;
  setting: string;
  rangeMin: number | undefined;
  rangeMax: number | undefined;
  integer: boolean;
  dialPress: ObsFilterDialPress;
  keyOperation: ObsFilterKeyOperation;
  value: number;
  durationMs: number;
  stepPct: number;
  labelOverride: string;
  accent: AccentName;
}

export const DEFAULT_OBS_FILTER_SETTINGS: NormalizedObsFilterSettings = {
  sourceUuid: "",
  sourceName: "",
  filterName: "",
  filterKind: "",
  setting: "",
  rangeMin: undefined,
  rangeMax: undefined,
  integer: false,
  dialPress: "drop_return",
  keyOperation: "toggle",
  value: 0,
  durationMs: 1000,
  stepPct: 10,
  labelOverride: "",
  accent: "default"
};

export function normalizeObsFilterSettings(raw?: ObsFilterSettings): NormalizedObsFilterSettings {
  const d = DEFAULT_OBS_FILTER_SETTINGS;
  const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
  const number = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const stepPct = number(raw?.stepPct);
  return {
    sourceUuid: text(raw?.sourceUuid),
    sourceName: text(raw?.sourceName),
    // OBS filter names are kept exactly (a filter may be named with spaces).
    filterName: typeof raw?.filterName === "string" ? raw.filterName : d.filterName,
    filterKind: text(raw?.filterKind),
    setting: text(raw?.setting),
    rangeMin: number(raw?.rangeMin),
    rangeMax: number(raw?.rangeMax),
    integer: raw?.integer === true,
    dialPress: raw?.dialPress === "none" || raw?.dialPress === "toggle" ? raw.dialPress : d.dialPress,
    keyOperation: raw?.keyOperation === "set" || raw?.keyOperation === "step_up" || raw?.keyOperation === "step_down"
      ? raw.keyOperation : d.keyOperation,
    value: number(raw?.value) ?? d.value,
    durationMs: raw?.durationMs === undefined ? d.durationMs : normalizeDurationMs(raw.durationMs, d.durationMs),
    stepPct: stepPct === undefined ? d.stepPct : Math.max(1, Math.min(50, stepPct)),
    labelOverride: normalizeLabelOverride(raw?.labelOverride),
    accent: normalizeAccent(raw?.accent)
  };
}

export function normalizeDurationMs(raw: unknown, fallback = 1000): number {
  const rounded = Math.round(Number(raw ?? fallback));
  if (!Number.isFinite(rounded)) {
    return fallback;
  }
  return rounded === 0 ? 0 : Math.max(50, Math.min(20000, rounded));
}
