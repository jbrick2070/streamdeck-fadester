// SPDX-License-Identifier: GPL-2.0-or-later
// Writes the VJster settings page's texts, com.jbrick2070.vjster.sdPlugin/ui/
// i18n.js, from the `Localization.pi` objects of the plugin's `<lang>.json`
// files (docs/vjster/PLAN.md 8.4). The page is a plain script that Stream
// Deck loads from a file, where reading a sibling file with fetch is not
// reliable, so the texts come in as a script loaded before vjster.js. Run from
// the repository root after changing a language file:
//
//   node --import tsx scripts/vjster/make-pi-strings.ts
//
// tests/vjster-pi.test.ts fails when the written file is not current.

import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
export const PLUGIN_DIR = resolve(dirname(here), "../../com.jbrick2070.vjster.sdPlugin");
export const PI_STRINGS_FILE = join(PLUGIN_DIR, "ui", "i18n.js");

/** The deck words the settings page also shows: the default strip labels, as input placeholders. */
export const DECK_WORDS_FOR_PI = ["speed", "fxSpeed", "quality"] as const;

const LANGUAGE_FILE = /^([a-z]{2})(_[A-Z]{2})?\.json$/;

type Table = Record<string, string>;

/** Only string entries, sorted by key, so the file is the same whatever order a language file has. */
function strings(value: unknown): Table {
  const out: Table = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const key of Object.keys(value).sort()) {
    const text = (value as Record<string, unknown>)[key];
    if (key !== "_comment" && typeof text === "string") out[key] = text;
  }
  return out;
}

/** The page's tables by language, from every `<lang>.json` in `dir`. */
export function piTables(dir: string = PLUGIN_DIR): Record<string, { pi: Table; deck: Table }> {
  const out: Record<string, { pi: Table; deck: Table }> = {};
  for (const name of readdirSync(dir).filter((n) => LANGUAGE_FILE.test(n)).sort()) {
    const loc = (JSON.parse(readFileSync(join(dir, name), "utf8")) as { Localization?: Record<string, unknown> }).Localization ?? {};
    const deck: Table = {};
    for (const key of DECK_WORDS_FOR_PI) if (typeof loc[key] === "string") deck[key] = loc[key] as string;
    out[name.slice(0, -".json".length)] = { pi: strings(loc.pi), deck };
  }
  return out;
}

/** The text of ui/i18n.js. */
export function piStringsSource(dir: string = PLUGIN_DIR): string {
  return [
    "// SPDX-License-Identifier: GPL-2.0-or-later",
    "// VJster settings page texts by language. Written by scripts/vjster/make-pi-strings.ts",
    "// from Localization.pi in the plugin's <lang>.json files; change those and run it again.",
    `window.VJSTER_PI_STRINGS = ${JSON.stringify(piTables(dir), null, 2)};`,
    ""
  ].join("\n");
}

const invoked = (): boolean => {
  try {
    return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(here);
  } catch {
    return false;
  }
};
if (invoked()) {
  writeFileSync(PI_STRINGS_FILE, piStringsSource());
  console.log(`wrote ${PI_STRINGS_FILE}`);
}
