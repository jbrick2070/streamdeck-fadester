// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the service worker's wiring of the router and the link
// client to Chrome (docs/vjster/REQUIREMENTS.md R-LNK-3, R-TGT-1..4; PLAN.md
// 3.7). background.ts calls it with the real chrome object; tests pass a fake.

import type { Intent } from "../../src/vjster/shared/protocol.js";
import { LinkClient, type SocketLike } from "./link-client.js";
import { readBridgeToWorker, plainIntent } from "./messages.js";
import { Router } from "./router.js";
import { PIN_KEY, PORT_KEY, linkUrl, readPort } from "./settings.js";
import { isYouTubeHost } from "./youtube.js";

export const ALARM = "vjster-link";

type Listener<A extends unknown[]> = { addListener(fn: (...args: A) => void): void };

/** The part of the chrome object the worker uses. */
export interface WorkerChrome {
  runtime: {
    readonly id: string;
    onMessage: Listener<[unknown, { tab?: { id?: number; windowId: number }; frameId?: number; id?: string }, ...unknown[]]>;
  };
  tabs: {
    query(info: { active?: boolean }): Promise<{ id?: number; windowId: number }[]>;
    sendMessage(tabId: number, message: unknown, options: { frameId: number }): Promise<unknown>;
    onRemoved: Listener<[number, ...unknown[]]>;
    onActivated: Listener<[{ tabId: number; windowId: number }]>;
    onAttached: Listener<[number, { newWindowId: number; newPosition: number }]>;
  };
  windows: {
    readonly WINDOW_ID_NONE: number;
    getLastFocused(): Promise<{ id?: number; focused: boolean }>;
    onFocusChanged: Listener<[number]>;
  };
  storage: {
    local: { get(keys: string): Promise<Record<string, unknown>> };
    session: { get(keys: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
    onChanged: Listener<[Record<string, { newValue?: unknown }>, string]>;
  };
  alarms: {
    create(name: string, info: { periodInMinutes: number }): Promise<void>;
    onAlarm: Listener<[{ name: string }]>;
  };
}

export interface WorkerEnv {
  chrome: WorkerChrome;
  openSocket(url: string): SocketLike;
  now(): number;
  random(): number;
  /** The worker's own console (R-BEH-5); reasons only, never a URL or a title. */
  log?: (line: string) => void;
}

/** The one line the worker writes when a YouTube tab cannot control quality (R-QLT-2). */
export const NO_QUALITY_NOTE = "VJster: a YouTube tab has no quality methods; quality control is off there, speed still works.";

export interface Worker {
  readonly router: Router;
  readonly link: LinkClient;
  /** Resolves once settings are read and the link has started. */
  readonly booted: Promise<void>;
}

export function installWorker(env: WorkerEnv): Worker {
  const c = env.chrome;
  const log = env.log ?? (() => undefined);
  /** Tabs already noted for missing quality methods. */
  const notedNoQuality = new Set<number>();
  let port = readPort(undefined);
  let counter = 0;
  const prefix = Math.floor(env.random() * 36 ** 6).toString(36);
  const newId = (): string => `x${prefix}-${++counter}`;

  const router = new Router({
    async sendToTab(tabId: number, intent: Intent): Promise<boolean> {
      try {
        // Only the tab's top frame runs the bridge that speaks for it.
        await c.tabs.sendMessage(tabId, { kind: "intent", intent: plainIntent(intent) }, { frameId: 0 });
        return true;
      } catch {
        return false;
      }
    },
    refreshTabs: () => refreshAll(),
    sendToLink: (message) => {
      link.send(message);
    },
    savePin: (tabId) => {
      void c.storage.session.set({ [PIN_KEY]: tabId }).catch(() => undefined);
    },
    now: env.now,
    newId
  });

  const link = new LinkClient({
    url: () => linkUrl(port),
    open: env.openSocket,
    onIntent: (intent) => {
      void router.intent(intent);
    },
    onOpen: () => router.linkOpened(),
    newId,
    random: env.random
  });

  c.runtime.onMessage.addListener((data, sender) => {
    const tabId = sender.tab?.id;
    // Only this extension's own bridge, and only the top frame of a tab, speaks for it.
    if (sender.id !== c.runtime.id || tabId === undefined || sender.frameId !== 0) return;
    const message = readBridgeToWorker(data);
    if (!message) return;
    if (message.kind === "page-state") {
      const s = message.state;
      if (s.rate !== null && message.host !== null && isYouTubeHost(message.host) && !s.capabilities.includes("quality") && !notedNoQuality.has(tabId)) {
        notedNoQuality.add(tabId);
        log(NO_QUALITY_NOTE);
      }
      router.pageState(tabId, sender.tab?.windowId ?? -1, s, message.host, message.inReplyTo, message.played);
    } else router.pageError(tabId, message.code, message.message, message.inReplyTo);
  });

  c.tabs.onRemoved.addListener((tabId) => {
    notedNoQuality.delete(tabId);
    router.tabRemoved(tabId);
  });
  c.tabs.onActivated.addListener(({ tabId, windowId }) => router.tabActivated(tabId, windowId));
  c.tabs.onAttached.addListener((tabId, info) => router.tabMoved(tabId, info.newWindowId));
  c.windows.onFocusChanged.addListener((windowId) => router.focusChanged(windowId === c.windows.WINDOW_ID_NONE ? null : windowId));

  c.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PORT_KEY]) {
      port = readPort(changes[PORT_KEY].newValue);
      link.restart();
    }
  });

  // A check every minute reconnects if the socket is gone (R-LNK-3).
  c.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) link.ensure();
  });

  async function boot(): Promise<void> {
    const [local, session] = await Promise.all([c.storage.local.get(PORT_KEY), c.storage.session.get(PIN_KEY)]);
    port = readPort(local[PORT_KEY]);
    const pinned = session[PIN_KEY];
    router.restorePin(typeof pinned === "number" ? pinned : null);
    const focused = await c.windows.getLastFocused().catch(() => null);
    if (focused?.focused && focused.id !== undefined) router.focusChanged(focused.id);
    for (const tab of await c.tabs.query({ active: true }).catch(() => [])) if (tab.id !== undefined) router.tabActivated(tab.id, tab.windowId);
    // A restarted worker starts with an empty registry: ask every tab what it plays.
    refreshAll();
    await c.alarms.create(ALARM, { periodInMinutes: 1 });
    link.start();
  }

  /** Ask every tab's bridge to report now. No "tabs" permission: ids are enough; tabs without VJster fail quietly. */
  function refreshAll(): void {
    void c.tabs
      .query({})
      .then((tabs) => {
        for (const tab of tabs) if (tab.id !== undefined) c.tabs.sendMessage(tab.id, { kind: "refresh" }, { frameId: 0 }).catch(() => undefined);
      })
      .catch(() => undefined);
  }

  return { router, link, booted: boot() };
}
