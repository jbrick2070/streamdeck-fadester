// SPDX-License-Identifier: GPL-2.0-or-later
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { presetPages, type Preset } from "../profile-checks.js";
import { profileNameFor, type WrittenProfile } from "./fadester-layouts.js";

interface FirstSelection {
  deviceFile: string;
  backup: string;
  original: string;
  defaultFile: string;
  defaultContents: string;
  profile: string;
}

/** Inspect the original installation, before either the suite or any requested layouts are written. */
export function firstSelection(config: string, device: string, uuid: string, presets: Preset[]): FirstSelection | undefined {
  const preset = presets.find(p => ["plus-scene-regular", "buttons-scene-regular", "mini-source-desk"].includes(p.slug));
  if (!preset) return;
  const backups = join(config, "backups", uuid);
  // An upgrade from the earlier suite ID can have a perfectly empty Default profile.
  for (const id of new Set([uuid, "com.jbrick2070.fadester-for-obs"])) {
    const bundle = id + ".sdPlugin";
    if (existsSync(join(config, "plugins", bundle)) || existsSync(join(config, "settings", bundle + ".json")) || existsSync(join(config, "backups", id))) return;
  }
  const folder = join(config, "profiles", device);
  const deviceFile = join(config, "profiles", device + ".json");
  if (!existsSync(deviceFile)) return;
  const entries = readdirSync(folder, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isFile() || entries[0].name !== "Default.json") return;
  const original = readFileSync(deviceFile, "utf8");
  const defaultFile = join(folder, "Default.json");
  const defaultContents = readFileSync(defaultFile, "utf8");
  try {
    if (JSON.parse(original)?.selected_profile !== "Default") return;
    const data = JSON.parse(defaultContents);
    if (![data.keys, data.sliders, data.infobars ?? []].every(slots => Array.isArray(slots) && slots.every(slot => slot === null))) return;
    const mappings = join(config, "applications.json");
    if (existsSync(mappings) && Object.values(JSON.parse(readFileSync(mappings, "utf8"))).some(byDevice =>
      byDevice && typeof byDevice === "object" && Object.hasOwn(byDevice, device))) return;
  } catch {
    // Missing or unfamiliar configuration is not proof this is an unused deck.
    return;
  }
  return { deviceFile, original, defaultFile, defaultContents, backup: join(backups, device + "-selection.json"), profile: profileNameFor(preset, presetPages(preset)[0], 1) };
}

/** Keep the original device metadata as a backup and replace it atomically only after a complete installation. */
export function selectWrittenStarter(plan: FirstSelection, written: WrittenProfile[]): boolean {
  if (!written.some(entry => entry.status === "written" && entry.name === plan.profile && existsSync(entry.file))) return false;
  if (readFileSync(plan.deviceFile, "utf8") !== plan.original) return false;
  if (readFileSync(plan.defaultFile, "utf8") !== plan.defaultContents) return false;
  const expected = new Set(["Default.json", ...written.filter(entry => entry.status === "written").map(entry => entry.name + ".json")]);
  const folder = dirname(plan.defaultFile);
  if (readdirSync(folder).some(name => !expected.has(name))) return false;
  mkdirSync(dirname(plan.backup), { recursive: true });
  const temp = plan.deviceFile + "." + randomUUID() + ".tmp";
  try {
    const updated = { ...JSON.parse(plan.original), selected_profile: plan.profile };
    writeFileSync(temp, JSON.stringify(updated, null, 2) + "\n", { flag: "wx" });
    try {
      writeFileSync(plan.backup, plan.original, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    renameSync(temp, plan.deviceFile);
  } finally {
    rmSync(temp, { force: true });
  }
  return true;
}
