// SPDX-License-Identifier: GPL-2.0-or-later

export const PLAYLISTER_PALETTE = {
  bgTop: "#0B1020",
  bgBottom: "#111827",
  trackBg: "#1E293B",
  trackBorder: "#334155",
  blueStart: "#2563EB",
  violetEnd: "#7C3AED",
  whiteGlyph: "#F8FAFC",
  mutedText: "#CBD5E1",
  orangeAccent: "#F97316",
  orangeDeep: "#D97706",
  previewGreen: "#22C55E",
  programRed: "#EF4444",
  minStrokePx: 3
} as const;

const SOURCE_A_PALETTE = ["#2563EB", "#0284C7", "#0EA5E9", "#3B82F6"] as const;
const SOURCE_B_PALETTE = ["#7C3AED", "#9333EA", "#6366F1", "#8B5CF6"] as const;

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function getSourcePairGradientColors(
  sourceA?: string,
  sourceB?: string
): { colorA: string; colorB: string } {
  if (!sourceA && !sourceB) {
    return {
      colorA: PLAYLISTER_PALETTE.blueStart,
      colorB: PLAYLISTER_PALETTE.violetEnd
    };
  }
  const colorA = sourceA
    ? SOURCE_A_PALETTE[hashName(sourceA) % SOURCE_A_PALETTE.length]
    : PLAYLISTER_PALETTE.blueStart;
  const colorB = sourceB
    ? SOURCE_B_PALETTE[hashName(sourceB) % SOURCE_B_PALETTE.length]
    : PLAYLISTER_PALETTE.violetEnd;
  return { colorA, colorB };
}
