// SPDX-License-Identifier: GPL-2.0-or-later
// VJster end to end without a browser: the extension's link client and router
// against the plugin's real link server, with a fake tab running the real
// adapter (docs/vjster/REQUIREMENTS.md R-LNK-1..4, R-INT-1..4; PLAN.md 3.2).
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { LinkServer, type LinkEvent } from "../src/vjster/plugin/link-server.js";
import type { Intent } from "../src/vjster/shared/protocol.js";
import { Adapter, type MediaControl } from "../vjster-extension/src/adapter-core.js";
import { CLOSE_REPLACED, LinkClient, MAX_BACKOFF_MS, MIN_BACKOFF_MS, type SocketLike } from "../vjster-extension/src/link-client.js";
import { Router } from "../vjster-extension/src/router.js";

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const servers: LinkServer[] = [];
const clients: LinkClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.stop();
  for (const s of servers.splice(0)) await s.stop();
});

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** A YouTube-like fake player. */
function player() {
  const s = { rate: 1, preferred: "auto", playing: true };
  const control: MediaControl = {
    kind: "youtube",
    canQuality: true,
    elementRate: () => s.rate,
    availableRates: () => [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4],
    quality: () => "hd720",
    preferredQuality: () => s.preferred,
    availableQualities: () => ["hd1080", "hd720", "auto"],
    title: () => "Big Buck Bunny",
    playing: () => s.playing,
    adShowing: () => false,
    setRate: (r) => {
      s.rate = r;
    },
    setElementRate: (r) => {
      s.rate = r;
    },
    setQuality: (l) => {
      s.preferred = l;
    },
    setQualityAuto: () => {
      s.preferred = "auto";
    },
    play: () => {
      s.playing = true;
    },
    pause: () => {
      s.playing = false;
    }
  };
  return { s, control };
}

async function rig() {
  const server = new LinkServer({ port: 0 });
  servers.push(server);
  await server.start();
  const port = server.boundPort as number;
  const events: LinkEvent[] = [];
  server.on((e) => events.push(e));

  let id = 0;
  const newId = () => `x-${++id}`;
  const { s, control } = player();
  const TAB = 42;
  // eslint-disable-next-line prefer-const
  let router: Router;
  const adapter = new Adapter(
    () => control,
    (report) => {
      if (report.kind === "state") router.pageState(TAB, 1, report.state, "www.youtube.com", report.inReplyTo, report.played);
      else router.pageError(TAB, report.code, report.message, report.inReplyTo);
    }
  );
  const client = new LinkClient({
    url: () => `ws://127.0.0.1:${port}/`,
    open: (url) => new WebSocket(url, { origin: EXT_ORIGIN }) as unknown as SocketLike,
    onIntent: (intent) => void router.intent(intent),
    onOpen: () => router.linkOpened(),
    newId
  });
  router = new Router({
    sendToTab: async (_tabId, intent: Intent) => {
      adapter.handle(intent);
      return true;
    },
    // The one fake tab answers a refresh like a real bridge and adapter would.
    refreshTabs: () => adapter.refresh(),
    sendToLink: (m) => {
      client.send(m);
    },
    savePin: () => undefined,
    now: () => Date.now(),
    newId
  });
  clients.push(client);
  return { server, port, events, s, adapter, client, router, TAB };
}

describe("extension and plugin over the real link", () => {
  it("connects, reports the current video, and carries an intent to the page and its answer back", async () => {
    const { server, events, s, client } = await rig();
    client.start();
    await until(() => server.isConnected("browser"));
    // No media event: a page that just keeps playing is found by the refresh on link open.
    await until(() => events.some((e) => e.type === "state" && e.state.rate === 1));

    const id = server.send("browser", { type: "speed.set", rate: 1.5, direct: false, hold: false });
    await until(() => events.some((e) => e.type === "state" && e.state.inReplyTo === id));
    expect(s.rate).toBe(1.5);
    const answer = events.find((e) => e.type === "state" && e.state.inReplyTo === id);
    expect(answer).toMatchObject({ target: "browser", state: { rate: 1.5, host: "www.youtube.com", title: "Big Buck Bunny", qualityAuto: true } });

    const q = server.send("browser", { type: "quality.step", direction: 1, hold: true });
    await until(() => events.some((e) => e.type === "state" && e.state.inReplyTo === q));
    expect(s.preferred).toBe("hd1080");
  });

  it("answers state.get on connect with the no-video state when no tab has played", async () => {
    const { server, events, client, s } = await rig();
    s.playing = false;
    client.start();
    await until(() => events.some((e) => e.type === "state"));
    expect(events.find((e) => e.type === "state")).toMatchObject({ state: { rate: null, host: null } });
    expect(server.isConnected("browser")).toBe(true);
  });

  it("finds a paused video that played before the worker restarted", async () => {
    const { server, events, client, s, adapter } = await rig();
    adapter.snapshot(); // the page saw its video play
    s.playing = false;
    client.start();
    await until(() => events.some((e) => e.type === "state" && e.state.rate === 1 && e.state.playing === false));
    expect(server.isConnected("browser")).toBe(true);
  });

  it("gets an error back for an intent when no tab has a video", async () => {
    const { server, events, client, s } = await rig();
    s.playing = false;
    client.start();
    await until(() => server.isConnected("browser"));
    const id = server.send("browser", { type: "transport.toggle" });
    await until(() => events.some((e) => e.type === "error"));
    expect(events.find((e) => e.type === "error")).toMatchObject({ error: { code: "no-video", inReplyTo: id } });
  });

  it("answers the server's pings, so the server keeps the link", async () => {
    const server = new LinkServer({ port: 0, pingIntervalMs: 30, idleTimeoutMs: 100 });
    servers.push(server);
    await server.start();
    const client = new LinkClient({
      url: () => `ws://127.0.0.1:${server.boundPort}/`,
      open: (url) => new WebSocket(url, { origin: EXT_ORIGIN }) as unknown as SocketLike,
      onIntent: () => undefined,
      newId: () => "k"
    });
    clients.push(client);
    client.start();
    await until(() => server.isConnected("browser"));
    await new Promise((r) => setTimeout(r, 400));
    expect(server.isConnected("browser")).toBe(true);
  });

  it("is refused without an extension origin, as a web page would be", async () => {
    const server = new LinkServer({ port: 0 });
    servers.push(server);
    await server.start();
    const client = new LinkClient({
      url: () => `ws://127.0.0.1:${server.boundPort}/`,
      open: (url) => new WebSocket(url, { origin: "https://www.youtube.com" }) as unknown as SocketLike,
      onIntent: () => undefined,
      newId: () => "k"
    });
    clients.push(client);
    client.start();
    await new Promise((r) => setTimeout(r, 200));
    expect(server.isConnected("browser")).toBe(false);
    expect(client.connected).toBe(false);
  });
});

describe("LinkClient on its own", () => {
  /** A socket that never opens and records what is sent, driven by the test. */
  function fakeSockets() {
    const made: (SocketLike & { sent: string[]; closed: boolean; fireOpen(): void; fireClose(code?: number): void; fireMessage(d: unknown): void })[] = [];
    const open = (): SocketLike => {
      const s = {
        readyState: 0,
        sent: [] as string[],
        closed: false,
        send(d: string) {
          this.sent.push(d);
        },
        close() {
          this.readyState = 3;
          this.closed = true;
        },
        onopen: null as SocketLike["onopen"],
        onclose: null as SocketLike["onclose"],
        onerror: null as SocketLike["onerror"],
        onmessage: null as SocketLike["onmessage"],
        fireOpen() {
          this.readyState = 1;
          this.onopen?.({});
        },
        fireClose(code?: number) {
          this.readyState = 3;
          this.onclose?.(code === undefined ? {} : { code });
        },
        fireMessage(data: unknown) {
          this.onmessage?.({ data });
        }
      };
      made.push(s);
      return s;
    };
    return { made, open };
  }

  function fakeTimers() {
    const pending: { ms: number; fn: () => void }[] = [];
    return {
      pending,
      timers: {
        setTimeout: (fn: () => void, ms: number) => {
          const t = { ms, fn };
          pending.push(t);
          return t;
        },
        clearTimeout: (h: unknown) => {
          const i = pending.indexOf(h as { ms: number; fn: () => void });
          if (i >= 0) pending.splice(i, 1);
        }
      },
      runNext() {
        const t = pending.shift();
        t?.fn();
        return t?.ms;
      }
    };
  }

  it("backs off from 1 s, doubling to 30 s, and resets after a successful open (R-LNK-3)", () => {
    const { made, open } = fakeSockets();
    const t = fakeTimers();
    const client = new LinkClient({ url: () => "ws://x", open, onIntent: () => undefined, newId: () => "k", timers: t.timers, random: () => 0 });
    client.start();
    const delays: number[] = [];
    for (let k = 0; k < 7; k++) {
      made[made.length - 1].fireClose();
      delays.push(t.runNext() as number);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(MIN_BACKOFF_MS).toBe(1000);
    expect(MAX_BACKOFF_MS).toBe(30000);
    made[made.length - 1].fireOpen();
    made[made.length - 1].fireClose();
    expect(t.runNext()).toBe(1000);
  });

  it("jitters the wait by up to 20 % below the backoff", () => {
    const { made, open } = fakeSockets();
    const t = fakeTimers();
    const client = new LinkClient({ url: () => "ws://x", open, onIntent: () => undefined, newId: () => "k", timers: t.timers, random: () => 0.999 });
    client.start();
    made[0].fireClose();
    expect(t.pending[0].ms).toBe(800);
  });

  it("answers a malformed message with an error and a ping with a pong", () => {
    const { made, open } = fakeSockets();
    const intents: Intent[] = [];
    const client = new LinkClient({ url: () => "ws://x", open, onIntent: (i) => intents.push(i), newId: () => "k1" });
    client.start();
    made[0].fireOpen();
    made[0].fireMessage("{bad");
    made[0].fireMessage(JSON.stringify({ v: 1, id: "p1", target: "browser", type: "ping", t: 7 }));
    made[0].fireMessage(JSON.stringify({ v: 1, id: "i1", target: "browser", type: "speed.reset" }));
    made[0].fireMessage(Buffer.from("binary"));
    const sent = made[0].sent.map((d) => JSON.parse(d));
    expect(sent[0]).toMatchObject({ type: "error", code: "bad-json", target: "browser" });
    expect(sent[1]).toEqual({ v: 1, id: "k1", target: "browser", type: "pong", t: 7 });
    expect(sent[2]).toMatchObject({ type: "error", code: "bad-message" });
    expect(intents).toEqual([{ v: 1, id: "i1", target: "browser", type: "speed.reset" }]);
    client.stop();
  });

  it("does not send while closed, and stop cancels the retry", () => {
    const { made, open } = fakeSockets();
    const t = fakeTimers();
    const client = new LinkClient({ url: () => "ws://x", open, onIntent: () => undefined, newId: () => "k", timers: t.timers });
    client.start();
    expect(client.send({ v: 1, id: "a", target: "browser", type: "pong", t: 1 })).toBe(false);
    made[0].fireClose();
    expect(t.pending).toHaveLength(1);
    client.stop();
    expect(t.pending).toHaveLength(0);
    expect(made).toHaveLength(1);
  });

  it("ensure connects when idle and does nothing while a retry waits", () => {
    const { made, open } = fakeSockets();
    const t = fakeTimers();
    const client = new LinkClient({ url: () => "ws://x", open, onIntent: () => undefined, newId: () => "k", timers: t.timers });
    client.ensure();
    expect(made).toHaveLength(1);
    made[0].fireClose();
    client.ensure();
    expect(made).toHaveLength(1);
    t.runNext();
    expect(made).toHaveLength(2);
  });

  it("waits the longest delay after the server says a newer connection replaced it (R-LNK-4)", () => {
    const { made, open } = fakeSockets();
    const t = fakeTimers();
    const client = new LinkClient({ url: () => "ws://x", open, onIntent: () => undefined, newId: () => "k", timers: t.timers, random: () => 0 });
    client.start();
    made[0].fireOpen();
    made[0].fireClose(CLOSE_REPLACED);
    expect(t.runNext()).toBe(MAX_BACKOFF_MS);
    made[1].fireOpen();
    made[1].fireClose(1006);
    expect(t.runNext()).toBe(MIN_BACKOFF_MS);
  });

  it("calls onOpen and onClose for its own socket", () => {
    const { made, open } = fakeSockets();
    const t = fakeTimers();
    const seen: string[] = [];
    const client = new LinkClient({
      url: () => "ws://x",
      open,
      onIntent: () => undefined,
      onOpen: () => seen.push("open"),
      onClose: () => seen.push("close"),
      newId: () => "k",
      timers: t.timers
    });
    client.start();
    made[0].fireOpen();
    expect(client.connected).toBe(true);
    made[0].fireClose();
    expect(seen).toEqual(["open", "close"]);
  });

  it("ignores events from a socket it has replaced", () => {
    const { made, open } = fakeSockets();
    const t = fakeTimers();
    const intents: Intent[] = [];
    const seen: string[] = [];
    const client = new LinkClient({
      url: () => "ws://x",
      open,
      onIntent: (i) => intents.push(i),
      onOpen: () => seen.push("open"),
      onClose: () => seen.push("close"),
      newId: () => "k",
      timers: t.timers
    });
    client.start();
    const old = made[0];
    client.restart();
    expect(made).toHaveLength(2);
    old.fireOpen();
    old.fireMessage(JSON.stringify({ v: 1, id: "i1", target: "browser", type: "speed.reset" }));
    old.fireClose();
    expect(seen).toEqual([]);
    expect(intents).toEqual([]);
    expect(t.pending).toHaveLength(0);
  });

  it("closes its socket on stop and starts over at 1 s on restart", () => {
    const { made, open } = fakeSockets();
    const t = fakeTimers();
    const client = new LinkClient({ url: () => "ws://x", open, onIntent: () => undefined, newId: () => "k", timers: t.timers, random: () => 0 });
    client.start();
    for (let k = 0; k < 4; k++) {
      made[made.length - 1].fireClose();
      t.runNext();
    }
    expect(client.nextDelayMs).toBe(16000);
    const live = made[made.length - 1];
    client.restart();
    expect(live.closed).toBe(true);
    expect(client.nextDelayMs).toBe(MIN_BACKOFF_MS);
    client.stop();
    expect(made[made.length - 1].closed).toBe(true);
  });
});
