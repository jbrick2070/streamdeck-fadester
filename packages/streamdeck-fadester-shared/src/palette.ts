// SPDX-License-Identifier: GPL-2.0-or-later

export const PLAYLISTER_PALETTE = {
  bgTop: "#08070B",
  bgBottom: "#0D0913",
  trackBg: "#24152F",
  trackBorder: "#68418C",
  accentPurple: "#9146FF",
  accentYellow: "#FFF04B",
  // Keep the shared property names compatible with the optional MIDI renderer.
  blueStart: "#9146FF",
  violetEnd: "#C084FC",
  fxCyanStart: "#BF73FF",
  fxAmberEnd: "#FFF04B",
  whiteGlyph: "#FAF7FF",
  mutedText: "#CFC0DF",
  orangeAccent: "#F97316",
  orangeDeep: "#D97706",
  previewGreen: "#22C55E",
  programRed: "#EF4444",
  minStrokePx: 3
} as const;

const SOURCE_A_PALETTE = ["#9146FF", "#A855F7", "#9333EA", "#8B3DF0"] as const;
const SOURCE_B_PALETTE = ["#C084FC", "#E879F9", "#D8B4FE", "#D946EF"] as const;

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
