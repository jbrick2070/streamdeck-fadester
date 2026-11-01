// SPDX-License-Identifier: GPL-2.0-or-later
// VJster deck words: every word VJster draws on a key or a dial, by key
// (docs/vjster/REQUIREMENTS.md R-I18N-1, R-I18N-2; PLAN.md section 8). The
// English table is built in; standalone.ts fills a table for Stream Deck's
// language from the `Localization` object of the plugin's `<lang>.json`
// files, and any key that is missing or empty there keeps its English text.
// Logic never compares these words: it compares codes, and only the drawing
// looks a word up.

/** Every deck word, by key. Keys have no dots: Stream Deck's lookup splits on them. */
export const EN = {
  statusPortInUse: "PORT IN USE",
  statusExtensionOff: "EXTENSION OFF",
  statusPageOff: "NO PAGE",
  statusNoVideo: "NO VIDEO",
  statusNotAvailable: "N/A",
  statusAd: "AD PLAYING",
  tagWeb: "WEB",
  tagObs: "OBS",
  tagAd: "AD",
  tagExt: "EXT",
  tagAuto: "AUTO",
  tagFixed: "FIXED",
  auto: "AUTO",
  speed: "SPEED",
  fxSpeed: "FX SPEED",
  quality: "QUALITY",
  nudge: "NUDGE",
  sync: "SYNC",
  pinned: "PINNED",
  pinTab: "PIN TAB",
  playing: "PLAYING",
  paused: "PAUSED",
  captionObs: "OBS {word}",
  captionSync: "SYNC {word}"
} as const;

export type DeckKey = keyof typeof EN;
export type Strings = Readonly<Record<DeckKey, string>>;

export const DECK_KEYS = Object.keys(EN) as DeckKey[];

/**
 * A table from a lookup; the English text stands in wherever the lookup has
 * nothing, an empty text, or echoes the key back (Stream Deck's translate does
 * that for a missing key), or drops a placeholder the English text has.
 */
export function stringsFrom(lookup: (key: DeckKey) => unknown): Strings {
  const out = {} as Record<DeckKey, string>;
  for (const key of DECK_KEYS) {
    const value = lookup(key);
    const ok = typeof value === "string" && value.trim() !== "" && value !== key && placeholders(value).join() === placeholders(EN[key]).join();
    out[key] = ok ? (value as string) : EN[key];
  }
  return out;
}

/** The `{name}` placeholders in a text, sorted. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]).sort();
}

/** Fill `{name}` placeholders; values are inserted as given, never re-read as placeholders. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z]+)\}/g, (all, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : all));
}

/**
 * The labels the bundled profiles store (build-profiles.ts), which are data
 * and stay English there; the deck shows them in its language (R-I18N-2).
 * CHROME, OBS and CHROME FX are kept as they are (R-I18N-3).
 */
const PROFILE_LABELS: Readonly<Record<string, DeckKey>> = {
  SPEED: "speed",
  "FX SPEED": "fxSpeed",
  QUALITY: "quality",
  NUDGE: "nudge",
  SYNC: "sync"
};

/**
 * A stored strip label as the deck shows it: a bundled default translated,
 * anything else as typed. A label typed as exactly one of those defaults is
 * translated too, which is the same word.
 */
export function shownLabel(label: string, strings: Strings): string {
  const key = Object.prototype.hasOwnProperty.call(PROFILE_LABELS, label) ? PROFILE_LABELS[label] : undefined;
  return key === undefined ? label : strings[key];
}
