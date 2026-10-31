// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: sender rules, page messages and video choice
// (docs/vjster/PLAN.md 3.3 "What senders must do", 3.7; REQUIREMENTS.md R-TGT-3, R-LNK-5).
import { describe, expect, it } from "vitest";
import { parse } from "../src/vjster/shared/protocol.js";
import { FROM_BRIDGE, FROM_PAGE, readBridgeMessage, readBridgeToWorker, readIntent, readPageMessage, readWorkerToBridge, selfOrigin } from "../vjster-extension/src/messages.js";
import { NO_VIDEO, cleanHost, cleanLevel, cleanLevels, cleanMessage, cleanPageState, cleanRate, cleanRates, cleanTitle } from "../vjster-extension/src/page-state.js";
import { chooseVideo, type VideoLike } from "../vjster-extension/src/video-choice.js";

const ctrl = (code: number): string => String.fromCharCode(code);

describe("cleanTitle", () => {
  it("removes control characters, line separators and bidirectional overrides, and collapses spaces", () => {
    const raw = `  A${ctrl(0)}B${ctrl(10)}C${ctrl(0x2028)}D${ctrl(0x202e)}E${ctrl(0x2066)}F  `;
    expect(cleanTitle(raw)).toBe("A B C D E F");
  });

  it("keeps at most 300 characters and never cuts a surrogate pair", () => {
    expect(cleanTitle("x".repeat(500))).toHaveLength(300);
    const emoji = ctrl(0xd83c) + ctrl(0xdfac);
    const cut = cleanTitle("y".repeat(299) + emoji + "z");
    expect(cut).toBe("y".repeat(299));
  });

  it("is null for nothing usable", () => {
    for (const raw of [null, undefined, 5, "", "   ", ctrl(0) + ctrl(1)]) expect(cleanTitle(raw)).toBeNull();
  });
});

describe("cleanHost, cleanRate, cleanRates, cleanLevels", () => {
  it("keeps plain host names only", () => {
    expect(cleanHost("www.youtube.com")).toBe("www.youtube.com");
    expect(cleanHost("my-site.example")).toBe("my-site.example");
    for (const h of ["", "[::1]", "a b", "host:80", null, 3]) expect(cleanHost(h)).toBeNull();
  });

  it("keeps usable rates, never 0", () => {
    expect(cleanRate(1.25)).toBe(1.25);
    for (const r of [0, -1, 17, Number.NaN, "1"]) expect(cleanRate(r)).toBeNull();
    expect(cleanRates([0.25, 0, 1, 99, "2", 4])).toEqual([0.25, 1, 4]);
    expect(cleanRates(new Array(80).fill(1))).toHaveLength(64);
  });

  it("keeps level ids in order with auto last, and drops anything else", () => {
    expect(cleanLevels(["hd1080", "HD720", "auto", "hd_720", "large"])).toEqual(["hd1080", "large", "auto"]);
    expect(cleanLevels(["auto"])).toEqual([]);
    expect(cleanLevels("hd720")).toEqual([]);
  });
});

describe("cleanPageState", () => {
  it("turns a page without a usable rate into the no-video state", () => {
    expect(cleanPageState({ rate: 0, title: "x", playing: true })).toEqual(NO_VIDEO);
  });

  it("produces something the plugin's parser accepts, whatever the page sends", () => {
    const state = cleanPageState({
      rate: 1.5,
      rateDirect: "yes",
      availableRates: [0.25, 4, 0],
      quality: "unknown",
      availableQualities: ["hd720", "bad id", "auto"],
      qualityAuto: "maybe",
      title: "t".repeat(400) + ctrl(0x2028),
      playing: 1,
      adPlaying: false,
      capabilities: ["speed", "teleport", "speed"]
    });
    const report = { v: 1, id: "s1", target: "browser", type: "state", inReplyTo: null, host: "www.youtube.com", ...state };
    const parsed = parse(JSON.stringify(report), "reports");
    expect(parsed.ok).toBe(true);
    expect(state).toMatchObject({ rateDirect: false, qualityAuto: null, playing: false, capabilities: ["speed"] });
  });
});

describe("page and worker messages", () => {
  const intent = { v: 1, id: "i1", target: "browser", type: "speed.set", rate: 1.5, direct: false, hold: false };

  it("re-validates intents with the link's own parser", () => {
    expect(readIntent(intent)).toEqual(intent);
    expect(readIntent({ ...intent, rate: 0 })).toBeNull();
    expect(readIntent({ v: 1, id: "p", target: "browser", type: "ping", t: 1 })).toBeNull();
    expect(readIntent("text")).toBeNull();
    const cyclic: Record<string, unknown> = { ...intent };
    cyclic.self = cyclic;
    expect(readIntent(cyclic)).toBeNull();
  });

  it("accepts page messages only from the adapter's source tag, cleaned", () => {
    expect(readPageMessage({ source: "other", kind: "state", state: {} })).toBeNull();
    const m = readPageMessage({ source: FROM_PAGE, kind: "state", state: { rate: 2, title: "t" }, inReplyTo: "i1", extra: 1 });
    expect(m).toMatchObject({ source: FROM_PAGE, kind: "state", inReplyTo: "i1", state: { rate: 2, title: "t" } });
    expect(readPageMessage({ source: FROM_PAGE, kind: "state", state: { rate: 2 }, inReplyTo: "bad id!" })).toMatchObject({ inReplyTo: null });
    expect(readPageMessage({ source: FROM_PAGE, kind: "error", code: "no-video", message: "m".repeat(400) })).toMatchObject({ code: "no-video" });
    expect((readPageMessage({ source: FROM_PAGE, kind: "error", code: "no-video", message: "m".repeat(400) }) as { message: string }).message).toHaveLength(300);
    expect(readPageMessage({ source: FROM_PAGE, kind: "error", code: "internal", message: "" })).toBeNull();
  });

  it("accepts bridge messages only with the bridge tag and a valid intent", () => {
    expect(readBridgeMessage({ source: FROM_BRIDGE, kind: "intent", intent })).toEqual({ source: FROM_BRIDGE, kind: "intent", intent });
    expect(readBridgeMessage({ source: FROM_PAGE, kind: "intent", intent })).toBeNull();
    expect(readBridgeMessage({ source: FROM_BRIDGE, kind: "intent", intent: { ...intent, type: "warp" } })).toBeNull();
  });

  it("lets the worker take only a plain host name from the bridge", () => {
    expect(readBridgeToWorker({ kind: "page-state", state: { rate: 1 }, host: "www.youtube.com" })).toMatchObject({ host: "www.youtube.com" });
    expect(readBridgeToWorker({ kind: "page-state", state: { rate: 1 }, host: "www.youtube.com/watch?v=x" })).toMatchObject({ host: null });
    expect(readBridgeToWorker({ kind: "page-error", code: "unsupported", message: "m" })).toMatchObject({ kind: "page-error", code: "unsupported" });
    expect(readBridgeToWorker({ kind: "something" })).toBeNull();
  });

  it("lets the bridge take only intents from the worker", () => {
    expect(readWorkerToBridge({ kind: "intent", intent })).toEqual({ kind: "intent", intent });
    expect(readWorkerToBridge({ kind: "intent", intent: { ...intent, target: "tv" } })).toBeNull();
  });
});

describe("chooseVideo (R-TGT-3)", () => {
  const v = (paused: boolean, w: number, h: number, extra: Partial<VideoLike> = {}): VideoLike => ({
    paused,
    ended: false,
    isConnected: true,
    getBoundingClientRect: () => ({ width: w, height: h }),
    ...extra
  });

  it("prefers the playing video, the largest if several play", () => {
    const small = v(false, 100, 50);
    const big = v(false, 800, 450);
    expect(chooseVideo([v(true, 1920, 1080), small, big])).toBe(big);
  });

  it("falls back to the largest visible paused video, else none", () => {
    const visible = v(true, 640, 360);
    expect(chooseVideo([v(true, 0, 0), visible, v(true, 320, 180)])).toBe(visible);
    expect(chooseVideo([v(true, 0, 0)])).toBeNull();
    expect(chooseVideo([])).toBeNull();
  });

  it("never counts an ended or detached video as playing", () => {
    const gone = v(false, 800, 450, { isConnected: false });
    const ended = v(false, 800, 450, { ended: true });
    const playing = v(false, 200, 100);
    expect(chooseVideo([gone, ended, playing])).toBe(playing);
    // With nothing playing, the largest video still on the page is the one.
    const paused = v(true, 200, 100);
    expect(chooseVideo([gone, ended, paused])).toBe(ended);
    expect(chooseVideo([gone, paused])).toBe(paused);
  });
});

describe("after the step 4 review: cleaning and the new messages", () => {
  it("removes DEL, the C1 controls and every bidirectional isolate", () => {
    const raw = `a${ctrl(0x7f)}b${ctrl(0x85)}c${ctrl(0x9f)}d${ctrl(0x2067)}e${ctrl(0x2068)}f${ctrl(0x2069)}g${ctrl(0x202a)}h${ctrl(0x2029)}i`;
    expect(cleanTitle(raw)).toBe("a b c d e f g h i");
    expect(cleanTitle(`x${ctrl(0xa0)}y`)).toBe("x y"); // a no-break space is whitespace, not a control
  });

  it("takes only lowercase level ids", () => {
    expect(cleanLevel("hd720")).toBe("hd720");
    for (const l of ["HD720", "hd 720", "", "a".repeat(17), 5]) expect(cleanLevel(l)).toBeNull();
  });

  it("cleans error messages like titles, on the bridge and on the worker side", () => {
    expect(cleanMessage(`bad${ctrl(0)}thing`)).toBe("bad thing");
    expect(cleanMessage(5)).toBe("");
    const long = "m".repeat(1000);
    const fromPage = readPageMessage({ source: FROM_PAGE, kind: "error", code: "unsupported", message: long, inReplyTo: "i1" });
    expect(fromPage).toMatchObject({ kind: "error" });
    expect((fromPage as { message: string }).message).toHaveLength(300);
    const toWorker = readBridgeToWorker({ kind: "page-error", code: "no-video", message: `${long}${ctrl(0)}`, inReplyTo: "i1" });
    expect((toWorker as { message: string }).message).toHaveLength(300);
    const nul = readBridgeToWorker({ kind: "page-error", code: "no-video", message: `a${ctrl(0)}b`, inReplyTo: "i1" });
    expect(nul).toEqual({ kind: "page-error", code: "no-video", message: "a b", inReplyTo: "i1" });
  });

  it("carries the played flag, true only when it is exactly true", () => {
    const state = { rate: 1, playing: false };
    expect(readPageMessage({ source: FROM_PAGE, kind: "state", state, inReplyTo: null, played: true })).toMatchObject({ played: true });
    expect(readPageMessage({ source: FROM_PAGE, kind: "state", state, inReplyTo: null, played: "yes" })).toMatchObject({ played: false });
    expect(readBridgeToWorker({ kind: "page-state", state, host: "a.example", inReplyTo: null, played: true })).toMatchObject({ played: true });
    expect(readBridgeToWorker({ kind: "page-state", state, host: "a.example", inReplyTo: null, played: 1 })).toMatchObject({ played: false });
  });

  it("passes refresh requests from the worker to the bridge and from the bridge to the page", () => {
    expect(readWorkerToBridge({ kind: "refresh" })).toEqual({ kind: "refresh" });
    expect(readBridgeMessage({ source: FROM_BRIDGE, kind: "refresh" })).toEqual({ source: FROM_BRIDGE, kind: "refresh" });
    expect(readBridgeMessage({ source: FROM_PAGE, kind: "refresh" })).toBeNull();
    expect(readWorkerToBridge({ kind: "refreshes" })).toBeNull();
  });

  it("posts to this same window with its origin, or with * on a file page whose origin is null", () => {
    expect(selfOrigin("https://www.youtube.com")).toBe("https://www.youtube.com");
    expect(selfOrigin("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    for (const o of ["null", "", "file://", "https://a.example/path"]) expect(selfOrigin(o)).toBe("*");
  });
});
