// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Suite Demo Kit's two Stream Deck + profiles (demo-kit plan section 4, step 4).
 *
 *   node --import tsx scripts/build-kit-profiles.ts [--out <folder>]
 *
 * demo-kit/kit-layouts.json holds both layouts. The Fadester one is a preset of
 * profiles/layouts.json's shape, checked by the existing validatePreset and built by the
 * existing buildProfile (scripts/profile-checks.ts); the VJster page is built by VJster's
 * own profileFiles (scripts/vjster/build-profiles.ts). Neither builder is extended. On top,
 * this script checks every binding against demo-kit/kit-ids.json (the kit's fixed names and
 * UUIDs), that the layout is the Studio Mode one (K.6: every scene key cues its scene in
 * Preview, dial 1 of every page is the scene mixer, no Cut keys) and every caption against
 * the shipped captions (plan section 15 item 1), then
 * writes the two .streamDeckProfile files named as the README promises
 * (kit_docs.PROFILE_FILES) into demo-kit/build/profiles/ (git-ignored; the zip is built
 * from there). The output is deterministic. It never reads or writes the user's Stream Deck
 * profiles, and nothing is imported into Stream Deck.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PluginManifest, Preset, PresetAction, buildProfile, presetPages, validatePreset, zip } from "./profile-checks.js";
import { profileFiles, zip as vjsterZip } from "./vjster/build-profiles.js";
import { CaptionAction, isGeneratedCaption } from "../src/obs/preset-captions.js";
import { isTableSetting } from "../src/obs/filter-ranges.js";

export type VjsterLayout = Parameters<typeof profileFiles>[0];

export interface KitLayouts {
  about: string;
  fadester: Preset;
  vjster: VjsterLayout;
}

interface KitFilter { name: string; id: string; versioned_id: string; uuid: string }
interface KitSource { name: string; id: string; versioned_id: string; uuid: string; filters?: KitFilter[] }
interface KitScene { index: number; name: string; uuid: string; items: Array<{ id: number; source: string }> }
export interface KitIds { scenes: KitScene[]; sources: KitSource[] }

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const KIT_DIR = join(ROOT, "demo-kit");
const FADESTER_MANIFEST = join(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin", "manifest.json");

/** The zip names the README promises, read from kit_docs.PROFILE_FILES (one list, in Python). */
export function promisedProfileFiles(kitDocs = readFileSync(join(KIT_DIR, "kit_docs.py"), "utf8")): string[] {
  const line = /^PROFILE_FILES = \[(.*)\]\s*$/m.exec(kitDocs);
  if (!line) throw new Error("kit_docs.py has no PROFILE_FILES line");
  return [...line[1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

export function loadKit(): { layouts: KitLayouts; ids: KitIds; manifest: PluginManifest } {
  const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
  return {
    layouts: read(join(KIT_DIR, "kit-layouts.json")) as KitLayouts,
    ids: read(join(KIT_DIR, "kit-ids.json")) as KitIds,
    manifest: read(FADESTER_MANIFEST) as PluginManifest
  };
}

const SCENE_INDEX = /^__scene_index_(\d+)__$/;

function captionAction(entry: PresetAction): CaptionAction | null {
  switch (entry.kind) {
    case "scene": return "scene";
    case "fader": return "fader";
    case "fade": return "fade";
    case "layer": return entry.controller === "Encoder" ? "layerDial" : "layerKey";
    case "playlister": return "playlister";
    case "panic": return "panic";
    case "filter": return "filter";
    case "meter": return "meter";
    case "page": return null;
  }
}

/**
 * What is wrong with the Fadester layout's bindings and captions, against kit-ids.json; empty
 * when every key acts on the kit at once. validatePreset checks the shape; this checks the kit.
 */
export function kitBindingProblems(preset: Preset, ids: KitIds): string[] {
  const problems: string[] = [];
  const byUuid = new Map(ids.sources.map((source) => [source.uuid, source]));
  const byName = new Map(ids.sources.map((source) => [source.name, source]));
  const text = (value: unknown): string => typeof value === "string" ? value : "";
  // K.6: the kit is a Studio Mode layout. Every scene key sets Preview (no Cut, no Transition), and dial 1
  // of every page is the scene mixer (the OBS Fader on the T-bar), which blends Preview into Program.
  if (preset.obsMode !== "studio") problems.push(`${preset.slug}: the kit is Studio Mode (K.6), not ${preset.obsMode}`);
  for (const page of presetPages(preset)) {
    const mixer = page.actions.find((entry) => entry.controller === "Encoder" && entry.column === 0);
    if (!mixer || mixer.kind !== "fader" || mixer.settings.target !== "tbar") {
      problems.push(`${page.name} Encoder 0,0: dial 1 of every page is the scene mixer (an OBS Fader on the T-bar)`);
    }
    for (const entry of page.actions) {
      const where = `${page.name} ${entry.controller} ${entry.column},${entry.row}`;
      const s = entry.settings;
      const own: string[] = [];
      switch (entry.kind) {
        case "playlister": {
          const source = byUuid.get(text(s.inputUuid));
          if (!source || source.id !== "obs_playlister_source") {
            problems.push(`${where}: inputUuid '${text(s.inputUuid)}' is not a kit Playlister`);
          } else if (s.inputName !== source.name) {
            problems.push(`${where}: inputName '${text(s.inputName)}' is not '${source.name}'`);
          }
          own.push(text(s.inputName));
          break;
        }
        case "filter": {
          const source = byUuid.get(text(s.sourceUuid));
          const filter = source?.filters?.find((candidate) => candidate.name === s.filterName);
          if (!source) {
            problems.push(`${where}: sourceUuid '${text(s.sourceUuid)}' is not a kit source`);
          } else if (s.sourceName !== source.name) {
            problems.push(`${where}: sourceName '${text(s.sourceName)}' is not '${source.name}'`);
          } else if (!filter) {
            problems.push(`${where}: '${source.name}' has no filter '${text(s.filterName)}'`);
          } else if (s.filterKind !== filter.versioned_id) {
            problems.push(`${where}: filterKind '${text(s.filterKind)}' is not '${filter.versioned_id}'`);
          }
          const toggle = entry.controller === "Keypad" && (s.keyOperation ?? "toggle") === "toggle";
          if (!toggle && !isTableSetting(text(s.filterKind), text(s.setting))) {
            problems.push(`${where}: '${text(s.setting)}' is not a setting the deck rides on ${text(s.filterKind)}`);
          }
          own.push(text(s.sourceName), text(s.filterName));
          break;
        }
        case "layer": {
          const scene = ids.scenes.find((candidate) => candidate.name === s.sceneName);
          const item = scene?.items.find((candidate) => candidate.id === s.sceneItemId);
          const source = item ? byName.get(item.source) : undefined;
          if (s.scope !== "fixed" || s.target !== "fixed") {
            problems.push(`${where}: a kit layer key has a fixed scene and source`);
          } else if (!scene) {
            problems.push(`${where}: sceneName '${text(s.sceneName)}' is not a kit scene`);
          } else if (!item || !source) {
            problems.push(`${where}: '${scene.name}' has no item ${String(s.sceneItemId)}`);
          } else if (s.sourceUuid !== source.uuid || s.sourceName !== source.name) {
            problems.push(`${where}: item ${item.id} of '${scene.name}' is '${source.name}' (${source.uuid})`);
          }
          own.push(text(s.sourceName));
          break;
        }
        case "scene": {
          const index = SCENE_INDEX.exec(text(s.sceneTarget));
          if (!index || Number(index[1]) >= ids.scenes.length) {
            problems.push(`${where}: sceneTarget '${text(s.sceneTarget)}' is not __scene_index_N__ of a kit scene`);
          } else if (entry.label !== `Scene ${Number(index[1]) + 1}`) {
            problems.push(`${where}: a key to scene index ${index[1]} is captioned 'Scene ${Number(index[1]) + 1}'`);
          }
          if (s.operation !== "preview") {
            problems.push(`${where}: a kit scene key cues its scene in Preview (operation 'preview'), not '${text(s.operation)}'`);
          }
          break;
        }
        case "fader":
        case "fade": {
          if (entry.kind === "fader" && s.target === "tbar") break;  // the scene mixer: no input
          const source = byName.get(text(s.inputName));
          if (!source || source.id !== "ffmpeg_source") {
            problems.push(`${where}: inputName '${text(s.inputName)}' is not a kit media source`);
          }
          own.push(text(s.inputName));
          break;
        }
        case "panic":
        case "page":
          break;
      }
      const action = captionAction(entry);
      if (action && entry.label !== undefined) {
        const context = action === "filter" ? { ...s, control: entry.controller === "Encoder" ? "dial" : "key" } : s;
        if (!isGeneratedCaption(action, context, entry.label) && !own.filter(Boolean).includes(entry.label)) {
          problems.push(`${where}: caption '${entry.label}' is neither a shipped caption nor the control's own OBS name`);
        }
      }
    }
  }
  return problems;
}

/** What is wrong with the VJster page: every action drives the OBS page (plan section 4). */
export function kitSpeedProblems(layout: VjsterLayout): string[] {
  const problems: string[] = [];
  for (const slot of [...layout.keys, ...layout.encoders]) {
    if (slot.settings?.target !== "obs") problems.push(`${layout.file} ${slot.kind} ${slot.at.join(",")}: target is not 'obs'`);
  }
  if (/\b(OBS|YouTube)\b/i.test(layout.name)) problems.push(`${layout.file}: the profile name '${layout.name}' names OBS or YouTube`);
  return problems;
}

/** Both profiles, checked, as [file name, archive bytes]; throws with every problem found. */
export function buildKitProfiles(kit = loadKit(), names = promisedProfileFiles()): Array<{ file: string; bytes: Buffer }> {
  const { layouts, ids, manifest } = kit;
  validatePreset(layouts.fadester, manifest);
  const problems = [...kitBindingProblems(layouts.fadester, ids), ...kitSpeedProblems(layouts.vjster)];
  if (problems.length > 0) throw new Error(`the kit's layouts do not match kit-ids.json:\n${problems.join("\n")}`);
  if (names.length !== 2) throw new Error(`kit_docs.PROFILE_FILES names ${names.length} profiles, not 2`);
  const fadester = buildProfile(layouts.fadester, manifest);
  return [
    { file: names[0]!, bytes: zip(fadester.files) },
    { file: names[1]!, bytes: vjsterZip(profileFiles(layouts.vjster)) }
  ];
}

function main(argv: string[]): void {
  const at = argv.indexOf("--out");
  const out = at >= 0 && argv[at + 1] ? resolve(argv[at + 1]!) : join(KIT_DIR, "build", "profiles");
  mkdirSync(out, { recursive: true });
  for (const { file, bytes } of buildKitProfiles()) {
    const destination = join(out, file);
    writeFileSync(destination, bytes);
    console.log(`wrote ${destination}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
