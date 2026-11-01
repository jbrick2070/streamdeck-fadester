// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Reads the deck table of a language from its `<lang>.json` at the plugin root
 * (the plugin's working folder under Stream Deck). The plugin uses its own
 * `t()` over this table: the SDK's translator fills no placeholders and
 * returns the bare key when a file is missing (R-I18N-1, PLAN.md 8.4).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LanguageTable, STREAM_DECK_LANGUAGES, setLanguage } from "./strings.js";

/** Stream Deck's language, or English for anything it does not offer. */
export function normalizeLanguage(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().replace(/-/g, "_") : "";
  const exact = STREAM_DECK_LANGUAGES.find((language) => language.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const lower = value.toLowerCase();
  // Traditional Chinese regions and scripts read zh_TW; other Chinese zh_CN.
  if (/^zh_(hant|hk|mo)/.test(lower)) return "zh_TW";
  if (lower === "zh" || lower.startsWith("zh_")) return "zh_CN";
  const base = lower.split("_")[0] ?? "";
  return STREAM_DECK_LANGUAGES.find((language) => language === base) ?? "en";
}

/** The `Localization` table of `<language>.json` without the inspectors' part, or null. */
export function readLanguageTable(language: string, dir = process.cwd()): LanguageTable | null {
  const path = join(dir, `${language}.json`);
  if (!existsSync(path)) return null;
  try {
    const json = JSON.parse(readFileSync(path, "utf8")) as { Localization?: unknown };
    if (!json.Localization || typeof json.Localization !== "object" || Array.isArray(json.Localization)) return null;
    const table = { ...(json.Localization as Record<string, unknown>) };
    delete table.pi;
    return table;
  } catch {
    return null;
  }
}

/** Sets the plugin's language from Stream Deck's; English when the file is missing or broken. */
export function useStreamDeckLanguage(raw: unknown, dir = process.cwd()): string {
  const language = normalizeLanguage(raw);
  setLanguage(language, language === "en" ? null : readLanguageTable(language, dir));
  return language;
}
