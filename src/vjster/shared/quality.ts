// SPDX-License-Identifier: GPL-2.0-or-later
// VJster quality logic (docs/vjster/REQUIREMENTS.md R-QLT-1, R-QLT-7, PLAN.md 3.5).
//
// Levels are the player's own ids (`hd1080`, `large`, ...), listed highest
// first as `getAvailableQualityLevels()` reports them (PROBE-LOG.md). `auto` is
// a mode, not a level, and is never part of the cycle.

export const AUTO = "auto";

/** A level id as the player writes it: lowercase letters and digits only. */
const LEVEL_ID = /^[a-z0-9]{1,16}$/;

/** Picture heights of the ids the probe saw. Other ids are shown as-is. */
const HEIGHTS: Readonly<Record<string, number>> = {
  hd2160: 2160,
  hd1440: 1440,
  hd1080: 1080,
  hd720: 720,
  large: 480,
  medium: 360,
  small: 240,
  tiny: 144
};

/** Whether a string is shaped like a level id (R-INT-3 validation). */
export function isLevelId(value: unknown): value is string {
  return typeof value === "string" && LEVEL_ID.test(value);
}

/**
 * The cycle a dial steps through: the reported list in its own order, without
 * `auto`, without duplicates and without anything that is not a level id.
 */
export function normalizeLevels(raw: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const item of raw ?? []) {
    if (isLevelId(item) && item !== AUTO && !out.includes(item)) out.push(item);
  }
  return out;
}

/** Picture height of a level, or null when the id is not one the probe saw. */
export function levelHeight(level: string): number | null {
  return Object.prototype.hasOwnProperty.call(HEIGHTS, level) ? HEIGHTS[level] : null;
}

/** Display label: `1080p` for known ids, `Auto` for auto, the id itself otherwise. */
export function qualityLabel(level: string): string {
  if (level === AUTO) return "Auto";
  const h = levelHeight(level);
  return h === null ? level : `${h}p`;
}

/**
 * The level after `ticks` dial notches; positive means higher quality, which
 * is toward the front of the list. Stops at both ends (no wrap).
 *
 * `current` is the level to step from: the fixed level when one is set, else
 * the level playing under Auto. From a level that is not in the list (unknown,
 * or null), a turn up picks the highest level and a turn down the lowest.
 * Returns null when the list is empty; zero ticks returns `current` when it is
 * in the list.
 */
export function stepQuality(levels: readonly string[], current: string | null, ticks: number): string | null {
  if (!Number.isInteger(ticks)) throw new RangeError(`ticks must be an integer, got ${ticks}`);
  // `auto` is a mode, never a step, even if a caller passes the raw list.
  const cycle = levels.filter((level) => level !== AUTO);
  if (cycle.length === 0) return null;
  const at = current === null ? -1 : cycle.indexOf(current);
  if (at < 0) {
    if (ticks > 0) return cycle[0];
    if (ticks < 0) return cycle[cycle.length - 1];
    return null;
  }
  const next = Math.min(cycle.length - 1, Math.max(0, at - ticks));
  return cycle[next];
}

/**
 * The level to re-apply after a navigation when "hold quality" is on (R-QLT-7):
 * the held level if the new video offers it, else the nearest lower offered
 * level, else the lowest offered level. Null when nothing can be chosen: the
 * list is empty, or the held level's height is unknown and it is not offered.
 */
export function resolveHeldLevel(held: string, levels: readonly string[]): string | null {
  if (levels.length === 0) return null;
  if (levels.includes(held)) return held;
  const heldHeight = levelHeight(held);
  if (heldHeight === null) return null;
  let best: string | null = null;
  let bestHeight = -1;
  for (const level of levels) {
    const h = levelHeight(level);
    if (h !== null && h < heldHeight && h > bestHeight) {
      best = level;
      bestHeight = h;
    }
  }
  return best ?? levels[levels.length - 1];
}
