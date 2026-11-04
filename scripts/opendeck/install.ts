// SPDX-License-Identifier: GPL-2.0-or-later
// npm run opendeck:install -- [suite|vjster|both] [--layout] [--device <id>] [--config <dir>] [--dry-run] [--force]
// Copies the built plugins into OpenDeck's plugins folder; --layout also fills VJster's starter keys and dials.
// OpenDeck rewrites its profiles when it quits, so it must be closed first (--force skips that check).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUITE_LAYOUT,
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
import { fits, writeLayouts, type WrittenProfile } from "./fadester-layouts.js";
import { firstSelection, selectWrittenStarter } from "./first-selection.js";
import type { Preset } from "../profile-checks.js";

const root = resolve(import.meta.dirname, "..", "..");
// The suite is the Fadester plugin's folder, which carries VJster too; the standalone VJster plugin is a folder of its own.
const PLUGINS = {
  suite: join(root, "io.github.jbrick2070.fadester-for-obs.sdPlugin"),
  vjster: join(root, "com.jbrick2070.vjster.sdPlugin")
} as const;

/** Unknown status allows manual installation, but never automatic profile selection. */
function openDeckRunning(): boolean | undefined {
  try {
    if (process.platform === "win32") {
      return execFileSync("tasklist", ["/FI", "IMAGENAME eq opendeck.exe", "/NH"], { encoding: "utf8" }).toLowerCase().includes("opendeck.exe");
    }
    execFileSync("pgrep", ["-xi", "opendeck"], { stdio: "ignore" });
    return true;
  } catch (error) {
    // pgrep exits 1 for "no such process"; anything else means the check itself did not work.
    if (process.platform !== "win32" && (error as { status?: number }).status === 1) return false;
    console.warn("Could not tell whether OpenDeck is running; make sure it is closed.");
    return undefined;
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
function writeFadesterLayouts(plan: FadesterPlan, config: string, device: string, manifest: PluginManifest, pluginDir: string): WrittenProfile[] {
  const layouts = writeLayouts(config, device, plan.presets, manifest, pluginDir, plan.deck);
  for (const written of layouts) {
    console.log(`  ${written.status === "written" ? "wrote" : "kept"} profile "${written.name}"${written.status === "exists" ? " (already there; delete it in OpenDeck to build it again)" : ""}`);
    for (const line of written.left) console.log(`    left empty: ${line}`);
  }
  return layouts;
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.errors.length > 0) {
    for (const line of args.errors) console.error(line);
    console.error("Usage: npm run opendeck:install -- [suite|vjster|both] [--layout] [--device <id>] [--config <dir>] [--dry-run] [--force]");
    return 2;
  }
  const names = args.which === "both" ? (["suite", "vjster"] as const) : ([args.which] as const);
  // VJster's starter layout goes on the suite when it is installed, else on the standalone plugin.
  const layoutOn = names.includes("suite") ? "suite" : "vjster";
  const config = args.config ?? configDir(process.platform, process.env, homedir());

  const running = args.dryRun || args.force ? undefined : openDeckRunning();
  if (running) {
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
  if (!args.dryRun && args.layout) {
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
  if (args.fadesterLayouts && names.includes("suite")) {
    const planned = planFadesterLayouts(config, device, args.fadesterLayouts, args.dryRun);
    if (typeof planned === "string") {
      console.error(planned);
      return 1;
    }
    plan = planned;
  }

  let selection: ReturnType<typeof firstSelection>;
  let written: WrittenProfile[] = [];
  for (const name of names) {
    const manifest = JSON.parse(readFileSync(join(PLUGINS[name], "manifest.json"), "utf8")) as PluginManifest;
    const target = join(config, "plugins", pluginFolderName(manifest.UUID));
    if (running === false && name === "suite" && plan && args.fadesterLayouts === "fit" && device &&
        devices.includes(device) && (devices.length === 1 || args.device)) {
      selection = firstSelection(config, device, manifest.UUID, plan.presets);
    }
    if (args.dryRun) console.log(`would copy ${PLUGINS[name]} to ${target}`);
    else console.log(`${manifest.Name}: copied to ${installPlugin(PLUGINS[name], config, manifest.UUID)}`);
    if (name === "suite" && plan) {
      if (args.dryRun) console.log(`would write ${plan.presets.length} Fadester layout(s) as OpenDeck profiles${plan.deck.keys ? ` for ${plan.deck.keys} keys and ${plan.deck.dials} dials on ${device}` : ""}`);
      else written = writeFadesterLayouts(plan, config, device as string, manifest, target);
    }
    if (!args.layout || name !== layoutOn) {
      if (args.layout && name === "vjster") console.log("  the standalone VJster plugin gets no starter layout: the suite has it");
      continue;
    }
    if (devices.length > 1 && !args.device) console.log(`Several decks found (${devices.join(", ")}); using ${device}. Pass --device <id> to choose.`);
    if (args.dryRun) {
      console.log(`would place the ${manifest.Name} starter layout on ${device ?? "the deck (none found yet)"}`);
      continue;
    }
    if (selection && readFileSync(selection.defaultFile, "utf8") !== selection.defaultContents) selection = undefined;
    const result = applyLayout(config, device as string, manifest, target, name === "suite" ? SUITE_LAYOUT : VJSTER_LAYOUT);
    if (selection) selection.defaultContents = readFileSync(selection.defaultFile, "utf8");
    for (const line of result.placed) console.log(`  placed ${line}`);
    for (const line of result.refreshed) console.log(`  refreshed ${line}`);
    for (const line of result.skipped) console.log(`  skipped ${line}`);
  }
  if (selection && selectWrittenStarter(selection, written)) {
    console.log(`  Selected "${selection.profile}" for the new deck; the original selection is backed up in ${selection.backup}.`);
  }
  if (!args.dryRun) {
    console.log(`Start OpenDeck.${names.includes("suite") ? " Fadester's and VJster's actions are in the action list; drag them onto keys and dials there." : ""}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
