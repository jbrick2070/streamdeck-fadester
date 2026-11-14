// SPDX-License-Identifier: GPL-2.0-or-later
// Build the same native OpenDeck profiles in the packaged plugin and the optional offline installer.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PresetKind = "layer" | "scene" | "fader" | "fade" | "playlister" | "filter" | "panic" | "meter" | "page";

export type PresetAction = {
  controller: "Keypad" | "Encoder";
  column: number;
  row: number;
  kind: PresetKind;
  /** The caption stored as `labelOverride` (English, R-I18N-2); a page key has none. */
  label?: string;
  settings: Record<string, string | number | boolean>;
};

export type PresetPage = {
  name: string;
  /** The page's accent for every Fadester control on it (PLAN.md 10.4). */
  accent?: string;
  actions: PresetAction[];
};

export type Preset = {
  slug: string;
  name: string;
  description: string;
  obsMode: "either" | "studio" | "regular";
  deviceType: 0 | 1 | 7;
  deviceModel: string;
  columns: number;
  rows: number;
  dials: number;
  actions?: PresetAction[];
  pages?: PresetPage[];
  /** A multi-page rig: Panic and Next page sit on these keys (column, row) on every page. */
  rig?: { panic: [number, number]; nextPage: [number, number] };
};

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

export const NEXT_PAGE_ACTION = "com.elgato.streamdeck.page.next";

const FADESTER_ACTIONS: Record<Exclude<PresetKind, "page">, string> = {
  layer: "layer-control",
  scene: "scene-transition",
  fader: "obs-fader",
  fade: "obs-fade",
  playlister: "playlister-transport",
  filter: "obs-filter",
  panic: "visual-panic",
  meter: "visual-meter"
};

export function actionUuidFor(kind: PresetKind, pluginUuid: string): string {
  return kind === "page" ? NEXT_PAGE_ACTION : `${pluginUuid}.${FADESTER_ACTIONS[kind]}`;
}

/** Every page of a preset; a single-page preset is one page named as the profile. */
export function presetPages(preset: Preset): PresetPage[] {
  return preset.pages ?? [{ name: preset.name, actions: preset.actions ?? [] }];
}

/** OpenDeck names a plugin by its folder, so the folder keeps the manifest's UUID and the .sdPlugin ending. */
export function pluginFolderName(uuid: string): string {
  return `${uuid}.sdPlugin`;
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
