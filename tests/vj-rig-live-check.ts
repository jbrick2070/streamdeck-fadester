// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Automated part of the VJ rig acceptance (PLAN.md 10.8): starts the portable
 * OBS 33 (Visual Sidechain installed), connects with the direct client, creates
 * its own color source (in the Program scene, as the Playlister check does) with its own Visual Sidechain Shader
 * Filter (uniquely named; it never reads, writes or drives anything else),
 * rides vs_effect_mix_pct through the filter controller and reads it back from
 * OBS, checks a glide, a drop-and-return and an Audio Modulator's ownership,
 * toggles the filter, triggers Visual Sidechain's Panic and Restore by
 * TriggerHotkeyByName and finds their lines in this run's OBS log, then removes
 * everything it created and closes OBS cleanly. Panic and Restore act on every
 * Visual Sidechain filter in OBS, so they are sent only when the saved scene
 * collections and the live OBS hold no other one. The obs-websocket password is
 * read from OBS's own config into memory and never written or logged. Every
 * check has an expected value; a miss sets a failing exit code.
 *
 * Run: node --import tsx tests/vj-rig-live-check.ts
 * It refuses to run while another obs64 is up.
 */
import { ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { connect as netConnect } from "node:net";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FilterController, FilterTarget } from "../src/control/filter-controller.js";
import { VisualSafety } from "../src/control/visual-safety.js";
import { VS_MODULATOR_FILTER_KIND, VS_SHADER_FILTER_KIND, isVisualSidechainKind } from "../src/obs/filter-ranges.js";

const OBS_ROOT = "C:\\Users\\jeffr\\OBS-Studio-33-Portable";
const OBS_BIN = join(OBS_ROOT, "bin", "64bit");
const LOGS = join(OBS_ROOT, "config", "obs-studio", "logs");
const SCENES = join(OBS_ROOT, "config", "obs-studio", "basic", "scenes");
// Fresh names per run: the check can never collide with (or drive) anything someone made.
const RUN = randomUUID().slice(0, 8);
const INPUT_NAME = `Fadester VJ live check ${RUN}`;
const SHADER_NAME = `Fadester VJ shader ${RUN}`;
const MODULATOR_NAME = `Fadester VJ modulator ${RUN}`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line: string): void => console.log(`${new Date().toISOString().slice(11, 23)} ${line}`);

function obsRunning(): boolean {
  const list = execFileSync("tasklist", ["/FI", "IMAGENAME eq obs64.exe", "/NH"], { encoding: "utf8" });
  return /obs64\.exe/i.test(list);
}

async function waitForPort(port: number, timeoutMs: number, obs: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (obs.exitCode !== null) throw new Error(`OBS exited (${obs.exitCode}) before its websocket opened`);
    const open = await new Promise<boolean>((resolve) => {
      const socket = netConnect({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
      socket.setTimeout(300, () => { socket.destroy(); resolve(false); });
    });
    if (open) return;
    await sleep(250);
  }
  throw new Error(`obs-websocket port ${port} did not open within ${timeoutMs} ms`);
}

/** The OBS log this run's OBS writes (the newest one started after the launch). */
function newestLog(startedAt: number): string {
  const files = readdirSync(LOGS).filter((name) => name.endsWith(".txt"))
    .map((name) => ({ name, mtime: statSync(join(LOGS, name)).mtimeMs, birth: statSync(join(LOGS, name)).birthtimeMs }))
    .filter((file) => file.birth >= startedAt - 2000)
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? join(LOGS, files[0].name) : "";
}

async function logHas(file: string, text: string, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (file && readFileSync(file, "utf8").includes(text)) return true;
    await sleep(200);
  }
  return false;
}

async function main(): Promise<void> {
  if (obsRunning()) throw new Error("ABORT: obs64.exe is already running; this check never shares an OBS.");
  const config = JSON.parse(readFileSync(join(OBS_ROOT, "config", "obs-studio", "plugin_config", "obs-websocket", "config.json"), "utf8")) as
    { server_port: number; server_password?: string };
  // Panic and Restore reach every Visual Sidechain filter OBS has, private and hidden ones included:
  // a saved collection holding one rules them out before OBS even starts.
  const savedWithVs = readdirSync(SCENES).filter((name) => name.endsWith(".json"))
    .filter((name) => readFileSync(join(SCENES, name), "utf8").includes("visual_sidechain_"));

  log("starting the portable OBS");
  const startedAt = Date.now();
  const obs = spawn(join(OBS_BIN, "obs64.exe"), ["--portable", "--disable-updater", "--multi"], { cwd: OBS_BIN, stdio: "ignore" });
  obs.on("error", (error) => log(`OBS did not start: ${error.message}`));
  const exited = new Promise<void>((resolve) => obs.once("exit", () => resolve()));
  const client = new DirectObsClient({ host: "127.0.0.1", port: config.server_port, password: config.server_password ?? "" });
  const filters = new FilterController(client);
  const safety = new VisualSafety(client, filters);
  let inputUuid = "";
  let inputSent = false;
  const results: Array<{ check: string; ok: boolean; detail: string }> = [];
  const expect = (check: string, ok: boolean, detail: string): void => {
    results.push({ check, ok, detail });
    log(`${ok ? "PASS" : "MISS"} ${check}: ${detail}`);
  };
  const read = async (setting: string): Promise<unknown> => (await client.getSourceFilter(inputUuid, SHADER_NAME)).filterSettings[setting];
  try {
    await waitForPort(config.server_port, 60000, obs);
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("OBS did not identify within 30 s")), 30000);
      client.on("statusChanged", (status: { kind: string }) => { if (status.kind === "connected") { clearTimeout(timer); resolve(); } });
    });
    client.start();
    await connected;
    const version = await client.sendObsRequest("GetVersion");
    log(`connected: OBS ${String(version.obsVersion)}, obs-websocket ${String(version.obsWebSocketVersion)}`);
    const kinds = await client.sendObsRequest("GetSourceFilterKindList");
    if (!Array.isArray(kinds.sourceFilterKinds) || !kinds.sourceFilterKinds.includes(VS_SHADER_FILTER_KIND)) {
      throw new Error("Visual Sidechain's Shader Filter is not registered in this OBS");
    }
    for (let tries = 0; !client.getCatalog().currentProgramScene && tries < 40; tries++) {
      await sleep(250);
      await client.refreshCatalog();
    }
    const sceneName = client.getCatalog().currentProgramScene;
    if (!sceneName) throw new Error("OBS reported no Program scene to create the source in");
    if (client.getCatalog().inputDetails.some((input) => input.inputName === INPUT_NAME)) {
      throw new Error("ABORT: this run's names already exist; this check only drives what it created.");
    }

    // Its own color source and Shader Filter. (A CreateScene of its own hung this OBS once, 2026-11-01:
    // the request never answered and OBS would not close, so the source goes into the Program scene,
    // as the Playlister check's does, and leaves with its filters.)
    log(`creating "${INPUT_NAME}" in "${sceneName}" with the Shader Filter "${SHADER_NAME}"`);
    inputSent = true;
    const created = await client.sendObsRequest("CreateInput", {
      sceneName, inputName: INPUT_NAME, inputKind: "color_source_v3",
      inputSettings: { color: 4282400832, width: 320, height: 180 }, sceneItemEnabled: true
    });
    inputUuid = typeof created.inputUuid === "string" ? created.inputUuid : "";
    if (!inputUuid) throw new Error("CreateInput answered without an inputUuid");
    await client.sendObsRequest("CreateSourceFilter", {
      sourceUuid: inputUuid, filterName: SHADER_NAME, filterKind: VS_SHADER_FILTER_KIND, filterSettings: { vs_effect_mix_pct: 50 }
    });
    await client.refreshCatalog();
    const mix: FilterTarget = { sourceUuid: inputUuid, filterName: SHADER_NAME, filterKind: VS_SHADER_FILTER_KIND, setting: "vs_effect_mix_pct" };
    const react: FilterTarget = { ...mix, setting: "vs_audio_reactivity_pct" };
    const release = filters.watch(mix);
    await sleep(500);

    // Ride Effect mix: +20 % of the range from a fresh read, in slew-limited writes, read back from OBS.
    await filters.nudge(mix, 0.2);
    await sleep(800);
    const ridden = await read("vs_effect_mix_pct");
    expect("ride +20 %", ridden === 70 && filters.getState(mix).value === 70, `50 -> ${String(ridden)} (deck ${String(filters.getState(mix).value)})`);
    await filters.glideTo(mix, 20, 500);
    await sleep(900);
    const glided = await read("vs_effect_mix_pct");
    expect("glide to 20 over 0.5 s", glided === 20, String(glided));
    const dropped = filters.dropStart(mix, 300);
    await sleep(700);
    const atRest = await read("vs_effect_mix_pct");
    await dropped;
    await filters.dropReturn(mix, 300);
    await sleep(900);
    const returned = await read("vs_effect_mix_pct");
    expect("drop and return", atRest === 0 && returned === 20, `drop ${String(atRest)}, return ${String(returned)}`);

    // Ownership: our own Audio Modulator targets Reactivity; the deck refuses it.
    await client.sendObsRequest("CreateSourceFilter", {
      sourceUuid: inputUuid, filterName: MODULATOR_NAME, filterKind: VS_MODULATOR_FILTER_KIND,
      filterSettings: { slot_1_target_filter: SHADER_NAME, slot_1_target_setting: "vs_audio_reactivity_pct" }
    });
    let ownership = "";
    try {
      await filters.nudge(react, 0.1, Date.now() + 5000);
    } catch (error) {
      ownership = (error as Error).message;
    }
    expect("a setting an Audio Modulator drives is refused", ownership === `Driven by ${MODULATOR_NAME}`, ownership || "not refused");
    await client.sendObsRequest("RemoveSourceFilter", { sourceUuid: inputUuid, filterName: MODULATOR_NAME });

    // Toggle the filter off and on from fresh reads.
    const off = await filters.toggleEnabled(mix);
    const offRead = (await client.getSourceFilter(inputUuid, SHADER_NAME)).filterEnabled;
    const on = await filters.toggleEnabled(mix);
    const onRead = (await client.getSourceFilter(inputUuid, SHADER_NAME)).filterEnabled;
    expect("toggle off and on", !off && !offRead && on && onRead, `${String(off)} (OBS ${String(offRead)}), then ${String(on)} (OBS ${String(onRead)})`);

    // Panic and Restore act on every Visual Sidechain filter in OBS: only when ours is the only one.
    await client.refreshCatalog();
    const catalog = client.getCatalog();
    const sources = [...catalog.sceneDetails.map((scene) => scene.sceneUuid), ...catalog.groupDetails.map((group) => group.groupUuid),
      ...catalog.inputDetails.map((input) => input.inputUuid)];
    const others: string[] = savedWithVs.map((name) => `saved in ${name}`);
    for (const source of sources) {
      try {
        for (const filter of await client.getSourceFilterList(source)) {
          if (isVisualSidechainKind(filter.filterKind) && !(source === inputUuid && filter.filterName === SHADER_NAME)) others.push(filter.filterName);
        }
      } catch {
        // A source that cannot be read might hold one: fail closed.
        others.push(`unreadable ${source}`);
      }
    }
    if (others.length > 0) {
      log(`Panic and Restore skipped: other Visual Sidechain filters may exist (${others.length})`);
    } else {
      const logFile = newestLog(startedAt);
      if (!logFile) throw new Error("this run's OBS log was not found");
      const before = (await client.getSourceFilter(inputUuid, SHADER_NAME)).filterSettings;
      let during: Record<string, unknown> = {};
      let panicked = false;
      try {
        await safety.panic();
        panicked = true;
        const panicLine = await logHas(logFile, "Panic hotkey triggered");
        let refused = "";
        try {
          await filters.nudge(mix, 0.1, Date.now() + 10000);
        } catch (error) {
          refused = (error as Error).message;
        }
        during = (await client.getSourceFilter(inputUuid, SHADER_NAME)).filterSettings;
        const zeroed = Object.keys(during).filter((key) => during[key] !== before[key]);
        expect("Panic", safety.isLatched() && panicLine && refused === "Restore first",
          `latched ${String(safety.isLatched())}, log line ${panicLine ? "found" : "missing"}, a turn ${refused || "not refused"}, settings Panic wrote: ${zeroed.join(", ") || "none"}`);
      } finally {
        // Panic is never left standing, whatever failed above.
        if (panicked) await safety.restore();
      }
      const restoreLine = await logHas(logFile, "Restore hotkey triggered");
      const after = (await client.getSourceFilter(inputUuid, SHADER_NAME)).filterSettings;
      // A uniform OBS left at its default is absent before Panic; Restore writes the saved value back explicitly.
      const changed = Object.keys({ ...before, ...during, ...after }).filter((key) => after[key] !== before[key] || during[key] !== before[key])
        .map((key) => `${key} ${String(before[key] ?? "default")} -> ${String(during[key] ?? "default")} -> ${String(after[key] ?? "default")}`);
      expect("Restore", !safety.isLatched() && restoreLine && after.vs_effect_mix_pct === 20,
        `latched ${String(safety.isLatched())}, log line ${restoreLine ? "found" : "missing"}, Effect mix ${String(after.vs_effect_mix_pct)}, settings before -> during Panic -> after Restore: ${changed.join("; ") || "none"}`);
      log(`log: ${logFile}`);
    }
    release();
  } finally {
    // Removing the input removes its filters and its scene item.
    if (inputSent) {
      try {
        await client.sendObsRequest("RemoveInput", inputUuid ? { inputUuid } : { inputName: INPUT_NAME });
        log("removed the created source and its filters");
      } catch (error) {
        log(`could not remove the created source: ${(error as Error).message}`);
      }
    }
    client.stop();
    log("closing OBS (main window close of the process started here, as the operator would)");
    if (obs.pid !== undefined && obs.exitCode === null) {
      try {
        execFileSync("powershell", ["-NoProfile", "-Command",
          `$p = Get-Process -Id ${obs.pid} -ErrorAction SilentlyContinue; if ($p) { $p.CloseMainWindow() | Out-Null }`]);
      } catch {
        // Fall through to the wait below.
      }
      const closed = await Promise.race([exited.then(() => true), sleep(30000).then(() => false)]);
      if (!closed) {
        log("OBS did not close within 30 s; terminating it");
        obs.kill();
      }
    }
    log("results:");
    for (const result of results) log(`  ${result.ok ? "PASS" : "MISS"} ${result.check}: ${result.detail}`);
    if (results.some((result) => !result.ok)) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
