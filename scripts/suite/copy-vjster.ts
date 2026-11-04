// SPDX-License-Identifier: GPL-2.0-or-later
// npm run suite:copy-vjster
// Copies the built VJster plugin (com.jbrick2070.vjster.sdPlugin/bin: plugin.js and the OBS page) into the suite plugin's
// bin/vjster, where the launcher starts it from (docs/SUITE.md). Build VJster first (npm run build:vjster).

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

export function copyVjster(root: string): string {
  const from = join(root, "com.jbrick2070.vjster.sdPlugin", "bin");
  const to = join(root, "io.github.jbrick2070.fadester-for-obs.sdPlugin", "bin", "vjster");
  if (!existsSync(join(from, "plugin.js"))) throw new Error(`${from} has no plugin.js; run npm run build:vjster first`);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  return to;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  console.log(`copied VJster to ${copyVjster(resolve(import.meta.dirname, "..", ".."))}`);
}
