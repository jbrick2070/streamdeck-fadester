// SPDX-License-Identifier: GPL-2.0-or-later
// VJster link server (docs/vjster/REQUIREMENTS.md R-LNK-1..5, R-TST-2; PLAN.md Phase 1 step 3).
// Keepalive and throttles run on a fake clock (no timing races); sockets are real.
import { request } from "node:http";
import { connect as tcpConnect, createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_PING_INTERVAL_MS,
  LinkLifecycle,
  LinkPortInUseError,
  LinkServer,
  MAX_PAYLOAD_BYTES,
  REASK_MIN_MS,
  REFUSAL_LOG_MS,
  classifyUpgrade,
  newObsToken,
  type LinkClock,
  type LinkEvent,
  type LinkServerOptions
} from "../src/vjster/plugin/link-server.js";
import { DEFAULT_LINK_PORT } from "../src/vjster/shared/protocol.js";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const OTHER_ID = "ponmlkjihgfedcbaponmlkjihgfedcba";
const EXT_ORIGIN = `chrome-extension://${EXT_ID}`;
const TOKEN = "0123456789abcdef0123456789abcdef";

/** A clock that moves only when told; its interval never fires (tests call server.tick()). */
function fakeClock() {
  let now = 1_000_000;
  const intervals: number[] = [];
  const clock: LinkClock & { advance(ms: number): void; intervals: number[] } = {
    now: () => now,
    setInterval: (_fn, ms) => {
      intervals.push(ms);
      return intervals.length;
    },
    clearInterval: () => undefined,
    advance: (ms) => {
      now += ms;
    },
    intervals
  };
  return clock;
}

const servers: LinkServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const s of servers.splice(0)) await s.stop();
});

async function startServer(options: LinkServerOptions = {}) {
  const warnings: string[] = [];
  const infos: string[] = [];
  const clock = fakeClock();
  const server = new LinkServer({ port: 0, clock, log: { info: (m) => infos.push(m), warn: (m) => warnings.push(m) }, ...options });
  servers.push(server);
  await server.start();
  const events: LinkEvent[] = [];
  server.on((e) => events.push(e));
  return { server, port: server.boundPort as number, events, warnings, infos, clock };
}

/** Messages each socket received, buffered from creation: the first `state.get` can come with the handshake. */
const inbox = new WeakMap<WebSocket, { queue: Record<string, unknown>[]; waiters: ((m: Record<string, unknown>) => void)[] }>();

function connect(port: number, opts: { origin?: string; path?: string; host?: string } = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.host) headers.host = opts.host;
    const ws = new WebSocket(`ws://127.0.0.1:${port}${opts.path ?? "/"}`, { origin: opts.origin, headers });
    sockets.push(ws);
    const box = { queue: [] as Record<string, unknown>[], waiters: [] as ((m: Record<string, unknown>) => void)[] };
    inbox.set(ws, box);
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      const waiter = box.waiters.shift();
      if (waiter) waiter(message);
      else box.queue.push(message);
    });
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", (e) => reject(e));
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<Record<string, unknown>> {
  const box = inbox.get(ws);
  if (!box) throw new Error("socket was not made by connect()");
  const queued = box.queue.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no message")), timeoutMs);
    box.waiters.push((m) => {
      clearTimeout(timer);
      resolve(m);
    });
  });
}

/** Everything a socket received so far, without waiting. */
const received = (ws: WebSocket): Record<string, unknown>[] => inbox.get(ws)?.queue ?? [];

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once("close", (code) => resolve(code)));
}

const until = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await new Promise((r) => setTimeout(r, 5));
  }
};

const state = (target: "browser" | "obs", extra: Record<string, unknown> = {}) => ({
  v: 1,
  id: "s-1",
  target,
  type: "state",
  inReplyTo: null,
  rate: 1.5,
  rateDirect: false,
  availableRates: [0.25, 1, 4],
  quality: "hd720",
  availableQualities: ["hd1080", "hd720"],
  qualityAuto: false,
  title: "A video",
  host: "www.youtube.com",
  playing: true,
  adPlaying: false,
  capabilities: ["speed", "quality", "transport"],
  ...extra
});

/** Send a raw HTTP upgrade request and read the status line. */
function rawUpgrade(port: number, lines: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = tcpConnect(port, "127.0.0.1", () => s.write([...lines, "", ""].join("\r\n")));
    let data = "";
    s.on("data", (d) => {
      data += d.toString();
      if (data.includes("\r\n")) {
        resolve(data.split("\r\n")[0]);
        s.destroy();
      }
    });
    s.on("error", reject);
  });
}

describe("classifyUpgrade (R-LNK-2)", () => {
  const ok = (headers: { host?: string; origin?: string }, url = "/", allowed: string[] = [], token: string | null = null) =>
    classifyUpgrade(headers, url, 48150, allowed, token);

  it("accepts a Chrome extension origin on the server's own host as the browser target", () => {
    expect(ok({ host: "127.0.0.1:48150", origin: EXT_ORIGIN })).toEqual({ ok: true, target: "browser" });
    expect(ok({ host: "localhost:48150", origin: EXT_ORIGIN })).toEqual({ ok: true, target: "browser" });
  });

  it("refuses any other Host, which defeats DNS rebinding", () => {
    for (const host of [undefined, "", "evil.example:48150", "127.0.0.1:48151", "127.0.0.1", "0.0.0.0:48150", "127.0.0.1:48150.evil.example", "127.0.0.1.evil.example:48150", "[::1]:48150", "LOCALHOST:48150"]) {
      expect(ok({ host, origin: EXT_ORIGIN })).toEqual({ ok: false, reason: "host" });
    }
  });

  it("refuses web pages, file pages, a missing origin and anything but 32 letters a to p", () => {
    for (const origin of [
      undefined,
      "",
      "null",
      "https://www.youtube.com",
      "http://127.0.0.1:48150",
      "chrome-extension://short",
      `chrome-extension://${EXT_ID}/`,
      `chrome-extension://${EXT_ID.toUpperCase()}`,
      `xchrome-extension://${EXT_ID}`,
      `chrome-extension://${EXT_ID}a`,
      `chrome-extension://${"q".repeat(32)}`,
      `chrome-extension://${"z".repeat(32)}`,
      `moz-extension://${EXT_ID}`
    ]) {
      expect(ok({ host: "127.0.0.1:48150", origin }).ok).toBe(false);
    }
  });

  it("allows only the pinned extension ids when there are any", () => {
    expect(ok({ host: "127.0.0.1:48150", origin: EXT_ORIGIN }, "/", [EXT_ID]).ok).toBe(true);
    expect(ok({ host: "127.0.0.1:48150", origin: EXT_ORIGIN }, "/", [OTHER_ID])).toEqual({ ok: false, reason: "extension-id" });
  });

  it("lets a token parameter decide alone: the right token is the OBS page, a wrong one is refused even with an extension origin", () => {
    expect(ok({ host: "127.0.0.1:48150", origin: "null" }, `/?token=${TOKEN}`, [], TOKEN)).toEqual({ ok: true, target: "obs" });
    expect(ok({ host: "127.0.0.1:48150" }, `/?token=${TOKEN}`, [], TOKEN)).toEqual({ ok: true, target: "obs" });
    for (const url of [`/?token=${TOKEN.replace("0", "1")}`, "/?token=", `/?token=${TOKEN}0`, "/?token=ZZ"]) {
      expect(ok({ host: "127.0.0.1:48150", origin: EXT_ORIGIN }, url, [], TOKEN)).toEqual({ ok: false, reason: "token" });
    }
    expect(ok({ host: "127.0.0.1:48150" }, `/?token=${TOKEN}`, [], null)).toEqual({ ok: false, reason: "token" });
  });

  it("makes 128-bit tokens of 32 hex digits", () => {
    const a = newObsToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newObsToken()).not.toBe(a);
  });
});

describe("LinkServer: binding and the gate (R-LNK-1, R-LNK-2)", () => {
  it("pins its defaults: port 48150, ping every 20 s, idle 60 s, 3 bytes per character", async () => {
    expect(DEFAULT_LINK_PORT).toBe(48150);
    expect(new LinkServer().configuredPort).toBe(48150);
    expect(DEFAULT_PING_INTERVAL_MS).toBe(20000);
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(60000);
    expect(MAX_PAYLOAD_BYTES).toBe(49152);
    expect(REASK_MIN_MS).toBe(2000);
    expect(REFUSAL_LOG_MS).toBe(10000);
    const { clock } = await startServer({ pingIntervalMs: undefined });
    expect(clock.intervals).toEqual([20000]);
  });

  it("binds 127.0.0.1 only", async () => {
    const { server } = await startServer();
    expect((server as unknown as { http: { address(): { address: string } } }).http.address().address).toBe("127.0.0.1");
  });

  it("answers plain HTTP with 426 and nothing else", async () => {
    const { port } = await startServer();
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/" }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(426);
  });

  it("refuses a web page origin and a missing origin with HTTP 403", async () => {
    const { port } = await startServer();
    await expect(connect(port, { origin: "https://www.youtube.com" })).rejects.toThrow("HTTP 403");
    await expect(connect(port, {})).rejects.toThrow("HTTP 403");
  });

  it("refuses a foreign Host header, and two Host headers", async () => {
    const { port } = await startServer();
    await expect(connect(port, { origin: EXT_ORIGIN, host: `evil.example:${port}` })).rejects.toThrow("HTTP 403");
    const upgrade = (hosts: string[]) => [
      "GET / HTTP/1.1",
      ...hosts.map((h) => `Host: ${h}`),
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version: 13",
      `Origin: ${EXT_ORIGIN}`
    ];
    expect(await rawUpgrade(port, upgrade([`127.0.0.1:${port}`]))).toBe("HTTP/1.1 101 Switching Protocols");
    expect(await rawUpgrade(port, upgrade([`127.0.0.1:${port}`, "evil.example"]))).toBe("HTTP/1.1 403 Forbidden");
  });

  it("logs refusals with their reason only, at most once per 10 s with a count", async () => {
    const { port, warnings, clock } = await startServer();
    for (let k = 0; k < 3; k++) await expect(connect(port, { origin: "https://evil.example/?secret=1" })).rejects.toThrow("HTTP 403");
    expect(warnings).toEqual(["refused a connection (origin)"]);
    clock.advance(10_000);
    await expect(connect(port, {})).rejects.toThrow("HTTP 403");
    expect(warnings).toEqual(["refused a connection (origin)", "refused a connection (origin) (and 2 more since the last note)"]);
    expect(warnings.join(" ")).not.toContain("secret");
  });

  it("honours pinned extension ids through the server, case-insensitively, and fails closed on malformed ones", async () => {
    const pinnedOther = await startServer({ allowedExtensionIds: [OTHER_ID] });
    await expect(connect(pinnedOther.port, { origin: EXT_ORIGIN })).rejects.toThrow("HTTP 403");
    const pinnedUpper = await startServer({ allowedExtensionIds: [EXT_ID.toUpperCase()] });
    await connect(pinnedUpper.port, { origin: EXT_ORIGIN });
    const malformed = await startServer({ allowedExtensionIds: ["not-an-id"] });
    expect(malformed.warnings).toContain("ignored 1 malformed pinned extension id(s)");
    await expect(connect(malformed.port, { origin: EXT_ORIGIN })).rejects.toThrow("HTTP 403");
  });

  it("warns about a malformed OBS token and refuses every token connection", async () => {
    const { port, warnings } = await startServer({ obsToken: "NOT-A-TOKEN" });
    expect(warnings).toContain("ignored a malformed OBS page token; OBS pages cannot connect");
    await expect(connect(port, { path: "/?token=NOT-A-TOKEN" })).rejects.toThrow("HTTP 403");
  });
});

describe("LinkServer: connections and messages (R-LNK-3..5, PLAN.md 3.3)", () => {
  it("accepts the extension, reports it connected and asks for its state at once", async () => {
    const { port, events, server } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    const first = await nextMessage(ws);
    expect(first).toMatchObject({ v: 1, target: "browser", type: "state.get" });
    expect(String(first.id)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(events).toContainEqual({ type: "connected", target: "browser" });
    expect(server.isConnected("browser")).toBe(true);
    expect(server.isConnected("obs")).toBe(false);
  });

  it("accepts the OBS page by token as a separate target, without touching the browser connection", async () => {
    const { port, server, events } = await startServer({ obsToken: TOKEN });
    const ext = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ext);
    const page = await connect(port, { path: `/?token=${TOKEN}` });
    expect(await nextMessage(page)).toMatchObject({ target: "obs", type: "state.get" });
    expect(server.isConnected("obs")).toBe(true);
    expect(server.isConnected("browser")).toBe(true);
    expect(ext.readyState).toBe(WebSocket.OPEN);
    page.send(JSON.stringify(state("obs", { rate: 0.5 })));
    page.send(JSON.stringify({ v: 1, id: "p-1", target: "obs", type: "ping", t: 9 }));
    expect(await nextMessage(page)).toMatchObject({ type: "pong", t: 9, target: "obs" });
    await until(() => events.some((e) => e.type === "state" && e.target === "obs"));
    expect(events.find((e) => e.type === "state")).toMatchObject({ target: "obs", state: { rate: 0.5 } });
  });

  it("forwards valid state and error reports as events", async () => {
    const { port, events } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    ws.send(JSON.stringify(state("browser")));
    ws.send(JSON.stringify({ v: 1, id: "e-1", target: "browser", type: "error", code: "no-video", message: "no video", inReplyTo: "x" }));
    await until(() => events.filter((e) => e.type === "state" || e.type === "error").length === 2);
    expect(events.find((e) => e.type === "state")).toMatchObject({ type: "state", target: "browser", state: { rate: 1.5, title: "A video" } });
    expect(events.find((e) => e.type === "error")).toMatchObject({ type: "error", target: "browser", error: { code: "no-video" } });
  });

  it("drops bad messages, warns once without content, and re-asks at most once per 2 s", async () => {
    const { port, events, warnings, clock } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    for (const bad of ["{not json", JSON.stringify(state("browser", { host: "www.youtube.com/watch?v=secret" })), "x".repeat(20000)]) ws.send(bad);
    await settle();
    expect(received(ws).filter((m) => m.type === "state.get")).toHaveLength(1);
    clock.advance(2000);
    ws.send("{again");
    await settle();
    expect(received(ws).filter((m) => m.type === "state.get")).toHaveLength(2);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(events.some((e) => e.type === "state")).toBe(false);
    expect(warnings).toEqual(["dropped a message from browser: bad-json"]);
    expect(warnings.join(" ")).not.toContain("secret");
  });

  it("drops a report whose target does not match the connection", async () => {
    const { port, events, warnings } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    ws.send(JSON.stringify(state("obs")));
    expect(await nextMessage(ws)).toMatchObject({ type: "state.get" });
    expect(events.some((e) => e.type === "state")).toBe(false);
    expect(warnings).toEqual(["dropped a message from browser: wrong target"]);
  });

  it("drops a binary frame even when it holds a valid report", async () => {
    const { port, events, warnings } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    ws.send(Buffer.from(JSON.stringify(state("browser"))), { binary: true });
    expect(await nextMessage(ws)).toMatchObject({ type: "state.get" });
    expect(events.some((e) => e.type === "state")).toBe(false);
    expect(warnings).toEqual(["dropped a message from browser: binary frame"]);
  });

  it("answers a ping with a pong carrying the same t", async () => {
    const { port } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    ws.send(JSON.stringify({ v: 1, id: "p-1", target: "browser", type: "ping", t: 42 }));
    expect(await nextMessage(ws)).toMatchObject({ type: "pong", t: 42, target: "browser" });
  });

  it("accepts a frame of exactly 49152 bytes and closes one byte larger with 1009", async () => {
    const { port, server } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    ws.send("x".repeat(MAX_PAYLOAD_BYTES));
    expect(await nextMessage(ws)).toMatchObject({ type: "state.get" });
    expect(server.isConnected("browser")).toBe(true);
    const code = closed(ws);
    ws.send("x".repeat(MAX_PAYLOAD_BYTES + 1));
    expect(await code).toBe(1009);
  });

  it("sends intents with a fresh id and the connection's target, and null when the target is absent", async () => {
    const { port, server } = await startServer();
    expect(server.send("browser", { type: "speed.reset" })).toBeNull();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    const id = server.send("browser", { type: "speed.set", rate: 1.25, direct: false, hold: true });
    expect(id).not.toBeNull();
    expect(await nextMessage(ws)).toEqual({ type: "speed.set", rate: 1.25, direct: false, hold: true, v: 1, id, target: "browser" });
    expect(server.send("browser", { type: "quality.reset" })).not.toBe(id);
    expect(server.send("obs", { type: "quality.reset" })).toBeNull();
  });

  it("lets the newest extension connection win, closing the older one with 4000 and not reporting it gone (R-LNK-4)", async () => {
    const { port, server, events } = await startServer();
    const first = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(first);
    const firstClosed = closed(first);
    const second = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(second);
    expect(await firstClosed).toBe(4000);
    expect(server.isConnected("browser")).toBe(true);
    server.send("browser", { type: "speed.reset" });
    expect(await nextMessage(second)).toMatchObject({ type: "speed.reset" });
    expect(events.filter((e) => e.type === "disconnected")).toHaveLength(0);
  });

  it("reports a disconnect exactly once when the extension goes away", async () => {
    const { port, events, server } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    ws.close();
    await until(() => events.some((e) => e.type === "disconnected"));
    await settle();
    expect(events.filter((e) => e.type === "disconnected")).toHaveLength(1);
    expect(server.isConnected("browser")).toBe(false);
  });

  it("survives a listener that throws, and logs a fixed line without the exception's text", async () => {
    const { port, server, warnings } = await startServer();
    server.on(() => {
      throw new Error("cannot draw <secret title>");
    });
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    expect(server.isConnected("browser")).toBe(true);
    expect(warnings).toContain("a link listener threw");
    expect(warnings.join(" ")).not.toContain("secret");
  });

  it("logs an HTTP server error after listening instead of throwing", async () => {
    const { server, warnings } = await startServer();
    const http = (server as unknown as { http: { emit(e: string, err: Error): boolean } }).http;
    expect(() => http.emit("error", Object.assign(new Error("accept failed"), { code: "EMFILE" }))).not.toThrow();
    expect(warnings).toContain("link server error (EMFILE)");
  });
});

describe("LinkServer: keepalive on a fake clock (R-LNK-3)", () => {
  it("pings on each tick and closes a peer silent past the idle timeout with 4001, reported once", async () => {
    const { port, events, server, clock } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    const code = closed(ws);
    server.tick();
    expect(await nextMessage(ws)).toMatchObject({ type: "ping", target: "browser", v: 1 });
    clock.advance(60_000);
    server.tick();
    expect(server.isConnected("browser")).toBe(true);
    clock.advance(1);
    server.tick();
    expect(await code).toBe(4001);
    server.tick();
    await settle();
    expect(events.filter((e) => e.type === "disconnected")).toHaveLength(1);
  });

  it("keeps a peer that answers its pings", async () => {
    const { port, server, clock } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    clock.advance(50_000);
    server.tick();
    const ping = await nextMessage(ws);
    ws.send(JSON.stringify({ v: 1, id: "q", target: "browser", type: "pong", t: ping.t }));
    await settle();
    clock.advance(50_000);
    server.tick();
    expect(server.isConnected("browser")).toBe(true);
  });

  it("ignores a report from a peer it already closed for silence", async () => {
    const { port, server, events, clock } = await startServer();
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    clock.advance(60_001);
    server.tick();
    // The client has not read the close frame yet; this report arrives after the peer is gone.
    ws.send(JSON.stringify(state("browser", { rate: 3.5 })));
    await settle(150);
    expect(events.some((e) => e.type === "state")).toBe(false);
  });
});

describe("LinkServer: start and stop", () => {
  it("rejects with LinkPortInUseError when the port is taken (D-11)", async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
    const port = (blocker.address() as { port: number }).port;
    const server = new LinkServer({ port });
    const error = await server.start().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LinkPortInUseError);
    expect((error as LinkPortInUseError).code).toBe("EADDRINUSE");
    expect(server.running).toBe(false);
    await new Promise<void>((r) => blocker.close(() => r()));
  });

  it("stop reports every live connection gone, closes them with 1001, and the same server starts again", async () => {
    const { server, port, events } = await startServer({ obsToken: TOKEN });
    const ws = await connect(port, { origin: EXT_ORIGIN });
    await nextMessage(ws);
    const page = await connect(port, { path: `/?token=${TOKEN}` });
    await nextMessage(page);
    const code = closed(ws);
    await server.stop();
    expect(await code).toBe(1001);
    expect(events.filter((e) => e.type === "disconnected").map((e) => e.target).sort()).toEqual(["browser", "obs"]);
    expect(server.running).toBe(false);
    await server.start();
    expect(server.running).toBe(true);
    const again = await connect(server.boundPort as number, { origin: EXT_ORIGIN });
    expect(await nextMessage(again)).toMatchObject({ type: "state.get" });
  });

  it("stops promptly with a half-open handshake pending", async () => {
    const { server, port } = await startServer();
    const raw = tcpConnect(port, "127.0.0.1", () => raw.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n"));
    await settle(50);
    const t0 = Date.now();
    await server.stop();
    expect(Date.now() - t0).toBeLessThan(1000);
    raw.destroy();
  });

  it("shares one start between overlapping calls, and a stop during a start leaves it stopped", async () => {
    const server = new LinkServer({ port: 0 });
    servers.push(server);
    const a = server.start();
    const b = server.start();
    expect(a).toBe(b);
    const s = server.stop();
    await a;
    await s;
    expect(server.running).toBe(false);
  });
});

describe("LinkLifecycle (R-LNK-1)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeServer(failTimes = 0) {
    let running = false;
    let failures = failTimes;
    const calls: string[] = [];
    return {
      calls,
      get running() {
        return running;
      },
      async start() {
        calls.push("start");
        if (failures > 0) {
          failures--;
          throw new LinkPortInUseError(48150, "EADDRINUSE");
        }
        running = true;
      },
      async stop() {
        calls.push("stop");
        running = false;
      }
    };
  }

  it("starts on the first acquire and stops 60 s after the last release", async () => {
    vi.useFakeTimers();
    const server = fakeServer();
    const life = new LinkLifecycle(server);
    await life.acquire();
    await life.acquire();
    expect(server.calls).toEqual(["start"]);
    life.release();
    life.release();
    expect(life.userCount).toBe(0);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(server.calls).toEqual(["start"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.calls).toEqual(["start", "stop"]);
  });

  it("keeps running when an action comes back within the delay, as on a page switch", async () => {
    vi.useFakeTimers();
    const server = fakeServer();
    const life = new LinkLifecycle(server);
    await life.acquire();
    life.release();
    await vi.advanceTimersByTimeAsync(30_000);
    await life.acquire();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(server.calls).toEqual(["start"]);
    expect(server.running).toBe(true);
  });

  it("starts once when several actions appear together", async () => {
    const server = fakeServer();
    const life = new LinkLifecycle(server);
    await Promise.all([life.acquire(), life.acquire(), life.acquire()]);
    expect(server.calls).toEqual(["start"]);
    expect(life.userCount).toBe(3);
  });

  it("records a failed start, retries on the next acquire, and clears the error once a start works", async () => {
    const server = fakeServer(1);
    const life = new LinkLifecycle(server);
    await life.acquire();
    expect(life.error).toBeInstanceOf(LinkPortInUseError);
    await life.acquire();
    expect(server.calls).toEqual(["start", "start"]);
    expect(life.error).toBeNull();
  });

  it("ignores a release without an acquire", () => {
    const server = fakeServer();
    const life = new LinkLifecycle(server);
    life.release();
    expect(life.userCount).toBe(0);
  });
});
