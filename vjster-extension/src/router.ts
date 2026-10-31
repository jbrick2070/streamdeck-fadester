// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the service worker's logic, without chrome.* so it is
// tested in Node (docs/vjster/REQUIREMENTS.md R-TGT-1..4, R-INT-3..4, R-LNK-4;
// PLAN.md 3.2 and 3.7). worker-core.ts wires it to Chrome.
//
// It keeps a registry of tabs whose video has played, picks the current one
// with chooseTarget, forwards intents to it, and turns page states into state
// reports for the plugin.

import { PROTOCOL_VERSION, errorReply, type ErrorCode, type Intent, type Message, type StateReport } from "../../src/vjster/shared/protocol.js";
import { chooseTarget, type TabVideo } from "../../src/vjster/shared/target.js";
import { NO_VIDEO, cleanMessage, type PageState } from "./page-state.js";

interface TabRecord extends TabVideo {
  readonly state: PageState;
  readonly host: string | null;
}

export interface RouterDeps {
  /** Deliver an intent to a tab's bridge; resolves false when the tab cannot be reached. */
  sendToTab(tabId: number, intent: Intent): Promise<boolean>;
  /** Ask every tab's bridge to report now; tabs without VJster ignore it. */
  refreshTabs(): void;
  /** Send a message to the plugin over the link (dropped while the link is down). */
  sendToLink(message: Message): void;
  /** Remember the pinned tab across service worker restarts. */
  savePin(tabId: number | null): void;
  now(): number;
  newId(): string;
}

/** How many sent intent ids are remembered while their answers are awaited. */
export const MAX_AWAITED = 256;

export class Router {
  private readonly tabs = new Map<number, TabRecord>();
  private readonly activeByWindow = new Map<number, number>();
  /** Intent id to the tab it was delivered to; an answer counts only from that tab. */
  private readonly awaited = new Map<string, number>();
  private focusedWindowId: number | null = null;
  private pinnedTabId: number | null = null;
  private lastTarget: number | null = null;

  constructor(private readonly deps: RouterDeps) {}

  /** The tab that is "the current video" now, or null (R-TGT-1, R-TGT-2). */
  target(): number | null {
    return chooseTarget([...this.tabs.values()], {
      focusedWindowId: this.focusedWindowId,
      activeTabIds: [...this.activeByWindow.values()],
      pinnedTabId: this.pinnedTabId
    });
  }

  get pinned(): number | null {
    return this.pinnedTabId;
  }

  /** Restore a pin after a service worker restart. */
  restorePin(tabId: number | null): void {
    this.pinnedTabId = tabId;
  }

  /**
   * A page reported its video. Tabs join the registry once their video plays
   * (R-TGT-1); `played` says the page's video has played since it loaded, so a
   * paused tab rejoins after the worker restarted with an empty registry.
   */
  pageState(tabId: number, windowId: number, state: PageState, host: string | null, inReplyTo: string | null, played = false): void {
    const now = this.deps.now();
    const before = this.tabs.get(tabId);
    if (state.rate === null) {
      this.tabs.delete(tabId);
    } else if (before || state.playing || played) {
      const playStarted = state.playing && !(before?.playing ?? false);
      const paused = !state.playing && (before?.playing ?? false);
      this.tabs.set(tabId, {
        tabId,
        windowId,
        playing: state.playing,
        lastPlayAt: playStarted ? now : (before?.lastPlayAt ?? null),
        lastPauseAt: paused ? now : (before?.lastPauseAt ?? null),
        state,
        host
      });
    }

    const target = this.target();
    if (inReplyTo !== null && this.claim(inReplyTo, tabId)) {
      // An answer goes back whatever the target is now; it is what the intent did.
      this.deps.sendToLink(this.report(state, host, inReplyTo));
      this.lastTarget = target;
      return;
    }
    if (target === tabId || target !== this.lastTarget) this.pushTarget(null);
  }

  /** A page answered an intent with an error; only an answer from the tab the intent went to counts. */
  pageError(tabId: number, code: "no-video" | "unsupported", message: string, inReplyTo: string | null): void {
    if (inReplyTo === null || !this.claim(inReplyTo, tabId)) return;
    this.deps.sendToLink(this.error(code, cleanMessage(message), inReplyTo));
  }

  tabRemoved(tabId: number): void {
    this.tabs.delete(tabId);
    for (const [w, t] of this.activeByWindow) if (t === tabId) this.activeByWindow.delete(w);
    for (const [id, t] of this.awaited) if (t === tabId) this.awaited.delete(id);
    if (this.pinnedTabId === tabId) this.setPin(null);
    this.pushIfTargetChanged();
  }

  /** A tab moved to another window. */
  tabMoved(tabId: number, windowId: number): void {
    const record = this.tabs.get(tabId);
    if (record) this.tabs.set(tabId, { ...record, windowId });
    this.pushIfTargetChanged();
  }

  tabActivated(tabId: number, windowId: number): void {
    this.activeByWindow.set(windowId, tabId);
    this.pushIfTargetChanged();
  }

  focusChanged(windowId: number | null): void {
    this.focusedWindowId = windowId;
    this.pushIfTargetChanged();
  }

  /** The link (re)opened: ask the tabs for fresh state and tell the plugin what is current (R-LNK-4). */
  linkOpened(): void {
    this.deps.refreshTabs();
    this.pushTarget(null);
  }

  /** An intent arrived from the plugin (already parsed, R-INT-3). */
  async intent(intent: Intent): Promise<void> {
    if (intent.target !== "browser") return this.deps.sendToLink(this.error("bad-message", "this extension is the browser target", intent.id));
    if (intent.type === "state.get") return this.pushTarget(intent.id);
    if (intent.type === "pin.set") {
      if (!intent.pinned) this.setPin(null);
      else {
        const active = this.focusedWindowId === null ? undefined : this.activeByWindow.get(this.focusedWindowId);
        if (active === undefined) return this.deps.sendToLink(this.error("no-video", "no active tab to pin", intent.id));
        if (!this.tabs.has(active)) return this.deps.sendToLink(this.error("no-video", "the active tab has no video that has played", intent.id));
        this.setPin(active);
      }
      return this.pushTarget(intent.id);
    }
    const tabId = this.target();
    if (tabId === null) return this.deps.sendToLink(this.error("no-video", "no tab with a video that has played", intent.id));
    this.await(intent.id, tabId);
    const delivered = await this.deps.sendToTab(tabId, intent);
    if (!delivered) {
      this.awaited.delete(intent.id);
      this.tabs.delete(tabId);
      this.deps.sendToLink(this.error("no-video", "the video's tab did not answer", intent.id));
      this.pushIfTargetChanged();
      // It may only have been busy: a page that still plays answers the refresh and rejoins.
      this.deps.refreshTabs();
    }
  }

  /** Remember that `id` went to `tabId`, forgetting the oldest beyond MAX_AWAITED. */
  private await(id: string, tabId: number): void {
    this.awaited.delete(id);
    this.awaited.set(id, tabId);
    while (this.awaited.size > MAX_AWAITED) {
      const oldest = this.awaited.keys().next().value as string;
      this.awaited.delete(oldest);
    }
  }

  /** True once, when `id` was sent to `tabId`; then the id is spent. */
  private claim(id: string, tabId: number): boolean {
    if (this.awaited.get(id) !== tabId) return false;
    this.awaited.delete(id);
    return true;
  }

  private setPin(tabId: number | null): void {
    this.pinnedTabId = tabId;
    this.deps.savePin(tabId);
  }

  private pushIfTargetChanged(): void {
    if (this.target() !== this.lastTarget) this.pushTarget(null);
  }

  /** Send the current target's state (or the no-video state) and remember which tab that was (R-TGT-4). */
  private pushTarget(inReplyTo: string | null): void {
    const target = this.target();
    this.lastTarget = target;
    const record = target === null ? undefined : this.tabs.get(target);
    this.deps.sendToLink(this.report(record?.state ?? NO_VIDEO, record?.host ?? null, inReplyTo));
  }

  private report(state: PageState, host: string | null, inReplyTo: string | null): StateReport {
    return {
      v: PROTOCOL_VERSION,
      id: this.deps.newId(),
      target: "browser",
      type: "state",
      inReplyTo,
      ...state,
      // With no video there is no page to name (PLAN.md 3.3).
      host: state.rate === null ? null : host,
      pinned: this.pinnedTabId !== null && this.pinnedTabId === this.target()
    };
  }

  private error(code: ErrorCode, message: string, inReplyTo: string | null) {
    return errorReply(code, message, inReplyTo, { id: this.deps.newId(), target: "browser" });
  }
}
