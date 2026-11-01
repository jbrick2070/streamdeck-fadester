// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The bundled profiles' shape, checks and contents (PLAN.md 10.6), apart from
 * scripts/build-profiles.ts so tests can import them without writing files.
 * A preset holds one page (`actions`) or several (`pages`); the VJ rig's pages
 * use Elgato's own Next page key, written in the exact shape of Elgato's page
 * plugin (no Fadester manifest entry, no caption), and its checks hold Panic on
 * one key on every page with nothing that changes Program next to it.
 */
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { profilePathForSlug, profileRevisionForSlug } from "../src/types/layouts.js";

export type PresetKind = "layer" | "scene" | "fader" | "fade" | "playlister" | "filter" | "panic" | "page";

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

export type PluginManifest = {
  Name: string;
  UUID: string;
  Version: string;
  Actions: Array<{ UUID: string; Name: string; Controllers: string[] }>;
};

/** Elgato's page plugin (com.elgato.streamdeck.page.sdPlugin, PrivateAPI, profile format 3.0). */
export const PAGE_PLUGIN = { Name: "Pages", UUID: "com.elgato.streamdeck.page", Version: "1.0" } as const;
export const NEXT_PAGE_ACTION = "com.elgato.streamdeck.page.next";

const FADESTER_ACTIONS: Record<Exclude<PresetKind, "page">, string> = {
  layer: "layer-control",
  scene: "scene-transition",
  fader: "obs-fader",
  fade: "obs-fade",
  playlister: "playlister-transport",
  filter: "obs-filter",
  panic: "visual-panic"
};

export function actionUuidFor(kind: PresetKind, pluginUuid: string): string {
  return kind === "page" ? NEXT_PAGE_ACTION : `${pluginUuid}.${FADESTER_ACTIONS[kind]}`;
}

/** Every page of a preset; a single-page preset is one page named as the profile. */
export function presetPages(preset: Preset): PresetPage[] {
  return preset.pages ?? [{ name: preset.name, actions: preset.actions ?? [] }];
}

export function stableUuid(slug: string, seed: string): string {
  const bytes = createHash("sha256").update(`fadester-profile:v${profileRevisionForSlug(slug)}:${slug}:${seed}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Small deterministic ZIP writer: standard UTF-8 paths, deflate, no ZIP64. */
export function zip(files: Array<{ path: string; content: string }>): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const data = Buffer.from(file.content, "utf8");
    const compressed = deflateRawSync(data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x0021, 12); // 1980-01-01, stable archive date.
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localRecords.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralRecords.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralData = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, centralData, end]);
}

/** A Scene & Transition key that changes Program: a Cut or a Transition (Preview keys do not; no operation is a Transition). */
export function changesProgram(entry: PresetAction): boolean {
  const operation = entry.settings.operation ?? "transition";
  return entry.kind === "scene" && (operation === "cut" || operation === "transition");
}

/**
 * The rig's rules (R-RIG-7): on every page Panic sits on its key and Next page
 * on its own, and no key among the eight around Panic changes Program.
 */
export function checkRigRules(preset: Preset): void {
  if (!preset.rig) return;
  const [panicColumn, panicRow] = preset.rig.panic;
  const [nextColumn, nextRow] = preset.rig.nextPage;
  for (const page of presetPages(preset)) {
    const keys = page.actions.filter((entry) => entry.controller === "Keypad");
    const at = (column: number, row: number): PresetAction | undefined =>
      keys.find((entry) => entry.column === column && entry.row === row);
    const panic = at(panicColumn, panicRow);
    if (!panic || panic.kind !== "panic" || (panic.settings.operation ?? "panic") !== "panic") {
      throw new Error(`${preset.slug} / ${page.name}: Panic must sit on key ${panicColumn},${panicRow} on every page.`);
    }
    const next = at(nextColumn, nextRow);
    if (!next || next.kind !== "page") {
      throw new Error(`${preset.slug} / ${page.name}: Next page must sit on key ${nextColumn},${nextRow} on every page.`);
    }
    for (const entry of keys) {
      if (Math.abs(entry.column - panicColumn) <= 1 && Math.abs(entry.row - panicRow) <= 1 && changesProgram(entry)) {
        throw new Error(`${preset.slug} / ${page.name}: '${entry.label}' changes Program next to Panic (${entry.column},${entry.row}).`);
      }
    }
  }
}

export function validatePreset(preset: Preset, manifest: PluginManifest): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preset.slug)) {
    throw new Error(`Invalid preset slug '${preset.slug}'.`);
  }
  if (!["either", "studio", "regular"].includes(preset.obsMode)) {
    throw new Error(`${preset.slug}: choose a valid OBS mode label.`);
  }
  if (Boolean(preset.pages) === Boolean(preset.actions)) {
    throw new Error(`${preset.slug}: give either actions (one page) or pages.`);
  }
  for (const page of presetPages(preset)) {
    const seen = new Set<string>();
    for (const entry of page.actions) {
      const key = `${entry.controller}:${entry.column},${entry.row}`;
      if (entry.kind === "page") {
        // Elgato's own key, keys only: no Fadester manifest entry to look up.
        if (entry.controller !== "Keypad") throw new Error(`${preset.slug}: a page key must be a key (${key}).`);
      } else {
        const id = actionUuidFor(entry.kind, manifest.UUID);
        const action = manifest.Actions.find((candidate) => candidate.UUID === id);
        if (!action || !action.Controllers.includes(entry.controller)) {
          throw new Error(`${preset.slug}: '${id}' does not support ${entry.controller}.`);
        }
      }
      if (seen.has(key)) {
        throw new Error(`${preset.slug}: repeated position ${key}.`);
      }
      seen.add(key);
      const columns = entry.controller === "Encoder" ? preset.dials : preset.columns;
      const rows = entry.controller === "Encoder" ? 1 : preset.rows;
      if (!Number.isInteger(entry.column) || !Number.isInteger(entry.row) ||
          entry.column < 0 || entry.column >= columns || entry.row < 0 || entry.row >= rows) {
        throw new Error(`${preset.slug}: out-of-range position ${key}.`);
      }
      if (Object.keys(entry.settings).some((name) => /password|token|secret/i.test(name))) {
        throw new Error(`${preset.slug}: profiles must not contain credentials.`);
      }
      if (preset.obsMode !== "studio" &&
          (entry.settings.operation === "preview" ||
           entry.settings.sceneTarget === "__current_preview__" ||
           entry.settings.target === "tbar")) {
        throw new Error(`${preset.slug}: a ${preset.obsMode}-mode preset contains a Studio Mode control.`);
      }
    }
  }
  checkRigRules(preset);
}

export interface BuiltProfile {
  path: string;
  files: Array<{ path: string; content: string }>;
  manifestEntry: Record<string, unknown>;
  catalogEntry: Record<string, unknown>;
}

/** The profile's files, its manifest `Profiles` entry and its catalog entry; deterministic (stable UUIDs). */
export function buildProfile(preset: Preset, manifest: PluginManifest): BuiltProfile {
  const pages = presetPages(preset);
  const multi = pages.length > 1;
  const profileUuid = stableUuid(preset.slug, "root");
  const pageUuids = pages.map((_, index) => stableUuid(preset.slug, index === 0 ? "page" : `page:${index + 1}`));
  const defaultPageUuid = stableUuid(preset.slug, "default");
  const prefix = `${profileUuid.toUpperCase()}.sdProfile`;
  const controllerNames = preset.dials > 0 ? ["Keypad", "Encoder"] : ["Keypad"];
  const pageFiles = pages.map((page, index) => {
    const seed = (controller: string, entry: PresetAction): string =>
      `${index === 0 ? "" : `page:${index + 1}:`}${controller}:${entry.column},${entry.row}`;
    const controllers = controllerNames.map((controller) => {
      const actions: Record<string, unknown> = {};
      for (const entry of page.actions.filter((candidate) => candidate.controller === controller)) {
        const actionId = stableUuid(preset.slug, seed(controller, entry));
        if (entry.kind === "page") {
          // Elgato's page key exactly: its own plugin block, no settings, no caption (its icon says it).
          actions[`${entry.column},${entry.row}`] = {
            ActionID: actionId,
            LinkedTitle: true,
            Name: "Next Page",
            Plugin: { ...PAGE_PLUGIN },
            Resources: null,
            Settings: {},
            State: 0,
            States: [{}],
            UUID: NEXT_PAGE_ACTION
          };
          continue;
        }
        const actionUuid = actionUuidFor(entry.kind, manifest.UUID);
        const action = manifest.Actions.find((candidate) => candidate.UUID === actionUuid)!;
        const accent = page.accent && page.accent !== "default" && entry.settings.accent === undefined ? { accent: page.accent } : {};
        actions[`${entry.column},${entry.row}`] = {
          ActionID: actionId,
          LinkedTitle: true,
          Name: action.Name,
          Plugin: { Name: manifest.Name, UUID: manifest.UUID, Version: manifest.Version },
          Resources: null,
          Settings: { ...entry.settings, ...accent, labelOverride: entry.label ?? "" },
          State: 0,
          States: [{}],
          UUID: actionUuid
        };
      }
      return { Actions: Object.keys(actions).length > 0 ? actions : null, Type: controller };
    });
    return {
      path: `${prefix}/Profiles/${pageUuids[index]!.toUpperCase()}/manifest.json`,
      content: JSON.stringify({ Controllers: controllers, Icon: "", Name: multi ? page.name : preset.name })
    };
  });
  const rootManifest = {
    Device: { Model: preset.deviceModel, UUID: "" },
    Name: preset.name,
    Pages: { Current: pageUuids[0], Default: defaultPageUuid, Pages: pageUuids },
    Version: "3.0"
  };
  const files = [
    { path: `${prefix}/manifest.json`, content: JSON.stringify(rootManifest) },
    ...pageFiles,
    {
      path: `${prefix}/Profiles/${defaultPageUuid.toUpperCase()}/manifest.json`,
      content: JSON.stringify({
        Controllers: controllerNames.map((Type) => ({ Actions: null, Type })),
        Icon: "", Name: ""
      })
    }
  ];
  const path = profilePathForSlug(preset.slug);
  // Keys and dials in use count the busiest page.
  const most = (controller: string): number => Math.max(...pages.map((page) =>
    page.actions.filter((entry) => entry.controller === controller).length));
  return {
    path,
    files,
    manifestEntry: {
      Name: path,
      DeviceType: preset.deviceType,
      Readonly: false,
      AutoInstall: false,
      DontAutoSwitchWhenInstalled: true
    },
    catalogEntry: {
      slug: preset.slug,
      name: preset.name,
      description: preset.description,
      obsMode: preset.obsMode,
      deviceType: preset.deviceType,
      file: `${path}.streamDeckProfile`,
      ...(multi ? { pages: pages.map((page) => page.name) } : {}),
      keysUsed: most("Keypad"),
      keysAvailable: preset.columns * preset.rows,
      dialsUsed: most("Encoder"),
      dialsAvailable: preset.dials
    }
  };
}
