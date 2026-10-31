// SPDX-License-Identifier: GPL-2.0-or-later
// VJster deck settings: what each action stores, with defaults and the rules
// that make any stored value safe to use (docs/vjster/PLAN.md 3.8, D-7).
// Stream Deck hands back whatever was saved, so every read goes through a
// normalizer.

import { DEFAULT_LINK_PORT } from "../shared/protocol.js";
import { AUTO, isLevelId } from "../shared/quality.js";
import { ALLOWED_STEPS, DEFAULT_FINE_STEP, DEFAULT_STEP, EXTENDED_RANGE, rangeBounds, snapRate, type RateStep } from "../shared/speed.js";

export type TargetChoice = "browser" | "obs" | "both";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const step = (v: unknown, fallback: RateStep): RateStep => ((ALLOWED_STEPS as readonly unknown[]).includes(v) ? (v as RateStep) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const target = (v: unknown): TargetChoice => (v === "obs" || v === "both" ? v : "browser");
const label = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, 16) : fallback);

export interface SpeedDialSettings {
  readonly step: RateStep;
  readonly fineStep: RateStep;
  readonly extended: boolean;
  readonly hold: boolean;
  readonly target: TargetChoice;
  readonly label: string;
}

export function speedDialSettings(raw: unknown): SpeedDialSettings {
  const r = isRecord(raw) ? raw : {};
  return {
    step: step(r.step, DEFAULT_STEP),
    fineStep: step(r.fineStep, DEFAULT_FINE_STEP),
    extended: bool(r.extended, false),
    hold: bool(r.hold, true),
    target: target(r.target),
    label: label(r.label, bool(r.extended, false) ? "FX SPEED" : "SPEED")
  };
}

export interface QualityDialSettings {
  readonly hold: boolean;
  readonly target: TargetChoice;
  readonly label: string;
}

export function qualityDialSettings(raw: unknown): QualityDialSettings {
  const r = isRecord(raw) ? raw : {};
  return { hold: bool(r.hold, true), target: target(r.target), label: label(r.label, "QUALITY") };
}

export interface SpeedPresetSettings {
  readonly rate: number;
  /** Write the element directly; needed outside the player's own range (R-SPD-2). */
  readonly extended: boolean;
  readonly hold: boolean;
  readonly target: TargetChoice;
}

export function speedPresetSettings(raw: unknown): SpeedPresetSettings {
  const r = isRecord(raw) ? raw : {};
  const { min, max } = rangeBounds(EXTENDED_RANGE);
  const rate = typeof r.rate === "number" && Number.isFinite(r.rate) ? Math.min(max, Math.max(min, snapRate(r.rate))) : 1;
  return { rate, extended: bool(r.extended, rate < 0.25 || rate > 4), hold: bool(r.hold, true), target: target(r.target) };
}

export interface SpeedStepSettings {
  readonly direction: 1 | -1;
  readonly step: RateStep;
  readonly extended: boolean;
  readonly target: TargetChoice;
}

export function speedStepSettings(raw: unknown): SpeedStepSettings {
  const r = isRecord(raw) ? raw : {};
  return { direction: r.direction === -1 ? -1 : 1, step: step(r.step, DEFAULT_STEP), extended: bool(r.extended, false), target: target(r.target) };
}

export interface QualityPresetSettings {
  readonly level: string;
  readonly hold: boolean;
  readonly target: TargetChoice;
}

export function qualityPresetSettings(raw: unknown): QualityPresetSettings {
  const r = isRecord(raw) ? raw : {};
  return { level: isLevelId(r.level) ? r.level : AUTO, hold: bool(r.hold, true), target: target(r.target) };
}

export interface TransportSettings {
  readonly target: TargetChoice;
}

export function transportSettings(raw: unknown): TransportSettings {
  return { target: target(isRecord(raw) ? raw.target : undefined) };
}

/** Plugin-wide settings (R-LNK-1, R-LNK-2). */
export interface GlobalSettings {
  readonly port: number;
  /** Extension ids allowed to connect; empty allows any extension. */
  readonly extensionIds: readonly string[];
  /** The OBS page token (Phase 2); created once and kept. */
  readonly obsToken: string | null;
  /** Keep the link running while the plugin runs, so OBS can load its page at any time (obs-keepalive.ts); null until chosen. */
  readonly obsAlwaysOn: boolean | null;
}

export function globalSettings(raw: unknown): GlobalSettings {
  const r = isRecord(raw) ? raw : {};
  const port = typeof r.port === "number" && Number.isInteger(r.port) && r.port >= 1024 && r.port <= 65535 ? r.port : DEFAULT_LINK_PORT;
  // Kept as typed, only trimmed and lowercased: the server refuses everyone when a pinned id is malformed
  // (fail closed), where dropping it here would quietly allow any extension.
  const ids = (Array.isArray(r.extensionIds) ? r.extensionIds : typeof r.extensionIds === "string" ? r.extensionIds.split(/[\s,]+/) : [])
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0 && id.length <= 64)
    .slice(0, 16);
  const token = typeof r.obsToken === "string" && /^[0-9a-f]{32}$/.test(r.obsToken) ? r.obsToken : null;
  return { port, extensionIds: [...new Set(ids)], obsToken: token, obsAlwaysOn: r.obsAlwaysOn === true ? true : r.obsAlwaysOn === false ? false : null };
}
