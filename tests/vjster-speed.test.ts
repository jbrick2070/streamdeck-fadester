// SPDX-License-Identifier: GPL-2.0-or-later
// VJster speed logic (docs/vjster/REQUIREMENTS.md R-SPD-1..3, F-10; PLAN.md 3.4).
import { describe, expect, it } from "vitest";
import {
  ALLOWED_STEPS,
  DEFAULT_FINE_STEP,
  DEFAULT_RANGE,
  DEFAULT_STEP,
  EXTENDED_RANGE,
  MAX_TICKS,
  RATE_GRID,
  RESET_RATE,
  clampRate,
  nextRate,
  rangeBounds,
  rangeFor,
  resetRate,
  snapRate,
  type RateRange,
  type RateStep
} from "../src/vjster/shared/speed.js";

/** The rates the YouTube player reported in every probe run (PROBE-LOG.md). */
const YOUTUBE_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
const YT = rangeFor(YOUTUBE_RATES);

const onGrid = (x: number): boolean => Math.abs(x * 20 - Math.round(x * 20)) < 1e-9;

describe("constants (R-SPD-1, R-SPD-3, D-7)", () => {
  it("pins the defaults D-7 proposes and the grid", () => {
    expect(DEFAULT_STEP).toBe(0.25);
    expect(DEFAULT_FINE_STEP).toBe(0.05);
    expect(RESET_RATE).toBe(1);
    expect(RATE_GRID).toBe(0.05);
    expect([...ALLOWED_STEPS]).toEqual([0.05, 0.1, 0.25, 0.5]);
    expect(MAX_TICKS).toBe(1000);
  });
});

describe("rangeFor (R-SPD-2)", () => {
  it("takes the player's own minimum and maximum", () => {
    expect(rangeBounds(YT)).toEqual({ min: 0.25, max: 4 });
  });

  it("falls back to 0.25 to 2 when a target reports nothing usable", () => {
    for (const rates of [null, undefined, [], [0, -1, Number.NaN, Number.POSITIVE_INFINITY]]) {
      expect(rangeBounds(rangeFor(rates as number[] | null | undefined))).toEqual({ min: 0.25, max: 2 });
    }
    expect(DEFAULT_RANGE).toEqual(rangeFor([]));
  });

  it("ignores reported rates that are zero or negative", () => {
    expect(rangeBounds(rangeFor([0, 0.5, 2]))).toEqual({ min: 0.5, max: 2 });
    expect(rangeBounds(rangeFor([-1, 1]))).toEqual({ min: 1, max: 1 });
  });

  it("locks a target that reports only [1] to exactly 1x", () => {
    expect(rangeBounds(rangeFor([1]))).toEqual({ min: 1, max: 1 });
  });

  it("moves off-grid ends inward onto the 0.05 grid", () => {
    expect(rangeBounds(rangeFor([0.35, 3.33]))).toEqual({ min: 0.35, max: 3.3 });
    expect(rangeBounds(rangeFor([0.0625, 16]))).toEqual({ min: 0.1, max: 16 });
  });

  it("reads computed rates with float noise as the grid point they mean", () => {
    // 0.05 * 7 * 20 is 7.000000000000001 and 0.7 * 3 * 20 is 41.99999999999999.
    expect(rangeBounds(rangeFor([0.05 * 7, 4]))).toEqual({ min: 0.35, max: 4 });
    expect(rangeBounds(rangeFor([0.25, 0.7 * 3]))).toEqual({ min: 0.25, max: 2.1 });
    expect(rangeBounds(rangeFor([1.0000001]))).toEqual({ min: 1, max: 1 });
    expect(rangeBounds(rangeFor([0.9999999]))).toEqual({ min: 1, max: 1 });
  });

  it("never allows a rate below 0.05 or above the browser's 16", () => {
    expect(rangeBounds(rangeFor([1e-12, 2]))).toEqual({ min: 0.05, max: 2 });
    expect(rangeBounds(rangeFor([0.25, 100]))).toEqual({ min: 0.25, max: 16 });
    // Nothing on the grid fits inside [0.01, 0.01]: fall back to the default range.
    expect(rangeFor([0.01])).toEqual(DEFAULT_RANGE);
  });

  it("uses the browser's limits on the grid in extended range", () => {
    expect(rangeBounds(rangeFor(YOUTUBE_RATES, true))).toEqual({ min: 0.1, max: 16 });
    expect(rangeFor([1], true)).toBe(EXTENDED_RANGE);
  });
});

describe("snapRate and clampRate", () => {
  it("snaps to the 0.05 grid, as the player does (F-10)", () => {
    expect(snapRate(1.37)).toBe(1.35);
    expect(snapRate(1.0000001)).toBe(1);
    expect(snapRate(0.999999)).toBe(1);
    expect(snapRate(2.25)).toBe(2.25);
  });

  it("turns input that is not a usable rate into 1x", () => {
    expect(snapRate(Number.NaN)).toBe(1);
    expect(snapRate(0)).toBe(1);
    expect(snapRate(-0.01)).toBe(1);
    expect(snapRate(1e308)).toBe(1);
    expect(clampRate(Number.POSITIVE_INFINITY, YT)).toBe(1);
  });

  it("never snaps a positive rate below 0.05", () => {
    expect(snapRate(0.01)).toBe(0.05);
  });

  it("clamps into the range the way the player clamps", () => {
    expect(clampRate(5, YT)).toBe(4);
    expect(clampRate(0.1, YT)).toBe(0.25);
    expect(clampRate(0.05, YT)).toBe(0.25);
    expect(clampRate(1.37, YT)).toBe(1.35);
  });
});

describe("nextRate (R-SPD-1)", () => {
  it("steps by the turn step from 1x", () => {
    expect(nextRate(1, 1, 0.25, YT)).toBe(1.25);
    expect(nextRate(1, -1, 0.25, YT)).toBe(0.75);
    expect(nextRate(1, 4, 0.25, YT)).toBe(2);
    expect(nextRate(1, 1, 0.05, YT)).toBe(1.05);
    expect(nextRate(1, -3, 0.05, YT)).toBe(0.85);
  });

  it("goes to the next grid point in the turn's direction from an off-grid rate", () => {
    expect(nextRate(1.3, 1, 0.25, YT)).toBe(1.5);
    expect(nextRate(1.3, -1, 0.25, YT)).toBe(1.25);
    expect(nextRate(1.3, 2, 0.25, YT)).toBe(1.75);
  });

  it("handles the 0.5 step against the 0.25 minimum, which is off that step's grid", () => {
    expect(nextRate(0.25, 1, 0.5, YT)).toBe(0.5);
    expect(nextRate(0.25, 2, 0.5, YT)).toBe(1);
    expect(nextRate(0.5, -1, 0.5, YT)).toBe(0.25);
    expect(nextRate(0.25, -1, 0.5, YT)).toBe(0.25);
  });

  it("stops at both ends of the range", () => {
    expect(nextRate(4, 1, 0.25, YT)).toBe(4);
    expect(nextRate(3.75, 5, 0.5, YT)).toBe(4);
    expect(nextRate(0.25, -1, 0.25, YT)).toBe(0.25);
    expect(nextRate(1, 100, 0.25, DEFAULT_RANGE)).toBe(2);
  });

  it("does not drift on the float noise a page may report", () => {
    expect(nextRate(1.0000001, 1, 0.25, YT)).toBe(1.25);
    expect(nextRate(0.9999999, -1, 0.25, YT)).toBe(0.75);
  });

  it("only snaps and clamps on zero ticks", () => {
    expect(nextRate(1.37, 0, 0.25, YT)).toBe(1.35);
    expect(nextRate(9, 0, 0.25, YT)).toBe(4);
  });

  it("treats a non-finite current rate as 1x", () => {
    expect(nextRate(Number.NaN, 1, 0.25, YT)).toBe(1.25);
  });

  it("rejects steps and ticks it does not support", () => {
    expect(() => nextRate(1, 1, 0.3 as RateStep, YT)).toThrow(RangeError);
    expect(() => nextRate(1, 0.5, 0.25, YT)).toThrow(RangeError);
    expect(() => nextRate(1, MAX_TICKS + 1, 0.25, YT)).toThrow(RangeError);
    expect(() => nextRate(1, -MAX_TICKS - 1, 0.25, YT)).toThrow(RangeError);
    expect(nextRate(1, MAX_TICKS, 0.25, YT)).toBe(4);
  });

  it("lands a turn from outside the range on the nearer end", () => {
    expect(nextRate(8, 1, 0.25, YT)).toBe(4);
    expect(nextRate(0.25, -1, 0.25, { minT: 30, maxT: 40 })).toBe(1.5);
    expect(nextRate(1e308, -1, 0.25, YT)).toBe(4);
    expect(nextRate(-1e308, 1, 0.25, YT)).toBe(0.25);
  });

  it("keeps every result on the grid, in range, moving the right way and never more than ticks * step (ticks -3 to 3)", () => {
    const ranges: RateRange[] = [YT, DEFAULT_RANGE, EXTENDED_RANGE, rangeFor([1])];
    let checked = 0;
    for (const range of ranges) {
      for (let t = range.minT; t <= range.maxT; t++) {
        const current = t / 20;
        for (const step of ALLOWED_STEPS) {
          for (const ticks of [-3, -2, -1, 1, 2, 3]) {
            const next = nextRate(current, ticks, step, range);
            const { min, max } = rangeBounds(range);
            expect(onGrid(next)).toBe(true);
            expect(next).toBeGreaterThanOrEqual(min);
            expect(next).toBeLessThanOrEqual(max);
            expect(Math.abs(next - current)).toBeLessThanOrEqual(Math.abs(ticks) * step + 1e-9);
            if (ticks > 0) expect(next > current || current === max).toBe(true);
            if (ticks < 0) expect(next < current || current === min).toBe(true);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(9000);
  });

  it("lands on the step grid anchored at 1x whenever the range allows it", () => {
    for (const step of ALLOWED_STEPS) {
      for (let t = YT.minT; t <= YT.maxT; t++) {
        const next = nextRate(t / 20, 1, step, YT);
        const offGrid = Math.abs(((next - 1) / step) - Math.round((next - 1) / step)) > 1e-9;
        if (offGrid) expect(next).toBe(4);
      }
    }
  });
});

describe("resetRate (R-SPD-3)", () => {
  it("is 1x, clamped into the range", () => {
    expect(resetRate(YT)).toBe(1);
    expect(resetRate(rangeFor([1]))).toBe(1);
    expect(resetRate({ minT: 30, maxT: 40 })).toBe(1.5);
  });
});
