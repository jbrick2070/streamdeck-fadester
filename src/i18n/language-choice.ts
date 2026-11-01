// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plugin's own Language setting (PLAN.md 11.1, R-LANG-1..4): Automatic
 * (Stream Deck's language, as before) or a fixed one of `PLUGIN_LANGUAGES`,
 * kept as `language` in the plugin's global settings. A change picks the
 * table, and `setLanguage` tells every visible control to redraw; the
 * settings pages refill from the broadcast that follows.
 */
import { normalizeLanguage, readLanguageTable } from "./load.js";
import { PLUGIN_LANGUAGES, PluginLanguage, currentLanguage, setLanguage } from "./strings.js";
import type { GlobalSettingsStore } from "../settings/global-store.js";

export type LanguageChoice = "auto" | PluginLanguage;

/** What both page broadcasts carry: the setting and the language the deck draws in. */
export interface LanguageState {
  choice: LanguageChoice;
  resolved: string;
}

/** A stored value as a choice: "auto", one of `PLUGIN_LANGUAGES` exactly, else Automatic and `unknown`. */
export function normalizeChoice(stored: unknown): { choice: LanguageChoice; unknown: boolean } {
  if (stored === undefined || stored === "auto") return { choice: "auto", unknown: false };
  const fixed = PLUGIN_LANGUAGES.find((language) => language === stored);
  return fixed ? { choice: fixed, unknown: false } : { choice: "auto", unknown: true };
}

/** The language the deck draws in: Stream Deck's under Automatic (the rule of `normalizeLanguage`), else the choice. */
export function resolveLanguage(choice: LanguageChoice, appLanguage: unknown): string {
  return choice === "auto" ? normalizeLanguage(appLanguage) : choice;
}

export interface LanguageChoiceOptions {
  store: GlobalSettingsStore;
  /** Stream Deck's language (`streamDeck.info.application.language`). */
  appLanguage: unknown;
  /** The folder with the `<lang>.json` files (the plugin's working folder). */
  dir?: string;
  /** Sends both page broadcasts again. */
  broadcast(): void;
  log?(message: string): void;
}

export interface SetLanguageChoiceMessage {
  [key: string]: unknown;
  event?: string;
  choice?: unknown;
}

export class LanguageChoiceController {
  private choice: LanguageChoice = "auto";
  private loggedUnknown = false;

  public constructor(private readonly options: LanguageChoiceOptions) {}

  /** Applies the stored choice once the start-up read is done. */
  public async start(): Promise<void> {
    await this.options.store.ready;
    this.applyStored(this.options.store.snapshot().language);
  }

  /** Settings that arrived from Stream Deck: the stored choice may have changed. */
  public settingsReceived(): void {
    this.applyStored(this.options.store.snapshot().language);
  }

  public state(): LanguageState {
    return { choice: this.choice, resolved: currentLanguage() };
  }

  /** Handles `{ event: "setLanguageChoice", choice }`; returns false for any other message. */
  public async handleMessage(payload: SetLanguageChoiceMessage | undefined): Promise<boolean> {
    if (payload?.event !== "setLanguageChoice") return false;
    const raw = payload.choice;
    const { choice, unknown } = normalizeChoice(raw);
    // A page sends only what it offers; anything else changes nothing (the page is told what holds).
    if (unknown || raw === undefined) {
      this.options.broadcast();
      return true;
    }
    try {
      await this.options.store.patch({ language: choice });
    } catch {
      this.options.log?.("language choice not saved");
    }
    this.apply(choice);
    this.options.broadcast();
    return true;
  }

  private applyStored(stored: unknown): void {
    const { choice, unknown } = normalizeChoice(stored);
    if (unknown && !this.loggedUnknown) {
      // The value itself is not logged; it stays stored until the next pick (D-L6).
      this.loggedUnknown = true;
      this.options.log?.("unknown language choice");
    }
    this.apply(choice);
  }

  private apply(choice: LanguageChoice): void {
    this.choice = choice;
    const resolved = resolveLanguage(choice, this.options.appLanguage);
    // The same language again reads nothing and redraws nothing.
    if (resolved === currentLanguage()) return;
    setLanguage(resolved, resolved === "en" ? null : readLanguageTable(resolved, this.options.dir));
  }
}
