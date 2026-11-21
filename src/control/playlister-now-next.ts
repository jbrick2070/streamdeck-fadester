// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What a Playlister source plays now and what comes next, for the Playlister
 * transport keys. Playlister publishes it through obs-websocket as the vendor
 * `obs-playlister`: the request `get_now_next` and the event
 * `now_next_changed` (Playlister's README, "For controllers and scripts").
 * Only names are published, never paths; `cleanName` holds that on this side
 * too, should a value ever look like a path.
 *
 * A Playlister that does not answer (an older one, or obs-websocket's vendor
 * support off) gives `null`, and the key then draws what it always drew.
 */
import type { DirectObsClient } from "../obs/direct-obs-client.js";
import type { ConnectionStatusInfo } from "../../packages/streamdeck-fadester-shared/src/types.js";

export const PLAYLISTER_VENDOR_NAME = "obs-playlister";
const NOW_NEXT_REQUEST = "get_now_next";
const NOW_NEXT_EVENT = "now_next_changed";
/** Longer than any key can show; a bound on what one event may hold. */
const NAME_LIMIT = 160;

export interface NowNext {
  /** The name of the item that is loaded; "" when nothing is loaded. */
  playing: string;
  /** The name of the item that follows; "" when nothing follows or it is not decided. */
  next: string;
  /** False when Shuffle is on and the next item is chosen only when it starts. */
  nextDecided: boolean;
}

/** A value that looks like a file path or an address: only its last part may be shown. */
const PATH_LIKE = /^(?:[A-Za-z]:[\\/]|[\\/]|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/;

/** Half of a character pair on its own: it cannot be drawn, and the key's picture cannot be encoded with it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The start of a name, at most `limit` UTF-16 units long, cut between whole characters as a reader sees them
 *  (an emoji, a family of emoji joined together, a letter with its accents), never inside one (QA-C02). */
export function cutName(name: string, limit: number): string {
  if (name.length <= limit) return name;
  const pieces = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name), (part) => part.segment)
    : Array.from(name);
  let out = "";
  for (const piece of pieces) {
    if (out.length + piece.length > limit) break;
    out += piece;
  }
  return out;
}

/** A name as a key may show it: one line, trimmed, bounded, whole characters only, and never a path. */
export function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  let name = value.replace(LONE_SURROGATE, "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (PATH_LIKE.test(name)) {
    const parts = name.split(/[\\/]+/).filter((part) => part !== "");
    name = parts.at(-1) ?? "";
  }
  return cutName(name, NAME_LIMIT);
}

/** Playlister's answer or event for one source; null when it is not a Playlister source or says nothing usable. */
export function readNowNext(data: unknown): NowNext | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const fields = data as Record<string, unknown>;
  if (fields.found === false) return null;
  if (typeof fields.playing !== "string" && typeof fields.next !== "string") return null;
  return { playing: cleanName(fields.playing), next: cleanName(fields.next), nextDecided: fields.next_decided !== false };
}

interface Watched {
  listeners: Set<() => void>;
  value: NowNext | null;
  /** Bumped by every read and every event, so an older answer never replaces a newer one. */
  generation: number;
}

export class PlaylisterNowNext {
  private readonly watched = new Map<string, Watched>();
  private wired = false;

  public constructor(private readonly client: DirectObsClient) {}

  /** What the source plays now and next, as last heard; null when Playlister has not said. */
  public get(inputUuid: string): NowNext | null {
    return this.watched.get(inputUuid)?.value ?? null;
  }

  /** Follows one Playlister source while a key shows it; the returned function ends that. */
  public watch(inputUuid: string, listener: () => void): () => void {
    if (!inputUuid) return () => {};
    this.wire();
    let entry = this.watched.get(inputUuid);
    if (!entry) {
      entry = { listeners: new Set(), value: null, generation: 0 };
      this.watched.set(inputUuid, entry);
      if (this.client.isConnected()) void this.read(inputUuid);
    }
    entry.listeners.add(listener);
    return () => {
      const current = this.watched.get(inputUuid);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size === 0) this.watched.delete(inputUuid);
    };
  }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    this.client.on("connectionReady", () => {
      for (const inputUuid of this.watched.keys()) void this.read(inputUuid);
    });
    this.client.on("statusChanged", (status: ConnectionStatusInfo) => {
      if (status.kind === "connected") return;
      // What was heard before the connection went no longer holds.
      for (const [inputUuid, entry] of this.watched) {
        entry.generation++;
        if (entry.value !== null) this.set(inputUuid, entry, null);
      }
    });
    this.client.on("namedVendorEvent", (vendorName: string, eventType: string, eventData: Record<string, unknown>) => {
      if (vendorName !== PLAYLISTER_VENDOR_NAME || eventType !== NOW_NEXT_EVENT) return;
      const inputUuid = typeof eventData.source_uuid === "string" ? eventData.source_uuid : "";
      const entry = this.watched.get(inputUuid);
      if (!entry) return;
      entry.generation++;
      this.set(inputUuid, entry, readNowNext(eventData));
    });
  }

  private async read(inputUuid: string): Promise<void> {
    const entry = this.watched.get(inputUuid);
    if (!entry) return;
    const generation = ++entry.generation;
    let value: NowNext | null = null;
    try {
      value = readNowNext(await this.client.callNamedVendor<Record<string, unknown>>(PLAYLISTER_VENDOR_NAME, NOW_NEXT_REQUEST, { source_uuid: inputUuid }));
    } catch {
      // No such vendor or request (an older Playlister), or the connection went: the key keeps its usual words.
      value = null;
    }
    const current = this.watched.get(inputUuid);
    if (current !== entry || entry.generation !== generation) return;
    this.set(inputUuid, entry, value);
  }

  private set(_inputUuid: string, entry: Watched, value: NowNext | null): void {
    const same = entry.value === value
      || (entry.value !== null && value !== null && entry.value.playing === value.playing && entry.value.next === value.next && entry.value.nextDecided === value.nextDecided);
    entry.value = value;
    if (same) return;
    for (const listener of [...entry.listeners]) listener();
  }
}
