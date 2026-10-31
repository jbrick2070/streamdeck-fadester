// SPDX-License-Identifier: GPL-2.0-or-later
// Builds VJster's bundled Stream Deck profiles (docs/vjster/PLAN.md Phase 1
// step 5): a live layout for the Stream Deck +, the 15-key Stream Deck and the
// Mini, written as .streamDeckProfile files the plugin manifest lists. Run
// from the repository root:
//
//   node --import tsx scripts/vjster/build-profiles.ts
//
// The output is deterministic: stable ids from the layout names, a fixed
// archive date, so rebuilding without changes changes no bytes.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pluginDir = join(root, "com.jbrick2070.vjster.sdPlugin");

interface ManifestAction {
  UUID: string;
  Name: string;
  Controllers: string[];
}
const manifest = JSON.parse(readFileSync(join(pluginDir, "manifest.json"), "utf8")) as {
  Name: string;
  UUID: string;
  Version: string;
  Actions: ManifestAction[];
  Profiles: { Name: string; DeviceType: number }[];
};

type Kind = "speed" | "quality" | "speed-preset" | "speed-step" | "quality-preset" | "pin" | "transport";

interface Slot {
  kind: Kind;
  /** Column, row; row is 0 for dials. */
  at: [number, number];
  settings?: Record<string, unknown>;
}

interface Layout {
  file: string;
  name: string;
  deviceType: 0 | 1 | 7;
  model: string;
  columns: number;
  rows: number;
  dials: number;
  keys: Slot[];
  encoders: Slot[];
}

const fx = (rate: number) => ({ rate, extended: true, hold: true });
const preset = (rate: number) => ({ rate, extended: false, hold: true });
const on = <T extends Record<string, unknown>>(target: "browser" | "obs" | "both", settings: T) => ({ ...settings, target });

/**
 * The layouts. Built for a live VJ set: the most used speeds under the
 * fingers, the FX extremes (ultra slow-motion and hyper speed) on the corners,
 * play/pause and pin always in the same place, and on the Stream Deck + four
 * dials: speed, a fine nudge for beat-matching, quality, and FX speed.
 * VJster Dual + (Phase 2) plays two sources side by side: the video in Chrome
 * and the OBS page, a dial each, a SYNC dial and keys that drive both at once,
 * and an FX dial for Chrome's extended range.
 */
export const LAYOUTS: Layout[] = [
  {
    file: "vjster-live-plus",
    name: "VJster Live +",
    deviceType: 7,
    model: "20GBD9901",
    columns: 4,
    rows: 2,
    dials: 4,
    keys: [
      { kind: "speed-preset", at: [0, 0], settings: fx(0.1) },
      { kind: "speed-preset", at: [1, 0], settings: preset(0.5) },
      { kind: "speed-preset", at: [2, 0], settings: preset(1) },
      { kind: "speed-preset", at: [3, 0], settings: preset(2) },
      { kind: "transport", at: [0, 1] },
      { kind: "pin", at: [1, 1] },
      { kind: "quality-preset", at: [2, 1], settings: { level: "auto", hold: true } },
      { kind: "speed-preset", at: [3, 1], settings: fx(8) }
    ],
    encoders: [
      { kind: "speed", at: [0, 0], settings: { label: "SPEED", step: 0.25, fineStep: 0.05, extended: false, hold: true } },
      { kind: "speed", at: [1, 0], settings: { label: "NUDGE", step: 0.05, fineStep: 0.05, extended: false, hold: true } },
      { kind: "quality", at: [2, 0], settings: { label: "QUALITY", hold: true } },
      { kind: "speed", at: [3, 0], settings: { label: "FX SPEED", step: 0.5, fineStep: 0.1, extended: true, hold: true } }
    ]
  },
  {
    file: "vjster-dual-plus",
    name: "VJster Dual +",
    deviceType: 7,
    model: "20GBD9901",
    columns: 4,
    rows: 2,
    dials: 4,
    keys: [
      { kind: "speed-preset", at: [0, 0], settings: on("browser", preset(1)) },
      { kind: "transport", at: [1, 0], settings: { target: "browser" } },
      { kind: "speed-preset", at: [2, 0], settings: on("obs", preset(1)) },
      { kind: "transport", at: [3, 0], settings: { target: "obs" } },
      { kind: "speed-preset", at: [0, 1], settings: on("both", preset(0.5)) },
      { kind: "speed-preset", at: [1, 1], settings: on("both", preset(1)) },
      { kind: "speed-preset", at: [2, 1], settings: on("both", preset(2)) },
      { kind: "pin", at: [3, 1] }
    ],
    encoders: [
      { kind: "speed", at: [0, 0], settings: on("browser", { label: "CHROME", step: 0.25, fineStep: 0.05, extended: false, hold: true }) },
      { kind: "speed", at: [1, 0], settings: on("obs", { label: "OBS", step: 0.25, fineStep: 0.05, extended: false, hold: true }) },
      { kind: "speed", at: [2, 0], settings: on("both", { label: "SYNC", step: 0.25, fineStep: 0.05, extended: false, hold: true }) },
      { kind: "speed", at: [3, 0], settings: on("browser", { label: "CHROME FX", step: 0.5, fineStep: 0.1, extended: true, hold: true }) }
    ]
  },
  {
    file: "vjster-live-15",
    name: "VJster Live",
    deviceType: 0,
    model: "20GAA9902",
    columns: 5,
    rows: 3,
    dials: 0,
    keys: [
      { kind: "speed-preset", at: [0, 0], settings: fx(0.1) },
      { kind: "speed-preset", at: [1, 0], settings: preset(0.25) },
      { kind: "speed-preset", at: [2, 0], settings: preset(0.5) },
      { kind: "speed-preset", at: [3, 0], settings: preset(0.75) },
      { kind: "speed-preset", at: [4, 0], settings: preset(1) },
      { kind: "speed-preset", at: [0, 1], settings: preset(1.25) },
      { kind: "speed-preset", at: [1, 1], settings: preset(1.5) },
      { kind: "speed-preset", at: [2, 1], settings: preset(2) },
      { kind: "speed-preset", at: [3, 1], settings: preset(4) },
      { kind: "speed-preset", at: [4, 1], settings: fx(8) },
      { kind: "speed-step", at: [0, 2], settings: { direction: -1, step: 0.05, extended: false } },
      { kind: "speed-step", at: [1, 2], settings: { direction: 1, step: 0.05, extended: false } },
      { kind: "transport", at: [2, 2] },
      { kind: "pin", at: [3, 2] },
      { kind: "quality-preset", at: [4, 2], settings: { level: "auto", hold: true } }
    ],
    encoders: []
  },
  {
    file: "vjster-live-mini",
    name: "VJster Mini",
    deviceType: 1,
    model: "20GAI9901",
    columns: 3,
    rows: 2,
    dials: 0,
    keys: [
      { kind: "speed-step", at: [0, 0], settings: { direction: -1, step: 0.25, extended: false } },
      { kind: "speed-preset", at: [1, 0], settings: preset(1) },
      { kind: "speed-step", at: [2, 0], settings: { direction: 1, step: 0.25, extended: false } },
      { kind: "transport", at: [0, 1] },
      { kind: "speed-preset", at: [1, 1], settings: preset(2) },
      { kind: "pin", at: [2, 1] }
    ],
    encoders: []
  }
];

/** A stable UUID from text (name-based, version 5 layout over SHA-1). */
export function stableUuid(...parts: string[]): string {
  const h = createHash("sha1").update(`vjster:${parts.join(":")}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

/** A plain ZIP archive: deflated entries, UTF-8 names, a fixed date, no extra fields. */
export function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, nameBytes, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += head.length + nameBytes.length + packed.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBytes, end]);
}

function slotEntry(layout: Layout, controller: "Keypad" | "Encoder", slot: Slot) {
  const uuid = `${manifest.UUID}.${slot.kind}`;
  const action = manifest.Actions.find((a) => a.UUID === uuid);
  if (!action) throw new Error(`${layout.file}: no action ${uuid} in the manifest`);
  if (!action.Controllers.includes(controller)) throw new Error(`${layout.file}: ${uuid} has no ${controller}`);
  return {
    ActionID: stableUuid(layout.file, controller, slot.at.join(",")),
    LinkedTitle: true,
    Name: action.Name,
    Plugin: { Name: manifest.Name, UUID: manifest.UUID, Version: manifest.Version },
    Resources: null,
    Settings: slot.settings ?? {},
    State: 0,
    States: [{}],
    UUID: uuid
  };
}

/** Check a layout: every slot inside the grid, no slot used twice. */
export function validate(layout: Layout): void {
  const seen = new Set<string>();
  for (const [controller, slots, cols, rows] of [
    ["Keypad", layout.keys, layout.columns, layout.rows],
    ["Encoder", layout.encoders, layout.dials, 1]
  ] as const) {
    for (const s of slots) {
      const [c, r] = s.at;
      if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 || c >= cols || r >= rows) {
        throw new Error(`${layout.file}: ${controller} slot ${c},${r} is outside the ${cols}x${rows} grid`);
      }
      const key = `${controller}:${c},${r}`;
      if (seen.has(key)) throw new Error(`${layout.file}: ${key} is used twice`);
      seen.add(key);
    }
  }
}

/** The files of one profile archive. */
export function profileFiles(layout: Layout): { name: string; data: Buffer }[] {
  validate(layout);
  const profile = stableUuid(layout.file, "profile").toUpperCase();
  const page = stableUuid(layout.file, "page");
  const blank = stableUuid(layout.file, "default");
  const controllers = layout.dials > 0 ? (["Keypad", "Encoder"] as const) : (["Keypad"] as const);
  const pageManifest = {
    Controllers: controllers.map((type) => {
      const slots = type === "Keypad" ? layout.keys : layout.encoders;
      const actions = Object.fromEntries(slots.map((s) => [s.at.join(","), slotEntry(layout, type, s)]));
      return { Actions: Object.keys(actions).length > 0 ? actions : null, Type: type };
    }),
    Icon: "",
    Name: layout.name
  };
  const blankManifest = { Controllers: controllers.map((type) => ({ Actions: null, Type: type })), Icon: "", Name: "" };
  const top = {
    Device: { Model: layout.model, UUID: "" },
    Name: layout.name,
    Pages: { Current: page, Default: blank, Pages: [page] },
    Version: "3.0"
  };
  const base = `${profile}.sdProfile`;
  const json = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8");
  return [
    { name: `${base}/manifest.json`, data: json(top) },
    { name: `${base}/Profiles/${page.toUpperCase()}/manifest.json`, data: json(pageManifest) },
    { name: `${base}/Profiles/${blank.toUpperCase()}/manifest.json`, data: json(blankManifest) }
  ];
}

function main(): void {
  for (const layout of LAYOUTS) {
    const listed = manifest.Profiles.find((p) => p.Name === `profiles/${layout.file}`);
    if (!listed || listed.DeviceType !== layout.deviceType) throw new Error(`${layout.file}: not listed in the manifest with device type ${layout.deviceType}`);
    const out = join(pluginDir, "profiles", `${layout.file}.streamDeckProfile`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, zip(profileFiles(layout)));
    console.log(`wrote ${out}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
