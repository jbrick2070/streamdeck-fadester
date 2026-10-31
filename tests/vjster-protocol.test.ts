// SPDX-License-Identifier: GPL-2.0-or-later
// VJster protocol (docs/vjster/REQUIREMENTS.md R-INT-1..4, R-LNK-1, R-LNK-5; PLAN.md 3.3).
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  DEFAULT_LINK_PORT,
  ERROR_CODES,
  INTENT_TYPES,
  LINK_HOST,
  MAX_MESSAGE_CHARS,
  PROTOCOL_VERSION,
  TARGETS,
  errorReply,
  parse,
  serialize,
  type Intent,
  type Message,
  type StateReport
} from "../src/vjster/shared/protocol.js";

const env = { v: 1, id: "m-1", target: "browser" } as const;
const text = (o: unknown): string => JSON.stringify(o);

function ok(t: string, accept: "intents" | "reports"): Message {
  const r = parse(t, accept);
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.reason}`);
  return r.message;
}

function failure(t: unknown, accept: "intents" | "reports") {
  const r = parse(t, accept);
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r.message)}`);
  return r;
}

const fullState: StateReport = {
  ...env,
  type: "state",
  inReplyTo: "m-0",
  rate: 1.25,
  rateDirect: false,
  availableRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4],
  quality: "hd1080",
  availableQualities: ["hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny", "auto"],
  qualityAuto: true,
  title: "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film",
  host: "www.youtube.com",
  playing: true,
  adPlaying: false,
  capabilities: ["speed", "quality", "transport"]
};

describe("VJster protocol constants", () => {
  it("pins protocol version 1 (R-INT-1)", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("defaults the link to loopback port 48150 (R-LNK-1)", () => {
    expect(LINK_HOST).toBe("127.0.0.1");
    expect(DEFAULT_LINK_PORT).toBe(48150);
    expect(DEFAULT_LINK_PORT).toBeGreaterThan(1023);
    expect(DEFAULT_LINK_PORT).toBeLessThan(49152);
  });

  it("knows exactly the two targets (R-INT-1)", () => {
    expect([...TARGETS].sort()).toEqual(["browser", "obs"]);
  });

  it("pins the limits, error codes and capabilities PLAN.md 3.3 lists", () => {
    expect(MAX_MESSAGE_CHARS).toBe(16384);
    expect([...ERROR_CODES]).toEqual([
      "too-long",
      "bad-json",
      "bad-version",
      "bad-message",
      "unknown-type",
      "unexpected-type",
      "no-video",
      "unsupported",
      "internal"
    ]);
    expect([...CAPABILITIES]).toEqual(["speed", "quality", "transport"]);
  });
});

describe("intents (R-INT-1)", () => {
  const samples: Intent[] = [
    { ...env, type: "speed.set", rate: 1.5, direct: false, hold: true },
    { ...env, type: "speed.step", delta: -0.25, direct: true, hold: false },
    { ...env, type: "speed.reset" },
    { ...env, type: "quality.set", level: "hd720", hold: true },
    { ...env, type: "quality.step", direction: -1, hold: false },
    { ...env, type: "quality.reset" },
    { ...env, type: "transport.toggle" },
    { ...env, type: "state.get" },
    { ...env, target: "obs", type: "pin.set", pinned: true }
  ];

  it("round-trips every intent type", () => {
    expect(samples.map((s) => s.type).sort()).toEqual([...INTENT_TYPES].sort());
    for (const s of samples) expect(ok(serialize(s), "intents")).toEqual(s);
  });

  it("defaults the optional direct and hold flags to false", () => {
    expect(ok(text({ ...env, type: "speed.set", rate: 2 }), "intents")).toEqual({ ...env, type: "speed.set", rate: 2, direct: false, hold: false });
    expect(ok(text({ ...env, type: "quality.step", direction: 1 }), "intents")).toEqual({ ...env, type: "quality.step", direction: 1, hold: false });
  });

  it("drops unknown fields (R-INT-3)", () => {
    const m = ok(text({ ...env, type: "speed.reset", extra: 1, nested: { a: 1 } }), "intents");
    expect(m).toEqual({ ...env, type: "speed.reset" });
    expect(Object.keys(m)).not.toContain("extra");
  });

  it("is not polluted by a __proto__ key", () => {
    const m = ok('{"v":1,"id":"m-1","target":"browser","type":"state.get","__proto__":{"polluted":true}}', "intents");
    expect((m as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses bad intent fields with bad-message and the id to reply to", () => {
    const bad: unknown[] = [
      { ...env, type: "speed.set", rate: 0 },
      { ...env, type: "speed.set", rate: -1 },
      { ...env, type: "speed.set", rate: 16.5 },
      { ...env, type: "speed.set", rate: "1" },
      { ...env, type: "speed.set" },
      { ...env, type: "speed.set", rate: 1, hold: "yes" },
      { ...env, type: "speed.step", delta: 0.3 },
      { ...env, type: "speed.step", delta: 0 },
      { ...env, type: "quality.set", level: "HD1080" },
      { ...env, type: "quality.set", level: "" },
      { ...env, type: "quality.step", direction: 2 },
      { ...env, type: "quality.step", direction: "1" },
      { ...env, type: "pin.set" }
    ];
    for (const b of bad) {
      const r = failure(text(b), "intents");
      expect(r.code).toBe("bad-message");
      expect(r.inReplyTo).toBe("m-1");
    }
  });

  it("accepts quality.set auto, which a target treats as quality.reset", () => {
    expect(ok(text({ ...env, type: "quality.set", level: "auto" }), "intents")).toEqual({ ...env, type: "quality.set", level: "auto", hold: false });
  });

  it("accepts a rate up to the extended maximum of 16 and nothing above it", () => {
    expect(parse(text({ ...env, type: "speed.set", rate: 16 }), "intents").ok).toBe(true);
    expect(failure(text({ ...env, type: "speed.set", rate: 16.05 }), "intents").code).toBe("bad-message");
  });

  it("accepts every allowed step size in either direction", () => {
    for (const delta of [0.05, -0.05, 0.1, -0.1, 0.25, -0.25, 0.5, -0.5]) {
      expect(parse(text({ ...env, type: "speed.step", delta }), "intents").ok).toBe(true);
    }
  });
});

describe("state reports (R-INT-2, R-LNK-5)", () => {
  it("round-trips a full report", () => {
    expect(ok(serialize(fullState), "reports")).toEqual(fullState);
  });

  it("carries the flags in their other state too", () => {
    const other = { ...fullState, adPlaying: true, rateDirect: true, qualityAuto: false, playing: false };
    expect(ok(serialize(other), "reports")).toEqual(other);
  });

  it("accepts fields exactly at their limits", () => {
    const atLimits = {
      ...fullState,
      id: "A_b-" + "9".repeat(60),
      title: "t".repeat(300),
      host: ("a".repeat(63) + ".").repeat(3) + "b".repeat(61),
      availableRates: new Array(64).fill(1),
      quality: "x".repeat(16)
    };
    expect(atLimits.id).toHaveLength(64);
    expect(atLimits.host).toHaveLength(253);
    expect(ok(text(atLimits), "reports")).toEqual(atLimits);
    expect(ok(text({ ...fullState, host: "my-site.example.com" }), "reports")).toMatchObject({ host: "my-site.example.com" });
  });

  it("refuses a report that leaves out a required field", () => {
    for (const key of ["rate", "availableRates", "quality", "availableQualities", "qualityAuto", "title", "host", "playing", "adPlaying", "capabilities"]) {
      const partial: Record<string, unknown> = { ...fullState };
      delete partial[key];
      expect(failure(text(partial), "reports").code, key).toBe("bad-message");
    }
  });

  it("carries a report with no video", () => {
    const none = {
      ...env,
      type: "state",
      inReplyTo: null,
      rate: null,
      rateDirect: false,
      availableRates: [],
      quality: null,
      availableQualities: [],
      qualityAuto: null,
      title: null,
      host: null,
      playing: false,
      adPlaying: false,
      capabilities: []
    };
    expect(ok(text(none), "reports")).toEqual(none);
  });

  it("accepts the player's unknown quality and defaults rateDirect", () => {
    const { rateDirect: _drop, ...rest } = fullState;
    void _drop;
    const m = ok(text({ ...rest, quality: "unknown" }), "reports") as StateReport;
    expect(m.quality).toBe("unknown");
    expect(m.rateDirect).toBe(false);
  });

  it("ignores unknown capabilities and repeats", () => {
    const m = ok(text({ ...fullState, capabilities: ["speed", "teleport", "speed"] }), "reports") as StateReport;
    expect(m.capabilities).toEqual(["speed"]);
  });

  it("refuses a host that is more than a host name, so no URL can travel (R-LNK-5)", () => {
    for (const host of ["www.youtube.com/watch?v=x", "https://www.youtube.com", "a b", ""]) {
      expect(failure(text({ ...fullState, host }), "reports").code).toBe("bad-message");
    }
  });

  it("refuses oversized and malformed fields", () => {
    const bad: Record<string, unknown>[] = [
      { title: "x".repeat(301) },
      { host: "h".repeat(254) },
      { quality: "x".repeat(17) },
      { quality: "hd_720" },
      { availableRates: new Array(65).fill(1) },
      { availableRates: [1, 0] },
      { availableQualities: ["hd720", 5] },
      { qualityAuto: "yes" },
      { playing: 1 },
      { rate: 17 },
      { inReplyTo: "not an id!" },
      { capabilities: "speed" }
    ];
    for (const patch of bad) expect(failure(text({ ...fullState, ...patch }), "reports").code).toBe("bad-message");
  });
});

describe("error reports and keepalives", () => {
  it("round-trips an error reply and truncates a long message", () => {
    const e = errorReply("no-video", "x".repeat(400), "m-7", { id: "m-8", target: "browser" });
    expect(e.message).toHaveLength(300);
    expect(ok(serialize(e), "reports")).toEqual(e);
  });

  it("limits an error message to 300 characters", () => {
    const base = { ...env, type: "error", code: "internal", inReplyTo: null };
    expect(parse(text({ ...base, message: "m".repeat(300) }), "reports").ok).toBe(true);
    expect(failure(text({ ...base, message: "m".repeat(301) }), "reports").code).toBe("bad-message");
  });

  it("refuses an unknown error code", () => {
    expect(failure(text({ ...env, type: "error", code: "oops", message: "", inReplyTo: null }), "reports").code).toBe("bad-message");
  });

  it("accepts ping and pong on both sides", () => {
    for (const accept of ["intents", "reports"] as const) {
      for (const type of ["ping", "pong"]) expect(ok(text({ ...env, type, t: 12345 }), accept)).toEqual({ ...env, type, t: 12345 });
    }
    expect(failure(text({ ...env, type: "ping", t: "now" }), "intents").code).toBe("bad-message");
  });
});

describe("parse failures (R-INT-3)", () => {
  it("names the reason for every kind of bad input", () => {
    expect(failure(42, "intents").code).toBe("bad-message");
    expect(failure("x".repeat(MAX_MESSAGE_CHARS + 1), "intents").code).toBe("too-long");
    const exact = text({ ...env, type: "state.get" });
    expect(parse(exact + " ".repeat(MAX_MESSAGE_CHARS - exact.length), "intents").ok).toBe(true);
    expect(failure(exact + " ".repeat(MAX_MESSAGE_CHARS - exact.length + 1), "intents").code).toBe("too-long");
    expect(failure("{not json", "intents").code).toBe("bad-json");
    expect(failure("[1,2]", "intents").code).toBe("bad-message");
    expect(failure("null", "intents").code).toBe("bad-message");
    expect(failure(text({ ...env, v: 2, type: "state.get" }), "intents")).toMatchObject({ code: "bad-version", inReplyTo: "m-1" });
    expect(failure(text({ ...env, v: undefined, type: "state.get" }), "intents").code).toBe("bad-version");
    for (const v of ["1", true, [1], 1.0000001]) expect(failure(text({ ...env, v, type: "state.get" }), "intents").code).toBe("bad-version");
    expect(failure(text({ ...env, type: "speed.warp" }), "intents")).toMatchObject({ code: "unknown-type", inReplyTo: "m-1" });
    expect(failure(text({ ...env, type: 7 }), "intents").code).toBe("bad-message");
    expect(failure(text({ ...env, id: "", type: "state.get" }), "intents")).toMatchObject({ code: "bad-message", inReplyTo: null });
    expect(failure(text({ ...env, id: "a".repeat(65), type: "state.get" }), "intents").code).toBe("bad-message");
    expect(failure(text({ ...env, target: "tv", type: "state.get" }), "intents").code).toBe("bad-message");
    expect(failure(text({ v: 1, id: "m-1", type: "state.get" }), "intents").code).toBe("bad-message");
  });

  it("refuses a message meant for the other side", () => {
    expect(failure(serialize(fullState), "intents").code).toBe("unexpected-type");
    expect(failure(text({ ...env, type: "speed.reset" }), "reports").code).toBe("unexpected-type");
  });

  it("never throws, whatever it is given", () => {
    const inputs: unknown[] = [
      undefined,
      null,
      {},
      "",
      "{}",
      '{"v":1}',
      '{"v":1,"type":"state","id":"a","target":"browser"}',
      '{"v":1,"type":"speed.set","id":"a","target":"browser","rate":{"valueOf":1}}',
      '"just a string"',
      "1e999",
      '{"v":1,"type":"error","id":"a","target":"obs","code":"internal","message":null}'
    ];
    for (const input of inputs) {
      for (const accept of ["intents", "reports"] as const) expect(() => parse(input, accept)).not.toThrow();
    }
  });
});
