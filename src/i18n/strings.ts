// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Every word Fadester for OBS draws on a key, dial or the Neo Info Bar, and its
 * status and error sentences, by key (R-I18N-1, R-I18N-2). English is built in;
 * the language files at the plugin root (`<lang>.json`, `Localization`) hold the
 * other languages. Keys have no dots; values are templates with `{name}`
 * placeholders, filled by `t()` and never by concatenation.
 */
import {
  SHARED_EN,
  TextParams,
  addEnglishStrings,
  fillTemplate,
  templatePlaceholders
} from "../../packages/streamdeck-fadester-shared/src/i18n.js";

const PLUGIN_EN = {
  // Direct OBS client errors
  errorNoVolume: "OBS did not return a volume for '{input}'.",
  errorRoleUnavailable: "{role} is unavailable. Choose an OBS mixer input in the inspector.",
  errorChooseInput: "Choose an existing OBS mixer input first.",
  errorConnectBeforeStudio: "Connect to OBS before preparing a Studio layout.",
  errorStudioNotEnabled: "OBS Studio Mode could not be enabled.",
  errorTbarNeedsStudio: "Scene T-bar needs OBS Studio Mode.",
  errorSceneIndexUnavailableOne: "Scene {n} is unavailable; OBS has {count} scene.",
  errorSceneIndexUnavailableMany: "Scene {n} is unavailable; OBS has {count} scenes.",
  errorChooseScene: "Choose an existing OBS scene first.",
  errorPreviewNeedsStudio: "Preview selection needs OBS Studio Mode.",
  errorNoCutTransition: "OBS did not provide its Cut transition. Refresh the OBS lists.",
  errorCurrentPreviewNeedsStudio: "Current Preview needs OBS Studio Mode. Choose a fixed scene, Next scene, or Previous scene in regular mode.",
  errorControlChanged: "OBS connection or scene collection changed. Try the control again.",
  // Playlister transport errors (the first is also the unbound key's word)
  errorMediaChoose: "Choose a Playlister",
  errorMediaMissing: "The chosen Playlister is not in OBS now.",
  errorMediaWrongKind: "'{input}' is not a Playlister source.",
  errorMediaUnsupported: "OBS WebSocket has no media control here. Update OBS.",
  errorMediaBusy: "Playlister is busy; wait for the queued presses.",
  errorMediaPending: "Play or pause is still pending.",
  errorMediaChanging: "Playlister is opening media; try again.",
  errorMediaAmbiguous: "Playlister state is unclear; press Stop first.",
  // OBS Filter controls (PLAN.md 10)
  errorFilterChoose: "Choose a source and a filter first.",
  // Playlister transport key (operation words are the titles; the state words the subtitle)
  plOpPrevious: "Previous",
  plOpNext: "Next",
  plOpPlayPause: "Play / pause",
  plOpStop: "Stop",
  plOpRestart: "Restart",
  plOpStatus: "Status",
  plMissing: "Playlister missing",
  plWrongKind: "Not a Playlister",
  plUnsupported: "Update OBS",
  mediaStateNone: "Empty",
  mediaStatePlaying: "Playing",
  mediaStateOpening: "Opening",
  mediaStateBuffering: "Buffering",
  mediaStatePaused: "Paused",
  mediaStateStopped: "Stopped",
  mediaStateEnded: "Ended",
  mediaStateError: "Error",
  mediaStateUnknown: "Unknown",
  mediaTime: "{state} {cursor}/{duration}",
  mediaPendingPlay: "Play sent",
  mediaPendingPause: "Pause sent",
  mediaUnconfirmed: "Sent, unconfirmed",
  mediaBusy: "Busy",
  // Source & Layer controller errors
  layerErrorConnectAndChoose: "Connect OBS and choose a source.",
  layerErrorCollectionChanging: "OBS scene collection is changing. Try again.",
  layerErrorConnectionChanged: "OBS connection changed. Choose the source again.",
  layerErrorChanged: "OBS connection or scene collection changed. Try again.",
  layerErrorSourceGone: "The selected source is no longer in this scene.",
  layerErrorSourceGoneChoose: "The selected source is no longer in this scene. Choose it again.",
  layerErrorNotConnected: "OBS is not connected.",
  layerErrorChooseScene: "Choose an OBS scene first.",
  layerErrorFixedNeedsScene: "A fixed source must be bound to a specific scene. Choose the scene again.",
  layerErrorEnableReorder: "Enable layer reordering for this creative control first.",
  layerErrorNoSources: "This scene has no sources to control.",
  layerErrorLoad: "Could not load OBS sources.",
  // OBS blend modes (OBS's own terms)
  blendNormal: "Normal",
  blendAdditive: "Additive",
  blendSubtract: "Subtract",
  blendScreen: "Screen",
  blendMultiply: "Multiply",
  blendLighten: "Lighten",
  blendDarken: "Darken",
  sourceFallback: "Source",
  // Automatic targets
  sceneAutomatic: "Scene {n} (automatic)",
  audioMain: "Main audio",
  audioMainAutomatic: "Main audio (automatic)",
  audioMic: "Microphone",
  audioMicAutomatic: "Microphone (automatic)",
  audioAux: "Aux audio",
  audioAuxAutomatic: "Aux audio (automatic)",
  audioInput: "Audio input {n}",
  audioInputAutomatic: "Audio input {n} (automatic)",
  // Scene & Transition key
  sceneTargetTakePreview: "Take Preview",
  sceneTargetNext: "Next scene",
  sceneTargetPrevious: "Previous scene",
  sceneTargetRandom: "Random scene",
  sceneControlFailed: "OBS scene control failed.",
  sceneEnableStudio: "Enable Studio Mode",
  sceneUnavailable: "Scene unavailable",
  sceneTitleFallback: "Scene",
  sceneOpPreview: "Preview",
  sceneOpCut: "Cut",
  sceneOpTransition: "Transition",
  sceneRoleIndex: "Scene {n}",
  sceneRoleNext: "Next",
  sceneRolePrevious: "Previous",
  sceneRoleRandom: "Random",
  sceneRoleTake: "Take",
  sceneSubtitle: "{role} · {operation}",
  // OBS Fade key
  fadeTitle: "OBS Fade",
  fadeUpNow: "Up now",
  fadeDownNow: "Down now",
  fadeUpSeconds: "Up {s}s",
  fadeDownSeconds: "Down {s}s",
  roleUnavailable: "{role} unavailable",
  audioInputUnavailable: "Audio input unavailable",
  // OBS Fader dial
  faderDefault: "OBS fader",
  pressNextBlend: "Press: next blend",
  pressPreviousBlend: "Press: previous blend",
  pressNormalBlend: "Press: Normal blend",
  pressShowHide: "Press: show / hide",
  pressBlendTake: "Press: blend + take Next live",
  pressDisabled: "Press disabled",
  // Direct renderer
  dialChooseControl: "Choose OBS control",
  dialOpenInspector: "Open its inspector",
  obsNotConnected: "OBS not connected",
  studioModeOff: "Studio Mode is off",
  mixerLiveScene: "Live scene",
  mixerChoosePreview: "Choose Preview",
  mixerTurnOnStudio: "Turn on OBS Studio Mode",
  mixerChooseDifferent: "Choose a different Next scene",
  mixerAutoQueue: "Turn to fade · auto-queues Next",
  mixerPressTake: "Press to take Next live",
  mixerLive: "LIVE",
  mixerNext: "NEXT",
  keyDefaultTitle: "OBS",
  keyChooseAction: "Choose OBS action",
  keyOpenInspector: "Open inspector",
  keyReady: "Ready",
  // Source & Layer key and dial
  layerOpNextSource: "Next source",
  layerOpPreviousSource: "Previous source",
  layerOpUp: "Layer up",
  layerOpDown: "Layer down",
  layerOpShowHide: "Show / hide",
  layerOpNextBlend: "Next blend",
  layerOpPreviousBlend: "Previous blend",
  layerOpNormalBlend: "Normal blend",
  layerControlFailed: "OBS control failed.",
  layerConnectObs: "Connect OBS",
  layerChooseScene: "Choose a scene",
  layerLoading: "Loading sources…",
  layerFixedUnavailable: "Fixed source unavailable",
  layerChooseSource: "Choose a source",
  layerNoSources: "No sources in scene",
  layerShown: "Shown",
  layerHidden: "Hidden",
  layerKeySubtitle: "{state} · {source}",
  layerBlendMode: "Blend: {mode}",
  layerTurnReorder: "Turn: reorder layers",
  layerReorderDisabled: "Reorder is disabled",
  layerPosition: "{i} / {n} · {state}",
  layerRoleLive: "LIVE",
  layerRolePreview: "PREVIEW",
  layerRoleScene: "SCENE",
  layerHeader: "{role}: {scene}",
  layerHeaderNone: "OBS SOURCES",
  layerFooterConnect: "Connect OBS to control",
  layerFooterChooseScene: "Choose scene in inspector",
  layerFooterWaiting: "Waiting for OBS sources",
  layerFooterAddSources: "Add sources in OBS",
  layerFooterBrowse: "Turn to browse sources",
  layerFooterChooseSource: "Choose source in inspector",
  layerFooterSelectOnDeck: "Select a source on the deck",
  // OBS Scene Info Bar (Stream Deck Neo)
  infobarDisconnected: "OBS disconnected",
  infobarConnected: "OBS connected",
  infobarLive: "LIVE  {scene}",
  infobarPreview: "PREVIEW  {scene}",
  infobarNoScene: "—",
  infobarUnavailable: "Unavailable",
  infobarStudioOff: "Studio Mode off",
  // Midi Fadester dial hold labels
  holdCleanFx: "HOLD CLEAN FX",
  holdFinish: "HOLD FINISH",
  // Texts the plugin sends to the property inspectors
  setupErrorStudio: "Use Enable Studio Mode & open layout to prepare this desk.",
  setupErrorFallback: "Could not prepare this OBS layout.",
  piChooseSlot: "Choose a slot first.",
  piEnabledNotApplied: "Midi Fadester did not apply the enabled state. Update Midi Fadester to a build that supports slot enable controls.",
  tierVerified: "Verified on hardware",
  tierBeta: "Beta, untested on hardware",
  tierCustom: "Custom",
  profileGeneric: "Generic MIDI (Custom)",
  modeUnassigned: "Not used",
  modeTbar: "Switch scenes (T-bar)",
  modeCrossfade: "Mix two layers",
  modeLayerOpacity: "Show or hide a layer",
  modeAudioVolume: "Volume",
  modeFilterParam: "Filter setting (FX)",
  curveDipFree: "Dip-free (picture never darkens)",
  curveFullCenter: "Full center",
  curveEqualPower: "Equal power",
  curveLinear: "Linear",
  curveCut: "Cut",
  layoutModeEither: "[Either Mode] {name}",
  layoutModeStudio: "[Studio Mode] {name}",
  layoutModeRegular: "[Regular Mode] {name}"
} as const;

/** The English table: the shared package's words and the plugin's. */
export const EN = { ...SHARED_EN, ...PLUGIN_EN } as const;

addEnglishStrings(PLUGIN_EN);

export type StringKey = keyof typeof EN;

/** Stream Deck's languages (`supportedLanguages`, @elgato/streamdeck 3.0.3). */
export const STREAM_DECK_LANGUAGES = ["en", "de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW"] as const;

export type LanguageTable = Readonly<Record<string, unknown>>;

let activeLanguage = "en";
let activeTable: LanguageTable = {};

/**
 * The text for a key in a table, or English: when the table has nothing, an
 * empty text, the key itself, or a text whose placeholders differ from
 * English's (a broken translation never reaches the deck).
 */
export function lookupText(table: LanguageTable, key: StringKey): string {
  const english: string = EN[key];
  const candidate = table[key];
  if (typeof candidate !== "string" || candidate.trim() === "" || candidate === key) return english;
  const expected = templatePlaceholders(english).join(",");
  return templatePlaceholders(candidate).join(",") === expected ? candidate : english;
}

/** The active language's text for `key`, placeholders filled. */
export function t(key: StringKey, params?: TextParams): string {
  return fillTemplate(lookupText(activeTable, key), params);
}

/** The same translator, typed for the shared package (any key string). */
export function translate(key: string, params?: TextParams): string {
  return Object.hasOwn(EN, key) ? t(key as StringKey, params) : fillTemplate(key, params);
}

/** One/many pair: `<base>One` for 1, `<base>Many` otherwise (R-I18N-3). */
export function tCount(base: "errorSceneIndexUnavailable", count: number, params?: TextParams): string {
  return t(count === 1 ? `${base}One` : `${base}Many`, { ...params, count });
}

/**
 * Sets the language. `table` is that language's `Localization` object (or
 * null); a missing or invalid table leaves English in place.
 */
export function setLanguage(language: string, table?: LanguageTable | null): void {
  activeLanguage = language || "en";
  activeTable = table && typeof table === "object" ? table : {};
}

export function currentLanguage(): string {
  return activeLanguage;
}

/** BCP 47 tag for Intl (Stream Deck writes zh_CN). */
export function localeTag(language = activeLanguage): string {
  return language.replace("_", "-");
}

/** A display number in the active language ("1.5" in English, "1,5" in German). */
export function formatNumber(value: number, maximumFractionDigits = 2): string {
  try {
    return new Intl.NumberFormat(localeTag(), { maximumFractionDigits, useGrouping: false }).format(value);
  } catch {
    return String(value);
  }
}
