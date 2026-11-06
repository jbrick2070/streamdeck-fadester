// SPDX-License-Identifier: GPL-2.0-or-later
// VJster language files, as the tests see them (docs/vjster/REQUIREMENTS.md
// R-I18N-3..5; PLAN.md section 8). The tests check every language file that
// is present; the lists below say which must be present. Extend them here,
// in this one place, as each language is added.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EN, stringsFrom, type DeckKey, type Strings } from "../src/vjster/plugin/strings.js";

export const ROOT = process.cwd();
export const PLUGIN_DIR = join(ROOT, "com.jbrick2070.vjster.sdPlugin");

/**
 * Languages that must have a file. Stream Deck: `<lang>.json` at the plugin
 * root (with `Localization.pi` for the settings page). Chrome:
 * `vjster-extension/_locales/<lang>/messages.json`. OBS page: the table in
 * `vjster-page/src/page-text.ts`.
 */
export const REQUIRED = {
  deck: ["en", "de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW", "nl"],
  chrome: ["en", "de", "es", "fr", "ja", "ko", "nl", "pt_BR", "ru", "tr", "zh_CN", "zh_TW"],
  page: ["en", "de", "es", "fr", "ja", "ko", "pt_BR", "ru", "tr", "zh_CN", "zh_TW"]
} as const;

/** The languages each part will have once all are written (R-I18N-3); not checked, only listed. */
export const PLANNED = {
  deck: ["en", "de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW", "nl"],
  chrome: ["en", "de", "es", "fr", "ja", "ko", "nl", "pt_BR", "ru", "tr", "zh_CN", "zh_TW"],
  page: ["en", "de", "es", "fr", "ja", "ko", "pt_BR", "ru", "tr", "zh_CN", "zh_TW"]
} as const;

/**
 * Deck languages the Stream Deck app does not read: their file has `Localization` only (deck words and page texts),
 * because the app shows its own action list and plugin texts (PLAN.md 11.2, D-L4). Dutch gets its manifest texts in
 * step L.7.
 */
export const LOCALIZATION_ONLY: readonly string[] = ["nl"];

/** A Stream Deck language file name: `de.json`, `zh_CN.json`. */
const DECK_FILE = /^([a-z]{2})(_[A-Z]{2})?\.json$/;

export interface DeckLanguageFile {
  readonly lang: string;
  readonly path: string;
  readonly bytes: Buffer;
  readonly json: Record<string, unknown>;
}

/** Every Stream Deck language file at the plugin root, English first. */
export function deckLanguageFiles(): DeckLanguageFile[] {
  return readdirSync(PLUGIN_DIR)
    .filter((name) => DECK_FILE.test(name))
    .sort((a, b) => (a === "en.json" ? -1 : b === "en.json" ? 1 : a.localeCompare(b)))
    .map((name) => {
      const path = join(PLUGIN_DIR, name);
      const bytes = readFileSync(path);
      return { lang: name.slice(0, -".json".length), path, bytes, json: JSON.parse(bytes.toString("utf8")) as Record<string, unknown> };
    });
}

/** A file's `Localization` object, or an empty one. */
export function localization(file: DeckLanguageFile): Record<string, unknown> {
  const l = file.json.Localization;
  return typeof l === "object" && l !== null && !Array.isArray(l) ? (l as Record<string, unknown>) : {};
}

/** The deck words of every language file, as the plugin builds them; the built-in English when there is no file. */
export function deckTables(): { lang: string; strings: Strings }[] {
  const files = deckLanguageFiles();
  if (files.length === 0) return [{ lang: "en", strings: EN }];
  return files.map((f) => {
    const l = localization(f);
    return { lang: f.lang, strings: stringsFrom((k: DeckKey) => l[k]) };
  });
}
