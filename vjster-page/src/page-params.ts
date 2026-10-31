// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page: what the browser source address says (docs/vjster/
// REQUIREMENTS.md R-OBS-1..2). The address is the whole configuration:
//
//   http://127.0.0.1:48150/obs?v=<video id>#token=<32 hex digits>
//
// The token sits in the fragment, which no browser sends to any server or in
// a Referer; the page also removes it from its own address before YouTube's
// script loads (player-page.ts).

import { DEFAULT_LINK_PORT, LINK_HOST } from "../../src/vjster/shared/protocol.js";

export interface PageParams {
  /** The YouTube video id, 11 letters, digits, `-` or `_`; null when missing or malformed. */
  readonly videoId: string | null;
  /** A playlist id to play instead of or after the video; null when missing or malformed. */
  readonly playlistId: string | null;
  /** The plugin's OBS page token, 32 lowercase hex digits; null when missing or malformed. */
  readonly token: string | null;
  readonly port: number;
  /** Loop the video or the playlist. */
  readonly loop: boolean;
  /** Start muted (OBS can also mute the source itself). */
  readonly mute: boolean;
  /** Start this many whole seconds in. */
  readonly start: number;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const TOKEN = /^[0-9a-f]{32}$/;

const flag = (v: string | null): boolean => v === "1" || v === "true";

/** A port from the address: 1024 to 65535, else the default. */
export function readPort(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || !/^[0-9]{4,5}$/.test(raw)) return DEFAULT_LINK_PORT;
  const port = Number(raw);
  return port >= 1024 && port <= 65535 ? port : DEFAULT_LINK_PORT;
}

/**
 * Read the page's address. `search` and `hash` are `location.search` and
 * `location.hash`; `servedPort` is `location.port`: the plugin served the
 * page, so its port is the link's port. The token is read from the fragment
 * only, never the query, so it is never sent to any server.
 */
export function readParams(search: string, hash: string, servedPort: string): PageParams {
  const q = new URLSearchParams(search);
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const v = q.get("v");
  const list = q.get("list");
  const token = h.get("token");
  const start = Number(q.get("start") ?? "0");
  return {
    videoId: v !== null && VIDEO_ID.test(v) ? v : null,
    playlistId: list !== null && PLAYLIST_ID.test(list) ? list : null,
    token: token !== null && TOKEN.test(token) ? token : null,
    port: readPort(servedPort === "" ? null : servedPort),
    loop: flag(q.get("loop")),
    mute: flag(q.get("mute")),
    start: Number.isInteger(start) && start > 0 && start < 86400 ? start : 0
  };
}

/** The link address for this page: the OBS target is chosen by the token (R-LNK-2). */
export function linkUrl(params: Pick<PageParams, "port" | "token">): string {
  return `ws://${LINK_HOST}:${params.port}/?token=${params.token ?? ""}`;
}

/** The address without the token, for history.replaceState. */
export function withoutToken(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  q.delete("token");
  const rest = q.toString();
  return rest === "" ? pathname : `${pathname}?${rest}`;
}

/** What the page says when its address is incomplete; null when it can start. */
export function setupProblem(params: PageParams): string | null {
  if (params.token === null) return "VJster: this address has no token. Copy the OBS page address from the VJster settings in Stream Deck.";
  if (params.videoId === null && params.playlistId === null) return "VJster: add ?v= and a YouTube video id to this address.";
  return null;
}
