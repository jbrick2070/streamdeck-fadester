// SPDX-License-Identifier: GPL-2.0-or-later
// Fadester's ready-made layouts (profiles/layouts.json) as OpenDeck profiles. OpenDeck does not read Stream Deck's
// .streamDeckProfile files, so each layout is written as a profile file of its own, beside the deck's other profiles.
// A multi-page rig becomes one OpenDeck profile per page; Elgato's Next page key has no counterpart here, so that key
// stays empty and the pages are switched in OpenDeck.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { actionUuidFor, presetPages, type Preset, type PresetAction, type PresetPage } from "../profile-checks.js";
import { buildInstance, pluginFolderName, type Instance, type PluginManifest, type Profile } from "./opendeck.js";

/** What a deck has room for, from its profile file: keys, dials. */
export interface DeckSize {
  keys: number;
  dials: number;
}

/** The profile's name on disk: no dot (OpenDeck splits its context on dots) and nothing a file name cannot hold. */
export function profileNameFor(preset: Preset, page: PresetPage, pageCount: number): string {
  const base = preset.name.replace(/^Fadester\s*[—-]\s*/, "Fadester ");
  const full = pageCount > 1 ? `${base} - ${page.name}` : base;
  return full.replace(/[<>:"/\\|?*.\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
}

/** True when the layout is made for this deck: the same number of keys (a Mini layout is not offered on a Stream Deck +) and no more dials than it has. */
export function fits(preset: Preset, deck: DeckSize): boolean {
  return preset.columns * preset.rows === deck.keys && preset.dials <= deck.dials;
}

/** One preset page as an OpenDeck profile for a deck of the given size. A page key is left out (see the header). */
export function buildPageProfile(
  preset: Preset,
  page: PresetPage,
  manifest: PluginManifest,
  pluginDir: string,
  device: string,
  profileName: string,
  deck: DeckSize
): { profile: Profile; placed: number; left: string[] } {
  const folder = pluginFolderName(manifest.UUID);
  const keys: Array<Instance | null> = Array(deck.keys).fill(null);
  const sliders: Array<Instance | null> = Array(deck.dials).fill(null);
  const left: string[] = [];
  let placed = 0;
  for (const entry of page.actions) {
    if (entry.kind === "page") {
      left.push(`${entry.label ?? "Next page"}: OpenDeck switches profiles itself`);
      continue;
    }
    const action = manifest.Actions.find((candidate) => candidate.UUID === actionUuidFor(entry.kind, manifest.UUID));
    if (!action) throw new Error(`${preset.slug}: the plugin has no action ${actionUuidFor(entry.kind, manifest.UUID)}`);
    const keypad = entry.controller === "Keypad";
    const position = keypad ? entry.row * preset.columns + entry.column : entry.column;
    const slots = keypad ? keys : sliders;
    if (position >= slots.length) throw new Error(`${preset.slug}: ${entry.label ?? entry.kind} sits past the deck's last slot`);
    const instance = buildInstance(action, folder, pluginDir, `${device}.${profileName}.${entry.controller}.${position}.0`);
    instance.settings = settingsFor(entry, page);
    slots[position] = instance;
    placed++;
  }
  return { profile: { keys, sliders, infobars: [] }, placed, left };
}

/** What the plugin stores for a preset action: its settings, the page accent, and the caption. */
export function settingsFor(entry: PresetAction, page: PresetPage): Record<string, unknown> {
  const accent = page.accent && page.accent !== "default" && entry.settings.accent === undefined ? { accent: page.accent } : {};
  return { ...entry.settings, ...accent, labelOverride: entry.label ?? "" };
}

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
