// SPDX-License-Identifier: GPL-2.0-or-later
// Packs the built VJster Chrome extension (vjster-extension/bin) into
// release/vjster-chrome-extension-<version>.zip, to unzip and load unpacked
// (docs/vjster/INSTALL.md, PLAN.md Phase 1 step 6). Run from the repository
// root after building it:
//
//   npx rollup -c vjster-extension/rollup.config.mjs
//   node --import tsx scripts/vjster/pack-extension.ts           (the zip to load unpacked)
//   node --import tsx scripts/vjster/pack-extension.ts --store   (the zip for the Chrome Web Store: YouTube only)
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
  permissions?: unknown;
  optional_host_permissions?: unknown;
  default_locale?: unknown;
  background?: { service_worker?: unknown };
  options_page?: unknown;
  icons?: Record<string, unknown>;
  content_scripts?: { js?: unknown[] }[];
}

const here = fileURLToPath(import.meta.url);
/** The extension's language folders in the source (PLAN.md 8.5). */
export const SOURCE_LOCALES = resolve(dirname(here), "../../vjster-extension/_locales");

/** The languages in a `_locales` folder: the subfolders that hold a messages.json. */
export function localesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, "messages.json")))
    .sort();
}

/**
 * Every file the manifest names, plus the manifest itself, ALSO_NEEDED, the
 * default language's messages and those of `locales`; a build without one is
 * refused.
 */
export function neededFiles(manifest: ExtensionManifest, locales: readonly string[] = []): string[] {
  const named = [
    manifest.background?.service_worker,
    manifest.options_page,
    ...Object.values(manifest.icons ?? {}),
    ...(manifest.content_scripts ?? []).flatMap((s) => s.js ?? [])
  ].filter((p): p is string => typeof p === "string");
  const languages = [...(typeof manifest.default_locale === "string" ? [manifest.default_locale] : []), ...locales];
  return [...new Set(["manifest.json", ...named, ...ALSO_NEEDED, ...languages.map((l) => `_locales/${l}/messages.json`)])].sort();
}

/**
 * The manifest of the Chrome Web Store build: YouTube only. The optional all-sites permission goes, and with it
 * `scripting`, which only that option uses; a smaller list of permissions is a quicker review. No `key` is added:
 * the store refuses one on a first upload and gives the extension its id (docs/vjster/STORE.md).
 */
export function storeManifest<T extends ExtensionManifest>(manifest: T): T {
  const { optional_host_permissions: _optional, ...rest } = manifest;
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions.filter((p) => p !== "scripting") : manifest.permissions;
  return { ...rest, ...(permissions === undefined ? {} : { permissions }) } as T;
}

function files(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? files(full) : [full];
    });
}

/**
 * Zip a built extension folder; returns the zip's bytes, the version from its
 * manifest and the file names. Source maps are left out. Every language in
 * `locales` (by default those of the source) must be in the build.
 */
export function packExtension(
  bin: string,
  locales: readonly string[] = localesIn(SOURCE_LOCALES),
  options: { store?: boolean } = {}
): { version: string; bytes: Buffer; names: string[] } {
  const manifestPath = join(bin, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`${bin} has no manifest.json; build the extension first`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
  if (typeof manifest.version !== "string" || !/^[0-9]+(\.[0-9]+){0,3}$/.test(manifest.version)) throw new Error("the extension manifest has no usable version");
  const entries = files(bin)
    .filter((f) => !f.endsWith(".map"))
    .map((f) => ({ name: relative(bin, f).split("\\").join("/"), data: readFileSync(f) }))
    .map((e) => (options.store && e.name === "manifest.json" ? { ...e, data: Buffer.from(`${JSON.stringify(storeManifest(manifest), null, 2)}\n`, "utf8") } : e));
  for (const needed of neededFiles(manifest, locales)) {
    if (!entries.some((e) => e.name === needed)) throw new Error(`the build has no ${needed}; build the extension first`);
  }
  return { version: manifest.version, bytes: zip(entries), names: entries.map((e) => e.name) };
}

const invoked = (): boolean => {
  try {
    return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(here);
  } catch {
    return false; // run from stdin or a path that no longer exists: imported, not invoked
  }
};
if (invoked()) {
  const root = resolve(dirname(here), "../..");
  const store = process.argv.includes("--store");
  const { version, bytes, names } = packExtension(join(root, "vjster-extension", "bin"), undefined, { store });
  const out = join(root, "release", `vjster-chrome-extension-${version}${store ? "-store" : ""}.zip`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${names.length} files)`);
}
