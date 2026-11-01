// SPDX-License-Identifier: GPL-2.0-or-later
// VJster deck: display, settings, controllers and hub
// (docs/vjster/REQUIREMENTS.md R-SPD-1..6, R-QLT-1..5, R-TGT-2, R-BEH-3..5, R-LNK-1; PLAN.md 3.8).
import { describe, expect, it } from "vitest";
import type { CoalesceClock } from "../src/vjster/shared/coalesce.js";
import type { StateReport, Target } from "../src/vjster/shared/protocol.js";
import {
  PENDING_MS,
  PinController,
  QualityDialController,
  QualityPresetController,
  SpeedDialController,
  SpeedPresetController,
  SpeedStepController,
  TransportController,
  type HubLike
} from "../src/vjster/plugin/controllers.js";
import { escapeText, fit, formatRate, KEY_TEXT_WIDTH, keyImage, qualityStrip, speedStrip, statusWord, svgDataUri, textEm, type TargetView } from "../src/vjster/plugin/display.js";
import { Hub, type ServerLike } from "../src/vjster/plugin/hub.js";
import { LinkPortInUseError, type IntentBody, type LinkEvent, type LinkServerOptions } from "../src/vjster/plugin/link-server.js";
import {
  globalSettings,
  qualityDialSettings,
  qualityPresetSettings,
  speedDialSettings,
  speedPresetSettings,
  speedStepSettings,
  transportSettings
} from "../src/vjster/plugin/settings.js";
import { DECK_KEYS, EN, fill, placeholders, shownLabel, stringsFrom, type Strings } from "../src/vjster/plugin/strings.js";

const state = (extra: Partial<StateReport> = {}): StateReport => ({
  v: 1,
  id: "s",
  target: "browser",
  type: "state",
  inReplyTo: null,
  rate: 1,
  rateDirect: false,
  availableRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4],
  quality: "hd1080",
  availableQualities: ["hd2160", "hd1440", "hd1080", "hd720", "large", "auto"],
  qualityAuto: true,
  title: "A video",
  host: "www.youtube.com",
  playing: true,
  adPlaying: false,
  capabilities: ["speed", "quality", "transport"],
  pinned: false,
  ...extra
});
const connected = (s: StateReport | null = state()): TargetView => ({ status: "connected", state: s });
const words = (svg: string): string[] => [...svg.matchAll(/>([^<>]{1,60})<\/text>/g)].map((m) => m[1]);

/** A fake hub: one view per target, records what is sent, ids s1, s2... */
function fakeHub(views: Partial<Record<Target, TargetView>> = { browser: connected() }) {
  const sent: { target: Target; body: IntentBody; id: string }[] = [];
  let n = 0;
  const hub: HubLike & { views: Partial<Record<Target, TargetView>> } = {
    views,
    view: (t) => hub.views[t] ?? { status: t === "browser" ? "extension-off" : "page-off", state: null },
    send: (t, body) => {
      const v = hub.views[t];
      if (!v || v.status !== "connected") return null;
      const id = `s${++n}`;
      sent.push({ target: t, body, id });
      return id;
    }
  };
  return { hub, sent };
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

function sink() {
  const drawn: string[] = [];
  let alerts = 0;
  return {
    drawn,
    get alerts() {
      return alerts;
    },
    draw: (svg: string) => drawn.push(svg),
    alert: () => {
      alerts++;
    },
    last: () => drawn[drawn.length - 1] ?? ""
  };
}

describe("display (R-SPD-6, R-BEH-4, R-BEH-5)", () => {
  it("escapes markup and drops control characters from page text", () => {
    expect(escapeText(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&#39;");
    expect(escapeText(`a${String.fromCharCode(0)}b${String.fromCharCode(0x202e)}c${String.fromCharCode(0x2028)}d`)).toBe("a b c d");
  });

  it("shortens with ASCII dots and formats rates without trailing zeros", () => {
    expect(fit("short", 10)).toBe("short");
    expect(fit("a".repeat(40), 10)).toBe("aaaaaaa...");
    expect([1, 1.25, 0.5, 16, 0.1, 2.5].map(formatRate)).toEqual(["1x", "1.25x", "0.5x", "16x", "0.1x", "2.5x"]);
  });

  it("names the state a target is in by a code, never by the word drawn (R-BEH-4, R-I18N-2)", () => {
    expect(statusWord({ status: "port-in-use", state: null }, "speed")?.code).toBe("port-in-use");
    expect(statusWord({ status: "extension-off", state: null }, "speed")?.code).toBe("extension-off");
    expect(statusWord({ status: "page-off", state: null }, "speed")?.code).toBe("page-off");
    expect(statusWord(connected(null), "speed")?.code).toBe("no-video");
    expect(statusWord(connected(state({ rate: null })), "speed")?.code).toBe("no-video");
    expect(statusWord(connected(state({ capabilities: ["speed"] })), "quality")?.code).toBe("n-a");
    expect(statusWord(connected(state({ adPlaying: true })), "speed")?.code).toBe("ad");
    expect(statusWord(connected(), "speed")).toBeNull();
  });

  it("draws each status code as its English word", () => {
    const strip = (status: TargetView["status"], s: StateReport | null) =>
      words(speedStrip({ view: { status, state: s }, target: "browser", pending: null, min: 0.25, max: 4, label: "SPEED" }));
    expect(strip("port-in-use", null)).toContain("PORT IN USE");
    expect(strip("extension-off", null)).toContain("EXTENSION OFF");
    expect(strip("page-off", null)).toContain("NO PAGE");
    expect(strip("connected", null)).toContain("NO VIDEO");
    expect(strip("connected", state({ capabilities: ["quality"] }))).toContain("N/A");
    expect(strip("connected", state({ adPlaying: true, rate: null }))).toContain("NO VIDEO");
    expect(words(qualityStrip({ view: connected(state({ adPlaying: true })), target: "browser", pending: null, label: "Q" }))).toContain("AD PLAYING");
  });

  it("draws the speed strip from what the page reports, escaping the title", () => {
    const svg = speedStrip({ view: connected(state({ rate: 1.5, title: "<b>Hi</b>" })), target: "browser", pending: null, min: 0.25, max: 4, label: "SPEED" });
    expect(words(svg)).toEqual(expect.arrayContaining(["SPEED", "WEB", "1.5x", "&lt;b&gt;Hi&lt;/b&gt;"]));
    expect(svg).not.toContain("<b>");
  });

  it("marks a direct rate EXT, an ad AD, and an unanswered request in a dim color", () => {
    expect(words(speedStrip({ view: connected(state({ rate: 8, rateDirect: true })), target: "browser", pending: null, min: 0.1, max: 16, label: "FX" }))).toContain("EXT");
    expect(words(speedStrip({ view: connected(state({ adPlaying: true })), target: "obs", pending: null, min: 0.25, max: 4, label: "SPEED" }))).toContain("AD");
    const pending = speedStrip({ view: connected(), target: "browser", pending: 2, min: 0.25, max: 4, label: "SPEED" });
    expect(words(pending)).toContain("2x");
    expect(pending).toContain('fill="#8a8aa0" text-anchor="middle" filter');
  });

  it("draws the quality strip as 1080p with AUTO or FIXED, and a status word without a video", () => {
    expect(words(qualityStrip({ view: connected(), target: "browser", pending: null, label: "QUALITY" }))).toEqual(expect.arrayContaining(["AUTO", "1080p"]));
    expect(words(qualityStrip({ view: connected(state({ qualityAuto: false, quality: "hd720" })), target: "browser", pending: null, label: "Q" }))).toEqual(
      expect.arrayContaining(["FIXED", "720p"])
    );
    expect(words(qualityStrip({ view: { status: "extension-off", state: null }, target: "browser", pending: null, label: "Q" }))).toContain("EXTENSION OFF");
  });

  it("draws keys with a lit frame when active and wraps everything as a data URI", () => {
    const mainSize = (main: string) => Number(/font-size="([0-9]+)"[^>]*>[^<]*<\/text>/.exec(keyImage({ main, sub: "", active: false, dim: false }))?.[1]);
    expect(mainSize("2x")).toBe(46);
    expect(mainSize("AUTO")).toBe(40); // 46 would touch the frame
    for (const main of ["AUTO", "0.25x", "1080p", "2160p", "16x", "+0.05", "-0.25", "0.1x"]) expect(textEm(main) * mainSize(main)).toBeLessThanOrEqual(KEY_TEXT_WIDTH);
    expect(keyImage({ main: "2x", sub: "SPEED", active: true, dim: false })).toContain('stroke-width="6"');
    expect(keyImage({ main: "2x", sub: "SPEED", active: false, dim: false })).toContain('stroke-width="2"');
    expect(svgDataUri("<svg/>")).toBe("data:image/svg+xml;charset=utf8,%3Csvg%2F%3E");
  });
});

describe("settings (D-7, R-LNK-1)", () => {
  it("fills defaults and refuses values outside the allowed sets", () => {
    expect(speedDialSettings({})).toEqual({ step: 0.25, fineStep: 0.05, extended: false, hold: true, target: "browser", label: "SPEED" });
    expect(speedDialSettings({ step: 0.3, fineStep: "x", extended: true, target: "tv", label: "   " })).toMatchObject({ step: 0.25, fineStep: 0.05, extended: true, target: "browser", label: "FX SPEED" });
    expect(speedDialSettings({ label: "a very long label indeed" }).label).toHaveLength(16);
    expect(qualityDialSettings(null)).toEqual({ hold: true, target: "browser", label: "QUALITY" });
    expect(speedPresetSettings({ rate: 99 })).toMatchObject({ rate: 16, extended: true });
    expect(speedPresetSettings({ rate: 1.37 })).toMatchObject({ rate: 1.35, extended: false });
    expect(speedPresetSettings({ rate: 0.1 }).extended).toBe(true);
    expect(speedStepSettings({ direction: -1, step: 0.5 })).toMatchObject({ direction: -1, step: 0.5 });
    expect(speedStepSettings({ direction: 7 }).direction).toBe(1);
    expect(qualityPresetSettings({ level: "HD720" }).level).toBe("auto");
    expect(transportSettings({ target: "both" }).target).toBe("both");
  });

  it("reads plugin-wide settings safely", () => {
    expect(globalSettings({})).toEqual({ port: 48150, extensionIds: [], obsToken: null, obsAlwaysOn: null });
    expect(globalSettings({ port: 80, extensionIds: "abcdefghijklmnopabcdefghijklmnop, bad", obsToken: "XYZ" })).toEqual({
      port: 48150,
      extensionIds: ["abcdefghijklmnopabcdefghijklmnop", "bad"],
      obsToken: null,
      obsAlwaysOn: null
    });
    expect(globalSettings({ obsAlwaysOn: true }).obsAlwaysOn).toBe(true);
    expect(globalSettings({ obsAlwaysOn: false }).obsAlwaysOn).toBe(false);
    expect(globalSettings({ obsAlwaysOn: "true" }).obsAlwaysOn).toBeNull();
    expect(globalSettings({ port: 50000, obsToken: "0123456789abcdef0123456789abcdef" })).toMatchObject({ port: 50000, obsToken: "0123456789abcdef0123456789abcdef" });
  });
});

describe("SpeedDialController (R-SPD-1..3, R-BEH-3)", () => {
  const make = (views?: Partial<Record<Target, TargetView>>, settings = {}) => {
    const { hub, sent } = fakeHub(views);
    const s = sink();
    const clock = fakeClock();
    const c = new SpeedDialController(hub, s, speedDialSettings(settings), clock);
    return { hub, sent, s, clock, c };
  };

  it("sends one coalesced speed.set per burst, counting from its own unanswered request", () => {
    const { sent, c, clock } = make();
    c.rotate(1, false);
    c.rotate(1, false);
    c.rotate(1, false);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ type: "speed.set", rate: 1.25, hold: true, direct: false });
    clock.advance(50);
    expect(sent).toHaveLength(2);
    expect(sent[1].body).toMatchObject({ rate: 1.75 });
  });

  it("uses the fine step while held, and the strip shows the request dimmed until answered", () => {
    const { sent, c, s, hub } = make();
    c.rotate(2, true);
    expect(sent[0].body).toMatchObject({ rate: 1.1 });
    expect(words(s.last())).toContain("1.1x");
    hub.views.browser = connected(state({ rate: 1.1, inReplyTo: sent[0].id }));
    c.render();
    expect(s.last()).toContain("url(#g)");
  });

  it("drops the pending value once answered, also when the page took a different rate (R-BEH-4)", () => {
    const { sent, c, s, hub, clock } = make();
    c.rotate(1, false);
    expect(words(s.last())).toContain("1.25x");
    hub.views.browser = connected(state({ rate: 2, inReplyTo: sent[0].id }));
    c.render();
    expect(words(s.last())).toContain("2x");
    expect(words(s.last())).not.toContain("1.25x");
    clock.advance(50);
    c.rotate(1, false); // counts from the answered 2, not from the request
    expect(sent[sent.length - 1].body).toMatchObject({ rate: 2.25 });
  });

  it("redraws the reported value by itself when a request goes unanswered (R-BEH-4)", () => {
    const { c, s, clock } = make();
    c.rotate(1, false);
    expect(words(s.last())).toContain("1.25x");
    const drawn = s.drawn.length;
    clock.advance(PENDING_MS + 2);
    expect(s.drawn.length).toBeGreaterThan(drawn);
    expect(words(s.last())).toContain("1x");
  });

  it("drops the pending value at once when an error answers it", () => {
    const { c, s, sent } = make();
    c.rotate(2, false);
    expect(words(s.last())).toContain("1.5x");
    c.error(sent[0].id);
    expect(s.alerts).toBe(1);
    expect(words(s.last())).toContain("1x");
  });

  it("keeps adding turns during an ad, while the page answers with the old rate (R-BEH-1)", () => {
    const { c, sent, hub, clock } = make();
    hub.views.browser = connected(state({ adPlaying: true }));
    c.rotate(1, false);
    hub.views.browser = connected(state({ adPlaying: true, inReplyTo: sent[0].id }));
    clock.advance(50);
    c.rotate(1, false);
    clock.advance(50);
    expect(sent.map((x) => (x.body as { rate: number }).rate)).toEqual([1.25, 1.5]);
  });

  it("a press without a turn cancels a turn still waiting to be sent", () => {
    const { sent, c, clock } = make();
    c.rotate(1, false);
    c.rotate(1, false);
    c.pressDown();
    c.pressUp();
    clock.advance(200);
    expect(sent.map((x) => x.body.type)).toEqual(["speed.set", "speed.reset"]);
  });

  it("a late answer to an older request does not clear a newer one", () => {
    const { sent, c, s, hub } = make();
    c.rotate(1, false);
    c.rotate(1, false);
    hub.views.browser = connected(state({ rate: 1.25, inReplyTo: sent[0].id }));
    c.render();
    expect(words(s.last())).toContain("1.5x");
  });

  it("forgets an unanswered request after PENDING_MS", () => {
    const { c, s, clock } = make();
    c.rotate(4, false);
    clock.advance(PENDING_MS + 1);
    c.render();
    expect(words(s.last())).toContain("1x");
  });

  it("resets to 1x on a press without a turn, not after a turn while held", () => {
    const { sent, c } = make();
    c.pressDown();
    c.pressUp();
    expect(sent.map((x) => x.body.type)).toEqual(["speed.reset"]);
    c.pressDown();
    c.rotate(1, true);
    c.pressUp();
    expect(sent.map((x) => x.body.type)).toEqual(["speed.reset", "speed.set"]);
    c.pressUp();
    expect(sent).toHaveLength(2);
  });

  it("toggles play on a tap, and alerts when the target cannot", () => {
    const { sent, c, s, hub } = make();
    c.tap();
    expect(sent[0].body).toEqual({ type: "transport.toggle" });
    hub.views.browser = connected(state({ capabilities: ["speed"] }));
    c.tap();
    expect(s.alerts).toBe(1);
  });

  it("alerts instead of sending when the extension is off, and still sends during an ad", () => {
    const off = make({});
    off.c.rotate(1, false);
    expect(off.sent).toHaveLength(0);
    expect(off.s.alerts).toBe(1);
    const ad = make({ browser: connected(state({ adPlaying: true })) });
    ad.c.rotate(1, false);
    expect(ad.sent).toHaveLength(1);
  });

  it("sends direct writes in extended range, with the browser's limits", () => {
    const { sent, c } = make(undefined, { extended: true, step: 0.5 });
    c.rotate(40, false);
    expect(sent[0].body).toMatchObject({ rate: 16, direct: true });
  });

  it("sends to both targets when set to both, and alerts only on errors naming its own requests", () => {
    const { sent, c, s } = make({ browser: connected(), obs: connected(state({ target: "obs" })) }, { target: "both" });
    c.rotate(1, false);
    expect(sent.map((x) => x.target)).toEqual(["browser", "obs"]);
    c.error("someone-else");
    expect(s.alerts).toBe(0);
    c.error(sent[1].id);
    expect(s.alerts).toBe(1);
  });
});

describe("QualityDialController (R-QLT-1, R-QLT-3)", () => {
  it("steps from the level playing under Auto, then from its own request, and returns to Auto on a press", () => {
    const { hub, sent } = fakeHub();
    const s = sink();
    const clock = fakeClock();
    const c = new QualityDialController(hub, s, qualityDialSettings({}), clock);
    c.rotate(-1);
    expect(sent[0].body).toEqual({ type: "quality.set", level: "hd720", hold: true });
    c.rotate(-1);
    clock.advance(50);
    expect(sent[1].body).toMatchObject({ level: "large" });
    c.pressDown();
    c.pressUp();
    expect(sent[2].body).toEqual({ type: "quality.reset" });
  });

  it("does not return to Auto when the dial was turned while held", () => {
    const { hub, sent } = fakeHub();
    const c = new QualityDialController(hub, sink(), qualityDialSettings({}), fakeClock());
    c.pressDown();
    c.rotate(1, true);
    c.pressUp();
    expect(sent.map((x) => x.body.type)).toEqual(["quality.set"]);
  });

  it("alerts on a site without quality control", () => {
    const { hub, sent } = fakeHub({ browser: connected(state({ capabilities: ["speed", "transport"] })) });
    const s = sink();
    const c = new QualityDialController(hub, s, qualityDialSettings({}), fakeClock());
    c.rotate(1);
    c.press();
    expect(sent).toHaveLength(0);
    expect(s.alerts).toBe(2);
  });
});

describe("keys (R-SPD-5, R-QLT-5, R-TGT-2)", () => {
  it("speed preset: sends its rate and lights while that rate plays", () => {
    const { hub, sent } = fakeHub({ browser: connected(state({ rate: 2 })) });
    const s = sink();
    const k = new SpeedPresetController(hub, s, speedPresetSettings({ rate: 2 }), fakeClock());
    k.render();
    expect(s.last()).toContain('stroke-width="6"');
    k.press();
    expect(sent[0].body).toEqual({ type: "speed.set", rate: 2, direct: false, hold: true });
  });

  it("speed step: sends a signed step", () => {
    const { hub, sent } = fakeHub();
    const k = new SpeedStepController(hub, sink(), speedStepSettings({ direction: -1, step: 0.05 }), fakeClock());
    k.press();
    expect(sent[0].body).toEqual({ type: "speed.step", delta: -0.05, direct: false, hold: true });
  });

  it("quality preset: dims and alerts for a level the video does not offer; Auto always works", () => {
    const { hub, sent } = fakeHub();
    const s = sink();
    const k = new QualityPresetController(hub, s, qualityPresetSettings({ level: "tiny" }), fakeClock());
    k.render();
    expect(s.last()).toContain('fill="#8a8aa0" text-anchor="middle"');
    k.press();
    expect(s.alerts).toBe(1);
    const auto = new QualityPresetController(hub, sink(), qualityPresetSettings({ level: "auto" }), fakeClock());
    auto.press();
    expect(sent[0].body).toEqual({ type: "quality.reset" });
    const fixed = new QualityPresetController(hub, sink(), qualityPresetSettings({ level: "hd720" }), fakeClock());
    fixed.press();
    expect(sent[1].body).toEqual({ type: "quality.set", level: "hd720", hold: true });
  });

  it("pin: toggles from what the target reports", () => {
    const { hub, sent } = fakeHub();
    const s = sink();
    const k = new PinController(hub, s, fakeClock());
    k.press();
    expect(sent[0].body).toEqual({ type: "pin.set", pinned: true });
    hub.views.browser = connected(state({ pinned: true }));
    k.render();
    expect(words(s.last())).toContain("A video"); // the pinned tab title (R-TGT-2)
    hub.views.browser = connected(state({ pinned: true, title: null }));
    k.render();
    expect(words(s.last())).toContain("PINNED");
    k.press();
    expect(sent[1].body).toEqual({ type: "pin.set", pinned: false });
  });

  it("transport: toggles, and shows PLAYING or PAUSED", () => {
    const { hub, sent } = fakeHub({ browser: connected(state({ playing: false })) });
    const s = sink();
    const k = new TransportController(hub, s, transportSettings({}), fakeClock());
    k.render();
    expect(words(s.last())).toContain("PAUSED");
    k.press();
    expect(sent[0].body).toEqual({ type: "transport.toggle" });
  });
});

describe("Hub (R-LNK-1, R-BEH-4, D-11)", () => {
  function fakeServer(failWith?: Error) {
    const listeners = new Set<(e: LinkEvent) => void>();
    const log: string[] = [];
    let running = false;
    let connected = false;
    const server: ServerLike & { fire(e: LinkEvent): void; setConnected(v: boolean): void; log: string[] } = {
      get running() {
        return running;
      },
      async start() {
        log.push("start");
        if (failWith) throw failWith;
        running = true;
      },
      async stop() {
        log.push("stop");
        running = false;
      },
      on(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      isConnected: () => connected,
      send: () => (connected ? "id" : null),
      fire(e) {
        for (const l of listeners) l(e);
      },
      setConnected(v) {
        connected = v;
      },
      log
    };
    return server;
  }

  it("reports extension-off, then connected with the latest state, then clears the state on disconnect", async () => {
    const server = fakeServer();
    const hub = new Hub({ port: 1 }, () => server);
    let changes = 0;
    hub.subscribe(() => changes++);
    await hub.acquire();
    expect(hub.view("browser")).toEqual({ status: "extension-off", state: null });
    expect(hub.view("obs").status).toBe("page-off");
    server.setConnected(true);
    server.fire({ type: "state", target: "browser", state: state({ rate: 2 }) });
    expect(hub.view("browser")).toMatchObject({ status: "connected", state: { rate: 2 } });
    server.fire({ type: "disconnected", target: "browser" });
    server.setConnected(false);
    expect(hub.view("browser").state).toBeNull();
    expect(changes).toBeGreaterThanOrEqual(3);
  });

  it("shows PORT IN USE when the server cannot bind", async () => {
    const hub = new Hub({ port: 1 }, () => fakeServer(new LinkPortInUseError(1, "EADDRINUSE")));
    await hub.acquire();
    expect(hub.view("browser").status).toBe("port-in-use");
    expect(hub.portInUse).toBe(true);
  });

  it("forwards error reports to error listeners", async () => {
    const server = fakeServer();
    const hub = new Hub({ port: 1 }, () => server);
    const seen: string[] = [];
    hub.onError((_t, e) => seen.push(e.code));
    server.fire({ type: "error", target: "browser", error: { v: 1, id: "e", target: "browser", type: "error", code: "no-video", message: "", inReplyTo: "x" } });
    expect(seen).toEqual(["no-video"]);
  });

  it("never leaves two servers running when two different changes overlap", async () => {
    const made: ReturnType<typeof fakeServer>[] = [];
    const factory = (_o: LinkServerOptions) => {
      const s = fakeServer();
      made.push(s);
      return s;
    };
    const hub = new Hub({ port: 1 }, factory);
    await hub.acquire();
    await Promise.all([hub.reconfigure({ port: 1, obsToken: "a".repeat(32) }), hub.reconfigure({ port: 1, obsToken: "b".repeat(32) })]);
    expect(made).toHaveLength(3);
    expect(made.map((s) => s.running)).toEqual([false, false, true]);
    expect(made[1].log).toEqual(["start", "stop"]);
  });

  it("runs reconfigures one after another, ignores a change that changes nothing, and restarts a running server", async () => {
    const made: ReturnType<typeof fakeServer>[] = [];
    const factory = (_o: LinkServerOptions) => {
      const s = fakeServer();
      made.push(s);
      return s;
    };
    const hub = new Hub({ port: 1 }, factory);
    await hub.acquire();
    await Promise.all([hub.reconfigure({ port: 1, obsToken: null }), hub.reconfigure({ port: 1, obsToken: "a".repeat(32) }), hub.reconfigure({ port: 1, obsToken: "a".repeat(32) })]);
    expect(made).toHaveLength(2);
    expect(made[0].log).toEqual(["start", "stop"]);
    expect(made[1].log).toEqual(["start"]);
    expect(made[1].running).toBe(true);
  });
});

describe("key captions name the target (Phase 2)", () => {
  it("says OBS or SYNC on keys that do not drive Chrome", () => {
    const views = { browser: connected(), obs: connected(state({ target: "obs" })) };
    const caption = (make: (hub: HubLike, s: ReturnType<typeof sink>) => { render(): void }) => {
      const { hub } = fakeHub(views);
      const s = sink();
      make(hub, s).render();
      return words(s.last());
    };
    expect(caption((h, s) => new SpeedPresetController(h, s, speedPresetSettings({ rate: 1 })))).toContain("SPEED");
    expect(caption((h, s) => new SpeedPresetController(h, s, speedPresetSettings({ rate: 1, target: "obs" })))).toContain("OBS SPEED");
    expect(caption((h, s) => new SpeedPresetController(h, s, speedPresetSettings({ rate: 8, target: "both" })))).toContain("SYNC FX SPEED");
    expect(caption((h, s) => new TransportController(h, s, transportSettings({ target: "obs" })))).toContain("OBS PLAYING");
    expect(caption((h, s) => new QualityPresetController(h, s, qualityPresetSettings({ level: "auto", target: "both" })))).toContain("SYNC QUALITY");
    expect(caption((h, s) => new SpeedStepController(h, s, speedStepSettings({ direction: 1, target: "obs" })))).toContain("OBS 1x");
  });
});

describe("after the step 5 review", () => {
  it("drops lone surrogates and noncharacters from titles, so the SVG stays well-formed and encodable", () => {
    const title = "Trailer " + String.fromCharCode(55357) + " x" + String.fromCharCode(65534) + String.fromCharCode(65535) + String.fromCharCode(56320) + "y";
    expect(escapeText(title)).toBe("Trailer   x   y");
    const svg = speedStrip({ view: connected(state({ title })), target: "browser", pending: null, min: 0.25, max: 4, label: "SPEED" });
    expect(() => svgDataUri(svg)).not.toThrow();
    const pair = String.fromCharCode(55356) + String.fromCharCode(57260);
    expect(escapeText("a" + pair)).toBe("a" + pair);
  });

  it("shows the pinned tab's title on the pin key (R-TGT-2)", () => {
    const { hub } = fakeHub({ browser: connected(state({ pinned: true, title: "A very long video title" })) });
    const s = sink();
    new PinController(hub, s).render();
    expect(words(s.last())).toContain("A very long...");
    hub.views.browser = connected(state({ pinned: false }));
    const s2 = sink();
    new PinController(hub, s2).render();
    expect(words(s2.last())).toContain("PIN TAB");
  });

  it("starts no server until the stored settings are in, then runs the acquires and releases made meanwhile", async () => {
    const log: string[] = [];
    let running = false;
    const server = { get running() { return running; }, async start() { log.push("start"); running = true; }, async stop() { log.push("stop"); running = false; }, on: () => () => undefined, isConnected: () => false, send: () => null };
    const hub = new Hub({ port: 1 }, () => server, 10);
    let ready!: () => void;
    hub.holdUntil(new Promise<void>((r) => (ready = r)));
    const a = hub.acquire();
    hub.acquire();
    hub.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(log).toEqual([]);
    ready();
    await a;
    expect(log).toEqual(["start"]);
    hub.release();
    await new Promise((r) => setTimeout(r, 40));
    expect(log).toEqual(["start", "stop"]);
  });

  it("tries a taken port again while actions want the link (D-11)", async () => {
    let taken = true;
    let running = false;
    const server = { get running() { return running; }, async start() { if (taken) throw new LinkPortInUseError(1, "EADDRINUSE"); running = true; }, async stop() { running = false; }, on: () => () => undefined, isConnected: () => false, send: () => null };
    const hub = new Hub({ port: 1 }, () => server, 60_000, 20);
    await hub.acquire();
    expect(hub.portInUse).toBe(true);
    taken = false;
    await new Promise((r) => setTimeout(r, 80));
    expect(hub.portInUse).toBe(false);
    expect(running).toBe(true);
  });

  it("refuses a key whose target lacks the capability even during an ad", () => {
    const { hub, sent } = fakeHub({ browser: connected(state({ adPlaying: true, capabilities: ["transport"] })) });
    const s = sink();
    new SpeedStepController(hub, s, speedStepSettings({ direction: 1 })).press();
    expect(sent).toEqual([]);
    expect(s.alerts).toBe(1);
  });
});

describe("deck words by key (PLAN.md 8.1, R-I18N-1, R-I18N-2)", () => {
  /** A table where every word is marked, so a word drawn without a lookup shows up as English. */
  const marked: Strings = stringsFrom((k) => (k === "captionObs" ? "<{word}> obs" : k === "captionSync" ? "<{word}> sync" : `~${EN[k]}`));

  it("takes a word from the lookup, and English where the lookup has none, an empty one, the key itself or lost placeholders", () => {
    expect(marked.statusAd).toBe("~AD PLAYING");
    const t = stringsFrom((k) => ({ statusAd: "", speed: "speed", auto: 7, tagWeb: "  ", captionObs: "OBS", captionSync: "{word} SYNC", paused: "PAUSE" } as Record<string, unknown>)[k]);
    expect(t.statusAd).toBe("AD PLAYING");
    expect(t.speed).toBe("SPEED"); // the key echoed back, as Stream Deck does for a missing key
    expect(t.auto).toBe("AUTO");
    expect(t.tagWeb).toBe("WEB");
    expect(t.captionObs).toBe("OBS {word}");
    expect(t.captionSync).toBe("{word} SYNC");
    expect(t.paused).toBe("PAUSE");
    expect(stringsFrom(() => undefined)).toEqual(EN);
    for (const k of DECK_KEYS) expect(k).not.toContain(".");
  });

  it("fills placeholders once, without reading values as placeholders", () => {
    expect(fill("OBS {word}", { word: "{word}" })).toBe("OBS {word}");
    expect(fill("{n} and {m}", { n: "1" })).toBe("1 and {m}");
    expect(placeholders("{b} {a} x")).toEqual(["a", "b"]);
  });

  it("draws every status word, tag and caption from the table, none from code", () => {
    const strip = (status: TargetView["status"], s: StateReport | null, target: "browser" | "obs" = "browser") =>
      words(speedStrip({ view: { status, state: s }, target, pending: null, min: 0.25, max: 4, label: "SPEED", strings: marked }));
    expect(strip("port-in-use", null)).toContain("~PORT IN USE");
    expect(strip("extension-off", null)).toContain("~EXTENSION OFF");
    expect(strip("page-off", null, "obs")).toEqual(expect.arrayContaining(["~NO PAGE", "~OBS", "~SPEED"]));
    expect(strip("connected", null)).toEqual(expect.arrayContaining(["~NO VIDEO", "~WEB"]));
    expect(strip("connected", state({ capabilities: ["quality"] }))).toContain("~N/A");
    expect(strip("connected", state({ adPlaying: true }))).toContain("~AD");
    expect(strip("connected", state({ rate: 8, rateDirect: true }))).toContain("~EXT");
    const q = (s: StateReport | null, status: TargetView["status"] = "connected") =>
      words(qualityStrip({ view: { status, state: s }, target: "browser", pending: null, label: "QUALITY", strings: marked }));
    expect(q(state())).toEqual(expect.arrayContaining(["~AUTO", "~QUALITY", "1080p"]));
    expect(q(state({ qualityAuto: false }))).toContain("~FIXED");
    expect(q(state({ adPlaying: true }))).toContain("~AD PLAYING");
    expect(q(null)).toContain("~NO VIDEO");
    expect(q(state({ quality: "auto", qualityAuto: true }))).toContain("~AUTO");

    const views = { browser: connected(), obs: connected(state({ target: "obs" })) };
    const key = (make: (hub: HubLike, s: ReturnType<typeof sink>) => { render(): void }) => {
      const { hub } = fakeHub(views);
      const s = sink();
      make(hub, s).render();
      return words(s.last());
    };
    expect(key((h, s) => new SpeedPresetController(h, s, speedPresetSettings({ rate: 1, target: "obs" }), undefined, marked))).toContain("&lt;~SPEED&gt; obs");
    expect(key((h, s) => new SpeedPresetController(h, s, speedPresetSettings({ rate: 8, target: "both" }), undefined, marked))).toContain("&lt;~FX SPEED&gt; sync");
    expect(key((h, s) => new QualityPresetController(h, s, qualityPresetSettings({ level: "auto" }), undefined, marked))).toEqual(expect.arrayContaining(["~AUTO", "~QUALITY"]));
    expect(key((h, s) => new TransportController(h, s, transportSettings({}), undefined, marked))).toContain("~PLAYING");
    expect(key((h, s) => new PinController(h, s, undefined, marked))).toContain("~PIN TAB");
    views.browser = connected(state({ playing: false, pinned: true, title: "" }));
    expect(key((h, s) => new TransportController(h, s, transportSettings({}), undefined, marked))).toContain("~PAUSED");
    expect(key((h, s) => new PinController(h, s, undefined, marked))).toContain("~PINNED");
    views.browser = connected(state({ rate: null }));
    expect(key((h, s) => new SpeedStepController(h, s, speedStepSettings({}), undefined, marked))).toContain("~SPEED");
    views.browser = connected();
    expect(key((h, s) => new SpeedDialController(h, s, speedDialSettings({ extended: true }), undefined, marked))).toContain("~FX SPEED");
    expect(key((h, s) => new QualityDialController(h, s, qualityDialSettings({}), undefined, marked))).toContain("~QUALITY");
  });

  it("shows a bundled profile's stored label in the deck's language and any other label as typed (R-I18N-2)", () => {
    expect(["SPEED", "FX SPEED", "QUALITY", "NUDGE", "SYNC"].map((l) => shownLabel(l, marked))).toEqual(["~SPEED", "~FX SPEED", "~QUALITY", "~NUDGE", "~SYNC"]);
    expect(["CHROME", "OBS", "CHROME FX", "MY DIAL", "speed", "constructor"].map((l) => shownLabel(l, marked))).toEqual(["CHROME", "OBS", "CHROME FX", "MY DIAL", "speed", "constructor"]);
    // The stored label stays English: only the drawing translates it.
    expect(speedDialSettings({}).label).toBe("SPEED");
  });
});
