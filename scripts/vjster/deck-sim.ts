// SPDX-License-Identifier: GPL-2.0-or-later
// A pretend Stream Deck and a pretend Chrome tab around the real VJster
// plugin, extension logic and adapter (docs/vjster/PLAN.md Phase 1 step 5).
//
// It starts a WebSocket server that speaks to the plugin the way the Stream
// Deck app does, launches the plugin (from source through tsx, or the built
// bundle), puts actions on a Stream Deck + layout, and records every image the
// plugin draws. A stand-in extension (the real Router, LinkClient and Adapter
// around a fake YouTube player) connects to the plugin's link server, so a
// dial turn travels the whole way: deck, plugin, link, extension, page, and
// back to the strip.
//
// Used by tests/vjster-plugin-e2e.test.ts and for demo frames.

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { Adapter, type MediaControl } from "../../vjster-extension/src/adapter-core.js";
import { LinkClient, type SocketLike } from "../../vjster-extension/src/link-client.js";
import { Router } from "../../vjster-extension/src/router.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PLUGIN_DIR = join(root, "com.jbrick2070.vjster.sdPlugin");
const UUID = "com.jbrick2070.vjster";
const DEVICE = "sim-plus";
const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

export interface Placed {
  context: string;
  action: string;
  controller: "Keypad" | "Encoder";
  column: number;
  row: number;
  settings: Record<string, unknown>;
}

/** A fake YouTube player with the probe's lists (docs/vjster/PROBE-LOG.md). */
export function fakePlayer(title = "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film") {
  const s = { rate: 1, preferred: "auto", playingLevel: "hd1080", playing: true, ad: false, title };
  const control: MediaControl = {
    kind: "youtube",
    canQuality: true,
    elementRate: () => s.rate,
    availableRates: () => [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4],
    quality: () => (s.preferred === "auto" ? s.playingLevel : s.preferred),
    preferredQuality: () => s.preferred,
    availableQualities: () => ["hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny", "auto"],
    title: () => s.title,
    playing: () => s.playing,
    adShowing: () => s.ad,
    setRate: (r) => {
      s.rate = r;
    },
    setElementRate: (r) => {
      s.rate = r;
    },
    setQuality: (l) => {
      s.preferred = l;
    },
    setQualityAuto: () => {
      s.preferred = "auto";
    },
    play: () => {
      s.playing = true;
    },
    pause: () => {
      s.playing = false;
    }
  };
  return { s, control };
}

export class DeckSim {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private child: ChildProcess | null = null;
  private client: LinkClient | null = null;
  readonly images = new Map<string, string>();
  readonly alerts: string[] = [];
  readonly globalSettings: Record<string, unknown> = {};
  readonly placed: Placed[] = [];
  private registered: Promise<void> | null = null;
  player = fakePlayer();
  adapter: Adapter | null = null;
  router: Router | null = null;
  log = "";

  /**
   * Start the pretend Stream Deck and launch the plugin. `fromSource` runs src
   * through tsx. `linkPort` is stored as the plugin-wide port setting first, so
   * a simulation never collides with a real VJster on 48150.
   */
  async start(fromSource = true, linkPort?: number): Promise<void> {
    if (linkPort !== undefined) this.globalSettings.port = linkPort;
    this.wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((r) => this.wss!.once("listening", () => r()));
    const port = (this.wss.address() as { port: number }).port;
    this.registered = new Promise<void>((resolveRegistered) => {
      this.wss!.on("connection", (ws) => {
        this.socket = ws;
        ws.on("message", (data) => {
          const m = JSON.parse(data.toString());
          if (m.event === "registerPlugin") resolveRegistered();
          else this.fromPlugin(m);
        });
      });
    });
    const info = {
      application: { font: "", language: "en", platform: "windows", platformVersion: "10.0.26200", version: "7.4.2.22730" },
      colors: {},
      devicePixelRatio: 1,
      devices: [{ id: DEVICE, name: "Stream Deck +", size: { columns: 4, rows: 2 }, type: 7 }],
      plugin: { uuid: UUID, version: "0.1.0.0" }
    };
    const args = ["-port", String(port), "-pluginUUID", UUID, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)];
    const entry = fromSource ? ["--import", "tsx", join(root, "src/vjster/plugin/standalone.ts")] : [join(PLUGIN_DIR, "bin/plugin.js")];
    this.child = spawn(process.execPath, [...entry, ...args], { cwd: PLUGIN_DIR, stdio: ["ignore", "pipe", "pipe"] });
    this.child.stdout?.on("data", (d) => (this.log += d.toString()));
    this.child.stderr?.on("data", (d) => (this.log += d.toString()));
    await Promise.race([
      this.registered,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`the plugin did not register: ${this.log.slice(-800)}`)), 20000))
    ]);
  }

  private fromPlugin(m: { event: string; context?: string; payload?: Record<string, unknown> }): void {
    if (m.event === "setFeedback" && m.context && typeof m.payload?.canvas === "string") this.images.set(m.context, m.payload.canvas);
    else if (m.event === "setImage" && m.context && typeof m.payload?.image === "string") this.images.set(m.context, m.payload.image);
    else if (m.event === "showAlert" && m.context) this.alerts.push(m.context);
    else if (m.event === "getGlobalSettings") this.toPlugin({ event: "didReceiveGlobalSettings", payload: { settings: { ...this.globalSettings } } });
    else if (m.event === "setGlobalSettings" && m.payload) {
      Object.assign(this.globalSettings, m.payload);
      this.toPlugin({ event: "didReceiveGlobalSettings", payload: { settings: { ...this.globalSettings } } });
    }
  }

  private toPlugin(message: Record<string, unknown>): void {
    this.socket?.send(JSON.stringify(message));
  }

  /** Put an action on the deck. */
  appear(p: Placed): void {
    this.placed.push(p);
    this.toPlugin({
      event: "willAppear",
      action: p.action,
      context: p.context,
      device: DEVICE,
      payload: { controller: p.controller, coordinates: { column: p.column, row: p.row }, isInMultiAction: false, settings: p.settings }
    });
  }

  private find(context: string): Placed {
    const p = this.placed.find((x) => x.context === context);
    if (!p) throw new Error(`nothing placed as ${context}`);
    return p;
  }

  private base(context: string) {
    const p = this.find(context);
    return { action: p.action, context, device: DEVICE, payload: { controller: p.controller, coordinates: { column: p.column, row: p.row }, settings: p.settings } };
  }

  rotate(context: string, ticks: number, pressed = false): void {
    const b = this.base(context);
    this.toPlugin({ ...b, event: "dialRotate", payload: { ...b.payload, ticks, pressed } });
  }

  press(context: string): void {
    const b = this.base(context);
    this.toPlugin({ ...b, event: "dialDown" });
    this.toPlugin({ ...b, event: "dialUp" });
  }

  tap(context: string): void {
    const b = this.base(context);
    this.toPlugin({ ...b, event: "touchTap", payload: { ...b.payload, tapPos: [100, 50], hold: false } });
  }

  key(context: string): void {
    const b = this.base(context);
    this.toPlugin({ ...b, event: "keyDown", payload: { ...b.payload, isInMultiAction: false, state: 0 } });
    this.toPlugin({ ...b, event: "keyUp", payload: { ...b.payload, isInMultiAction: false, state: 0 } });
  }

  /** The settings page changed an action's settings (didReceiveSettings). */
  settings(context: string, settings: Record<string, unknown>): void {
    const p = this.find(context);
    p.settings = settings;
    const b = this.base(context);
    this.toPlugin({ ...b, event: "didReceiveSettings", payload: { ...b.payload, settings, isInMultiAction: false } });
  }

  /** Connect the stand-in Chrome extension: real Router, LinkClient and Adapter around the fake player. */
  connectExtension(port = 48150): void {
    let id = 0;
    const newId = () => `sim-${++id}`;
    const TAB = 7;
    // eslint-disable-next-line prefer-const
    let router: Router;
    const adapter = new Adapter(
      () => this.player.control,
      (report) => {
        if (report.kind === "state") router.pageState(TAB, 1, report.state, "www.youtube.com", report.inReplyTo, report.played);
        else router.pageError(TAB, report.code, report.message, report.inReplyTo);
      }
    );
    const client = new LinkClient({
      url: () => `ws://127.0.0.1:${port}/`,
      open: (url) => new WebSocket(url, { origin: EXT_ORIGIN }) as unknown as SocketLike,
      onIntent: (intent) => void router.intent(intent),
      // The router asks the tab for fresh state itself (refreshTabs below).
      onOpen: () => router.linkOpened(),
      newId,
      timers: { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 200)), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
    });
    router = new Router({
      sendToTab: async (_tab, intent) => {
        adapter.handle(intent);
        return true;
      },
      refreshTabs: () => adapter.refresh(),
      sendToLink: (m) => {
        client.send(m);
      },
      savePin: () => undefined,
      now: () => Date.now(),
      newId
    });
    router.tabActivated(TAB, 1);
    router.focusChanged(1);
    this.adapter = adapter;
    this.router = router;
    this.client = client;
    client.start();
  }

  /** The page changed by itself (play, pause, a new video): report it. */
  pageChanged(): void {
    this.adapter?.changed();
  }

  /** The latest image the plugin drew for a context, decoded to SVG text. */
  svg(context: string): string {
    const uri = this.images.get(context) ?? "";
    const comma = uri.indexOf(",");
    return comma < 0 ? "" : decodeURIComponent(uri.slice(comma + 1));
  }

  async stop(): Promise<void> {
    this.client?.stop();
    this.adapter?.dispose();
    this.child?.kill();
    this.socket?.close();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
  }
}

/** The VJster Live + layout's slots, as the bundled profile places them. */
export function livePlusLayout(): Placed[] {
  const e = (column: number, settings: Record<string, unknown>, action = `${UUID}.speed`): Placed => ({
    context: `dial-${column}`,
    action,
    controller: "Encoder",
    column,
    row: 0,
    settings
  });
  const k = (column: number, row: number, action: string, settings: Record<string, unknown> = {}): Placed => ({
    context: `key-${column}-${row}`,
    action: `${UUID}.${action}`,
    controller: "Keypad",
    column,
    row,
    settings
  });
  return [
    e(0, { label: "SPEED", step: 0.25, fineStep: 0.05, extended: false, hold: true }),
    e(1, { label: "NUDGE", step: 0.05, fineStep: 0.05, extended: false, hold: true }),
    e(2, { label: "QUALITY", hold: true }, `${UUID}.quality`),
    e(3, { label: "FX SPEED", step: 0.5, fineStep: 0.1, extended: true, hold: true }),
    k(0, 0, "speed-preset", { rate: 0.1, extended: true, hold: true }),
    k(1, 0, "speed-preset", { rate: 0.5, extended: false, hold: true }),
    k(2, 0, "speed-preset", { rate: 1, extended: false, hold: true }),
    k(3, 0, "speed-preset", { rate: 2, extended: false, hold: true }),
    k(0, 1, "transport"),
    k(1, 1, "pin"),
    k(2, 1, "quality-preset", { level: "auto", hold: true }),
    k(3, 1, "speed-preset", { rate: 8, extended: true, hold: true })
  ];
}
