// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Automated part of the Playlister transport acceptance (PLAN.md 9.7): starts
 * the portable OBS 33 (Playlister 0.5.0 installed), connects with the direct
 * client, finds or creates an obs_playlister_source, exercises Play/pause,
 * Stop, Restart, Next and Previous through the client, logs the observed
 * states, removes what it created and closes OBS cleanly. The by-eye part
 * (Program output, the OBS log) stays with the operator.
 *
 * Run: node --import tsx tests/playlister-live-check.ts
 * It refuses to run while another obs64 is up.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect as netConnect } from "node:net";
import { DirectObsClient, MediaOperation, MediaTargetState, PLAYLISTER_INPUT_KIND } from "../src/obs/direct-obs-client.js";

const OBS_ROOT = "C:\\Users\\jeffr\\OBS-Studio-33-Portable";
const OBS_BIN = join(OBS_ROOT, "bin", "64bit");
const CLIPS = "C:\\Users\\jeffr\\Documents\\ComfyUI\\output\\otr\\obs";
const INPUT_NAME = "Fadester live check";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line: string): void => console.log(`${new Date().toISOString().slice(11, 23)} ${line}`);

function obsRunning(): boolean {
  const list = execFileSync("tasklist", ["/FI", "IMAGENAME eq obs64.exe", "/NH"], { encoding: "utf8" });
  return /obs64\.exe/i.test(list);
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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

async function main(): Promise<void> {
  if (obsRunning()) throw new Error("ABORT: obs64.exe is already running; this check never shares an OBS.");
  const config = JSON.parse(readFileSync(join(OBS_ROOT, "config", "obs-studio", "plugin_config", "obs-websocket", "config.json"), "utf8")) as
    { server_port: number; server_password: string };
  // Two clips, so Next and Previous change the item rather than reload the same one.
  const clips = readdirSync(CLIPS).filter((name) => name.endsWith(".mp4")).slice(0, 2);
  if (clips.length === 0) throw new Error(`No .mp4 in ${CLIPS}`);

  log("starting the portable OBS");
  const obs = spawn(join(OBS_BIN, "obs64.exe"), ["--portable", "--disable-updater", "--multi"], { cwd: OBS_BIN, stdio: "ignore" });
  const client = new DirectObsClient({ host: "127.0.0.1", port: config.server_port, password: config.server_password });
  let created = "";
  const findings: string[] = [];
  try {
    await waitForPort(config.server_port, 60000);
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("OBS did not identify within 30 s")), 30000);
      client.on("statusChanged", (status: { kind: string }) => { if (status.kind === "connected") { clearTimeout(timer); resolve(); } });
    });
    client.start();
    await connected;
    log(`connected; media capability ${client.getMediaCapability()}`);
    findings.push(`capability ${client.getMediaCapability()}`);

    let uuid = client.getCatalog().inputDetails.find((input) => input.unversionedInputKind === PLAYLISTER_INPUT_KIND)?.inputUuid ?? "";
    if (!uuid) {
      // The first catalog can precede OBS's scene load; a scene name is needed to create into.
      for (let tries = 0; !client.getCatalog().currentProgramScene && tries < 40; tries++) {
        await sleep(250);
        await client.refreshCatalog();
      }
      const sceneName = client.getCatalog().currentProgramScene;
      if (!sceneName) throw new Error("OBS reported no Program scene to create the source in");
      log(`no Playlister source: creating "${INPUT_NAME}" in scene "${sceneName}" with ${clips.join(", ")}`);
      const reply = await client.sendObsRequest("CreateInput", {
        sceneName, inputName: INPUT_NAME, inputKind: PLAYLISTER_INPUT_KIND,
        inputSettings: { playlist: clips.map((clip) => ({ value: join(CLIPS, clip) })), loop: true }, sceneItemEnabled: true
      });
      created = String(reply.inputUuid ?? "");
      await client.refreshCatalog();
      uuid = created;
    }
    const name = client.mediaInputName(uuid);
    log(`target ${name} (${uuid}) availability ${client.mediaAvailability(uuid)}`);

    const seen: string[] = [];
    client.on("mediaStateChanged", (id: string, state: MediaTargetState) => {
      if (id !== uuid) return;
      const line = `${state.mediaState} pending=${state.pending}` +
        (state.mediaCursor !== null ? ` ${state.mediaCursor}/${state.mediaDuration}` : "");
      if (seen.at(-1) !== line) { seen.push(line); log(`  observed ${line}`); }
    });
    const release = client.watchMedia(uuid);
    await sleep(1500);
    const run = async (op: MediaOperation, settleMs: number): Promise<void> => {
      log(`press ${op}`);
      try {
        const outcome = await client.mediaCommand(uuid, op);
        log(`  outcome ${outcome}`);
      } catch (error) {
        log(`  refused: ${(error as Error).message}`);
      }
      await sleep(settleMs);
      const state = client.getMediaState(uuid);
      findings.push(`${op} -> ${state.mediaState} pending=${state.pending}`);
    };
    await run("playpause", 4000);
    await run("playpause", 2500);
    await run("playpause", 2500);
    await run("stop", 2000);
    await run("restart", 4000);
    await run("next", 4000);
    await run("previous", 4000);
    await run("stop", 1500);
    release();
    log("findings:");
    for (const finding of findings) log(`  ${finding}`);
  } finally {
    if (created) {
      try {
        await client.sendObsRequest("RemoveInput", { inputUuid: created });
        log("removed the created source");
      } catch (error) {
        log(`could not remove the created source: ${(error as Error).message}`);
      }
    }
    client.stop();
    log("closing OBS (main window close of the process started here, as the operator would)");
    try {
      execFileSync("powershell", ["-NoProfile", "-Command",
        `$p = Get-Process -Id ${obs.pid} -ErrorAction SilentlyContinue; if ($p) { $p.CloseMainWindow() | Out-Null }`]);
    } catch {
      // Fall through to the wait below.
    }
    const deadline = Date.now() + 30000;
    while (obsRunning() && Date.now() < deadline) await sleep(500);
    if (obsRunning()) {
      log("OBS did not close within 30 s; terminating it");
      obs.kill();
    }
    log(existsSync(join(OBS_ROOT, "config", "obs-studio", "logs")) ? "OBS log folder: " + join(OBS_ROOT, "config", "obs-studio", "logs") : "done");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
