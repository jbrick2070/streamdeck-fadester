// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Every word drawn on a key, dial or the Neo Info Bar fits its box in every
 * language present (R-I18N-4), by the width estimate in text-fit.ts. A word
 * fits when it needs no more squeeze than MIN_SQUEEZE (no "…"). Status and
 * error sentences that do not fit a small box even in English are shortened
 * there by design; for them the rule is that a translation fits wherever the
 * English fits.
 */
import { afterEach, describe, expect, it } from "vitest";
import { EN, StringKey, setLanguage, t } from "../src/i18n/strings.js";
import { TextParams } from "../packages/streamdeck-fadester-shared/src/i18n.js";
import { fitText, fitsBox, fontFamilyFor, splitTitle, textWidth } from "../packages/streamdeck-fadester-shared/src/text-fit.js";
import { compactKeyTitle } from "../packages/streamdeck-fadester-shared/src/svg-renderer.js";
import { keyTitleLines } from "../src/gfx/direct-obs-renderer.js";
import { deckTable, presentLanguages } from "./helpers/languages.js";

type Box =
  | { kind: "line"; name: string; size: number; width: number }
  | { kind: "keyTitle"; name: string }
  | { kind: "compactTitle"; name: string }
  | { kind: "twoLines"; name: string; size: number; width: number }
  | { kind: "native"; name: string; size: number; width: number };

const line = (name: string, size: number, width: number): Box => ({ kind: "line", name, size, width });
const B = {
  keyTitle: { kind: "keyTitle", name: "direct key title" } as Box,
  keySub: line("direct key subtitle", 9, 96),
  dialTitle: line("direct dial title", 15, 176),
  dialReason: line("direct dial reason", 13, 176),
  dialHint: line("direct dial press hint", 10, 176),
  mixerTag: line("scene mixer LIVE/NEXT", 10, 80),
  mixerName: line("scene mixer scene name", 11, 80),
  mixerCaption: line("scene mixer caption", 10, 176),
  layerHeader: line("layer dial header", 11, 176),
  layerSource: line("layer dial source", 16, 176),
  layerStatus: line("layer dial status", 13, 176),
  layerFooter: line("layer dial footer", 10, 176),
  mfDialTitle: line("Midi Fadester dial title", 18, 172),
  mfDialReason: line("Midi Fadester dial reason", 14, 172),
  mfHold: line("Midi Fadester hold badge", 13, 176),
  mfTbarName: line("Midi Fadester T-bar scene", 12, 62),
  mfPercent: line("Midi Fadester T-bar percent", 18, 50),
  mfKeyTitle: { kind: "compactTitle", name: "Midi Fadester key title" } as Box,
  mfKeyReason: { kind: "twoLines", name: "Midi Fadester key reason", size: 11, width: 108 } as Box,
  cleanFxTitle: line("Clean FX title", 16, 104),
  cleanFxCount: line("Clean FX count", 15, 104),
  filterHead: line("filter dial head", 11, 120),
  filterBadge: line("filter key badge", 13, 96),
  infobarStatus: { kind: "native", name: "Info Bar status", size: 10, width: 220 } as Box,
  infobarLine: { kind: "native", name: "Info Bar Live/Preview", size: 13, width: 220 } as Box
};

const sample = (key: StringKey, params?: TextParams): { key: StringKey; params?: TextParams } => ({ key, params });
const reasons = [B.keySub, B.dialReason, B.layerStatus, B.mfDialReason, B.mfKeyReason];

/** Each drawn text, with the boxes it is drawn in. Composite texts are listed with their parts filled in. */
function drawnTexts(): Array<{ key: StringKey; params?: TextParams; boxes: Box[] }> {
  const roles: Array<[StringKey, TextParams?]> = [["audioMain"], ["audioMic"], ["audioAux"], ["audioInput", { n: 12 }]];
  const sceneRoles: string[] = [t("sceneRoleIndex", { n: 12 }), t("sceneRoleNext"), t("sceneRolePrevious"), t("sceneRoleRandom"), t("sceneRoleTake")];
  const operations: string[] = [t("sceneOpPreview"), t("sceneOpCut"), t("sceneOpTransition")];
  const blends: StringKey[] = ["blendNormal", "blendAdditive", "blendSubtract", "blendScreen", "blendMultiply", "blendLighten", "blendDarken"];
  const states = [t("layerShown"), t("layerHidden")];
  const texts: Array<{ key: StringKey; params?: TextParams; boxes: Box[] }> = [];
  const add = (key: StringKey, boxes: Box[], params?: TextParams): void => { texts.push({ ...sample(key, params), boxes }); };

  for (const key of ["statusUnreachableShort", "statusWrongPasswordShort"] as const) add(key, reasons);
  add("statusMissingPlugin", reasons, { plugin: "Midi Fadester" });
  add("statusVersionMismatchShort", reasons, { surface: "Fadester for OBS" });
  for (const key of ["errorDisconnected", "errorConnectionReset"] as const) add(key, [B.keySub, B.layerStatus]);
  add("errorRequestFailed", [B.keySub, B.layerStatus], { code: 600 });
  add("errorRequestTimeout", [B.keySub, B.layerStatus], { request: "SetCurrentProgramScene", ms: 4000 });
  add("percent", [B.dialReason, B.mfPercent], { n: 100 });
  add("cellFadesterTitle", [B.mfDialTitle]);
  add("cellFaderTitle", [B.mfDialTitle]);
  add("cellAutoFadeTitle", [B.mfKeyTitle]);
  for (const key of ["cellUnavailable", "cellUnassigned"] as const) add(key, [B.mfDialReason, B.mfKeyReason]);
  add("cellUnavailableInObs", [B.mfDialReason]);
  add("cellSlotNotFound", [B.mfDialReason], { slot: "crossfader" });
  add("cellSlotMissing", [B.mfKeyReason]);
  for (const key of ["cellHoldFade", "holdCleanFx", "holdFinish"] as const) add(key, [B.mfHold]);
  for (const key of ["cellPreview", "cellProgram"] as const) add(key, [B.mfTbarName]);
  add("cleanFxTitle", [B.mfKeyTitle]);
  add("cleanFxNeedsUpdate", [B.mfKeyReason]);
  for (const key of ["cleanFxActiveTitle", "cleanFxIdleTitle"] as const) add(key, [B.cleanFxTitle]);
  add("cleanFxActiveCount", [B.cleanFxCount], { n: 12 });
  add("cleanFxAllZero", [B.cleanFxCount]);

  for (const key of ["errorChooseInput", "errorTbarNeedsStudio", "errorChooseScene", "errorPreviewNeedsStudio",
    "errorNoCutTransition", "errorCurrentPreviewNeedsStudio", "errorControlChanged", "errorConnectBeforeStudio",
    "errorStudioNotEnabled", "errorTakeUnconfirmed", "errorFilterChoose"] as const) add(key, [B.keySub]);
  add("errorNoVolume", [B.keySub], { input: "Desktop Audio" });
  // The Playlister key draws its last error as the problem line.
  for (const key of ["errorMediaChoose", "errorMediaMissing", "errorMediaUnsupported", "errorMediaBusy",
    "errorMediaPending", "errorMediaChanging", "errorMediaAmbiguous"] as const) add(key, [B.keySub]);
  add("errorMediaWrongKind", [B.keySub], { input: "Camera" });
  // The OBS Filter controls' problem line, on keys and dials.
  for (const key of ["filterMissing", "filterWrongKind", "filterDenied", "filterNeedsRange", "filterOwnedFader",
    "filterNoValue", "filterLatched", "filterOutOfRange"] as const) add(key, [B.keySub, B.dialReason]);
  add("filterOwnedModulator", [B.keySub, B.dialReason], { filter: "Pulse" });
  // The Visual Panic keys: titles, hints and the not-loaded problem line. The fit samples of PLAN.md 10.7 are
  // "PANIC SENT" (a key title), "Restore first" (filterLatched, above) and the longest setting name (Mod 8 amount).
  for (const key of ["vpPanic", "vpPanicSent", "vpRestore"] as const) add(key, [B.keyTitle]);
  for (const key of ["vpPanicHint", "vpLatchedHint", "vpHolding", "vpNotLoaded"] as const) add(key, [B.keySub]);
  add("vpHoldSeconds", [B.keySub], { s: "0,8" });
  // The OBS Filter controls: key titles and subtitles, the dial's title, value line and press hint.
  const settingNames = [t("filterSettingEffectMix"), t("filterSettingReactivity"), t("filterSettingOpacity"), t("filterSettingModAmount", { n: 8 })];
  for (const key of ["filterSettingEffectMix", "filterSettingReactivity", "filterSettingOpacity", "filterSettingNone"] as const) add(key, [B.keyTitle, B.filterHead]);
  add("filterSettingModAmount", [B.keyTitle, B.filterHead], { n: 8 });
  for (const key of ["filterOpLook", "filterOpSet"] as const) add(key, [B.keyTitle]);
  for (const setting of settingNames) for (const key of ["filterOpStepUp", "filterOpStepDown"] as const) add(key, [B.keyTitle], { setting });
  for (const key of ["filterChoose", "filterReading", "filterGlideCancelled", "filterChooseSetting"] as const) add(key, [B.keySub, B.dialHint]);
  for (const key of ["filterOn", "filterOff"] as const) add(key, [B.keySub, B.filterBadge]);
  add("filterSetTo", [B.keySub], { value: "100 %", s: "2" });
  for (const key of ["filterPressDrop", "filterPressToggle"] as const) add(key, [B.dialHint]);
  // Its operation words are titles; the state, pending and busy words its subtitle. The time is drawn
  // only in PLAYING and PAUSED, so a two-hour item with those two words is the longest sample.
  for (const key of ["plOpPrevious", "plOpNext", "plOpPlayPause", "plOpStop", "plOpRestart", "plOpStatus"] as const) add(key, [B.keyTitle]);
  for (const key of ["plMissing", "plWrongKind", "plUnsupported", "mediaPendingPlay", "mediaPendingPause",
    "mediaUnconfirmed", "mediaBusy"] as const) add(key, [B.keySub]);
  for (const key of (Object.keys(EN) as StringKey[]).filter((name) => name.startsWith("mediaState"))) add(key, [B.keySub]);
  for (const key of ["mediaStatePlaying", "mediaStatePaused"] as const) {
    add("mediaTime", [B.keySub], { state: t(key), cursor: "2:00:00", duration: "2:00:00" });
  }
  add("errorRoleUnavailable", [B.keySub], { role: t("audioMic") });
  for (const key of ["errorSceneIndexUnavailableOne", "errorSceneIndexUnavailableMany"] as const) add(key, [B.keySub], { n: 4, count: 3 });
  for (const key of (Object.keys(EN) as StringKey[]).filter((name) => name.startsWith("layerError"))) add(key, [B.keySub, B.layerStatus]);
  for (const key of blends) add("layerKeySubtitle", [B.keySub], { state: t(key), source: "Camera" });
  for (const state of states) add("layerKeySubtitle", [B.keySub], { state, source: "Camera" });
  for (const key of blends) add("layerBlendMode", [B.layerStatus], { mode: t(key) });
  add("sourceFallback", [B.layerSource]);
  add("sceneAutomatic", [B.keyTitle], { n: 12 });
  for (const [key, params] of roles) {
    add(key, [B.keyTitle, B.dialTitle], params);
    add("roleUnavailable", [B.keySub, B.dialReason], { role: t(key, params) });
  }
  for (const key of ["sceneTargetTakePreview", "sceneTargetNext", "sceneTargetPrevious", "sceneTargetRandom",
    "sceneTitleFallback", "fadeTitle", "keyDefaultTitle", "keyChooseAction"] as const) add(key, [B.keyTitle]);
  for (const key of (Object.keys(EN) as StringKey[]).filter((name) => name.startsWith("layerOp"))) add(key, [B.keyTitle]);
  for (const key of ["sceneControlFailed", "sceneEnableStudio", "sceneUnavailable", "keyOpenInspector", "keyReady",
    "fadeUpNow", "fadeDownNow", "audioInputUnavailable", "layerControlFailed"] as const) add(key, [B.keySub]);
  for (const key of ["fadeUpSeconds", "fadeDownSeconds"] as const) add(key, [B.keySub], { s: "1,25" });
  for (const role of sceneRoles) for (const operation of operations) add("sceneSubtitle", [B.keySub], { role, operation });
  add("audioInputUnavailable", [B.dialReason]);
  for (const key of ["pressNextBlend", "pressPreviousBlend", "pressBlendTake", "pressDisabled"] as const) add(key, [B.dialHint, B.mixerCaption]);
  for (const key of ["pressNormalBlend", "pressShowHide"] as const) add(key, [B.dialHint, B.mixerCaption, B.layerFooter]);
  add("dialChooseControl", [B.dialTitle]);
  add("faderDefault", [B.dialTitle]);
  add("mixAll", [B.keyTitle, B.dialTitle]);
  for (const key of ["mixOffline", "mixDisabled", "mixConflict"] as const) add(key, [B.keySub, B.dialReason]);
  for (const key of ["mixFadeOut", "mixRestore"] as const) add(key, [B.keySub]);
  add("mixDb", [B.dialReason], { db: "-36.5" });
  add("dialOpenInspector", [B.dialReason]);
  add("obsNotConnected", [B.dialReason, B.keySub, B.mixerCaption]);
  add("studioModeOff", [B.dialReason]);
  for (const key of ["mixerLiveScene", "mixerChoosePreview"] as const) add(key, [B.mixerName]);
  for (const key of ["mixerTurnOnStudio", "mixerChooseDifferent", "mixerAutoQueue", "mixerPressTake"] as const) add(key, [B.mixerCaption]);
  for (const key of ["mixerLive", "mixerNext"] as const) add(key, [B.mixerTag]);
  for (const key of ["layerConnectObs", "layerChooseScene", "layerLoading", "layerFixedUnavailable", "layerChooseSource",
    "layerNoSources"] as const) add(key, [B.keySub, B.layerSource, B.layerStatus]);
  for (const key of ["layerTurnReorder", "layerReorderDisabled"] as const) add(key, [B.layerStatus]);
  for (const state of states) add("layerPosition", [B.layerStatus], { i: 12, n: 12, state });
  for (const role of ["layerRoleLive", "layerRolePreview", "layerRoleScene"] as const) add("layerHeader", [B.layerHeader], { role: t(role), scene: "Opening" });
  add("layerHeaderNone", [B.layerHeader]);
  for (const key of (Object.keys(EN) as StringKey[]).filter((name) => name.startsWith("layerFooter"))) add(key, [B.layerFooter]);
  for (const key of ["infobarDisconnected", "infobarConnected"] as const) add(key, [B.infobarStatus]);
  for (const scene of [t("infobarNoScene"), t("infobarUnavailable"), t("infobarStudioOff")]) {
    add("infobarLive", [B.infobarLine], { scene });
    add("infobarPreview", [B.infobarLine], { scene });
  }
  return texts;
}

/** Keys never drawn on the deck: inspector texts and full status sentences, kept out of the boxes on purpose. */
const NOT_ON_DECK = new Set<StringKey>([
  "statusUnreachable", "statusWrongPassword", "statusVersionMismatch", "statusConnectedDirect",
  "statusConnectedVendor", "statusConnectedVendorBuild", "errorEmptyScreenshot",
  "audioMainAutomatic", "audioMicAutomatic", "audioAuxAutomatic", "audioInputAutomatic",
  "setupErrorStudio", "setupErrorFallback", "piChooseSlot", "piEnabledNotApplied",
  "tierVerified", "tierBeta", "tierCustom", "profileGeneric",
  "modeUnassigned", "modeTbar", "modeCrossfade", "modeLayerOpacity", "modeAudioVolume", "modeFilterParam",
  "curveDipFree", "curveFullCenter", "curveEqualPower", "curveLinear", "curveCut",
  "layoutModeEither", "layoutModeStudio", "layoutModeRegular",
  // Drawn only inside the composites above.
  "blendNormal", "blendAdditive", "blendSubtract", "blendScreen", "blendMultiply", "blendLighten", "blendDarken",
  "sceneOpPreview", "sceneOpCut", "sceneOpTransition", "sceneRoleIndex", "sceneRoleNext", "sceneRolePrevious",
  "sceneRoleRandom", "sceneRoleTake", "layerShown", "layerHidden", "layerRoleLive", "layerRolePreview",
  "layerRoleScene", "infobarNoScene", "infobarUnavailable", "infobarStudioOff"
]);

function fits(text: string, box: Box): boolean {
  switch (box.kind) {
    case "line":
      return fitsBox(text, box.size, box.width);
    case "native":
      return textWidth(text, box.size) <= box.width;
    case "twoLines":
      return splitTitle(text, box.size, box.width).every((part) => fitsBox(part, box.size, box.width) && !part.endsWith("…"));
    case "keyTitle": {
      const layout = keyTitleLines(text);
      return layout.lines.every((part) => fitsBox(part, layout.fontSize, 102) && !part.endsWith("…"));
    }
    case "compactTitle": {
      const layout = compactKeyTitle(text);
      return [layout.firstLine, layout.secondLine ?? ""].every((part) => fitsBox(part, layout.fontSize, 104) && !part.endsWith("…"));
    }
  }
}

function measure(language: string): Array<{ text: string; english: string; box: Box; fits: boolean; englishFits: boolean }> {
  setLanguage("en", null);
  const englishTexts = drawnTexts().flatMap((entry) => entry.boxes.map((box) => ({ box, english: t(entry.key, entry.params) })));
  setLanguage(language, language === "en" ? null : deckTable(language));
  const results = drawnTexts().flatMap((entry) => entry.boxes.map((box) => ({ box, text: t(entry.key, entry.params) })));
  return results.map((result, index) => ({
    ...result, english: englishTexts[index].english,
    fits: fits(result.text, result.box), englishFits: fits(englishTexts[index].english, result.box)
  }));
}

afterEach(() => setLanguage("en", null));

describe("deck words fit their boxes (R-I18N-4)", () => {
  it("every deck key is either measured here or listed as not drawn on the deck", () => {
    setLanguage("en", null);
    const measured = new Set(drawnTexts().map((entry) => entry.key));
    for (const key of Object.keys(EN) as StringKey[]) {
      expect(measured.has(key) || NOT_ON_DECK.has(key), key).toBe(true);
    }
  });

  it.each(presentLanguages())("%s: every word fits wherever English fits", (language) => {
    const failures = measure(language).filter((entry) => entry.englishFits && !entry.fits)
      .map((entry) => `${entry.box.name}: "${entry.text}"`);
    expect(failures).toEqual([]);
  });

  it.each(presentLanguages())("%s: a sentence shortened in English too is at most half again as wide", (language) => {
    const failures = measure(language).filter((entry) => !entry.englishFits &&
      textWidth(entry.text, 10) > 1.5 * textWidth(entry.english, 10))
      .map((entry) => `${entry.box.name}: "${entry.text}"`);
    expect(failures).toEqual([]);
  });

  it("CJK counts one em per character, accented capitals as capitals", () => {
    expect(textWidth("場景", 10)).toBe(20);
    expect(textWidth("장면", 10)).toBe(20);
    expect(textWidth("シーン", 10)).toBe(30);
    expect(textWidth("Ü", 10)).toBe(textWidth("U", 10));
    expect(fitsBox("場景場景場景場景場景場景場", 10, 96)).toBe(false);
  });

  it("shortens a long OBS name by width with an ellipsis, keeps one that fits, and wraps CJK titles", () => {
    const long = fitText("Picture-in-picture camera overlay", 9, 96);
    expect(long.endsWith("…")).toBe(true);
    expect(fitsBox(long, 9, 96)).toBe(true);
    expect(fitText("Camera", 9, 96)).toBe("Camera");
    expect(fitText("映像のシーン切り替えテスト用の長い名前", 9, 96).endsWith("…")).toBe(true);
    expect(keyTitleLines("次のシーンに切り替え").lines).toHaveLength(2);
    expect(keyTitleLines("Opening").lines).toEqual(["Opening"]);
    expect(fontFamilyFor("場景")).toContain("Microsoft YaHei UI");
    expect(fontFamilyFor("シーン")).toMatch(/^Segoe UI, Yu Gothic UI/);
    expect(fontFamilyFor("장면")).toMatch(/^Segoe UI, Malgun Gothic/);
    expect(fontFamilyFor("Szene")).toBe("Segoe UI, Arial, sans-serif");
  });
});
