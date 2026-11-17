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
