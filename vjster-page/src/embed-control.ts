// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page: YouTube's IFrame embed as a MediaControl (docs/vjster/
// REQUIREMENTS.md R-OBS-1, V-10). What the Phase 2 probe found in the embed
// (PROBE-LOG.md, embed probe):
//
// - `getAvailablePlaybackRates` lists 0.25 to 2. In the desktop app's
//   Chromium 152 the embed still played rates up to 4 on the 0.05 grid; in
//   OBS 33's browser source (CEF 150) it stopped at 2, as listed. The page
//   reports the list as it is, so the deck's range is the one OBS plays.
// - `getPlaybackRate` answers from a cache the iframe updates about 26 ms
//   later, with `onPlaybackRateChange`; settle.ts waits for it.
// - There is no quality setter: no `setPlaybackQualityRange`,
//   `setPlaybackQuality` changes nothing, and neither the player's size nor
//   the `vq` parameter moved the level. So the page offers speed and
//   play/pause only (R-QLT-6 does not hold for the embed).
//
// The adapter treats the embed like a plain video: one rate setter, no
// element access, no quality.

import type { MediaControl } from "../../vjster-extension/src/adapter-core.js";

/** The part of YT.Player the page uses. */
export interface EmbedPlayer {
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  setPlaybackRate(rate: number): void;
  getPlayerState(): number;
  getVideoData(): { title?: unknown } | undefined;
  playVideo(): void;
  pauseVideo(): void;
}

/** The player's own list, usable rates only (V-10: in OBS the embed plays exactly this range). */
export function embedRates(listed: unknown): number[] {
  return Array.isArray(listed) ? listed.filter((r): r is number => typeof r === "number" && Number.isFinite(r) && r > 0) : [];
}

/** YouTube's states: 1 playing, 3 buffering (still meant to play). */
const PLAYING_STATES = new Set([1, 3]);

export function embedControl(player: EmbedPlayer): MediaControl {
  return {
    kind: "video",
    canQuality: false,
    elementRate: () => {
      const r = player.getPlaybackRate();
      return typeof r === "number" && Number.isFinite(r) && r > 0 ? r : null;
    },
    availableRates: () => embedRates(player.getAvailablePlaybackRates()),
    quality: () => null,
    preferredQuality: () => null,
    availableQualities: () => [],
    title: () => {
      const title = player.getVideoData()?.title;
      return typeof title === "string" ? title : null;
    },
    playing: () => PLAYING_STATES.has(player.getPlayerState()),
    // The embed does not say when an ad plays; its own controls are hidden, so nothing waits on it.
    adShowing: () => false,
    setRate: (rate) => player.setPlaybackRate(rate),
    setElementRate: (rate) => player.setPlaybackRate(rate),
    setQuality: () => {
      throw new Error("the embed has no quality control");
    },
    setQualityAuto: () => {
      throw new Error("the embed has no quality control");
    },
    play: () => player.playVideo(),
    pause: () => player.pauseVideo()
  };
}
