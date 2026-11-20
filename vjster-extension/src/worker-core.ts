// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the service worker's wiring of the router and the link
// client to Chrome (docs/vjster/REQUIREMENTS.md R-LNK-3, R-TGT-1..4; PLAN.md
// 3.7). background.ts calls it with the real chrome object; tests pass a fake.

import type { Intent } from "../../src/vjster/shared/protocol.js";
import { LinkClient, type SocketLike } from "./link-client.js";
import { isLinkStatusRequest, readBridgeToWorker, plainIntent, type LinkStatus } from "./messages.js";
import { NO_VIDEO } from "./page-state.js";
import { Router } from "./router.js";
import {
  ALL_SITES_IDS, ALL_SITES_KEY, ALL_SITES_SCRIPTS, EVER_LINKED_KEY, PIN_KEY, PORT_KEY, RELOAD_TABS_KEY, STANDBY_KEY, allSitesWanted, linkUrl, readPort
} from "./settings.js";
import { isYouTubeHost } from "./youtube.js";

export const ALARM = "vjster-link";

type Listener<A extends unknown[]> = { addListener(fn: (...args: A) => void): void };

/** Who sent a runtime message: a tab's frame (a content script) or one of this extension's own pages (`url`). */
export interface MessageSender {
  tab?: { id?: number; windowId: number };
  frameId?: number;
  id?: string;
  url?: string;
}

/** The part of the chrome object the worker uses. */
export interface WorkerChrome {
  runtime: {
    readonly id: string;
    /** A listener that answers later calls `sendResponse` and returns true (Chrome's rule). */
    onMessage: { addListener(fn: (data: unknown, sender: MessageSender, sendResponse?: (response: unknown) => void) => boolean | void): void };
  };
  tabs: {
    /** `url` is there only for tabs on a site the extension has access to (no "tabs" permission). */
    query(info: { active?: boolean }): Promise<{ id?: number; windowId: number; url?: string }[]>;
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
    local: { get(keys: string | string[]): Promise<Record<string, unknown>>; set?(items: Record<string, unknown>): Promise<void> };
    session: { get(keys: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
    onChanged: Listener<[Record<string, { newValue?: unknown }>, string]>;
  };
  alarms: {
    create(name: string, info: { periodInMinutes: number }): Promise<void>;
    onAlarm: Listener<[{ name: string }]>;
  };
  permissions: {
    contains(p: { origins: string[] }): Promise<boolean>;
    /** Chrome took a permission back (the operator removed site access on chrome://extensions, say). */
    onRemoved: Listener<[{ origins?: string[] }]>;
  };
  /** The toolbar button: a mark on it says the link is not up (clicking it opens the options, where the reason is). */
  action?: {
    setBadgeText(details: { text: string }): Promise<void> | void;
    setBadgeBackgroundColor?(details: { color: string }): Promise<void> | void;
  };
  /** Absent in the Chrome Web Store build, which has no `scripting` permission and is YouTube only. */
  scripting?: {
    getRegisteredContentScripts(filter: { ids: string[] }): Promise<{ id: string }[]>;
    registerContentScripts(scripts: typeof ALL_SITES_SCRIPTS): Promise<void>;
    unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
    /** Runs a packaged script in a tab now (declared content scripts run only in pages loaded after the install). */
    executeScript?(injection: { target: { tabId: number }; files: string[]; world?: "ISOLATED" | "MAIN" }): Promise<unknown>;
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

/** The one line the worker writes when another copy of the extension (a second Chrome profile, say) took the link. */
export const STANDBY_NOTE = "VJster: another copy of the extension took the link; this one waits until the link is free.";

/** The one line the worker writes when a YouTube tab cannot control quality (R-QLT-2). */
export const NO_QUALITY_NOTE = "VJster: a YouTube tab has no quality methods; quality control is off there, speed still works.";

export interface Worker {
  readonly router: Router;
  readonly link: LinkClient;
  /** Resolves once settings are read and the link has started. */
  readonly booted: Promise<void>;
  /**
   * After an install or an update: gives VJster's two scripts to the tabs that were already open (Chrome runs
   * declared content scripts only in pages loaded afterwards). Resolves with how many tabs got them; when the build
   * cannot inject (the Chrome Web Store build has no `scripting` permission), the options page says to reload.
   */
  adoptOpenTabs(): Promise<number>;
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

  /** The link has been up at least once since the install; another copy holds the link; open tabs need a reload. */
  let everLinked = false;
  let standingBy = false;
  let reloadTabs = false;
  /** The all-sites option is in force: saved on, Chrome's permission granted, the scripting API present (D-4). */
  let allSites = false;
  const allowedHost = (host: string | null): boolean => allSites || (host !== null && isYouTubeHost(host));

  /**
   * Follow the saved choice. When it is off, other sites' tabs are forgotten at once: scripts Chrome already injected
   * keep running until their page reloads. Chrome's registration is kept in step either way, since Chrome drops
   * dynamically registered scripts on an extension update or reload.
   */
  function applyAllSites(stored: unknown): Promise<void> {
    // One at a time: a boot, a storage change and a permission change can overlap, and the last one must win.
    allSitesQueue = allSitesQueue.then(() => applyAllSitesNow(stored)).catch(() => undefined);
    return allSitesQueue;
  }
  let allSitesQueue: Promise<void> = Promise.resolve();

  async function applyAllSitesNow(stored: unknown): Promise<void> {
    const scripting = c.scripting;
    const wanted = scripting !== undefined && allSitesWanted(stored) && (await c.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false));
    allSites = wanted;
    if (!wanted) router.forgetHosts((host) => !(host !== null && isYouTubeHost(host)));
    if (!scripting) return;
    try {
      const have = (await scripting.getRegisteredContentScripts({ ids: ALL_SITES_IDS })).map((s) => s.id);
      if (wanted && have.length < ALL_SITES_IDS.length) {
        if (have.length > 0) await scripting.unregisterContentScripts({ ids: have });
        await scripting.registerContentScripts(ALL_SITES_SCRIPTS);
      } else if (!wanted && have.length > 0) await scripting.unregisterContentScripts({ ids: have });
    } catch {
      log("VJster: the all-sites scripts could not be brought in step with the option.");
    }
  }

  const link = new LinkClient({
    url: () => linkUrl(port),
    open: env.openSocket,
    onIntent: (intent) => {
      void router.intent(intent);
    },
    onOpen: () => {
      // The options page's first line is a neutral "waiting" until this has happened once.
      if (!everLinked) {
        everLinked = true;
        void c.storage.local.set?.({ [EVER_LINKED_KEY]: true }).catch(() => undefined);
      }
      showBadge();
      router.linkOpened();
    },
    onClose: () => showBadge(),
    // Kept for the session: Chrome stops an idle worker, and the next one must not take the link back as a new client.
    onStandby: (standby) => {
      if (standby) log(STANDBY_NOTE);
      standingBy = standby;
      void c.storage.session.set({ [STANDBY_KEY]: standby }).catch(() => undefined);
    },
    newId,
    random: env.random
  });

  // This extension's own pages (the options page) start with this address; a content script's sender has the web page's.
  const ownPages = `chrome-extension://${c.runtime.id}/`;

  c.runtime.onMessage.addListener((data, sender, sendResponse) => {
    // The options page's status line asks how the link is: answered once settings are read and the link has started.
    if (isLinkStatusRequest(data)) {
      if (sender.id !== c.runtime.id || !sender.url?.startsWith(ownPages) || !sendResponse) return;
      void booted.catch(() => undefined).then(() => sendResponse(linkStatus()));
      return true;
    }
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
      // A page on another site counts only while the all-sites option is in force (D-4).
      if (allowedHost(message.host)) router.pageState(tabId, sender.tab?.windowId ?? -1, s, message.host, message.inReplyTo, message.played);
      else router.pageState(tabId, sender.tab?.windowId ?? -1, NO_VIDEO, null, message.inReplyTo, false);
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
    if (area !== "local") return;
    if (changes[PORT_KEY]) {
      port = readPort(changes[PORT_KEY].newValue);
      link.restart();
    }
    if (changes[ALL_SITES_KEY]) void applyAllSites(changes[ALL_SITES_KEY].newValue);
  });

  // Site access taken back outside the options page: follow the stored choice again, now without the permission (D-4).
  c.permissions.onRemoved.addListener(() => {
    void c.storage.local
      .get(ALL_SITES_KEY)
      .then((local) => applyAllSites(local[ALL_SITES_KEY]))
      .catch(() => undefined);
  });

  // A check every minute reconnects if the socket is gone (R-LNK-3).
  c.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) link.ensure();
  });

  async function boot(): Promise<void> {
    const [local, session] = await Promise.all([c.storage.local.get([PORT_KEY, ALL_SITES_KEY, EVER_LINKED_KEY]), c.storage.session.get(PIN_KEY)]);
    port = readPort(local[PORT_KEY]);
    everLinked = everLinked || local[EVER_LINKED_KEY] === true;
    reloadTabs = reloadTabs || (await c.storage.session.get(RELOAD_TABS_KEY).then((stored) => stored[RELOAD_TABS_KEY] === true, () => false));
    await applyAllSites(local[ALL_SITES_KEY]);
    const pinned = session[PIN_KEY];
    router.restorePin(typeof pinned === "number" ? pinned : null);
    const focused = await c.windows.getLastFocused().catch(() => null);
    if (focused?.focused && focused.id !== undefined) router.focusChanged(focused.id);
    for (const tab of await c.tabs.query({ active: true }).catch(() => [])) if (tab.id !== undefined) router.tabActivated(tab.id, tab.windowId);
    // A restarted worker starts with an empty registry: ask every tab what it plays.
    refreshAll();
    await c.alarms.create(ALARM, { periodInMinutes: 1 });
    const standby = await c.storage.session.get(STANDBY_KEY).then((stored) => stored[STANDBY_KEY] === true, () => false);
    standingBy = standby;
    link.start({ standby });
    showBadge();
  }

  /**
   * The toolbar button says at a glance whether VJster is linked: nothing while it is, "!" while it is not (once it
   * has been linked at all: before that nothing is wrong yet). Never a failure of the worker's own.
   */
  function showBadge(): void {
    try {
      const text = link.connected || !everLinked ? "" : "!";
      void Promise.resolve(c.action?.setBadgeBackgroundColor?.({ color: "#c62828" })).catch(() => undefined);
      void Promise.resolve(c.action?.setBadgeText({ text })).catch(() => undefined);
    } catch {
      // a browser without the toolbar API
    }
  }

  /** The two scripts, as the manifest declares them: the adapter in the page's world, the bridge in the extension's. */
  async function adoptOpenTabs(): Promise<number> {
    await booted.catch(() => undefined);
    const execute = c.scripting?.executeScript?.bind(c.scripting);
    if (!execute) {
      reloadTabs = true;
      void c.storage.session.set({ [RELOAD_TABS_KEY]: true }).catch(() => undefined);
      return 0;
    }
    let adopted = 0;
    for (const tab of await c.tabs.query({}).catch(() => [])) {
      // Without the "tabs" permission a tab has an address only where the extension may run: nothing else is tried.
      if (tab.id === undefined || typeof tab.url !== "string" || !/^https?:\/\//.test(tab.url)) continue;
      let host = "";
      try {
        host = new URL(tab.url).hostname;
      } catch {
        continue;
      }
      if (!allowedHost(host)) continue;
      try {
        // The bridge first, so the adapter's first report has someone to take it. A tab whose scripts are alive
        // already (they mark their page) takes neither twice.
        await execute({ target: { tabId: tab.id }, files: ["content-bridge.js"] });
        await execute({ target: { tabId: tab.id }, files: ["content-main.js"], world: "MAIN" });
        adopted++;
      } catch {
        // A page Chrome keeps extensions out of (its own pages, the Web Store): left as it is.
      }
    }
    return adopted;
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

  /** The link as the options page shows it. */
  function linkStatus(): LinkStatus {
    return {
      state: link.connected ? "up" : link.connecting ? "connecting" : "down",
      port,
      everLinked,
      ...(standingBy && !link.connected ? { standby: true } : {}),
      ...(reloadTabs ? { reloadTabs: true } : {})
    };
  }

  const booted = boot();
  return { router, link, booted, adoptOpenTabs };
}
