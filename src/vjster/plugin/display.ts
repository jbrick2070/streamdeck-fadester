// SPDX-License-Identifier: GPL-2.0-or-later
// VJster deck display: the touch strip and key artwork as SVG
// (docs/vjster/REQUIREMENTS.md R-SPD-6, R-QLT-3, R-QLT-5, R-BEH-4, R-BEH-5;
// PLAN.md 3.8). Pure functions of a view model, so they are tested without
// a Stream Deck. Built for a dark room: high contrast, one big number, neon
// accents, status words in plain capitals.

import type { StateReport } from "../shared/protocol.js";
import { AUTO, qualityLabel } from "../shared/quality.js";
import { EN, shownLabel, type DeckKey, type Strings } from "./strings.js";

/** Strip canvas size for the Stream Deck + (one dial's share of the strip). */
export const STRIP_W = 200;
export const STRIP_H = 100;
/** Key canvas size; Stream Deck scales it to every model. */
export const KEY = 144;

const C = {
  bg: "#0b0b12",
  panel: "#16161f",
  track: "#2a2a38",
  text: "#f4f4fa",
  dim: "#8a8aa0",
  magenta: "#ff2bd6",
  cyan: "#2bf0ff",
  amber: "#ffb020",
  red: "#ff4d5e",
  green: "#3dffa0"
} as const;

/** What a deck action knows about its target, for drawing. */
export type LinkStatus = "connected" | "extension-off" | "page-off" | "port-in-use";

export interface TargetView {
  readonly status: LinkStatus;
  /** The last state the target reported, or null before the first report. */
  readonly state: StateReport | null;
}

/** Escape text for SVG and drop anything that is not plain text (R-BEH-5: titles come from arbitrary pages). */
export function escapeText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // Controls, separators and bidi overrides; lone surrogates (encodeURIComponent throws on them);
    // noncharacters such as U+FFFE and U+FFFF, which make the SVG ill-formed XML.
    if (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      (code >= 0xfdd0 && code <= 0xfdef) ||
      (code & 0xfffe) === 0xfffe
    ) {
      out += " ";
      continue;
    }
    out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : ch === "'" ? "&#39;" : ch;
  }
  return out;
}

/** CJK ideographs, kana, Hangul, bopomofo and full-width forms: about one em wide each. */
const WIDE = /[\u1100-\u11ff\u2e80-\u303f\u3040-\u30ff\u3100-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe1f\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3134f}]/u;

/** Whether the text has CJK, kana or Hangul in it. */
export function hasWide(value: string): boolean {
  return WIDE.test(value);
}

/**
 * Rough width in em of bold Segoe UI text (or the CJK font that stands in for
 * it): capitals of any script 0.72, digits 0.57, dot and space 0.27, CJK, kana
 * and Hangul 1, combining marks 0, anything else 0.55 (PLAN.md 8.2).
 */
export function textEm(value: string): number {
  let em = 0;
  for (const ch of value) {
    em += WIDE.test(ch) ? 1 : /\p{M}/u.test(ch) ? 0 : /\p{Lu}/u.test(ch) ? 0.72 : /[0-9]/.test(ch) ? 0.57 : ch === "." || ch === " " ? 0.27 : 0.55;
  }
  return em;
}

/** Letter spacing as drawn: none for CJK text, which has no room for it. */
export function spacingFor(value: string, spacing: number): number {
  return hasWide(value) ? 0 : spacing;
}

/** Estimated width in px of `value` at `size` px with `spacing` px letter spacing. */
export function textWidth(value: string, size: number, spacing = 0): number {
  return textEm(value) * size + spacingFor(value, spacing) * [...value].length;
}

/** Shorten to `width` px at `size` px with an ellipsis made of ASCII dots; at least one character stays, and nothing gets longer. */
export function fit(text: string, size: number, width: number, spacing = 0): string {
  const chars = [...text];
  if (chars.length <= 1 || textWidth(text, size, spacing) <= width) return text;
  for (let n = chars.length - 1; n > 1; n--) {
    const shorter = `${chars.slice(0, n).join("").trimEnd()}...`;
    if (textWidth(shorter, size, spacing) <= width) return shorter;
  }
  return `${chars[0] ?? ""}...`;
}

/** `1.25x`, `1x`, `0.5x`, `16x`: up to two decimals, no trailing zeros. */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}x`;
}

/** A data URI Stream Deck accepts for setImage and pixmap feedback. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/** Why a target cannot show a video; logic compares these codes, never the words drawn for them (R-I18N-2). */
export type StatusCode = "port-in-use" | "extension-off" | "page-off" | "no-video" | "n-a" | "ad";

/** The code while an ad plays; controls still send then, and the page holds the change (R-BEH-1). */
export const AD: StatusCode = "ad";

/** The deck word for each status code. */
export const STATUS_WORD: Readonly<Record<StatusCode, DeckKey>> = {
  "port-in-use": "statusPortInUse",
  "extension-off": "statusExtensionOff",
  "page-off": "statusPageOff",
  "no-video": "statusNoVideo",
  "n-a": "statusNotAvailable",
  ad: "statusAd"
};

/** The state a target is in, or null when it has a video to show (R-BEH-4). */
export function statusWord(view: TargetView, need: "speed" | "quality" | "transport"): { code: StatusCode; color: string } | null {
  if (view.status === "port-in-use") return { code: "port-in-use", color: C.red };
  if (view.status === "extension-off") return { code: "extension-off", color: C.red };
  if (view.status === "page-off") return { code: "page-off", color: C.red };
  const s = view.state;
  if (!s || s.rate === null) return { code: "no-video", color: C.dim };
  if (!s.capabilities.includes(need)) return { code: "n-a", color: C.dim };
  if (s.adPlaying) return { code: AD, color: C.amber };
  return null;
}

/** A quality level as the deck shows it: the Auto word, `1080p`, or YouTube's own id. */
export function levelText(level: string, strings: Strings = EN): string {
  return level === AUTO ? strings.auto : qualityLabel(level);
}

const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.magenta}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${body}</svg>`;
}

const LATIN_FONTS = "Segoe UI, Arial, sans-serif";

/**
 * The font list for a text: Segoe UI, or for CJK text Windows' UI font for
 * the script it shows (Hangul, kana, else Chinese), then the others. Text
 * made of ideographs alone cannot tell Japanese from Chinese; it gets the
 * Chinese fonts first (PLAN.md 8.2, Review round 1).
 */
export function fontsFor(value: string): string {
  if (!hasWide(value)) return LATIN_FONTS;
  if (/[\u1100-\u11ff\ua960-\ua97f\uac00-\ud7ff]/u.test(value)) return "Segoe UI, Malgun Gothic, Yu Gothic UI, Microsoft YaHei UI, Microsoft JhengHei UI, sans-serif";
  if (/[\u3040-\u30ff]/u.test(value)) return "Segoe UI, Yu Gothic UI, Microsoft YaHei UI, Microsoft JhengHei UI, Malgun Gothic, sans-serif";
  return "Segoe UI, Microsoft YaHei UI, Microsoft JhengHei UI, Yu Gothic UI, Malgun Gothic, sans-serif";
}

function text(x: number, y: number, size: number, value: string, fill: string, extra = "", spacing = 0): string {
  const gap = spacingFor(value, spacing);
  return `<text x="${x}" y="${y}" font-family="${fontsFor(value)}" font-size="${size}" font-weight="700" fill="${fill}"${extra ? ` ${extra}` : ""}${gap > 0 ? ` letter-spacing="${gap}"` : ""}>${escapeText(value)}</text>`;
}

/** The strip header: the label at the left, a tag at the right, in one line of this width. */
export const HEADER = { width: STRIP_W - 20, gap: 8, labelSize: 12, labelSpacing: 1.5, tagSize: 11, tagSpacing: 1 } as const;

/** The header's label as drawn: shortened, if need be, to the room the tag leaves (PLAN.md 8.2). */
export function headerLabel(label: string, tag: string): string {
  const room = HEADER.width - HEADER.gap - textWidth(tag, HEADER.tagSize, HEADER.tagSpacing);
  return fit(label, HEADER.labelSize, room, HEADER.labelSpacing);
}

function header(label: string, target: "browser" | "obs", right: string, rightColor: string, strings: Strings): string {
  const tag = right || (target === "obs" ? strings.tagObs : strings.tagWeb);
  return `${text(10, 17, HEADER.labelSize, headerLabel(shownLabel(label, strings), tag), C.dim, "", HEADER.labelSpacing)}${text(STRIP_W - 10, 17, HEADER.tagSize, tag, right ? rightColor : C.dim, 'text-anchor="end"', HEADER.tagSpacing)}`;
}

/** The status word in the middle of a strip: the largest of these sizes that fits this width. */
export const STATUS = { sizes: [22, 17, 15, 13], width: STRIP_W - 16, spacing: 1 } as const;

/** The size a status word is drawn at, or null when it fits at none (it is then shortened at the smallest). */
export function statusSize(word: string): number | null {
  return STATUS.sizes.find((s) => textWidth(word, s, STATUS.spacing) <= STATUS.width) ?? null;
}

function statusText(word: string, color: string): string {
  const size = statusSize(word);
  const small = STATUS.sizes[STATUS.sizes.length - 1];
  return text(STRIP_W / 2, 62, size ?? small, size === null ? fit(word, small, STATUS.width, STATUS.spacing) : word, color, 'text-anchor="middle"', STATUS.spacing);
}

/** The big value on a strip (a rate, a level, the Auto word), and the title line under it. */
export const STRIP_VALUE = { size: 32, width: STRIP_W - 24 } as const;
export const STRIP_TITLE = { size: 10, width: STRIP_W - 20 } as const;

export interface SpeedStripModel {
  readonly view: TargetView;
  readonly target: "browser" | "obs";
  /** A rate the deck asked for and the target has not answered yet; shown dimmer. */
  readonly pending: number | null;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  /** The deck words; English when left out. */
  readonly strings?: Strings;
}

/** The speed dial's strip: label, one big rate, a bar with 1x marked, the title (R-SPD-6). */
export function speedStrip(m: SpeedStripModel): string {
  const strings = m.strings ?? EN;
  const status = statusWord(m.view, "speed");
  const s = m.view.state;
  let body = `<rect width="${STRIP_W}" height="${STRIP_H}" fill="${C.bg}"/>`;
  if (status && !(status.code === AD && s?.rate != null)) {
    body += header(m.label, m.target, "", C.dim, strings);
    body += statusText(strings[STATUS_WORD[status.code]], status.color);
    return svg(STRIP_W, STRIP_H, body);
  }
  const rate = (s?.rate ?? 1) as number;
  const shown = m.pending ?? rate;
  const direct = s?.rateDirect === true;
  body += header(m.label, m.target, status ? strings.tagAd : direct ? strings.tagExt : "", status ? C.amber : C.cyan, strings);
  body += text(STRIP_W / 2, 58, 34, formatRate(shown), m.pending !== null ? C.dim : "url(#g)", 'text-anchor="middle" filter="url(#glow)"');
  // Bar from min to max with 1x marked.
  const x0 = 12;
  const x1 = STRIP_W - 12;
  const span = Math.max(1e-9, m.max - m.min);
  const at = (r: number) => x0 + ((Math.min(m.max, Math.max(m.min, r)) - m.min) / span) * (x1 - x0);
  const one = at(1);
  body += `<rect x="${x0}" y="70" width="${x1 - x0}" height="6" rx="3" fill="${C.track}"/>`;
  body += `<rect x="${Math.min(one, at(shown))}" y="70" width="${Math.abs(at(shown) - one)}" height="6" rx="3" fill="url(#g)"/>`;
  body += `<rect x="${one - 1}" y="66" width="2" height="14" fill="${C.text}"/>`;
  body += `<circle cx="${at(shown)}" cy="73" r="5" fill="${C.text}"/>`;
  const title = s?.title ? fit(s.title, STRIP_TITLE.size, STRIP_TITLE.width) : "";
  body += text(STRIP_W / 2, 95, STRIP_TITLE.size, title, C.dim, 'text-anchor="middle"');
  return svg(STRIP_W, STRIP_H, body);
}

export interface QualityStripModel {
  readonly view: TargetView;
  readonly target: "browser" | "obs";
  readonly pending: string | null;
  readonly label: string;
  /** The deck words; English when left out. */
  readonly strings?: Strings;
}

/** The quality dial's strip: `1080p` or `AUTO 720p`, and a segment per offered level (R-QLT-3). */
export function qualityStrip(m: QualityStripModel): string {
  const strings = m.strings ?? EN;
  const status = statusWord(m.view, "quality");
  let body = `<rect width="${STRIP_W}" height="${STRIP_H}" fill="${C.bg}"/>`;
  const s = m.view.state;
  if (status || !s) {
    body += header(m.label, m.target, "", C.dim, strings);
    body += statusText(strings[STATUS_WORD[status?.code ?? "no-video"]], status?.color ?? C.dim);
    return svg(STRIP_W, STRIP_H, body);
  }
  const auto = s.qualityAuto === true && m.pending === null;
  const level = m.pending ?? s.quality;
  body += header(m.label, m.target, auto ? strings.tagAuto : strings.tagFixed, auto ? C.green : C.magenta, strings);
  const big = level === null || level === "unknown" ? "..." : levelText(level, strings);
  body += text(STRIP_W / 2, 58, STRIP_VALUE.size, fit(big, STRIP_VALUE.size, STRIP_VALUE.width), m.pending !== null ? C.dim : "url(#g)", 'text-anchor="middle" filter="url(#glow)"');
  const levels = s.availableQualities.filter((l) => l !== AUTO);
  const n = Math.max(1, levels.length);
  const gap = 3;
  const w = (STRIP_W - 24 - gap * (n - 1)) / n;
  levels.forEach((l, i) => {
    const on = l === level;
    body += `<rect x="${12 + i * (w + gap)}" y="70" width="${w}" height="8" rx="2" fill="${on ? "url(#g)" : C.track}"/>`;
  });
  body += text(STRIP_W / 2, 95, STRIP_TITLE.size, s.title ? fit(s.title, STRIP_TITLE.size, STRIP_TITLE.width) : "", C.dim, 'text-anchor="middle"');
  return svg(STRIP_W, STRIP_H, body);
}

export interface KeyModel {
  /** The big word or number. */
  readonly main: string;
  /** A small line under it. */
  readonly sub: string;
  /** Lit: the key's value is what plays now. */
  readonly active: boolean;
  /** Dimmed: the key cannot act now (R-QLT-5, R-BEH-4). */
  readonly dim: boolean;
  /** A symbol in place of the main text; `quality` is the language-neutral default image of the Quality dial. */
  readonly glyph?: "play" | "pause" | "pin" | "up" | "down" | "quality";
}

function glyph(kind: NonNullable<KeyModel["glyph"]>, color: string): string {
  switch (kind) {
    case "play":
      return `<path d="M58 40 L96 64 L58 88 Z" fill="${color}"/>`;
    case "pause":
      return `<rect x="54" y="40" width="13" height="48" rx="3" fill="${color}"/><rect x="77" y="40" width="13" height="48" rx="3" fill="${color}"/>`;
    case "pin":
      return `<path d="M72 30 L92 50 L84 58 L84 74 L72 86 L60 74 L60 58 L52 50 Z" fill="${color}"/><rect x="70" y="84" width="4" height="22" fill="${color}"/>`;
    case "up":
      return `<path d="M72 34 L98 66 L46 66 Z" fill="${color}"/>`;
    case "down":
      return `<path d="M72 92 L98 60 L46 60 Z" fill="${color}"/>`;
    case "quality":
      return `<rect x="38" y="42" width="68" height="46" rx="7" fill="none" stroke="${color}" stroke-width="6"/><path d="M57 65 L68 76 L88 55" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
}

/** Room for the main text on a key: the frame's inside, less a margin. */
export const KEY_TEXT_WIDTH = 116;
/** Room for a key's small caption, such as a pinned title. */
export const KEY_SUB_WIDTH = 124;

/** The largest caption size the key offers that fits it, or null when none does (it is then shortened at `max - 7`). */
export function captionSize(text: string, max: number): number | null {
  return [max, max - 2, max - 4, max - 6].find((s) => textWidth(text, s) <= KEY_SUB_WIDTH) ?? null;
}

/** The caption size on a key with a glyph (pin, play) and on one with a main text. */
export const CAPTION_MAX = { glyph: 17, main: 16 } as const;
/** The sizes a key's main text may take, largest first. */
export const MAIN_SIZES = [46, 40, 36, 30, 26, 22] as const;

/** The size of a key's main text, or null when it fits at none (it is then shortened at the smallest). */
export function mainSize(main: string): number | null {
  const count = [...main].length;
  const byLength = count <= 4 ? 46 : count <= 6 ? 36 : 26;
  return MAIN_SIZES.find((s) => s <= byLength && textWidth(main, s) <= KEY_TEXT_WIDTH) ?? null;
}

/** The small line under the glyph or main text; nothing when there is no text (the language-neutral default images, PLAN.md 9 L.6). */
function caption(y: number, sub: string, max: number): string {
  if (sub === "") return "";
  const size = captionSize(sub, max);
  return text(KEY / 2, y, size ?? max - 7, size === null ? fit(sub, max - 7, KEY_SUB_WIDTH) : sub, C.dim, 'text-anchor="middle"');
}

/** A key: dark tile, neon frame when active, big label, small sub line. */
export function keyImage(m: KeyModel): string {
  const fg = m.dim ? C.dim : C.text;
  let body = `<rect width="${KEY}" height="${KEY}" fill="${C.bg}"/>`;
  body += `<rect x="6" y="6" width="${KEY - 12}" height="${KEY - 12}" rx="20" fill="${C.panel}" stroke="${m.active ? "url(#g)" : C.track}" stroke-width="${m.active ? 6 : 2}"${m.active ? ' filter="url(#glow)"' : ""}/>`;
  if (m.glyph) {
    body += glyph(m.glyph, m.active ? C.cyan : fg);
    body += caption(124, m.sub, CAPTION_MAX.glyph);
  } else {
    const size = mainSize(m.main);
    body += text(KEY / 2, 84, size ?? 22, size === null ? fit(m.main, 22, KEY_TEXT_WIDTH) : m.main, m.active ? "url(#g)" : fg, 'text-anchor="middle"');
    body += caption(118, m.sub, CAPTION_MAX.main);
  }
  return svg(KEY, KEY, body);
}
