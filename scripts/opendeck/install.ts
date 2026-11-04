// SPDX-License-Identifier: GPL-2.0-or-later
// npm run opendeck:install -- [vjster|fadester|all] [--layout] [--device <id>] [--config <dir>] [--dry-run] [--force]
// Copies the built plugins into OpenDeck's plugins folder; --layout also fills VJster's starter keys and dials.
// OpenDeck rewrites its profiles when it quits, so it must be closed first (--force skips that check).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  VJSTER_LAYOUT,
  applyLayout,
  configDir,
  installPlugin,
  isBuilt,
  knownDevices,
  parseArgs,
  pluginFolderName,
  profileFile,
  type PluginManifest,
  type Profile
} from "./opendeck.js";
import { fits, writeLayouts } from "./fadester-layouts.js";
import type { Preset } from "../profile-checks.js";

const root = resolve(import.meta.dirname, "..", "..");
const PLUGINS = {
  vjster: join(root, "com.jbrick2070.vjster.sdPlugin"),
  fadester: join(root, "com.jbrick2070.fadester-for-obs.sdPlugin")
} as const;

/** True when OpenDeck is running; false when it is not or when this computer cannot say (the answer is then a warning). */
function openDeckRunning(): boolean {
  try {
    if (process.platform === "win32") {
      return execFileSync("tasklist", ["/FI", "IMAGENAME eq opendeck.exe", "/NH"], { encoding: "utf8" }).toLowerCase().includes("opendeck.exe");
    }
    execFileSync("pgrep", ["-xi", "opendeck"], { stdio: "ignore" });
    return true;
  } catch (error) {
    // pgrep exits 1 for "no such process"; anything else means the check itself did not work.
    if ((error as { status?: number }).status !== 1 && process.platform !== "win32") {
      console.warn("Could not tell whether OpenDeck is running; make sure it is closed.");
    }
    return false;
  }
}

interface FadesterPlan {
  presets: Preset[];
  deck: { keys: number; dials: number };
}

/**
 * Which of Fadester's ready-made layouts to write, and for what deck size: a plan, or the sentence that says why not.
 * Decided before anything is copied. A dry run with no deck profile yet checks only the names.
 */
function planFadesterLayouts(config: string, device: string | undefined, which: string, dry: boolean): FadesterPlan | string {
  const all = JSON.parse(readFileSync(join(root, "profiles", "layouts.json"), "utf8")) as Preset[];
  const wanted = which === "fit" ? null : [...new Set(which.split(",").map((slug) => slug.trim()))];
  const unknown = (wanted ?? []).filter((slug) => !all.some((preset) => preset.slug === slug));
  if (unknown.length > 0) return `No Fadester layout called ${unknown.join(", ")}. The slugs are in profiles/layouts.json.`;
  const file = device ? profileFile(config, device) : "";
  if (!device || !existsSync(file)) {
    if (dry) return { presets: all.filter((preset) => !wanted || wanted.includes(preset.slug)), deck: { keys: 0, dials: 0 } };
    return device
      ? `OpenDeck has no profile file at ${file}; check --device.`
      : "OpenDeck has no deck profile yet: connect the deck, start OpenDeck once, quit it, and run this again.";
  }
  const current = JSON.parse(readFileSync(file, "utf8")) as Profile;
  const deck = { keys: current.keys.length, dials: current.sliders.length };
  const presets = all.filter((preset) => (wanted ? wanted.includes(preset.slug) : fits(preset, deck)));
  const misfits = presets.filter((preset) => !fits(preset, deck));
  if (misfits.length > 0) {
    const list = misfits.map((preset) => `${preset.slug} (made for ${preset.columns * preset.rows} keys and ${preset.dials} dials)`).join(", ");
    return `${list}; this deck has ${deck.keys} keys and ${deck.dials} dials.`;
  }
  return { presets, deck };
}

/** Write a plan's layouts as profiles. */
function writeFadesterLayouts(plan: FadesterPlan, config: string, device: string, manifest: PluginManifest, pluginDir: string): void {
  for (const written of writeLayouts(config, device, plan.presets, manifest, pluginDir, plan.deck)) {
    console.log(`  ${written.status === "written" ? "wrote" : "kept"} profile "${written.name}"${written.status === "exists" ? " (already there; delete it in OpenDeck to build it again)" : ""}`);
    for (const line of written.left) console.log(`    left empty: ${line}`);
  }
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.errors.length > 0) {
    for (const line of args.errors) console.error(line);
    console.error("Usage: npm run opendeck:install -- [vjster|fadester|all] [--layout] [--device <id>] [--config <dir>] [--dry-run] [--force]");
    return 2;
  }
  const names = args.which === "all" ? (["vjster", "fadester"] as const) : ([args.which] as const);
  const config = args.config ?? configDir(process.platform, process.env, homedir());

  if (!args.dryRun && !args.force && openDeckRunning()) {
    console.error("OpenDeck is running. Quit it (the tray icon too), then run this again; it rewrites its profiles when it quits.");
    return 1;
  }
  if (!existsSync(config)) {
    console.error(`No OpenDeck config folder at ${config}. Install OpenDeck and start it once, or pass --config <dir>.`);
    return 1;
  }
  // Nothing is touched until every plugin asked for is built, so a run never ends half done.
  const unbuilt = names.filter((name) => !isBuilt(PLUGINS[name]));
  if (!args.dryRun && unbuilt.length > 0) {
    for (const name of unbuilt) console.error(`${PLUGINS[name]} has no bin/plugin.js; run npm run build first.`);
    return 1;
  }
  const devices = knownDevices(config);
  const device = args.device ?? devices[0];
  if (!args.dryRun && args.layout && names.includes("vjster")) {
    if (!device) {
      console.error("OpenDeck has no deck profile yet: connect the deck, start OpenDeck once, quit it, and run this again.");
      return 1;
    }
    if (!existsSync(profileFile(config, device))) {
      console.error(`OpenDeck has no profile file at ${profileFile(config, device)} (decks it knows: ${devices.join(", ") || "none"}); check --device.`);
      return 1;
    }
  }

  let plan: FadesterPlan | null = null;
  if (args.fadesterLayouts && names.includes("fadester")) {
    const planned = planFadesterLayouts(config, device, args.fadesterLayouts, args.dryRun);
    if (typeof planned === "string") {
      console.error(planned);
      return 1;
    }
    plan = planned;
  }

  for (const name of names) {
    const manifest = JSON.parse(readFileSync(join(PLUGINS[name], "manifest.json"), "utf8")) as PluginManifest;
    const target = join(config, "plugins", pluginFolderName(manifest.UUID));
    if (args.dryRun) console.log(`would copy ${PLUGINS[name]} to ${target}`);
    else console.log(`${manifest.Name}: copied to ${installPlugin(PLUGINS[name], config, manifest.UUID)}`);
    if (name === "fadester" && plan) {
      if (args.dryRun) console.log(`would write ${plan.presets.length} Fadester layout(s) as OpenDeck profiles${plan.deck.keys ? ` for ${plan.deck.keys} keys and ${plan.deck.dials} dials on ${device}` : ""}`);
      else writeFadesterLayouts(plan, config, device as string, manifest, target);
      continue;
    }
    if (name !== "vjster" || !args.layout) continue;
    if (devices.length > 1 && !args.device) console.log(`Several decks found (${devices.join(", ")}); using ${device}. Pass --device <id> to choose.`);
    if (args.dryRun) {
      console.log(`would place the ${manifest.Name} starter layout on ${device ?? "the deck (none found yet)"}`);
      continue;
    }
    const result = applyLayout(config, device as string, manifest, target, VJSTER_LAYOUT);
    for (const line of result.placed) console.log(`  placed ${line}`);
    for (const line of result.refreshed) console.log(`  refreshed ${line}`);
    for (const line of result.skipped) console.log(`  skipped ${line}`);
  }
  if (!args.dryRun) {
    console.log(`Start OpenDeck.${names.includes("fadester") ? " Fadester's actions are in the action list; drag them onto keys and dials there." : ""}`);
  }
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
