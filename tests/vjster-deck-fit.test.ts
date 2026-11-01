// SPDX-License-Identifier: GPL-2.0-or-later
// Every deck word fits its box in every language (docs/vjster/REQUIREMENTS.md
// R-I18N-4; PLAN.md 8.2). The widths are display.ts's own estimate, so the
// test and the drawing agree; a real Stream Deck may differ for CJK, which is
// a manual check (TESTING.md). Composed captions (`OBS {word}`) and both header
// texts together are measured, not single words.
import { describe, expect, it } from "vitest";
import {
  CAPTION_MAX,
  captionSize,
  fontsFor,
  headerLabel,
  mainSize,
  STATUS,
  STATUS_WORD,
  statusSize,
  STRIP_VALUE,
  textEm,
  textWidth
} from "../src/vjster/plugin/display.js";
import { DECK_KEYS, fill, stringsFrom, type DeckKey, type Strings } from "../src/vjster/plugin/strings.js";
import { deckTables } from "./vjster-languages.js";

/** Where each deck word is drawn. A new word without a box fails the first test. */
const BOX: Readonly<Record<DeckKey, "status" | "tag" | "value" | "label" | "caption" | "glyph caption" | "template">> = {
  statusPortInUse: "status",
  statusExtensionOff: "status",
  statusPageOff: "status",
  statusNoVideo: "status",
  statusNotAvailable: "status",
  statusAd: "status",
  tagWeb: "tag",
  tagObs: "tag",
  tagAd: "tag",
  tagExt: "tag",
  tagAuto: "tag",
  tagFixed: "tag",
  auto: "value",
  speed: "label",
  fxSpeed: "label",
  quality: "label",
  nudge: "label",
  sync: "label",
  pinned: "glyph caption",
  pinTab: "glyph caption",
  playing: "glyph caption",
  paused: "glyph caption",
  captionObs: "template",
  captionSync: "template"
};

/** Labels the bundled profiles store that are kept as they are (strings.ts). */
const KEPT_LABELS = ["CHROME", "OBS", "CHROME FX"];
/** Rates a speed-step key shows in its caption. */
const RATES = ["0.05x", "0.25x", "1.25x", "16x"];

/** Every way a word is put on a key: alone, and in the OBS and SYNC captions. */
const captions = (s: Strings, word: string): string[] => [word, fill(s.captionObs, { word }), fill(s.captionSync, { word })];

/** What does not fit, as readable lines; empty when everything fits. */
function misfits(s: Strings): string[] {
  const out: string[] = [];
  for (const code of Object.keys(STATUS_WORD) as (keyof typeof STATUS_WORD)[]) {
    const word = s[STATUS_WORD[code]];
    if (statusSize(word) === null) out.push(`status ${code} "${word}" is ${textWidth(word, STATUS.sizes[STATUS.sizes.length - 1], STATUS.spacing).toFixed(0)} px at the smallest size, room ${STATUS.width}`);
  }
  if (textWidth(s.auto, STRIP_VALUE.size) > STRIP_VALUE.width) out.push(`strip value "${s.auto}" is too wide`);
  if (mainSize(s.auto) === null) out.push(`key main "${s.auto}" does not fit a key`);
  const labels = [s.speed, s.fxSpeed, s.quality, s.nudge, s.sync, ...KEPT_LABELS];
  const tags = [s.tagWeb, s.tagObs, s.tagAd, s.tagExt, s.tagAuto, s.tagFixed];
  for (const label of labels) for (const tag of tags) if (headerLabel(label, tag) !== label) out.push(`header "${label}" beside "${tag}" is cut`);
  for (const word of [s.speed, s.fxSpeed, s.quality, ...RATES]) {
    for (const c of captions(s, word)) if (captionSize(c, CAPTION_MAX.main) === null) out.push(`key caption "${c}" does not fit`);
  }
  for (const word of [s.pinned, s.pinTab, s.playing, s.paused]) {
    for (const c of captions(s, word)) if (captionSize(c, CAPTION_MAX.glyph) === null) out.push(`glyph key caption "${c}" does not fit`);
  }
  return out;
}

describe("deck words fit their boxes (R-I18N-4)", () => {
  it("gives every deck word a box", () => {
    expect(Object.keys(BOX).sort()).toEqual([...DECK_KEYS].sort());
  });

  for (const { lang, strings } of deckTables()) {
    it(`fits every word of ${lang}`, () => {
      expect(misfits(strings)).toEqual([]);
    });
  }

  it("catches a word that would not fit", () => {
    const long = stringsFrom((k) => (k === "statusAd" ? "WERBUNG LAEUFT GERADE NOCH" : k === "tagAuto" ? "AUTOMATISCH" : k === "playing" ? "WIEDERGABE LAEUFT" : undefined));
    const found = misfits(long);
    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringContaining('status ad "WERBUNG LAEUFT GERADE NOCH"'),
        'header "FX SPEED" beside "AUTOMATISCH" is cut',
        'glyph key caption "SYNC WIEDERGABE LAEUFT" does not fit'
      ])
    );
    expect(found.every((line) => /WERBUNG|AUTOMATISCH|WIEDERGABE/.test(line))).toBe(true);
  });

  it("measures CJK, kana, Hangul and accented capitals at their real widths", () => {
    expect(textEm("再生中")).toBe(3);
    expect(textEm("一時停止")).toBe(4);
    expect(textEm("재생")).toBe(2);
    expect(textEm("ピン")).toBe(2);
    expect(textEm("ÄÖÜ")).toBeCloseTo(3 * 0.72);
    expect(textEm("ÉTAPE")).toBeCloseTo(textEm("ETAPE"));
    expect(textEm("SKORÓ")).toBeCloseTo(textEm("SKORO"));
    // No letter spacing on CJK text, and a CJK font list for it.
    expect(textWidth("再生中", 10, 1)).toBe(30);
    expect(textWidth("ABC", 10, 1)).toBeCloseTo(3 * 7.2 + 3);
    expect(fontsFor("SPEED")).toBe("Segoe UI, Arial, sans-serif");
    expect(fontsFor("재생")).toMatch(/^Segoe UI, Malgun Gothic,/);
    expect(fontsFor("ピン留め")).toMatch(/^Segoe UI, Yu Gothic UI,/);
    expect(fontsFor("速度")).toMatch(/^Segoe UI, Microsoft YaHei UI,/);
  });
});
