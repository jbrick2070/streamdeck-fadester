// SPDX-License-Identifier: GPL-2.0-or-later
// Writes the VJster plugin's static SVG artwork: the category icon, the
// action-list icons and the default key images (docs/vjster/PLAN.md Phase 1
// step 5). Run from the repository root:
//
//   node --import tsx scripts/vjster/make-plugin-images.ts
//
// The default key images reuse the same drawing code the actions use at run
// time, so the action list shows what the deck will show. The plugin icon PNGs
// are rendered from vjster-extension/icons/icon.svg (see TESTING.md).
//
// The static images are language-neutral (PLAN.md section 9, L.6): Stream
// Deck draws them inside the dial circles and in its action list whatever
// language the plugin is set to, so they carry a number or a symbol only,
// never a word. The words come from the plugin at run time, in its language.
// `tests/vjster-plugin-images.test.ts` holds the committed files to this.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keyImage, type KeyModel } from "../../src/vjster/plugin/display.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** The plugin's image folder. */
export const IMAGES_DIR = join(root, "com.jbrick2070.vjster.sdPlugin", "imgs");
const SPDX = "<!-- SPDX-License-Identifier: GPL-2.0-or-later -->";

/** The file's contents: the SPDX notice inside the root element, so the file stays valid SVG. */
function fileText(svg: string): string {
  return svg.replace(/^(<svg[^>]*>)/, `$1${SPDX}`) + "\n";
}

/** A white line icon on transparent, as Stream Deck's action list wants. */
export function icon(size: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const gauge = '<path d="M4 15 A7 7 0 1 1 16 15"/><path d="M10 11 L13.5 6.5"/>';
/** The action-list icons, by action folder: line drawings, no text. */
export const GLYPHS: Readonly<Record<string, string>> = {
  speed: gauge,
  quality: '<rect x="2.5" y="5" width="15" height="10" rx="2"/><path d="M6 8 V12 M6 10 H8.5 M8.5 8 V12 M11.5 8 H13 A2 2 0 0 1 13 12 H11.5 Z"/>',
  "speed-preset": '<path d="M4 15 A7 7 0 1 1 16 15"/><circle cx="10" cy="11" r="1.4" fill="#ffffff"/>',
  "speed-step": '<path d="M5 10 H15 M10 5 V15"/>',
  "quality-preset": '<rect x="2.5" y="5" width="15" height="10" rx="2"/><path d="M7 10 L9 12 L13 8"/>',
  pin: '<path d="M10 2.5 L14.5 7 L12.5 9 L12.5 12.5 L10 15 L7.5 12.5 L7.5 9 L5.5 7 Z"/><path d="M10 15 V18"/>',
  transport: '<path d="M4 5 L10 10 L4 15 Z"/><path d="M13 5 V15 M16.5 5 V15"/>'
};

/** The default key images, by action folder: a number or a symbol, and no caption (`sub` stays empty). */
export const KEYS: Readonly<Record<string, KeyModel>> = {
  speed: { main: "1x", sub: "", active: true, dim: false },
  quality: { main: "", sub: "", active: true, dim: false, glyph: "quality" },
  "speed-preset": { main: "2x", sub: "", active: false, dim: false },
  "speed-step": { main: "+0.25", sub: "", active: false, dim: false },
  "quality-preset": { main: "1080p", sub: "", active: false, dim: false },
  pin: { main: "", sub: "", active: false, dim: false, glyph: "pin" },
  transport: { main: "", sub: "", active: false, dim: false, glyph: "play" }
};

/** Every image file the script writes, by path relative to the image folder (forward slashes). */
export function renderAll(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, body] of Object.entries(GLYPHS)) out.set(`actions/${name}/icon.svg`, fileText(icon(20, body)));
  out.set("plugin/category-icon.svg", fileText(icon(28, gauge)));
  for (const [name, model] of Object.entries(KEYS)) out.set(`actions/${name}/key.svg`, fileText(keyImage(model)));
  return out;
}

function main(): void {
  const files = renderAll();
  for (const [rel, text] of files) {
    const path = join(IMAGES_DIR, ...rel.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  console.log(`wrote ${files.size} SVG files under ${IMAGES_DIR}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
