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
  type PluginManifest
} from "./opendeck.js";

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

  for (const name of names) {
    const manifest = JSON.parse(readFileSync(join(PLUGINS[name], "manifest.json"), "utf8")) as PluginManifest;
    const target = join(config, "plugins", pluginFolderName(manifest.UUID));
    if (args.dryRun) console.log(`would copy ${PLUGINS[name]} to ${target}`);
    else console.log(`${manifest.Name}: copied to ${installPlugin(PLUGINS[name], config, manifest.UUID)}`);
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
