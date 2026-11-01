// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { STREAM_DECK_LANGUAGES } from "../../src/i18n/strings.js";

export const PLUGIN_DIR = resolve(process.cwd(), "com.jbrick2070.fadester-for-obs.sdPlugin");

/**
 * The languages that must ship. Extend this one list when a language is added;
 * every other test takes its languages from the files present.
 */
export const REQUIRED_LANGUAGES: readonly string[] = ["en", "de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW"];

export function languageFilePath(language: string): string {
  return join(PLUGIN_DIR, `${language}.json`);
}

/** Stream Deck's languages that have a `<lang>.json` at the plugin root. */
export function presentLanguages(): string[] {
  return STREAM_DECK_LANGUAGES.filter((language) => existsSync(languageFilePath(language)));
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
