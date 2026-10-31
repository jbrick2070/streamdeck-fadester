// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension router (docs/vjster/REQUIREMENTS.md R-TGT-1..4, R-INT-3..4, R-LNK-4).
import { describe, expect, it } from "vitest";
import type { Intent, Message, StateReport } from "../src/vjster/shared/protocol.js";
import { NO_VIDEO, type PageState } from "../vjster-extension/src/page-state.js";
import { MAX_AWAITED, Router } from "../vjster-extension/src/router.js";

const playing = (rate = 1.25, extra: Partial<PageState> = {}): PageState => ({
  ...NO_VIDEO,
  rate,
  availableRates: [0.25, 4],
  quality: "hd720",
  availableQualities: ["hd720", "auto"],
  qualityAuto: true,
  title: "A video",
  playing: true,
  capabilities: ["speed", "quality", "transport"],
  ...extra
});
const paused = (rate = 1.25) => playing(rate, { playing: false });

function setup(reachable = true) {
  let t = 1000;
  let id = 0;
  const sent: Message[] = [];
  const toTabs: { tabId: number; intent: Intent }[] = [];
  const pins: (number | null)[] = [];
  let refreshes = 0;
  const router = new Router({
    sendToTab: async (tabId, intent) => {
      toTabs.push({ tabId, intent });
      return reachable;
    },
    refreshTabs: () => {
      refreshes++;
    },
    sendToLink: (m) => sent.push(m),
    savePin: (p) => pins.push(p),
    now: () => (t += 10),
    newId: () => `x-${++id}`
  });
  return { router, sent, toTabs, pins, refreshes: () => refreshes };
}

const lastState = (sent: Message[]) => [...sent].reverse().find((m) => m.type === "state") as StateReport;
let n = 0;
const intent = (body: Record<string, unknown>): Intent => ({ v: 1, id: `i-${++n}`, target: "browser", ...body }) as Intent;

describe("Router: the registry (R-TGT-1)", () => {
  it("tracks a tab once its video plays, not before", () => {
    const { router } = setup();
    router.pageState(5, 1, paused(), "www.youtube.com", null);
    expect(router.target()).toBeNull();
    router.pageState(5, 1, playing(), "www.youtube.com", null);
    expect(router.target()).toBe(5);
    router.pageState(5, 1, paused(), "www.youtube.com", null);
    expect(router.target()).toBe(5);
  });

  it("tracks a paused tab whose page says its video has played (a restarted worker)", () => {
    const { router } = setup();
    router.pageState(5, 1, paused(), "www.youtube.com", null, true);
    expect(router.target()).toBe(5);
  });

  it("drops a tab whose page no longer has a video", () => {
    const { router } = setup();
    router.pageState(5, 1, playing(), "www.youtube.com", null);
    router.pageState(5, 1, NO_VIDEO, "www.youtube.com", null);
    expect(router.target()).toBeNull();
  });

  it("prefers the focused window's active tab among several playing", () => {
    const { router } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    router.pageState(6, 2, playing(), "b.example", null);
    router.tabActivated(5, 1);
    router.tabActivated(6, 2);
    router.focusChanged(1);
    expect(router.target()).toBe(5);
    router.focusChanged(2);
    expect(router.target()).toBe(6);
  });

  it("without focus, picks the tab that started playing most recently, not the one that reported last", () => {
    const { router } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    router.pageState(6, 2, playing(), "b.example", null);
    expect(router.target()).toBe(6);
    router.pageState(5, 1, playing(1.5), "a.example", null); // still playing: not a new start
    expect(router.target()).toBe(6);
  });

  it("with nothing playing, picks the tab paused most recently", () => {
    const { router } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    router.pageState(6, 2, playing(), "b.example", null);
    router.pageState(6, 2, paused(), "b.example", null);
    router.pageState(5, 1, paused(), "a.example", null);
    expect(router.target()).toBe(5);
    router.pageState(6, 2, paused(2), "b.example", null); // still paused: not a new pause
    expect(router.target()).toBe(5);
  });

  it("follows a tab moved to another window", () => {
    const { router } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    router.pageState(6, 2, playing(), "b.example", null);
    router.tabActivated(5, 3);
    router.focusChanged(3);
    expect(router.target()).toBe(6); // tab 5 is still recorded in window 1
    router.tabMoved(5, 3);
    expect(router.target()).toBe(5);
  });
});

describe("Router: reports to the plugin (R-INT-2, R-TGT-4)", () => {
  it("forwards the current target's unsolicited state with its host, every time", () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(1.5), "www.youtube.com", null);
    expect(lastState(sent)).toMatchObject({ v: 1, target: "browser", type: "state", inReplyTo: null, rate: 1.5, host: "www.youtube.com" });
    router.pageState(5, 1, playing(1.75), "www.youtube.com", null);
    expect(lastState(sent)).toMatchObject({ rate: 1.75 });
  });

  it("does not forward a background tab's state when it is not the target", () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    router.tabActivated(5, 1);
    router.focusChanged(1);
    router.pageState(6, 2, playing(2), "b.example", null);
    const count = sent.length;
    router.pageState(6, 2, playing(3), "b.example", null);
    expect(sent.length).toBe(count);
  });

  it("pushes the new target's state when the target changes", () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(1.5), "a.example", null);
    router.pageState(6, 2, paused(2), "b.example", null); // never played: not tracked
    router.tabRemoved(5);
    expect(lastState(sent)).toMatchObject({ rate: null, host: null, title: null });
  });

  it("pushes the new target when focus or the active tab changes it", () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(1.5), "a.example", null);
    router.pageState(6, 2, playing(2), "b.example", null);
    router.tabActivated(5, 1);
    router.tabActivated(6, 2);
    router.focusChanged(2);
    expect(lastState(sent)).toMatchObject({ rate: 2 });
    router.focusChanged(1);
    expect(lastState(sent)).toMatchObject({ rate: 1.5 });
    router.tabActivated(7, 1);
    expect(lastState(sent)).toMatchObject({ rate: 2 }); // 6 started playing last
  });

  it("asks every tab for fresh state, then sends the current state, when the link opens", () => {
    const { router, sent, refreshes } = setup();
    router.linkOpened();
    expect(refreshes()).toBe(1);
    expect(lastState(sent)).toMatchObject({ rate: null, host: null, capabilities: [] });
  });

  it("names no host when an answer says there is no video", async () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    const i = intent({ type: "speed.reset" });
    await router.intent(i);
    router.pageState(5, 1, NO_VIDEO, "a.example", i.id);
    expect(lastState(sent)).toMatchObject({ inReplyTo: i.id, rate: null, host: null });
  });

  it("flags pinned only while the pinned tab is the target", () => {
    const { router, sent } = setup();
    router.restorePin(9); // a pin on a tab that is not tracked
    router.pageState(5, 1, playing(), "a.example", null);
    expect(lastState(sent)).toMatchObject({ pinned: false });
  });
});

describe("Router: answers count only from the tab the intent went to (R-INT-4)", () => {
  it("forwards the target tab's answer, naming the intent", async () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    const i = intent({ type: "speed.set", rate: 2, direct: false, hold: false });
    await router.intent(i);
    router.pageState(5, 1, playing(2), "a.example", i.id);
    expect(sent[sent.length - 1]).toMatchObject({ type: "state", inReplyTo: i.id, rate: 2 });
  });

  it("treats an answer from another tab as that tab's own unsolicited state, never as the answer", async () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    router.tabActivated(5, 1);
    router.focusChanged(1);
    const i = intent({ type: "speed.set", rate: 2, direct: false, hold: false });
    await router.intent(i);
    const count = sent.length;
    router.pageState(9, 2, playing(3, { title: "FORGED" }), "evil.example", i.id);
    expect(sent.length).toBe(count); // tab 9 is not the target: nothing forwarded
    router.pageState(9, 2, playing(3, { title: "FORGED" }), "evil.example", "i-never-sent");
    expect(sent.length).toBe(count);
  });

  it("forwards an answer once; a replay of the same id is not an answer", async () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    const i = intent({ type: "speed.reset" });
    await router.intent(i);
    router.pageState(5, 1, playing(1), "a.example", i.id);
    router.pageState(5, 1, playing(1), "a.example", i.id);
    expect(sent.filter((m) => m.type === "state" && m.inReplyTo === i.id)).toHaveLength(1);
  });

  it("forwards a page error only from the tab the intent went to, with controls stripped", async () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    const i = intent({ type: "quality.reset" });
    await router.intent(i);
    const count = sent.length;
    router.pageError(9, "unsupported", "forged", i.id);
    router.pageError(5, "unsupported", null as unknown as string, null);
    expect(sent.length).toBe(count);
    router.pageError(5, "unsupported", `no${String.fromCharCode(0)}quality`, i.id);
    expect(sent[sent.length - 1]).toMatchObject({ type: "error", code: "unsupported", inReplyTo: i.id, target: "browser", message: "no quality" });
  });

  it("remembers the target an answer leaves behind", async () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    router.pageState(6, 2, playing(2), "b.example", null);
    router.pageState(5, 1, playing(), "a.example", null);
    router.tabActivated(5, 1);
    router.focusChanged(1);
    const i = intent({ type: "transport.toggle" });
    await router.intent(i);
    router.pageState(5, 1, paused(), "a.example", i.id); // the answer: 5 paused, so 6 is the target now
    const count = sent.length;
    router.pageState(5, 1, paused(), "a.example", null); // 5 is not the target and the target did not change
    expect(sent.length).toBe(count);
  });

  it("forgets the oldest awaited ids beyond the limit", async () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    const first = intent({ type: "speed.reset" });
    await router.intent(first);
    for (let k = 0; k < MAX_AWAITED; k++) await router.intent(intent({ type: "speed.reset" }));
    router.pageState(5, 1, playing(1), "a.example", first.id);
    expect(sent.some((m) => m.type === "state" && m.inReplyTo === first.id)).toBe(false);
  });

  it("forgets awaited ids of a tab that closes", async () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    const i = intent({ type: "speed.reset" });
    await router.intent(i);
    router.tabRemoved(5);
    router.pageState(5, 1, playing(1), "a.example", i.id);
    expect(sent.some((m) => m.type === "state" && m.inReplyTo === i.id)).toBe(false);
  });
});

describe("Router: intents (R-INT-3..4)", () => {
  it("delivers an intent to the target tab", async () => {
    const { router, toTabs } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    const i = intent({ type: "speed.reset" });
    await router.intent(i);
    expect(toTabs).toEqual([{ tabId: 5, intent: i }]);
  });

  it("answers no-video when nothing is tracked", async () => {
    const { router, sent, toTabs } = setup();
    const i = intent({ type: "speed.reset" });
    await router.intent(i);
    expect(toTabs).toEqual([]);
    expect(sent[sent.length - 1]).toMatchObject({ type: "error", code: "no-video", inReplyTo: i.id });
  });

  it("answers no-video and forgets the tab when it cannot be reached", async () => {
    const { router, sent, refreshes } = setup(false);
    router.pageState(5, 1, playing(), "a.example", null);
    const i = intent({ type: "speed.reset" });
    await router.intent(i);
    expect(sent.find((m) => m.type === "error")).toMatchObject({ code: "no-video", inReplyTo: i.id });
    expect(router.target()).toBeNull();
    expect(refreshes()).toBe(1); // asked again: a page that still plays rejoins
    router.pageState(5, 1, playing(), "a.example", i.id); // a late answer is not an answer
    expect(sent.some((m) => m.type === "state" && m.inReplyTo === i.id)).toBe(false);
  });

  it("answers state.get itself with the target's state", async () => {
    const { router, sent, toTabs } = setup();
    router.pageState(5, 1, playing(1.75), "a.example", null);
    const i = intent({ type: "state.get" });
    await router.intent(i);
    expect(toTabs).toEqual([]);
    expect(sent[sent.length - 1]).toMatchObject({ type: "state", inReplyTo: i.id, rate: 1.75 });
  });

  it("refuses an intent addressed to the OBS target", async () => {
    const { router, sent } = setup();
    const i = { ...intent({ type: "speed.reset" }), target: "obs" } as Intent;
    await router.intent(i);
    expect(sent[sent.length - 1]).toMatchObject({ type: "error", code: "bad-message", inReplyTo: i.id });
  });
});

describe("Router: pins (R-TGT-2)", () => {
  it("pins the focused window's active tab, saves it, and makes it the target", async () => {
    const { router, pins, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    router.pageState(6, 2, playing(2), "b.example", null);
    router.pageState(6, 2, paused(2), "b.example", null);
    router.tabActivated(5, 1);
    router.tabActivated(6, 2);
    router.focusChanged(2);
    const i = intent({ type: "pin.set", pinned: true });
    await router.intent(i);
    expect(pins).toEqual([6]);
    expect(router.target()).toBe(6);
    expect(sent[sent.length - 1]).toMatchObject({ type: "state", inReplyTo: i.id, rate: 2, pinned: true });
    await router.intent(intent({ type: "pin.set", pinned: false }));
    expect(pins).toEqual([6, null]);
    expect(router.target()).toBe(5);
    expect(sent[sent.length - 1]).toMatchObject({ type: "state", pinned: false });
  });

  it("answers no-video when there is no focused window to pin from", async () => {
    const { router, sent } = setup();
    const i = intent({ type: "pin.set", pinned: true });
    await router.intent(i);
    expect(sent[sent.length - 1]).toMatchObject({ type: "error", code: "no-video", inReplyTo: i.id, message: "no active tab to pin" });
  });

  it("does not pin an active tab without a video that has played", async () => {
    const { router, sent, pins } = setup();
    router.tabActivated(7, 1);
    router.focusChanged(1);
    const i = intent({ type: "pin.set", pinned: true });
    await router.intent(i);
    expect(pins).toEqual([]);
    expect(sent[sent.length - 1]).toMatchObject({ type: "error", code: "no-video", inReplyTo: i.id });
  });

  it("forgets a closed tab as a window's active tab", async () => {
    const { router, sent } = setup();
    router.pageState(5, 1, playing(), "a.example", null);
    router.tabActivated(5, 1);
    router.focusChanged(1);
    router.tabRemoved(5);
    const i = intent({ type: "pin.set", pinned: true });
    await router.intent(i);
    expect(sent[sent.length - 1]).toMatchObject({ type: "error", message: "no active tab to pin" });
  });

  it("unpins a tab that closes", () => {
    const { router, pins } = setup();
    router.restorePin(6);
    router.tabRemoved(6);
    expect(router.pinned).toBeNull();
    expect(pins).toEqual([null]);
  });
});
