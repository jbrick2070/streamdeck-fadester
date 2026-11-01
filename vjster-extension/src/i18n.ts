// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension texts (docs/vjster/REQUIREMENTS.md R-I18N-1, R-I18N-3;
// PLAN.md 8.5). Chrome picks the language from `_locales/<lang>/messages.json`
// and falls back to English (`default_locale`); this module only puts the
// messages into the options page. No `chrome.*` here, so it is tested with a
// stand-in `getMessage` (R-TST-3).

/** chrome.i18n.getMessage: the message, with `$1`... filled, or "" when there is none. */
export type GetMessage = (name: string, substitutions?: string[]) => string;

/** The parts of the options page's document this module touches. */
export interface PageLike {
  readonly documentElement: { setAttribute(name: string, value: string): void };
  querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null; textContent: string | null }>;
}

/** A message, or `fallback` when Chrome has none (an empty result). */
export function message(get: GetMessage, name: string, substitutions: string[] = [], fallback = name): string {
  const text = get(name, substitutions);
  return text === "" ? fallback : text;
}

/** Put every `data-i18n` element of the page in Chrome's language; one without a message keeps its English text. */
export function translatePage(doc: PageLike, get: GetMessage): void {
  const lang = get("htmlLang");
  if (lang !== "") doc.documentElement.setAttribute("lang", lang);
  const nodes = doc.querySelectorAll("[data-i18n]");
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const name = node.getAttribute("data-i18n");
    if (name === null) continue;
    const text = get(name);
    if (text !== "") node.textContent = text;
  }
}
