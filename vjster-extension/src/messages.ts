// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the messages between the page adapter (main world), the
// bridge (isolated world) and the service worker (docs/vjster/PLAN.md 3.7).
//
// The adapter shares its JavaScript world with the page, so a page can always
// forge what the adapter would say. Nothing here is a secret; instead every
// hop validates what it receives, the bridge fills in the host name itself,
// and the worker accepts an answer only from the tab it sent that intent to.
// The worst a page can do is misreport its own video, or claim to play so
// that it becomes the target.

import { parse, serialize, type Intent } from "../../src/vjster/shared/protocol.js";
import { cleanMessage, cleanPageState, type PageState } from "./page-state.js";

export const FROM_PAGE = "vjster-page";
export const FROM_BRIDGE = "vjster-bridge";

/** Adapter to bridge, by window.postMessage. `played`: the page's video has played since the page loaded. */
export type PageToBridge =
  | {
      readonly source: typeof FROM_PAGE;
      readonly kind: "state";
      readonly state: PageState;
      readonly inReplyTo: string | null;
      readonly played: boolean;
    }
  | {
      readonly source: typeof FROM_PAGE;
      readonly kind: "error";
      readonly code: "no-video" | "unsupported";
      readonly message: string;
      readonly inReplyTo: string | null;
    };

/** Bridge to adapter, by window.postMessage: an intent, or a request to report now. */
export type BridgeToPage =
  | { readonly source: typeof FROM_BRIDGE; readonly kind: "intent"; readonly intent: Intent }
  | { readonly source: typeof FROM_BRIDGE; readonly kind: "refresh" };

/** Bridge to service worker, by chrome.runtime.sendMessage. */
export type BridgeToWorker =
  | { readonly kind: "page-state"; readonly state: PageState; readonly host: string | null; readonly inReplyTo: string | null; readonly played: boolean }
  | { readonly kind: "page-error"; readonly code: "no-video" | "unsupported"; readonly message: string; readonly inReplyTo: string | null };

/** Service worker to bridge, by chrome.tabs.sendMessage: an intent, or a request to report now. */
export type WorkerToBridge = { readonly kind: "intent"; readonly intent: Intent } | { readonly kind: "refresh" };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const replyId = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);
const errorCode = (v: unknown): "no-video" | "unsupported" | null => (v === "no-video" || v === "unsupported" ? v : null);

/**
 * The target origin for posting to this same window. A file page's origin is
 * "null" (or "file://"), which postMessage refuses; "*" is safe there, since
 * the message goes to this window only.
 */
export function selfOrigin(origin: string): string {
  return /^https?:\/\/[^/]+$/.test(origin) ? origin : "*";
}

/** An intent re-validated by the same parser the link uses; null when it does not pass. */
export function readIntent(raw: unknown): Intent | null {
  if (!isRecord(raw)) return null;
  let text: string;
  try {
    text = JSON.stringify(raw);
  } catch {
    return null;
  }
  const result = parse(text, "intents");
  if (!result.ok) return null;
  return result.message.type === "ping" || result.message.type === "pong" ? null : (result.message as Intent);
}

/** A page message the bridge accepts, rebuilt from known fields; null for anything else. */
export function readPageMessage(data: unknown): PageToBridge | null {
  if (!isRecord(data) || data.source !== FROM_PAGE) return null;
  if (data.kind === "state" && isRecord(data.state)) {
    return { source: FROM_PAGE, kind: "state", state: cleanPageState(data.state), inReplyTo: replyId(data.inReplyTo), played: data.played === true };
  }
  const code = errorCode(data.code);
  if (data.kind === "error" && code) {
    return { source: FROM_PAGE, kind: "error", code, message: cleanMessage(data.message), inReplyTo: replyId(data.inReplyTo) };
  }
  return null;
}

/** A bridge message the adapter accepts; null for anything else. */
export function readBridgeMessage(data: unknown): BridgeToPage | null {
  if (!isRecord(data) || data.source !== FROM_BRIDGE) return null;
  if (data.kind === "refresh") return { source: FROM_BRIDGE, kind: "refresh" };
  if (data.kind !== "intent") return null;
  const intent = readIntent(data.intent);
  return intent ? { source: FROM_BRIDGE, kind: "intent", intent } : null;
}

/** A bridge message the service worker accepts; null for anything else. */
export function readBridgeToWorker(data: unknown): BridgeToWorker | null {
  if (!isRecord(data)) return null;
  if (data.kind === "page-state" && isRecord(data.state)) {
    const host = typeof data.host === "string" && /^[A-Za-z0-9.-]{1,253}$/.test(data.host) ? data.host : null;
    return { kind: "page-state", state: cleanPageState(data.state), host, inReplyTo: replyId(data.inReplyTo), played: data.played === true };
  }
  const code = errorCode(data.code);
  if (data.kind === "page-error" && code) {
    return { kind: "page-error", code, message: cleanMessage(data.message), inReplyTo: replyId(data.inReplyTo) };
  }
  return null;
}

/** A worker message the bridge accepts; null for anything else. */
export function readWorkerToBridge(data: unknown): WorkerToBridge | null {
  if (!isRecord(data)) return null;
  if (data.kind === "refresh") return { kind: "refresh" };
  if (data.kind !== "intent") return null;
  const intent = readIntent(data.intent);
  return intent ? { kind: "intent", intent } : null;
}

/** Plain-object copy of an intent for postMessage (structured clone drops nothing, but keeps it explicit). */
export function plainIntent(intent: Intent): Intent {
  return JSON.parse(serialize(intent)) as Intent;
}
