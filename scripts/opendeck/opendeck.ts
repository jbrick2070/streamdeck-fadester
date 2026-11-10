// SPDX-License-Identifier: GPL-2.0-or-later
// OpenDeck support (docs/OPENDECK.md): put the built plugins where OpenDeck loads them, and fill a starter layout.
// OpenDeck (https://github.com/nekename/OpenDeck) runs Stream Deck plugins unchanged; it reads a plugin folder from its
// own config directory, and a hand-placed action must look like the ones OpenDeck builds itself (verified on Windows,
// OpenDeck 2.14.2): the settings page path joined to the plugin folder, and the images as data URIs.

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { buildInstance, pluginFolderName, type ManifestAction, type PluginManifest, type Profile, type Instance } from "../../src/opendeck/starter-profile.js";
export { buildInstance, pluginFolderName, type ManifestAction, type PluginManifest, type Profile, type Instance } from "../../src/opendeck/starter-profile.js";

export interface LayoutSpec {
  /** Action name to place, by key position. */
  keys: Record<number, string>;
  /** Action name to place, by dial position. */
  sliders: Record<number, string>;
}

/** The VJster starter layout: the four keys and the two dials the demo uses (the other slots stay free). `prefix` is how the plugin names the actions. */
export function vjsterLayout(prefix = ""): LayoutSpec {
  return {
    keys: { 0: `${prefix}Speed Preset`, 1: `${prefix}Speed Step`, 2: `${prefix}Play / Pause`, 3: `${prefix}Pin Tab` },
    sliders: { 0: `${prefix}Speed`, 1: `${prefix}Quality` }
  };
}

/** For the standalone VJster plugin, whose actions are named Speed, Quality and so on. */
export const VJSTER_LAYOUT: LayoutSpec = vjsterLayout();
/** For the suite plugin (the Fadester plugin that carries VJster), whose actions are named VJster Speed and so on. */
export const SUITE_LAYOUT: LayoutSpec = vjsterLayout("VJster ");

/** OpenDeck's config directory. Verified on Windows; the macOS and Linux places follow OpenDeck's README (Flatpak differs). */
export function configDir(platform: NodeJS.Platform, env: Record<string, string | undefined>, home: string): string {
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "opendeck");
  if (platform === "darwin") return join(home, "Library", "Application Support", "opendeck");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "opendeck");
}

/** True when a plugin folder has been built (its code is bin/plugin.js). */
export function isBuilt(sourceDir: string): boolean {
  return existsSync(join(sourceDir, "bin", "plugin.js"));
}

/**
 * The PowerShell line that lists the VJster child of one suite launcher, by its parent's process id: the parity run
 * stops only the child of the plugin it started, never one of an installed suite that Stream Deck or OpenDeck runs.
 */
export function vjsterChildQuery(parentPid: number): string {
  if (!Number.isInteger(parentPid) || parentPid <= 0) throw new Error(`not a process id: ${parentPid}`);
  return `Get-CimInstance Win32_Process -Filter "Name='node.exe' AND ParentProcessId=${parentPid}" | Where-Object { $_.CommandLine -like '*vjster*plugin.js*' } | ForEach-Object { $_.ProcessId }`;
}

/**
 * Copy a built plugin folder into OpenDeck's plugins directory, replacing an earlier copy whole (a file the new build
 * no longer ships does not linger) and leaving the Stream Deck app's logs behind. The plugin's saved settings live
 * outside its folder, so a reinstall keeps them. Returns the target.
 */
export function installPlugin(sourceDir: string, config: string, uuid: string): string {
  if (!isBuilt(sourceDir)) throw new Error(`${sourceDir} has no bin/plugin.js; run npm run build first`);
  const target = join(config, "plugins", pluginFolderName(uuid));
  const from = resolve(sourceDir);
  const into = resolve(target);
  if (from === into || from.startsWith(into + sep) || into.startsWith(from + sep)) {
    throw new Error(`${sourceDir} and ${target} overlap; the plugin cannot be installed over itself`);
  }
  mkdirSync(join(config, "plugins"), { recursive: true });
  // Copy beside the old folder and swap, so a copy that fails (a locked file) leaves the old install whole. The old
  // folder is renamed aside before the new one moves in and deleted only after, so a failed delete or rename (a file
  // OpenDeck still holds) never leaves the deck with no plugin: on failure the old folder is put back.
  const fresh = `${target}.new`;
  const old = `${target}.old`;
  rmSync(fresh, { recursive: true, force: true });
  rmSync(old, { recursive: true, force: true });
  try {
    cpSync(sourceDir, fresh, {
      recursive: true,
      filter: (path) => relative(from, resolve(path)).split(/[\\/]/)[0] !== "logs"
    });
    const hadOld = existsSync(target);
    if (hadOld) renameSync(target, old);
    try {
      renameSync(fresh, target);
    } catch (error) {
      if (hadOld) {
        try {
          renameSync(old, target);
        } catch (restoreError) {
          throw new Error(`${String(error)}; and the old plugin could not be put back from ${old}: ${String(restoreError)}`);
        }
      }
      throw error;
    }
  } catch (error) {
    rmSync(fresh, { recursive: true, force: true });
    throw error;
  }
  try {
    rmSync(old, { recursive: true, force: true });
  } catch (error) {
    // the new plugin is in place; only the cleanup failed (a file OpenDeck still holds): the next install removes it
    console.warn(`Installed, but ${old} could not be removed yet (${String(error)}); close OpenDeck and delete it.`);
  }
  return target;
}

export interface PlacementResult {
  placed: string[];
  refreshed: string[];
  skipped: string[];
}

/** True when the slot holds an instance of this very action of this plugin (an earlier run of the installer, or the user's own placing). */
function isSameAction(instance: Instance, action: ManifestAction, folder: string): boolean {
  const held = (instance?.action ?? {}) as { UUID?: unknown; uuid?: unknown; plugin?: unknown };
  return (held.UUID === action.UUID || held.uuid === action.UUID) && held.plugin === folder;
}

/** What a user sets on a key in OpenDeck's own editor; a refresh keeps these and takes everything else from the manifest. */
const KEPT_STATE_FIELDS = ["text", "text_override", "image_override", "show", "colour", "stroke_colour", "alignment", "family", "style", "size", "underline"];

/**
 * Fill a profile's free slots from the layout. A slot that already holds a different action is left alone. A slot
 * that holds the layout's own action is built again from the manifest, keeping its settings and the title styling
 * set in OpenDeck, which repairs an entry from an older run and picks up a changed plugin. A layout name the plugin does not have, or a slot the deck
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
        if (held !== null) {
          instance.settings = held.settings ?? {};
          instance.states = instance.states.map((state, i) => {
            const before = (held.states?.[i] ?? {}) as Record<string, unknown>;
            const kept = Object.fromEntries(KEPT_STATE_FIELDS.filter((field) => field in before).map((field) => [field, before[field]]));
            return { ...state, ...kept };
          });
        }
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

/** The profile file for a deck: where the layout goes. */
export function profileFile(config: string, device: string): string {
  return join(config, "profiles", device, `${selectedProfile(config, device)}.json`);
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
  const file = profileFile(config, device);
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
    // One backup, the file as it was before any run, under a flat name (a profile in a folder is "Folder/Name",
    // which made the copy fail after the plugin was already replaced). The profile is written through a temporary
    // file and a rename, so a failed write never cuts the user's profile short. The temporary file is kept in the
    // backups folder: OpenDeck reads every file in a profile folder as a profile.
    const backups = join(config, "backups", manifest.UUID);
    const flat = `${device}-${profileName}`.replace(/[\\/:*?"<>|]/g, "_");
    const backup = join(backups, `${flat}.json`);
    mkdirSync(backups, { recursive: true });
    if (!existsSync(backup)) copyFileSync(file, backup);
    const temp = join(backups, `${flat}.writing`);
    writeFileSync(temp, JSON.stringify(profile, null, 2));
    renameSync(temp, file);
  }
  return { ...result, file };
}

export interface Args {
  /** The suite (the Fadester plugin, with VJster in it), the standalone VJster plugin, or both. */
  which: "suite" | "vjster" | "both";
  layout: boolean;
  dryRun: boolean;
  force: boolean;
  device?: string;
  config?: string;
  /** "fit" or a comma list of layout slugs: Fadester's ready-made layouts to write as OpenDeck profiles. */
  fadesterLayouts?: string;
  errors: string[];
}

/** The command line of install.ts: a plugin name, the flags, and two flags that take a value. A typo is an error, not ignored. */
export function parseArgs(argv: string[]): Args {
  const args: Args = { which: "suite", layout: false, dryRun: false, force: false, errors: [] };
  let named = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "suite" || a === "vjster" || a === "both" || a === "all" || a === "fadester") {
      if (named && named !== a) args.errors.push(`name one plugin (suite, vjster or both), not ${named} and ${a}`);
      named = a;
      // "all" and "fadester" were the names before VJster moved into the Fadester plugin; both now mean the suite.
      args.which = a === "vjster" || a === "both" ? a : "suite";
    }
    else if (a === "--layout") args.layout = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--device" || a === "--config" || a === "--fadester-layouts") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args.errors.push(`${a} needs a value`);
      else {
        args[a === "--device" ? "device" : a === "--config" ? "config" : "fadesterLayouts"] = next;
        i++;
      }
    } else args.errors.push(`unknown argument ${a}`);
  }
  if (args.fadesterLayouts && args.which === "vjster") args.errors.push("--fadester-layouts needs the suite (suite, both, all or fadester)");
  return args;
}
