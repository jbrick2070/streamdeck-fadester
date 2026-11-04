// SPDX-License-Identifier: GPL-2.0-or-later
// OpenDeck support (docs/OPENDECK.md): put the built plugins where OpenDeck loads them, and fill a starter layout.
// OpenDeck (https://github.com/nekename/OpenDeck) runs Stream Deck plugins unchanged; it reads a plugin folder from its
// own config directory, and a hand-placed action must look like the ones OpenDeck builds itself (verified on Windows,
// OpenDeck 2.14.2): the settings page path joined to the plugin folder, and the images as data URIs.

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ManifestAction {
  Name: string;
  UUID: string;
  Icon?: string;
  PropertyInspectorPath?: string;
  Controllers?: string[];
  States?: Array<{ Image?: string } & Record<string, unknown>>;
  [key: string]: unknown;
}

export interface PluginManifest {
  Name: string;
  UUID: string;
  Actions: ManifestAction[];
}

/** One action instance in an OpenDeck profile (the fields OpenDeck itself saves). */
export interface Instance {
  action: Record<string, unknown>;
  context: string;
  states: Array<Record<string, unknown>>;
  current_state: number;
  settings: Record<string, unknown>;
  children: null;
}

export interface Profile {
  id?: string;
  keys: Array<Instance | null>;
  sliders: Array<Instance | null>;
  infobars?: Array<Instance | null>;
}

export interface LayoutSpec {
  /** Action name to place, by key position. */
  keys: Record<number, string>;
  /** Action name to place, by dial position. */
  sliders: Record<number, string>;
}

/** The VJster starter layout: the four keys and the two dials the demo uses (the other slots stay free). */
export const VJSTER_LAYOUT: LayoutSpec = {
  keys: { 0: "Speed Preset", 1: "Speed Step", 2: "Play / Pause", 3: "Pin Tab" },
  sliders: { 0: "Speed", 1: "Quality" }
};

/** OpenDeck's config directory. Verified on Windows; the macOS and Linux places follow OpenDeck's README (Flatpak differs). */
export function configDir(platform: NodeJS.Platform, env: Record<string, string | undefined>, home: string): string {
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "opendeck");
  if (platform === "darwin") return join(home, "Library", "Application Support", "opendeck");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "opendeck");
}

/** OpenDeck names a plugin by its folder, so the folder keeps the manifest's UUID and the .sdPlugin ending. */
export function pluginFolderName(uuid: string): string {
  return `${uuid}.sdPlugin`;
}

/** True when a plugin folder has been built (its code is bin/plugin.js). */
export function isBuilt(sourceDir: string): boolean {
  return existsSync(join(sourceDir, "bin", "plugin.js"));
}

/**
 * Copy a built plugin folder into OpenDeck's plugins directory, replacing an earlier copy whole (a file the new build
 * no longer ships does not linger) and leaving the Stream Deck app's logs behind. The plugin's saved settings live
 * outside its folder, so a reinstall keeps them. Returns the target.
 */
export function installPlugin(sourceDir: string, config: string, uuid: string): string {
  if (!isBuilt(sourceDir)) throw new Error(`${sourceDir} has no bin/plugin.js; run npm run build first`);
  const target = join(config, "plugins", pluginFolderName(uuid));
  mkdirSync(join(config, "plugins"), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(sourceDir, target, {
    recursive: true,
    filter: (from) => from.slice(sourceDir.length).split(/[\\/]/).filter(Boolean)[0] !== "logs"
  });
  return target;
}

/** The first file the images can be read from (OpenDeck's own rule is the same: the manifest names no extension). */
function imageUri(pluginDir: string, relative: string | undefined): string {
  if (!relative) return "";
  for (const [extension, type] of [[".svg", "image/svg+xml"], [".png", "image/png"]] as const) {
    const file = join(pluginDir, ...relative.split("/")) + extension;
    if (existsSync(file)) return `data:${type};base64,${readFileSync(file).toString("base64")}`;
  }
  return relative;
}

/** An action instance as OpenDeck would build it from the manifest, for one slot. */
export function buildInstance(
  action: ManifestAction,
  pluginFolder: string,
  pluginDir: string,
  context: string
): Instance {
  const { PropertyInspectorPath, ...rest } = action;
  return {
    action: {
      ...rest,
      plugin: pluginFolder,
      Icon: imageUri(pluginDir, action.Icon),
      property_inspector: PropertyInspectorPath ? join(pluginDir, ...PropertyInspectorPath.split("/")) : ""
    },
    context,
    states: (action.States ?? []).map((state) => ({ ...state, Image: imageUri(pluginDir, state.Image) })),
    current_state: 0,
    settings: {},
    children: null
  };
}

export interface PlacementResult {
  placed: string[];
  refreshed: string[];
  skipped: string[];
}

/** True when the slot holds an instance of this very action of this plugin (an earlier run of the installer, or the user's own placing). */
function isSameAction(instance: Instance, action: ManifestAction, folder: string): boolean {
  const held = instance.action as { UUID?: unknown; uuid?: unknown; plugin?: unknown };
  return (held.UUID === action.UUID || held.uuid === action.UUID) && held.plugin === folder;
}

/**
 * Fill a profile's free slots from the layout. A slot that already holds a different action is left alone. A slot
 * that holds the layout's own action is built again from the manifest, keeping its settings, which repairs an
 * entry from an older run and picks up a changed plugin. A layout name the plugin does not have, or a slot the deck
 * does not have (a deck without dials), is reported and skipped.
 */
export function placeLayout(
  profile: Profile,
  manifest: PluginManifest,
  pluginDir: string,
  layout: LayoutSpec,
  device: string,
  profileName: string
): PlacementResult {
  const folder = pluginFolderName(manifest.UUID);
  const result: PlacementResult = { placed: [], refreshed: [], skipped: [] };
  const fill = (slots: Array<Instance | null>, wanted: Record<number, string>, controller: "Keypad" | "Encoder"): void => {
    for (const [index, name] of Object.entries(wanted)) {
      const position = Number(index);
      const action = manifest.Actions.find((a) => a.Name === name);
      const label = `${name} (${controller === "Keypad" ? "key" : "dial"} ${position + 1})`;
      const held = slots[position] ?? null;
      if (!action || position >= slots.length) {
        result.skipped.push(`${label}: not available here`);
      } else if (held !== null && !isSameAction(held, action, folder)) {
        result.skipped.push(`${label}: the slot is in use`);
      } else {
        const instance = buildInstance(action, folder, pluginDir, `${device}.${profileName}.${controller}.${position}.0`);
        if (held !== null) instance.settings = held.settings ?? {};
        slots[position] = instance;
        (held === null ? result.placed : result.refreshed).push(label);
      }
    }
  };
  fill(profile.keys, layout.keys, "Keypad");
  fill(profile.sliders, layout.sliders, "Encoder");
  return result;
}

/** The decks OpenDeck has made profiles for (a folder and a json per device id). */
export function knownDevices(config: string): string[] {
  const folder = join(config, "profiles");
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The profile the deck is showing, which is where the layout goes ("Default" until OpenDeck says otherwise). */
export function selectedProfile(config: string, device: string): string {
  try {
    const stored = JSON.parse(readFileSync(join(config, "profiles", `${device}.json`), "utf8")) as { selected_profile?: unknown };
    return typeof stored.selected_profile === "string" && stored.selected_profile ? stored.selected_profile : "Default";
  } catch {
    return "Default";
  }
}

/**
 * Place the layout in the deck's current profile on disk, after keeping one copy of the file as it was. The copy goes
 * outside profiles/: OpenDeck reads every file there as a profile (it made a profile of a stray backup).
 */
export function applyLayout(
  config: string,
  device: string,
  manifest: PluginManifest,
  pluginDir: string,
  layout: LayoutSpec
): PlacementResult & { file: string } {
  const profileName = selectedProfile(config, device);
  const file = join(config, "profiles", device, `${profileName}.json`);
  if (!existsSync(file)) throw new Error(`OpenDeck has no profile file at ${file}; start OpenDeck with the deck connected once`);
  let profile: Profile;
  try {
    profile = JSON.parse(readFileSync(file, "utf8")) as Profile;
  } catch {
    throw new Error(`${file} is not valid JSON; nothing was changed`);
  }
  if (!Array.isArray(profile.keys) || !Array.isArray(profile.sliders)) {
    throw new Error(`${file} has no keys and sliders lists; nothing was changed`);
  }
  const result = placeLayout(profile, manifest, pluginDir, layout, device, profileName);
  if (result.placed.length + result.refreshed.length > 0) {
    const backups = join(config, "backups", manifest.UUID);
    const backup = join(backups, `${device}-${profileName}.json`);
    if (!existsSync(backup)) {
      mkdirSync(backups, { recursive: true });
      copyFileSync(file, backup);
    }
    writeFileSync(file, JSON.stringify(profile, null, 2));
  }
  return { ...result, file };
}

export interface Args {
  which: "vjster" | "fadester" | "all";
  layout: boolean;
  dryRun: boolean;
  force: boolean;
  device?: string;
  config?: string;
  errors: string[];
}

/** The command line of install.ts: a plugin name, the flags, and two flags that take a value. A typo is an error, not ignored. */
export function parseArgs(argv: string[]): Args {
  const args: Args = { which: "all", layout: false, dryRun: false, force: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "vjster" || a === "fadester" || a === "all") args.which = a;
    else if (a === "--layout") args.layout = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--device" || a === "--config") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args.errors.push(`${a} needs a value`);
      else {
        args[a === "--device" ? "device" : "config"] = next;
        i++;
      }
    } else args.errors.push(`unknown argument ${a}`);
  }
  if (args.layout && args.which === "fadester") args.errors.push("--layout places VJster's keys and dials; use it with vjster or all");
  return args;
}
