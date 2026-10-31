// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page, plugin side (docs/vjster/REQUIREMENTS.md R-OBS-1..2,
// PLAN.md Phase 2): the built page files the link server hands out, and the
// browser source address the settings page shows.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINK_HOST } from "../shared/protocol.js";
import type { ServedFile } from "./link-server.js";

export const OBS_PAGE_PATH = "/obs";
/** Shown in the address until the operator names a video. */
export const VIDEO_PLACEHOLDER = "VIDEO_ID";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TOKEN = /^[0-9a-f]{32}$/;

/**
 * The page files from the plugin's `bin/obs` folder (built by
 * vjster-page/rollup.config.mjs), by the paths the link server serves. Empty,
 * with one warning, when they are missing: the link still works for Chrome.
 */
export function loadObsPage(dir: string, log: { warn(message: string): void }): Map<string, ServedFile> {
  try {
    const html: ServedFile = { type: "text/html; charset=utf-8", body: readFileSync(join(dir, "player.html")) };
    const script: ServedFile = { type: "text/javascript; charset=utf-8", body: readFileSync(join(dir, "player.js")) };
    return new Map([
      [OBS_PAGE_PATH, html],
      [`${OBS_PAGE_PATH}/`, html],
      [`${OBS_PAGE_PATH}/player.js`, script]
    ]);
  } catch {
    log.warn("the OBS page files are missing from the plugin; OBS browser sources cannot load it");
    return new Map();
  }
}

/**
 * The video id in what the operator pasted: a bare id, or a YouTube address
 * (watch, youtu.be, shorts, embed, live, music). Null when there is none.
 */
export function videoIdFrom(input: string): string | null {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const youtube = host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com");
  let candidate: string | null = null;
  if (host === "youtu.be") candidate = url.pathname.split("/")[1] ?? null;
  else if (youtube) {
    const v = url.searchParams.get("v");
    if (v !== null) candidate = v;
    else {
      const [, kind, id] = url.pathname.split("/");
      if (kind === "shorts" || kind === "embed" || kind === "live" || kind === "v") candidate = id ?? null;
    }
  }
  // "videoseries" is the 11-letter path of a playlist embed, not a video.
  return candidate !== null && VIDEO_ID.test(candidate) && candidate !== "videoseries" ? candidate : null;
}

/** The browser source address for OBS; the token goes in the fragment, which is never sent to a server. */
export function obsPageAddress(port: number, token: string, videoId: string | null = null): string {
  if (!TOKEN.test(token)) throw new Error("not an OBS page token");
  const v = videoId !== null && VIDEO_ID.test(videoId) ? videoId : VIDEO_PLACEHOLDER;
  return `http://${LINK_HOST}:${port}${OBS_PAGE_PATH}?v=${v}#token=${token}`;
}
