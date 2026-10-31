// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension adapter (docs/vjster/REQUIREMENTS.md R-SPD-1..4, R-QLT-1..7, R-BEH-1, R-INT-4).
import { describe, expect, it } from "vitest";
import { Adapter, type MediaControl, type Report } from "../vjster-extension/src/adapter-core.js";
import type { CoalesceClock } from "../src/vjster/shared/coalesce.js";
import type { Intent } from "../src/vjster/shared/protocol.js";

const YT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
const YT_LEVELS = ["hd1080", "hd720", "large", "medium", "auto"];

/** A fake player: YouTube-like or a plain video, with an ad flag and a level that lags. */
function fakeMedia(kind: "youtube" | "video" = "youtube", canQuality = kind === "youtube") {
  const s = {
    apiRate: 1,
    element: 1,
    preferred: "auto",
    playingLevel: "hd720",
    levels: [...YT_LEVELS],
    playing: true,
    ad: false,
    calls: [] as string[],
    throwOnElement: false
  };
  const control: MediaControl = {
    kind,
    canQuality,
    elementRate: () => s.element,
    availableRates: () => (kind === "youtube" ? YT_RATES : []),
    quality: () => (kind === "youtube" ? s.playingLevel : null),
    preferredQuality: () => (kind === "youtube" ? s.preferred : null),
    availableQualities: () => (kind === "youtube" ? s.levels : []),
    title: () => "Big Buck Bunny\u0000 title",
    playing: () => s.playing,
    adShowing: () => s.ad,
    setRate: (r) => {
      s.calls.push(`setRate ${r}`);
      if (kind === "youtube") {
        // Like the real player: a no-op when it believes the rate is already r.
        if (s.apiRate !== r) s.element = r;
        s.apiRate = r;
      } else s.element = r;
    },
    setElementRate: (r) => {
      s.calls.push(`setElementRate ${r}`);
      if (s.throwOnElement) throw new Error("NotSupportedError");
      s.element = r;
    },
    setQuality: (l) => {
      s.calls.push(`setQuality ${l}`);
      s.preferred = l;
    },
    setQualityAuto: () => {
      s.calls.push("setQualityAuto");
      s.preferred = "auto";
    },
    play: () => {
      s.calls.push("play");
      s.playing = true;
    },
    pause: () => {
      s.calls.push("pause");
      s.playing = false;
    }
  };
  return { s, control };
}

function fakeClock() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const clock: CoalesceClock & { advance(ms: number): void } = {
    now: () => now,
    setTimeout(fn, ms) {
      timers.set(next, { at: now + ms, fn });
      return next++;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    }
  };
  return clock;
}

function setup(kind: "youtube" | "video" = "youtube", present = true, options: { dedupe?: boolean; canQuality?: boolean } = {}) {
  const media = fakeMedia(kind, options.canQuality ?? kind === "youtube");
  const clock = fakeClock();
  const reports: Report[] = [];
  const adapter = new Adapter(() => (present ? media.control : null), (r) => reports.push(r), { clock, dedupe: options.dedupe });
  return { ...media, clock, reports, adapter };
}

let n = 0;
const intent = (body: Record<string, unknown>): Intent => ({ v: 1, id: `i-${++n}`, target: "browser", ...body }) as Intent;
const last = (reports: Report[]) => reports[reports.length - 1];

describe("Adapter: every intent is answered (R-INT-4)", () => {
  it("answers each intent with a state report naming it", () => {
    const { adapter, reports } = setup();
    for (const body of [{ type: "speed.set", rate: 1.5, direct: false, hold: false }, { type: "state.get" }, { type: "transport.toggle" }, { type: "quality.reset" }]) {
      const i = intent(body);
      adapter.handle(i);
      expect(last(reports)).toMatchObject({ kind: "state", inReplyTo: i.id });
    }
  });

  it("answers no-video when the page has no video", () => {
    const { adapter, reports } = setup("youtube", false);
    const i = intent({ type: "speed.reset" });
    adapter.handle(i);
    expect(last(reports)).toEqual({ kind: "error", code: "no-video", message: "no video on this page", inReplyTo: i.id });
    const g = intent({ type: "state.get" });
    adapter.handle(g);
    expect(last(reports)).toMatchObject({ kind: "state", inReplyTo: g.id, state: { rate: null, capabilities: [] } });
  });

  it("answers unsupported for quality on a plain video (R-QLT-4)", () => {
    const { adapter, reports } = setup("video");
    const i = intent({ type: "quality.step", direction: 1, hold: false });
    adapter.handle(i);
    expect(last(reports)).toMatchObject({ kind: "error", code: "unsupported", inReplyTo: i.id });
  });

  it("reports cleaned state: title controls removed, YouTube capabilities, Auto flag", () => {
    const { adapter } = setup();
    expect(adapter.snapshot()).toMatchObject({
      rate: 1,
      title: "Big Buck Bunny title",
      quality: "hd720",
      qualityAuto: true,
      availableRates: YT_RATES,
      capabilities: ["speed", "quality", "transport"]
    });
    expect(setup("video").adapter.snapshot()).toMatchObject({ capabilities: ["speed", "transport"], qualityAuto: null, availableQualities: [] });
  });
});

describe("Adapter: speed (R-SPD-1..4)", () => {
  it("sets the rate through the player, clamped to the player's range", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "speed.set", rate: 1.5, direct: false, hold: false }));
    expect(s.element).toBe(1.5);
    adapter.handle(intent({ type: "speed.set", rate: 9, direct: false, hold: false }));
    expect(s.element).toBe(4);
  });

  it("steps from the playing rate with the shared rules", () => {
    const { adapter, s } = setup();
    s.element = 1.3;
    s.apiRate = 1.3;
    adapter.handle(intent({ type: "speed.step", delta: 0.25, direct: false, hold: false }));
    expect(s.element).toBe(1.5);
    adapter.handle(intent({ type: "speed.step", delta: -0.5, direct: false, hold: false }));
    expect(s.element).toBe(1);
  });

  it("writes the element directly in extended range and marks it (R-SPD-2)", () => {
    const { adapter, s, reports } = setup();
    adapter.handle(intent({ type: "speed.set", rate: 4.5, direct: true, hold: false }));
    expect(s.element).toBe(4.5);
    expect(s.apiRate).toBe(1);
    expect(last(reports)).toMatchObject({ state: { rate: 4.5, rateDirect: true } });
  });

  it("puts the element back on reset even when the player thinks it is already at 1x", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "speed.set", rate: 4.5, direct: true, hold: false }));
    adapter.handle(intent({ type: "speed.reset" }));
    expect(s.element).toBe(1);
    expect(adapter.snapshot().rateDirect).toBe(false);
  });

  it("puts the element on the asked rate after a direct write, even if the player skips it", () => {
    const { adapter, s } = setup();
    s.apiRate = 1.5;
    adapter.handle(intent({ type: "speed.set", rate: 4.5, direct: true, hold: false }));
    adapter.handle(intent({ type: "speed.set", rate: 1.5, direct: false, hold: false }));
    expect(s.element).toBe(1.5);
  });

  it("re-applies a held element rate when the element is replaced (R-SPD-4)", () => {
    const { adapter, s } = setup("video");
    adapter.handle(intent({ type: "speed.set", rate: 1.75, direct: false, hold: true }));
    s.element = 1;
    adapter.elementReplaced();
    expect(s.element).toBe(1.75);
  });

  it("does not hold a rate set without hold", () => {
    const { adapter, s } = setup("video");
    adapter.handle(intent({ type: "speed.set", rate: 1.75, direct: false, hold: false }));
    s.element = 1;
    adapter.elementReplaced();
    expect(s.element).toBe(1);
  });

  it("answers unsupported when the element refuses a rate", () => {
    const { adapter, s, reports } = setup();
    s.throwOnElement = true;
    const i = intent({ type: "speed.set", rate: 4.5, direct: true, hold: false });
    adapter.handle(i);
    expect(last(reports)).toMatchObject({ kind: "error", code: "unsupported", inReplyTo: i.id });
  });
});

describe("Adapter: quality (R-QLT-1..3, R-QLT-7)", () => {
  it("sets a fixed level and reports again once the player has taken it (R-QLT-3)", () => {
    const { adapter, s, reports, clock } = setup();
    adapter.handle(intent({ type: "quality.set", level: "hd1080", hold: false }));
    expect(s.preferred).toBe("hd1080");
    const before = reports.length;
    clock.advance(500);
    expect(reports.length).toBe(before); // still playing hd720
    s.playingLevel = "hd1080";
    clock.advance(500);
    expect(last(reports)).toMatchObject({ kind: "state", inReplyTo: null, state: { quality: "hd1080", qualityAuto: false } });
  });

  it("gives up reading back after 5 s and reports what plays", () => {
    const { adapter, reports, clock } = setup();
    adapter.handle(intent({ type: "quality.set", level: "medium", hold: false }));
    const before = reports.length;
    clock.advance(5000);
    expect(reports.length).toBe(before + 1);
    clock.advance(5000);
    expect(reports.length).toBe(before + 1);
  });

  it("refuses a level the video does not offer", () => {
    const { adapter, reports } = setup();
    const i = intent({ type: "quality.set", level: "hd2160", hold: false });
    adapter.handle(i);
    expect(last(reports)).toMatchObject({ kind: "error", code: "unsupported" });
  });

  it("steps from the fixed level, or from what plays under Auto", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "quality.step", direction: 1, hold: false }));
    expect(s.preferred).toBe("hd1080");
    adapter.handle(intent({ type: "quality.step", direction: -1, hold: false }));
    expect(s.preferred).toBe("hd720");
  });

  it("returns to Auto on reset and on quality.set auto", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "quality.set", level: "large", hold: false }));
    adapter.handle(intent({ type: "quality.reset" }));
    expect(s.preferred).toBe("auto");
    adapter.handle(intent({ type: "quality.set", level: "large", hold: false }));
    adapter.handle(intent({ type: "quality.set", level: "auto", hold: false }));
    expect(s.preferred).toBe("auto");
  });

  it("re-applies a held level after navigation, falling back to the nearest lower (R-QLT-7)", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "quality.set", level: "hd1080", hold: true }));
    s.preferred = "auto"; // YouTube resets it on navigation (V-9)
    s.levels = ["hd720", "large", "auto"];
    adapter.navigated();
    expect(s.preferred).toBe("hd720");
  });

  it("forgets the held level on reset", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "quality.set", level: "hd1080", hold: true }));
    adapter.handle(intent({ type: "quality.reset" }));
    adapter.navigated();
    expect(s.preferred).toBe("auto");
  });
});

describe("Adapter: ads (R-BEH-1)", () => {
  it("changes nothing during an ad, answers with the ad state, and applies the latest held intents after it", () => {
    const { adapter, s, reports } = setup();
    s.ad = true;
    const i = intent({ type: "speed.set", rate: 2, direct: false, hold: false });
    adapter.handle(i);
    adapter.handle(intent({ type: "speed.set", rate: 1.5, direct: false, hold: false }));
    adapter.handle(intent({ type: "quality.set", level: "large", hold: false }));
    expect(s.calls).toEqual([]);
    expect(reports.find((r) => r.kind === "state" && r.inReplyTo === i.id)).toMatchObject({ state: { adPlaying: true } });
    s.ad = false;
    adapter.changed();
    expect(s.element).toBe(1.5);
    expect(s.preferred).toBe("large");
  });

  it("lets two toggles during one ad cancel out", () => {
    const { adapter, s } = setup();
    s.ad = true;
    adapter.handle(intent({ type: "transport.toggle" }));
    adapter.handle(intent({ type: "transport.toggle" }));
    s.ad = false;
    adapter.changed();
    expect(s.calls).toEqual([]);
    expect(s.playing).toBe(true);
  });

  it("does not re-apply held rates or levels while an ad shows", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "quality.set", level: "hd1080", hold: true }));
    s.calls.length = 0;
    s.ad = true;
    adapter.navigated();
    adapter.elementReplaced();
    expect(s.calls).toEqual([]);
  });
});

describe("Adapter: transport", () => {
  it("toggles play and pause", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "transport.toggle" }));
    expect(s.playing).toBe(false);
    adapter.handle(intent({ type: "transport.toggle" }));
    expect(s.playing).toBe(true);
  });
});

describe("Adapter: unsolicited reports coalesce (R-BEH-3)", () => {
  it("sends one report for a burst of media events, then the last one", () => {
    const { adapter, reports, clock } = setup();
    for (let k = 0; k < 10; k++) adapter.changed();
    expect(reports).toHaveLength(1);
    clock.advance(50);
    expect(reports).toHaveLength(2);
    adapter.dispose();
  });
});

describe("Adapter: fixes after the step 4 review", () => {
  it("reads the level back after a return to Auto and reports when it changes (R-QLT-3)", () => {
    const { adapter, s, reports, clock } = setup();
    adapter.handle(intent({ type: "quality.set", level: "medium", hold: false }));
    s.playingLevel = "medium";
    clock.advance(500);
    adapter.handle(intent({ type: "quality.reset" }));
    const before = reports.length;
    clock.advance(1500);
    expect(reports.length).toBe(before); // still medium under Auto
    s.playingLevel = "hd1080";
    clock.advance(500);
    expect(reports.length).toBe(before + 1);
    expect(last(reports)).toMatchObject({ kind: "state", inReplyTo: null, state: { quality: "hd1080", qualityAuto: true } });
  });

  it("gives up reading back Auto after 5 s with one report", () => {
    const { adapter, reports, clock } = setup();
    adapter.handle(intent({ type: "quality.reset" }));
    const before = reports.length;
    clock.advance(4999);
    expect(reports.length).toBe(before);
    clock.advance(1);
    expect(reports.length).toBe(before + 1);
    clock.advance(10000);
    expect(reports.length).toBe(before + 1);
  });

  it("reads a level back every 500 ms", () => {
    const { adapter, s, reports, clock } = setup();
    adapter.handle(intent({ type: "quality.set", level: "large", hold: false }));
    s.playingLevel = "large";
    const before = reports.length;
    clock.advance(499);
    expect(reports.length).toBe(before);
    clock.advance(1);
    expect(reports.length).toBe(before + 1);
  });

  it("keeps re-applying a held level when the player resets it after navigation (V-9)", () => {
    const { adapter, s, clock } = setup();
    adapter.handle(intent({ type: "quality.set", level: "large", hold: true }));
    s.playingLevel = "large";
    adapter.navigated();
    s.preferred = "auto"; // the reset lands after yt-navigate-finish
    s.calls.length = 0;
    clock.advance(500);
    expect(s.calls).toEqual(["setQuality large"]);
    expect(s.preferred).toBe("large");
    s.calls.length = 0;
    clock.advance(5000);
    expect(s.calls).toEqual([]);
  });

  it("re-applies a held level once the level list fills in after navigation (R-QLT-7)", () => {
    const { adapter, s, clock, reports } = setup();
    adapter.handle(intent({ type: "quality.set", level: "hd1080", hold: true }));
    s.playingLevel = "hd1080";
    clock.advance(500);
    s.preferred = "auto";
    s.levels = []; // the next video's levels are not known yet
    s.calls.length = 0;
    adapter.navigated();
    expect(s.calls.filter((c) => c.startsWith("setQuality"))).toEqual([]);
    s.levels = ["hd720", "large", "auto"];
    clock.advance(500);
    expect(s.calls.filter((c) => c.startsWith("setQuality"))).toEqual(["setQuality hd720"]);
    s.playingLevel = "hd720";
    const before = reports.length;
    clock.advance(500);
    expect(reports.length).toBe(before + 1);
    expect(last(reports)).toMatchObject({ state: { quality: "hd720", qualityAuto: false } });
  });

  it("does not re-apply a held level on a read-back tick while an ad shows (R-BEH-1)", () => {
    const { adapter, s, clock } = setup();
    adapter.handle(intent({ type: "quality.set", level: "large", hold: true }));
    s.playingLevel = "large";
    clock.advance(500);
    adapter.navigated();
    s.preferred = "auto";
    s.ad = true;
    s.calls.length = 0;
    clock.advance(1000);
    expect(s.calls).toEqual([]);
    s.ad = false;
    clock.advance(500);
    expect(s.calls).toEqual(["setQuality large"]);
  });

  it("does not hold a level set without hold", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "quality.set", level: "large", hold: false }));
    s.preferred = "auto";
    adapter.navigated();
    expect(s.preferred).toBe("auto");
  });

  it("re-applies a held element rate when an ad ends, even if the element changed during the ad (R-SPD-4, R-BEH-1)", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "speed.set", rate: 8, direct: true, hold: true }));
    s.ad = true;
    adapter.changed();
    s.element = 1; // the new element starts at 1x while the ad class is still set
    adapter.elementReplaced();
    expect(s.element).toBe(1);
    s.ad = false;
    adapter.changed();
    expect(s.element).toBe(8);
    expect(s.calls[s.calls.length - 1]).toBe("setElementRate 8");
  });

  it("re-applies a direct held rate to the element, never through the API", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "speed.set", rate: 8, direct: true, hold: true }));
    s.calls.length = 0;
    s.element = 1;
    adapter.elementReplaced();
    expect(s.calls).toEqual(["setElementRate 8"]);
  });

  it("does not hold a YouTube API rate (the player carries it, V-9)", () => {
    const { adapter, s } = setup();
    adapter.handle(intent({ type: "speed.set", rate: 1.5, direct: false, hold: true }));
    s.calls.length = 0;
    adapter.elementReplaced();
    expect(s.calls).toEqual([]);
  });

  it("forgets a held rate on reset", () => {
    const { adapter, s } = setup("video");
    adapter.handle(intent({ type: "speed.set", rate: 1.75, direct: false, hold: true }));
    adapter.handle(intent({ type: "speed.reset" }));
    s.element = 1.25;
    s.calls.length = 0;
    adapter.elementReplaced();
    expect(s.calls).toEqual([]);
  });

  it("applies held intents in order speed, quality, transport when the ad ends", () => {
    const { adapter, s } = setup();
    s.ad = true;
    adapter.handle(intent({ type: "transport.toggle" }));
    adapter.handle(intent({ type: "quality.set", level: "large", hold: false }));
    adapter.handle(intent({ type: "speed.set", rate: 2, direct: false, hold: false }));
    s.ad = false;
    adapter.changed();
    expect(s.calls).toEqual(["setRate 2", "setQuality large", "pause"]);
  });

  it("keeps speed and play/pause when the quality methods are missing (R-QLT-2)", () => {
    const { adapter, reports, s } = setup("youtube", true, { canQuality: false });
    expect(adapter.snapshot()).toMatchObject({ rate: 1, capabilities: ["speed", "transport"], quality: null, qualityAuto: null, availableQualities: [] });
    const q = intent({ type: "quality.set", level: "large", hold: false });
    adapter.handle(q);
    expect(last(reports)).toMatchObject({ kind: "error", code: "unsupported", inReplyTo: q.id });
    adapter.handle(intent({ type: "speed.set", rate: 1.5, direct: false, hold: false }));
    expect(s.element).toBe(1.5);
  });

  it("answers with an error when the player throws, and reports no video from a throwing snapshot (R-INT-4)", () => {
    const { adapter, reports, control } = setup();
    (control as { title: () => string | null }).title = () => {
      throw new Error("getVideoData broke");
    };
    expect(adapter.snapshot()).toMatchObject({ rate: null });
    const i = intent({ type: "state.get" });
    adapter.handle(i);
    expect(last(reports)).toMatchObject({ kind: "state", inReplyTo: i.id, state: { rate: null } });
    const throwingAd = setup();
    (throwingAd.control as { adShowing: () => boolean }).adShowing = () => {
      throw new Error("classList broke");
    };
    const j = intent({ type: "speed.reset" });
    throwingAd.adapter.handle(j);
    expect(last(throwingAd.reports)).toMatchObject({ kind: "error", code: "unsupported", inReplyTo: j.id });
  });

  it("says whether the video has played since the adapter started", () => {
    const { adapter, reports, s } = setup();
    s.playing = false;
    adapter.refresh();
    expect(last(reports)).toMatchObject({ kind: "state", played: false });
    s.playing = true;
    adapter.refresh();
    s.playing = false;
    adapter.refresh();
    expect(last(reports)).toMatchObject({ kind: "state", played: true, state: { playing: false } });
  });

  it("with dedupe, skips an unsolicited report that says nothing new, but never an answer or a refresh", () => {
    const { adapter, reports, clock, s } = setup("youtube", true, { dedupe: true });
    adapter.changed();
    clock.advance(100);
    adapter.changed();
    clock.advance(100);
    expect(reports).toHaveLength(1);
    s.element = 1.5;
    adapter.changed();
    clock.advance(100);
    expect(reports).toHaveLength(2);
    adapter.refresh();
    expect(reports).toHaveLength(3);
    adapter.handle(intent({ type: "state.get" }));
    expect(reports).toHaveLength(4);
  });

  it("without dedupe, sends every unsolicited report", () => {
    const { adapter, reports, clock } = setup();
    adapter.changed();
    clock.advance(100);
    adapter.changed();
    clock.advance(100);
    expect(reports).toHaveLength(2);
  });
});
