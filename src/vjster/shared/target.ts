// SPDX-License-Identifier: GPL-2.0-or-later
// VJster target choice: which browser tab is "the current video"
// (docs/vjster/REQUIREMENTS.md R-TGT-1, R-TGT-2, PLAN.md 3.6).

/** What the extension knows about one tab with a video element that has played. */
export interface TabVideo {
  readonly tabId: number;
  readonly windowId: number;
  readonly playing: boolean;
  /** Time the video last started playing (any monotonic clock), or null. */
  readonly lastPlayAt: number | null;
  /** Time the video last paused, or null. */
  readonly lastPauseAt: number | null;
}

export interface TargetContext {
  /** The focused browser window, or null when no browser window has focus. */
  readonly focusedWindowId: number | null;
  /** The active tab of each window, as tab ids. */
  readonly activeTabIds: readonly number[];
  /** The tab pinned with the Pin key (R-TGT-2), or null. */
  readonly pinnedTabId: number | null;
}

/** Later time first; null counts as earliest; equal times go to the lower tab id. */
function byNewest(key: "lastPlayAt" | "lastPauseAt") {
  return (a: TabVideo, b: TabVideo): number => {
    const ta = a[key] ?? Number.NEGATIVE_INFINITY;
    const tb = b[key] ?? Number.NEGATIVE_INFINITY;
    if (ta !== tb) return tb > ta ? 1 : -1;
    return a.tabId - b.tabId;
  };
}

/**
 * The tab to control, or null for "No video".
 *
 * 1. A pinned tab that is still tracked wins (R-TGT-2).
 * 2. Exactly one playing tab: that one.
 * 3. Several playing: the active tab of the focused window if it is one of
 *    them, else the one that started playing most recently.
 * 4. None playing: the one paused most recently, so speed can be set before
 *    pressing play. Tabs that never paused rank last.
 */
export function chooseTarget(tabs: readonly TabVideo[], ctx: TargetContext): number | null {
  if (tabs.length === 0) return null;
  if (ctx.pinnedTabId !== null && tabs.some((t) => t.tabId === ctx.pinnedTabId)) return ctx.pinnedTabId;

  const playing = tabs.filter((t) => t.playing);
  if (playing.length === 1) return playing[0].tabId;
  if (playing.length > 1) {
    const focused = playing.find((t) => t.windowId === ctx.focusedWindowId && ctx.activeTabIds.includes(t.tabId));
    if (focused) return focused.tabId;
    return [...playing].sort(byNewest("lastPlayAt"))[0].tabId;
  }
  return [...tabs].sort(byNewest("lastPauseAt"))[0].tabId;
}
