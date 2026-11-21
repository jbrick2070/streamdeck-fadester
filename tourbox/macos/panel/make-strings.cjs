#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Builds the Mac panel's string catalog (PanelStrings.swift) from the Windows panel's catalog
// (tourbox/panel/PanelText.cs and PanelExtraText.cs) plus the Mac-only strings in mac-strings.json,
// so both panels speak the same 13 languages with the same words.
//   node tourbox/macos/panel/make-strings.cjs          write PanelStrings.swift
//   node tourbox/macos/panel/make-strings.cjs --check  fail if PanelStrings.swift is out of date
'use strict';
const fs = require('fs');
const path = require('path');

const here = __dirname;
const repo = path.resolve(here, '..', '..', '..');
const LOCALES = ['en', 'es', 'fr', 'zh-CN', 'de', 'it', 'ja', 'ko', 'ru', 'zh-TW', 'nl', 'pt-BR', 'tr'];
const BUILT_IN = ['en', 'es', 'fr', 'zh-CN']; // the order of PanelText.cs's arrays
const EXTRA = ['de', 'it', 'ja', 'ko', 'ru', 'zh-TW', 'nl', 'pt-BR', 'tr']; // PanelExtraText.cs's dictionaries
const files = {
  text: path.join(repo, 'tourbox', 'panel', 'PanelText.cs'),
  extra: path.join(repo, 'tourbox', 'panel', 'PanelExtraText.cs'),
  mac: path.join(here, 'mac-strings.json'),
  out: path.join(here, 'PanelStrings.swift'),
};

/** Reads the C# string literal that starts at s[i] (a quote); returns [value, index after it]. */
function literal(s, i) {
  if (s[i] !== '"') throw new Error('Expected a string at ' + i + ': ' + s.slice(i, i + 40));
  let out = '';
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '"') return [out, j + 1];
    if (c !== '\\') { out += c; continue; }
    const n = s[++j];
    if (n === 'n') out += '\n';
    else if (n === 't') out += '\t';
    else if (n === 'u') { out += String.fromCharCode(parseInt(s.slice(j + 1, j + 5), 16)); j += 4; }
    else out += n; // \" \\ \'
  }
  throw new Error('Unterminated string');
}
function skipSpace(s, i) { while (/\s/.test(s[i])) i++; return i; }

/** PanelText.cs: { "key", new[] { "en", "es", "fr", "zh-CN" } } */
function parseBuiltIn(source) {
  const start = source.indexOf('Messages = new Dictionary<string, string[]>');
  if (start < 0) throw new Error('PanelText.cs: Messages not found');
  const table = new Map();
  const entry = /\{ "([A-Za-z0-9]+)", new\[\] \{/g;
  entry.lastIndex = start;
  let m;
  const end = source.indexOf('\n    };', start);
  while ((m = entry.exec(source)) && m.index < end) {
    let i = entry.lastIndex; const values = [];
    for (;;) {
      i = skipSpace(source, i);
      if (source[i] === '}') break;
      const [value, next] = literal(source, i); values.push(value);
      i = skipSpace(source, next);
      if (source[i] === ',') i++;
    }
    if (values.length !== BUILT_IN.length) throw new Error('PanelText.cs: ' + m[1] + ' has ' + values.length + ' languages');
    if (table.has(m[1])) throw new Error('PanelText.cs: duplicate ' + m[1]);
    table.set(m[1], values);
    entry.lastIndex = i;
  }
  return table;
}

/** PanelExtraText.cs: { "de", new Dictionary<string, string> { { "key", "text" }, ... } } */
function parseExtra(source) {
  const result = new Map();
  const block = /\{ "([A-Za-z-]+)", new Dictionary<string, string> \{/g;
  let m;
  while ((m = block.exec(source))) {
    const locale = m[1], table = new Map();
    let i = block.lastIndex;
    for (;;) {
      i = skipSpace(source, i);
      if (source[i] === '}') break;
      if (source[i] !== '{') throw new Error('PanelExtraText.cs: unexpected text in ' + locale + ': ' + source.slice(i, i + 40));
      i = skipSpace(source, i + 1);
      const [key, afterKey] = literal(source, i);
      i = skipSpace(source, afterKey);
      if (source[i] !== ',') throw new Error('PanelExtraText.cs: expected a comma after ' + key);
      const [value, afterValue] = literal(source, skipSpace(source, i + 1));
      i = skipSpace(source, afterValue);
      if (source[i] !== '}') throw new Error('PanelExtraText.cs: expected } after ' + key);
      i = skipSpace(source, i + 1);
      if (source[i] === ',') i++;
      if (table.has(key)) throw new Error('PanelExtraText.cs: duplicate ' + locale + ':' + key);
      table.set(key, value);
    }
    result.set(locale, table);
    block.lastIndex = i;
  }
  return result;
}

const placeholders = text => (text.match(/\{\d+\}/g) || []).slice().sort().join(',');

/** The whole catalog: key -> [13 texts in LOCALES order]. Throws on any gap, clash or placeholder mismatch. */
function catalog() {
  const builtIn = parseBuiltIn(fs.readFileSync(files.text, 'utf8'));
  const extra = parseExtra(fs.readFileSync(files.extra, 'utf8'));
  const mac = JSON.parse(fs.readFileSync(files.mac, 'utf8'));
  if (JSON.stringify(mac.locales) !== JSON.stringify(LOCALES)) throw new Error('mac-strings.json: locales must be ' + LOCALES.join(', '));
  const table = new Map();
  for (const [key, values] of builtIn) {
    const row = LOCALES.map(locale => {
      const b = BUILT_IN.indexOf(locale);
      if (b >= 0) return values[b];
      const t = extra.get(locale);
      if (!t || !t.has(key)) throw new Error('PanelExtraText.cs: ' + locale + ' lacks ' + key);
      return t.get(key);
    });
    table.set(key, row);
  }
  for (const locale of EXTRA) {
    for (const key of (extra.get(locale) || new Map()).keys()) if (!builtIn.has(key)) throw new Error('PanelExtraText.cs: ' + locale + ':' + key + ' is not in PanelText.cs');
  }
  for (const [key, row] of Object.entries(mac.strings)) {
    if (table.has(key)) throw new Error('mac-strings.json: ' + key + ' is already in the Windows catalog; use that one');
    if (!Array.isArray(row) || row.length !== LOCALES.length) throw new Error('mac-strings.json: ' + key + ' needs ' + LOCALES.length + ' languages');
    table.set(key, row);
  }
  for (const [key, row] of table) {
    row.forEach((text, i) => {
      if (typeof text !== 'string' || !text.trim()) throw new Error('Empty text: ' + LOCALES[i] + ':' + key);
      if (placeholders(text) !== placeholders(row[0])) throw new Error('Placeholders differ: ' + LOCALES[i] + ':' + key);
    });
  }
  return table;
}

function swift(table) {
  const keys = [...table.keys()].sort();
  const json = '{\n' + keys.map(k => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(table.get(k))).join(',\n') + '\n}';
  if (json.includes('"""#')) throw new Error('Catalog text cannot contain """#');
  return `// SPDX-License-Identifier: GPL-2.0-or-later
// GENERATED by make-strings.cjs from tourbox/panel/PanelText.cs, PanelExtraText.cs and mac-strings.json.
// Do not edit: change those files and run  node tourbox/macos/panel/make-strings.cjs
import Foundation

enum PanelStrings {
    static let locales = [${LOCALES.map(l => JSON.stringify(l)).join(', ')}]
    // key: [${LOCALES.join(', ')}]
    static let json = #"""
${json}
"""#
}
`;
}

function main() {
  const out = swift(catalog());
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(files.out) ? fs.readFileSync(files.out, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== out) { console.error('PanelStrings.swift is out of date. Run: node tourbox/macos/panel/make-strings.cjs'); process.exit(1); }
    console.log('PanelStrings.swift is current.');
    return;
  }
  fs.writeFileSync(files.out, out, 'utf8');
  console.log('Wrote ' + path.relative(repo, files.out));
}

module.exports = { catalog, parseBuiltIn, parseExtra, swift, LOCALES, files };
if (require.main === module) main();
