// SPDX-License-Identifier: GPL-2.0-or-later
// Build one local Windows + macOS candidate, without installing or publishing it.
// node --import tsx scripts/suite/package-candidate.ts [--check]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { packExtension } from "../vjster/pack-extension.js";

type Manifest = {
  UUID: string;
  Version: string;
  CodePath: string;
  CodePathMac?: string;
  CodePathWin?: string;
  Nodejs: { Version: string };
  OS: { Platform: string; MinimumVersion: string }[];
  Icon?: string;
  CategoryIcon?: string;
  Profiles?: { Name: string }[];
  Actions: {
    UUID: string;
    OS?: string[];
    Icon?: string;
    PropertyInspectorPath?: string;
    Encoder?: { layout?: string };
    States?: { Image?: string }[];
  }[];
};

const SUITE = "io.github.jbrick2070.fadester-for-obs.sdPlugin";
const VJSTER = "com.jbrick2070.vjster.sdPlugin";

/** Use directory entries, rather than existsSync, to catch case errors on Windows too. */
function fileNames(dir: string): string[] {
  const visit = (current: string): string[] => readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error(`Package contains a symbolic link: ${entry.name}`);
    const full = join(current, entry.name);
    return entry.isDirectory() ? visit(full) : [relative(dir, full).split("\\").join("/")];
  });
  return visit(dir);
}

/** Additional portability checks; the official CLI still validates the complete manifest. */
export function checkPortablePlugin(dir: string): Manifest {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
  const platforms = new Map(manifest.OS.map((os) => [os.Platform, os.MinimumVersion]));
  if (platforms.size !== 2 || manifest.OS.length !== 2 || platforms.get("mac") !== "13.5" || platforms.get("windows") !== "10") {
    throw new Error(`${manifest.UUID}: expected Windows 10 and macOS 13.5 in the same manifest`);
  }
  if (manifest.Nodejs.Version !== "24" || manifest.CodePathMac || manifest.CodePathWin || !manifest.CodePath.endsWith(".js")) {
    throw new Error(`${manifest.UUID}: expected one shared Node 24 JavaScript entry point`);
  }
  const files = new Set(fileNames(dir));
  if (new Set([...files].map((file) => file.toLowerCase())).size !== files.size) throw new Error(`${manifest.UUID}: conflicting filename case`);
  const requireFile = (path: string | undefined, suffixes = [""]): void => {
    if (path === undefined) return;
    if (path.includes("\\") || path.startsWith("/") || path.split("/").includes("..") || !suffixes.some((suffix) => files.has(path + suffix))) {
      throw new Error(`${manifest.UUID}: missing or case-mismatched package path ${path}`);
    }
  };
  requireFile(manifest.CodePath);
  requireFile(manifest.Icon, ["", ".svg", ".png"]);
  requireFile(manifest.CategoryIcon, ["", ".svg", ".png"]);
  for (const profile of manifest.Profiles ?? []) requireFile(profile.Name, [".streamDeckProfile"]);
  for (const action of manifest.Actions) {
    if (action.OS && (!["mac", "windows"].every((os) => action.OS!.includes(os)) || action.OS.length !== 2)) {
      throw new Error(`${action.UUID}: action is not enabled on both platforms`);
    }
    requireFile(action.Icon, ["", ".svg", ".png"]);
    requireFile(action.PropertyInspectorPath);
    if (action.Encoder?.layout && !action.Encoder.layout.startsWith("$")) requireFile(action.Encoder.layout);
    for (const state of action.States ?? []) requireFile(state.Image, ["", ".svg", ".png"]);
  }
  return manifest;
}

function run(root: string, args: string[]): void {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build command failed (${result.status ?? result.signal}): node ${args.join(" ")}`);
}

/** Builds only repository outputs; never invokes Stream Deck's install/restart commands. */
export function packageCandidate(root: string): string {
  const rollup = "node_modules/rollup/dist/bin/rollup";
  const cli = "node_modules/@elgato/cli/bin/streamdeck.mjs";
  if (!existsSync(join(root, cli))) throw new Error("Run npm ci with Node 24 before packaging");
  run(root, ["node_modules/typescript/bin/tsc", "--noEmit"]);
  run(root, ["--import", "tsx", "scripts/build-profiles.ts"]);
  run(root, ["--import", "tsx", "scripts/vjster/build-profiles.ts"]);
  for (const config of ["rollup.config.mjs", "vjster-page/rollup.config.mjs", "vjster-plugin/rollup.config.mjs"]) run(root, [rollup, "-c", config]);
  run(root, ["--import", "tsx", "scripts/suite/assemble.ts"]);
  run(root, [rollup, "-c", "suite-plugin/rollup.config.mjs"]);
  run(root, ["--import", "tsx", "scripts/suite/copy-vjster.ts"]);
  run(root, [rollup, "-c", "vjster-extension/rollup.config.mjs"]);
  const manifest = checkPortablePlugin(join(root, SUITE));
  checkPortablePlugin(join(root, VJSTER));
  run(root, ["--import", "tsx", "scripts/suite/assemble.ts", "--check"]);
  run(root, [cli, "validate", SUITE]);
  run(root, [cli, "validate", VJSTER]);

  const out = join(root, "release", "candidates", "windows-macos");
  mkdirSync(out, { recursive: true });
  run(root, [cli, "pack", SUITE, "--output", out, "--force"]);
  const extension = packExtension(join(root, "vjster-extension", "bin"));
  const extensionName = `vjster-chrome-extension-${extension.version}.zip`;
  writeFileSync(join(out, extensionName), extension.bytes);
  const names = [`${manifest.UUID}.streamDeckPlugin`, extensionName];
  const artifacts = names.map((name) => {
    const bytes = readFileSync(join(out, name));
    return { name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  writeFileSync(join(out, "CANDIDATE.json"), JSON.stringify({
    status: "Local candidate; platform declarations and packaging checks are not runtime or hardware certification.",
    plugin: manifest.UUID,
    version: manifest.Version,
    platforms: manifest.OS,
    builtWith: { node: process.versions.node, platform: process.platform, architecture: process.arch },
    artifacts
  }, null, 2) + "\n");
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(import.meta.dirname, "..", "..");
  if (process.argv.includes("--check")) {
    for (const name of [SUITE, VJSTER]) console.log(`Portable package paths and declarations passed: ${checkPortablePlugin(join(root, name)).UUID}`);
  } else {
    console.log(`Local candidate written to ${packageCandidate(root)}`);
  }
}
