// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Width estimates for text drawn on keys and dials (R-I18N-4). Stream Deck
 * draws the SVG itself with whatever fonts the computer has, so widths are
 * estimated, not measured: a little above Segoe UI Bold's real widths for
 * Latin, Greek and Cyrillic, one em for CJK ideographs, kana and Hangul.
 */

/** CJK ideographs, kana, Hangul, bopomofo and full-width forms: about one em wide each. */
const WIDE = /[ᄀ-ᇿ⺀-〿぀-ヿ㄀-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-퟿豈-﫿︐-︟︰-﹏＀-｠￠-￦]|[\u{20000}-\u{3134f}]/u;

/** Whether the text has CJK, kana or Hangul in it. */
export function hasWide(value: string): boolean {
  return WIDE.test(value);
}

/** One character's estimated width in em. */
function charEm(ch: string): number {
  if (WIDE.test(ch)) return 1;
  if (/\p{M}/u.test(ch)) return 0;
  if (/\s/u.test(ch)) return 0.3;
  if (/[ilIjtfr!.,:;'|·()[\]/]/u.test(ch)) return 0.36;
  if (/[mwMW@%…—]/u.test(ch)) return 0.95;
  if (/\p{Lu}/u.test(ch)) return 0.74;
  if (/[0-9]/u.test(ch)) return 0.6;
  return 0.6;
}

/** Estimated width in em of `value` (capitals of any script, accented or not, as capitals). */
export function textEm(value: string): number {
  let em = 0;
  for (const ch of value) em += charEm(ch);
  return em;
}

/** Estimated width in px at `fontSize`. */
export function textWidth(value: string, fontSize: number): number {
  return textEm(value) * fontSize;
}

/**
 * How far `textLength` may squeeze a text into its box before the text is
 * shortened instead; also the bound the fit test holds our own words to.
 */
export const MIN_SQUEEZE = 0.8;

/** Whether a text fits its box at this size, squeezed at most to MIN_SQUEEZE. */
export function fitsBox(value: string, fontSize: number, maxWidth: number): boolean {
  return textWidth(value, fontSize) * MIN_SQUEEZE <= maxWidth;
}

/**
 * Shortens by width, not by character count: a text that fits (squeezed at
 * most to MIN_SQUEEZE) is kept whole; a longer one, such as an OBS scene
 * name, is cut with "…" so the rest fits. At least one character stays.
 */
export function fitText(raw: string, fontSize: number, maxWidth: number): string {
  const text = raw.trim();
  if (fitsBox(text, fontSize, maxWidth)) return text;
  const chars = [...text];
  for (let n = chars.length - 1; n > 1; n -= 1) {
    const shorter = `${chars.slice(0, n).join("").trimEnd()}…`;
    if (fitsBox(shorter, fontSize, maxWidth)) return shorter;
  }
  return `${chars[0] ?? ""}…`;
}

/** SVG attributes that squeeze a text wider than its box into it. */
export function textFitAttributes(text: string, maxWidth: number, fontSize: number): string {
  return textWidth(text, fontSize) > maxWidth ? `textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : "";
}

const CJK_HANGUL = /[ᄀ-ᇿꥠ-꥿가-퟿]/u;
const CJK_KANA = /[぀-ヿ]/u;

/**
 * The font list for a text: the Latin list as given, or for CJK text Windows'
 * UI font for the script it shows (Hangul, kana, else Chinese), then the
 * others, as VJster does. Ideographs alone cannot tell Japanese from Chinese;
 * they get the Chinese fonts first.
 */
export function fontFamilyFor(value: string, latin = "Segoe UI, Arial, sans-serif"): string {
  if (!hasWide(value)) return latin;
  if (CJK_HANGUL.test(value)) return "Segoe UI, Malgun Gothic, Yu Gothic UI, Microsoft YaHei UI, Microsoft JhengHei UI, sans-serif";
  if (CJK_KANA.test(value)) return "Segoe UI, Yu Gothic UI, Microsoft YaHei UI, Microsoft JhengHei UI, Malgun Gothic, sans-serif";
  return "Segoe UI, Microsoft YaHei UI, Microsoft JhengHei UI, Yu Gothic UI, Malgun Gothic, sans-serif";
}

/**
 * Splits a title into at most two lines that fit `maxWidth` at `fontSize`:
 * at a space when it has spaces, CJK also between characters. Returns one
 * line when it fits unsqueezed, or when it is one long Latin word (then fitted).
 */
export function splitTitle(raw: string, fontSize: number, maxWidth: number): string[] {
  const title = raw.trim().replace(/\s+/g, " ");
  if (textWidth(title, fontSize) <= maxWidth) return [title];
  const words = title.split(" ");
  let best: string[] | undefined;
  let bestWidth = Infinity;
  const consider = (first: string, second: string): void => {
    const width = Math.max(textWidth(first, fontSize), textWidth(second, fontSize));
    if (first && second && width < bestWidth) { best = [first, second]; bestWidth = width; }
  };
  if (words.length > 1) {
    for (let i = 1; i < words.length; i += 1) consider(words.slice(0, i).join(" "), words.slice(i).join(" "));
  }
  if (!best || !fitsBox(best[0], fontSize, maxWidth) || !fitsBox(best[1], fontSize, maxWidth)) {
    const chars = [...title];
    // Only CJK text breaks between characters; a long Latin word stays whole (and is fitted).
    if (hasWide(title)) {
      for (let i = 1; i < chars.length; i += 1) consider(chars.slice(0, i).join("").trimEnd(), chars.slice(i).join("").trimStart());
    }
  }
  if (!best) return [fitText(title, fontSize, maxWidth)];
  return [fitText(best[0], fontSize, maxWidth), fitText(best[1], fontSize, maxWidth)];
}
