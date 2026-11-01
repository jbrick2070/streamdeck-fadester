// SPDX-License-Identifier: GPL-2.0-or-later
// VJster's own Language setting and deck-word loader (docs/vjster/PLAN.md 9,
// R-LANG-1..5). The SDK's translator is bound once to Stream Deck's language,
// so VJster reads its `<lang>.json` files itself: Automatic keeps today's rule
// (the app's language by exact code, its base, then English), a fixed choice
// is one of the nine plugin languages exactly as written. VJster cannot import
// src/i18n/ (its bundle is built from src/vjster only), so the choice rule is a
// copy of Fadester's; tests/helpers/language-choice-cases.ts runs both.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stringsFrom, type DeckKey, type Strings } from "./strings.js";

/** Stream Deck's eight languages and Dutch, as a fixed choice is stored. */
export const PLUGIN_LANGUAGES = ["en", "de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW", "nl"] as const;
export type PluginLanguage = (typeof PLUGIN_LANGUAGES)[number];
export type LanguageChoice = "auto" | PluginLanguage;

/** A stored value as a choice: absent or "auto" is Automatic; one of the nine exactly; anything else Automatic and `unknown`. */
export function normalizeChoice(stored: unknown): { choice: LanguageChoice; unknown: boolean } {
  if (stored === undefined || stored === "auto") return { choice: "auto", unknown: false };
  const fixed = PLUGIN_LANGUAGES.find((language) => language === stored);
  return fixed ? { choice: fixed, unknown: false } : { choice: "auto", unknown: true };
}

/** A language code that may name a file: letters, digits, `_` and `-` only (never a path). */
const CODE = /^[A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})*$/;

/**
 * The `Localization` object of `<dir>/<lang>.json`, or null when there is no
 * such file or it cannot be read; the SDK's reader takes the same object.
 */
export function readLocalization(lang: string, dir: string): Record<string, unknown> | null {
  if (!CODE.test(lang)) return null;
  const path = join(dir, `${lang}.json`);
  if (!existsSync(path)) return null;
  try {
    const json: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
    const loc = typeof json === "object" && json !== null ? (json as Record<string, unknown>).Localization : undefined;
    return typeof loc === "object" && loc !== null && !Array.isArray(loc) ? (loc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The base of a language code: `de` for `de_AT` or `de-AT`. */
const base = (lang: string): string => lang.replace(/_/g, "-").split("-")[0];

/**
 * Automatic, as VJster has always done it (R-LANG-2): the app's language when
 * it has a file, else its base language when that has one, else English. So
 * `zh-CN` (no `zh-CN.json`, no `zh.json`) stays English.
 */
export function appMapping(appLanguage: unknown, has: (lang: string) => boolean): string {
  const app = typeof appLanguage === "string" ? appLanguage : "";
  if (app !== "" && has(app)) return app;
  if (app !== "" && has(base(app))) return base(app);
  return "en";
}

/** The language VJster draws in: Automatic's mapping of the app's language, else the choice. */
export function resolveLanguage(choice: LanguageChoice, appLanguage: unknown, has: (lang: string) => boolean): string {
  return choice === "auto" ? appMapping(appLanguage, has) : choice;
}

/**
 * The deck words for a language: each key from that language's file, its base
 * language's, then English's, as the SDK's translator looked them up; any text
 * that is missing, blank, echoes its key or has other placeholders is the
 * built-in English (strings.ts).
 */
export function deckStrings(lang: string, read: (lang: string) => Record<string, unknown> | null): Strings {
  const tables = [...new Set([lang, base(lang), "en"])].map((l) => read(l)).filter((t): t is Record<string, unknown> => t !== null);
  return stringsFrom((key: DeckKey) => {
    for (const table of tables) if (typeof table[key] === "string" && table[key] !== "") return table[key];
    return undefined;
  });
}

export interface DeckLanguageOptions {
  /** Stream Deck's language (`streamDeck.info.application.language`). */
  appLanguage: unknown;
  /** The folder with the `<lang>.json` files. */
  dir: string;
  /** Reads a language's `Localization`; tests may stand in. */
  read?: (lang: string) => Record<string, unknown> | null;
  log?: (message: string) => void;
}

/**
 * The deck words in force: one stable `strings` object, handed by reference to
 * every action and controller, whose fields are replaced in place when the
 * language changes; listeners then redraw (R-LANG-4).
 */
export class DeckLanguage {
  readonly strings: Strings;
  private current: LanguageChoice = "auto";
  private lang: string;
  private loggedUnknown = false;
  private readonly listeners = new Set<() => void>();
  private readonly read: (lang: string) => Record<string, unknown> | null;
  private readonly cache = new Map<string, Record<string, unknown> | null>();

  constructor(private readonly options: DeckLanguageOptions) {
    const read = options.read ?? ((lang: string) => readLocalization(lang, options.dir));
    this.read = (lang) => {
      if (!this.cache.has(lang)) this.cache.set(lang, read(lang));
      return this.cache.get(lang) ?? null;
    };
    this.lang = resolveLanguage("auto", options.appLanguage, (l) => this.read(l) !== null);
    this.strings = { ...deckStrings(this.lang, this.read) };
  }

  get choice(): LanguageChoice {
    return this.current;
  }

  /** The language the deck draws in. */
  get resolved(): string {
    return this.lang;
  }

  /**
   * Applies a stored `language` value; true when the deck's language changed
   * (the listeners have then been told). An unknown value acts as Automatic
   * and is logged once, without the value (R-LANG-5).
   */
  apply(stored: unknown): boolean {
    const { choice, unknown } = normalizeChoice(stored);
    if (unknown && !this.loggedUnknown) {
      this.loggedUnknown = true;
      this.options.log?.("unknown language choice stored; using Automatic");
    }
    this.current = choice;
    const lang = resolveLanguage(choice, this.options.appLanguage, (l) => this.read(l) !== null);
    if (lang === this.lang) return false;
    this.lang = lang;
    Object.assign(this.strings as Record<DeckKey, string>, deckStrings(lang, this.read));
    for (const listener of [...this.listeners]) listener();
    return true;
  }

  /** Called after every change of the deck's language; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
