// SPDX-License-Identifier: GPL-2.0-or-later
import { ConnectionStatusInfo, SurfaceSlotBase } from "./types.js";
import { PLAYLISTER_PALETTE, getSourcePairGradientColors } from "./palette.js";
import { isResetFxEligible } from "./fx-policy.js";
import { Translate, englishShared } from "./i18n.js";
import { statusCellReason, statusSentence } from "./status-text.js";
import { fitText, fontFamilyFor, splitTitle, textFitAttributes, textWidth } from "./text-fit.js";

export interface DialCellRenderInput<
  TSlot extends SurfaceSlotBase = SurfaceSlotBase
> {
  status: ConnectionStatusInfo;
  slot?: TSlot;
  slotId: string;
  previewSceneName?: string;
  programSceneName?: string;
  showThumbnails?: boolean;
  thumbnailA?: string;
  thumbnailB?: string;
  holdingForLongPress?: boolean;
  holdLabel?: string;
  /** Operator-chosen label; replaces the engine label when non-empty. */
  labelOverride?: string;
  /** "percent" forces a 0..100 % readout; "auto" prefers display_value. */
  readoutStyle?: "auto" | "percent";
  /** The plugin's translator; English when omitted. */
  t?: Translate;
}

export interface KeyCellRenderInput<
  TSlot extends SurfaceSlotBase = SurfaceSlotBase
> {
  status: ConnectionStatusInfo;
  slot?: TSlot;
  slots?: readonly TSlot[];
  slotId: string;
  to: 0 | 1;
  durationMs: number;
  labelOverride?: string;
  readoutStyle?: "auto" | "percent";
  /** The plugin's translator; English when omitted. */
  t?: Translate;
}

export function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A text element's fitted content: shortened by width, squeezed into its box, in a font that has its glyphs. */
function fitted(raw: string, fontSize: number, maxWidth: number): { text: string; attrs: string; font: string } {
  const text = fitText(raw, fontSize, maxWidth);
  const fit = textFitAttributes(text, maxWidth, fontSize);
  return { text: escapeXml(text), attrs: fit ? ` ${fit}` : "", font: fontFamilyFor(text) };
}

/** Width a key's text may use: the 120 px key less its border and margins. */
const KEY_TEXT_WIDTH = 104;

/** Width a dial row may use from x=14 to x=186. */
const DIAL_TEXT_WIDTH = 172;

/** A text is shortened by width (`fitText`), never by a count of characters (R-I18N-4). */
type CompactKeyTitle = {
  firstLine: string;
  secondLine?: string;
  fontSize: number;
};

/** Keep target names readable on a 120px Stream Deck key: one line at 14 px
 * when it fits, else two lines at the largest size both fit (by width, so CJK
 * and long German words are measured, not counted). */
export function compactKeyTitle(raw: string, t: Translate = englishShared): CompactKeyTitle {
  const title = (raw.trim() || t("cellAutoFadeTitle")).trim().replace(/\s+/g, " ");
  if (textWidth(title, 14) <= KEY_TEXT_WIDTH) {
    return { firstLine: title, fontSize: 14 };
  }
  for (const fontSize of [13, 11, 10]) {
    const lines = splitTitle(title, fontSize, KEY_TEXT_WIDTH);
    if (lines.every((line) => textWidth(line, fontSize) <= KEY_TEXT_WIDTH)) {
      return lines.length === 2 ? { firstLine: lines[0], secondLine: lines[1], fontSize } : { firstLine: lines[0], fontSize };
    }
  }
  const lines = splitTitle(title, 10, KEY_TEXT_WIDTH);
  return lines.length === 2
    ? { firstLine: lines[0], secondLine: lines[1], fontSize: 10 }
    : { firstLine: lines[0], fontSize: 10 };
}

function renderCompactKeyTitle(
  layout: CompactKeyTitle,
  fill: string,
  singleLineY: number,
  twoLineY: number
): string {
  const first = fitted(layout.firstLine, layout.fontSize, KEY_TEXT_WIDTH);
  const font = fontFamilyFor(layout.firstLine + (layout.secondLine ?? ""));
  const attributes = `x="60" text-anchor="middle" fill="${fill}" font-family="${font}" font-size="${layout.fontSize}" font-weight="700"`;
  if (layout.secondLine) {
    const second = fitted(layout.secondLine, layout.fontSize, KEY_TEXT_WIDTH);
    const firstLine = first.attrs ? `<tspan${first.attrs}>${first.text}</tspan>` : first.text;
    return `<text data-title-lines="2" ${attributes} y="${twoLineY}">${firstLine}<tspan x="60" dy="14"${second.attrs}>${second.text}</tspan></text>`;
  }
  return `<text data-title-lines="1" ${attributes} y="${singleLineY}"${first.attrs}>${first.text}</text>`;
}

export function toSvgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * The picture of a dial's display strip: the same SVG as base64. A strip's picture is drawn from a layout item, and
 * OpenDeck's strip renderer reads only a base64 data URI there (it draws a checkerboard for the URL-encoded form that
 * a key's setImage accepts); Stream Deck software reads either.
 */
export function toStripUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function renderDialStatusSvg(
  title: string,
  reason: string,
  borderColor: string,
  t: Translate
): string {
  const safeTitle = fitted(title || t("cellFadesterTitle"), 18, DIAL_TEXT_WIDTH);
  const safeReason = fitted(reason || t("cellUnavailable"), 14, DIAL_TEXT_WIDTH);
  const P = PLAYLISTER_PALETTE;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">`,
    `<defs>`,
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="${P.bgTop}"/>`,
    `<stop offset="100%" stop-color="${P.bgBottom}"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect x="2" y="2" width="196" height="96" rx="10" fill="url(#bg)" stroke="${borderColor}" stroke-width="3"/>`,
    `<text x="14" y="38" fill="${P.whiteGlyph}" font-family="${safeTitle.font}" font-size="18" font-weight="700"${safeTitle.attrs}>${safeTitle.text}</text>`,
    `<text x="14" y="70" fill="${P.orangeAccent}" font-family="${safeReason.font}" font-size="14" font-weight="700"${safeReason.attrs}>${safeReason.text}</text>`,
    `</svg>`
  ].join("");
}

function renderTakeoverArrow(
  pending: SurfaceSlotBase["takeover_pending"],
  x: number,
  y: number
): string {
  if (pending === "up") {
    return `<polygon data-takeover="up" points="${x},${y - 8} ${x - 8},${y + 7} ${x + 8},${y + 7}" fill="${PLAYLISTER_PALETTE.orangeAccent}" stroke="${PLAYLISTER_PALETTE.whiteGlyph}" stroke-width="3" stroke-linejoin="round"/>`;
  }
  if (pending === "down") {
    return `<polygon data-takeover="down" points="${x},${y + 8} ${x - 8},${y - 7} ${x + 8},${y - 7}" fill="${PLAYLISTER_PALETTE.orangeAccent}" stroke="${PLAYLISTER_PALETTE.whiteGlyph}" stroke-width="3" stroke-linejoin="round"/>`;
  }
  return "";
}

function renderHoldOverlay(label: string | undefined, t: Translate): string {
  const P = PLAYLISTER_PALETTE;
  // The badge grows with its words (112 to 188 px); its text is fitted inside.
  const raw = label || t("cellHoldFade");
  const boxW = Math.max(112, Math.min(188, Math.ceil(textWidth(raw, 13) + 20)));
  const safeLabel = fitted(raw, 13, boxW - 12);
  const boxX = Math.round((200 - boxW) / 2);
  return [
    `<rect data-hold-indicator="true" x="3" y="3" width="194" height="94" rx="10" fill="none" stroke="${P.orangeAccent}" stroke-width="4"/>`,
    `<rect x="${boxX}" y="6" width="${boxW}" height="24" rx="6" fill="${P.orangeAccent}" stroke="${P.whiteGlyph}" stroke-width="3"/>`,
    `<text x="100" y="23" text-anchor="middle" fill="${P.bgTop}" font-family="${safeLabel.font}" font-size="13" font-weight="800"${safeLabel.attrs}>${safeLabel.text}</text>`
  ].join("");
}

function renderParkedIndicator(parked?: boolean): string {
  if (!parked) {
    return "";
  }
  const P = PLAYLISTER_PALETTE;
  return `<circle data-parked="true" cx="190" cy="12" r="4" fill="${P.orangeAccent}" stroke="${P.whiteGlyph}" stroke-width="3"/>`;
}

export function renderDialCellSvg<TSlot extends SurfaceSlotBase>(
  input: DialCellRenderInput<TSlot>
): string {
  const P = PLAYLISTER_PALETTE;
  const t = input.t ?? englishShared;
  const override = (input.labelOverride ?? "").trim();
  const fallbackTitle = override || input.slot?.name || input.slotId || t("cellFaderTitle");

  // 1. Disconnected / error state -> never blank
  if (input.status.kind !== "connected") {
    return renderDialStatusSvg(
      fallbackTitle,
      statusCellReason(input.status, t) || statusSentence(input.status, t),
      P.orangeAccent,
      t
    );
  }

  // 2. Missing slot in state
  const slot = input.slot;
  if (!slot) {
    return renderDialStatusSvg(
      fallbackTitle,
      t("cellSlotNotFound", { slot: input.slotId }),
      P.orangeAccent,
      t
    );
  }

  // 3. Unavailable or profile-disabled slot -> verbatim slot.reason from API-CONTRACT.md
  if (!slot.available) {
    const unavailableReason =
      slot.reason ||
      (slot.target_mode === "unassigned"
        ? t("cellUnassigned")
        : t("cellUnavailableInObs"));
    return renderDialStatusSvg(
      slot.name || slot.id,
      unavailableReason,
      P.orangeAccent,
      t
    );
  }

  // 4. Unassigned slot (available is true) -> "Unassigned, set in OBS"
  if (slot.target_mode === "unassigned") {
    return renderDialStatusSvg(
      slot.name || slot.id,
      t("cellUnassigned"),
      P.trackBorder,
      t
    );
  }

  const clamped = Math.max(0, Math.min(1, slot.value));
  const pct = Math.round(clamped * 100);
  const pctText = t("percent", { n: pct });
  const holdMarkup = input.holdingForLongPress
    ? renderHoldOverlay(input.holdLabel, t)
    : "";
  const parkedMarkup = renderParkedIndicator(slot.parked);

  // 5. Studio Mode T-bar cell (GRAPHICS-NOTES.md #3)
  if (slot.target_mode === "tbar") {
    // Scene names left and right of the centred percent: 66 px each.
    // Scene names 62 px each, a 50 px percent between them, 4 px apart.
    const sceneSize = (name: string): number => [16, 14].find((size) => textWidth(name, size) <= 62) ?? 12;
    const prevRaw = input.previewSceneName || t("cellPreview");
    const progRaw = input.programSceneName || t("cellProgram");
    const prevSize = sceneSize(prevRaw);
    const progSize = sceneSize(progRaw);
    const prevName = fitted(prevRaw, prevSize, 62);
    const progName = fitted(progRaw, progSize, 62);
    const tbarPct = fitted(pctText, 18, 50);
    const inTransition = clamped > 0.001 && clamped < 0.999;
    const borderStroke = inTransition ? P.orangeAccent : P.trackBorder;
    const borderWidth = inTransition ? 4 : 3;
    const barX = 14;
    const barW = 172;
    const fillW = Math.round(barW * clamped);
    const thumbX = Math.max(barX, Math.min(barX + barW - 10, barX + fillW - 5));
    const takeoverSvg = renderTakeoverArrow(
      slot.takeover_pending,
      barX + fillW,
      70
    );

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" data-cell="tbar" data-transition-glow="${inTransition}">`,
      `<defs>`,
      `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
      `<stop offset="0%" stop-color="${P.bgTop}"/>`,
      `<stop offset="100%" stop-color="${P.bgBottom}"/>`,
      `</linearGradient>`,
      `<linearGradient id="tbarGrad" x1="0" y1="0" x2="1" y2="0">`,
      `<stop offset="0%" stop-color="${P.previewGreen}"/>`,
      `<stop offset="50%" stop-color="${P.blueStart}"/>`,
      `<stop offset="100%" stop-color="${P.programRed}"/>`,
      `</linearGradient>`,
      `</defs>`,
      `<rect x="2" y="2" width="196" height="96" rx="10" fill="url(#bg)" stroke="${borderStroke}" stroke-width="${borderWidth}"/>`,
      `<text x="12" y="34" fill="${P.previewGreen}" font-family="${prevName.font}" font-size="${prevSize}" font-weight="800"${prevName.attrs}>${prevName.text}</text>`,
      `<text x="100" y="34" text-anchor="middle" fill="${P.whiteGlyph}" font-family="${tbarPct.font}" font-size="18" font-weight="800"${tbarPct.attrs}>${tbarPct.text}</text>`,
      `<text x="188" y="34" text-anchor="end" fill="${P.programRed}" font-family="${progName.font}" font-size="${progSize}" font-weight="800"${progName.attrs}>${progName.text}</text>`,
      `<rect x="${barX}" y="58" width="${barW}" height="24" rx="8" fill="${P.trackBg}" stroke="${P.trackBorder}" stroke-width="3"/>`,
      fillW > 0
        ? `<rect x="${barX}" y="58" width="${fillW}" height="24" rx="8" fill="url(#tbarGrad)"/>`
        : "",
      `<rect x="${thumbX}" y="52" width="10" height="36" rx="4" fill="${P.orangeAccent}" stroke="${P.whiteGlyph}" stroke-width="3"/>`,
      takeoverSvg,
      parkedMarkup,
      holdMarkup,
      `</svg>`
    ].join("");
  }

  // 6. Crossfade cell with live 96x54 thumbnails (GRAPHICS-NOTES.md #2)
  const useThumbnails =
    slot.target_mode === "crossfade_ab" &&
    (input.showThumbnails ?? true) &&
    Boolean(input.thumbnailA || input.thumbnailB);

  if (useThumbnails) {
    const { colorA, colorB } = getSourcePairGradientColors(
      slot.source_a,
      slot.source_b
    );
    const barX = 14;
    const barW = 172;
    const fillW = Math.round(barW * clamped);
    const knobX = Math.max(
      barX + 6,
      Math.min(barX + barW - 6, barX + fillW)
    );
    const thumbA = input.thumbnailA ? escapeXml(input.thumbnailA) : "";
    const thumbB = input.thumbnailB ? escapeXml(input.thumbnailB) : "";
    const takeoverSvg = renderTakeoverArrow(slot.takeover_pending, knobX, 80);

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" data-cell="crossfade-thumbnails">`,
      `<defs>`,
      `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
      `<stop offset="0%" stop-color="${P.bgTop}"/>`,
      `<stop offset="100%" stop-color="${P.bgBottom}"/>`,
      `</linearGradient>`,
      `<linearGradient id="abGrad" x1="0" y1="0" x2="1" y2="0">`,
      `<stop offset="0%" stop-color="${colorA}"/>`,
      `<stop offset="100%" stop-color="${colorB}"/>`,
      `</linearGradient>`,
      `</defs>`,
      `<rect x="2" y="2" width="196" height="96" rx="10" fill="url(#bg)" stroke="${P.trackBorder}" stroke-width="3"/>`,
      thumbA
        ? `<image data-thumb="a" x="2" y="4" width="96" height="54" preserveAspectRatio="xMidYMid slice" href="${thumbA}"/>`
        : `<rect x="2" y="4" width="96" height="54" fill="${P.trackBg}"/>`,
      `<rect x="2" y="4" width="96" height="54" rx="4" fill="none" stroke="${colorA}" stroke-width="3"/>`,
      thumbB
        ? `<image data-thumb="b" x="102" y="4" width="96" height="54" preserveAspectRatio="xMidYMid slice" href="${thumbB}"/>`
        : `<rect x="102" y="4" width="96" height="54" fill="${P.trackBg}"/>`,
      `<rect x="102" y="4" width="96" height="54" rx="4" fill="none" stroke="${colorB}" stroke-width="3"/>`,
      `<rect x="${barX}" y="68" width="${barW}" height="18" rx="6" fill="url(#abGrad)" stroke="${P.whiteGlyph}" stroke-width="3"/>`,
      `<rect data-knob="true" x="${knobX - 6}" y="62" width="12" height="30" rx="4" fill="${P.orangeAccent}" stroke="${P.whiteGlyph}" stroke-width="3"/>`,
      `<text x="100" y="52" text-anchor="middle" fill="${P.whiteGlyph}" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="800">${escapeXml(pctText)}</text>`,
      takeoverSvg,
      parkedMarkup,
      holdMarkup,
      `</svg>`
    ].join("");
  }

  // 7. Standard Fader or FX/Filter cell with gradient bar, formatted readout & takeover arrow (GRAPHICS-NOTES.md #1)
  const isFxCell = slot.target_mode === "filter_param" || slot.kind === "fx";
  const { colorA, colorB } = isFxCell
    ? { colorA: P.fxCyanStart, colorB: P.fxAmberEnd }
    : getSourcePairGradientColors(slot.source_a, slot.source_b);
  // The readout (Midi Fadester's display_value, verbatim, or our percent) takes
  // the right of the row, up to 80 px; the label gets the rest.
  const rawReadout = input.readoutStyle === "percent" ? pctText : slot.display_value || pctText;
  const readoutFontSize = textWidth(rawReadout, 22) > 72 ? 18 : 22;
  const readout = fitted(rawReadout, readoutFontSize, 80);
  const readoutWidth = Math.min(80, textWidth(fitText(rawReadout, readoutFontSize, 80), readoutFontSize));
  const label = fitted(override || slot.label || slot.name || slot.id, 18, Math.max(60, DIAL_TEXT_WIDTH - readoutWidth - 10));
  const barX = 14;
  const barW = 172;
  const fillW = Math.round(barW * clamped);
  const capX = Math.max(barX, Math.min(barX + barW - 10, barX + fillW - 5));
  const arrowX = Math.max(barX + 10, Math.min(barX + barW - 10, barX + fillW));
  const takeoverSvg = renderTakeoverArrow(slot.takeover_pending, arrowX, 70);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" data-cell="${isFxCell ? "fx" : "fader"}">`,
    `<defs>`,
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="${P.bgTop}"/>`,
    `<stop offset="100%" stop-color="${P.bgBottom}"/>`,
    `</linearGradient>`,
    `<linearGradient id="abGrad" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0%" stop-color="${colorA}"/>`,
    `<stop offset="100%" stop-color="${colorB}"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect x="2" y="2" width="196" height="96" rx="10" fill="url(#bg)" stroke="${P.trackBorder}" stroke-width="3"/>`,
    `<text x="14" y="38" fill="${P.whiteGlyph}" font-family="${label.font}" font-size="18" font-weight="700"${label.attrs}>${label.text}</text>`,
    `<text x="186" y="38" text-anchor="end" fill="${P.whiteGlyph}" font-family="${readout.font}" font-size="${readoutFontSize}" font-weight="800"${readout.attrs}>${readout.text}</text>`,
    `<rect x="${barX}" y="58" width="${barW}" height="24" rx="8" fill="${P.trackBg}" stroke="${P.trackBorder}" stroke-width="3"/>`,
    fillW > 0
      ? `<rect x="${barX}" y="58" width="${fillW}" height="24" rx="8" fill="url(#abGrad)"/>`
      : "",
    `<rect x="${capX}" y="52" width="10" height="36" rx="4" fill="${P.orangeAccent}" stroke="${P.whiteGlyph}" stroke-width="3"/>`,
    takeoverSvg,
    parkedMarkup,
    holdMarkup,
    `</svg>`
  ].join("");
}

function renderKeyStatusSvg(title: string, reason: string, t: Translate): string {
  const P = PLAYLISTER_PALETTE;
  const titleLayout = compactKeyTitle(title, t);
  // The reason (often Midi Fadester's own sentence) gets two lines of 108 px.
  const reasonLines = splitTitle(reason.trim() || t("cellUnavailable"), 11, 108).map((line) => fitted(line, 11, 108));
  const reasonY = titleLayout.secondLine ? 86 : 78;
  const reasonFont = fontFamilyFor(reasonLines.map((line) => line.text).join(""));
  const reasonMarkup = reasonLines.length > 1
    ? `${reasonLines[0].attrs ? `<tspan${reasonLines[0].attrs}>${reasonLines[0].text}</tspan>` : reasonLines[0].text}<tspan x="60" dy="13"${reasonLines[1].attrs}>${reasonLines[1].text}</tspan>`
    : reasonLines[0].text;
  const reasonAttrs = reasonLines.length > 1 ? "" : reasonLines[0].attrs;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-key="status">`,
    `<defs>`,
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="${P.bgTop}"/>`,
    `<stop offset="100%" stop-color="${P.bgBottom}"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect x="3" y="3" width="114" height="114" rx="14" fill="url(#bg)" stroke="${P.orangeAccent}" stroke-width="3"/>`,
    renderCompactKeyTitle(titleLayout, P.whiteGlyph, 46, 34),
    `<text x="60" y="${reasonY}" text-anchor="middle" fill="${P.orangeAccent}" font-family="${reasonFont}" font-size="11" font-weight="700"${reasonAttrs}>${reasonMarkup}</text>`,
    `</svg>`
  ].join("");
}

export function renderAutoFadeKeySvg<TSlot extends SurfaceSlotBase>(
  input: KeyCellRenderInput<TSlot>
): string {
  const P = PLAYLISTER_PALETTE;
  const t = input.t ?? englishShared;
  const isAllFx = input.slotId === "__all_fx__";
  const override = (input.labelOverride ?? "").trim();
  const fallbackTitle =
    override || (isAllFx ? t("cleanFxTitle") : input.slot?.name || input.slotId || t("cellAutoFadeTitle"));

  if (input.status.kind !== "connected") {
    return renderKeyStatusSvg(
      fallbackTitle,
      statusCellReason(input.status, t) || statusSentence(input.status, t),
      t
    );
  }

  if (isAllFx) {
    const slotList = input.slots ?? [];
    const hasFxSupport = slotList.some((s) => s.kind === "fx");
    if (!hasFxSupport) {
      return renderKeyStatusSvg(t("cleanFxTitle"), t("cleanFxNeedsUpdate"), t);
    }

    const eligible = slotList.filter(isResetFxEligible);
    const activeCount = eligible.filter((s) => s.value > 0.005).length;
    const borderColor = activeCount > 0 ? P.orangeAccent : P.previewGreen;
    const line1 = fitted(override || (activeCount > 0 ? t("cleanFxActiveTitle") : t("cleanFxIdleTitle")), 16, KEY_TEXT_WIDTH);
    const line2 = fitted(activeCount > 0 ? t("cleanFxActiveCount", { n: activeCount }) : t("cleanFxAllZero"), 15, KEY_TEXT_WIDTH);

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-key="clean-fx" data-active-fx="${activeCount}">`,
      `<defs>`,
      `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
      `<stop offset="0%" stop-color="${P.bgTop}"/>`,
      `<stop offset="100%" stop-color="${P.bgBottom}"/>`,
      `</linearGradient>`,
      `</defs>`,
      `<rect x="3" y="3" width="114" height="114" rx="14" fill="url(#bg)" stroke="${borderColor}" stroke-width="3"/>`,
      `<text x="60" y="50" text-anchor="middle" fill="${P.whiteGlyph}" font-family="${line1.font}" font-size="16" font-weight="800"${line1.attrs}>${line1.text}</text>`,
      `<text x="60" y="80" text-anchor="middle" fill="${borderColor}" font-family="${line2.font}" font-size="15" font-weight="800"${line2.attrs}>${line2.text}</text>`,
      `</svg>`
    ].join("");
  }

  const slot = input.slot;
  if (!slot) {
    return renderKeyStatusSvg(fallbackTitle, t("cellSlotMissing"), t);
  }
  if (!slot.available) {
    const unavailableReason =
      slot.reason ||
      (slot.target_mode === "unassigned"
        ? t("cellUnassigned")
        : t("cellUnavailable"));
    return renderKeyStatusSvg(slot.name || slot.id, unavailableReason, t);
  }
  if (slot.target_mode === "unassigned") {
    return renderKeyStatusSvg(slot.name || slot.id, t("cellUnassigned"), t);
  }

  const clamped = Math.max(0, Math.min(1, slot.value));
  const pct = Math.round(clamped * 100);
  const pctText = t("percent", { n: pct });
  const isFxSlot = slot.target_mode === "filter_param" || slot.kind === "fx";
  const gradStart = isFxSlot ? P.fxCyanStart : P.blueStart;
  const gradEnd = isFxSlot ? P.fxAmberEnd : P.violetEnd;
  const titleLayout = compactKeyTitle(
    override || slot.label || slot.name || slot.id,
    t
  );
  const rawReadout = input.readoutStyle === "percent" ? pctText : slot.display_value || pctText;
  const readoutFontSize = textWidth(rawReadout, 28) > KEY_TEXT_WIDTH ? 20 : 28;
  const readout = fitted(rawReadout, readoutFontSize, KEY_TEXT_WIDTH);
  const barX = 14;
  const barW = 92;
  const fillW = Math.round(barW * clamped);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-key="auto-fade">`,
    `<defs>`,
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="${P.bgTop}"/>`,
    `<stop offset="100%" stop-color="${P.bgBottom}"/>`,
    `</linearGradient>`,
    `<linearGradient id="ab" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0%" stop-color="${gradStart}"/>`,
    `<stop offset="100%" stop-color="${gradEnd}"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect x="3" y="3" width="114" height="114" rx="14" fill="url(#bg)" stroke="${P.trackBorder}" stroke-width="3"/>`,
    renderCompactKeyTitle(titleLayout, P.mutedText, 32, 24),
    `<text x="60" y="72" text-anchor="middle" fill="${P.whiteGlyph}" font-family="${readout.font}" font-size="${readoutFontSize}" font-weight="800"${readout.attrs}>${readout.text}</text>`,
    `<rect x="${barX}" y="90" width="${barW}" height="16" rx="6" fill="${P.trackBg}" stroke="${P.trackBorder}" stroke-width="3"/>`,
    fillW > 0
      ? `<rect x="${barX}" y="90" width="${fillW}" height="16" rx="6" fill="url(#ab)"/>`
      : "",
    `</svg>`
  ].join("");
}
