// SPDX-License-Identifier: GPL-2.0-or-later
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { buildPageProfile, fits, presetPages, profileNameFor, type PluginManifest, type Preset, type Profile } from "./starter-profile.js";

const BUNDLE_ID = "io.github.jbrick2070.fadester-for-obs";
const OLD_BUNDLE_ID = "com.jbrick2070.fadester-for-obs";

export interface OpenDeckStarterDevice {
  pluginDir: string;
  deviceId: string;
  deviceType: number;
  rows?: number;
  columns?: number;
}

export type OpenDeckStarterResult =
  | { status: "created" | "exists"; name: string }
  | { status: "skipped"; reason: "not-opendeck" | "unsupported-device" | "store-not-ready" | "already-offered" };

/** Scope writes to the actual OpenDeck installation containing this running suite. */
export function isOpenDeckInstall(pluginDir: string): boolean {
  if (!isAbsolute(pluginDir) || basename(pluginDir) !== BUNDLE_ID + ".sdPlugin" || !existsSync(pluginDir)) return false;
  const canonical = realpathSync(pluginDir);
  const plugins = dirname(canonical);
  const config = dirname(plugins);
  return basename(canonical) === BUNDLE_ID + ".sdPlugin" && basename(plugins).toLowerCase() === "plugins"
    && basename(config).toLowerCase() === "opendeck" && lstatSync(join(config, "profiles"), { throwIfNoEntry: false })?.isDirectory() === true;
}

export function starterSlugForDevice(deviceType: number): string | undefined {
  if (deviceType === 7) return "plus-scene-regular";
  if (deviceType === 0) return "buttons-scene-regular";
  if (deviceType === 1) return "mini-source-desk";
  return undefined;
}

function json(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

interface SavedSlot {
  action?: { uuid?: string; UUID?: string };
  children?: Array<SavedSlot | null>;
}

function usesOldPlugin(slot: SavedSlot | null): boolean {
  const uuid = slot?.action?.uuid ?? slot?.action?.UUID;
  return (typeof uuid === "string" && uuid.startsWith(OLD_BUNDLE_ID + ".")) || slot?.children?.some(usesOldPlugin) === true;
}

/** Keep every existing layout, including old or edited layouts. Only the renamed plugin needs a sibling. */
export function starterProfileName(folder: string, canonicalName: string): string {
  const original = join(folder, canonicalName + ".json");
  if (!lstatSync(original, { throwIfNoEntry: false })?.isFile()) return canonicalName;
  try {
    const old = json(original) as Partial<Record<"keys" | "sliders" | "infobars", Array<SavedSlot | null>>>;
    const slots = [...(old.keys ?? []), ...(old.sliders ?? []), ...(old.infobars ?? [])];
    if (slots.some(usesOldPlugin)) {
      return canonicalName + " (New ID)";
    }
  } catch {
    // An unrecognised user profile still owns its name.
  }
  return canonicalName;
}

/** OpenDeck also sees its backup/recovery files as real profiles. */
function hasProfile(folder: string, name: string): boolean {
  return [".json", ".json.temp", ".json.bak"].some(ext => lstatSync(join(folder, name + ext), { throwIfNoEntry: false }) !== undefined);
}

/** Publish a complete file without replacing anything, even when two plugin starts race. OpenDeck ignores .pending files. */
function createOnce(file: string, data: string): boolean {
  const temp = join(dirname(file), randomUUID() + ".pending");
  const fd = openSync(temp, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, data);
    } finally {
      closeSync(fd);
    }
    linkSync(temp, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(temp);
  }
}

/** The host writes Default before announcing the device, and the selected-profile metadata may follow shortly after. */
function readCurrentProfile(config: string, folder: string, deviceId: string): Profile | undefined {
  const metadata = join(config, "profiles", deviceId + ".json");
  let selected: unknown = "Default";
  if (existsSync(metadata)) {
    if (!lstatSync(metadata).isFile()) return;
    selected = (json(metadata) as { selected_profile?: unknown })?.selected_profile;
  }
  if (typeof selected !== "string" || !selected || selected.split("/").some(part => !part || part === "." || part === ".." || /[\\:\u0000]/.test(part))) return;
  const current = join(folder, selected + ".json");
  if (!existsSync(current) || !lstatSync(current).isFile()) return;
  const child = relative(folder, realpathSync(current));
  if (isAbsolute(child) || child.startsWith(".." + sep)) return;
  const profile = json(current) as Profile;
  return Array.isArray(profile?.keys) && Array.isArray(profile?.sliders) ? profile : undefined;
}

export function provisionOpenDeckStarter(device: OpenDeckStarterDevice): OpenDeckStarterResult {
  if (!isOpenDeckInstall(device.pluginDir)) return { status: "skipped", reason: "not-opendeck" };
  const slug = starterSlugForDevice(device.deviceType);
  if (!slug) return { status: "skipped", reason: "unsupported-device" };
  if (!/^[A-Za-z0-9]{2}-[A-Za-z0-9_-]{1,100}$/.test(device.deviceId)) return { status: "skipped", reason: "store-not-ready" };
  const plugin = realpathSync(device.pluginDir);
  const config = dirname(dirname(plugin));
  const folder = join(config, "profiles", device.deviceId);
  if (!lstatSync(folder, { throwIfNoEntry: false })?.isDirectory()) return { status: "skipped", reason: "store-not-ready" };
  const installed = json(join(plugin, "manifest.json")) as PluginManifest;
  if (installed?.UUID !== BUNDLE_ID) return { status: "skipped", reason: "not-opendeck" };
  const markers = join(config, "fadester-starters");
  const marker = join(markers, device.deviceId + ".json");
  const archive = json(join(plugin, "opendeck", "starters.json")) as Preset[];
  const preset = archive.find(p => p.slug === slug && p.deviceType === device.deviceType);
  if (!preset) throw new Error("Packaged OpenDeck starter is missing: " + slug);
  if ((device.rows !== undefined && device.rows !== preset.rows) || (device.columns !== undefined && device.columns !== preset.columns)) {
    return { status: "skipped", reason: "unsupported-device" };
  }
  const [page] = presetPages(preset);
  const canonicalName = profileNameFor(preset, page, 1);
  if (existsSync(markers) && !lstatSync(markers).isDirectory()) return { status: "skipped", reason: "store-not-ready" };
  if (existsSync(marker)) {
    const offered = lstatSync(marker).isFile() ? (json(marker) as { name?: string })?.name : undefined;
    if ((offered === canonicalName || offered === canonicalName + " (New ID)") && hasProfile(folder, offered)) return { status: "exists", name: offered };
    // Respect an owner who renamed or removed the starter.
    return { status: "skipped", reason: "already-offered" };
  }
  const current = readCurrentProfile(config, folder, device.deviceId);
  if (!current) return { status: "skipped", reason: "store-not-ready" };
  const deck = { keys: current.keys.length, dials: current.sliders.length };
  if (!fits(preset, deck)) return { status: "skipped", reason: "unsupported-device" };
  const name = starterProfileName(folder, canonicalName);
  let created = false;
  if (!hasProfile(folder, name)) {
    const { profile } = buildPageProfile(preset, page, installed, plugin, device.deviceId, name, deck);
    created = createOnce(join(folder, name + ".json"), JSON.stringify(profile, null, 2));
  }
  mkdirSync(markers, { recursive: true });
  createOnce(marker, JSON.stringify({ name }));
  return { status: created ? "created" : "exists", name };
}
