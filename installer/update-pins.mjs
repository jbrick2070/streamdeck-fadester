// SPDX-License-Identifier: GPL-2.0-or-later
// Re-pins the Fadester Suite Setup inputs to newly PUBLISHED releases.
//
//   node installer/update-pins.mjs --midi 0.7.4 --vs 0.7.4 --playlister 0.5.2 --sd 0.12.13 [--ext 0.1.3 --ext-tag v0.11.0]
//
// For each component named, it downloads the public release asset, computes its SHA-256 and rewrites that entry's
// version, file, url and sha256 in installer/components.json. Components not named keep their pins. Draft releases
// are not public, so publish each release first. Nothing is built or installed.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "components.json");
const gh = "https://github.com/jbrick2070";

const rules = {
  midi: { key: "midiFadester", file: (v) => `midi-fadester-${v}-windows-x64-Installer.exe`, url: (v, f) => `${gh}/midi-fadester/releases/download/${v}/${f}` },
  vs: { key: "visualSidechain", file: (v) => `visual-sidechain-${v}-windows-x64-Installer.exe`, url: (v, f) => `${gh}/visual-sidechain/releases/download/${v}/${f}` },
  playlister: { key: "playlister", file: (v) => `obs-playlister-${v}-windows-x64-Installer.exe`, url: (v, f) => `${gh}/obs-playlister/releases/download/${v}/${f}` },
  sd: { key: "fadesterForObs", file: () => "io.github.jbrick2070.fadester-for-obs.streamDeckPlugin", url: (v, f) => `${gh}/streamdeck-fadester/releases/download/v${v}/${f}` },
  ext: { key: "vjsterExtension", file: (v) => `vjster-chrome-extension-${v}.zip`, url: (v, f, a) => `${gh}/streamdeck-fadester/releases/download/${a["ext-tag"] ?? `v${a.sd}`}/${f}` }
};

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const name = argv[i]?.replace(/^--/, "");
  const value = argv[i + 1];
  if (!name || !value || !(name in rules || name === "ext-tag")) throw new Error(`Unknown or incomplete option: ${argv[i]} ${value ?? ""}`);
  if (name !== "ext-tag" && !/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`--${name} needs a version like 1.2.3, not ${value}`);
  args[name] = value;
}
if (args.ext && !args["ext-tag"] && !args.sd) throw new Error("--ext needs --ext-tag (or --sd) to know which release holds the zip");
const names = Object.keys(args).filter((n) => n in rules);
if (names.length === 0) throw new Error("Name at least one component, for example --midi 0.7.0");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const name of names) {
  const rule = rules[name];
  const version = args[name];
  const file = rule.file(version);
  const url = rule.url(version, file, args);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}. Is the release published (not a draft)?`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  Object.assign(manifest.components[rule.key], { version, file, url, sha256 });
  console.log(`${rule.key}: ${version} ${file} ${sha256} (${bytes.length} bytes)`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Updated ${manifestPath}. Commit it, then run the "Fadester Suite Setup (Windows)" workflow.`);
