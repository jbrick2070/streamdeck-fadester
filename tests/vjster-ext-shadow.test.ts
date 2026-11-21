// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SHADOW_DEPTH, WHOLE_SCAN_SETTLE_MS, WHOLE_SCAN_SPACING_MS, WholeScan, forEachShadowRoot, type ScanElement, type ScanRoot } from "../vjster-extension/src/shadow-scan.js";

/** A stand-in for an element or shadow root: querySelectorAll("*") lists every element under it, not inside shadows. */
const root = (elements: ScanElement[]): ScanRoot => ({ querySelectorAll: () => elements });
const el = (shadowRoot: ScanRoot | null = null): ScanElement => ({ shadowRoot });

describe("forEachShadowRoot (R-TGT-3)", () => {
  it("finds a web-component player's shadow root, as on archive.org", () => {
    const player = root([el()]);
    const page = root([el(), el(player), el()]);
    const seen: ScanRoot[] = [];
    expect(forEachShadowRoot(page, (s) => seen.push(s))).toBe(1);
    expect(seen).toEqual([player]);
  });

  it("follows nested shadow roots, outermost first", () => {
    const inner = root([el()]);
    const outer = root([el(inner)]);
    const seen: ScanRoot[] = [];
    expect(forEachShadowRoot(root([el(outer)]), (s) => seen.push(s))).toBe(2);
    expect(seen).toEqual([outer, inner]);
  });

  it("visits nothing on a page without shadow roots", () => {
    expect(forEachShadowRoot(root([el(), el()]), () => expect.unreachable())).toBe(0);
  });

  it("stops at a loop instead of running forever", () => {
    const loop: ScanRoot = { querySelectorAll: () => [el(loop)] };
    expect(forEachShadowRoot(root([el(loop)]), () => undefined)).toBe(MAX_SHADOW_DEPTH);
  });
});

describe("content-main looks inside shadow roots on any site", () => {
  const source = readFileSync(new URL("../vjster-extension/src/content-main.ts", import.meta.url), "utf8");
  it("picks videos from shadow roots and listens for their media events there", () => {
    expect(source).toMatch(/shadow\.querySelectorAll\("video"\)/);
    expect(source).toMatch(/shadow\.addEventListener\(type, onAnyMedia, true\)/);
    expect(source).toMatch(/grown\.observe\(shadow/);
  });

  it("asks for a whole search on every change and at load (QA-A01)", () => {
    expect(source).toMatch(/new WholeScan\(\(\) => rescan\(\[document\]\)\)/);
    expect(source).toMatch(/new MutationObserver\(\(records\) => \{\s*whole\.request\(\);/);
    expect(source).toMatch(/addEventListener\("load", \(\) => whole\.request\(\)/);
  });
});

describe("WholeScan (QA-A01)", () => {
  afterEach(() => vi.useRealTimers());

  it("finds a shadow root attached to an element that was already in the page", () => {
    vi.useFakeTimers();
    // A player component whose markup is in the page before its script: no shadow root yet.
    const player: { shadowRoot: ScanRoot | null } = { shadowRoot: null };
    const page = root([el(), player]);
    const found: ScanRoot[] = [];
    const search = (): void => { forEachShadowRoot(page, (shadow) => { if (!found.includes(shadow)) found.push(shadow); }); };
    search();
    expect(found).toEqual([]);
    const whole = new WholeScan(search);
    // The upgrade attaches the shadow root (no node is added to the page); some other change on the page follows.
    const shadow = root([el()]);
    player.shadowRoot = shadow;
    whole.request();
    expect(found).toEqual([]);
    vi.advanceTimersByTime(WHOLE_SCAN_SETTLE_MS);
    expect(found).toEqual([shadow]);
  });

  it("runs once for a burst of changes, at most once per spacing, and not at all without a change", () => {
    vi.useFakeTimers();
    let runs = 0;
    const whole = new WholeScan(() => { runs += 1; });
    vi.advanceTimersByTime(60_000);
    expect(runs).toBe(0);
    for (let i = 0; i < 500; i += 1) whole.request();
    vi.advanceTimersByTime(WHOLE_SCAN_SETTLE_MS);
    expect(runs).toBe(1);
    // A busy page: a change every 100 ms for 20 s gives one search per spacing, not one per change.
    for (let t = 0; t < 20_000; t += 100) {
      whole.request();
      vi.advanceTimersByTime(100);
    }
    expect(runs).toBeGreaterThanOrEqual(1 + 3);
    expect(runs).toBeLessThanOrEqual(1 + Math.ceil(20_000 / WHOLE_SCAN_SPACING_MS));
    const before = runs;
    vi.advanceTimersByTime(60_000);
    expect(runs).toBeLessThanOrEqual(before + 1);
  });
});
