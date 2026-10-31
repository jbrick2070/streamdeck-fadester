// SPDX-License-Identifier: GPL-2.0-or-later
// VJster speed logic (docs/vjster/REQUIREMENTS.md R-SPD-1..3, PLAN.md 3.4).
//
// All arithmetic runs in integer twentieths of 1x (0.05 units), the grid the
// YouTube player keeps rates on (F-10). Working in integers means no float
// tie can round a step the wrong way.

/** Twentieths per 1x. */
const PER_X = 20;

/** The rate grid, in x. Every value this module returns is a multiple of it. */
export const RATE_GRID = 1 / PER_X;

/**
 * How close, in twentieths, a reported rate must be to a grid point to count
 * as that point. Computed rates carry float noise (0.05 * 7 * 20 is
 * 7.000000000000001, 0.7 * 3 * 20 is 41.99999999999999, and a page may report
 * 1.0000001); real rates differ by at least one whole twentieth.
 */
const NEAR = 1e-3;

/** The steps an action may be set to (R-SPD-1). Each is a whole number of twentieths. */
export const ALLOWED_STEPS = [0.05, 0.1, 0.25, 0.5] as const;
export type RateStep = (typeof ALLOWED_STEPS)[number];

/** Default turn step and held-turn step (R-SPD-1, D-7 as proposed). */
export const DEFAULT_STEP: RateStep = 0.25;
export const DEFAULT_FINE_STEP: RateStep = 0.05;

/** The rate a dial press or a reset key sets (R-SPD-3, D-7). */
export const RESET_RATE = 1;

/** Where the step grid is anchored: 1x, in twentieths. Independent of RESET_RATE. */
const GRID_ANCHOR_T = 20;

/** The most notches one call may move; real dials send a handful. */
export const MAX_TICKS = 1000;

/** A closed range of rates, kept in twentieths so it is always on the grid. */
export interface RateRange {
  readonly minT: number;
  readonly maxT: number;
}

/** Range for a target that reports no rates of its own (R-SPD-2). */
export const DEFAULT_RANGE: RateRange = { minT: 5, maxT: 40 }; // 0.25 to 2

/**
 * Extended range (R-SPD-2): the grid values inside the browser's own limits.
 * Chrome accepts 0.0625 to 16 (F-10); 0.0625 is off the grid, so the lowest
 * grid value inside is 0.1.
 */
export const EXTENDED_RANGE: RateRange = { minT: 2, maxT: 320 }; // 0.1 to 16

const toT = (x: number): number => Math.round(x * PER_X);
const fromT = (t: number): number => t / PER_X;
/** The one place a rate is clamped, in twentieths. */
const clampT = (t: number, range: RateRange): number => Math.min(range.maxT, Math.max(range.minT, t));

/** A reported bound in twentieths: the grid point it sits on, else rounded inward. */
function boundT(x: number, direction: "up" | "down"): number {
  const t = x * PER_X;
  const nearest = Math.round(t);
  if (Math.abs(t - nearest) < NEAR) return nearest;
  return direction === "up" ? Math.ceil(t) : Math.floor(t);
}

/** Lower and upper bounds of a range, in x. */
export function rangeBounds(range: RateRange): { min: number; max: number } {
  return { min: fromT(range.minT), max: fromT(range.maxT) };
}

/**
 * The range a target allows: the minimum and maximum of the rates it reports
 * (YouTube: 0.25 to 4), moved inward onto the grid; DEFAULT_RANGE when it
 * reports none usable; EXTENDED_RANGE when the extended setting is on.
 * A target that reports only [1] gets a range of exactly 1x: it cannot change
 * speed.
 */
export function rangeFor(availableRates: readonly number[] | null | undefined, extended = false): RateRange {
  if (extended) return EXTENDED_RANGE;
  const usable = (availableRates ?? []).filter((r) => typeof r === "number" && Number.isFinite(r) && r > 0);
  if (usable.length === 0) return DEFAULT_RANGE;
  const minT = Math.max(1, boundT(Math.min(...usable), "up"));
  const maxT = Math.min(EXTENDED_RANGE.maxT, boundT(Math.max(...usable), "down"));
  if (maxT < minT) return DEFAULT_RANGE;
  return { minT, maxT };
}

/**
 * Snap a rate to the nearest grid value. Input that is not a finite positive
 * rate, or that is too large to snap, becomes 1x; the smallest result is 0.05.
 */
export function snapRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return RESET_RATE;
  const t = toT(rate);
  if (!Number.isFinite(t)) return RESET_RATE;
  return fromT(Math.max(1, t));
}

/** Snap to the grid, then clamp into the range. Non-finite input becomes 1x first. */
export function clampRate(rate: number, range: RateRange): number {
  return fromT(clampT(Number.isFinite(rate) ? toT(rate) : toT(RESET_RATE), range));
}

/** Whether a step value is one of ALLOWED_STEPS. */
export function isRateStep(step: number): step is RateStep {
  return (ALLOWED_STEPS as readonly number[]).includes(step);
}

/**
 * The rate after `ticks` dial notches (positive = faster) from `current`.
 *
 * The step grid is anchored at 1x. A turn always moves to the next grid point
 * in its direction, so from an off-grid value (0.25 with a 0.5 step) one notch
 * up lands on 0.5, not on 0.75; each further notch adds one step. The result is
 * clamped into the range, so a range end may be off the step grid (0.25 is a
 * valid minimum for a 0.5 step), and a turn from a rate outside the range
 * lands on the nearer end. Zero ticks only snaps and clamps.
 */
export function nextRate(current: number, ticks: number, step: RateStep, range: RateRange): number {
  if (!Number.isInteger(ticks) || Math.abs(ticks) > MAX_TICKS) {
    throw new RangeError(`ticks must be an integer from -${MAX_TICKS} to ${MAX_TICKS}, got ${ticks}`);
  }
  if (!isRateStep(step)) throw new RangeError(`step must be one of ${ALLOWED_STEPS.join(", ")}, got ${step}`);
  const stepT = toT(step);
  const startT = Number.isFinite(current) ? toT(current) : toT(RESET_RATE);
  const curT = clampT(startT, EXTENDED_RANGE);
  let t = curT;
  if (ticks > 0) {
    const firstUp = GRID_ANCHOR_T + (Math.floor((curT - GRID_ANCHOR_T) / stepT) + 1) * stepT;
    t = firstUp + (ticks - 1) * stepT;
  } else if (ticks < 0) {
    const firstDown = GRID_ANCHOR_T + (Math.ceil((curT - GRID_ANCHOR_T) / stepT) - 1) * stepT;
    t = firstDown + (ticks + 1) * stepT;
  }
  return fromT(clampT(t, range));
}

/** The reset rate, clamped into the range (R-SPD-3). */
export function resetRate(range: RateRange): number {
  return clampRate(RESET_RATE, range);
}
