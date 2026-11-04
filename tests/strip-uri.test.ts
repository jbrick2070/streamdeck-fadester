// SPDX-License-Identifier: GPL-2.0-or-later
// A dial's display-strip picture goes out as a base64 data URI. OpenDeck's strip renderer (streamdeck-strip-render) reads a
// pixmap only from base64 and draws a grey and black checkerboard for the URL-encoded form a key's setImage accepts; Stream
// Deck software reads either. Keys keep the form they had.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toStripUri, toSvgDataUri } from "../packages/streamdeck-fadester-shared/src/svg-renderer.js";
import { svgDataUri, svgStripUri } from "../src/vjster/plugin/display.js";
import { decodeSvgUri } from "./helpers/svg-text.js";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="4" y="40">Tempo ä 日本 &amp; 1x</text></svg>';

describe("the strip picture", () => {
  it("is a base64 data URI that decodes to the same SVG, for Fadester and for VJster", () => {
    for (const uri of [toStripUri(SVG), svgStripUri(SVG)]) {
      expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
      expect(uri.slice(uri.indexOf(",") + 1)).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(decodeSvgUri(uri)).toBe(SVG);
    }
  });

  it("leaves a key's picture URL-encoded, as it was", () => {
    expect(toSvgDataUri(SVG).startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(svgDataUri(SVG).startsWith("data:image/svg+xml;charset=utf8,")).toBe(true);
    expect(decodeSvgUri(toSvgDataUri(SVG))).toBe(SVG);
    expect(decodeSvgUri(svgDataUri(SVG))).toBe(SVG);
  });

  it("reads a string that is not a data URI as the SVG itself", () => {
    expect(decodeSvgUri(SVG)).toBe(SVG);
  });
});

/** Every .ts file under a folder. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("every dial draw in the plugins", () => {
  const src = join(import.meta.dirname, "..", "src");

  it("sends the strip picture, not the key picture, as a dial's canvas", () => {
    let found = 0;
    for (const file of sources(src)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/setFeedback\(\{\s*canvas:\s*([^}]+?)\s*\}\)/g)) {
        found++;
        // VJster builds the picture once, for key or dial, from `act.isDial() ? svgStripUri(...) : svgDataUri(...)`.
        expect(match[1], file).toMatch(/StripUri|^uri$/);
      }
    }
    expect(found).toBeGreaterThanOrEqual(5);
    expect(readFileSync(join(src, "vjster", "plugin", "actions.ts"), "utf8")).toContain("act.isDial() ? svgStripUri(svg) : svgDataUri(svg)");
  });
});
