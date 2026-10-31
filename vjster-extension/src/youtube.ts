// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the YouTube player as a MediaControl. The method names are
// the ones the Phase 1 step 1 probe confirmed on `#movie_player`
// (docs/vjster/PROBE-LOG.md, F-4); the ad markers are V-3, still unconfirmed.
// No DOM types: the element and document are described by the few members
// used, so this file is tested in Node.

import type { MediaControl } from "./adapter-core.js";

/** The part of a video element the YouTube control reads and writes. */
export interface RateElement {
  playbackRate: number;
}

/** The part of YouTube's player element the adapter uses. */
export interface YouTubePlayerElement {
  readonly classList: { contains(name: string): boolean };
  querySelector(selector: "video"): RateElement | null;
  getAvailablePlaybackRates(): number[];
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getAvailableQualityLevels(): string[];
  getPlaybackQuality(): string;
  getPreferredQuality(): string;
  setPlaybackQualityRange(min: string, max?: string): void;
  getPlayerState(): number;
  getVideoData(): { title?: unknown; video_id?: unknown };
  playVideo(): void;
  pauseVideo(): void;
}

/** Without these the page has no usable YouTube player. */
export const CORE_METHODS = ["getAvailablePlaybackRates", "getPlaybackRate", "setPlaybackRate", "getPlayerState", "getVideoData", "playVideo", "pauseVideo"] as const;
/** Without these only quality control is lost; speed and play/pause stay (R-QLT-2). */
export const QUALITY_METHODS = ["getAvailableQualityLevels", "getPlaybackQuality", "getPreferredQuality", "setPlaybackQualityRange"] as const;

const hasAll = (el: Record<string, unknown>, names: readonly string[]): boolean => names.every((name) => typeof el[name] === "function");

/** Hosts where the YouTube adapter applies (D-4). */
export function isYouTubeHost(hostname: string): boolean {
  return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
}

/** The player element when it exposes the core methods, else null. */
export function findYouTubePlayer(doc: { getElementById(id: string): unknown }): YouTubePlayerElement | null {
  const el = doc.getElementById("movie_player") as unknown as Record<string, unknown> | null;
  if (!el || !hasAll(el, CORE_METHODS)) return null;
  return el as unknown as YouTubePlayerElement;
}

/** The player also offers the quality methods the probe found (F-4). */
export function hasQualityApi(player: YouTubePlayerElement): boolean {
  return hasAll(player as unknown as Record<string, unknown>, QUALITY_METHODS);
}

/** YouTube's states: 1 playing, 3 buffering (still meant to play). */
const PLAYING_STATES = new Set([1, 3]);

export function youTubeControl(player: YouTubePlayerElement, doc: { querySelector(selector: string): unknown }): MediaControl {
  const video = (): RateElement | null => player.querySelector("video");
  // Asked each time: YouTube may attach the quality methods after the core ones.
  const canQuality = (): boolean => hasQualityApi(player);
  return {
    kind: "youtube",
    get canQuality() {
      return canQuality();
    },
    elementRate: () => video()?.playbackRate ?? player.getPlaybackRate(),
    availableRates: () => player.getAvailablePlaybackRates(),
    quality: () => (canQuality() ? player.getPlaybackQuality() : null),
    preferredQuality: () => (canQuality() ? player.getPreferredQuality() : null),
    availableQualities: () => (canQuality() ? player.getAvailableQualityLevels() : []),
    title: () => {
      const title = player.getVideoData()?.title;
      return typeof title === "string" ? title : null;
    },
    playing: () => PLAYING_STATES.has(player.getPlayerState()),
    adShowing: () =>
      player.classList.contains("ad-showing") ||
      player.classList.contains("ad-interrupting") ||
      doc.querySelector(".ytp-ad-player-overlay, .ytp-ad-player-overlay-layout") !== null,
    setRate: (rate) => player.setPlaybackRate(rate),
    setElementRate: (rate) => {
      const v = video();
      if (!v) throw new Error("no video element");
      v.playbackRate = rate;
    },
    setQuality: (level) => player.setPlaybackQualityRange(level, level),
    setQualityAuto: () => player.setPlaybackQualityRange("auto"),
    play: () => player.playVideo(),
    pause: () => player.pauseVideo()
  };
}
