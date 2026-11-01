// SPDX-License-Identifier: GPL-2.0-or-later
import {
  escapeXml,
  toSvgDataUri
} from "../../packages/streamdeck-fadester-shared/src/svg-renderer.js";
import {
  fitText,
  fontFamilyFor,
  splitTitle,
  textFitAttributes,
  textWidth
} from "../../packages/streamdeck-fadester-shared/src/text-fit.js";
import { PLAYLISTER_PALETTE as P } from "../../packages/streamdeck-fadester-shared/src/palette.js";
import { formatNumber, t } from "../i18n/strings.js";

export { textFitAttributes, toSvgDataUri };

export type DirectKeyIcon = "scene" | "next" | "previous" | "shuffle" | "cut" | "take"
  | "volume-up" | "volume-down" | "source-next" | "source-previous" | "show" | "hide"
  | "layer-up" | "layer-down" | "blend" | "reset"
  | "media-previous" | "media-next" | "play-pause" | "stop" | "restart" | "status";

export interface DirectDialRenderInput {
  connected: boolean;
  reason: string;
  /** The control's own caption; empty draws the default (OBS fader, or the scene mixer's hint). */
  label: string;
  value: number;
  configured: boolean;
  studioMode?: boolean;
  target?: "input_volume" | "tbar" | "unconfigured";
  programSceneName?: string;
  previewSceneName?: string;
  autoQueueNextScene?: boolean;
  pressHint?: string;
  problem?: string;
}

export interface DirectKeyRenderInput {
  connected: boolean;
  reason: string;
  title: string;
  subtitle?: string;
  configured: boolean;
  problem?: string;
  icon?: DirectKeyIcon;
  /** An unconfigured key that still names itself: its title is kept and this replaces "Open inspector". */
  unboundSubtitle?: string;
}

const LATIN = "Segoe UI,Arial,sans-serif";

/** A text shortened by width (never by character count), squeezed into its
 * box, and its font list (CJK fonts for CJK text): `font-family` and fit attributes, then the content. */
export function boxText(raw: string, fontSize: number, maxWidth: number): { attrs: string; text: string } {
  const text = fitText(raw, fontSize, maxWidth);
  return { attrs: `font-family="${fontFamilyFor(text, LATIN)}" font-size="${fontSize}" ${textFitAttributes(text, maxWidth, fontSize)}`.trimEnd(), text: escapeXml(text) };
}

export function renderDirectDialSvg(input: DirectDialRenderInput): string {
  if (input.target === "tbar" && input.configured) {
    return renderSceneMixerSvg(input);
  }
  const border = !input.configured
    ? "#777b86"
    : !input.connected || input.problem
      ? "#df6d38"
      : input.studioMode === false
        ? "#d6a84b"
        : P.accentPurple;
  const title = input.configured ? input.label || t("faderDefault") : t("dialChooseControl");
  const reason = !input.configured
    ? t("dialOpenInspector")
    : !input.connected
      ? input.reason || t("obsNotConnected")
      : input.problem || (input.studioMode === false
        ? t("studioModeOff")
        : t("percent", { n: Math.round(Math.max(0, Math.min(1, input.value)) * 100) }));
  const barWidth = Math.round(Math.max(0, Math.min(1, input.value)) * 150);
  const pressHint = input.configured && input.connected && !input.problem ? input.pressHint : "";
  const titleText = boxText(title, 15, 176);
  const reasonText = boxText(reason, pressHint ? 11 : 13, 176);
  const hintText = pressHint ? boxText(pressHint, 10, 176) : undefined;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">',
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P.bgTop}"/><stop offset="100%" stop-color="${P.bgBottom}"/></linearGradient><linearGradient id="audio" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${P.blueStart}"/><stop offset="100%" stop-color="${P.violetEnd}"/></linearGradient></defs>`,
    '<rect x="2" y="2" width="196" height="96" rx="11" fill="url(#bg)" stroke="' + border + '" stroke-width="3"/>',
    `<text x="100" y="27" text-anchor="middle" fill="${P.whiteGlyph}" ${titleText.attrs} font-weight="700">${titleText.text}</text>`,
    `<rect x="25" y="49" width="150" height="13" rx="7" fill="${P.trackBg}"/>`,
    '<rect x="25" y="49" width="' + barWidth + '" height="13" rx="7" fill="url(#audio)"/>',
    `<rect x="${20 + barWidth}" y="43" width="10" height="25" rx="4" fill="${P.accentYellow}" stroke="${P.bgTop}" stroke-width="3"/>`,
    `<text x="100" y="${pressHint ? 80 : 86}" text-anchor="middle" fill="${P.mutedText}" ${reasonText.attrs} font-weight="600">${reasonText.text}</text>`,
    hintText ? `<text x="100" y="94" text-anchor="middle" fill="${P.accentYellow}" ${hintText.attrs}>${hintText.text}</text>` : "",
    '</svg>'
  ].join("");
}

/** Position 0 keeps Live; position 1 brings Next (OBS Preview) live. Keep
 * these labels truthful even though the older vendor surface drew the
 * conventional Preview/Program colors in the opposite screen order. */
function renderSceneMixerSvg(input: DirectDialRenderInput): string {
  const value = Math.max(0, Math.min(1, input.value));
  const program = input.programSceneName || t("mixerLiveScene");
  const preview = input.previewSceneName || t("mixerChoosePreview");
  const sameScene = Boolean(input.programSceneName && input.programSceneName === input.previewSceneName);
  const unavailable = !input.connected || input.studioMode === false;
  const reason = !input.connected ? input.reason || t("obsNotConnected") :
    input.studioMode === false ? t("mixerTurnOnStudio") :
      sameScene ? t("mixerChooseDifferent") : "";
  const moving = !unavailable && !sameScene && value > 0.001 && value < 0.999;
  const border = unavailable || moving ? P.orangeAccent : sameScene ? P.mutedText : P.accentPurple;
  const handleX = Math.max(14, Math.min(176, 14 + Math.round(172 * value) - 5));
  const caption = reason || input.pressHint || (input.autoQueueNextScene ? t("mixerAutoQueue") :
    input.label || t("mixerPressTake"));
  const liveTag = boxText(t("mixerLive"), 10, 80);
  const nextTag = boxText(t("mixerNext"), 10, 80);
  const programText = boxText(program, 11, 80);
  const previewText = boxText(preview, 11, 80);
  const captionText = boxText(caption, 10, 176);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" data-cell="scene-mixer">',
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P.bgTop}"/><stop offset="100%" stop-color="${P.bgBottom}"/></linearGradient>`,
    `<linearGradient id="sceneMix" x1="14" y1="0" x2="186" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${P.programRed}"/><stop offset="50%" stop-color="${P.blueStart}"/><stop offset="100%" stop-color="${P.previewGreen}"/></linearGradient></defs>`,
    `<rect x="2" y="2" width="196" height="96" rx="10" fill="url(#bg)" stroke="${border}" stroke-width="${moving ? 4 : 3}"/>`,
    `<text x="12" y="17" fill="${P.programRed}" ${liveTag.attrs} font-weight="800">${liveTag.text}</text>`,
    `<text x="188" y="17" text-anchor="end" fill="${P.previewGreen}" ${nextTag.attrs} font-weight="800">${nextTag.text}</text>`,
    `<text x="12" y="37" fill="${P.whiteGlyph}" ${programText.attrs} font-weight="700">${programText.text}</text>`,
    `<text x="188" y="37" text-anchor="end" fill="${P.whiteGlyph}" ${previewText.attrs} font-weight="700">${previewText.text}</text>`,
    `<rect x="14" y="50" width="172" height="23" rx="7" fill="url(#sceneMix)" opacity="${unavailable || sameScene ? 0.35 : 1}" stroke="${P.trackBorder}" stroke-width="3"/>`,
    !unavailable && !sameScene ? `<rect x="${handleX}" y="45" width="10" height="33" rx="4" fill="${P.orangeAccent}" stroke="${P.whiteGlyph}" stroke-width="3"/>` : "",
    `<text x="100" y="91" text-anchor="middle" fill="${reason ? P.orangeAccent : P.mutedText}" ${captionText.attrs} font-weight="600">${captionText.text}</text>`,
    '</svg>'
  ].join("");
}

export function renderDirectKeySvg(input: DirectKeyRenderInput): string {
  const unavailable = !input.connected || Boolean(input.problem);
  const border = !input.configured
    ? P.trackBorder
    : unavailable
      ? "#df6d38"
      : P.accentPurple;
  const title = input.configured
    ? input.title || t("keyDefaultTitle")
    : input.unboundSubtitle ? input.title || t("keyChooseAction") : t("keyChooseAction");
  const subtitle = !input.configured
    ? input.unboundSubtitle || t("keyOpenInspector")
    : !input.connected
      ? input.reason || t("obsNotConnected")
      : input.problem || input.subtitle || t("keyReady");
  const icon = input.icon || "scene";
  const titleLayout = keyTitleLines(title);
  const titleMarkup = titleLayout.lines.map((line, i) => {
    const lineText = boxText(line, titleLayout.fontSize, 102);
    return `<text x="60" y="${titleLayout.lines.length > 1 ? 69 + i * 16 : 77}" text-anchor="middle" fill="${P.whiteGlyph}" ${lineText.attrs} font-weight="700">${lineText.text}</text>`;
  }).join("");
  const subtitleText = boxText(subtitle, 9, 96);
  const glyph = !input.configured
    ? `<path d="M60 21v28M46 35h28"/>`
    : unavailable
      ? '<path d="M60 19 80 52H40Z"/><path d="M60 29v10m0 6v1"/>'
      : keyGlyph(icon);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-icon="${icon}">`,
    `<title>${escapeXml(title)} — ${escapeXml(subtitle)}</title>`,
    `<rect x="3" y="3" width="114" height="114" rx="14" fill="${P.bgTop}" stroke="${border}" stroke-width="3"/>`,
    `<rect x="31" y="12" width="58" height="44" rx="13" fill="${P.trackBg}"/>`,
    `<g fill="none" stroke="${unavailable && input.configured ? P.orangeAccent : P.accentYellow}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`,
    titleMarkup,
    `<rect x="9" y="94" width="102" height="18" rx="5" fill="${P.trackBg}"/>`,
    `<text x="60" y="107" text-anchor="middle" fill="${unavailable && input.configured ? P.orangeAccent : P.mutedText}" ${subtitleText.attrs} font-weight="600">${subtitleText.text}</text>`,
    '</svg>'
  ].join("");
}

export interface VisualPanicKeyRenderInput {
  operation: "panic" | "restore";
  connected: boolean;
  reason: string;
  /** The deck's latch: Panic was sent and no Restore has cleared it. */
  latched: boolean;
  /** Restore is held down, not yet long enough. */
  holding?: boolean;
  /** How long Restore must be held (0.8 s, the dial hold of D-3). */
  holdSeconds?: number;
  /** The last failed send ("Visual Sidechain not loaded" or OBS's own text). */
  problem?: string;
  /** A custom caption; empty draws the operation word. */
  title?: string;
}

const PANIC_WHITE = "#FAF7FF";
const PANIC_DARK_RED = "#7F1D1D";
/** Red words on the white "PANIC SENT" key, dark enough to read at arm's length (about 6:1). */
const PANIC_TEXT_RED = "#B91C1C";

/** Fixed meanings on every page: a solid red key is Panic only; a white key with red words is "PANIC SENT". */
export function renderVisualPanicKeySvg(input: VisualPanicKeyRenderInput): string {
  if (input.operation === "restore") return renderRestoreKeySvg(input);
  const latched = input.latched;
  const title = input.title || t(latched ? "vpPanicSent" : "vpPanic");
  const subtitle = !input.connected ? input.reason || t("obsNotConnected")
    : input.problem || t(latched ? "vpLatchedHint" : "vpPanicHint");
  const ink = latched ? PANIC_TEXT_RED : PANIC_WHITE;
  const layout = textWidth(title, 20) <= 102 ? { lines: [title], fontSize: 20 } : keyTitleLines(title);
  const titleMarkup = layout.lines.map((line, i) => {
    const lineText = boxText(line, layout.fontSize, 102);
    return `<text x="60" y="${layout.lines.length > 1 ? 76 + i * 13 : 82}" text-anchor="middle" fill="${ink}" ${lineText.attrs} font-weight="800">${lineText.text}</text>`;
  }).join("");
  const subtitleText = boxText(subtitle, 9, 96);
  const problem = !input.connected || Boolean(input.problem);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-icon="${latched ? "panic-sent" : "panic"}">`,
    `<title>${escapeXml(title)} — ${escapeXml(subtitle)}</title>`,
    `<rect x="3" y="3" width="114" height="114" rx="14" fill="${latched ? PANIC_WHITE : P.programRed}" stroke="${problem ? P.accentYellow : latched ? PANIC_TEXT_RED : PANIC_WHITE}" stroke-width="${problem ? 4 : 3}"/>`,
    // An octagon with a bar: stop, everywhere.
    `<path d="M52 14h16l12 12v16L68 54H52L40 42V26Z" fill="${latched ? PANIC_TEXT_RED : "none"}" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/>`,
    `<rect x="47" y="30" width="26" height="8" rx="2" fill="${latched ? PANIC_WHITE : ink}"/>`,
    titleMarkup,
    `<rect x="9" y="94" width="102" height="18" rx="5" fill="${latched ? "#FDE2E2" : PANIC_DARK_RED}"/>`,
    `<text x="60" y="107" text-anchor="middle" fill="${latched ? PANIC_DARK_RED : problem ? "#FFE4CC" : PANIC_WHITE}" ${subtitleText.attrs} font-weight="700">${subtitleText.text}</text>`,
    "</svg>"
  ].join("");
}

/** Restore: a sunrise arc in a hold ring; the ring lights while the key is held. */
function renderRestoreKeySvg(input: VisualPanicKeyRenderInput): string {
  const title = input.title || t("vpRestore");
  const subtitle = !input.connected ? input.reason || t("obsNotConnected")
    : input.problem || (input.holding ? t("vpHolding") : t("vpHoldSeconds", { s: formatNumber(input.holdSeconds ?? 0.8) }));
  const problem = !input.connected || Boolean(input.problem);
  const accent = P.accentPurple;
  const titleLayout = keyTitleLines(title);
  const titleMarkup = titleLayout.lines.map((line, i) => {
    const lineText = boxText(line, titleLayout.fontSize, 102);
    return `<text x="60" y="${titleLayout.lines.length > 1 ? 72 + i * 14 : 77}" text-anchor="middle" fill="${P.whiteGlyph}" ${lineText.attrs} font-weight="700">${lineText.text}</text>`;
  }).join("");
  const subtitleText = boxText(subtitle, 9, 96);
  const ring = input.holding ? P.accentYellow : P.trackBorder;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-icon="restore">`,
    `<title>${escapeXml(title)} — ${escapeXml(subtitle)}</title>`,
    `<rect x="3" y="3" width="114" height="114" rx="14" fill="${P.bgTop}" stroke="${problem ? "#df6d38" : accent}" stroke-width="3"/>`,
    `<circle cx="60" cy="34" r="21" fill="none" stroke="${ring}" stroke-width="${input.holding ? 5 : 3}"${input.holding ? "" : ' stroke-dasharray="6 5"'}/>`,
    `<g fill="none" stroke="${problem ? P.orangeAccent : P.accentYellow}" stroke-width="3" stroke-linecap="round">`,
    '<path d="M44 43h32"/><path d="M50 43a10 10 0 0 1 20 0"/><path d="M60 22v5M46 28l3 3M74 28l-3 3"/></g>',
    titleMarkup,
    `<rect x="9" y="94" width="102" height="18" rx="5" fill="${P.trackBg}"/>`,
    `<text x="60" y="107" text-anchor="middle" fill="${problem ? P.orangeAccent : input.holding ? P.accentYellow : P.mutedText}" ${subtitleText.attrs} font-weight="600">${subtitleText.text}</text>`,
    "</svg>"
  ].join("");
}

/** One line at 14 px, else two lines at 12 px: measured, so a long German
 * word or a CJK title wraps where it no longer fits, not at a character count. */
export function keyTitleLines(raw: string): { lines: string[]; fontSize: number } {
  const title = raw.trim().replace(/\s+/g, " ");
  if (textWidth(title, 14) <= 102) return { lines: [title], fontSize: 14 };
  if (textWidth(title, 12) <= 102) return { lines: [title], fontSize: 12 };
  return { lines: splitTitle(title, 12, 102), fontSize: 12 };
}

function keyGlyph(icon: DirectKeyIcon): string {
  const arrow = (left: boolean): string => left
    ? '<path d="M76 35H44m10-10L44 35l10 10"/>'
    : '<path d="M44 35h32M66 25l10 10-10 10"/>';
  switch (icon) {
    case "previous": return arrow(true);
    case "next": return arrow(false);
    case "source-previous": return '<path d="M48 18h27v6M48 50h27v-6"/>' + arrow(true);
    case "source-next": return '<path d="M45 18h27v6M45 50h27v-6"/>' + arrow(false);
    case "shuffle": return '<path d="M43 24h7l20 22h7m-8-7 8 7-8 5M43 46h7l20-22h7m-8-5 8 5-8 7"/>';
    case "cut": return '<path d="M43 25h11v20H43zm23 0h11v20H66zM60 18v34"/>';
    case "take": return '<path d="m51 22 22 13-22 13Z"/>';
    case "volume-up":
    case "volume-down": return '<path d="M41 30h7l10-8v26l-10-8h-7Z"/>' +
      (icon === "volume-up" ? '<path d="M66 35h14m-7-7v14"/>' : '<path d="M66 35h14"/>');
    case "show": return '<path d="M40 35q20-23 40 0-20 23-40 0Z"/><circle cx="60" cy="35" r="6"/>';
    case "hide": return '<path d="M40 35q20-23 40 0-20 23-40 0ZM43 19l34 32"/>';
    case "layer-up": return '<path d="M42 44h36M42 50h36M60 38V19m-9 9 9-9 9 9"/>';
    case "layer-down": return '<path d="M42 20h36M42 26h36M60 32v19m-9-9 9 9 9-9"/>';
    case "blend": return `<circle cx="52" cy="35" r="14" fill="${P.accentPurple}" stroke="${P.accentPurple}"/><circle cx="68" cy="35" r="14"/>`;
    case "reset": return '<path d="M46 28a16 16 0 1 1 0 16M44 19v12h12"/>';
    case "media-previous": return '<path d="M47 24v22"/><path d="M73 24v22L55 35Z"/>';
    case "media-next": return '<path d="M47 24v22l18-11Z"/><path d="M73 24v22"/>';
    case "play-pause": return '<path d="m43 24 17 11-17 11Z"/><path d="M68 24v22m9-22v22"/>';
    case "stop": return '<rect x="48" y="23" width="24" height="24" rx="4"/>';
    case "restart": return '<path d="M73 38a13 13 0 1 1-3.8-11.2"/><path d="M74 21v9h-9"/>';
    case "status": return '<circle cx="60" cy="35" r="12"/><path d="M60 28v7l5 3"/>';
    default: return '<rect x="40" y="21" width="40" height="28" rx="4"/><path d="m54 28 12 7-12 7Z"/>';
  }
}
