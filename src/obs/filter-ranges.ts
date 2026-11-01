// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which filter settings the deck may write, and over which range (PLAN.md
 * 10.2, R-RIG-3). The table holds the settings the rig rides; any other
 * numeric setting needs an explicit `min < max` from the inspector; the deny
 * list is the deck's own (it is not Visual Sidechain's Panic rule, which only
 * keeps rate, threshold and _hz uniforms out of Panic's zeroing).
 */
import type { DirectObsFilterInfo } from "./direct-obs-client.js";

export const VS_SHADER_FILTER_KIND = "visual_sidechain_shader_filter";
export const VS_MODULATOR_FILTER_KIND = "visual_sidechain_modulator_filter";
export const COLOR_CORRECTION_FILTER_KIND = "color_filter_v2";
const VISUAL_SIDECHAIN_KIND_PREFIX = "visual_sidechain_";
/** Audio Modulator slots (modulation.h VS_MOD_MAX_SLOTS) and Shader Parameter Faders (fader-bridge.h). */
export const MODULATOR_SLOTS = 8;
export const PARAM_FADER_SLOTS = 2;

/** How a value is drawn: a percent as is, a 0..1 fraction as a percent, or a plain number. */
export type FilterValueUnit = "percent" | "fraction" | "number";

export interface FilterRange {
  min: number;
  max: number;
  integer: boolean;
  unit: FilterValueUnit;
}

/** A table setting's short name on the deck (a `strings.ts` key; `{n}` is the modulator slot). */
export type FilterSettingLabel = "filterSettingEffectMix" | "filterSettingReactivity" | "filterSettingOpacity" | "filterSettingModAmount";

interface TableEntry {
  kind: string;
  setting: RegExp;
  /** Null: the user picks the range (the Audio Modulator amount: 0..100, -100..0 or -100..100). */
  range: FilterRange | null;
  /** Bounds an explicit range may not leave. */
  limits: { min: number; max: number };
  label: FilterSettingLabel;
}

const RANGE_TABLE: readonly TableEntry[] = [
  // shader-filter.c: float sliders 0..100, static defaults 100.
  { kind: VS_SHADER_FILTER_KIND, setting: /^vs_effect_mix_pct$/, range: { min: 0, max: 100, integer: false, unit: "percent" },
    limits: { min: 0, max: 100 }, label: "filterSettingEffectMix" },
  { kind: VS_SHADER_FILTER_KIND, setting: /^vs_audio_reactivity_pct$/, range: { min: 0, max: 100, integer: false, unit: "percent" },
    limits: { min: 0, max: 100 }, label: "filterSettingReactivity" },
  // color-correction-filter.c (v2): opacity is a 0..1 double (v1 was an int 0..100, not in the table).
  { kind: COLOR_CORRECTION_FILTER_KIND, setting: /^opacity$/, range: { min: 0, max: 1, integer: false, unit: "fraction" },
    limits: { min: 0, max: 1 }, label: "filterSettingOpacity" },
  // modulator-filter.c: -100..100; the sign is the user's choice, never inferred from the current value.
  { kind: VS_MODULATOR_FILTER_KIND, setting: /^slot_[1-8]_amount_pct$/, range: null,
    limits: { min: -100, max: 100 }, label: "filterSettingModAmount" }
];

/** Never written from the deck: a recompile, a colour, a list or mode, a binding, a flash-rate cap or a threshold. */
const DENIED_SETTINGS = new Set([
  "preset_shader", "shader_file_path", "shader_text", "override_entire_effect", "max_flash_rate_hz",
  "mix_fader_slot", "reactivity_fader_slot", "color", "color_multiply", "color_add"
]);
const DENIED_PATTERNS: readonly RegExp[] = [
  /threshold/i,
  /rate_divider$/,
  /^param_fader_\d+_/,
  /^slot_\d+_(enabled|target_filter|target_setting|seeded_target|signal|custom_mode|depth_fader|invert|min_value|max_value)$/,
  /colou?r/i,
  /_mode$/,
  /_slot$/,
  /_signal$/,
  /_enabled$/,
  /_target$/,
  /_fader$/,
  /seeded/
];

export function isVisualSidechainKind(kind: string): boolean {
  return kind.startsWith(VISUAL_SIDECHAIN_KIND_PREFIX);
}

/** True for a setting the deck never writes (the custom band's `custom_low_hz`/`custom_high_hz` are allowed). */
export function isDeniedSetting(setting: string): boolean {
  return DENIED_SETTINGS.has(setting) || DENIED_PATTERNS.some((pattern) => pattern.test(setting));
}

/**
 * A Visual Sidechain shader's list uniforms (`uniform int name < string
 * widget_type = "select"; ... >`, a list in OBS): an enum the deck never writes
 * (R-RIG-3). obs-websocket does not report property types, so they are found
 * in the shader's own text when the filter's settings carry it (`shader_text`).
 * A preset or file shader's text is not readable over the WebSocket: there only
 * the deny list's names (`*_mode` and the rest) keep a list uniform out (the
 * bundled shaders' two list uniforms both end in `_mode`).
 */
export function listUniformNames(shaderText: unknown): Set<string> {
  const names = new Set<string>();
  if (typeof shaderText !== "string" || !shaderText) return names;
  for (const match of shaderText.matchAll(/uniform\s+int\s+([A-Za-z_]\w*)\s*<([^>]*)>/g)) {
    if (/widget_type\s*=\s*"(select|list)"/.test(match[2]!)) names.add(match[1]!);
  }
  return names;
}

/** Denied by name, or a list uniform of this filter's own shader text (its settings merged over the defaults). */
export function isDeniedForFilter(kind: string, setting: string, settings: Readonly<Record<string, unknown>>): boolean {
  if (isDeniedSetting(setting)) return true;
  return kind === VS_SHADER_FILTER_KIND && listUniformNames(settings.shader_text).has(setting);
}

function tableEntry(kind: string, setting: string): TableEntry | undefined {
  return RANGE_TABLE.find((entry) => entry.kind === kind && entry.setting.test(setting));
}

/** Whether a setting is in the range table (the inspector lists those first). */
export function isTableSetting(kind: string, setting: string): boolean {
  return tableEntry(kind, setting) !== undefined;
}

/** The table's settings for a kind (the modulator's eight amounts included). */
export function tableSettings(kind: string): string[] {
  if (kind === VS_SHADER_FILTER_KIND) return ["vs_effect_mix_pct", "vs_audio_reactivity_pct"];
  if (kind === COLOR_CORRECTION_FILTER_KIND) return ["opacity"];
  if (kind === VS_MODULATOR_FILTER_KIND) return Array.from({ length: MODULATOR_SLOTS }, (_, i) => `slot_${i + 1}_amount_pct`);
  return [];
}

/** The deck's short name for a table setting, or null (the raw setting name is drawn). */
export function settingLabel(kind: string, setting: string): { key: FilterSettingLabel; n?: number } | null {
  const entry = tableEntry(kind, setting);
  if (!entry) return null;
  const slot = /^slot_(\d+)_/.exec(setting);
  return slot ? { key: entry.label, n: Number(slot[1]) } : { key: entry.label };
}

export interface ExplicitRange {
  rangeMin?: unknown;
  rangeMax?: unknown;
  integer?: unknown;
}

export type RangeResolution =
  | { ok: true; range: FilterRange }
  | { ok: false; reason: "denied" | "needs_range" };

/**
 * The range a setting is written over: the table's, or the explicit one (the
 * Audio Modulator amount and any setting off the table). A denied setting has
 * none, whatever is typed.
 */
export function resolveRange(kind: string, setting: string, explicit: ExplicitRange = {}): RangeResolution {
  if (!setting || isDeniedSetting(setting)) return { ok: false, reason: "denied" };
  const entry = tableEntry(kind, setting);
  if (entry?.range) return { ok: true, range: { ...entry.range } };
  const min = typeof explicit.rangeMin === "number" ? explicit.rangeMin : Number.NaN;
  const max = typeof explicit.rangeMax === "number" ? explicit.rangeMax : Number.NaN;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) return { ok: false, reason: "needs_range" };
  if (entry && (min < entry.limits.min || max > entry.limits.max)) return { ok: false, reason: "needs_range" };
  const integer = explicit.integer === true;
  // A whole-number range must hold a whole number (0.4 to 0.6 holds none).
  if (integer && Math.ceil(min) > Math.floor(max)) return { ok: false, reason: "needs_range" };
  return { ok: true, range: { min, max, integer, unit: entry ? "percent" : "number" } };
}

export function clampToRange(value: number, range: FilterRange): number {
  return Math.max(range.min, Math.min(range.max, value));
}

/**
 * The value written: clamped, rounded for an integer setting (and kept inside
 * the whole numbers of the range, so 0..2.5 never writes 3), otherwise kept to
 * six decimals.
 */
export function writableValue(value: number, range: FilterRange): number {
  const clamped = clampToRange(value, range);
  if (!range.integer) return Math.round(clamped * 1e6) / 1e6;
  return Math.max(Math.ceil(range.min), Math.min(Math.floor(range.max), Math.round(clamped)));
}

/** A value OBS holds outside the range: the deck refuses to move it rather than jump to the edge. */
export function isOutsideRange(value: number, range: FilterRange): boolean {
  // The same 1e-6 the writes round to: a float conversion's 100.0000004 is not out of range.
  return value < range.min - 1e-6 || value > range.max + 1e-6;
}

/** Drop-and-return's target: the range's value nearest 0 (0 for a bipolar range). */
export function restValue(range: FilterRange): number {
  return clampToRange(0, range);
}

/** The most one write may move a setting: 10 % of its range (a full sweep takes ten writes). */
export const SLEW_FRACTION = 0.1;

export function slewStep(range: FilterRange, fraction = SLEW_FRACTION): number {
  const step = (range.max - range.min) * fraction;
  // A whole-number setting moves whole steps (never more than the cap: 10.5 is 10, not a rounded 11),
  // and at least one: a smaller step would round back and never arrive.
  return range.integer ? Math.max(1, Math.floor(step)) : step;
}

/** A setting's value as a 0..1 position in its range (for the dial bar). */
export function rangePosition(value: number, range: FilterRange): number {
  return range.max > range.min ? (clampToRange(value, range) - range.min) / (range.max - range.min) : 0;
}

export type FilterOwner = { kind: "modulator"; filterName: string } | { kind: "fader"; filterName: string };

/**
 * Who drives a setting besides the deck: a sibling Audio Modulator slot that
 * targets it (its defaults merged, so slot 1 is enabled by default; a disabled
 * modulator or slot still counts, since re-enabling it would fight the deck and
 * overwrite its baseline), or the Shader Filter's own Parameter Fader bound to
 * it (`param_fader_N_target`, slot not -1).
 */
export function findOwner(filters: readonly DirectObsFilterInfo[], defaultsByKind: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  target: { filterName: string; setting: string }): FilterOwner | null {
  for (const filter of filters) {
    const settings = { ...(defaultsByKind[filter.filterKind] ?? {}), ...filter.filterSettings };
    if (filter.filterKind === VS_MODULATOR_FILTER_KIND && filter.filterName !== target.filterName) {
      for (let n = 1; n <= MODULATOR_SLOTS; n++) {
        if (settings[`slot_${n}_target_filter`] === target.filterName && settings[`slot_${n}_target_setting`] === target.setting) {
          return { kind: "modulator", filterName: filter.filterName };
        }
      }
    }
    if (filter.filterKind === VS_SHADER_FILTER_KIND && filter.filterName === target.filterName) {
      for (let n = 1; n <= PARAM_FADER_SLOTS; n++) {
        const slot = settings[`param_fader_${n}_slot`];
        if (settings[`param_fader_${n}_target`] === target.setting && typeof slot === "number" && Number.isInteger(slot) && slot >= 0) {
          return { kind: "fader", filterName: filter.filterName };
        }
      }
    }
  }
  return null;
}
