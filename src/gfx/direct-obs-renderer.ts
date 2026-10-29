// SPDX-License-Identifier: GPL-2.0-or-later
import {
  escapeXml,
  toSvgDataUri,
  truncateLabel
} from "../../packages/streamdeck-fadester-shared/src/svg-renderer.js";
import { PLAYLISTER_PALETTE as P } from "../../packages/streamdeck-fadester-shared/src/palette.js";

export { toSvgDataUri };

export type DirectKeyIcon = "scene" | "next" | "previous" | "shuffle" | "cut" | "take"
  | "volume-up" | "volume-down" | "source-next" | "source-previous" | "show" | "hide"
  | "layer-up" | "layer-down" | "blend" | "reset";

export interface DirectDialRenderInput {
  connected: boolean;
  reason: string;
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
}

function dialText(text: string, maxChars: number): string {
  return escapeXml(truncateLabel(text, maxChars));
}

/** Bound unusually wide names without depending on an installed font engine.
 * A conservative glyph-width estimate leaves short names at natural width;
 * SVG's explicit text length contains long/wide names within their own field. */
export function textFitAttributes(text: string, maxWidth: number, fontSize: number): string {
  const upperWidth = Array.from(text).reduce((sum, char) => sum +
    (/\s/.test(char) ? 0.4 : /[ilI!.,:;'|]/.test(char) ? 0.45 : /[mwMW@%]/.test(char) ? 1.2 :
      /[A-Z]/.test(char) ? 1 : /[a-z0-9]/.test(char) ? 0.85 : 1.2), 0) * fontSize;
  return upperWidth > maxWidth ? `textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : "";
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
  const title = input.configured ? input.label || "OBS fader" : "Choose OBS control";
  const reason = !input.configured
    ? "Open its inspector"
    : !input.connected
      ? input.reason || "OBS not connected"
      : input.problem || (input.studioMode === false
        ? "Studio Mode is off"
        : `${Math.round(Math.max(0, Math.min(1, input.value)) * 100)} %`);
  const barWidth = Math.round(Math.max(0, Math.min(1, input.value)) * 150);
  const pressHint = input.configured && input.connected && !input.problem ? input.pressHint : "";
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">',
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P.bgTop}"/><stop offset="100%" stop-color="${P.bgBottom}"/></linearGradient><linearGradient id="audio" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${P.blueStart}"/><stop offset="100%" stop-color="${P.violetEnd}"/></linearGradient></defs>`,
    '<rect x="2" y="2" width="196" height="96" rx="11" fill="url(#bg)" stroke="' + border + '" stroke-width="3"/>',
    `<text x="100" y="27" text-anchor="middle" fill="${P.whiteGlyph}" font-family="Segoe UI,Arial,sans-serif" font-size="15" font-weight="700" ${textFitAttributes(truncateLabel(title, 22), 176, 15)}>` + dialText(title, 22) + '</text>',
    `<rect x="25" y="49" width="150" height="13" rx="7" fill="${P.trackBg}"/>`,
    '<rect x="25" y="49" width="' + barWidth + '" height="13" rx="7" fill="url(#audio)"/>',
    `<rect x="${20 + barWidth}" y="43" width="10" height="25" rx="4" fill="${P.accentYellow}" stroke="${P.bgTop}" stroke-width="3"/>`,
    `<text x="100" y="${pressHint ? 80 : 86}" text-anchor="middle" fill="${P.mutedText}" font-family="Segoe UI,Arial,sans-serif" font-size="${pressHint ? 11 : 13}" font-weight="600" ${textFitAttributes(truncateLabel(reason, 28), 176, pressHint ? 11 : 13)}>` + dialText(reason, 28) + '</text>',
    pressHint ? `<text x="100" y="94" text-anchor="middle" fill="${P.accentYellow}" font-family="Segoe UI,Arial,sans-serif" font-size="10" ${textFitAttributes(truncateLabel(pressHint, 31), 176, 10)}>${dialText(pressHint, 31)}</text>` : "",
    '</svg>'
  ].join("");
}

/** Position 0 keeps Live; position 1 brings Next (OBS Preview) live. Keep
 * these labels truthful even though the older vendor surface drew the
 * conventional Preview/Program colors in the opposite screen order. */
function renderSceneMixerSvg(input: DirectDialRenderInput): string {
  const value = Math.max(0, Math.min(1, input.value));
  const program = input.programSceneName || "Live scene";
  const preview = input.previewSceneName || "Choose Preview";
  const sameScene = Boolean(input.programSceneName && input.programSceneName === input.previewSceneName);
  const unavailable = !input.connected || input.studioMode === false;
  const reason = !input.connected ? input.reason || "OBS not connected" :
    input.studioMode === false ? "Turn on OBS Studio Mode" :
      sameScene ? "Choose a different Next scene" : "";
  const moving = !unavailable && !sameScene && value > 0.001 && value < 0.999;
  const border = unavailable || moving ? P.orangeAccent : sameScene ? P.mutedText : P.accentPurple;
  const handleX = Math.max(14, Math.min(176, 14 + Math.round(172 * value) - 5));
  const caption = reason || input.pressHint || (input.autoQueueNextScene ? "Turn to fade · auto-queues Next" :
    input.label && input.label !== "Scene transition" ? input.label : "Press to take Next live");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" data-cell="scene-mixer">',
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P.bgTop}"/><stop offset="100%" stop-color="${P.bgBottom}"/></linearGradient>`,
    `<linearGradient id="sceneMix" x1="14" y1="0" x2="186" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${P.programRed}"/><stop offset="50%" stop-color="${P.blueStart}"/><stop offset="100%" stop-color="${P.previewGreen}"/></linearGradient></defs>`,
    `<rect x="2" y="2" width="196" height="96" rx="10" fill="url(#bg)" stroke="${border}" stroke-width="${moving ? 4 : 3}"/>`,
    `<text x="12" y="17" fill="${P.programRed}" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="800">LIVE</text>`,
    `<text x="188" y="17" text-anchor="end" fill="${P.previewGreen}" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="800">NEXT</text>`,
    `<text x="12" y="37" fill="${P.whiteGlyph}" font-family="Segoe UI,Arial,sans-serif" font-size="11" font-weight="700" ${textFitAttributes(truncateLabel(program, 15), 80, 11)}>${dialText(program, 15)}</text>`,
    `<text x="188" y="37" text-anchor="end" fill="${P.whiteGlyph}" font-family="Segoe UI,Arial,sans-serif" font-size="11" font-weight="700" ${textFitAttributes(truncateLabel(preview, 15), 80, 11)}>${dialText(preview, 15)}</text>`,
    `<rect x="14" y="50" width="172" height="23" rx="7" fill="url(#sceneMix)" opacity="${unavailable || sameScene ? 0.35 : 1}" stroke="${P.trackBorder}" stroke-width="3"/>`,
    !unavailable && !sameScene ? `<rect x="${handleX}" y="45" width="10" height="33" rx="4" fill="${P.orangeAccent}" stroke="${P.whiteGlyph}" stroke-width="3"/>` : "",
    `<text x="100" y="91" text-anchor="middle" fill="${reason ? P.orangeAccent : P.mutedText}" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="600" ${textFitAttributes(truncateLabel(caption, 31), 176, 10)}>${dialText(caption, 31)}</text>`,
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
  const title = input.configured ? input.title || "OBS" : "Choose OBS action";
  const subtitle = !input.configured
    ? "Open inspector"
    : !input.connected
      ? input.reason || "OBS not connected"
      : input.problem || input.subtitle || "Ready";
  const icon = input.icon || "scene";
  const titleLines = keyTitleLines(title);
  const titleMarkup = titleLines.map((line, i) =>
    `<text x="60" y="${titleLines.length > 1 ? 69 + i * 16 : 77}" text-anchor="middle" fill="${P.whiteGlyph}" font-family="Segoe UI,Arial,sans-serif" font-size="${line.length > 13 ? 12 : 14}" font-weight="700" ${textFitAttributes(line, 102, line.length > 13 ? 12 : 14)}>${escapeXml(line)}</text>`).join("");
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
    `<text x="60" y="107" text-anchor="middle" fill="${unavailable && input.configured ? P.orangeAccent : P.mutedText}" font-family="Segoe UI,Arial,sans-serif" font-size="9" font-weight="600" ${textFitAttributes(truncateLabel(subtitle, 22), 96, 9)}>${dialText(subtitle, 22)}</text>`,
    '</svg>'
  ].join("");
}

/** Two short lines preserve useful scene names at the size of a physical key. */
function keyTitleLines(raw: string): string[] {
  const title = raw.trim().replace(/\s+/g, " ");
  if (title.length <= 15) return [title];
  const space = title.lastIndexOf(" ", 15);
  const split = space > 3 ? space : 15;
  return [title.slice(0, split), truncateLabel(title.slice(split).trim(), 15)];
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
    default: return '<rect x="40" y="21" width="40" height="28" rx="4"/><path d="m54 28 12 7-12 7Z"/>';
  }
}
