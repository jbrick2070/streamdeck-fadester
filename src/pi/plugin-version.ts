// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The version as people read it: the manifest's four parts without the fourth
 * (Stream Deck's build number), so "0.13.0.0" reads 0.13.0 and "1.0.0.0" reads 1.0.0.
 */
export function displayVersion(manifestVersion: string): string {
  const parts = manifestVersion.trim().split(".");
  return parts.length === 4 ? parts.slice(0, 3).join(".") : manifestVersion.trim();
}

let cachedPluginVersion: string | undefined;

/** The plugin's own version (manifest.json sits one folder above bin/); "" when it cannot be read, as in tests. */
export function pluginVersion(): string {
  if (cachedPluginVersion === undefined) {
    try {
      const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "manifest.json"), "utf8")) as { Version?: string };
      cachedPluginVersion = displayVersion(String(manifest.Version ?? ""));
    } catch {
      cachedPluginVersion = "";
    }
  }
  return cachedPluginVersion;
}
