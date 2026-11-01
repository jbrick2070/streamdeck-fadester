// SPDX-License-Identifier: GPL-2.0-or-later
// The inspectors' translator. scripts/generate-ui-i18n.ts wraps this body,
// with TABLES (each language file's Localization.pi), into ui/i18n.js.
/* global TABLES, window, document */
var LANGUAGES = ["en", "de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW"];
var EN = TABLES.en || {};
var active = EN;
var language = "en";

function placeholders(text) {
  var names = [];
  String(text).replace(/\{([A-Za-z0-9_]+)\}/g, function (whole, name) {
    if (names.indexOf(name) === -1) names.push(name);
    return whole;
  });
  return names.sort().join(",");
}

/** The active language's text, or English when it is missing, empty, the key itself or has other placeholders. */
function lookup(key) {
  var english = EN[key];
  if (typeof english !== "string") return key;
  var candidate = active[key];
  if (typeof candidate !== "string" || !candidate.trim() || candidate === key) return english;
  return placeholders(candidate) === placeholders(english) ? candidate : english;
}

function fill(template, params) {
  if (!params) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, function (whole, name) {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole;
  });
}

function t(key, params) {
  return fill(lookup(key), params);
}

/** One/many pair: `<base>One` for 1, `<base>Many` otherwise; `count` is filled in. */
function plural(base, count, params) {
  var all = {};
  var name;
  for (name in params || {}) if (Object.prototype.hasOwnProperty.call(params, name)) all[name] = params[name];
  all.count = count;
  return t(count === 1 ? base + "One" : base + "Many", all);
}

/** Stream Deck's language, mapped as the plugin maps it (src/i18n/load.ts). */
function normalize(raw) {
  var value = typeof raw === "string" ? raw.trim().replace(/-/g, "_") : "";
  var lower = value.toLowerCase();
  for (var i = 0; i < LANGUAGES.length; i += 1) if (LANGUAGES[i].toLowerCase() === lower) return LANGUAGES[i];
  if (/^zh_(hant|hk|mo)/.test(lower)) return "zh_TW";
  if (lower === "zh" || lower.indexOf("zh_") === 0) return "zh_CN";
  var base = lower.split("_")[0];
  return LANGUAGES.indexOf(base) !== -1 ? base : "en";
}

function number(value, digits) {
  try {
    return new Intl.NumberFormat(language.replace("_", "-"), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(value);
  } catch (error) {
    return Number(value).toFixed(digits);
  }
}

/**
 * Fills static texts below `root`: `data-i18n` (text; an element with
 * `data-slot` children keeps them where the template has `{slot}`),
 * `data-i18n-placeholder`, `data-i18n-label` (optgroup) and `data-i18n-aria-label`.
 */
function apply(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  var i;
  var texts = root.querySelectorAll("[data-i18n]");
  for (i = 0; i < texts.length; i += 1) applyText(texts[i]);
  var attributes = [["data-i18n-placeholder", "placeholder"], ["data-i18n-label", "label"], ["data-i18n-aria-label", "aria-label"]];
  for (var a = 0; a < attributes.length; a += 1) {
    var nodes = root.querySelectorAll("[" + attributes[a][0] + "]");
    for (i = 0; i < nodes.length; i += 1) nodes[i].setAttribute(attributes[a][1], t(nodes[i].getAttribute(attributes[a][0])));
  }
}

// A `data-i18n` element holds text only, or text and `data-slot` children; other child elements would be replaced.
function applyText(element) {
  var text = t(element.getAttribute("data-i18n"));
  var slots = {};
  var hasSlots = false;
  for (var c = 0; c < element.children.length; c += 1) {
    var child = element.children[c];
    if (child.getAttribute("data-slot")) {
      slots[child.getAttribute("data-slot")] = child;
      hasSlots = true;
    }
  }
  if (!hasSlots) {
    element.textContent = text;
    return;
  }
  while (element.firstChild) element.removeChild(element.firstChild);
  var parts = text.split(/(\{[A-Za-z0-9_]+\})/);
  for (var p = 0; p < parts.length; p += 1) {
    var match = /^\{([A-Za-z0-9_]+)\}$/.exec(parts[p]);
    if (match && slots[match[1]]) element.appendChild(slots[match[1]]);
    else if (parts[p]) element.appendChild(document.createTextNode(parts[p]));
  }
}

/** Sets the language, `<html lang>`, and refills the page's static texts. */
function setLanguage(raw) {
  language = normalize(raw);
  active = TABLES[language] || EN;
  if (typeof document !== "undefined" && document && document.documentElement) {
    document.documentElement.lang = language.replace("_", "-");
    apply(document);
  }
  return language;
}

/** The language from Stream Deck's `inInfo` (a JSON string or object), English when it has none. */
function languageFromInfo(inInfo) {
  try {
    var info = typeof inInfo === "string" ? JSON.parse(inInfo || "{}") : inInfo || {};
    return info && info.application ? info.application.language : "en";
  } catch (error) {
    return "en";
  }
}

window.FadesterI18n = {
  t: t,
  plural: plural,
  number: number,
  apply: apply,
  setLanguage: setLanguage,
  languageFromInfo: languageFromInfo,
  language: function () { return language; }
};
