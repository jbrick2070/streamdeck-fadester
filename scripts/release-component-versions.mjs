// SPDX-License-Identifier: GPL-2.0-or-later
// A release may not publish a changed component under a version it already published (G-07, QA-A03).
//
// The tag names Fadester for OBS's version, so that one is new by construction. Two other things are attached to every
// release under versions of their own: Fadester Companion (installer/components.json) and the VJster Chrome extension
// (vjster-extension/manifest.json). For each, this looks up the release tag that first carried the version the commit
// has now (the component's own last release) and fails when the files that go into that component changed since then.
// A version no earlier tag carries is new, and passes whatever changed.
//
// Run from the repository root, with the full history and the tags fetched:
//
//   node scripts/release-component-versions.mjs [commit]
//
// What the step that raises versions must do is in PUBLISHING.md ("Version numbers at a release").

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} Component
 * @property {string} name
 * @property {string} versionFile The file that holds the version.
 * @property {(json: any) => unknown} read The version inside that file.
 * @property {string} bump What to raise, as the failure says it.
 * @property {string[]} paths Everything that ends up in what is published for it.
 */

/** @type {Component[]} */
export const COMPONENTS = [
  {
    name: "Fadester Companion",
    versionFile: "installer/components.json",
    read: (json) => json?.components?.companion?.version,
    bump: "components.companion.version in installer/components.json (and the files the tests keep equal to it)",
    // The app and what is packed beside it, and the VJster OBS page it serves: the page's own folder and the files
    // its bundle is built from (vjster-page/rollup.config.mjs, the imports of vjster-page/src).
    paths: [
      "tourbox",
      "vjster-page",
      "src/vjster/shared",
      "vjster-extension/src/adapter-core.ts",
      "vjster-extension/src/link-client.ts",
      "vjster-extension/src/page-state.ts"
    ]
  },
  {
    name: "VJster Chrome extension",
    versionFile: "vjster-extension/manifest.json",
    read: (json) => json?.version,
    bump: "version in vjster-extension/manifest.json (and the files the tests keep equal to it)",
    paths: ["vjster-extension", "src/vjster/shared"]
  }
];

/**
 * @typedef {object} Git
 * @property {() => string[]} tags Release tags that are ancestors of the commit, newest first.
 * @property {(ref: string, file: string) => string | null} show The file's text at a ref, or null when it is not there.
 * @property {(from: string, paths: string[]) => string[]} changed The files under `paths` that differ between `from` and the commit.
 */

/** @returns {string | null} */
function versionOf(component, text) {
  if (text === null) return null;
  try {
    const version = component.read(JSON.parse(text));
    return typeof version === "string" && version.trim() !== "" ? version.trim() : null;
  } catch {
    return null;
  }
}

/**
 * One line of result per component.
 * @param {Git} git
 * @param {(file: string) => string | null} current The file's text at the commit being released.
 * @param {Component[]} [components]
 * @returns {{ name: string, ok: boolean, message: string }[]}
 */
export function checkComponents(git, current, components = COMPONENTS) {
  const tags = git.tags();
  return components.map((component) => {
    const now = versionOf(component, current(component.versionFile));
    if (now === null) return { name: component.name, ok: false, message: `${component.name}: no version in ${component.versionFile}.` };
    // The newest earlier releases that carry this version; the oldest of that run is the release that introduced it.
    let since = null;
    for (const tag of tags) {
      if (versionOf(component, git.show(tag, component.versionFile)) !== now) break;
      since = tag;
    }
    if (since === null) {
      return { name: component.name, ok: true, message: `${component.name} ${now}: a version no earlier release carries.` };
    }
    const changed = git.changed(since, component.paths);
    if (changed.length === 0) {
      return { name: component.name, ok: true, message: `${component.name} ${now}: unchanged since ${since}, where that version was first released.` };
    }
    const shown = changed.slice(0, 8).join(", ") + (changed.length > 8 ? `, and ${changed.length - 8} more` : "");
    return {
      name: component.name,
      ok: false,
      message: `${component.name} is still ${now}, the version first released in ${since}, but ${changed.length} of its files changed since then (${shown}). ` +
        `Raise ${component.bump}, then tag again. See PUBLISHING.md, "Version numbers at a release".`
    };
  });
}

/**
 * Without any release tag every version looks new and everything passes. On a release runner that means the tags were
 * not fetched (the checkout needs fetch-depth: 0), not that this is the first release: the check stops instead.
 * @param {Git} git
 * @param {Record<string, string | undefined>} env
 */
export function tagsMissingOnRunner(git, env = process.env) {
  return env.GITHUB_ACTIONS === "true" && git.tags().length === 0;
}

/** The real repository. @param {string} commit @returns {Git} */
export function gitAt(commit, cwd = process.cwd()) {
  const run = (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  return {
    tags: () => run(["tag", "--merged", `${commit}^`, "--sort=-version:refname", "--list", "v[0-9]*.[0-9]*.[0-9]*"]).split(/\r?\n/).map((tag) => tag.trim()).filter(Boolean),
    show: (ref, file) => {
      try {
        return run(["show", `${ref}:${file}`]);
      } catch {
        return null;
      }
    },
    changed: (from, paths) => run(["diff", "--name-only", from, commit, "--", ...paths]).split(/\r?\n/).map((file) => file.trim()).filter(Boolean)
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commit = process.argv[2] || "HEAD";
  const git = gitAt(commit);
  if (tagsMissingOnRunner(git)) {
    console.log("STOP  No release tag was found. The checkout must fetch the full history and the tags (fetch-depth: 0).");
    process.exit(1);
  }
  const results = checkComponents(git, (file) => git.show(commit, file));
  for (const result of results) console.log(`${result.ok ? "ok   " : "STOP "} ${result.message}`);
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}
