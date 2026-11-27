// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page: start-up, with the browser parts passed in so it is tested
// in Node (docs/vjster/REQUIREMENTS.md R-OBS-1..2). Order matters: the token
// leaves the page's address before YouTube's script is added (kept in the
// history entry's state, so a reload of the stripped address still works), and
// a script that fails to load is tried again, because OBS does not reload the
// source by itself.

import type { SocketLike } from "../../vjster-extension/src/link-client.js";
import type { EmbedPlayer } from "./embed-control.js";
import { ObsPage, playerVars } from "./page-core.js";
import { fragmentHasToken, readParams, savedToken, setupProblem, withoutToken, type SavedPageState } from "./page-params.js";
import { note, pageLanguage } from "./page-text.js";
import type { SettleTimers } from "./settle.js";

export const API_URL = "https://www.youtube.com/iframe_api";
/** Waits before trying YouTube's script again; the last one repeats. */
export const SCRIPT_RETRY_MS = [2000, 4000, 8000, 16000, 30000] as const;
/** How long the "standing by" note stays on the page (it is in the OBS output). */
export const STANDBY_NOTE_MS = 15000;

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
  /** history.replaceState(state, "", url). */
  replaceAddress(url: string, state: SavedPageState | null): void;
  /** history.state: what an earlier start of this page saved in its history entry (it survives a reload). */
  readonly historyState?: unknown;
  /** Show a line on the page ("" clears it). */
  show(text: string): void;
  /** The browser's language (navigator.language), used when the address names none. */
  readonly language?: string;
  /** Mark the page as being in this language (`<html lang>`). */
  setLanguage?(lang: string): void;
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
  const fromAddress = readParams(env.location.search, env.location.hash, env.location.port);
  // A token in the fragment always wins (OBS re-applied the URL, perhaps with a new token). Without one, this is a
  // reload of the address the page stripped below (OBS's Refresh, or "Refresh browser when scene becomes active"),
  // and the token is the one the page kept in its history entry.
  const token = fragmentHasToken(env.location.hash) ? fromAddress.token : savedToken(env.historyState);
  const params = { ...fromAddress, token };
  // Take the token out of the address before any other script can read it: YouTube's script puts the page's address
  // in the embed it builds. The token stays in the history entry's state, which is not part of any address and is
  // not written to Storage.
  try {
    env.replaceAddress(withoutToken(env.location.pathname, env.location.search), token === null ? null : { token });
  } catch {
    // A browser that refuses to change the address: the page still runs, with the token from its own address.
  }
  // The notes' language: the plugin's hl= (Stream Deck's language), else the browser's, else English (PLAN.md 8.6).
  const lang = pageLanguage(params.hl ?? env.language);
  env.setLanguage?.(lang);
  const problem = setupProblem(params, lang);
  if (problem) {
    env.show(problem);
    return null;
  }

  let counter = 0;
  const prefix = Math.floor(env.random() * 36 ** 6).toString(36);
  // Standing by (another page with this address holds the link): said on the page for a short while, since the page
  // is the picture that goes on air. Back on the link, the note goes at once.
  // Two notes can be due at once (standing by, and the player that did not load): the standing-by one is shown while
  // it lasts, and when it goes the other is still there, not wiped with it.
  let standbyNote: unknown = null;
  let standbyText = "";
  let playerText = "";
  const draw = (): void => env.show(standbyText || playerText);
  const onStandby = (standby: boolean): void => {
    if (standbyNote !== null) env.timers.clearTimeout(standbyNote);
    standbyNote = null;
    standbyText = standby ? note(lang, "standby") : "";
    draw();
    if (standby) {
      standbyNote = env.timers.setTimeout(() => {
        standbyNote = null;
        standbyText = "";
        draw();
      }, STANDBY_NOTE_MS);
    }
  };
  const page = new ObsPage({ params, openSocket: env.openSocket, timers: env.timers, newId: () => `o${prefix}-${++counter}`, random: env.random, onStandby });

  env.onApiReady(() => {
    playerText = "";
    draw();
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
    if (!player) {
      playerText = note(lang, "playerMissing");
      draw();
    }
  });

  let attempt = 0;
  const load = (): void =>
    env.addScript(API_URL, () => {
      const wait = SCRIPT_RETRY_MS[Math.min(attempt, SCRIPT_RETRY_MS.length - 1)];
      attempt++;
      playerText = note(lang, "retry", { s: String(Math.round(wait / 1000)) });
      draw();
      env.timers.setTimeout(load, wait);
    });
  load();
  page.start();
  return page;
}
