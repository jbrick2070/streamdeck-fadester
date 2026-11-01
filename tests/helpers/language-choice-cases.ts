// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Language setting's cases both plugins' resolvers must give alike (PLAN.md
 * 11.1, D-L2): a fixed choice is taken exactly as written, anything else acts as
 * Automatic. What Automatic makes of Stream Deck's language stays each plugin's
 * own rule, so every case here uses an app language both rules read the same.
 */
export interface LanguageChoiceCase {
  stored: unknown;
  app: string;
  resolved: string;
  /** The choice a page shows. */
  choice: string;
  /** Logged once as an unknown choice (and kept as stored). */
  unknown: boolean;
}

export const LANGUAGE_CHOICE_CASES: readonly LanguageChoiceCase[] = [
  // No choice stored, or Automatic: Stream Deck's language.
  { stored: undefined, app: "en", resolved: "en", choice: "auto", unknown: false },
  { stored: undefined, app: "de", resolved: "de", choice: "auto", unknown: false },
  { stored: "auto", app: "ja", resolved: "ja", choice: "auto", unknown: false },
  { stored: "auto", app: "zh_TW", resolved: "zh_TW", choice: "auto", unknown: false },
  // A fixed language wins over Stream Deck's, Dutch included.
  { stored: "nl", app: "en", resolved: "nl", choice: "nl", unknown: false },
  { stored: "nl", app: "de", resolved: "nl", choice: "nl", unknown: false },
  { stored: "de", app: "ja", resolved: "de", choice: "de", unknown: false },
  { stored: "en", app: "fr", resolved: "en", choice: "en", unknown: false },
  { stored: "zh_CN", app: "en", resolved: "zh_CN", choice: "zh_CN", unknown: false },
  { stored: "zh_TW", app: "ko", resolved: "zh_TW", choice: "zh_TW", unknown: false },
  // Anything else acts as Automatic: not in the list, another spelling, not a string.
  { stored: "pt_BR", app: "de", resolved: "de", choice: "auto", unknown: true },
  { stored: "NL", app: "en", resolved: "en", choice: "auto", unknown: true },
  { stored: "nl-NL", app: "fr", resolved: "fr", choice: "auto", unknown: true },
  { stored: "nl_NL", app: "es", resolved: "es", choice: "auto", unknown: true },
  { stored: "zh-CN", app: "en", resolved: "en", choice: "auto", unknown: true },
  { stored: " de", app: "ko", resolved: "ko", choice: "auto", unknown: true },
  { stored: "", app: "ja", resolved: "ja", choice: "auto", unknown: true },
  { stored: 42, app: "fr", resolved: "fr", choice: "auto", unknown: true },
  { stored: null, app: "de", resolved: "de", choice: "auto", unknown: true },
  { stored: true, app: "en", resolved: "en", choice: "auto", unknown: true }
];
