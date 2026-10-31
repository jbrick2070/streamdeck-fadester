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

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keyImage } from "../../src/vjster/plugin/display.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const imgs = join(root, "com.jbrick2070.vjster.sdPlugin", "imgs");
const SPDX = "<!-- SPDX-License-Identifier: GPL-2.0-or-later -->";

function write(path: string, svg: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // Keep the SPDX notice inside the root element so the file stays valid SVG.
  writeFileSync(path, svg.replace(/^(<svg[^>]*>)/, `$1${SPDX}`) + "\n");
}

/** A white line icon on transparent, as Stream Deck's action list wants. */
function icon(size: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const gauge = '<path d="M4 15 A7 7 0 1 1 16 15"/><path d="M10 11 L13.5 6.5"/>';
const glyphs: Record<string, string> = {
  speed: gauge,
  quality: '<rect x="2.5" y="5" width="15" height="10" rx="2"/><path d="M6 8 V12 M6 10 H8.5 M8.5 8 V12 M11.5 8 H13 A2 2 0 0 1 13 12 H11.5 Z"/>',
  "speed-preset": '<path d="M4 15 A7 7 0 1 1 16 15"/><circle cx="10" cy="11" r="1.4" fill="#ffffff"/>',
  "speed-step": '<path d="M5 10 H15 M10 5 V15"/>',
  "quality-preset": '<rect x="2.5" y="5" width="15" height="10" rx="2"/><path d="M7 10 L9 12 L13 8"/>',
  pin: '<path d="M10 2.5 L14.5 7 L12.5 9 L12.5 12.5 L10 15 L7.5 12.5 L7.5 9 L5.5 7 Z"/><path d="M10 15 V18"/>',
  transport: '<path d="M4 5 L10 10 L4 15 Z"/><path d="M13 5 V15 M16.5 5 V15"/>'
};

for (const [name, body] of Object.entries(glyphs)) {
  write(join(imgs, "actions", name, "icon.svg"), icon(20, body));
}
write(join(imgs, "plugin", "category-icon.svg"), icon(28, gauge));

const keys: Record<string, Parameters<typeof keyImage>[0]> = {
  speed: { main: "1x", sub: "SPEED", active: true, dim: false },
  quality: { main: "AUTO", sub: "QUALITY", active: true, dim: false },
  "speed-preset": { main: "2x", sub: "SPEED", active: false, dim: false },
  "speed-step": { main: "+0.25", sub: "SPEED", active: false, dim: false },
  "quality-preset": { main: "1080p", sub: "QUALITY", active: false, dim: false },
  pin: { main: "", sub: "PIN TAB", active: false, dim: false, glyph: "pin" },
  transport: { main: "", sub: "PLAY", active: false, dim: false, glyph: "play" }
};
for (const [name, model] of Object.entries(keys)) {
  write(join(imgs, "actions", name, "key.svg"), keyImage(model));
}

console.log(`wrote ${Object.keys(glyphs).length * 2 + 1} SVG files under ${imgs}`);
