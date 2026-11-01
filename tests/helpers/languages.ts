// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLUGIN_LANGUAGES, STREAM_DECK_LANGUAGES } from "../../src/i18n/strings.js";

export const PLUGIN_DIR = resolve(process.cwd(), "com.jbrick2070.fadester-for-obs.sdPlugin");

/**
 * The languages that must ship. Extend this one list when a language is added;
 * every other test takes its languages from the files present.
 */
export const REQUIRED_LANGUAGES: readonly string[] = ["en", "de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW", "nl"];

export function languageFilePath(language: string): string {
  return join(PLUGIN_DIR, `${language}.json`);
}

/** The plugin's nine languages (Stream Deck's eight and Dutch) that have a `<lang>.json` at the plugin root. */
export function presentLanguages(): string[] {
  return PLUGIN_LANGUAGES.filter((language) => existsSync(languageFilePath(language)));
}

/**
 * The present languages the Stream Deck app itself reads (its Name, Description and action texts): Stream Deck's
 * eight. Dutch has `Localization` only until step L.7 adds its manifest texts (PLAN.md 11.2, D-L4).
 */
export function appReadLanguages(): string[] {
  return presentLanguages().filter((language) => (STREAM_DECK_LANGUAGES as readonly string[]).includes(language));
}

export interface LanguageFile {
  Name?: string;
  Description?: string;
  Category?: string;
  Localization: Record<string, unknown>;
  [uuid: string]: unknown;
}

export function readLanguageFile(language: string): LanguageFile {
  return JSON.parse(readFileSync(languageFilePath(language), "utf8")) as LanguageFile;
}

/** The deck strings of a language: its `Localization` without the inspector table. */
export function deckTable(language: string): Record<string, unknown> {
  const table = { ...readLanguageFile(language).Localization };
  delete table.pi;
  return table;
}
