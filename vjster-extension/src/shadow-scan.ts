// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: find the open shadow roots of a page (R-TGT-3). Players
// built as web components (archive.org's <play-av>, for one) keep their
// <video> inside a shadow root, where document.querySelectorAll("video")
// does not look and where media events stop. Closed shadow roots cannot be
// reached by any page script, so their videos stay out of reach.

/** The part of an element or shadow root the scan uses; no DOM types, so it is tested in Node. */
export interface ScanRoot {
  querySelectorAll(selector: string): ArrayLike<ScanElement>;
}
export interface ScanElement {
  readonly shadowRoot?: ScanRoot | null;
}

/** Nesting deeper than this is treated as a loop or a pathological page and not followed. */
export const MAX_SHADOW_DEPTH = 12;

/**
 * Call visit once for every open shadow root under root, nested ones included, outermost first.
 * Returns how many were visited.
 */
export function forEachShadowRoot(root: ScanRoot, visit: (shadow: ScanRoot) => void, depth = 0): number {
  if (depth >= MAX_SHADOW_DEPTH) return 0;
  let count = 0;
  const all = root.querySelectorAll("*");
  for (let i = 0; i < all.length; i++) {
    const shadow = all[i].shadowRoot;
    if (!shadow) continue;
    visit(shadow);
    count += 1 + forEachShadowRoot(shadow, visit, depth + 1);
  }
  return count;
}

/** A whole-page search waits this long after the change that asked for it, so a burst of changes is one search. */
export const WHOLE_SCAN_SETTLE_MS = 1000;
/** Whole-page searches are at least this far apart, however busy the page is. */
export const WHOLE_SCAN_SPACING_MS = 5000;

/**
 * Asks for a search of the whole page, seldom. The search of added nodes cannot find a shadow root that is attached
 * to an element already in the page (a web-component player whose script arrives after its markup: the upgrade adds no
 * node), so every change on the page also asks for one whole search: it runs once the changes have settled, and at
 * most once per WHOLE_SCAN_SPACING_MS. No change, no search.
 */
export class WholeScan {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly run: () => void,
    private readonly now: () => number = () => Date.now(),
    private readonly later: (run: () => void, ms: number) => ReturnType<typeof setTimeout> = (run, ms) => setTimeout(run, ms)
  ) {}

  /** A change happened: one whole search is due (nothing more while one is already waiting). */
  request(): void {
    if (this.timer !== null) return;
    const wait = Math.max(WHOLE_SCAN_SETTLE_MS, this.last + WHOLE_SCAN_SPACING_MS - this.now());
    this.timer = this.later(() => {
      this.timer = null;
      this.last = this.now();
      this.run();
    }, wait);
  }
}
