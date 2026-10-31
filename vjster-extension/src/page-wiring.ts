// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the adapter's two checks at the page boundary
// (docs/vjster/PLAN.md 3.7), kept apart from content-main.ts so they are
// tested in Node: run once per page, and listen only to this window.

import type { Report } from "./adapter-core.js";
import { FROM_PAGE, readBridgeMessage, selfOrigin, type PageToBridge } from "./messages.js";
import type { Intent } from "../../src/vjster/shared/protocol.js";

export const MARK = "__vjsterAdapter";

/** The part of the window the adapter's wiring uses. */
export interface PageWindow {
  readonly location: { readonly origin: string };
  addEventListener(type: "message", fn: (event: { source: unknown; data: unknown }) => void): void;
  postMessage(message: PageToBridge, targetOrigin: string): void;
}

/** True the first time on a page, false if VJster's adapter already runs there (the script was injected twice). */
export function claimPage(win: object): boolean {
  const w = win as Record<string, unknown>;
  if (w[MARK]) return false;
  w[MARK] = true;
  return true;
}

/** Deliver the bridge's intents and refresh requests; anything not from this window itself is ignored. */
export function listenToBridge(win: PageWindow, target: { handle(intent: Intent): void; refresh(): void }): void {
  win.addEventListener("message", (event) => {
    if (event.source !== win) return;
    const message = readBridgeMessage(event.data);
    if (!message) return;
    if (message.kind === "refresh") target.refresh();
    else target.handle(message.intent);
  });
}

/** Post an adapter report to the bridge. */
export function postReport(win: PageWindow, report: Report): void {
  const message: PageToBridge =
    report.kind === "state"
      ? { source: FROM_PAGE, kind: "state", state: report.state, inReplyTo: report.inReplyTo, played: report.played }
      : { source: FROM_PAGE, kind: "error", code: report.code, message: report.message, inReplyTo: report.inReplyTo };
  win.postMessage(message, selfOrigin(win.location.origin));
}
