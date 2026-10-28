// SPDX-License-Identifier: GPL-2.0-or-later
import { ConnectionStatusInfo, SurfaceSlotBase } from "./types.js";
import { PLAYLISTER_PALETTE, getSourcePairGradientColors } from "./palette.js";
import { isResetFxEligible } from "./fx-policy.js";

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
}

export function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function truncateLabel(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  return clean.slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
}

export function toSvgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function renderDialStatusSvg(
  title: string,
  reason: string,
  borderColor: string
): string {
  const safeTitle = escapeXml(truncateLabel(title || "Fadester", 18));
  const safeReason = escapeXml(truncateLabel(reason || "Unavailable", 26));
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
    `<text x="14" y="38" fill="${P.whiteGlyph}" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="700">${safeTitle}</text>`,
    `<text x="14" y="70" fill="${P.orangeAccent}" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="700">${safeReason}</text>`,
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

function renderHoldOverlay(label = "HOLD 3s FADE"): string {
  const P = PLAYLISTER_PALETTE;
  const safeLabel = escapeXml(truncateLabel(label || "HOLD 3s FADE", 15));
  const boxW = safeLabel.length > 12 ? 128 : 112;
  const boxX = Math.round((200 - boxW) / 2);
  return [
    `<rect data-hold-indicator="true" x="3" y="3" width="194" height="94" rx="10" fill="none" stroke="${P.orangeAccent}" stroke-width="4"/>`,
    `<rect x="${boxX}" y="6" width="${boxW}" height="24" rx="6" fill="${P.orangeAccent}" stroke="${P.whiteGlyph}" stroke-width="3"/>`,
    `<text x="100" y="23" text-anchor="middle" fill="${P.bgTop}" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="800">${safeLabel}</text>`
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
  const override = (input.labelOverride ?? "").trim();
  const fallbackTitle = override || input.slot?.name || input.slotId || "Fader";

  // 1. Disconnected / error state -> never blank
  if (input.status.kind !== "connected") {
    return renderDialStatusSvg(
      fallbackTitle,
      input.status.cellReason || input.status.sentence,
      P.orangeAccent
    );
  }

  // 2. Missing slot in state
  const slot = input.slot;
  if (!slot) {
    return renderDialStatusSvg(
      fallbackTitle,
      `Slot '${input.slotId}' not found`,
      P.orangeAccent
    );
  }

  // 3. Unavailable or profile-disabled slot -> verbatim slot.reason from API-CONTRACT.md
  if (!slot.available) {
    const unavailableReason =
      slot.reason ||
      (slot.target_mode === "unassigned"
        ? "Unassigned, set in OBS"
        : "Unavailable in OBS");
    return renderDialStatusSvg(
      slot.name || slot.id,
      unavailableReason,
      P.orangeAccent
    );
  }

  // 4. Unassigned slot (available is true) -> "Unassigned, set in OBS"
  if (slot.target_mode === "unassigned") {
    return renderDialStatusSvg(
      slot.name || slot.id,
      "Unassigned, set in OBS",
      P.trackBorder
    );
  }

  const clamped = Math.max(0, Math.min(1, slot.value));
  const pct = Math.round(clamped * 100);
  const pctText = `${pct}%`;
  const holdMarkup = input.holdingForLongPress
    ? renderHoldOverlay(input.holdLabel)
    : "";
  const parkedMarkup = renderParkedIndicator(slot.parked);

  // 5. Studio Mode T-bar cell (GRAPHICS-NOTES.md #3)
  if (slot.target_mode === "tbar") {
    const prevName = escapeXml(
      truncateLabel(input.previewSceneName || "Preview", 10)
    );
    const progName = escapeXml(
      truncateLabel(input.programSceneName || "Program", 10)
    );
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
      `<text x="12" y="34" fill="${P.previewGreen}" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="800">${prevName}</text>`,
      `<text x="100" y="34" text-anchor="middle" fill="${P.whiteGlyph}" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="800">${pctText}</text>`,
      `<text x="188" y="34" text-anchor="end" fill="${P.programRed}" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="800">${progName}</text>`,
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
      `<text x="100" y="52" text-anchor="middle" fill="${P.whiteGlyph}" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="800">${pctText}</text>`,
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
  const displayLabel = escapeXml(
    truncateLabel(override || slot.label || slot.name || slot.id, 14)
  );
  const readoutText = escapeXml(
    truncateLabel(
      input.readoutStyle === "percent" ? pctText : slot.display_value || pctText,
      10
    )
  );
  const readoutFontSize = readoutText.length > 6 ? 18 : 22;
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
    `<text x="14" y="38" fill="${P.whiteGlyph}" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="700">${displayLabel}</text>`,
    `<text x="186" y="38" text-anchor="end" fill="${P.whiteGlyph}" font-family="Segoe UI, Arial, sans-serif" font-size="${readoutFontSize}" font-weight="800">${readoutText}</text>`,
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

function renderKeyStatusSvg(title: string, reason: string): string {
  const P = PLAYLISTER_PALETTE;
  const safeTitle = escapeXml(truncateLabel(title || "Auto-fade", 16));
  const safeReason = escapeXml(truncateLabel(reason || "Unavailable", 40));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-key="status">`,
    `<defs>`,
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="${P.bgTop}"/>`,
    `<stop offset="100%" stop-color="${P.bgBottom}"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect x="3" y="3" width="114" height="114" rx="14" fill="url(#bg)" stroke="${P.orangeAccent}" stroke-width="3"/>`,
    `<text x="60" y="46" text-anchor="middle" fill="${P.whiteGlyph}" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="700">${safeTitle}</text>`,
    `<text x="60" y="78" text-anchor="middle" fill="${P.orangeAccent}" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-weight="700">${safeReason}</text>`,
    `</svg>`
  ].join("");
}

export function renderAutoFadeKeySvg<TSlot extends SurfaceSlotBase>(
  input: KeyCellRenderInput<TSlot>
): string {
  const P = PLAYLISTER_PALETTE;
  const isAllFx = input.slotId === "__all_fx__";
  const override = (input.labelOverride ?? "").trim();
  const fallbackTitle =
    override || (isAllFx ? "Clean FX" : input.slot?.name || input.slotId || "Auto-fade");

  if (input.status.kind !== "connected") {
    return renderKeyStatusSvg(
      fallbackTitle,
      input.status.cellReason || input.status.sentence
    );
  }

  if (isAllFx) {
    const slotList = input.slots ?? [];
    const hasFxSupport = slotList.some((s) => s.kind === "fx");
    if (!hasFxSupport) {
      return renderKeyStatusSvg("Clean FX", "Update Midi Fadester to 0.4.0");
    }

    const eligible = slotList.filter(isResetFxEligible);
    const activeCount = eligible.filter((s) => s.value > 0.005).length;
    const borderColor = activeCount > 0 ? P.orangeAccent : P.previewGreen;
    const line1 = escapeXml(
      truncateLabel(override || (activeCount > 0 ? "CLEAN FX" : "FX CLEAN"), 10)
    );
    const line2 = activeCount > 0 ? `${activeCount} ACTIVE` : "ALL 0%";

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" data-key="clean-fx" data-active-fx="${activeCount}">`,
      `<defs>`,
      `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
      `<stop offset="0%" stop-color="${P.bgTop}"/>`,
      `<stop offset="100%" stop-color="${P.bgBottom}"/>`,
      `</linearGradient>`,
      `</defs>`,
      `<rect x="3" y="3" width="114" height="114" rx="14" fill="url(#bg)" stroke="${borderColor}" stroke-width="3"/>`,
      `<text x="60" y="50" text-anchor="middle" fill="${P.whiteGlyph}" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="800">${line1}</text>`,
      `<text x="60" y="80" text-anchor="middle" fill="${borderColor}" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="800">${line2}</text>`,
      `</svg>`
    ].join("");
  }

  const slot = input.slot;
  if (!slot) {
    return renderKeyStatusSvg(fallbackTitle, "Slot missing");
  }
  if (!slot.available) {
    const unavailableReason =
      slot.reason ||
      (slot.target_mode === "unassigned"
        ? "Unassigned, set in OBS"
        : "Unavailable");
    return renderKeyStatusSvg(slot.name || slot.id, unavailableReason);
  }
  if (slot.target_mode === "unassigned") {
    return renderKeyStatusSvg(slot.name || slot.id, "Unassigned, set in OBS");
  }

  const clamped = Math.max(0, Math.min(1, slot.value));
  const pct = Math.round(clamped * 100);
  const pctText = `${pct}%`;
  const isFxSlot = slot.target_mode === "filter_param" || slot.kind === "fx";
  const gradStart = isFxSlot ? P.fxCyanStart : P.blueStart;
  const gradEnd = isFxSlot ? P.fxAmberEnd : P.violetEnd;
  const title = escapeXml(
    truncateLabel(override || slot.label || slot.name || slot.id, 10)
  );
  const readoutText = escapeXml(
    truncateLabel(
      input.readoutStyle === "percent" ? pctText : slot.display_value || pctText,
      10
    )
  );
  const readoutFontSize = readoutText.length > 5 ? 20 : 28;
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
    `<text x="60" y="32" text-anchor="middle" fill="${P.mutedText}" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="700">${title}</text>`,
    `<text x="60" y="72" text-anchor="middle" fill="${P.whiteGlyph}" font-family="Segoe UI, Arial, sans-serif" font-size="${readoutFontSize}" font-weight="800">${readoutText}</text>`,
    `<rect x="${barX}" y="90" width="${barW}" height="16" rx="6" fill="${P.trackBg}" stroke="${P.trackBorder}" stroke-width="3"/>`,
    fillW > 0
      ? `<rect x="${barX}" y="90" width="${fillW}" height="16" rx="6" fill="url(#ab)"/>`
      : "",
    `</svg>`
  ].join("");
}
