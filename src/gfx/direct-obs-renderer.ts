// SPDX-License-Identifier: GPL-2.0-or-later
import {
  escapeXml,
  toSvgDataUri,
  toStripUri
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
import type { AccentName } from "../types/settings.js";

export { textFitAttributes, toSvgDataUri, toStripUri };

/** The rig's page accents (PLAN.md 10): PERFORM brass, LAYERS teal, VISUALS magenta, SCENES today's violet. */
export const ACCENT_COLORS: Readonly<Record<AccentName, string>> = {
  default: P.accentPurple,
  brass: "#F5B841",
  teal: "#2DD4BF",
  magenta: "#E879F9"
};

/** True for an accent that changes the drawing; the default keeps every existing SVG byte for byte. */
function hasAccent(accent: AccentName | undefined): accent is Exclude<AccentName, "default"> {
  return accent !== undefined && accent !== "default";
}

export function accentColor(accent: AccentName | undefined): string {
  return ACCENT_COLORS[accent ?? "default"] ?? ACCENT_COLORS.default;
}

export type DirectKeyIcon = "scene" | "next" | "previous" | "shuffle" | "cut" | "take"
  | "volume-up" | "volume-down" | "source-next" | "source-previous" | "show" | "hide"
  | "layer-up" | "layer-down" | "blend" | "reset"
  | "media-previous" | "media-next" | "play-pause" | "stop" | "restart" | "status"
  | "look-on" | "look-off" | "still" | "full-react" | "wave" | "wave-up" | "wave-down";

export interface DirectDialRenderInput {
  connected: boolean;
  reason: string;
  /** The control's own caption; empty draws the default (OBS fader, or the scene mixer's hint). */
  label: string;
  value: number;
  configured: boolean;
  studioMode?: boolean;
  target?: "input_volume" | "tbar" | "unconfigured" | "all_inputs";
  valueLabel?: string;
  programSceneName?: string;
  previewSceneName?: string;
  autoQueueNextScene?: boolean;
  pressHint?: string;
  problem?: string;
  accent?: AccentName;
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
  accent?: AccentName;
  /** A large state word in place of the subtitle (a Look key's ON or OFF). */
  badge?: { text: string; on: boolean };
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
        : accentColor(input.accent);
  const title = input.configured ? input.label || t("faderDefault") : t("dialChooseControl");
  const reason = !input.configured
    ? t("dialOpenInspector")
    : !input.connected
      ? input.reason || t("obsNotConnected")
      : input.problem || (input.studioMode === false
        ? t("studioModeOff")
        : input.valueLabel || t("percent", { n: Math.round(Math.max(0, Math.min(1, input.value)) * 100) }));
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
    '<rect x="25" y="49" width="' + barWidth + '" height="13" rx="7" fill="' + (hasAccent(input.accent) ? accentColor(input.accent) : "url(#audio)") + '"/>',
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
  const border = unavailable || moving ? P.orangeAccent : sameScene ? P.mutedText : accentColor(input.accent);
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
      : accentColor(input.accent);
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
  const glyphColor = hasAccent(input.accent) ? accentColor(input.accent) : P.accentYellow;
  const glyph = !input.configured
    ? `<path d="M60 21v28M46 35h28"/>`
    : unavailable
      ? '<path d="M60 19 80 52H40Z"/><path d="M60 29v10m0 6v1"/>'
      : keyGlyph(icon, glyphColor);
  const badge = input.badge && input.configured && !unavailable ? input.badge : undefined;
  const badgeText = badge ? boxText(badge.text, 13, 96) : undefined;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-icon="${icon}">`,
    `<title>${escapeXml(title)} — ${escapeXml(subtitle)}</title>`,
    `<rect x="3" y="3" width="114" height="114" rx="14" fill="${P.bgTop}" stroke="${border}" stroke-width="3"/>`,
    `<rect x="31" y="12" width="58" height="44" rx="13" fill="${P.trackBg}"/>`,
    `<g fill="none" stroke="${unavailable && input.configured ? P.orangeAccent : glyphColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`,
    titleMarkup,
    badge && badgeText
      ? `<rect x="9" y="93" width="102" height="20" rx="6" fill="${badge.on ? glyphColor : P.trackBg}" stroke="${glyphColor}" stroke-width="3"/><text x="60" y="108" text-anchor="middle" fill="${badge.on ? P.bgTop : P.whiteGlyph}" ${badgeText.attrs} font-weight="800">${badgeText.text}</text>`
      : `<rect x="9" y="94" width="102" height="18" rx="5" fill="${P.trackBg}"/>` +
        `<text x="60" y="107" text-anchor="middle" fill="${unavailable && input.configured ? P.orangeAccent : P.mutedText}" ${subtitleText.attrs} font-weight="600">${subtitleText.text}</text>`,
    '</svg>'
  ].join("");
}

export interface FilterDialRenderInput {
  connected: boolean;
  reason: string;
  configured: boolean;
  /** The caption, or the setting's short name. */
  title: string;
  /** The OBS filter's name (verbatim). */
  filterName: string;
  /** The value as drawn ("62 %"), or "—" when OBS has none. */
  value: string;
  /** 0..1 in the setting's range, for the bar and the wave. */
  position: number;
  enabled: boolean | null;
  hint: string;
  problem?: string;
  accent?: AccentName;
}

/** A sine wave whose height follows the value: flat when still, tall when full. */
function waveGlyph(x: number, y: number, width: number, height: number): string {
  const amplitude = Math.max(0, Math.min(1, height));
  const quarter = width / 4;
  const a = Math.round(amplitude * 10 * 10) / 10;
  return `<path d="M${x} ${y}q${quarter / 2} ${-a * 2} ${quarter} 0t${quarter} 0t${quarter} 0t${quarter} 0"/>`;
}

/** The OBS Filter dial: filter and setting small, the value big, a wave over the bar. */
export function renderFilterDialSvg(input: FilterDialRenderInput): string {
  const accent = accentColor(input.accent);
  const problem = input.configured && (!input.connected || Boolean(input.problem));
  const border = !input.configured ? "#777b86" : problem ? "#df6d38" : accent;
  const position = Math.max(0, Math.min(1, input.position));
  const title = input.configured ? input.title : t("dialChooseControl");
  const footer = !input.configured ? t("dialOpenInspector")
    : !input.connected ? input.reason || t("obsNotConnected") : input.problem || input.hint;
  const head = boxText(input.configured ? `${title} · ${input.filterName}` : title, 11, 176);
  const value = boxText(input.configured && input.connected ? input.value : "—", 24, 96);
  const footerText = boxText(footer, 10, 176);
  const barWidth = Math.round(position * 172);
  const off = input.enabled === false;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" data-cell="filter">',
    `<defs><linearGradient id="filterBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P.bgTop}"/><stop offset="100%" stop-color="${P.bgBottom}"/></linearGradient></defs>`,
    `<rect x="2" y="2" width="196" height="96" rx="11" fill="url(#filterBg)" stroke="${border}" stroke-width="3"/>`,
    `<text x="100" y="19" text-anchor="middle" fill="${P.whiteGlyph}" ${head.attrs} font-weight="700">${head.text}</text>`,
    `<text x="14" y="52" fill="${off ? P.mutedText : P.whiteGlyph}" ${value.attrs} font-weight="800">${value.text}</text>`,
    `<g fill="none" stroke="${!input.configured ? P.trackBorder : problem ? P.orangeAccent : accent}" stroke-width="3" stroke-linecap="round" opacity="${off ? 0.45 : 1}">${waveGlyph(116, 42, 70, input.configured ? position : 0)}</g>`,
    `<rect x="14" y="62" width="172" height="12" rx="6" fill="${P.trackBg}"/>`,
    barWidth > 0 ? `<rect x="14" y="62" width="${barWidth}" height="12" rx="6" fill="${accent}" opacity="${off ? 0.45 : 1}"/>` : "",
    `<text x="100" y="91" text-anchor="middle" fill="${problem ? P.orangeAccent : P.mutedText}" ${footerText.attrs} font-weight="600">${footerText.text}</text>`,
    "</svg>"
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
  /** Restore's accent; Panic is always red. */
  accent?: AccentName;
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
  const accent = accentColor(input.accent);
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

export interface VisualMeterRenderInput {
  state: "disconnected" | "not_loaded" | "panic" | "no_audio" | "active";
  reason?: string;
  problem?: string;
  title?: string;
  subtitle?: string;
  bpm: number;
  bpmLocked: boolean;
  beatIndex: 0 | 1 | 2 | 3;
  subBass: number;
  bass: number;
  mid: number;
  high: number;
  spectrum?: readonly number[];
  accent?: AccentName;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function meterPadlockSvg(x: number, y: number, color: string): string {
  return [
    `<g data-bpm-locked="true" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`,
    `<rect x="${x}" y="${y + 5}" width="10" height="8" rx="2" fill="${color}"/>`,
    `<path d="M${x + 2.5} ${y + 5}V${y + 2.5}a2.5 2.5 0 0 1 5 0V${y + 5}"/>`,
    "</g>"
  ].join("");
}

function meterBpmLabel(bpm: number): string {
  return `${Math.round(bpm)} BPM`;
}

function meterStateLabel(input: VisualMeterRenderInput): string {
  switch (input.state) {
    case "disconnected":
      return input.reason || t("obsNotConnected");
    case "not_loaded":
      return t("vmNotLoaded");
    case "panic":
      return t("vmPanic");
    case "no_audio":
      return t("vmNoAudio");
    default:
      return meterBpmLabel(input.bpm);
  }
}

function meterBorderColor(input: VisualMeterRenderInput): string {
  if (input.problem || input.state === "disconnected" || input.state === "panic") return "#df6d38";
  if (input.state === "not_loaded") return "#777b86";
  if (input.state === "no_audio") return "#d6a84b";
  return accentColor(input.accent);
}

/**
 * Visual Sidechain Meter key (120x120, P1-3): BPM + lock mark, gentle 4-beat
 * step row (one low-contrast step per beat), four smoothed band bars (never raw
 * kick), and plain states NO AUDIO / PANIC / NOT LOADED. Never uses a solid red
 * background (solid red is reserved for Panic keys, R-RIG-8).
 */
export function renderVisualMeterKeySvg(input: VisualMeterRenderInput): string {
  const accent = accentColor(input.accent);
  const border = meterBorderColor(input);
  const head = input.title || t("vmTitle");
  const headText = boxText(head, 10, 96);
  const footer = input.problem || input.subtitle || t("vmBeatCount", { beat: input.beatIndex + 1 });
  const footerText = boxText(footer, 9, 96);

  if (input.state !== "active") {
    const label = meterStateLabel(input);
    const lines = keyTitleLines(label);
    const stateFill = input.state === "not_loaded" ? P.mutedText : P.orangeAccent;
    const stateMarkup = lines.lines.map((line, i) => {
      const lineText = boxText(line, lines.fontSize, 102);
      return `<text x="60" y="${lines.lines.length > 1 ? 55 + i * 16 : 63}" text-anchor="middle" fill="${stateFill}" ${lineText.attrs} font-weight="800">${lineText.text}</text>`;
    }).join("");
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-cell="visual-meter-key" data-state="${input.state}">`,
      `<title>${escapeXml(head)} — ${escapeXml(label)}</title>`,
      `<rect x="3" y="3" width="114" height="114" rx="14" fill="${P.bgTop}" stroke="${border}" stroke-width="3"/>`,
      `<text x="60" y="20" text-anchor="middle" fill="${P.mutedText}" ${headText.attrs} font-weight="700">${headText.text}</text>`,
      stateMarkup,
      `<rect x="9" y="94" width="102" height="18" rx="5" fill="${P.trackBg}"/>`,
      `<text x="60" y="107" text-anchor="middle" fill="${input.problem ? P.orangeAccent : P.mutedText}" ${footerText.attrs} font-weight="600">${footerText.text}</text>`,
      "</svg>"
    ].join("");
  }

  const bpmRaw = meterBpmLabel(input.bpm);
  const bpmText = boxText(bpmRaw, 15, input.bpmLocked ? 82 : 98);
  const bands = [
    clampUnit(input.subBass),
    clampUnit(input.bass),
    clampUnit(input.mid),
    clampUnit(input.high)
  ];
  const bandsAttr = bands.map((b) => Math.round(b * 100)).join(",");
  const dots = [0, 1, 2, 3].map((idx) => {
    const cx = 36 + idx * 16;
    const on = idx === input.beatIndex;
    return `<circle cx="${cx}" cy="53" r="3.5" fill="${on ? accent : P.trackBg}" stroke="${on ? P.whiteGlyph : P.trackBorder}" stroke-width="1.5" opacity="${on ? "0.85" : "0.55"}"/>`;
  }).join("");
  const bars = bands.map((level, idx) => {
    const x = 19 + idx * 21;
    const h = Math.round(level * 24);
    return `<rect x="${x}" y="64" width="15" height="24" rx="3" fill="${P.trackBg}"/>` +
      (h > 0 ? `<rect x="${x}" y="${88 - h}" width="15" height="${h}" rx="3" fill="${accent}" opacity="0.88"/>` : "");
  }).join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-cell="visual-meter-key" data-state="active" data-beat-index="${input.beatIndex}" data-bands="${bandsAttr}">`,
    `<title>${escapeXml(head)} — ${escapeXml(bpmRaw)}</title>`,
    `<rect x="3" y="3" width="114" height="114" rx="14" fill="${P.bgTop}" stroke="${border}" stroke-width="3"/>`,
    `<text x="60" y="18" text-anchor="middle" fill="${P.mutedText}" ${headText.attrs} font-weight="700">${headText.text}</text>`,
    `<text x="${input.bpmLocked ? 53 : 60}" y="40" text-anchor="middle" fill="${P.whiteGlyph}" ${bpmText.attrs} font-weight="800">${bpmText.text}</text>`,
    input.bpmLocked ? meterPadlockSvg(94, 27, P.accentYellow) : "",
    dots,
    bars,
    `<rect x="9" y="94" width="102" height="18" rx="5" fill="${P.trackBg}"/>`,
    `<text x="60" y="107" text-anchor="middle" fill="${input.problem ? P.orangeAccent : P.mutedText}" ${footerText.attrs} font-weight="600">${footerText.text}</text>`,
    "</svg>"
  ].join("");
}

/**
 * Visual Sidechain Meter dial / Stream Deck + touch strip (200x100, P1-3):
 * BPM + lock mark, locally stepped 4-beat dots, four smoothed band bars, and
 * 32-band spectrum across the touch strip.
 */
export function renderVisualMeterDialSvg(input: VisualMeterRenderInput): string {
  const accent = accentColor(input.accent);
  const border = meterBorderColor(input);
  const head = input.title || t("vmTitle");
  const footer = input.problem || input.subtitle || t("vmBeatCount", { beat: input.beatIndex + 1 });
  const footerText = boxText(footer, 10, 176);

  if (input.state !== "active") {
    const headText = boxText(head, 14, 176);
    const label = meterStateLabel(input);
    const stateText = boxText(label, 18, 176);
    const stateFill = input.state === "not_loaded" ? P.mutedText : P.orangeAccent;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" data-cell="visual-meter-dial" data-state="${input.state}">`,
      `<defs><linearGradient id="vmDialBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P.bgTop}"/><stop offset="100%" stop-color="${P.bgBottom}"/></linearGradient></defs>`,
      `<rect x="2" y="2" width="196" height="96" rx="11" fill="url(#vmDialBg)" stroke="${border}" stroke-width="3"/>`,
      `<text x="100" y="25" text-anchor="middle" fill="${P.whiteGlyph}" ${headText.attrs} font-weight="700">${headText.text}</text>`,
      `<text x="100" y="57" text-anchor="middle" fill="${stateFill}" ${stateText.attrs} font-weight="800">${stateText.text}</text>`,
      `<text x="100" y="88" text-anchor="middle" fill="${input.problem ? P.orangeAccent : P.mutedText}" ${footerText.attrs} font-weight="600">${footerText.text}</text>`,
      "</svg>"
    ].join("");
  }

  const bpmRaw = meterBpmLabel(input.bpm);
  const bpmText = boxText(bpmRaw, 15, input.bpmLocked ? 98 : 114);
  const bands = [
    clampUnit(input.subBass),
    clampUnit(input.bass),
    clampUnit(input.mid),
    clampUnit(input.high)
  ];
  const bandsAttr = bands.map((b) => Math.round(b * 100)).join(",");
  const dots = [0, 1, 2, 3].map((idx) => {
    const cx = 143 + idx * 14;
    const on = idx === input.beatIndex;
    return `<circle cx="${cx}" cy="17" r="3.5" fill="${on ? accent : P.trackBg}" stroke="${on ? P.whiteGlyph : P.trackBorder}" stroke-width="1.5" opacity="${on ? "0.85" : "0.55"}"/>`;
  }).join("");
  const bandBars = bands.map((level, idx) => {
    const x = 12 + idx * 14;
    const h = Math.round(level * 44);
    return `<rect x="${x}" y="30" width="11" height="44" rx="2" fill="${P.trackBg}"/>` +
      (h > 0 ? `<rect x="${x}" y="${74 - h}" width="11" height="${h}" rx="2" fill="${accent}" opacity="0.9"/>` : "");
  }).join("");
  const spectrum = input.spectrum ?? [];
  const specBars: string[] = [];
  for (let i = 0; i < 32; i++) {
    const level = clampUnit(spectrum[i] ?? 0);
    const x = 76 + i * 3.5;
    const h = Math.round(level * 44);
    if (h > 0) {
      specBars.push(`<rect x="${x}" y="${74 - h}" width="2.5" height="${h}" rx="1" fill="${P.blueStart}" opacity="0.85"/>`);
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" data-cell="visual-meter-dial" data-state="active" data-beat-index="${input.beatIndex}" data-bands="${bandsAttr}" data-spectrum-bins="32">`,
    `<defs><linearGradient id="vmDialBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P.bgTop}"/><stop offset="100%" stop-color="${P.bgBottom}"/></linearGradient></defs>`,
    `<rect x="2" y="2" width="196" height="96" rx="11" fill="url(#vmDialBg)" stroke="${border}" stroke-width="3"/>`,
    `<text x="12" y="22" fill="${P.whiteGlyph}" ${bpmText.attrs} font-weight="800">${bpmText.text}</text>`,
    input.bpmLocked ? meterPadlockSvg(116, 9, P.accentYellow) : "",
    dots,
    bandBars,
    `<rect x="74" y="30" width="114" height="44" rx="4" fill="${P.trackBg}"/>`,
    specBars.join(""),
    `<text x="100" y="90" text-anchor="middle" fill="${input.problem ? P.orangeAccent : P.mutedText}" ${footerText.attrs} font-weight="600">${footerText.text}</text>`,
    "</svg>"
  ].join("");
}

/**
 * Visual Sidechain Meter Stream Deck Neo Info Bar (232x50, P1-3):
 * BPM + lock mark, locally stepped 4-beat dots, four smoothed band bars, or
 * plain states NO AUDIO / PANIC / NOT LOADED.
 */
export function renderVisualMeterNeoSvg(input: VisualMeterRenderInput): string {
  const accent = accentColor(input.accent);
  const border = meterBorderColor(input);
  const head = input.title || t("vmTitle");
  const headText = boxText(head, 10, 100);

  if (input.state !== "active") {
    const label = meterStateLabel(input);
    const stateText = boxText(label, 14, 150);
    const stateFill = input.state === "not_loaded" ? P.mutedText : P.orangeAccent;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="232" height="50" viewBox="0 0 232 50" data-cell="visual-meter-neo" data-state="${input.state}">`,
      `<rect x="1" y="1" width="230" height="48" rx="6" fill="${P.bgTop}" stroke="${border}" stroke-width="2"/>`,
      `<text x="10" y="19" fill="${P.mutedText}" ${headText.attrs} font-weight="700">${headText.text}</text>`,
      `<text x="10" y="38" fill="${stateFill}" ${stateText.attrs} font-weight="800">${stateText.text}</text>`,
      "</svg>"
    ].join("");
  }

  const bpmRaw = meterBpmLabel(input.bpm);
  const bpmText = boxText(bpmRaw, 15, input.bpmLocked ? 86 : 102);
  const bands = [
    clampUnit(input.subBass),
    clampUnit(input.bass),
    clampUnit(input.mid),
    clampUnit(input.high)
  ];
  const bandsAttr = bands.map((b) => Math.round(b * 100)).join(",");
  const dots = [0, 1, 2, 3].map((idx) => {
    const cx = 118 + idx * 12;
    const on = idx === input.beatIndex;
    return `<circle cx="${cx}" cy="25" r="3.5" fill="${on ? accent : P.trackBg}" stroke="${on ? P.whiteGlyph : P.trackBorder}" stroke-width="1.5" opacity="${on ? "0.85" : "0.55"}"/>`;
  }).join("");
  const bandBars = bands.map((level, idx) => {
    const x = 168 + idx * 14;
    const h = Math.round(level * 32);
    return `<rect x="${x}" y="9" width="10" height="32" rx="2" fill="${P.trackBg}"/>` +
      (h > 0 ? `<rect x="${x}" y="${41 - h}" width="10" height="${h}" rx="2" fill="${accent}" opacity="0.9"/>` : "");
  }).join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="232" height="50" viewBox="0 0 232 50" data-cell="visual-meter-neo" data-state="active" data-beat-index="${input.beatIndex}" data-bands="${bandsAttr}">`,
    `<rect x="1" y="1" width="230" height="48" rx="6" fill="${P.bgTop}" stroke="${border}" stroke-width="2"/>`,
    `<text x="10" y="17" fill="${P.mutedText}" ${headText.attrs} font-weight="700">${headText.text}</text>`,
    `<text x="10" y="38" fill="${P.whiteGlyph}" ${bpmText.attrs} font-weight="800">${bpmText.text}</text>`,
    input.bpmLocked ? meterPadlockSvg(98, 25, P.accentYellow) : "",
    dots,
    bandBars,
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

function keyGlyph(icon: DirectKeyIcon, color: string = P.accentYellow): string {
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
    case "blend": {
      const fill = color === P.accentYellow ? P.accentPurple : color;
      return `<circle cx="52" cy="35" r="14" fill="${fill}" stroke="${fill}"/><circle cx="68" cy="35" r="14"/>`;
    }
    case "reset": return '<path d="M46 28a16 16 0 1 1 0 16M44 19v12h12"/>';
    case "media-previous": return '<path d="M47 24v22"/><path d="M73 24v22L55 35Z"/>';
    case "media-next": return '<path d="M47 24v22l18-11Z"/><path d="M73 24v22"/>';
    case "play-pause": return '<path d="m43 24 17 11-17 11Z"/><path d="M68 24v22m9-22v22"/>';
    case "stop": return '<rect x="48" y="23" width="24" height="24" rx="4"/>';
    case "restart": return '<path d="M73 38a13 13 0 1 1-3.8-11.2"/><path d="M74 21v9h-9"/>';
    case "status": return '<circle cx="60" cy="35" r="12"/><path d="M60 28v7l5 3"/>';
    // A lens with three rays, filled when the filter is on (a Look key).
    case "look-on": return `<circle cx="56" cy="38" r="10" fill="${color}"/><path d="M63 45l8 8M56 21v4M44 26l3 3M68 26l-3 3"/>`;
    case "look-off": return '<circle cx="56" cy="38" r="10"/><path d="M63 45l8 8M56 21v4M44 26l3 3M68 26l-3 3"/>';
    // Waves: flat when still, tall when full, with an arrow for a step.
    case "still": return '<path d="M42 35h36"/><path d="M42 44h36" stroke-dasharray="4 5"/>';
    case "full-react": return '<path d="M40 35q5-16 10 0t10 0 10 0 10 0"/>';
    case "wave": return '<path d="M40 35q5-8 10 0t10 0 10 0 10 0"/>';
    case "wave-up": return '<path d="M40 41q4-7 8 0t8 0 8 0"/><path d="M74 46V24m-6 6 6-6 6 6"/>';
    case "wave-down": return '<path d="M40 31q4-7 8 0t8 0 8 0"/><path d="M74 24v22m-6-6 6 6 6-6"/>';
    default: return '<rect x="40" y="21" width="40" height="28" rx="4"/><path d="m54 28 12 7-12 7Z"/>';
  }
}
