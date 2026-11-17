// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_SHADOW_DEPTH, forEachShadowRoot, type ScanElement, type ScanRoot } from "../vjster-extension/src/shadow-scan.js";

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
});
