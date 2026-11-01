// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page: the setup notes in the operator's language (docs/vjster/
// REQUIREMENTS.md R-I18N-1, R-I18N-3; PLAN.md 8.6). The page shows text only
// when its address is incomplete or YouTube's player does not load, and it
// shows it in the OBS output, so the notes are short.
//
// The language comes from the `hl=` parameter the plugin puts in the address
// (Stream Deck's language), else from the browser (OBS's language), else
// English. A text missing in a language is shown in English.
//
// The English texts were written with Claude Opus 5.5, an AI model; the other
// languages were drafted by Claude Opus 5.5 and are to be reviewed by a second
// AI model (PLAN.md 8.7). Corrections: docs/vjster/INSTALL.md.

export const NOTE_KEYS = ["noToken", "noVideo", "playerMissing", "retry"] as const;
export type NoteKey = (typeof NOTE_KEYS)[number];
export type Notes = Readonly<Record<NoteKey, string>>;

/** The notes by language; `{s}` is a number of seconds. */
export const NOTES: Readonly<Record<string, Partial<Notes>>> = {
  en: {
    noToken: "VJster: this address has no token. Copy the OBS page address from the VJster settings in Stream Deck.",
    noVideo: "VJster: add ?v= and a YouTube video id to this address.",
    playerMissing: "VJster: YouTube's player did not load.",
    retry: "VJster: YouTube's player could not be loaded; trying again in {s} s."
  },
  de: {
    noToken: "VJster: Diese Adresse hat keinen Schlüssel. Die Adresse der OBS-Seite aus den VJster-Einstellungen in Stream Deck kopieren.",
    noVideo: "VJster: ?v= und eine YouTube-Video-ID an diese Adresse anhängen.",
    playerMissing: "VJster: Der YouTube-Player wurde nicht geladen.",
    retry: "VJster: Der YouTube-Player konnte nicht geladen werden; neuer Versuch in {s} s."
  }
};

/** Other names for a language the table has: Chinese without a region is simplified, Hong Kong and Macau traditional. */
const ALIASES: Readonly<Record<string, string>> = { zh: "zh_CN", zh_HK: "zh_TW", zh_MO: "zh_TW", zh_SG: "zh_CN", pt: "pt_BR" };

const has = (lang: string): boolean => Object.prototype.hasOwnProperty.call(NOTES, lang);

/**
 * The table's language for a language tag such as `de`, `de-AT`, `pt-BR`,
 * `zh_CN` or `zh-Hant-TW`: for Chinese the script first (Hans simplified,
 * Hant traditional), then the exact language and region, an alias, the
 * language alone, else English.
 */
export function pageLanguage(tag: string | null | undefined): string {
  if (typeof tag !== "string") return "en";
  const parts = tag.trim().split(/[-_]/).filter((p) => p !== "");
  const base = (parts[0] ?? "").toLowerCase();
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p))?.toUpperCase();
  const script = parts.slice(1).find((p) => /^[A-Za-z]{4}$/.test(p))?.toLowerCase();
  const alias = (name: string): string => (Object.prototype.hasOwnProperty.call(ALIASES, name) ? ALIASES[name] : "");
  const tries = [
    base === "zh" && script === "hant" ? "zh_TW" : "",
    base === "zh" && script === "hans" ? "zh_CN" : "",
    region ? `${base}_${region}` : "",
    region ? alias(`${base}_${region}`) : "",
    alias(base),
    base
  ];
  return tries.find((t) => t !== "" && has(t)) ?? "en";
}

/** A note in `lang` with its placeholders filled; English where `lang` has none. */
export function note(lang: string, key: NoteKey, values: Readonly<Record<string, string>> = {}): string {
  const own = has(lang) ? NOTES[lang][key] : undefined;
  const text = own !== undefined && own !== "" ? own : (NOTES.en[key] as string);
  return text.replace(/\{([a-z]+)\}/g, (all, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : all));
}
