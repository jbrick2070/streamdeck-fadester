// SPDX-License-Identifier: GPL-2.0-or-later
// Packs the built VJster Chrome extension (vjster-extension/bin) into
// release/vjster-chrome-extension-<version>.zip, to unzip and load unpacked
// (docs/vjster/INSTALL.md, PLAN.md Phase 1 step 6). Run from the repository
// root after building it:
//
//   npx rollup -c vjster-extension/rollup.config.mjs
//   node --import tsx scripts/vjster/pack-extension.ts
//
// The zip writer is build-profiles.ts's: fixed dates, so the same build gives
// the same bytes.

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zip } from "./build-profiles.js";

/** Needed although the manifest does not name it: the options page loads it. */
export const ALSO_NEEDED = ["options.js"] as const;

interface ExtensionManifest {
  version?: unknown;
  background?: { service_worker?: unknown };
  options_page?: unknown;
  icons?: Record<string, unknown>;
  content_scripts?: { js?: unknown[] }[];
}

/** Every file the manifest names, plus the manifest itself and ALSO_NEEDED; a build without one is refused. */
export function neededFiles(manifest: ExtensionManifest): string[] {
  const named = [
    manifest.background?.service_worker,
    manifest.options_page,
    ...Object.values(manifest.icons ?? {}),
    ...(manifest.content_scripts ?? []).flatMap((s) => s.js ?? [])
  ].filter((p): p is string => typeof p === "string");
  return [...new Set(["manifest.json", ...named, ...ALSO_NEEDED])].sort();
}

function files(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? files(full) : [full];
    });
}

/** Zip a built extension folder; returns the zip's bytes, the version from its manifest and the file names. Source maps are left out. */
export function packExtension(bin: string): { version: string; bytes: Buffer; names: string[] } {
  const manifestPath = join(bin, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`${bin} has no manifest.json; build the extension first`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
  if (typeof manifest.version !== "string" || !/^[0-9]+(\.[0-9]+){0,3}$/.test(manifest.version)) throw new Error("the extension manifest has no usable version");
  const entries = files(bin)
    .filter((f) => !f.endsWith(".map"))
    .map((f) => ({ name: relative(bin, f).split("\\").join("/"), data: readFileSync(f) }));
  for (const needed of neededFiles(manifest)) {
    if (!entries.some((e) => e.name === needed)) throw new Error(`the build has no ${needed}; build the extension first`);
  }
  return { version: manifest.version, bytes: zip(entries), names: entries.map((e) => e.name) };
}

const here = fileURLToPath(import.meta.url);
const invoked = (): boolean => {
  try {
    return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(here);
  } catch {
    return false; // run from stdin or a path that no longer exists: imported, not invoked
  }
};
if (invoked()) {
  const root = resolve(dirname(here), "../..");
  const { version, bytes, names } = packExtension(join(root, "vjster-extension", "bin"));
  const out = join(root, "release", `vjster-chrome-extension-${version}.zip`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${names.length} files)`);
}
