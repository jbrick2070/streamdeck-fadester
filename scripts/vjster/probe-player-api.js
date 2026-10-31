// SPDX-License-Identifier: GPL-2.0-or-later
// VJster Phase 1 step 1 probe. Requirement and fact ids refer to the VJster
// documents (docs/vjster in jbrick2070/streamdeck-fadester): R-TST-5, V-1..V-4,
// V-9.
//
// Plain JavaScript on purpose: it is pasted into a browser console, never
// built, bundled, tested or shipped (R-STD-2 covers shipped code only).
//
// Use: open a youtube.com watch page, open DevTools, optionally set options
// first, then paste this whole file:
//
//   window.VJSTER_PROBE_OPTIONS = { navigate: true, persist: true };
//
//   navigate  also click the first related watch-page video that is not in a
//             playlist or Mix, and report the navigation events (milliseconds
//             after the click) and whether the player and video elements
//             survive. The tab stays on that next video afterwards. In a
//             signed-in browser this adds an entry to watch history.
//   persist   with navigate: set rate 1.5 and a fixed quality level before the
//             click, and report which of the two survives (V-9).
//
// The result is logged as JSON; copy it into the PLAN's section 2. The probe
// changes quality and speed for a few seconds. In a finally block it puts back
// the rate, the quality preference and, if the video was not playing at the
// start, the paused state, on whichever video is loaded by then. After a
// navigation it waits up to 3 s (about 7.5 s after the click) for the new
// video to start before pausing it; one that starts later is left playing.
//
// Ads (R-BEH-1): the probe checks for an ad right before every write to the
// player or the video element, including in the restore. An ad seen before a
// measurement stops the probe and sets `stopped`. An ad seen when the restore
// runs skips the whole restore (`restored.skipped`); an ad that starts during
// the restore's wait skips only the pause (`restored.pauseSkipped`). Either
// way the page is left as the ad found it, which can be a rate other than the
// starting one, or playing.
//
// An unexpected error ends the probe early with `error` set; everything
// measured until then is still reported. An error before anything was
// measured is logged as `{ "error": ... }`.
//
// Reported text: the video title, the browser's user agent, the player's ad
// class names and error messages. No URLs, no history (R-BEH-2).

async function vjsterProbePlayerApi(options) {
  const opts = options || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const safe = (fn) => {
    try {
      return fn();
    } catch (e) {
      return { threw: String(e && e.message) };
    }
  };

  const result = {
    probedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    host: location.hostname
  };
  const p = document.getElementById("movie_player");
  result.playerFound = !!p;
  if (!p) return result;
  const v = p.querySelector("video");

  const wanted = [
    "getAvailableQualityLevels",
    "getPlaybackQuality",
    "getPreferredQuality",
    "setPlaybackQualityRange",
    "setPlaybackQuality",
    "getPlaybackRate",
    "setPlaybackRate",
    "getAvailablePlaybackRates",
    "getVideoData",
    "getPlayerState",
    "playVideo",
    "pauseVideo"
  ];
  const has = (m) => typeof p[m] === "function";
  const playerNow = () => document.getElementById("movie_player") || p;
  const adMarks = () => ({
    classes: [...playerNow().classList].filter((c) => /(^|-)ad-/.test(c)),
    overlay: !!document.querySelector(".ytp-ad-player-overlay, .ytp-ad-player-overlay-layout")
  });
  const adShowing = () => {
    const m = adMarks();
    return m.classes.length > 0 || m.overlay;
  };
  const AD_STOP = "ad-stop";
  const guardAd = (where) => {
    if (adShowing()) {
      result.stopped = "an ad is showing (" + where + "); nothing more was changed";
      throw new Error(AD_STOP);
    }
  };

  result.methods = Object.fromEntries(wanted.map((m) => [m, typeof p[m]]));
  result.title = safe(() => p.getVideoData().title);
  result.availableQualityLevels = safe(() => p.getAvailableQualityLevels());
  result.availablePlaybackRates = safe(() => p.getAvailablePlaybackRates());
  result.adAtStart = adMarks();

  if (adShowing()) {
    result.stopped = "an ad is showing at the start; run again after it ends";
    return result;
  }
  const needed = ["getPlaybackQuality", "getPreferredQuality", "setPlaybackQualityRange", "getPlaybackRate", "setPlaybackRate", "getPlayerState"];
  const missing = needed.filter((m) => !has(m));
  if (missing.length > 0 || !v) {
    result.stopped = "player API incomplete: " + (v ? missing.join(", ") : "no video element");
    return result;
  }

  let start;
  try {
    start = {
      state: p.getPlayerState(),
      preferred: p.getPreferredQuality(),
      quality: p.getPlaybackQuality(),
      rate: p.getPlaybackRate(),
      elementRate: v.playbackRate
    };
  } catch (e) {
    result.error = "could not read the starting state: " + String(e && e.message);
    return result;
  }
  result.start = start;
  const wasPlaying = start.state === 1 || start.state === 3;
  const levels = Array.isArray(result.availableQualityLevels) ? result.availableQualityLevels : [];
  result.quality = [];
  result.rate = [];

  // Polls every 100 ms, so `seenWithinMs` is an upper bound on the change.
  async function settle(want, maxMs) {
    const t0 = performance.now();
    let q = p.getPlaybackQuality();
    while (q !== want && performance.now() - t0 < maxMs) {
      await sleep(100);
      q = p.getPlaybackQuality();
    }
    return { want, got: q, seenWithinMs: Math.round(performance.now() - t0), videoHeight: v.videoHeight, preferred: p.getPreferredQuality() };
  }

  try {
    guardAd("before play");
    if (!wasPlaying && has("playVideo")) {
      p.playVideo();
      await sleep(500);
    }

    // V-2: a fixed level is taken, and the auto form hands control back.
    for (const level of ["small", "hd1080"]) {
      if (!levels.includes(level)) {
        result.quality.push({ want: level, skipped: "not offered by this video" });
        continue;
      }
      guardAd("before quality " + level);
      try {
        p.setPlaybackQualityRange(level, level);
        result.quality.push(await settle(level, 6000));
      } catch (e) {
        result.quality.push({ want: level, threw: String(e && e.message) });
      }
    }
    guardAd("before quality auto");
    try {
      p.setPlaybackQualityRange("auto");
      result.quality.push({ want: "auto", at: "0 ms", preferred: p.getPreferredQuality(), got: p.getPlaybackQuality() });
      await sleep(2000);
      result.quality.push({ want: "auto", at: "2000 ms", preferred: p.getPreferredQuality(), got: p.getPlaybackQuality() });
    } catch (e) {
      result.quality.push({ want: "auto", threw: String(e && e.message) });
    }

    // Rates: what the player accepts, how it snaps and clamps.
    for (const r of [1.5, 1.3, 1.37, 2.25, 3, 5, 0.1, 0.05, 1]) {
      guardAd("before rate " + r);
      try {
        p.setPlaybackRate(r);
        await sleep(250);
        result.rate.push({ ask: r, api: p.getPlaybackRate(), element: v.playbackRate });
      } catch (e) {
        result.rate.push({ ask: r, threw: String(e && e.message) });
      }
    }

    // The element's own limits, outside the player's API (R-SPD-2 extended
    // range). Only the read-back is measured, not the speed actually played.
    guardAd("before element rate");
    try {
      v.playbackRate = 4.5;
      await sleep(250);
      result.elementDirect = { set: 4.5, readBack: v.playbackRate, apiSees: p.getPlaybackRate() };
    } catch (e) {
      result.elementDirect = { set: 4.5, threw: String(e && e.name) };
    }
    guardAd("before element limit");
    try {
      v.playbackRate = 17;
      result.elementLimit = { set: 17, readBack: v.playbackRate };
    } catch (e) {
      result.elementLimit = { set: 17, threw: String(e && e.name) };
    }
    guardAd("before putting the rate back");
    v.playbackRate = start.elementRate;
    p.setPlaybackRate(start.rate);

    if (opts.navigate) {
      // V-9: set a rate and a fixed level, then see which survives navigation.
      if (opts.persist) {
        guardAd("before persist");
        const held = ["hd720", "large", "medium"].find((l) => levels.includes(l));
        p.setPlaybackRate(1.5);
        if (held) p.setPlaybackQualityRange(held, held);
        await sleep(600);
        result.persistBefore = { rate: p.getPlaybackRate(), elementRate: v.playbackRate, preferred: p.getPreferredQuality() };
      }

      // V-4: in-page navigation events, and whether the elements survive.
      const anchors = [...document.querySelectorAll("ytd-compact-video-renderer a#thumbnail, yt-lockup-view-model a[href*='/watch?v=']")];
      const link = anchors.find((a) => {
        const href = a.getAttribute("href") || "";
        return /^\/watch\?v=/.test(href) && !/[?&]list=/.test(href);
      });
      if (link) {
        const seen = [];
        const listeners = new AbortController();
        let clickedAt = 0;
        for (const n of ["yt-navigate-start", "yt-navigate-finish", "yt-page-data-updated"]) {
          document.addEventListener(n, () => seen.push({ event: n, msAfterClick: Math.round(performance.now() - clickedAt) }), { once: true, signal: listeners.signal });
        }
        const beforeId = safe(() => p.getVideoData().video_id);
        try {
          guardAd("before navigation");
          clickedAt = performance.now();
          link.click();
          await sleep(4500);
        } finally {
          listeners.abort();
        }
        const after = document.getElementById("movie_player");
        const afterVideo = after ? after.querySelector("video") : null;
        const afterId = after ? safe(() => after.getVideoData().video_id) : null;
        result.navigation = {
          events: seen,
          samePlayerElement: after === p,
          sameVideoElement: afterVideo === v,
          videoChanged: typeof beforeId === "string" && typeof afterId === "string" ? afterId !== beforeId : null,
          rateAfter: after ? safe(() => after.getPlaybackRate()) : null,
          elementRateAfter: afterVideo ? afterVideo.playbackRate : null,
          preferredAfter: after ? safe(() => after.getPreferredQuality()) : null,
          qualityAfter: after ? safe(() => after.getPlaybackQuality()) : null,
          stateAfter: after ? safe(() => after.getPlayerState()) : null,
          adAfter: adMarks()
        };
      } else {
        result.navigation = { skipped: "no related watch-page video outside a playlist or Mix" };
      }
    }
  } catch (e) {
    if (!(e && e.message === AD_STOP)) result.error = String(e && e.message);
  } finally {
    // Put back what was found, on whichever video is now loaded, unless an ad
    // is showing, in which case nothing is touched (R-BEH-1).
    const now = playerNow();
    const nowVideo = now.querySelector("video") || v;
    if (adShowing()) {
      result.restored = { skipped: "an ad is showing; set rate, quality and pause by hand if needed" };
    } else {
      safe(() => {
        nowVideo.playbackRate = start.elementRate;
      });
      safe(() => now.setPlaybackRate(start.rate));
      safe(() => (start.preferred === "auto" ? now.setPlaybackQualityRange("auto") : now.setPlaybackQualityRange(start.preferred, start.preferred)));
      let pauseSkipped = null;
      if (!wasPlaying) {
        // A video loaded by the navigation may still be starting: wait up to
        // 3 s for it to settle, then pause, unless an ad has started.
        for (let i = 0; i < 30; i++) {
          const s = safe(() => now.getPlayerState());
          if (s === 0 || s === 1 || s === 2 || s === 3 || s === 5) break;
          await sleep(100);
        }
        if (adShowing()) pauseSkipped = "an ad started during the restore; not paused";
        else safe(() => now.pauseVideo());
      }
      await sleep(300);
      result.restored = {
        rate: safe(() => now.getPlaybackRate()),
        elementRate: nowVideo.playbackRate,
        preferred: safe(() => now.getPreferredQuality()),
        state: safe(() => now.getPlayerState())
      };
      if (pauseSkipped) result.restored.pauseSkipped = pauseSkipped;
    }
  }
  return result;
}

vjsterProbePlayerApi(window.VJSTER_PROBE_OPTIONS).then(
  (r) => {
    console.log(JSON.stringify(r, null, 2));
    return r;
  },
  (e) => {
    const r = { error: String(e && e.message) };
    console.log(JSON.stringify(r, null, 2));
    return r;
  }
);
