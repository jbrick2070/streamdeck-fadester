// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_DIR } from "./languages.js";

/** The shared runtimes the vm tests replace with stubs. */
const STUBBED_RUNTIMES = new Set(["direct-pi.js", "pi-common.js"]);

/**
 * The code an inspector page runs, in page order, for a vm test: its own
 * helper scripts (`<script src>` in ui/, e.g. preset-captions.js) and its
 * inline scripts. The shared runtimes are left to the test's stubs.
 */
export function inspectorPageScript(html: string): string {
  return [...html.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g)].map(([, src, inline]) => {
    if (!src) return inline;
    return STUBBED_RUNTIMES.has(src) ? "" : readFileSync(join(PLUGIN_DIR, "ui", src), "utf8");
  }).join("\n");
}
