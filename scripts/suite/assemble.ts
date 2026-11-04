// SPDX-License-Identifier: GPL-2.0-or-later
// npm run suite:assemble [-- --check]
// Puts VJster into the suite plugin (docs/SUITE.md): the Fadester plugin's folder gets VJster's seven actions in its
// manifest and language files, their images, strip layout and settings page, and a copy of VJster's own language
// files for the VJster plugin that runs inside it. VJster's own folder (com.jbrick2070.vjster.sdPlugin) stays the
// source and still builds the standalone plugin. --check lists what differs and changes nothing (tests run it).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { VJSTER_KINDS, VJSTER_PLUGIN_ID, suiteActionId } from "../../src/suite/actions.js";

export const LANGUAGES = ["en", "de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW", "nl"] as const;

const FADESTER = "com.jbrick2070.fadester-for-obs.sdPlugin";
const VJSTER = "com.jbrick2070.vjster.sdPlugin";

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});

/** The text of a JSON file as these files are kept: two-space indent, CRLF line ends, a closing line end when `closing`. */
function format(value: unknown, closing: boolean): string {
  return JSON.stringify(value, null, 2).replace(/\n/g, "\r\n") + (closing ? "\r\n" : "");
}

const readJson = (path: string): Json => record(JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")));
const kindOf = (id: string): string => id.slice(VJSTER_PLUGIN_ID.length + 1);

/** The suite's name for a VJster action: "VJster" first, so a list of every action says whose it is. */
const suiteName = (name: unknown): string => `VJster ${String(name)}`;

/** Every file the assembly owns, by path inside the Fadester plugin folder, as the bytes it must have. */
export function wanted(root: string): Map<string, Buffer | string> {
  const fadester = join(root, FADESTER);
  const vjster = join(root, VJSTER);
  const out = new Map<string, Buffer | string>();

  // The manifest: Fadester's own actions as they are, then VJster's under the suite's ids.
  const manifest = readJson(join(fadester, "manifest.json"));
  const own = (Array.isArray(manifest.Actions) ? manifest.Actions : []).map(record).filter((action) => !String(action.UUID).startsWith(suiteActionId("")));
  const theirs = (Array.isArray(readJson(join(vjster, "manifest.json")).Actions) ? (readJson(join(vjster, "manifest.json")).Actions as unknown[]) : []).map(record);
  const added = theirs.map((action) => {
    const kind = kindOf(String(action.UUID));
    const remap = (path: unknown): unknown => (typeof path === "string" ? path.replace(/^imgs\/actions\/([^/]+)\//, "imgs/actions/vjster-$1/") : path);
    return {
      ...action,
      Name: suiteName(action.Name),
      UUID: suiteActionId(kind),
      Icon: remap(action.Icon),
      PropertyInspectorPath: "ui/vjster/vjster.html",
      States: (Array.isArray(action.States) ? action.States : []).map((state) => ({ ...record(state), Image: remap(record(state).Image) }))
    };
  });
  out.set("manifest.json", format({ ...manifest, Actions: [...own, ...added] }, false));

  // The VJster plugin runs from the suite's vjster folder and reads its own manifest there (the SDK looks for manifest.json in the folder it starts in).
  out.set("vjster/manifest.json", readFileSync(join(vjster, "manifest.json")));

  // The language files: the suite's own entries for VJster's actions, in each language; VJster's whole file beside the plugin that reads it.
  for (const language of LANGUAGES) {
    const base = readJson(join(fadester, `${language}.json`));
    // A file that holds only Localization (Dutch, D-L4) has no manifest texts to add to.
    const textsToo = Object.keys(base).some((key) => key !== "Localization");
    const theirsFile = readJson(join(vjster, `${language}.json`));
    const next: Json = {};
    for (const [key, value] of Object.entries(base)) {
      if (key !== "Localization" && !key.startsWith(suiteActionId(""))) next[key] = value;
    }
    if (textsToo) {
      for (const kind of VJSTER_KINDS) {
        const entry = record(theirsFile[`${VJSTER_PLUGIN_ID}.${kind}`]);
        next[suiteActionId(kind)] = { ...entry, Name: suiteName(entry.Name) };
      }
    }
    if ("Localization" in base) next.Localization = base.Localization;
    out.set(`${language}.json`, format(next, true));
    out.set(`vjster/${language}.json`, readFileSync(join(vjster, `${language}.json`)));
  }

  // Images, the strip layout, and the settings page.
  for (const kind of VJSTER_KINDS) {
    for (const file of ["icon.svg", "key.svg"]) out.set(`imgs/actions/vjster-${kind}/${file}`, readFileSync(join(vjster, "imgs", "actions", kind, file)));
  }
  out.set("layouts/vjster-strip.json", readFileSync(join(vjster, "layouts", "vjster-strip.json")));
  for (const file of ["vjster.js", "vjster.css", "i18n.js"]) out.set(`ui/vjster/${file}`, readFileSync(join(vjster, "ui", file)));
  const page = readFileSync(join(vjster, "ui", "vjster.html"), "utf8");
  if (!page.includes('<script src="vjster.js"></script>')) throw new Error("the VJster settings page no longer loads vjster.js the way the suite expects");
  out.set("ui/vjster/vjster.html", page.replace('<script src="vjster.js"></script>', '<script src="suite.js"></script>\n    <script src="vjster.js"></script>'));
  out.set(
    "ui/vjster/suite.js",
    `// SPDX-License-Identifier: GPL-2.0-or-later\r\n// Generated by scripts/suite/assemble.ts. Tells VJster's settings page it runs inside the Fadester plugin:\r\n// its action ids carry the suite's name, and its global settings are saved by the plugin under their own key.\r\nwindow.VJSTER_SUITE = { prefix: ${JSON.stringify(suiteActionId(""))}, namespace: "vjster" };\r\n`
  );
  return out;
}

/** A file's text with line ends as LF: a checkout may give a file CRLF or LF (git's autocrlf), and either is the same file. */
const text = (content: Buffer | string): string => (typeof content === "string" ? content : content.toString("utf8")).replace(/\r\n/g, "\n");

/** The files that differ from what the assembly wants, line ends aside (none when it has been run). */
export function differences(root: string): string[] {
  const base = join(root, FADESTER);
  return [...wanted(root)].filter(([path, content]) => !existsSync(join(base, path)) || text(content) !== text(readFileSync(join(base, path)))).map(([path]) => path);
}

/** Writes every file that differs; returns their paths. */
export function assemble(root: string): string[] {
  const changed = differences(root);
  const files = wanted(root);
  for (const path of changed) {
    const target = join(root, FADESTER, path);
    mkdirSync(dirname(target), { recursive: true });
    // Keep the file's own line ends when it exists (a checkout without CRLF stays without); a new file gets CRLF, as these files are kept.
    const eol = existsSync(target) && !readFileSync(target, "utf8").includes("\r\n") ? "\n" : "\r\n";
    writeFileSync(target, text(files.get(path) as Buffer | string).replace(/\n/g, eol));
  }
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(import.meta.dirname, "..", "..");
  if (process.argv.includes("--check")) {
    const off = differences(root);
    for (const path of off) console.log(`differs: ${path}`);
    process.exitCode = off.length > 0 ? 1 : 0;
  } else {
    const changed = assemble(root);
    console.log(changed.length === 0 ? "The suite plugin already holds VJster as it is." : changed.map((path) => `wrote ${path}`).join("\n"));
  }
}
