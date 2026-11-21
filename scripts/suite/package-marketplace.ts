// SPDX-License-Identifier: GPL-2.0-or-later
// The Elgato Marketplace edition of Fadester for OBS: the built plugin under the ID its Marketplace product has had
// since 0.8, com.jbrick2070.fadester-for-obs. Every other download (GitHub, Suite Setup, OpenDeck) is
// io.github.jbrick2070.fadester-for-obs, the ID the OpenDeck catalogue asked for. Maker Console refuses a package whose
// ID is not the product's, and a person's keys are stored under the plugin's ID, so an update there must keep it.
// The code and the nineteen actions are the same; only the ID differs, in every file that names it.
//
//   npm run build
//   node --import tsx scripts/suite/package-marketplace.ts      (or: npm run pack:marketplace)
//
// It writes release/marketplace/com.jbrick2070.fadester-for-obs.streamDeckPlugin and MARKETPLACE.json. It never
// installs, uploads or publishes anything.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { VJSTER_KINDS } from "../../src/suite/actions.js";
import { zip } from "../profile-checks.js";
import { checkPortablePlugin } from "./package-candidate.js";

export const SUITE_ID = "io.github.jbrick2070.fadester-for-obs";
export const MARKETPLACE_ID = "com.jbrick2070.fadester-for-obs";
/** The actions of the 0.8 build that is on the Marketplace: keys people placed then must still find their action. */
export const MARKETPLACE_08_ACTIONS = [
  "obs-neo-infobar", "layer-control", "obs-fader", "scene-transition", "obs-fade", "playlister-transport", "obs-filter",
  "visual-panic", "fader", "auto-fade"
] as const;

/**
 * File types that are text and are rewritten when they name the ID. A file of another type is copied byte for byte;
 * should one name the ID, staging stops and says which (add its type here once it is known to be text).
 */
const TEXT = new Set([
  ".json", ".js", ".cjs", ".mjs", ".ts", ".html", ".htm", ".css", ".svg", ".txt", ".map", ".md", ".xml", ".yaml", ".yml"
]);
const PROFILE = ".streamDeckProfile";
const NEEDLE = Buffer.from(SUITE_ID, "utf8");

export function reId(text: string): string {
  return text.split(SUITE_ID).join(MARKETPLACE_ID);
}

const isUtf8 = (bytes: Buffer): boolean => Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes);

/**
 * The same bytes with the Marketplace ID wherever the other one stood. Bytes that do not name the ID come back
 * untouched, whatever they are; bytes that name it must be valid UTF-8 text, or this stops.
 */
export function reIdBytes(bytes: Buffer, what: string): Buffer {
  if (!bytes.includes(NEEDLE)) return bytes;
  if (!isUtf8(bytes)) throw new Error(`${what} names ${SUITE_ID} but is not UTF-8 text, so it cannot be rewritten safely`);
  return Buffer.from(reId(bytes.toString("utf8")), "utf8");
}

/**
 * The entries of a profile archive as scripts/profile-checks.ts writes them: UTF-8 names, stored or deflated, no
 * ZIP64. Anything else is refused by name instead of being read wrongly.
 */
export function unzip(bytes: Buffer): Array<{ path: string; data: Buffer }> {
  // The end record is the last 22 bytes plus its comment; a signature inside the comment is not it.
  let end = -1;
  for (let at = bytes.length - 22; at >= 0 && at >= bytes.length - 22 - 0xffff; at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("Not a ZIP archive");
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error("ZIP64 archives are not read here");
  const files: Array<{ path: string; data: Buffer }> = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new Error("Damaged ZIP directory");
    const method = bytes.readUInt16LE(at + 10);
    const size = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extra = bytes.readUInt16LE(at + 30);
    const comment = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const path = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    if (size === 0xffffffff || local === 0xffffffff) throw new Error(`${path}: ZIP64 entries are not read here`);
    if (method !== 0 && method !== 8) throw new Error(`${path}: ZIP method ${method} is not read here`);
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error(`${path}: damaged ZIP entry`);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + size > end) throw new Error(`${path}: damaged ZIP entry`);
    const raw = bytes.subarray(start, start + size);
    files.push({ path, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

/**
 * A profile with every action under the Marketplace ID. Entry names and order are kept; an entry that does not name
 * the ID (a picture, for one) is carried byte for byte.
 */
export function reIdProfile(bytes: Buffer, what = "A profile"): Buffer {
  return zip(unzip(bytes).map((file) => ({ path: reId(file.path), content: reIdBytes(file.data, `${what}, ${file.path},`) })));
}

function filesUnder(dir: string): string[] {
  const visit = (current: string): string[] => readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error(`The plugin folder holds a symbolic link: ${entry.name}`);
    const full = join(current, entry.name);
    return entry.isDirectory() ? visit(full) : [relative(dir, full).split("\\").join("/")];
  });
  return visit(dir).sort();
}

/** Every file of a folder that names the given ID, looked for in its name, its bytes and inside the profiles. */
export function filesNaming(dir: string, id: string): string[] {
  const needle = Buffer.from(id, "utf8");
  return filesUnder(dir).filter((file) => {
    const bytes = readFileSync(join(dir, file));
    if (file.includes(id) || bytes.includes(needle)) return true;
    return file.endsWith(PROFILE) && unzip(bytes).some((entry) => entry.path.includes(id) || entry.data.includes(needle));
  });
}

/**
 * Every place of a staged folder that names an action by its whole ID, each with where it stands: the actions on the
 * keys of the profiles, the action names in the language files, and the actions the built code registers. (The
 * suite's VJster actions are put together from the ID and a kind in the code; stageMarketplace checks the kinds.)
 */
export function actionIdsIn(dir: string): Array<{ id: string; where: string }> {
  const found: Array<{ id: string; where: string }> = [];
  const walk = (value: unknown, key: string, where: string): void => {
    if (Array.isArray(value)) for (const item of value) walk(item, key, where);
    else if (value && typeof value === "object") for (const [name, item] of Object.entries(value)) walk(item, name, where);
    else if (key === "UUID" && typeof value === "string" && value.startsWith(MARKETPLACE_ID)) found.push({ id: value, where });
  };
  for (const file of filesUnder(dir)) {
    const bytes = readFileSync(join(dir, file));
    if (file.endsWith(PROFILE)) {
      for (const entry of unzip(bytes)) {
        if (entry.path.endsWith(".json")) walk(JSON.parse(entry.data.toString("utf8")), "", `${file}, ${entry.path}`);
      }
    } else if (/^[A-Za-z_]+\.json$/.test(file) && file !== "manifest.json") {
      for (const key of Object.keys(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as object)) {
        if (key.startsWith(MARKETPLACE_ID)) found.push({ id: key, where: file });
      }
    } else if (/^bin\/[^/]+\.js$/.test(file)) {
      for (const match of bytes.toString("utf8").matchAll(/\bUUID:\s*"([^"]+)"/g)) {
        if (match[1].startsWith(MARKETPLACE_ID)) found.push({ id: match[1], where: file });
      }
    }
  }
  return found;
}

export interface Staged {
  dir: string;
  files: number;
  /** Files whose bytes changed: those that named the ID. */
  changed: string[];
  version: string;
  actions: string[];
  /** How many action IDs in profiles, language files and built code were checked against the manifest. */
  actionIdsChecked: number;
}

/**
 * Copies a Fadester for OBS plugin folder to `outDir`/com.jbrick2070.fadester-for-obs.sdPlugin with the Marketplace
 * ID in every file that named the other one, and proves it: no file names the other ID any more; the manifest's
 * plugin and action IDs are the Marketplace's; every action a profile's key, a language file or the built code names
 * is one of the manifest's; the suite's seven VJster actions are among them; and so are the ten of 0.8. A file that
 * does not name the ID is copied byte for byte. Stream Deck's own logs (logs/, *.log) are left out.
 */
export function stageMarketplace(sourceDir: string, outDir: string): Staged {
  const source = JSON.parse(readFileSync(join(sourceDir, "manifest.json"), "utf8")) as { UUID: string; Actions: { UUID: string }[] };
  if (source.UUID !== SUITE_ID) throw new Error(`${sourceDir}: expected the plugin ${SUITE_ID}, found ${source.UUID}`);
  const dir = join(outDir, `${MARKETPLACE_ID}.sdPlugin`);
  rmSync(dir, { recursive: true, force: true });
  const changed: string[] = [];
  let files = 0;
  for (const file of filesUnder(sourceDir)) {
    if (file.startsWith("logs/") || file.endsWith(".log")) continue;
    const bytes: Buffer = readFileSync(join(sourceDir, file));
    let out: Buffer = bytes;
    if (file.endsWith(PROFILE)) {
      // rewritten only when an entry names the ID: any other profile stays the archive it was
      if (unzip(bytes).some((entry) => entry.data.includes(NEEDLE) || entry.path.includes(SUITE_ID))) out = reIdProfile(bytes, file);
    } else if (TEXT.has(extname(file).toLowerCase())) {
      out = reIdBytes(bytes, file);
    }
    const destination = join(dir, reId(file));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, out);
    if (!out.equals(bytes)) changed.push(file);
    files++;
  }

  const left = filesNaming(dir, SUITE_ID);
  if (left.length) throw new Error(`These files still name ${SUITE_ID}: ${left.join(", ")}`);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { UUID: string; Version: string; Actions: { UUID: string }[] };
  if (manifest.UUID !== MARKETPLACE_ID) throw new Error(`The staged manifest's UUID is ${manifest.UUID}`);
  const short = (uuid: string, id: string): string => {
    if (!uuid.startsWith(id + ".")) throw new Error(`The action ${uuid} is not under ${id}`);
    return uuid.slice(id.length + 1);
  };
  const actions = manifest.Actions.map((action) => short(action.UUID, MARKETPLACE_ID));
  if (actions.join() !== source.Actions.map((action) => short(action.UUID, SUITE_ID)).join()) {
    throw new Error("The staged manifest lists other actions than the plugin it was made from");
  }
  const known = new Set([MARKETPLACE_ID, ...actions.map((action) => `${MARKETPLACE_ID}.${action}`)]);
  const named = actionIdsIn(dir);
  const unknown = named.filter((entry) => !known.has(entry.id));
  if (unknown.length) {
    throw new Error(`These name an action the manifest does not list: ${unknown.slice(0, 8).map((entry) => `${entry.id} (${entry.where})`).join("; ")}`);
  }
  const vjster = VJSTER_KINDS.map((kind) => `vjster-${kind}`).filter((action) => !actions.includes(action));
  if (vjster.length) throw new Error(`The manifest lacks the suite's VJster actions: ${vjster.join(", ")}`);
  const lost = MARKETPLACE_08_ACTIONS.filter((action) => !actions.includes(action));
  if (lost.length) throw new Error(`Keys placed with the Marketplace's 0.8 would lose their action: ${lost.join(", ")}`);
  return { dir, files, changed, version: manifest.Version, actions, actionIdsChecked: named.length };
}

function run(root: string, args: string[]): void {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? result.signal}): node ${args.join(" ")}`);
}

/** Stages, validates with Elgato's own tool and packs. Needs a finished `npm run build`; builds nothing itself. */
export function packageMarketplace(root: string): string {
  const cli = "node_modules/@elgato/cli/bin/streamdeck.mjs";
  if (!existsSync(join(root, cli))) throw new Error("Run npm ci with Node 24 before packaging");
  const suite = join(root, `${SUITE_ID}.sdPlugin`);
  const built = checkPortablePlugin(suite); // also proves the build is there: it needs bin/<CodePath>
  run(root, ["--import", "tsx", "scripts/suite/assemble.ts", "--check"]);

  const out = join(root, "release", "marketplace");
  // a generated folder: emptied first, so nothing of an earlier or failed run passes for this package
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const staged = stageMarketplace(suite, out);
  const manifest = checkPortablePlugin(staged.dir);
  if (manifest.Version !== built.Version) throw new Error("The staged version is not the built plugin's");
  run(root, [cli, "validate", relative(root, staged.dir)]);
  run(root, [cli, "pack", relative(root, staged.dir), "--output", relative(root, out), "--force"]);

  const name = `${MARKETPLACE_ID}.streamDeckPlugin`;
  const bytes = readFileSync(join(out, name));
  writeFileSync(join(out, "MARKETPLACE.json"), JSON.stringify({
    status: "The Elgato Marketplace edition: the same build as the GitHub download under the Marketplace product's ID. Not uploaded by this script.",
    plugin: MARKETPLACE_ID,
    madeFrom: SUITE_ID,
    version: staged.version,
    actions: staged.actions,
    actionIdsChecked: staged.actionIdsChecked,
    files: staged.files,
    filesChanged: staged.changed.length,
    builtWith: { node: process.versions.node, platform: process.platform, architecture: process.arch },
    artifact: { name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
  }, null, 2) + "\n");
  // only the package and its note stay: the staged folder would otherwise pass for an installable plugin
  rmSync(staged.dir, { recursive: true, force: true });
  return join(out, name);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(import.meta.dirname, "..", "..");
  console.log(`Marketplace package written to ${packageMarketplace(root)}`);
}
