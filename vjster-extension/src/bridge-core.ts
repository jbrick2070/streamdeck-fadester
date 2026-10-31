// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the bridge's logic, run in the isolated world. It relays
// intents from the service worker to the page adapter and page state back,
// cleaning both ways and filling in the host name itself
// (docs/vjster/PLAN.md 3.3, 3.7). content-bridge.ts calls it with the real
// window and chrome.runtime; tests pass fakes.

import { cleanHost, NO_VIDEO } from "./page-state.js";
import { FROM_BRIDGE, plainIntent, readPageMessage, readWorkerToBridge, selfOrigin, type BridgeToPage, type BridgeToWorker } from "./messages.js";

/** The part of the window the bridge uses. */
export interface BridgeWindow {
  readonly location: { readonly hostname: string; readonly origin: string };
  addEventListener(type: "message", fn: (event: { source: unknown; data: unknown }) => void): void;
  addEventListener(type: "pagehide" | "pageshow", fn: (event: { persisted?: boolean }) => void): void;
  postMessage(message: BridgeToPage, targetOrigin: string): void;
}

/** The part of chrome.runtime the bridge uses. */
export interface BridgeRuntime {
  sendMessage(message: BridgeToWorker): Promise<unknown> | undefined;
  onMessage: { addListener(fn: (data: unknown) => void): void };
}

export function installBridge(win: BridgeWindow, runtime: BridgeRuntime): void {
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

  win.addEventListener("message", (event) => {
    // Only this window's own scripts (the adapter, or the page itself), never a frame.
    if (event.source !== win) return;
    const message = readPageMessage(event.data);
    if (!message) return;
    toWorker(
      message.kind === "state"
        ? { kind: "page-state", state: message.state, host, inReplyTo: message.inReplyTo, played: message.played }
        : { kind: "page-error", code: message.code, message: message.message, inReplyTo: message.inReplyTo }
    );
  });

  runtime.onMessage.addListener((data) => {
    const message = readWorkerToBridge(data);
    if (!message) return;
    if (message.kind === "refresh") return toPage({ source: FROM_BRIDGE, kind: "refresh" });
    toPage({ source: FROM_BRIDGE, kind: "intent", intent: plainIntent(message.intent) });
  });

  // A full navigation away (to another site, a new tab page) runs no adapter
  // afterwards: say the video is gone, so the tab stops being the target.
  win.addEventListener("pagehide", () => toWorker({ kind: "page-state", state: NO_VIDEO, host: null, inReplyTo: null, played: false }));
  // Back from the back-forward cache: the adapter is alive again, ask it to report.
  win.addEventListener("pageshow", (event) => {
    if (event.persisted) toPage({ source: FROM_BRIDGE, kind: "refresh" });
  });
}
