// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: any page's HTML video element as a MediaControl
// (docs/vjster/REQUIREMENTS.md R-SPD-4, R-TGT-3). Speed and transport only;
// quality needs a player API (R-QLT-4).

import type { MediaControl } from "./adapter-core.js";
export { chooseVideo, type VideoLike } from "./video-choice.js";

/** The part of a video element the control uses; no DOM types, so it is tested in Node. */
export interface PlayableVideo {
  playbackRate: number;
  readonly paused: boolean;
  readonly ended: boolean;
  play(): Promise<void>;
  pause(): void;
}

/** The page's title, where there is a page. */
const pageTitle = (): string | null => {
  const title = (globalThis as { document?: { title?: unknown } }).document?.title;
  return typeof title === "string" ? title : null;
};

export function videoControl(pick: () => PlayableVideo | null): MediaControl {
  const v = (): PlayableVideo => {
    const el = pick();
    if (!el) throw new Error("no video element");
    return el;
  };
  return {
    kind: "video",
    canQuality: false,
    elementRate: () => pick()?.playbackRate ?? null,
    availableRates: () => [],
    quality: () => null,
    preferredQuality: () => null,
    availableQualities: () => [],
    title: pageTitle,
    playing: () => {
      const el = pick();
      return el !== null && !el.paused && !el.ended;
    },
    adShowing: () => false,
    setRate: (rate) => {
      v().playbackRate = rate;
    },
    setElementRate: (rate) => {
      v().playbackRate = rate;
    },
    setQuality: () => {
      throw new Error("no quality control");
    },
    setQualityAuto: () => {
      throw new Error("no quality control");
    },
    play: () => {
      // A page may refuse to play (autoplay rules); the next state report shows it still paused.
      v()
        .play()
        .catch(() => undefined);
    },
    pause: () => v().pause()
  };
}
