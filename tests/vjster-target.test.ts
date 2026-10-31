// SPDX-License-Identifier: GPL-2.0-or-later
// VJster target choice (docs/vjster/REQUIREMENTS.md R-TGT-1, R-TGT-2; PLAN.md 3.6).
import { describe, expect, it } from "vitest";
import { chooseTarget, type TabVideo, type TargetContext } from "../src/vjster/shared/target.js";

const tab = (tabId: number, windowId: number, playing: boolean, lastPlayAt: number | null, lastPauseAt: number | null): TabVideo => ({
  tabId,
  windowId,
  playing,
  lastPlayAt,
  lastPauseAt
});

const ctx = (focusedWindowId: number | null, activeTabIds: number[] = [], pinnedTabId: number | null = null): TargetContext => ({
  focusedWindowId,
  activeTabIds,
  pinnedTabId
});

describe("chooseTarget (R-TGT-1)", () => {
  it("is null when no tab has a video that played", () => {
    expect(chooseTarget([], ctx(1))).toBeNull();
  });

  it("picks the one playing tab, wherever it is", () => {
    const tabs = [tab(1, 1, false, 10, 20), tab(2, 2, true, 30, null), tab(3, 1, false, 5, 40)];
    expect(chooseTarget(tabs, ctx(1, [1, 4]))).toBe(2);
    expect(chooseTarget(tabs, ctx(null))).toBe(2);
  });

  it("among several playing tabs, prefers the active tab of the focused window", () => {
    const tabs = [tab(1, 1, true, 10, null), tab(2, 2, true, 50, null), tab(3, 1, true, 30, null)];
    expect(chooseTarget(tabs, ctx(1, [3, 2]))).toBe(3);
  });

  it("otherwise picks the tab that started playing most recently", () => {
    const tabs = [tab(1, 1, true, 10, null), tab(2, 2, true, 50, null), tab(3, 1, true, 30, null)];
    expect(chooseTarget(tabs, ctx(null))).toBe(2);
    // The focused window's active tab is not playing: recency decides.
    expect(chooseTarget(tabs, ctx(1, [7]))).toBe(2);
    // An active tab in a window that is not focused does not count.
    expect(chooseTarget(tabs, ctx(2, [1]))).toBe(2);
  });

  it("breaks equal times toward the lower tab id", () => {
    expect(chooseTarget([tab(9, 1, true, 10, null), tab(4, 1, true, 10, null)], ctx(null))).toBe(4);
    expect(chooseTarget([tab(9, 1, false, 1, 5), tab(4, 1, false, 1, 5)], ctx(null))).toBe(4);
  });

  it("with nothing playing, picks the tab paused most recently", () => {
    const tabs = [tab(1, 1, false, 1, 20), tab(2, 1, false, 2, 60), tab(3, 1, false, 3, 40)];
    expect(chooseTarget(tabs, ctx(1, [1]))).toBe(2);
  });

  it("ranks a tab that never paused last when nothing is playing", () => {
    const tabs = [tab(1, 1, false, 1, null), tab(2, 1, false, 2, 5)];
    expect(chooseTarget(tabs, ctx(null))).toBe(2);
    expect(chooseTarget([tab(5, 1, false, 1, null), tab(3, 1, false, 2, null)], ctx(null))).toBe(3);
  });

  it("treats a playing tab with no recorded start as the earliest", () => {
    const tabs = [tab(1, 1, true, null, null), tab(2, 1, true, 1, null)];
    expect(chooseTarget(tabs, ctx(null))).toBe(2);
    // A start at time 0 is still later than no start at all.
    expect(chooseTarget([tab(1, 1, true, null, null), tab(2, 1, true, 0, null)], ctx(null))).toBe(2);
    expect(chooseTarget([tab(1, 1, false, 0, null), tab(2, 1, false, 0, 0)], ctx(null))).toBe(2);
  });
});

describe("chooseTarget with a pinned tab (R-TGT-2)", () => {
  it("lets a tracked pinned tab win, even paused", () => {
    const tabs = [tab(1, 1, true, 50, null), tab(2, 1, false, 10, 20)];
    expect(chooseTarget(tabs, ctx(1, [1], 2))).toBe(2);
  });

  it("honours a pin on tab id 0", () => {
    const tabs = [tab(0, 1, false, 1, 2), tab(5, 1, true, 9, null)];
    expect(chooseTarget(tabs, ctx(1, [5], 0))).toBe(0);
  });

  it("ignores a pin on a tab that is no longer tracked", () => {
    const tabs = [tab(1, 1, true, 50, null)];
    expect(chooseTarget(tabs, ctx(1, [1], 99))).toBe(1);
  });
});
