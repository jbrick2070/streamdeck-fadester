// SPDX-License-Identifier: GPL-2.0-or-later
// npm run opendeck:parity -- [--plugin <folder>] [--obs-root <folder>]
// Runs the Fadester plugin the way OpenDeck runs it (same command line, OpenDeck's plugin id, the Stream Deck plugin
// protocol over a WebSocket this script hosts) against a real, isolated OBS 33 (the portable copy tests/obs-live-
// conformance.ts uses, with its own test password), presses keys, and checks what OBS did. It is the stand-in for a
// person at the deck: OpenDeck itself needs a device and a screen, this needs neither.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { configDir, pluginFolderName } from "./opendeck.js";

const PLUGIN_ID = "com.jbrick2070.fadester-for-obs";
const FOLDER = pluginFolderName(PLUGIN_ID);

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const obsRoot = arg("--obs-root") ?? process.env.FADESTER_TEST_OBS ?? "C:\\Users\\jeffr\\OBS-Studio-33-Portable-StreamDeckFadester";
const pluginDir = arg("--plugin") ?? join(configDir(process.platform, process.env, homedir()), "plugins", FOLDER);
const wsConfig = JSON.parse(readFileSync(join(obsRoot, "config", "obs-studio", "plugin_config", "obs-websocket", "config.json"), "utf8")) as {
  server_port: number;
  server_password: string;
};

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(what: string, probe: () => Promise<T | undefined | false> | T | undefined | false, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

// ---- OBS: launch the isolated copy and speak obs-websocket 5 to it
function obsRunning(): boolean {
  return spawnSync("tasklist", ["/FI", "IMAGENAME eq obs64.exe", "/NH"], { encoding: "utf8" }).stdout.toLowerCase().includes("obs64.exe");
}

function launchObs(): ChildProcess {
  // The test copy is closed by force at the end of a run; clear its crash marker so the next launch does not stop to ask.
  rmSync(join(obsRoot, "config", "obs-studio", ".sentinel"), { recursive: true, force: true });
  const bin = join(obsRoot, "bin", "64bit");
  return spawn(join(bin, "obs64.exe"), ["--portable", "--disable-updater"], { cwd: bin, stdio: "ignore" });
}

class Obs {
  private socket!: WebSocket;
  private next = 1;
  private readonly waiting = new Map<string, (reply: { ok: boolean; data: Record<string, unknown>; comment?: string }) => void>();

  async connect(port: number, password: string): Promise<void> {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      const giveUp = setTimeout(() => reject(new Error("OBS did not finish the websocket handshake")), 5000);
      this.socket.on("error", reject);
      this.socket.on("close", () => {
        for (const waiting of this.waiting.values()) waiting({ ok: false, data: {}, comment: "the OBS websocket closed" });
        reject(new Error("the OBS websocket closed"));
      });
      this.socket.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as { op: number; d: Record<string, unknown> };
        if (message.op === 0) {
          const auth = message.d.authentication as { challenge: string; salt: string } | undefined;
          const identify: Record<string, unknown> = { rpcVersion: 1 };
          if (auth) {
            const secret = createHash("sha256").update(password + auth.salt).digest("base64");
            identify.authentication = createHash("sha256").update(secret + auth.challenge).digest("base64");
          }
          this.socket.send(JSON.stringify({ op: 1, d: identify }));
        } else if (message.op === 2) {
          clearTimeout(giveUp);
          resolve();
        }
        else if (message.op === 7) {
          const status = message.d.requestStatus as { result: boolean; comment?: string };
          this.waiting.get(String(message.d.requestId))?.({ ok: status.result, data: (message.d.responseData ?? {}) as Record<string, unknown>, comment: status.comment });
        }
      });
    });
  }

  async call(requestType: string, requestData: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const requestId = `r${this.next++}`;
    const reply = new Promise<{ ok: boolean; data: Record<string, unknown>; comment?: string }>((resolve) => this.waiting.set(requestId, resolve));
    this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    const result = await Promise.race([reply, sleep(10000).then(() => ({ ok: false, data: {}, comment: "no answer from OBS in 10 s" }))]);
    this.waiting.delete(requestId);
    if (!result.ok) throw new Error(`${requestType}: ${result.comment ?? "failed"}`);
    return result.data;
  }

  close(): void {
    this.socket?.close();
  }
}

// ---- The host: what OpenDeck is to a plugin
interface Sent {
  event: string;
  context?: string;
  payload?: Record<string, unknown>;
}

class Host {
  readonly server: WebSocketServer;
  readonly received: Sent[] = [];
  readonly globalWrites: Array<Record<string, unknown>> = [];
  private plugin: WebSocket | null = null;
  private readonly timers: Array<ReturnType<typeof setTimeout>> = [];
  registered = false;

  constructor(readonly globalSettings: Record<string, unknown>) {
    this.server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    this.server.on("connection", (socket) => {
      this.plugin = socket;
      socket.on("message", (raw) => this.onPlugin(JSON.parse(String(raw)) as Sent & { uuid?: string }));
    });
  }

  get port(): number {
    return (this.server.address() as { port: number }).port;
  }

  private send(message: Record<string, unknown>): void {
    if (this.plugin?.readyState === WebSocket.OPEN) this.plugin.send(JSON.stringify(message));
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.server.close();
  }

  private onPlugin(message: Sent & { uuid?: string }): void {
    this.received.push(message);
    if (message.event === "registerPlugin") this.registered = message.uuid === FOLDER;
    // Like Stream Deck, the answer to a read carries the read's id (the SDK hands it to that read only).
    if (message.event === "getGlobalSettings") this.send({ event: "didReceiveGlobalSettings", id: (message as { id?: string }).id, payload: { settings: this.globalSettings } });
    if (message.event === "getSettings") this.send({ event: "didReceiveSettings", context: message.context, payload: { settings: {} } });
    // Like Stream Deck, a write replaces what is stored.
    if (message.event === "setGlobalSettings" && message.payload) {
      for (const key of Object.keys(this.globalSettings)) delete this.globalSettings[key];
      Object.assign(this.globalSettings, message.payload);
      this.globalWrites.push({ ...message.payload });
    }
  }

  deviceUp(device: string): void {
    this.send({ event: "deviceDidConnect", device, deviceInfo: { name: "Parity deck", type: 7, size: { columns: 4, rows: 2 } } });
  }

  appear(action: string, context: string, device: string, settings: Record<string, unknown>, column: number, controller: "Keypad" | "Encoder" = "Keypad"): void {
    this.send({ event: "willAppear", action, context, device, payload: { settings, coordinates: { column, row: controller === "Keypad" ? 0 : 2 }, controller, isInMultiAction: false, state: 0 } });
  }

  /** A settings page's message to the plugin (what a property inspector's sendToPlugin becomes on the plugin's side). */
  fromPage(action: string, context: string, device: string, payload: Record<string, unknown>): void {
    this.send({ event: "sendToPlugin", action, context, device, payload });
  }

  rotate(action: string, context: string, device: string, settings: Record<string, unknown>, column: number, ticks: number): void {
    this.send({ event: "dialRotate", action, context, device, payload: { settings, coordinates: { column, row: 2 }, controller: "Encoder", ticks, pressed: false } });
  }

  press(action: string, context: string, device: string, settings: Record<string, unknown>, column: number): void {
    const payload = { settings, coordinates: { column, row: 0 }, controller: "Keypad", isInMultiAction: false, state: 0 };
    this.send({ event: "keyDown", action, context, device, payload });
    this.timers.push(setTimeout(() => this.send({ event: "keyUp", action, context, device, payload }), 60));
  }

  of(context: string, event: string): Sent[] {
    return this.received.filter((message) => message.context === context && message.event === event);
  }
}

async function main(): Promise<number> {
  if (!existsSync(join(pluginDir, "bin", "plugin.js"))) throw new Error(`${pluginDir} has no bin/plugin.js; run npm run opendeck:install first`);
  if (obsRunning()) throw new Error("obs64.exe is already running; this run will not touch an OBS that is not its own");
  console.log(`plugin ${pluginDir}\nOBS    ${obsRoot} (port ${wsConfig.server_port})\n`);

  const obs = new Obs();
  let host: Host | null = null;
  let plugin: ChildProcess | null = null;
  let obsProcess: ChildProcess | null = null;
  let cleaned = false;
  // Closes everything this run started, and nothing else: the plugin, the host, and the OBS it launched itself.
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    plugin?.kill();
    obs.close();
    host?.stop();
    if (obsProcess?.pid) {
      spawnSync("powershell.exe", ["-NoProfile", "-Command", `$p = Get-Process -Id ${obsProcess.pid} -ErrorAction SilentlyContinue; if ($p) { $null = $p.CloseMainWindow(); Start-Sleep 5; if (!$p.HasExited) { $p.Kill() } }`]);
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      cleanup();
      process.exit(130);
    });
  }

  try {
    host = new Host({ host: "127.0.0.1", port: wsConfig.server_port, password: wsConfig.server_password });
    obsProcess = launchObs();
    obsProcess.on("error", (error) => console.error(`could not start OBS: ${error.message}`));
    await until("OBS to answer", async () => {
      try {
        await obs.connect(wsConfig.server_port, wsConfig.server_password);
        return true;
      } catch {
        return false;
      }
    }, 40000);
    await sleep(1500);
    // Three scenes, Studio Mode off: the plain case the Scene & Transition key starts from. They stay in the test copy.
    for (const name of ["ParityA", "ParityB", "ParityC"]) await obs.call("CreateScene", { sceneName: name }).catch(() => undefined);
    await obs.call("SetStudioModeEnabled", { studioModeEnabled: false });
    // OBS's own order, as the plugin reads it: highest sceneIndex first.
    const scenes = async (): Promise<string[]> =>
      ((await obs.call("GetSceneList")).scenes as Array<{ sceneName: string; sceneIndex: number }>).sort((a, b) => b.sceneIndex - a.sceneIndex).map((s) => s.sceneName);
    const order = await scenes();
    check("OBS has the three test scenes", ["ParityA", "ParityB", "ParityC"].every((n) => order.includes(n)), order.join(", "));
    const program = async (): Promise<string> => String((await obs.call("GetCurrentProgramScene")).sceneName);
    const setProgram = async (name: string): Promise<void> => {
      await obs.call("SetCurrentProgramScene", { sceneName: name });
      await sleep(700); // the plugin hears of the change from OBS's events before the key is pressed
    };

    // The plugin, started exactly as OpenDeck starts it (plugin folder as the working directory, relative code path).
    const info = JSON.stringify({
      application: { font: "ui-sans-serif", language: "en", platform: "windows", platformVersion: "10.0.19045.4474", version: "7.1.0" },
      plugin: { uuid: FOLDER, version: "0.9.1.0" },
      devicePixelRatio: 0,
      colors: {},
      devices: []
    });
    plugin = spawn("node", ["bin/plugin.js", "-port", String(host.port), "-pluginUUID", FOLDER, "-registerEvent", "registerPlugin", "-info", info], { cwd: pluginDir, stdio: "ignore" });
    plugin.on("error", (error) => console.error(`could not start the plugin: ${error.message}`));
    await until("the plugin to register", () => host!.registered, 15000);
    await until("the plugin to ask for its settings", () => host!.received.some((m) => m.event === "getGlobalSettings"));
    check("the plugin registers under OpenDeck's plugin id (the folder name) and asks for its global settings", host.registered, FOLDER);

    const device = "sd-PARITY";
    host.deviceUp(device);
    const SCENE = `${PLUGIN_ID}.scene-transition`;
    const keyNext = { context: `${device}.Default.Keypad.0.0`, column: 0, settings: { sceneTarget: "__next_scene__", operation: "cut", transitionName: "__cut__", labelOverride: "", accent: "default" } };
    const keyC = { context: `${device}.Default.Keypad.1.0`, column: 1, settings: { sceneTarget: "ParityC", operation: "cut", transitionName: "__cut__", labelOverride: "", accent: "default" } };
    for (const key of [keyNext, keyC]) host.appear(SCENE, key.context, device, key.settings, key.column);
    await until("the keys to draw", () => host!.of(keyNext.context, "setImage").length > 0 && host!.of(keyC.context, "setImage").length > 0, 15000);
    check("keys draw an image when they appear, and none shows an alert while OBS is connected",
      host.of(keyNext.context, "showAlert").length === 0 && host.of(keyC.context, "showAlert").length === 0,
      `${host.of(keyNext.context, "setImage").length} and ${host.of(keyC.context, "setImage").length} image(s)`);
    await sleep(1500);

    // Next scene, from the first scene in OBS's list, goes to the second; from the last it wraps to the first.
    const press = (key: typeof keyNext): void => host!.press(SCENE, key.context, device, key.settings, key.column);
    await setProgram(order[0]);
    press(keyNext);
    const second = await until("OBS to leave the first scene", async () => ((await program()) !== order[0] ? await program() : false));
    check("Next scene (cut) goes from the first scene to the second in OBS's list", second === order[1], `${order[0]} -> ${second}`);

    await setProgram(order[order.length - 1]);
    press(keyNext);
    const wrapped = await until("OBS to leave the last scene", async () => ((await program()) !== order[order.length - 1] ? await program() : false));
    check("Next scene wraps round from the last scene to the first", wrapped === order[0], `${order[order.length - 1]} -> ${wrapped}`);

    // A key set to one scene cuts to it, from a scene that is not that one.
    const elsewhere = order.find((name) => name !== "ParityC") as string;
    await setProgram(elsewhere);
    press(keyC);
    const direct = await until("OBS to cut to ParityC", async () => ((await program()) === "ParityC" ? "ParityC" : false));
    check("a key set to one scene cuts to that scene", direct === "ParityC", `${elsewhere} -> ${direct}`);

    // An audio input to fade and ride: a desktop-audio capture is the one input kind every Windows OBS has.
    const input = "ParityAudio";
    await obs.call("RemoveInput", { inputName: input }).catch(() => undefined); // left over from a run that stopped early
    await sleep(1000); // OBS frees the name a moment after it removes the input
    let madeError = "";
    const made = await obs.call("CreateInput", { sceneName: "ParityA", inputName: input, inputKind: "wasapi_output_capture", inputSettings: {} }).then(() => true, (error: Error) => {
      madeError = error.message;
      return false;
    });
    if (!made) {
      check("an audio input could be created for the fade and dial checks", false, madeError);
    } else {
      const volume = async (): Promise<number> => Number((await obs.call("GetInputVolume", { inputName: input })).inputVolumeMul);
      await obs.call("SetInputVolume", { inputName: input, inputVolumeMul: 1 });
      await sleep(2500); // the plugin learns of a new input from OBS's events; a key pressed before that has no input to find

      const FADE = `${PLUGIN_ID}.obs-fade`;
      const fade = { context: `${device}.Default.Keypad.2.0`, column: 2, settings: { inputName: input, to: 0, durationMs: 400, labelOverride: "", accent: "default" } };
      host.appear(FADE, fade.context, device, fade.settings, fade.column);
      await until("the fade key to draw", () => host!.of(fade.context, "setImage").length > 0, 15000);
      host.press(FADE, fade.context, device, fade.settings, fade.column);
      await sleep(2000);
      const faded = await volume();
      check("a fade key takes an audio input down to silence in OBS", faded < 0.05, `volume ${faded.toFixed(3)}, ${host.of(fade.context, "showAlert").length} alert(s) on the key`);

      await obs.call("SetInputVolume", { inputName: input, inputVolumeMul: 1 });
      const FADER = `${PLUGIN_ID}.obs-fader`;
      const dial = { context: `${device}.Default.Encoder.0.0`, column: 0, settings: { target: "input_volume", inputName: input, stepPerTick: 0.05, acceleration: false, labelOverride: "", accent: "default" } };
      host.appear(FADER, dial.context, device, dial.settings, dial.column, "Encoder");
      await until("the dial to draw", () => host!.of(dial.context, "setFeedback").length + host!.of(dial.context, "setImage").length > 0, 15000);
      const strips = host.of(dial.context, "setFeedback").map((m) => String((m.payload as { canvas?: unknown } | undefined)?.canvas ?? ""));
      check("a dial draws its touch-strip feedback when it appears", strips.length > 0, `${strips.length} feedback message(s)`);
      // OpenDeck's strip renderer reads only a base64 picture; any other form is drawn as a grey and black checkerboard.
      check("every strip picture is base64, the one form OpenDeck's strip renderer reads", strips.length > 0 && strips.every((uri) => uri.startsWith("data:image/svg+xml;base64,")), strips[0]?.slice(0, 30));
      await sleep(800);
      host.rotate(FADER, dial.context, device, dial.settings, dial.column, -4);
      await sleep(1500);
      const lowered = await volume();
      check("turning a dial down lowers the input's volume in OBS", lowered < 0.95, `volume ${lowered.toFixed(3)}, ${host.of(dial.context, "showAlert").length} alert(s) on the dial`);
      host.rotate(FADER, dial.context, device, dial.settings, dial.column, 20);
      await sleep(1500);
      const raised = await volume();
      check("turning it up raises the volume again", raised > lowered, `volume ${raised.toFixed(3)}`);
      await obs.call("RemoveInput", { inputName: input }).catch(() => undefined);
    }

    // The suite also carries VJster: its keys draw, and its settings are kept apart from Fadester's.
    const manifest = JSON.parse(readFileSync(join(pluginDir, "manifest.json"), "utf8")) as { Actions: Array<{ UUID: string }> };
    const VJSTER_PRESET = `${PLUGIN_ID}.vjster-speed-preset`;
    if (manifest.Actions.some((a) => a.UUID === VJSTER_PRESET)) {
      const preset = { context: `${device}.Default.Keypad.3.0`, column: 3, settings: {} as Record<string, unknown> };
      host.appear(VJSTER_PRESET, preset.context, device, preset.settings, preset.column);
      await until("the VJster key to draw", () => host!.of(preset.context, "setImage").length > 0, 15000);
      check("a VJster key draws an image through the suite, with no alert", host.of(preset.context, "showAlert").length === 0, `${host.of(preset.context, "setImage").length} image(s)`);
      const listening = async (port: number): Promise<boolean> => {
        const net = await import("node:net");
        return new Promise((resolve) => {
          const socket = net.connect(port, "127.0.0.1");
          socket.once("connect", () => {
            socket.destroy();
            resolve(true);
          });
          socket.once("error", () => resolve(false));
        });
      };
      await until("VJster's link on its default port", () => listening(48150), 10000);
      check("VJster's link server starts on its own port, not Fadester's OBS port", true, "127.0.0.1:48150");

      const fadesterKeys = { host: host.globalSettings.host, port: host.globalSettings.port, password: host.globalSettings.password };
      host.fromPage(VJSTER_PRESET, preset.context, device, { event: "suiteGlobal", settings: { port: 48155 } });
      const stored = host.globalSettings as { vjster?: { port?: number } } & Record<string, unknown>;
      await until("the settings write", () => stored.vjster?.port === 48155, 8000).catch(() => undefined);
      check("a VJster settings save keeps Fadester's settings and files its own under vjster",
        stored.host === fadesterKeys.host && stored.port === fadesterKeys.port && stored.password === fadesterKeys.password && stored.vjster?.port === 48155,
        `keys: ${Object.keys(stored).join(", ")}`);
      await until("VJster's link on the new port", () => listening(48155), 10000);
      check("VJster applies the saved port", true, "127.0.0.1:48155");

      // A child that stops is started again and given the key that was showing (Windows: the child is found by its command line).
      if (process.platform === "win32") {
        // The suite starts the VJster plugin from bin/vjster/plugin.js with a plugin id that begins "suite-".
        const find = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*vjster*plugin.js*' -and $_.CommandLine -like '*suite-*' } | ForEach-Object { $_.ProcessId }";
        const pids = spawnSync("powershell.exe", ["-NoProfile", "-Command", find], { encoding: "utf8" }).stdout.split(/\s+/).filter(Boolean);
        const before = host.of(preset.context, "setImage").length;
        for (const pid of pids) spawnSync("taskkill", ["/PID", pid, "/F"]);
        check("a VJster process was found to stop", pids.length > 0, `${pids.length} process(es)`);
        await until("the VJster key to be drawn again by the restarted plugin", () => host!.of(preset.context, "setImage").length > before, 20000).catch(() => undefined);
        check("a stopped VJster plugin is started again and draws its key", host.of(preset.context, "setImage").length > before, `${host.of(preset.context, "setImage").length - before} new image(s)`);
        await until("VJster's link on the saved port after the restart", () => listening(48155), 10000).catch(() => undefined);
        check("the restarted VJster plugin has its saved port", await listening(48155), "127.0.0.1:48155");
      }
    }

    const alerts = host.received.filter((m) => m.event === "showAlert").length;
    check("no alert was shown during the run", alerts === 0, `${alerts} alert(s)`);
  } catch (error) {
    check("run completed", false, error instanceof Error ? error.message : String(error));
  } finally {
    cleanup();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  return failed.length === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
