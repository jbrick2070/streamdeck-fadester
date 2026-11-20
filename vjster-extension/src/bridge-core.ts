// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the bridge's logic, run in the isolated world. It relays
// intents from the service worker to the page adapter and page state back,
// cleaning both ways and filling in the host name itself
// (docs/vjster/PLAN.md 3.3, 3.7). content-bridge.ts calls it with the real
// window and chrome.runtime; tests pass fakes.
//
// The page's own scripts share the adapter's world and can post anything the
// adapter can. So the bridge takes nothing about playback on trust: whether a
// video is there, playing, or has played, it reads from the page's media
// elements itself (same DOM, a world the page cannot reach), and it spaces
// what it passes on, however fast the page posts.

import { createCoalescer, type CoalesceClock } from "../../src/vjster/shared/coalesce.js";
import { cleanHost, NO_VIDEO, type PageState } from "./page-state.js";
import { FROM_BRIDGE, plainIntent, readPageMessage, readWorkerToBridge, selfOrigin, type BridgeToPage, type BridgeToWorker } from "./messages.js";
import { forEachShadowRoot, type ScanRoot } from "./shadow-scan.js";

/** What the bridge reads of a media element. */
export interface BridgeVideo {
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  readonly played?: { readonly length: number } | null;
}

/** The part of the document the bridge uses: its videos, in the page and in open shadow roots. */
export interface BridgeDocument {
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

/** The part of the window the bridge uses. */
export interface BridgeWindow {
  readonly location: { readonly hostname: string; readonly origin: string };
  /** Absent only in tests of the plain relay; without it nothing is checked against the page. */
  readonly document?: BridgeDocument;
  addEventListener(type: "message", fn: (event: { source: unknown; data: unknown }) => void): void;
  addEventListener(type: "pagehide" | "pageshow", fn: (event: { persisted?: boolean }) => void): void;
  postMessage(message: BridgeToPage, targetOrigin: string): void;
}

/** The part of chrome.runtime the bridge uses. */
export interface BridgeRuntime {
  sendMessage(message: BridgeToWorker): Promise<unknown> | undefined;
  onMessage: { addListener(fn: (data: unknown) => void): void };
}

export interface BridgeOptions {
  /** The least time between two unsolicited reports passed to the worker; the newest one always gets through. */
  reportMs?: number;
  /** The most answers to intents passed on per second (the deck sends at most 20 intents a second). */
  repliesPerSecond?: number;
  clock?: CoalesceClock;
}

export const BRIDGE_REPORT_MS = 50;
export const BRIDGE_REPLIES_PER_SECOND = 40;

/** What the page's own media elements say, read by the bridge. */
export interface MediaFacts {
  /** The page has a video element (in the page or in an open shadow root). */
  video: boolean;
  /** One of them is playing now. */
  playing: boolean;
  /** One of them has played since the page loaded. */
  played: boolean;
}

const isPlaying = (video: BridgeVideo): boolean => video.paused === false && video.ended !== true && video.readyState >= 2;
const hasPlayed = (video: BridgeVideo): boolean => isPlaying(video) || (video.played?.length ?? 0) > 0;

/**
 * The page's videos as they are now. The page's own list first; open shadow roots are searched only when that list
 * does not settle the question (a web-component player), since that search walks the whole document.
 */
export function readMediaFacts(doc: BridgeDocument): MediaFacts {
  const facts: MediaFacts = { video: false, playing: false, played: false };
  const take = (root: BridgeDocument): void => {
    const videos = root.querySelectorAll("video") as ArrayLike<BridgeVideo>;
    for (let i = 0; i < videos.length; i++) {
      facts.video = true;
      if (isPlaying(videos[i])) facts.playing = true;
      if (hasPlayed(videos[i])) facts.played = true;
    }
  };
  try {
    take(doc);
    if (!facts.playing) forEachShadowRoot(doc as ScanRoot, (shadow) => take(shadow as unknown as BridgeDocument));
  } catch {
    // A page that breaks the search is a page with no video VJster can vouch for.
  }
  return facts;
}

/**
 * A page's report as the bridge can vouch for it: no video element means no video; "playing" and "has played" hold
 * only when an element of the page says so. Everything else in the report (rate, title, quality) describes the
 * page's own player and is passed on as cleaned.
 */
export function vouchFor(state: PageState, played: boolean, facts: MediaFacts): { state: PageState; played: boolean } {
  if (state.rate === null || !facts.video) return { state: NO_VIDEO, played: false };
  return { state: state.playing && !facts.playing ? { ...state, playing: false } : state, played: played && facts.played };
}

export function installBridge(win: BridgeWindow, runtime: BridgeRuntime, options: BridgeOptions = {}): void {
  const host = cleanHost(win.location.hostname);
  const origin = selfOrigin(win.location.origin);

  const toWorker = (out: BridgeToWorker): void => {
    // The worker may be asleep or reloading, and after an extension reload this
    // orphaned script cannot reach it at all; the next report or the refresh on
    // the next link open catches up.
    try {
      runtime.sendMessage(out)?.catch(() => undefined);
    } catch {
      // orphaned: nothing to do
    }
  };
  const toPage = (message: BridgeToPage): void => win.postMessage(message, origin);

  // Unsolicited reports: at most one per reportMs, the newest last. Checked against the page when sent, not when
  // posted, so what goes out is true at that moment.
  const reports = createCoalescer<{ state: PageState; played: boolean }>((report) => {
    const vouched = win.document ? vouchFor(report.state, report.played, readMediaFacts(win.document)) : report;
    toWorker({ kind: "page-state", state: vouched.state, host, inReplyTo: null, played: vouched.played });
  }, options.reportMs ?? BRIDGE_REPORT_MS, options.clock);

  // Answers to intents are passed at once (the deck waits for them), up to a number per second no real page reaches.
  const now = (): number => (options.clock ? options.clock.now() : Date.now());
  const repliesPerSecond = options.repliesPerSecond ?? BRIDGE_REPLIES_PER_SECOND;
  let windowStart = Number.NEGATIVE_INFINITY;
  let repliesInWindow = 0;
  const replyAllowed = (): boolean => {
    const t = now();
    if (t - windowStart >= 1000 || t < windowStart) {
      windowStart = t;
      repliesInWindow = 0;
    }
    return ++repliesInWindow <= repliesPerSecond;
  };

  win.addEventListener("message", (event) => {
    // Only this window's own scripts (the adapter, or the page itself), never a frame.
    if (event.source !== win) return;
    const message = readPageMessage(event.data);
    if (!message) return;
    if (message.kind === "state" && message.inReplyTo === null) {
      reports.push({ state: message.state, played: message.played });
      return;
    }
    if (!replyAllowed()) return;
    if (message.kind === "state") {
      const vouched = win.document ? vouchFor(message.state, message.played, readMediaFacts(win.document)) : message;
      toWorker({ kind: "page-state", state: vouched.state, host, inReplyTo: message.inReplyTo, played: vouched.played });
    } else {
      toWorker({ kind: "page-error", code: message.code, message: message.message, inReplyTo: message.inReplyTo });
    }
  });

  runtime.onMessage.addListener((data) => {
    const message = readWorkerToBridge(data);
    if (!message) return;
    if (message.kind === "refresh") return toPage({ source: FROM_BRIDGE, kind: "refresh" });
    toPage({ source: FROM_BRIDGE, kind: "intent", intent: plainIntent(message.intent) });
  });

  // A full navigation away (to another site, a new tab page) runs no adapter
  // afterwards: say the video is gone, so the tab stops being the target.
  win.addEventListener("pagehide", () => {
    reports.cancel();
    toWorker({ kind: "page-state", state: NO_VIDEO, host: null, inReplyTo: null, played: false });
  });
  // Back from the back-forward cache: the adapter is alive again, ask it to report.
  win.addEventListener("pageshow", (event) => {
    if (event.persisted) toPage({ source: FROM_BRIDGE, kind: "refresh" });
  });
}
