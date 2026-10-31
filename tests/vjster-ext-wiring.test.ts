// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension wiring with fake browser objects: the bridge, the page
// boundary, the service worker, settings, and the two media controls
// (docs/vjster/PLAN.md 3.7; REQUIREMENTS.md R-LNK-3, R-TGT-1..4, R-QLT-2).
import { describe, expect, it } from "vitest";
import type { Intent } from "../src/vjster/shared/protocol.js";
import { installBridge, type BridgeRuntime, type BridgeWindow } from "../vjster-extension/src/bridge-core.js";
import type { SocketLike } from "../vjster-extension/src/link-client.js";
import { FROM_BRIDGE, FROM_PAGE } from "../vjster-extension/src/messages.js";
import { NO_VIDEO } from "../vjster-extension/src/page-state.js";
import { claimPage, listenToBridge, postReport, type PageWindow } from "../vjster-extension/src/page-wiring.js";
import { ALL_SITES_SCRIPTS, linkUrl, readPort } from "../vjster-extension/src/settings.js";
import { ALARM, NO_QUALITY_NOTE, installWorker, type WorkerChrome } from "../vjster-extension/src/worker-core.js";
import { videoControl } from "../vjster-extension/src/generic-video.js";
import { CORE_METHODS, QUALITY_METHODS, findYouTubePlayer, hasQualityApi, isYouTubeHost, youTubeControl, type YouTubePlayerElement } from "../vjster-extension/src/youtube.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
const intent = (body: Record<string, unknown>): Intent => ({ v: 1, id: `i-${Math.random().toString(36).slice(2, 8)}`, target: "browser", ...body }) as Intent;
const playingState = { ...NO_VIDEO, rate: 1.5, availableRates: [0.25, 4], title: "Clip", playing: true, capabilities: ["speed", "transport"] };

/** A window that records what is posted to it and lets the test fire its events. */
function fakeWindow(hostname = "www.youtube.com", origin = "https://www.youtube.com") {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const posted: { message: unknown; origin: string }[] = [];
  const win = {
    location: { hostname, origin },
    addEventListener(type: string, fn: (e: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    postMessage(message: unknown, targetOrigin: string) {
      posted.push({ message, origin: targetOrigin });
    }
  };
  const fire = (type: string, event: unknown) => {
    for (const fn of listeners.get(type) ?? []) fn(event);
  };
  return { win, posted, fire };
}

function fakeRuntime(throws = false) {
  const sent: unknown[] = [];
  let listener: ((d: unknown) => void) | null = null;
  const runtime = {
    sendMessage(m: unknown) {
      if (throws) throw new Error("Extension context invalidated.");
      sent.push(m);
      return Promise.resolve();
    },
    onMessage: {
      addListener(fn: (d: unknown) => void) {
        listener = fn;
      }
    }
  };
  return { runtime, sent, deliver: (d: unknown) => listener?.(d) };
}

describe("bridge (isolated world)", () => {
  it("relays the page's state with its own host name, only from this window", () => {
    const w = fakeWindow();
    const r = fakeRuntime();
    installBridge(w.win as unknown as BridgeWindow, r.runtime as unknown as BridgeRuntime);
    const data = { source: FROM_PAGE, kind: "state", state: playingState, inReplyTo: "i1", played: true, host: "evil.example" };
    w.fire("message", { source: {}, data }); // a frame, not this window
    expect(r.sent).toEqual([]);
    w.fire("message", { source: w.win, data });
    expect(r.sent).toEqual([{ kind: "page-state", state: expect.objectContaining({ rate: 1.5 }), host: "www.youtube.com", inReplyTo: "i1", played: true }]);
  });

  it("relays page errors and drops anything else", () => {
    const w = fakeWindow();
    const r = fakeRuntime();
    installBridge(w.win as unknown as BridgeWindow, r.runtime as unknown as BridgeRuntime);
    w.fire("message", { source: w.win, data: { source: FROM_PAGE, kind: "error", code: "unsupported", message: "nope", inReplyTo: "i2" } });
    w.fire("message", { source: w.win, data: { source: FROM_BRIDGE, kind: "intent" } });
    w.fire("message", { source: w.win, data: "hello" });
    expect(r.sent).toEqual([{ kind: "page-error", code: "unsupported", message: "nope", inReplyTo: "i2" }]);
  });

  it("passes the worker's intents and refresh requests to the page, posted to its own origin", () => {
    const w = fakeWindow();
    const r = fakeRuntime();
    installBridge(w.win as unknown as BridgeWindow, r.runtime as unknown as BridgeRuntime);
    const i = intent({ type: "speed.reset" });
    r.deliver({ kind: "intent", intent: i });
    r.deliver({ kind: "refresh" });
    r.deliver({ kind: "intent", intent: { type: "speed.reset" } }); // not a valid intent
    expect(w.posted).toEqual([
      { message: { source: FROM_BRIDGE, kind: "intent", intent: i }, origin: "https://www.youtube.com" },
      { message: { source: FROM_BRIDGE, kind: "refresh" }, origin: "https://www.youtube.com" }
    ]);
  });

  it("says the video is gone when the page is left, and asks for a report when it comes back from the cache", () => {
    const w = fakeWindow();
    const r = fakeRuntime();
    installBridge(w.win as unknown as BridgeWindow, r.runtime as unknown as BridgeRuntime);
    w.fire("pagehide", { persisted: false });
    expect(r.sent).toEqual([{ kind: "page-state", state: NO_VIDEO, host: null, inReplyTo: null, played: false }]);
    w.fire("pageshow", { persisted: false });
    expect(w.posted).toEqual([]);
    w.fire("pageshow", { persisted: true });
    expect(w.posted).toEqual([{ message: { source: FROM_BRIDGE, kind: "refresh" }, origin: "https://www.youtube.com" }]);
  });

  it("survives a runtime that throws after an extension reload, and posts with * on a file page", () => {
    const w = fakeWindow("", "null");
    const r = fakeRuntime(true);
    installBridge(w.win as unknown as BridgeWindow, r.runtime as unknown as BridgeRuntime);
    expect(() => w.fire("message", { source: w.win, data: { source: FROM_PAGE, kind: "state", state: playingState, inReplyTo: null } })).not.toThrow();
    expect(() => w.fire("pagehide", {})).not.toThrow();
    r.deliver({ kind: "refresh" });
    expect(w.posted[0].origin).toBe("*");
  });
});

describe("page boundary (main world)", () => {
  it("claims a page once", () => {
    const page = {};
    expect(claimPage(page)).toBe(true);
    expect(claimPage(page)).toBe(false);
  });

  it("hands the bridge's intents and refresh requests to the adapter, only from this window", () => {
    const w = fakeWindow();
    const got: string[] = [];
    listenToBridge(w.win as unknown as PageWindow, { handle: (i) => got.push(i.type), refresh: () => got.push("refresh") });
    const i = intent({ type: "transport.toggle" });
    w.fire("message", { source: {}, data: { source: FROM_BRIDGE, kind: "intent", intent: i } });
    w.fire("message", { source: w.win, data: { source: FROM_PAGE, kind: "intent", intent: i } });
    w.fire("message", { source: w.win, data: { source: FROM_BRIDGE, kind: "intent", intent: i } });
    w.fire("message", { source: w.win, data: { source: FROM_BRIDGE, kind: "refresh" } });
    expect(got).toEqual(["transport.toggle", "refresh"]);
  });

  it("posts adapter reports in the bridge's format", () => {
    const w = fakeWindow();
    postReport(w.win as unknown as PageWindow, { kind: "state", state: NO_VIDEO, inReplyTo: "i3", played: true });
    postReport(w.win as unknown as PageWindow, { kind: "error", code: "no-video", message: "none", inReplyTo: "i4" });
    expect(w.posted).toEqual([
      { message: { source: FROM_PAGE, kind: "state", state: NO_VIDEO, inReplyTo: "i3", played: true }, origin: "https://www.youtube.com" },
      { message: { source: FROM_PAGE, kind: "error", code: "no-video", message: "none", inReplyTo: "i4" }, origin: "https://www.youtube.com" }
    ]);
  });
});

/** A chrome object with just what the worker uses, driven by the test. */
function fakeChrome(opts: { port?: unknown; pinned?: unknown } = {}) {
  const event = <A extends unknown[]>() => {
    const fns: ((...a: A) => void)[] = [];
    return { addListener: (fn: (...a: A) => void) => void fns.push(fn), fire: (...a: A) => fns.forEach((fn) => fn(...a)) };
  };
  const toTabs: { tabId: number; message: unknown; options: unknown }[] = [];
  const alarms: { name: string; info: unknown }[] = [];
  const sessionSets: Record<string, unknown>[] = [];
  const unreachable = new Set<number>([6]);
  const c = {
    runtime: { id: "abcdefghijklmnopabcdefghijklmnop", onMessage: event<[unknown, { tab?: { id?: number; windowId: number }; frameId?: number; id?: string }]>() },
    tabs: {
      query: async (info: { active?: boolean }) => (info.active ? [{ id: 5, windowId: 1 }] : [{ id: 5, windowId: 1 }, { id: 6, windowId: 2 }, { windowId: 3 }]),
      sendMessage: async (tabId: number, message: unknown, options: unknown) => {
        toTabs.push({ tabId, message, options });
        if (unreachable.has(tabId)) throw new Error("Could not establish connection. Receiving end does not exist.");
      },
      onRemoved: event<[number]>(),
      onActivated: event<[{ tabId: number; windowId: number }]>(),
      onAttached: event<[number, { newWindowId: number; newPosition: number }]>()
    },
    windows: { WINDOW_ID_NONE: -1, getLastFocused: async () => ({ id: 1, focused: true }), onFocusChanged: event<[number]>() },
    storage: {
      local: { get: async () => ({ "vjster.port": opts.port ?? 48151 }) },
      session: {
        get: async () => ({ "vjster.pinnedTab": opts.pinned ?? null }),
        set: async (items: Record<string, unknown>) => void sessionSets.push(items)
      },
      onChanged: event<[Record<string, { newValue?: unknown }>, string]>()
    },
    alarms: { create: async (name: string, info: unknown) => void alarms.push({ name, info }), onAlarm: event<[{ name: string }]>() }
  };
  return { c, toTabs, alarms, sessionSets, unreachable };
}

function fakeSocketFactory() {
  const opened: { url: string; socket: SocketLike & { sent: string[]; open(): void; drop(): void } }[] = [];
  const openSocket = (url: string) => {
    const socket = {
      readyState: 0,
      sent: [] as string[],
      send(d: string) {
        this.sent.push(d);
      },
      close() {
        this.readyState = 3;
      },
      onopen: null as SocketLike["onopen"],
      onclose: null as SocketLike["onclose"],
      onerror: null as SocketLike["onerror"],
      onmessage: null as SocketLike["onmessage"],
      open() {
        this.readyState = 1;
        this.onopen?.({});
      },
      drop() {
        this.readyState = 3;
        this.onclose?.({});
      }
    };
    opened.push({ url, socket });
    return socket;
  };
  return { opened, openSocket };
}

async function bootWorker(opts: { port?: unknown; pinned?: unknown } = {}) {
  const chrome = fakeChrome(opts);
  const sockets = fakeSocketFactory();
  let clock = 1000;
  const logged: string[] = [];
  const worker = installWorker({ chrome: chrome.c as unknown as WorkerChrome, openSocket: sockets.openSocket, now: () => (clock += 10), random: () => 0.5, log: (l) => logged.push(l) });
  await worker.booted;
  await flush();
  return { ...chrome, ...sockets, worker, logged };
}

describe("service worker wiring (R-LNK-3, R-TGT-1..4)", () => {
  it("boots: reads the port, restores the pin, creates the one-minute alarm, connects, and asks every tab for state", async () => {
    const { opened, alarms, toTabs, worker } = await bootWorker({ pinned: 5 });
    expect(opened.map((o) => o.url)).toEqual(["ws://127.0.0.1:48151/"]);
    expect(alarms).toEqual([{ name: ALARM, info: { periodInMinutes: 1 } }]);
    expect(ALARM).toBe("vjster-link");
    expect(worker.router.pinned).toBe(5);
    expect(toTabs).toEqual([
      { tabId: 5, message: { kind: "refresh" }, options: { frameId: 0 } },
      { tabId: 6, message: { kind: "refresh" }, options: { frameId: 0 } }
    ]);
  });

  it("asks every tab again when the link opens", async () => {
    const { opened, toTabs } = await bootWorker();
    toTabs.length = 0;
    opened[0].socket.open();
    await flush();
    expect(toTabs.filter((t) => (t.message as { kind: string }).kind === "refresh").map((t) => t.tabId)).toEqual([5, 6]);
  });

  it("takes page reports only from this extension's bridge in a tab's top frame", async () => {
    const { c, worker } = await bootWorker();
    const report = { kind: "page-state", state: playingState, host: "a.example", inReplyTo: null, played: true };
    c.runtime.onMessage.fire(report, { tab: { id: 7, windowId: 1 }, frameId: 0, id: "ponmlkjihgfedcbaponmlkjihgfedcba" });
    c.runtime.onMessage.fire(report, { frameId: 0, id: c.runtime.id });
    c.runtime.onMessage.fire(report, { tab: { id: 7, windowId: 1 }, frameId: 2, id: c.runtime.id });
    c.runtime.onMessage.fire(report, { tab: { id: 7, windowId: 1 }, id: c.runtime.id });
    expect(worker.router.target()).toBeNull();
    c.runtime.onMessage.fire(report, { tab: { id: 7, windowId: 1 }, frameId: 0, id: c.runtime.id });
    expect(worker.router.target()).toBe(7);
  });

  it("delivers intents to the target tab's top frame only", async () => {
    const { c, worker, toTabs } = await bootWorker();
    c.runtime.onMessage.fire({ kind: "page-state", state: playingState, host: "a.example", inReplyTo: null, played: true }, { tab: { id: 5, windowId: 1 }, frameId: 0, id: c.runtime.id });
    toTabs.length = 0;
    const i = intent({ type: "speed.reset" });
    await worker.router.intent(i);
    expect(toTabs).toEqual([{ tabId: 5, message: { kind: "intent", intent: i }, options: { frameId: 0 } }]);
  });

  it("reconnects to a new port when the options page saves one", async () => {
    const { c, opened } = await bootWorker();
    c.storage.onChanged.fire({ "vjster.port": { newValue: 48160 } }, "local");
    c.storage.onChanged.fire({ "vjster.port": { newValue: 48170 } }, "sync");
    expect(opened.map((o) => o.url)).toEqual(["ws://127.0.0.1:48151/", "ws://127.0.0.1:48160/"]);
  });

  it("reconnects on its own alarm only", async () => {
    const { c, opened, worker } = await bootWorker();
    worker.link.stop();
    c.alarms.onAlarm.fire({ name: "someone-else" });
    expect(opened).toHaveLength(1);
    c.alarms.onAlarm.fire({ name: ALARM });
    expect(opened).toHaveLength(2);
  });

  it("follows tab moves, closes and window focus", async () => {
    const { c, worker } = await bootWorker();
    const send = (tab: number, windowId: number) =>
      c.runtime.onMessage.fire({ kind: "page-state", state: playingState, host: "a.example", inReplyTo: null, played: true }, { tab: { id: tab, windowId }, frameId: 0, id: c.runtime.id });
    send(5, 1);
    send(8, 2);
    c.tabs.onActivated.fire({ tabId: 8, windowId: 2 });
    c.tabs.onActivated.fire({ tabId: 5, windowId: 3 });
    c.windows.onFocusChanged.fire(3);
    expect(worker.router.target()).toBe(8); // tab 5 is still recorded in window 1
    c.tabs.onAttached.fire(5, { newWindowId: 3, newPosition: 0 });
    expect(worker.router.target()).toBe(5);
    c.windows.onFocusChanged.fire(-1);
    c.tabs.onRemoved.fire(5);
    expect(worker.router.target()).toBe(8);
  });

  it("lets a paused tab rejoin when its page says its video has played (a restarted worker)", async () => {
    const { c, worker } = await bootWorker();
    const paused = { ...playingState, playing: false };
    c.runtime.onMessage.fire({ kind: "page-state", state: paused, host: "a.example", inReplyTo: null, played: false }, { tab: { id: 5, windowId: 1 }, frameId: 0, id: c.runtime.id });
    expect(worker.router.target()).toBeNull();
    c.runtime.onMessage.fire({ kind: "page-state", state: paused, host: "a.example", inReplyTo: null, played: true }, { tab: { id: 5, windowId: 1 }, frameId: 0, id: c.runtime.id });
    expect(worker.router.target()).toBe(5);
  });

  it("takes a tab's window from the sender", async () => {
    const { c, worker } = await bootWorker();
    const send = (tab: number, windowId: number) =>
      c.runtime.onMessage.fire({ kind: "page-state", state: playingState, host: "a.example", inReplyTo: null, played: true }, { tab: { id: tab, windowId }, frameId: 0, id: c.runtime.id });
    send(5, 1);
    send(8, 2);
    c.tabs.onActivated.fire({ tabId: 8, windowId: 2 });
    c.windows.onFocusChanged.fire(2);
    expect(worker.router.target()).toBe(8);
    c.tabs.onActivated.fire({ tabId: 5, windowId: 1 });
    c.windows.onFocusChanged.fire(1);
    expect(worker.router.target()).toBe(5);
  });

  it("notes once per tab, in its own console, a YouTube player without quality control (R-QLT-2)", async () => {
    const { c, logged } = await bootWorker();
    const fire = (tab: number, host: string, capabilities: string[]) =>
      c.runtime.onMessage.fire({ kind: "page-state", state: { ...playingState, capabilities }, host, inReplyTo: null, played: true }, { tab: { id: tab, windowId: 1 }, frameId: 0, id: c.runtime.id });
    fire(6, "www.youtube.com", ["speed", "quality", "transport"]);
    fire(7, "news.example", ["speed", "transport"]);
    c.runtime.onMessage.fire({ kind: "page-state", state: NO_VIDEO, host: "www.youtube.com", inReplyTo: null, played: false }, { tab: { id: 8, windowId: 1 }, frameId: 0, id: c.runtime.id });
    expect(logged).toEqual([]);
    fire(5, "www.youtube.com", ["speed", "transport"]);
    fire(5, "www.youtube.com", ["speed", "transport"]);
    expect(logged).toEqual([NO_QUALITY_NOTE]);
    c.tabs.onRemoved.fire(5);
    fire(5, "www.youtube.com", ["speed", "transport"]); // a new page in a reused tab id is noted again
    expect(logged).toEqual([NO_QUALITY_NOTE, NO_QUALITY_NOTE]);
    expect(NO_QUALITY_NOTE).not.toMatch(/http|youtube\.com/);
  });

  it("saves the pin in session storage", async () => {
    const { c, worker, sessionSets } = await bootWorker();
    c.runtime.onMessage.fire({ kind: "page-state", state: playingState, host: "a.example", inReplyTo: null, played: true }, { tab: { id: 5, windowId: 1 }, frameId: 0, id: c.runtime.id });
    await worker.router.intent(intent({ type: "pin.set", pinned: true }));
    expect(sessionSets).toEqual([{ "vjster.pinnedTab": 5 }]);
  });
});

describe("extension settings (R-LNK-1, D-4)", () => {
  it("accepts ports 1024 to 65535 only", () => {
    expect(readPort(1024)).toBe(1024);
    expect(readPort(65535)).toBe(65535);
    for (const p of [1023, 65536, 1, 0, 48150.5, "48151", null, undefined]) expect(readPort(p)).toBe(48150);
    expect(linkUrl(48151)).toBe("ws://127.0.0.1:48151/");
  });

  it("registers the all-sites scripts everywhere but YouTube, in the right worlds", () => {
    expect(ALL_SITES_SCRIPTS.map((s) => [s.js[0], s.world, s.excludeMatches])).toEqual([
      ["content-main.js", "MAIN", ["*://*.youtube.com/*"]],
      ["content-bridge.js", "ISOLATED", ["*://*.youtube.com/*"]]
    ]);
  });
});

/** A fake #movie_player with the methods named, a class list and an optional video element. */
function fakePlayer(methods: readonly string[], classes: string[] = [], video: { playbackRate: number } | null = { playbackRate: 1.5 }) {
  const el: Record<string, unknown> = {
    classList: { contains: (c: string) => classes.includes(c) },
    querySelector: (sel: string) => (sel === "video" ? video : null)
  };
  for (const m of methods) el[m] = () => (m === "getVideoData" ? { title: "T" } : m === "getAvailableQualityLevels" ? ["hd720", "auto"] : m === "getPlayerState" ? 1 : 1);
  return el as unknown as YouTubePlayerElement;
}
const doc = (player: unknown, overlay = false) => ({
  getElementById: (id: string) => (id === "movie_player" ? player : null),
  querySelector: () => (overlay ? {} : null)
});

describe("YouTube control (F-4, R-QLT-2, V-3)", () => {
  it("knows YouTube's hosts and nothing that only ends like them", () => {
    for (const h of ["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com"]) expect(isYouTubeHost(h)).toBe(true);
    for (const h of ["evilyoutube.com", "youtube.com.evil.example", "notyoutube.com", ""]) expect(isYouTubeHost(h)).toBe(false);
  });

  it("finds the player with the core methods, quality or not", () => {
    const all = fakePlayer([...CORE_METHODS, ...QUALITY_METHODS]);
    expect(findYouTubePlayer(doc(all))).toBe(all);
    expect(hasQualityApi(all)).toBe(true);
    const noQuality = fakePlayer(CORE_METHODS);
    expect(findYouTubePlayer(doc(noQuality))).toBe(noQuality);
    expect(hasQualityApi(noQuality)).toBe(false);
    for (const missing of CORE_METHODS) {
      const p = fakePlayer([...CORE_METHODS, ...QUALITY_METHODS].filter((m) => m !== missing));
      expect(findYouTubePlayer(doc(p))).toBeNull();
    }
    for (const missing of QUALITY_METHODS) expect(hasQualityApi(fakePlayer([...CORE_METHODS, ...QUALITY_METHODS].filter((m) => m !== missing)))).toBe(false);
    expect(findYouTubePlayer(doc(null))).toBeNull();
  });

  it("reads the element's rate, and turns quality off without the quality methods", () => {
    const c = youTubeControl(fakePlayer(CORE_METHODS), doc(null));
    expect(c.canQuality).toBe(false);
    expect([c.quality(), c.preferredQuality(), c.availableQualities()]).toEqual([null, null, []]);
    expect(c.elementRate()).toBe(1.5);
    expect(c.title()).toBe("T");
    expect(c.playing()).toBe(true);
    const full = youTubeControl(fakePlayer([...CORE_METHODS, ...QUALITY_METHODS]), doc(null));
    expect(full.canQuality).toBe(true);
    expect(full.availableQualities()).toEqual(["hd720", "auto"]);
  });

  it("sees an ad by either class on the player or by the ad overlay", () => {
    const methods = [...CORE_METHODS, ...QUALITY_METHODS];
    expect(youTubeControl(fakePlayer(methods), doc(null)).adShowing()).toBe(false);
    expect(youTubeControl(fakePlayer(methods, ["ad-showing"]), doc(null)).adShowing()).toBe(true);
    expect(youTubeControl(fakePlayer(methods, ["ad-interrupting"]), doc(null)).adShowing()).toBe(true);
    expect(youTubeControl(fakePlayer(methods), doc(null, true)).adShowing()).toBe(true);
  });

  it("calls the quality methods in the forms the probe confirmed (R-QLT-2, F-4)", () => {
    const calls: unknown[][] = [];
    const p = fakePlayer([...CORE_METHODS, ...QUALITY_METHODS]) as unknown as Record<string, unknown>;
    p.setPlaybackQualityRange = (...a: unknown[]) => void calls.push(a);
    const c = youTubeControl(p as unknown as YouTubePlayerElement, doc(null));
    c.setQuality("hd720");
    c.setQualityAuto();
    expect(calls).toEqual([["hd720", "hd720"], ["auto"]]);
  });

  it("needs setPlaybackQualityRange for quality control, and notices quality methods that arrive late", () => {
    const methods = [...CORE_METHODS, "getAvailableQualityLevels", "getPlaybackQuality", "getPreferredQuality"];
    expect(QUALITY_METHODS).toContain("setPlaybackQualityRange");
    const p = fakePlayer(methods);
    expect(hasQualityApi(p)).toBe(false);
    const c = youTubeControl(p, doc(null));
    expect(c.canQuality).toBe(false);
    (p as unknown as Record<string, unknown>).setPlaybackQualityRange = () => undefined;
    expect(c.canQuality).toBe(true);
  });

  it("counts buffering as playing and an unstarted or paused player as not", () => {
    for (const [state, playing] of [[1, true], [3, true], [2, false], [-1, false], [0, false], [5, false]] as const) {
      const p = fakePlayer(CORE_METHODS) as unknown as Record<string, unknown>;
      p.getPlayerState = () => state;
      expect(youTubeControl(p as unknown as YouTubePlayerElement, doc(null)).playing()).toBe(playing);
    }
  });

  it("looks for both ad overlay selectors", () => {
    const seen: string[] = [];
    const d = { querySelector: (sel: string) => (seen.push(sel), null), getElementById: () => null };
    youTubeControl(fakePlayer(CORE_METHODS), d).adShowing();
    expect(seen[0].split(",").map((s) => s.trim())).toEqual([".ytp-ad-player-overlay", ".ytp-ad-player-overlay-layout"]);
  });

  it("refuses an element rate when the player has no video element", () => {
    const c = youTubeControl(fakePlayer(CORE_METHODS, [], null), doc(null));
    expect(() => c.setElementRate(2)).toThrow();
  });
});

describe("plain video control (R-SPD-4, R-QLT-4)", () => {
  function fakeVideo(over: Partial<{ paused: boolean; ended: boolean; playbackRate: number; playRejects: boolean }> = {}) {
    const v = {
      paused: over.paused ?? false,
      ended: over.ended ?? false,
      playbackRate: over.playbackRate ?? 1,
      played: 0,
      play() {
        this.played++;
        return over.playRejects ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve();
      },
      pause() {
        this.paused = true;
      }
    };
    return v;
  }

  it("is speed and play/pause only, on the chosen element", () => {
    const v = fakeVideo({ playbackRate: 1.25 });
    const c = videoControl(() => v);
    expect([c.kind, c.canQuality, c.elementRate(), c.availableRates()]).toEqual(["video", false, 1.25, []]);
    c.setRate(2);
    expect(v.playbackRate).toBe(2);
    c.setElementRate(3);
    expect(v.playbackRate).toBe(3);
    expect(() => c.setQuality("hd720")).toThrow();
    expect(() => c.setQualityAuto()).toThrow();
    expect(c.title()).toBeNull(); // no document in Node
  });

  it("plays only a video that is neither paused nor ended, and survives a refused play()", async () => {
    expect(videoControl(() => fakeVideo()).playing()).toBe(true);
    expect(videoControl(() => fakeVideo({ paused: true })).playing()).toBe(false);
    expect(videoControl(() => fakeVideo({ ended: true })).playing()).toBe(false);
    const v = fakeVideo({ paused: true, playRejects: true });
    const c = videoControl(() => v);
    expect(() => c.play()).not.toThrow();
    await flush();
    expect(v.played).toBe(1);
  });

  it("has no rate and refuses changes when the page has no video", () => {
    const c = videoControl(() => null);
    expect(c.elementRate()).toBeNull();
    expect(c.playing()).toBe(false);
    expect(() => c.setRate(2)).toThrow();
  });
});
