// SPDX-License-Identifier: GPL-2.0-or-later
// Each language's verbs for "take". The owner's rule: no product names its own actions with one (sending Preview to
// Program is "Preview to Program", a fade or a cut). The plugin's tables and the Companion's are both read against
// these; ordinary uses ("takes over the link", "undo" in Turkish) are allowed by key where they occur.
//
// Compounds that mean something else are not matched: German "übernehmen" (apply), "annimmt" and "angenommen" (accepts, accepted),
// Russian "выбрать" (choose), Italian "aprendo" (opening).
export const TAKE_VERBS: Record<string, RegExp> = {
  en: /(?<!\p{L})(take|takes|taking|taken|took)(?!\p{L})/iu,
  de: /(?<!über)nehm|(?<!über|an)nimm|(?<!an)genommen/iu,
  fr: /(?<!\p{L})(prend|prenn|prenez|prise?s?(?!\p{L}))/iu,
  es: /(?<!\p{L})(tom(ar|a|e|an|en|ó)|cog(er|e|a)|coj[ao])(?!\p{L})/iu,
  nl: /(?<!\p{L})(nemen|neem|neemt|genomen|overnemen|overneemt)(?!\p{L})/iu,
  it: /(?<!\p{L})(prend|pres[oa](?!\p{L})|pigli)/iu,
  pt_BR: /(?<!\p{L})(tom(ar|e|a)|peg(ar|ue|a)|lev(ar|e|a))(?!\p{L})/iu,
  ru: /(?<!\p{L})(взять|возьм|бер[её]т|берит|брать|взят)/iu,
  tr: /(?<!\p{L})al(ın|ınız|ır|mak|ıyor)?(?!\p{L})/iu,
  ja: /テイク/u,
  ko: /테이크/u,
  zh_CN: /(?<!\p{L})take(?!\p{L})/iu,
  zh_TW: /(?<!\p{L})take(?!\p{L})/iu
};
