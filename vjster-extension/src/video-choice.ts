// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: which video element on a page is "the video" (docs/vjster/REQUIREMENTS.md R-TGT-3).
// No DOM types, so it is tested in Node.

/** The few element properties the choice uses, so it is tested without a DOM. */
export interface VideoLike {
  readonly paused: boolean;
  readonly ended: boolean;
  readonly isConnected: boolean;
  getBoundingClientRect(): { width: number; height: number };
}

/**
 * The video to control on a page with several (R-TGT-3): the playing one
 * (the largest if several play), else the largest visible one, else null.
 */
export function chooseVideo<V extends VideoLike>(videos: readonly V[]): V | null {
  const visible = videos.filter((v) => {
    const r = v.getBoundingClientRect();
    return v.isConnected && r.width > 0 && r.height > 0;
  });
  const area = (v: V): number => {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  };
  const largest = (list: V[]): V | null => (list.length === 0 ? null : list.reduce((a, b) => (area(b) > area(a) ? b : a)));
  const playing = videos.filter((v) => v.isConnected && !v.paused && !v.ended);
  return largest(playing) ?? largest(visible);
}
