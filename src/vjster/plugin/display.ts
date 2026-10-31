// SPDX-License-Identifier: GPL-2.0-or-later
// VJster deck display: the touch strip and key artwork as SVG
// (docs/vjster/REQUIREMENTS.md R-SPD-6, R-QLT-3, R-QLT-5, R-BEH-4, R-BEH-5;
// PLAN.md 3.8). Pure functions of a view model, so they are tested without
// a Stream Deck. Built for a dark room: high contrast, one big number, neon
// accents, status words in plain capitals.

import type { StateReport } from "../shared/protocol.js";
import { AUTO, qualityLabel } from "../shared/quality.js";

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

/** Shorten to `max` characters with an ellipsis made of ASCII dots. */
export function fit(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 3)).join("").trimEnd()}...`;
}

/** `1.25x`, `1x`, `0.5x`, `16x`: up to two decimals, no trailing zeros. */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}x`;
}

/** A data URI Stream Deck accepts for setImage and pixmap feedback. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/** The status word while an ad plays; controls still send then, and the page holds the change (R-BEH-1). */
export const AD_WORD = "AD PLAYING";

/** The status word a target is in, or null when it has a video to show (R-BEH-4). */
export function statusWord(view: TargetView, need: "speed" | "quality" | "transport"): { word: string; color: string } | null {
  if (view.status === "port-in-use") return { word: "PORT IN USE", color: C.red };
  if (view.status === "extension-off") return { word: "EXTENSION OFF", color: C.red };
  if (view.status === "page-off") return { word: "NO PAGE", color: C.red };
  const s = view.state;
  if (!s || s.rate === null) return { word: "NO VIDEO", color: C.dim };
  if (!s.capabilities.includes(need)) return { word: "N/A", color: C.dim };
  if (s.adPlaying) return { word: AD_WORD, color: C.amber };
  return null;
}

const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.magenta}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${body}</svg>`;
}

function text(x: number, y: number, size: number, value: string, fill: string, extra = ""): string {
  return `<text x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="700" fill="${fill}" ${extra}>${escapeText(value)}</text>`;
}

function header(label: string, target: "browser" | "obs", right: string, rightColor: string): string {
  const tag = target === "obs" ? "OBS" : "WEB";
  return `${text(10, 17, 12, label, C.dim, 'letter-spacing="1.5"')}${text(STRIP_W - 10, 17, 11, right || tag, right ? rightColor : C.dim, 'text-anchor="end" letter-spacing="1"')}`;
}

export interface SpeedStripModel {
  readonly view: TargetView;
  readonly target: "browser" | "obs";
  /** A rate the deck asked for and the target has not answered yet; shown dimmer. */
  readonly pending: number | null;
  readonly min: number;
  readonly max: number;
  readonly label: string;
}

/** The speed dial's strip: label, one big rate, a bar with 1x marked, the title (R-SPD-6). */
export function speedStrip(m: SpeedStripModel): string {
  const status = statusWord(m.view, "speed");
  const s = m.view.state;
  let body = `<rect width="${STRIP_W}" height="${STRIP_H}" fill="${C.bg}"/>`;
  if (status && !(status.word === "AD PLAYING" && s?.rate != null)) {
    body += header(m.label, m.target, "", C.dim);
    body += text(STRIP_W / 2, 62, status.word.length > 9 ? 17 : 22, status.word, status.color, 'text-anchor="middle" letter-spacing="1"');
    return svg(STRIP_W, STRIP_H, body);
  }
  const rate = (s?.rate ?? 1) as number;
  const shown = m.pending ?? rate;
  const direct = s?.rateDirect === true;
  body += header(m.label, m.target, status ? "AD" : direct ? "EXT" : "", status ? C.amber : C.cyan);
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
  const title = s?.title ? fit(s.title, 30) : "";
  body += text(STRIP_W / 2, 95, 10, title, C.dim, 'text-anchor="middle"');
  return svg(STRIP_W, STRIP_H, body);
}

export interface QualityStripModel {
  readonly view: TargetView;
  readonly target: "browser" | "obs";
  readonly pending: string | null;
  readonly label: string;
}

/** The quality dial's strip: `1080p` or `AUTO 720p`, and a segment per offered level (R-QLT-3). */
export function qualityStrip(m: QualityStripModel): string {
  const status = statusWord(m.view, "quality");
  let body = `<rect width="${STRIP_W}" height="${STRIP_H}" fill="${C.bg}"/>`;
  const s = m.view.state;
  if (status || !s) {
    body += header(m.label, m.target, "", C.dim);
    const word = status?.word ?? "NO VIDEO";
    body += text(STRIP_W / 2, 62, word.length > 9 ? 17 : 22, word, status?.color ?? C.dim, 'text-anchor="middle" letter-spacing="1"');
    return svg(STRIP_W, STRIP_H, body);
  }
  const auto = s.qualityAuto === true && m.pending === null;
  const level = m.pending ?? s.quality;
  body += header(m.label, m.target, auto ? "AUTO" : "FIXED", auto ? C.green : C.magenta);
  const big = level === null || level === "unknown" ? "..." : level === AUTO ? "AUTO" : qualityLabel(level);
  body += text(STRIP_W / 2, 58, 32, big, m.pending !== null ? C.dim : "url(#g)", 'text-anchor="middle" filter="url(#glow)"');
  const levels = s.availableQualities.filter((l) => l !== AUTO);
  const n = Math.max(1, levels.length);
  const gap = 3;
  const w = (STRIP_W - 24 - gap * (n - 1)) / n;
  levels.forEach((l, i) => {
    const on = l === level;
    body += `<rect x="${12 + i * (w + gap)}" y="70" width="${w}" height="8" rx="2" fill="${on ? "url(#g)" : C.track}"/>`;
  });
  body += text(STRIP_W / 2, 95, 10, s.title ? fit(s.title, 30) : "", C.dim, 'text-anchor="middle"');
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
  readonly glyph?: "play" | "pause" | "pin" | "up" | "down";
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
  }
}

/** A key: dark tile, neon frame when active, big label, small sub line. */
/** Rough width in em of bold Segoe UI text, enough to keep a key's main text inside its frame. */
export function textEm(value: string): number {
  let em = 0;
  for (const ch of value) em += /[A-Z]/.test(ch) ? 0.72 : /[0-9]/.test(ch) ? 0.57 : ch === "." || ch === " " ? 0.27 : 0.55;
  return em;
}

/** Room for the main text on a key: the frame's inside, less a margin. */
export const KEY_TEXT_WIDTH = 116;
/** Room for a key's small caption, such as a pinned title. */
export const KEY_SUB_WIDTH = 124;

/** The largest caption size up to `max` that fits the key. */
function subSize(text: string, max: number): number {
  return [max, max - 2, max - 4, max - 6].find((s) => textEm(text) * s <= KEY_SUB_WIDTH) ?? max - 7;
}

export function keyImage(m: KeyModel): string {
  const fg = m.dim ? C.dim : C.text;
  let body = `<rect width="${KEY}" height="${KEY}" fill="${C.bg}"/>`;
  body += `<rect x="6" y="6" width="${KEY - 12}" height="${KEY - 12}" rx="20" fill="${C.panel}" stroke="${m.active ? "url(#g)" : C.track}" stroke-width="${m.active ? 6 : 2}"${m.active ? ' filter="url(#glow)"' : ""}/>`;
  if (m.glyph) {
    body += glyph(m.glyph, m.active ? C.cyan : fg);
    body += text(KEY / 2, 124, subSize(m.sub, 17), m.sub, C.dim, 'text-anchor="middle"');
  } else {
    const byLength = m.main.length <= 4 ? 46 : m.main.length <= 6 ? 36 : 26;
    const size = [46, 40, 36, 30, 26, 22].find((s) => s <= byLength && textEm(m.main) * s <= KEY_TEXT_WIDTH) ?? 22;
    body += text(KEY / 2, 84, size, m.main, m.active ? "url(#g)" : fg, 'text-anchor="middle"');
    body += text(KEY / 2, 118, subSize(m.sub, 16), m.sub, C.dim, 'text-anchor="middle"');
  }
  return svg(KEY, KEY, body);
}
