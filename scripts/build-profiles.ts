// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PluginManifest, Preset, buildProfile, validatePreset, zip } from "./profile-checks.js";

/**
 * Builds self-contained, importable profiles from our reviewable preset list.
 * It never reads or writes the user's Stream Deck ProfilesV3 directory.
 * Profile structure is based on the locally shipped Stream Deck templates and
 * the V3 manifests produced by Stream Deck 7.1+ (our plugin's minimum is 7.6 since 0.7.7).
 * The shapes, checks and contents live in scripts/profile-checks.ts (tests import them).
 */
const root = resolve(import.meta.dirname, "..");
const pluginDirectory = join(root, "com.jbrick2070.fadester-for-obs.sdPlugin");
const manifest = JSON.parse(readFileSync(join(pluginDirectory, "manifest.json"), "utf8")) as PluginManifest;
const presets = JSON.parse(readFileSync(join(root, "profiles", "layouts.json"), "utf8")) as Preset[];

const outputDirectory = join(pluginDirectory, "profiles");
mkdirSync(outputDirectory, { recursive: true });
const profileManifestEntries: Array<Record<string, unknown>> = [];
const catalog: Array<Record<string, unknown>> = [];

for (const preset of presets) {
  validatePreset(preset, manifest);
  const built = buildProfile(preset, manifest);
  const destination = join(pluginDirectory, `${built.path}.streamDeckProfile`);
  writeFileSync(destination, zip(built.files));
  profileManifestEntries.push(built.manifestEntry);
  catalog.push(built.catalogEntry);
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
