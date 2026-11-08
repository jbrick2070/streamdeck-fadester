// SPDX-License-Identifier: GPL-2.0-or-later
// Explicit Mac-only live test. Injected SDK input, NOT hardware or Elgato-host certification.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, release } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { checkedCall, liveConfig, ObsRequestFailure, removeOwnedInput, requireExpectedView, requireIdle, requireOnlyFixtureInputs, requireUnchangedFixtures, silentWav, type ExpectedView, type Json, type ObservedInput, type Owned, type SceneItem, type View } from "./live-safety.js";

const PLUGIN = "io.github.jbrick2070.fadester-for-obs";
const MIX = "io.github.jbrick2070.fadester.mix.v1";
const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const record = (value: unknown): Json => value && typeof value === "object" ? value as Json : {};
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.map(record) : [];
async function until(label: string, check: () => boolean | Promise<boolean>, timeout = 10000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(40); }
  throw new Error(`Timed out: ${label}`);
}

class Obs {
  private socket?: WebSocket;
  private pending = new Map<string, { resolve: (data: Json) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  readonly custom: Json[] = [];
  fixtureRevision = 0;
  viewRevision = 0;
  onHazard: (reason: string) => void = () => {};
  async connect(port: number, password: string): Promise<void> {
    const socket = this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => { socket.terminate(); reject(new Error("OBS handshake timed out")); }, 5000);
      const fail = (): void => { clearTimeout(timer); reject(new Error("Local authenticated OBS connection closed")); };
      socket.on("error", fail);
      socket.on("close", () => { fail(); this.onHazard("OBS disconnected"); this.rejectPending(); });
      socket.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as { op: number; d: Json };
        const d = message.d;
        if (message.op === 0) {
          const auth = record(d.authentication);
          if (typeof auth.salt !== "string" || typeof auth.challenge !== "string") {
            socket.terminate(); clearTimeout(timer); reject(new Error("OBS authentication is disabled; refusing live tests")); return;
          }
          const secret = createHash("sha256").update(password + auth.salt).digest("base64");
          const authentication = createHash("sha256").update(secret + auth.challenge).digest("base64");
          socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 2047, authentication } }));
        } else if (message.op === 2) { clearTimeout(timer); resolveReady(); }
        else if (message.op === 7) {
          const id = String(d.requestId), pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id); clearTimeout(pending.timer);
          const status = record(d.requestStatus);
          if (status.result === true) pending.resolve(record(d.responseData));
          else pending.reject(new ObsRequestFailure(String(d.requestType), Number(status.code)));
        } else if (message.op === 5) {
          const event = String(d.eventType), data = record(d.eventData);
          if (/^(Input(Created|Removed|NameChanged)|Scene(Created|Removed|NameChanged)|SceneItem(Created|Removed|ListReindexed))$/.test(event)) this.fixtureRevision++;
          if (/^(CurrentProgramSceneChanged|CurrentPreviewSceneChanged|StudioModeStateChanged)$/.test(event)) this.viewRevision++;
          if (event === "CustomEvent") this.custom.push(data);
          if (/^(Stream|Record|ReplayBuffer|Virtualcam)StateChanged$/.test(event) && data.outputActive === true) this.onHazard("An OBS output started");
          if (event === "CurrentSceneCollectionChanging" || event === "CurrentSceneCollectionChanged") this.onHazard("OBS scene collection changed");
        }
      });
    });
  }
  call = (requestType: string, requestData: Json = {}): Promise<Json> => {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("OBS is not connected"));
    const requestId = randomUUID();
    return new Promise((resolveReply, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`OBS ${requestType} timed out`)); }, 5000);
      this.pending.set(requestId, { resolve: resolveReply, reject, timer });
      this.socket!.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  };
  async mix(op: string): Promise<Json> {
    const id = randomUUID();
    await this.call("BroadcastCustomEvent", { eventData: { namespace: MIX, id, op, sentAtMs: Date.now() } });
    await until("correlated mix-provider receipt", () => this.custom.some((e) => e.namespace === MIX && e.id === id && e.op === "reply"));
    const reply = this.custom.find((e) => e.namespace === MIX && e.id === id && e.op === "reply")!;
    if (reply.ok !== true || reply.enabled !== true) throw new Error("Mix provider declined or is disabled");
    return reply;
  }
  private rejectPending(): void { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("OBS disconnected")); } this.pending.clear(); }
  close(): void { this.onHazard = () => {}; this.rejectPending(); this.socket?.terminate(); }
}

type Control = { action: string; context: string; settings: Json; controller: "Keypad" | "Encoder" };
class SimulatedHost {
  private server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  private socket?: WebSocket;
  readonly received: Json[] = [];
  registered = false;
  constructor(private settings: Json) {
    this.server.on("connection", (socket) => {
      if (this.socket) { socket.close(); return; }
      this.socket = socket;
      socket.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as Json;
        // Never record global-settings payloads: they contain the in-memory OBS password.
        if (!String(message.event).includes("GlobalSettings")) this.received.push(message);
        if (message.event === "registerPlugin") this.registered = message.uuid === PLUGIN;
        if (message.event === "getGlobalSettings") this.send({ event: "didReceiveGlobalSettings", id: message.id, payload: { settings: this.settings } });
        if (message.event === "setGlobalSettings") this.settings = record(message.payload);
      });
    });
  }
  async port(): Promise<number> { await until("simulated SDK listener", () => this.server.address() !== null); return (this.server.address() as { port: number }).port; }
  send(message: Json): void { if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Simulated SDK disconnected"); this.socket.send(JSON.stringify(message)); }
  message(control: Control, event: string, extra: Json = {}): void {
    this.send({ event, action: control.action, context: control.context, device: "mac-live-simulation", payload: {
      settings: control.settings, coordinates: { column: 0, row: 0 }, controller: control.controller,
      isInMultiAction: false, state: 0, ...extra
    } });
  }
  async place(kind: string, settings: Json, controller: "Keypad" | "Encoder" = "Keypad"): Promise<Control> {
    const control = { action: `${PLUGIN}.${kind}`, context: randomUUID(), settings, controller };
    this.message(control, "willAppear");
    await until("packaged action feedback", () => this.received.some((m) => m.context === control.context && ["setImage", "setFeedback"].includes(String(m.event))));
    return control;
  }
  async press(control: Control): Promise<void> { this.message(control, "keyDown"); await delay(30); this.message(control, "keyUp"); }
  async state(control: Control, predicate: (state: Json) => boolean): Promise<void> {
    this.message(control, "propertyInspectorDidAppear");
    await until("packaged OBS state", async () => {
      this.send({ event: "sendToPlugin", action: control.action, context: control.context, device: "mac-live-simulation", payload: { event: "directPiReady" } });
      await delay(40);
      const latest = this.received.filter((m) => m.context === control.context && record(m.payload).event === "directObsState").at(-1);
      return Boolean(latest && predicate(record(latest.payload)));
    });
  }
  noAlerts(): void { if (this.received.some((m) => m.event === "showAlert")) throw new Error("A packaged action reported an alert"); }
  close(): void { for (const client of this.server.clients) client.terminate(); this.server.close(); }
}

async function unusedPort(): Promise<number> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await until("temporary port allocation", () => server.address() !== null);
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
async function stopOwnedGroup(child?: ChildProcess): Promise<void> {
  if (!child?.pid) return;
  const signal = (sig: NodeJS.Signals): void => { try { process.kill(-child.pid!, sig); } catch { /* owned group has already ended */ } };
  signal("SIGTERM");
  await until("temporary plugin exit", () => child.exitCode !== null || child.signalCode !== null, 2500).catch(() => signal("SIGKILL"));
}

export async function main(): Promise<void> {
  const config = liveConfig(process.platform, process.env); // before any socket, fixture or process
  const source = resolve(process.argv[2] ?? `${PLUGIN}.sdPlugin`);
  const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")) as Json;
  if (manifest.UUID !== PLUGIN || !rows(manifest.OS).some((os) => os.Platform === "mac") || !existsSync(join(source, "bin/plugin.js"))) throw new Error("Choose the built combined Mac-capable suite folder");
  const temp = mkdtempSync(join(tmpdir(), "fadester-mac-live-"));
  const prefix = `Fadester Mac Test ${randomUUID().slice(0, 8)} `;
  const ownedScenes: Owned[] = [], ownedInputs: Owned[] = [], ownedItems: SceneItem[] = [];
  const obs = new Obs();
  let host: SimulatedHost | undefined, child: ChildProcess | undefined;
  let collection = "", originalProgram = "", originalPreview = "", originalStudio = false, mixTouched = false, hazard = "", modified = false;
  let originalProgramIdentity: Owned | undefined, originalPreviewIdentity: Owned | undefined;
  let expectedView: ExpectedView | undefined;
  let failure: unknown;
  const checkHazard = (): void => { if (hazard) throw new Error(hazard); };
  const call = checkedCall(obs.call, checkHazard);
  const sceneRows = async (): Promise<Owned[]> => rows((await call("GetSceneList")).scenes).map((s) => ({ name: String(s.sceneName), uuid: String(s.sceneUuid ?? "") }));
  const inputRows = async (): Promise<ObservedInput[]> => rows((await call("GetInputList")).inputs).map((s) => ({ name: String(s.inputName), uuid: String(s.inputUuid ?? ""), kind: s.inputKind, caps: s.inputKindCaps }));
  const readView = async (): Promise<View> => {
    const revision = obs.viewRevision;
    const studioValue = (await call("GetStudioModeEnabled")).studioModeEnabled;
    if (typeof studioValue !== "boolean") throw new Error("Studio Mode state is unknown");
    const program = String((await call("GetCurrentProgramScene")).currentProgramSceneUuid ?? "");
    const preview = studioValue ? String((await call("GetCurrentPreviewScene")).currentPreviewSceneUuid ?? "") : "";
    if (obs.viewRevision !== revision) throw new Error("OBS view changed while reading cleanup state; preserving operator state");
    return { studio: studioValue, program, preview };
  };
  const sceneItems = async (scenes: Owned[]): Promise<SceneItem[]> => {
    const items: SceneItem[] = [], seen = new Set<string>();
    const queue = scenes.map((s) => ({ uuid: s.uuid, group: false }));
    for (let index = 0; index < queue.length; index++) {
      if (queue.length > 256 || items.length > 3000) throw new Error("Scene-item traversal limit exceeded; fixture references are unproven");
      const parent = queue[index];
      if (!parent.uuid) throw new Error("Scene or group identity is missing");
      if (seen.has(parent.uuid)) continue;
      seen.add(parent.uuid);
      const result = await call(parent.group ? "GetGroupSceneItemList" : "GetSceneItemList", { sceneUuid: parent.uuid });
      if (!Array.isArray(result.sceneItems)) throw new Error("Incomplete scene-item listing; fixture references are unproven");
      for (const item of rows(result.sceneItems)) {
        if (!Number.isInteger(item.sceneItemId) || typeof item.sourceUuid !== "string" || typeof item.sourceName !== "string") throw new Error("Scene-item identity is missing");
        items.push({ sceneUuid: parent.uuid, itemId: Number(item.sceneItemId), sourceUuid: item.sourceUuid, sourceName: item.sourceName });
        if (item.isGroup === true) queue.push({ uuid: item.sourceUuid, group: true });
      }
    }
    return items;
  };
  const guard = async (): Promise<void> => {
    checkHazard();
    await requireIdle(call);
    if (String((await call("GetSceneCollectionList")).currentSceneCollectionName) !== collection) throw new Error("OBS collection no longer matches this run");
    if (config.allowColorFixture) requireOnlyFixtureInputs(await inputRows(), ownedInputs, true);
    checkHazard();
  };
  const mutate = async (type: string, data: Json): Promise<Json> => { await guard(); checkHazard(); modified = true; return call(type, data); };
  const volume = async (name: string): Promise<number> => Number((await obs.call("GetInputVolume", { inputName: name })).inputVolumeMul);
  const check = (message: string): void => console.log(`PASS ${message}`);
  const interrupt = (): void => { hazard = "Test interrupted"; void stopOwnedGroup(child); };
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    await obs.connect(config.port, config.password);
    obs.onHazard = (reason) => { hazard = reason; void stopOwnedGroup(child); };
    await requireIdle(call);
    collection = String((await obs.call("GetSceneCollectionList")).currentSceneCollectionName);
    const originals = await sceneRows();
    originalProgram = String((await obs.call("GetCurrentProgramScene")).currentProgramSceneName);
    originalProgramIdentity = originals.find((s) => s.name === originalProgram && s.uuid);
    if (!originalProgramIdentity) throw new Error("Original Program scene cannot be identified safely");
    originalStudio = (await obs.call("GetStudioModeEnabled")).studioModeEnabled === true;
    if (originalStudio) {
      originalPreview = String((await obs.call("GetCurrentPreviewScene")).currentPreviewSceneName);
      originalPreviewIdentity = originals.find((s) => s.name === originalPreview && s.uuid);
      if (!originalPreviewIdentity) throw new Error("Original Preview scene cannot be identified safely");
    }
    expectedView = { studio: originalStudio, program: [originalProgramIdentity.uuid], preview: originalPreviewIdentity ? [originalPreviewIdentity.uuid] : [] };
    const cursor = Number((await obs.call("GetCurrentSceneTransitionCursor")).transitionCursor);
    if (cursor !== 0 && cursor !== 1) throw new Error("OBS is transitioning or its transition position is unknown");
    console.log("Injected Stream Deck SDK simulation against real local Mac OBS; no hardware or actual host-input claim.");
    const kinds = (await obs.call("GetInputKindList")).inputKinds as string[];
    const colorKind = ["color_source_v3", "color_source_v2", "color_source"].find((kind) => kinds.includes(kind));
    if (!colorKind || !kinds.includes("ffmpeg_source")) throw new Error("Required native color/media input kinds unavailable");
    const makeScene = async (suffix: string): Promise<Owned> => {
      const name = prefix + suffix;
      const made = await mutate("CreateScene", { sceneName: name });
      const item = { name, uuid: String(made.sceneUuid ?? "") };
      ownedScenes.push(item);
      if (!item.uuid) throw new Error("Created scene has no UUID; manual fixture cleanup required");
      return item;
    };
    const makeInput = async (scene: Owned, suffix: string, kind: string, settings: Json): Promise<Owned & { itemId: number }> => {
      const name = prefix + suffix;
      const made = await mutate("CreateInput", { sceneUuid: scene.uuid, inputName: name, inputKind: kind, inputSettings: settings, sceneItemEnabled: true });
      const item = { name, uuid: String(made.inputUuid ?? ""), itemId: Number(made.sceneItemId) };
      ownedInputs.push(item);
      if (!item.uuid || !Number.isInteger(item.itemId)) throw new Error("Created input lacks identity; manual fixture cleanup required");
      ownedItems.push({ sceneUuid: scene.uuid, itemId: item.itemId, sourceUuid: item.uuid, sourceName: item.name });
      return item;
    };
    const a = await makeScene("Blue"), b = await makeScene("Amber");
    const color = await makeInput(a, "Blue color", colorKind, { color: 0xffff0000, width: 640, height: 360 });
    await makeInput(b, "Amber color", colorKind, { color: 0xff00bfff, width: 640, height: 360 });
    const wav = join(temp, "silent.wav"); writeFileSync(wav, silentWav());
    const music = await makeInput(a, "Silent audio", "ffmpeg_source", { is_local_file: true, local_file: wav, looping: true });
    await mutate("SetInputMute", { inputUuid: music.uuid, inputMuted: true });
    await mutate("SetInputVolume", { inputUuid: music.uuid, inputVolumeMul: 0.5 });
    const transitions = rows((await obs.call("GetSceneTransitionList")).transitions);
    const cut = transitions.find((t) => t.transitionKind === "cut_transition")?.transitionName;
    if (typeof cut !== "string") throw new Error("OBS Cut transition unavailable");
    for (const scene of ownedScenes) await mutate("SetSceneSceneTransitionOverride", { sceneUuid: scene.uuid, transitionName: cut });
    expectedView.studio = true;
    expectedView.preview = [originalProgramIdentity.uuid, ...(originalPreviewIdentity ? [originalPreviewIdentity.uuid] : [])];
    await mutate("SetStudioModeEnabled", { studioModeEnabled: true });
    expectedView.program = [a.uuid];
    await mutate("SetCurrentProgramScene", { sceneUuid: a.uuid });
    expectedView.preview = [b.uuid];
    await mutate("SetCurrentPreviewScene", { sceneUuid: b.uuid });

    const copy = join(temp, `${PLUGIN}.sdPlugin`);
    cpSync(source, copy, { recursive: true, filter: (path) => !/(?:^|[\\/])logs(?:[\\/]|$)/.test(path) });
    const vjsterPort = await unusedPort();
    host = new SimulatedHost({ host: "127.0.0.1", port: config.port, password: config.password, vjster: { port: vjsterPort } });
    const info = { application: { font: "Arial", language: "en", platform: "mac", platformVersion: release(), version: "7.6.1" },
      plugin: { uuid: PLUGIN, version: manifest.Version }, devicePixelRatio: 1, colors: {},
      devices: [{ id: "mac-live-simulation", name: "Injected SDK simulation", type: 7, size: { columns: 4, rows: 2 } }] };
    const childEnv = { ...process.env }; delete childEnv.FADESTER_MAC_OBS_PASSWORD;
    child = spawn(process.execPath, ["bin/plugin.js", "-port", String(await host.port()), "-pluginUUID", PLUGIN, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], { cwd: copy, detached: true, stdio: "ignore", env: childEnv });
    child.on("error", () => { hazard = "Temporary packaged suite failed to start"; });
    await until("packaged suite registration", () => host!.registered);
    const scene = await host.place("scene-transition", { sceneTarget: b.name, operation: "cut", transitionName: "__cut__" });
    await host.state(scene, (state) => record(state.status).kind === "connected");
    check("packaged suite registers and authenticates local OBS");
    await guard();
    expectedView.program = [a.uuid, b.uuid]; expectedView.preview = [a.uuid, b.uuid];
    await host.press(scene);
    await until("program scene cut", async () => (await obs.call("GetCurrentProgramScene")).currentProgramSceneName === b.name);
    expectedView.program = [b.uuid];
    check("injected scene key changes actual Program");
    const layer = await host.place("layer-control", { scope: "fixed", sceneName: a.name, target: "fixed", sceneItemId: color.itemId, sourceUuid: color.uuid, sourceName: color.name, operation: "show_hide" });
    await guard(); await host.press(layer);
    await until("fixture visibility", async () => (await obs.call("GetSceneItemEnabled", { sceneUuid: a.uuid, sceneItemId: color.itemId })).sceneItemEnabled === false);
    check("injected layer key hides only the fixture color source");
    const dial = await host.place("obs-fader", { target: "input_volume", inputName: music.name, stepPerTick: 0.05, acceleration: false }, "Encoder");
    await guard(); host.message(dial, "dialRotate", { ticks: -2, pressed: false });
    await until("fixture audio gain", async () => Math.abs(await volume(music.name) - 0.4) < 0.001);
    const fade = await host.place("obs-fade", { inputName: music.name, to: 0, durationMs: 200 });
    await guard(); await host.press(fade);
    await until("fixture fade to silence", async () => await volume(music.name) < 0.001);
    if ((await obs.call("GetInputMute", { inputUuid: music.uuid })).inputMuted !== true) throw new Error("Fixture mute unexpectedly changed");
    check("injected dial and fade key change actual gain while the silent fixture remains muted");
    const vjster = await host.place("vjster-speed-preset", { rate: 1 });
    if (!vjster.context) throw new Error("VJster action missing");
    check("VJster child renders through the combined suite (no browser playback claim)");

    if (config.mix) {
      await guard(); requireOnlyFixtureInputs(await inputRows(), ownedInputs, config.allowColorFixture);
      const baseline = await obs.mix("mix.status");
      if (baseline.active !== false || baseline.fading !== false || baseline.db !== 0) throw new Error("Mix provider must be enabled, idle and at unity before the optional test");
      await mutate("SetInputVolume", { inputUuid: music.uuid, inputVolumeMul: 0.5 });
      const mixDial = await host.place("obs-fader", { target: "all_inputs" }, "Encoder");
      await host.state(mixDial, (state) => record(state.wholeMix).availability === "ready");
      const before = obs.custom.length;
      await guard(); requireOnlyFixtureInputs(await inputRows(), ownedInputs, config.allowColorFixture);
      mixTouched = true; host.message(mixDial, "dialRotate", { ticks: -1, pressed: false });
      await until("suite mix command and correlated applied receipt", async () => {
        await guard();
        const command = obs.custom.slice(before).find((e) => e.namespace === MIX && e.op === "mix.down");
        return !!command && obs.custom.slice(before).some((e) => e.namespace === MIX && e.id === command.id && e.op === "reply" && e.ok === true && e.enabled === true);
      });
      await until("actual mix gain change", async () => { await guard(); return await volume(music.name) < 0.49; });
      const restore = await host.place("obs-fade", { target: "all_inputs", to: 1 });
      await host.state(restore, (state) => record(state.wholeMix).availability === "ready");
      await guard(); await host.press(restore);
      await until("mix restored baseline", async () => { await guard(); return Math.abs(await volume(music.name) - 0.5) < 0.001; });
      await until("mix ownership released", async () => { await guard(); return (await obs.mix("mix.status")).active === false; });
      mixTouched = false; check("suite whole-mix command receives provider confirmation and actual gain is restored");
    } else console.log("SKIP optional whole-mix test (FADESTER_MAC_MIX is not 1)");
    host.noAlerts();
  } catch (error) { failure = error; }
  finally {
    await stopOwnedGroup(child); host?.close();
    try {
      if (modified) {
        // A changed collection, started output or disconnected OBS leaves fixtures in place.
        // Do not delete on-air sources or write into a different collection.
        if ([...ownedScenes, ...ownedInputs].some((item) => !item.uuid)) throw new Error("A fixture identity was not confirmed; manual cleanup required");
        if (!expectedView) throw new Error("Original OBS view was not captured");
        const remainingScenes = [...ownedScenes], remainingInputs = [...ownedInputs];
        let remainingItems = [...ownedItems];
        const detachedInputs = new Set<string>();
        let validatedRevision = -1;
        const preflight = async (): Promise<View> => {
          await guard();
          const revision = obs.fixtureRevision;
          const current = await sceneRows(), inputs = await inputRows(), items = await sceneItems(current);
          const stillOriginal = (original: Owned | undefined): boolean => !!original && current.some((s) => s.name === original.name && s.uuid === original.uuid);
          if (!stillOriginal(originalProgramIdentity) || (originalStudio && !stillOriginal(originalPreviewIdentity))) throw new Error("An original scene was removed, replaced or renamed; fixtures left in place");
          requireUnchangedFixtures(remainingScenes, remainingInputs, remainingItems, current, inputs, items, prefix, detachedInputs);
          const view = await readView(); requireExpectedView(view, expectedView!);
          if (revision !== obs.fixtureRevision) throw new Error("Fixture contents changed during cleanup preflight");
          validatedRevision = revision;
          checkHazard(); return view;
        };
        const cleanupWrite = async (type: string, data: Json): Promise<Json> => {
          await guard();
          requireExpectedView(await readView(), expectedView!);
          if (validatedRevision !== obs.fixtureRevision) throw new Error("Fixture contents changed after cleanup preflight");
          checkHazard();
          return call(type, data);
        };
        // Preflight every fixture and every scene/group reference before even restoring the view.
        // A skipped renamed input must never be destroyed indirectly by deleting its parent scene.
        const beforeRestore = await preflight();
        if (mixTouched) {
          requireOnlyFixtureInputs(await inputRows(), ownedInputs, config.allowColorFixture); checkHazard();
          await obs.mix("mix.restore"); checkHazard();
          await until("cleanup mix restore", async () => { await guard(); return (await obs.mix("mix.status")).active === false; });
          await preflight();
        }
        await cleanupWrite("SetCurrentProgramScene", { sceneUuid: originalProgramIdentity!.uuid });
        expectedView.program = [originalProgramIdentity!.uuid];
        expectedView.preview = [...new Set([...expectedView.preview, beforeRestore.program])];
        await until("original Program restored", async () => (await call("GetCurrentProgramScene")).currentProgramSceneUuid === originalProgramIdentity!.uuid);
        await until("restore transition idle", async () => { const c = Number((await call("GetCurrentSceneTransitionCursor")).transitionCursor); return c === 0 || c === 1; });
        await preflight();
        if (originalStudio) {
          await cleanupWrite("SetCurrentPreviewScene", { sceneUuid: originalPreviewIdentity!.uuid });
          expectedView.preview = [originalPreviewIdentity!.uuid];
          await preflight();
        }
        await cleanupWrite("SetStudioModeEnabled", { studioModeEnabled: originalStudio });
        expectedView.studio = originalStudio;
        for (const item of ownedInputs) {
          await removeOwnedInput(item, remainingItems.filter((entry) => entry.sourceUuid === item.uuid), {
            preflight, write: cleanupWrite, inputs: inputRows,
            detached: (entry) => {
              remainingItems = remainingItems.filter((other) => other !== entry);
              if (!remainingItems.some((other) => other.sourceUuid === item.uuid)) detachedInputs.add(item.uuid);
            },
            waitAbsent: () => until("detached fixture input removed", async () => {
              await preflight(); // Includes view/ownership checks during asynchronous destruction.
              return !(await inputRows()).some((input) => input.uuid === item.uuid);
            })
          });
          remainingInputs.splice(remainingInputs.findIndex((input) => input.uuid === item.uuid), 1);
          detachedInputs.delete(item.uuid);
        }
        for (const item of ownedScenes) {
          await preflight(); // In particular: parent scenes must now be completely empty.
          await cleanupWrite("RemoveScene", { sceneUuid: item.uuid });
          await until("fixture scene removed", async () => !(await sceneRows()).some((scene) => scene.uuid === item.uuid));
          remainingScenes.splice(remainingScenes.findIndex((scene) => scene.uuid === item.uuid), 1);
        }
        if ((await sceneRows()).some((s) => ownedScenes.some((o) => o.uuid === s.uuid)) || (await inputRows()).some((s) => ownedInputs.some((o) => o.uuid === s.uuid))) throw new Error("Some fixture identities changed; manual cleanup required");
        check("restored original Program/Preview/Studio Mode and removed only this run's fixtures");
      }
    } catch (error) {
      failure ??= error;
      console.error(`Fixtures retained for manual review: ${prefix.trim()}`);
      console.error(error instanceof Error ? error.message : "Cleanup could not prove ownership");
    }
    obs.close(); process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    rmSync(temp, { recursive: true, force: true });
  }
  if (failure) throw failure;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Mac live harness failed"); process.exitCode = 1; });
}
