// SPDX-License-Identifier: GPL-2.0-or-later
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { profilePathForSlug, profileRevisionForSlug } from "../src/types/layouts.js";

/**
 * Builds self-contained, importable profiles from our reviewable preset list.
 * It never reads or writes the user's Stream Deck ProfilesV3 directory.
 * Profile structure is based on the locally shipped Stream Deck templates and
 * the V3 manifests produced by Stream Deck 7.1+, our plugin's minimum version.
 */
type PresetAction = {
  controller: "Keypad" | "Encoder";
  column: number;
  row: number;
  kind: "layer" | "scene" | "fader" | "fade";
  label: string;
  settings: Record<string, string | number | boolean>;
};

type Preset = {
  slug: string;
  name: string;
  description: string;
  obsMode: "either" | "studio" | "regular";
  deviceType: 0 | 1 | 7;
  deviceModel: string;
  columns: number;
  rows: number;
  dials: number;
  actions: PresetAction[];
};

const root = resolve(import.meta.dirname, "..");
const pluginDirectory = join(root, "com.jbrick2070.fadester-for-obs.sdPlugin");
const manifest = JSON.parse(readFileSync(join(pluginDirectory, "manifest.json"), "utf8")) as {
  Name: string;
  UUID: string;
  Version: string;
  Actions: Array<{ UUID: string; Name: string; Controllers: string[] }>;
};
const presets = JSON.parse(readFileSync(join(root, "profiles", "layouts.json"), "utf8")) as Preset[];
const actionIds: Record<PresetAction["kind"], string> = {
  layer: `${manifest.UUID}.layer-control`,
  scene: `${manifest.UUID}.scene-transition`,
  fader: `${manifest.UUID}.obs-fader`,
  fade: `${manifest.UUID}.obs-fade`
};

function stableUuid(slug: string, seed: string): string {
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
function zip(files: Array<{ path: string; content: string }>): Buffer {
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

function validatePreset(preset: Preset): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preset.slug)) {
    throw new Error(`Invalid preset slug '${preset.slug}'.`);
  }
  if (!["either", "studio", "regular"].includes(preset.obsMode)) {
    throw new Error(`${preset.slug}: choose a valid OBS mode label.`);
  }
  const seen = new Set<string>();
  for (const entry of preset.actions) {
    const id = actionIds[entry.kind];
    const action = manifest.Actions.find((candidate) => candidate.UUID === id);
    if (!action || !action.Controllers.includes(entry.controller)) {
      throw new Error(`${preset.slug}: '${id}' does not support ${entry.controller}.`);
    }
    const key = `${entry.controller}:${entry.column},${entry.row}`;
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
    if (Object.keys(entry.settings).some((key) => /password|token|secret/i.test(key))) {
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

const outputDirectory = join(pluginDirectory, "profiles");
mkdirSync(outputDirectory, { recursive: true });
const profileManifestEntries: Array<Record<string, unknown>> = [];
const catalog: Array<Record<string, unknown>> = [];

for (const preset of presets) {
  validatePreset(preset);
  const profileUuid = stableUuid(preset.slug, "root");
  const pageUuid = stableUuid(preset.slug, "page");
  const defaultPageUuid = stableUuid(preset.slug, "default");
  const prefix = `${profileUuid.toUpperCase()}.sdProfile`;
  const controllerNames = preset.dials > 0 ? ["Keypad", "Encoder"] : ["Keypad"];
  const controllers = controllerNames.map((controller) => {
    const actions: Record<string, unknown> = {};
    for (const entry of preset.actions.filter((candidate) => candidate.controller === controller)) {
      const actionUuid = actionIds[entry.kind];
      const action = manifest.Actions.find((candidate) => candidate.UUID === actionUuid)!;
      actions[`${entry.column},${entry.row}`] = {
        ActionID: stableUuid(preset.slug, `${controller}:${entry.column},${entry.row}`),
        LinkedTitle: true,
        Name: action.Name,
        Plugin: { Name: manifest.Name, UUID: manifest.UUID, Version: manifest.Version },
        Resources: null,
        Settings: { ...entry.settings, labelOverride: entry.label },
        State: 0,
        States: [{}],
        UUID: actionUuid
      };
    }
    return { Actions: Object.keys(actions).length > 0 ? actions : null, Type: controller };
  });
  const rootManifest = {
    Device: { Model: preset.deviceModel, UUID: "" },
    Name: preset.name,
    Pages: { Current: pageUuid, Default: defaultPageUuid, Pages: [pageUuid] },
    Version: "3.0"
  };
  const files = [
    { path: `${prefix}/manifest.json`, content: JSON.stringify(rootManifest) },
    {
      path: `${prefix}/Profiles/${pageUuid.toUpperCase()}/manifest.json`,
      content: JSON.stringify({ Controllers: controllers, Icon: "", Name: preset.name })
    },
    {
      path: `${prefix}/Profiles/${defaultPageUuid.toUpperCase()}/manifest.json`,
      content: JSON.stringify({
        Controllers: controllerNames.map((Type) => ({ Actions: null, Type })),
        Icon: "", Name: ""
      })
    }
  ];
  const profilePath = profilePathForSlug(preset.slug);
  const destination = join(pluginDirectory, `${profilePath}.streamDeckProfile`);
  writeFileSync(destination, zip(files));
  profileManifestEntries.push({
    Name: profilePath,
    DeviceType: preset.deviceType,
    Readonly: false,
    AutoInstall: false,
    DontAutoSwitchWhenInstalled: true
  });
  catalog.push({
    slug: preset.slug,
    name: preset.name,
    description: preset.description,
    obsMode: preset.obsMode,
    deviceType: preset.deviceType,
    file: `${profilePath}.streamDeckProfile`,
    keysUsed: preset.actions.filter((entry) => entry.controller === "Keypad").length,
    keysAvailable: preset.columns * preset.rows,
    dialsUsed: preset.actions.filter((entry) => entry.controller === "Encoder").length,
    dialsAvailable: preset.dials
  });
  console.log(`${preset.name}: ${destination}`);
}

// Reviewable generated metadata for manifest hookup and an eventual in-app
// preset picker. The script does not mutate the plugin manifest itself.
for (const [filename, data] of [
  ["catalog.json", catalog],
  ["manifest-entries.json", profileManifestEntries]
] as const) {
  const destination = join(root, "profiles", filename);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
