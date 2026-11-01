// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Words the shared package draws or reports, by key. The plugin passes its
 * own translator in (R-I18N-1); without one the English table is used, so the
 * package never imports the plugin's `src/`.
 */

export type TextParams = Readonly<Record<string, string | number>>;

/** Returns the text for a key with its `{name}` placeholders filled. */
export type Translate = (key: string, params?: TextParams) => string;

/**
 * A text a user reads: our own message as a key with parameters, or a text
 * that belongs to OBS or Midi Fadester, shown exactly as it came (R-I18N-2).
 */
export type LocalText =
  | { readonly key: string; readonly params?: TextParams }
  | { readonly verbatim: string };

export const SHARED_EN = {
  statusUnreachable: "OBS is not running or the websocket is off (Tools > WebSocket Server Settings)",
  statusUnreachableShort: "OBS is not running or websocket is off",
  statusWrongPassword: "Wrong password. Check OBS Tools > WebSocket Server Settings > Show Connect Info.",
  statusWrongPasswordShort: "Wrong password",
  statusMissingPlugin: "{plugin} is not installed in OBS",
  statusVersionMismatch: "{plugin} API version {apiVersion} is newer than supported version {supported}. Update {surface}.",
  statusVersionMismatchShort: "Update {surface}",
  statusConnectedDirect: "Connected: OBS {obsVersion}",
  statusConnectedVendor: "Connected: OBS {obsVersion}, {plugin} {version}",
  statusConnectedVendorBuild: "Connected: OBS {obsVersion}, {plugin} {version} ({commit})",
  errorEmptyScreenshot: "Empty screenshot returned for source '{source}'.",
  errorDisconnected: "Disconnected from OBS.",
  errorRequestFailed: "OBS request failed (code {code}).",
  errorRequestTimeout: "Request '{request}' timed out after {ms} ms. Check OBS responsiveness.",
  errorConnectionReset: "Connection reset.",
  percent: "{n}%",
  cellFadesterTitle: "Fadester",
  cellFaderTitle: "Fader",
  cellAutoFadeTitle: "Auto-fade",
  cellUnavailable: "Unavailable",
  cellUnavailableInObs: "Unavailable in OBS",
  cellUnassigned: "Unassigned, set in OBS",
  cellSlotNotFound: "Slot '{slot}' not found",
  cellSlotMissing: "Slot missing",
  cellHoldFade: "HOLD 3s FADE",
  cellPreview: "Preview",
  cellProgram: "Program",
  cleanFxTitle: "Clean FX",
  cleanFxNeedsUpdate: "Update Midi Fadester to 0.4.0",
  cleanFxActiveTitle: "CLEAN FX",
  cleanFxIdleTitle: "FX CLEAN",
  cleanFxActiveCount: "{n} ACTIVE",
  cleanFxAllZero: "ALL 0%"
} as const;

export type SharedStringKey = keyof typeof SHARED_EN;

/** Fills `{name}` placeholders; a placeholder without a value stays as written. */
export function fillTemplate(template: string, params?: TextParams): string {
  if (!params) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole);
}

/** The placeholder names of a template, sorted, for comparing translations. */
export function templatePlaceholders(template: string): string[] {
  return [...new Set(Array.from(template.matchAll(/\{([A-Za-z0-9_]+)\}/g), (m) => m[1]))].sort();
}

const englishTable: Record<string, string> = { ...SHARED_EN };

/** The plugin adds its own English words, so an error's English `message` reads in full. */
export function addEnglishStrings(table: Readonly<Record<string, string>>): void {
  Object.assign(englishTable, table);
}

export const englishShared: Translate = (key, params) =>
  fillTemplate(Object.hasOwn(englishTable, key) ? englishTable[key] : key, params);

export function ownText(key: string, params?: TextParams): LocalText {
  return params ? { key, params } : { key };
}

export function verbatimText(text: string): LocalText {
  return { verbatim: text };
}

/** Words a text: our own by key, a foreign text exactly as it came. */
export function wordText(text: LocalText | null | undefined, t: Translate = englishShared): string {
  if (!text) return "";
  return "verbatim" in text ? text.verbatim : t(text.key, text.params);
}

/** An error whose text knows its origin; `message` keeps the English wording for logs. */
export class LocalizedError extends Error {
  public readonly text: LocalText;

  public constructor(text: string | LocalText) {
    const local = typeof text === "string" ? verbatimText(text) : text;
    super(wordText(local, englishShared));
    this.name = "LocalizedError";
    this.text = local;
  }
}

/** The text of a thrown value: a localized error by its origin, anything else verbatim. */
export function errorLocalText(error: unknown, fallback: LocalText): LocalText {
  if (error instanceof LocalizedError) return error.text;
  if (error instanceof Error && error.message) return verbatimText(error.message);
  return fallback;
}

export function errorText(error: unknown, fallback: LocalText, t: Translate = englishShared): string {
  return wordText(errorLocalText(error, fallback), t);
}
