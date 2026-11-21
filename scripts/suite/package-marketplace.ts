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
import { zip } from "../profile-checks.js";
import { checkPortablePlugin } from "./package-candidate.js";

export const SUITE_ID = "io.github.jbrick2070.fadester-for-obs";
export const MARKETPLACE_ID = "com.jbrick2070.fadester-for-obs";
/** The actions of the 0.8 build that is on the Marketplace: keys people placed then must still find their action. */
export const MARKETPLACE_08_ACTIONS = [
  "obs-neo-infobar", "layer-control", "obs-fader", "scene-transition", "obs-fade", "playlister-transport", "obs-filter",
  "visual-panic", "fader", "auto-fade"
] as const;

/** Files that are text and may name the ID. Everything else is copied byte for byte and then checked. */
const TEXT = new Set([".json", ".js", ".cjs", ".mjs", ".html", ".css", ".svg", ".txt", ".map", ".md"]);
const PROFILE = ".streamDeckProfile";

export function reId(text: string): string {
  return text.split(SUITE_ID).join(MARKETPLACE_ID);
}

/** The entries of a profile archive as scripts/profile-checks.ts writes them: UTF-8 names, stored or deflated. */
export function unzip(bytes: Buffer): Array<{ path: string; content: string }> {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Not a ZIP archive");
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const files: Array<{ path: string; content: string }> = [];
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw new Error("Damaged ZIP directory");
    const method = bytes.readUInt16LE(at + 10);
    const size = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extra = bytes.readUInt16LE(at + 30);
    const comment = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const path = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`${path}: ZIP method ${method} is not read here`);
    files.push({ path, content: (method === 8 ? inflateRawSync(raw) : raw).toString("utf8") });
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

/** A profile with every action under the Marketplace ID; entry names, order and all other content are kept. */
export function reIdProfile(bytes: Buffer): Buffer {
  return zip(unzip(bytes).map((file) => ({ path: reId(file.path), content: reId(file.content) })));
}

function filesUnder(dir: string): string[] {
  const visit = (current: string): string[] => readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error(`The plugin folder holds a symbolic link: ${entry.name}`);
    const full = join(current, entry.name);
    return entry.isDirectory() ? visit(full) : [relative(dir, full).split("\\").join("/")];
  });
  return visit(dir).sort();
}

/** Every file of a staged folder that still names the other ID, looked for in the bytes and inside the profiles. */
export function filesNaming(dir: string, id: string): string[] {
  const needle = Buffer.from(id, "utf8");
  return filesUnder(dir).filter((file) => {
    const bytes = readFileSync(join(dir, file));
    if (file.includes(id) || bytes.includes(needle)) return true;
    return file.endsWith(PROFILE) && unzip(bytes).some((entry) => entry.path.includes(id) || entry.content.includes(id));
  });
}

export interface Staged {
  dir: string;
  files: number;
  /** Files whose content changed: text that named the ID, and the profiles. */
  changed: string[];
  version: string;
  actions: string[];
}

/**
 * Copies a Fadester for OBS plugin folder to `outDir`/com.jbrick2070.fadester-for-obs.sdPlugin with the Marketplace
 * ID in every file, and proves it: no file names the other ID any more, the manifest's plugin and action IDs are
 * the Marketplace's, the actions are the same nineteen, and the ten of 0.8 are among them. Stream Deck's own logs
 * (logs/, *.log) are left out.
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
    if (file.endsWith(PROFILE)) out = reIdProfile(bytes);
    else if (TEXT.has(extname(file).toLowerCase())) out = Buffer.from(reId(bytes.toString("utf8")), "utf8");
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
  const before = source.Actions.map((action) => short(action.UUID, SUITE_ID));
  if (actions.join() !== before.join()) throw new Error("The staged manifest lists other actions than the plugin it was made from");
  const lost = MARKETPLACE_08_ACTIONS.filter((action) => !actions.includes(action));
  if (lost.length) throw new Error(`Keys placed with the Marketplace's 0.8 would lose their action: ${lost.join(", ")}`);
  return { dir, files, changed, version: manifest.Version, actions };
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
