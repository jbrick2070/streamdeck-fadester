// SPDX-License-Identifier: GPL-2.0-or-later
// Fadester's ready-made layouts (profiles/layouts.json) as OpenDeck profiles. OpenDeck does not read Stream Deck's
// .streamDeckProfile files, so each layout is written as a profile file of its own, beside the deck's other profiles.
// A multi-page rig becomes one OpenDeck profile per page; Elgato's Next page key has no counterpart here, so that key
// stays empty and the pages are switched in OpenDeck.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPageProfile, presetPages, profileNameFor, type DeckSize, type PluginManifest, type Preset } from "../../src/opendeck/starter-profile.js";
export { buildPageProfile, fits, profileNameFor, settingsFor, type DeckSize } from "../../src/opendeck/starter-profile.js";

export interface WrittenProfile {
  name: string;
  file: string;
  status: "written" | "exists";
  placed: number;
  left: string[];
}

/**
 * Write the layouts into the deck's profile folder. A profile that is already there is not touched (it may have been
 * edited since); delete it in OpenDeck to build it again. Returns what happened for each page of each layout.
 */
export function writeLayouts(
  config: string,
  device: string,
  presets: Preset[],
  manifest: PluginManifest,
  pluginDir: string,
  deck: DeckSize
): WrittenProfile[] {
  const folder = join(config, "profiles", device);
  // Every page is built before any file is written, so a layout that cannot be built leaves nothing half written.
  const todo: Array<{ name: string; file: string; built?: ReturnType<typeof buildPageProfile> }> = [];
  const names = new Set<string>();
  for (const preset of presets) {
    const pages = presetPages(preset);
    for (const page of pages) {
      const name = profileNameFor(preset, page, pages.length);
      if (names.has(name.toLowerCase())) throw new Error(`Two layouts would both be called "${name}"`);
      names.add(name.toLowerCase());
      const file = join(folder, `${name}.json`);
      todo.push({ name, file, built: existsSync(file) ? undefined : buildPageProfile(preset, page, manifest, pluginDir, device, name, deck) });
    }
  }
  mkdirSync(folder, { recursive: true });
  return todo.map(({ name, file, built }) => {
    if (!built) return { name, file, status: "exists" as const, placed: 0, left: [] };
    writeFileSync(file, JSON.stringify(built.profile, null, 2));
    return { name, file, status: "written" as const, placed: built.placed, left: built.left };
  });
}
