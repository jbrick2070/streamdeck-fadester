// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page: start-up, with the browser parts passed in so it is tested
// in Node (docs/vjster/REQUIREMENTS.md R-OBS-1..2). Order matters: the token
// leaves the page's address before YouTube's script is added, and a script
// that fails to load is tried again, because OBS does not reload the source.

import type { SocketLike } from "../../vjster-extension/src/link-client.js";
import type { EmbedPlayer } from "./embed-control.js";
import { ObsPage, playerVars } from "./page-core.js";
import { readParams, setupProblem, withoutToken } from "./page-params.js";
import type { SettleTimers } from "./settle.js";

export const API_URL = "https://www.youtube.com/iframe_api";
/** Waits before trying YouTube's script again; the last one repeats. */
export const SCRIPT_RETRY_MS = [2000, 4000, 8000, 16000, 30000] as const;

export interface PlayerOptions {
  width: string;
  height: string;
  videoId?: string;
  playerVars: Record<string, string | number>;
  events: Record<string, (event: { data: number }) => void>;
}

/** The browser as the page's start-up uses it. */
export interface BootEnv {
  readonly location: { readonly search: string; readonly hash: string; readonly port: string; readonly pathname: string; readonly origin: string };
  /** history.replaceState with this address. */
  replaceAddress(url: string): void;
  /** Show a line on the page ("" clears it). */
  show(text: string): void;
  /** Add a script element; `onError` runs if it fails to load. */
  addScript(src: string, onError: () => void): void;
  /** Run `fn` once YouTube's API is ready (window.onYouTubeIframeAPIReady). */
  onApiReady(fn: () => void): void;
  /** new YT.Player(id, options), or null when the API is missing. */
  createPlayer(id: string, options: PlayerOptions): EmbedPlayer | null;
  openSocket(url: string): SocketLike;
  readonly timers: SettleTimers;
  random(): number;
}

/** Start the page; returns it, or null when its address is incomplete (the page then says why). */
export function bootPage(env: BootEnv): ObsPage | null {
  const params = readParams(env.location.search, env.location.hash, env.location.port);
  // Take the token out of the address before any other script can read it.
  env.replaceAddress(withoutToken(env.location.pathname, env.location.search));
  const problem = setupProblem(params);
  if (problem) {
    env.show(problem);
    return null;
  }

  let counter = 0;
  const prefix = Math.floor(env.random() * 36 ** 6).toString(36);
  const page = new ObsPage({ params, openSocket: env.openSocket, timers: env.timers, newId: () => `o${prefix}-${++counter}`, random: env.random });

  env.onApiReady(() => {
    env.show("");
    let player: EmbedPlayer | null = null;
    player = env.createPlayer("player", {
      width: "100%",
      height: "100%",
      videoId: params.videoId ?? undefined,
      playerVars: playerVars(params, env.location.origin),
      events: {
        onReady: () => {
          if (player) page.playerReady(player);
        },
        onStateChange: (e) => page.stateChanged(e.data),
        onPlaybackRateChange: () => page.rateChanged(),
        onError: () => page.playerError()
      }
    });
    if (!player) env.show("VJster: YouTube's player did not load.");
  });

  let attempt = 0;
  const load = (): void =>
    env.addScript(API_URL, () => {
      const wait = SCRIPT_RETRY_MS[Math.min(attempt, SCRIPT_RETRY_MS.length - 1)];
      attempt++;
      env.show(`VJster: YouTube's player could not be loaded; trying again in ${Math.round(wait / 1000)} s.`);
      env.timers.setTimeout(load, wait);
    });
  load();
  page.start();
  return page;
}
