// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page (Phase 2): its address, the embed control, settled answers,
// the plugin serving it, and the page's logic against the real link server
// with a fake embed that lags like the real one (docs/vjster/REQUIREMENTS.md
// R-OBS-1..3, R-LNK-2, R-INT-4; PLAN.md Phase 2).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { LinkServer, PAGE_CSP, type LinkEvent, type ServedFile } from "../src/vjster/plugin/link-server.js";
import { ObsKeepAlive } from "../src/vjster/plugin/obs-keepalive.js";
import { loadObsPage, obsPageAddress, videoIdFrom, VIDEO_PLACEHOLDER } from "../src/vjster/plugin/obs-page.js";
import type { SocketLike } from "../vjster-extension/src/link-client.js";
import { embedControl, embedRates, type EmbedPlayer } from "../vjster-page/src/embed-control.js";
import { ObsPage, playerVars } from "../vjster-page/src/page-core.js";
import { linkUrl, readParams, readPort, setupProblem, withoutToken } from "../vjster-page/src/page-params.js";
import { AnswerSettler, SettledAnswers, settleKind } from "../vjster-page/src/settle.js";
import { API_URL, SCRIPT_RETRY_MS, bootPage, type BootEnv } from "../vjster-page/src/page-boot.js";

const TOKEN = "0123456789abcdef0123456789abcdef";
const VIDEO = "aqz-KE-bpKQ";

describe("page address (R-OBS-2)", () => {
  it("reads the video, the token from the fragment, and the port the plugin served it on", () => {
    expect(readParams(`?v=${VIDEO}`, `#token=${TOKEN}`, "48150")).toEqual({
      videoId: VIDEO,
      playlistId: null,
      token: TOKEN,
      port: 48150,
      loop: false,
      mute: false,
      start: 0
    });
  });

  it("reads the token from the fragment only and the port only from where it was served, plus the flags", () => {
    const p = readParams(`?v=${VIDEO}&token=${TOKEN}&port=48151&loop=1&mute=true&start=90&list=PLabcdefghij`, "", "48150");
    expect(p).toMatchObject({ token: null, port: 48150, loop: true, mute: true, start: 90, playlistId: "PLabcdefghij" });
  });

  it("drops anything malformed", () => {
    const p = readParams("?v=short&list=bad!list&start=-5&port=80", "#token=ABCDEF0123456789abcdef0123456789", "");
    expect(p).toMatchObject({ videoId: null, playlistId: null, token: null, port: 48150, start: 0 });
    expect(readParams("?start=1.5", "", "").start).toBe(0);
    expect(readParams("?start=86400", "", "").start).toBe(0);
    for (const raw of [null, undefined, "", "1023", "65536", "48150x", "123456"]) expect(readPort(raw)).toBe(48150);
    expect(readPort("1024")).toBe(1024);
    expect(readPort("65535")).toBe(65535);
  });

  it("builds the link address and removes the token from the page's own address", () => {
    expect(linkUrl({ port: 48150, token: TOKEN })).toBe(`ws://127.0.0.1:48150/?token=${TOKEN}`);
    expect(withoutToken("/obs", `?v=${VIDEO}&token=${TOKEN}`)).toBe(`/obs?v=${VIDEO}`);
    expect(withoutToken("/obs", `?token=${TOKEN}`)).toBe("/obs");
  });

  it("says what is missing before it starts", () => {
    expect(setupProblem(readParams(`?v=${VIDEO}`, "", ""))).toMatch(/no token/);
    expect(setupProblem(readParams("", `#token=${TOKEN}`, ""))).toMatch(/video id/);
    expect(setupProblem(readParams("?list=PLabcdefghij", `#token=${TOKEN}`, ""))).toBeNull();
    expect(setupProblem(readParams(`?v=${VIDEO}`, `#token=${TOKEN}`, ""))).toBeNull();
  });

  it("asks the embed to autoplay without controls, and loops a single video as a playlist of one", () => {
    const vars = playerVars(readParams(`?v=${VIDEO}&loop=1&mute=1&start=5`, "", ""), "http://127.0.0.1:48150");
    expect(vars).toMatchObject({ autoplay: 1, controls: 0, mute: 1, start: 5, loop: 1, playlist: VIDEO, origin: "http://127.0.0.1:48150" });
    const list = playerVars(readParams("?list=PLabcdefghij&loop=1", "", ""), "o");
    expect(list).toMatchObject({ listType: "playlist", list: "PLabcdefghij", loop: 1 });
    expect(list.playlist).toBeUndefined();
    expect(playerVars(readParams(`?v=${VIDEO}`, "", ""), "o").mute).toBeUndefined();
  });
});

/** A fake embed: the rate getter lags like the real one (V-10), and setting a rate fires the event later. */
function fakeEmbed(listed = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
  const s = { rate: 1, state: 1, title: "Big Buck Bunny", lagMs: 20, onRate: (): void => undefined, onState: (_s: number): void => undefined };
  const player: EmbedPlayer = {
    getPlaybackRate: () => s.rate,
    getAvailablePlaybackRates: () => listed,
    setPlaybackRate: (r) => {
      const max = Math.max(...listed);
      const next = Math.min(max, Math.max(0.25, r));
      setTimeout(() => {
        const changed = next !== s.rate;
        s.rate = next;
        if (changed) s.onRate();
      }, s.lagMs);
    },
    getPlayerState: () => s.state,
    getVideoData: () => ({ title: s.title }),
    playVideo: () => {
      setTimeout(() => {
        s.state = 1;
        s.onState(1);
      }, s.lagMs);
    },
    pauseVideo: () => {
      setTimeout(() => {
        s.state = 2;
        s.onState(2);
      }, s.lagMs);
    }
  };
  return { s, player };
}

describe("embed control (V-10)", () => {
  it("is speed and play/pause only, with the player's listed rates", () => {
    const { player } = fakeEmbed();
    const c = embedControl(player);
    expect([c.kind, c.canQuality, c.quality(), c.availableQualities(), c.adShowing()]).toEqual(["video", false, null, [], false]);
    expect(c.availableRates()).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(c.title()).toBe("Big Buck Bunny");
    expect(() => c.setQuality("hd720")).toThrow();
    expect(() => c.setQualityAuto()).toThrow();
  });

  it("keeps only usable rates and reads buffering as playing", () => {
    expect(embedRates([0.25, 0, -1, Number.NaN, "2", 2])).toEqual([0.25, 2]);
    expect(embedRates(undefined)).toEqual([]);
    const { s, player } = fakeEmbed();
    const c = embedControl(player);
    for (const [state, playing] of [[1, true], [3, true], [2, false], [-1, false], [5, false], [0, false]] as const) {
      s.state = state;
      expect(c.playing()).toBe(playing);
    }
    s.rate = Number.NaN;
    expect(c.elementRate()).toBeNull();
  });
});

describe("settled answers (R-INT-4, R-BEH-4)", () => {
  function timers() {
    const pending: { fn: () => void; ms: number }[] = [];
    return {
      pending,
      t: {
        setTimeout: (fn: () => void, ms: number) => {
          const h = { fn, ms };
          pending.push(h);
          return h;
        },
        clearTimeout: (h: unknown) => {
          const i = pending.indexOf(h as { fn: () => void; ms: number });
          if (i >= 0) pending.splice(i, 1);
        }
      },
      fire: () => pending.shift()?.fn()
    };
  }

  it("waits for the matching player event, or 300 ms", () => {
    const tm = timers();
    const out: string[][] = [];
    const s = new AnswerSettler((ids) => out.push([...ids]), tm.t);
    s.hold("a", "rate");
    s.hold("b", "rate");
    s.hold("c", "state");
    s.playerEvent("rate");
    expect(out).toEqual([["a", "b"]]);
    expect(tm.pending.map((p) => p.ms)).toEqual([300]);
    tm.fire();
    expect(out).toEqual([["a", "b"], ["c"]]);
    s.playerEvent("state"); // nothing left
    expect(out).toHaveLength(2);
  });

  it("settles speed and play/pause, answers everything else at once", () => {
    expect(["speed.set", "speed.step", "speed.reset", "transport.toggle", "state.get", "pin.set", "quality.set"].map(settleKind)).toEqual([
      "rate",
      "rate",
      "rate",
      "state",
      null,
      null,
      null
    ]);
  });

  it("lets an error through at once and never answers that intent again", () => {
    const tm = timers();
    const answered: string[] = [];
    const s = new SettledAnswers((id) => answered.push(id), tm.t);
    s.begin({ id: "a", type: "speed.set" });
    s.begin({ id: "b", type: "state.get" });
    expect(s.passes({ kind: "state", inReplyTo: "a" })).toBe(false);
    expect(s.passes({ kind: "state", inReplyTo: "b" })).toBe(true);
    expect(s.passes({ kind: "state", inReplyTo: null })).toBe(true);
    s.begin({ id: "c", type: "speed.set" });
    expect(s.passes({ kind: "error", inReplyTo: "c" })).toBe(true);
    s.playerEvent("rate");
    expect(answered).toEqual(["a"]);
    s.dispose();
    expect(tm.pending).toHaveLength(0);
  });
});

describe("the plugin's side of the page (R-OBS-1..2)", () => {
  it("finds the video id in what the operator pastes", () => {
    for (const input of [
      VIDEO,
      ` ${VIDEO} `,
      `https://www.youtube.com/watch?v=${VIDEO}&t=42s`,
      `www.youtube.com/watch?v=${VIDEO}`,
      `https://youtu.be/${VIDEO}?si=abc`,
      `https://www.youtube.com/shorts/${VIDEO}`,
      `https://www.youtube.com/embed/${VIDEO}`,
      `https://www.youtube.com/live/${VIDEO}`,
      `https://music.youtube.com/watch?v=${VIDEO}&list=RDAMVM`,
      `https://m.youtube.com/watch?v=${VIDEO}`,
      `https://www.youtube-nocookie.com/embed/${VIDEO}`
    ])
      expect(videoIdFrom(input)).toBe(VIDEO);
    for (const input of ["", "hello", `https://evil.example/watch?v=${VIDEO}`, `https://youtube.com.evil.example/watch?v=${VIDEO}`, "https://www.youtube.com/watch?v=short", "https://www.youtube.com/", "https://www.youtube.com/embed/videoseries?list=PLabcdefghij"])
      expect(videoIdFrom(input)).toBeNull();
  });

  it("puts the token in the fragment of the browser source address", () => {
    expect(obsPageAddress(48150, TOKEN, VIDEO)).toBe(`http://127.0.0.1:48150/obs?v=${VIDEO}#token=${TOKEN}`);
    expect(obsPageAddress(48151, TOKEN)).toBe(`http://127.0.0.1:48151/obs?v=${VIDEO_PLACEHOLDER}#token=${TOKEN}`);
    expect(obsPageAddress(48150, TOKEN, "bad")).toContain(`v=${VIDEO_PLACEHOLDER}`);
    expect(() => obsPageAddress(48150, "nope")).toThrow();
  });

  it("loads the built page files, or warns once and serves nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "vjster-page-"));
    try {
      const warnings: string[] = [];
      expect(loadObsPage(dir, { warn: (m) => warnings.push(m) }).size).toBe(0);
      expect(warnings).toHaveLength(1);
      writeFileSync(join(dir, "player.html"), "<html></html>");
      writeFileSync(join(dir, "player.js"), "1;");
      const pages = loadObsPage(dir, { warn: (m) => warnings.push(m) });
      expect([...pages.keys()]).toEqual(["/obs", "/obs/", "/obs/player.js"]);
      expect(pages.get("/obs")?.type).toBe("text/html; charset=utf-8");
      expect(pages.get("/obs/player.js")?.type).toBe("text/javascript; charset=utf-8");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const servers: LinkServer[] = [];
const pagesStopped: ObsPage[] = [];
afterEach(async () => {
  for (const p of pagesStopped.splice(0)) p.stop();
  for (const s of servers.splice(0)) await s.stop();
});

const pages = new Map<string, ServedFile>([
  ["/obs", { type: "text/html; charset=utf-8", body: "<!doctype html><title>VJster</title>" }],
  ["/obs/player.js", { type: "text/javascript; charset=utf-8", body: "void 0;" }]
]);

/** The status line of a raw request with two Host headers, which Node's client will not send. */
function twoHosts(port: number, path: string): Promise<string> {
  const CRLF = String.fromCharCode(13, 10);
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write([`GET ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`, "Host: evil.example", "Connection: close", "", ""].join(CRLF));
    });
    let data = "";
    socket.on("data", (d) => (data += d));
    socket.on("end", () => resolve(data.split(CRLF)[0]));
    socket.on("error", reject);
  });
}

function get(port: number, path: string, opts: { method?: string; host?: string } = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${port}` };
    const req = request({ host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers, setHost: false }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the link server hands out the page (R-OBS-1, R-LNK-2)", () => {
  it("serves the page and its script with strict headers, to this computer's own address only", async () => {
    const server = new LinkServer({ port: 0, obsToken: TOKEN, pages });
    servers.push(server);
    await server.start();
    const port = server.boundPort as number;
    const page = await get(port, `/obs?v=${VIDEO}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("<title>VJster</title>");
    expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.headers["content-security-policy"]).toBe(PAGE_CSP);
    expect(PAGE_CSP).toBe(
      "default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com; connect-src ws://127.0.0.1:* ws://localhost:*; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    expect(page.headers["referrer-policy"]).toBe("strict-origin");
    expect((await get(port, "/obs/player.js")).body).toBe("void 0;");
    expect((await get(port, "/obs", { host: `localhost:${port}` })).status).toBe(200);
    const head = await get(port, "/obs", { method: "HEAD" });
    expect([head.status, head.body]).toEqual([200, ""]);
    expect((await get(port, "/obs", { host: `evil.example:${port}` })).status).toBe(403);
    expect(["HTTP/1.1 400 Bad Request", "HTTP/1.1 403 Forbidden"]).toContain(await twoHosts(port, "/obs"));
    expect((await get(port, "/obs", { method: "POST" })).status).toBe(426);
    expect((await get(port, "/other")).status).toBe(426);
  });

  it("serves nothing without pages", async () => {
    const server = new LinkServer({ port: 0 });
    servers.push(server);
    await server.start();
    expect((await get(server.boundPort as number, "/obs")).status).toBe(426);
  });
});

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await new Promise((r) => setTimeout(r, 5));
  }
};

async function rig(listed?: number[]) {
  const server = new LinkServer({ port: 0, obsToken: TOKEN, pages });
  servers.push(server);
  await server.start();
  const port = server.boundPort as number;
  const events: LinkEvent[] = [];
  server.on((e) => events.push(e));
  let n = 0;
  const page = new ObsPage({
    params: readParams(`?v=${VIDEO}`, `#token=${TOKEN}`, String(port)),
    openSocket: (url) => new WebSocket(url, { headers: { origin: `http://127.0.0.1:${port}` } }) as unknown as SocketLike,
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    newId: () => `o-${++n}`,
    random: () => 0
  });
  pagesStopped.push(page);
  const embed = fakeEmbed(listed);
  embed.s.onRate = () => page.rateChanged();
  embed.s.onState = (state) => page.stateChanged(state);
  const answer = (id: string | null) => events.find((e) => e.type === "state" && e.state.inReplyTo === id) as Extract<LinkEvent, { type: "state" }> | undefined;
  return { server, port, events, page, embed, answer };
}

describe("the OBS page against the real link server (R-OBS-1..3, R-INT-4)", () => {
  it("connects as the obs target with its token, and reports no video until the player is ready", async () => {
    const { server, events, page } = await rig();
    page.start();
    await until(() => server.isConnected("obs"));
    expect(server.isConnected("browser")).toBe(false);
    await until(() => events.some((e) => e.type === "state"));
    expect(events.find((e) => e.type === "state")).toMatchObject({ target: "obs", state: { rate: null, host: null, pinned: false } });
  });

  it("reports the video once the player is ready, then answers speed with the rate the player took", async () => {
    const { server, events, page, embed, answer } = await rig();
    page.start();
    await until(() => server.isConnected("obs"));
    page.playerReady(embed.player);
    await until(() => events.some((e) => e.type === "state" && e.state.rate === 1));
    expect(events.find((e) => e.type === "state" && e.state.rate === 1)).toMatchObject({
      state: { title: "Big Buck Bunny", playing: true, capabilities: ["speed", "transport"], availableRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] }
    });
    const sentAt = Date.now();
    const id = server.send("obs", { type: "speed.set", rate: 1.5, direct: false, hold: false });
    await until(() => answer(id) !== undefined);
    expect(answer(id)?.state.rate).toBe(1.5); // not the lagging 1
    expect(Date.now() - sentAt).toBeLessThan(200); // released by the rate event, not the 300 ms wait
    const big = server.send("obs", { type: "speed.set", rate: 8, direct: true, hold: false });
    await until(() => answer(big) !== undefined);
    expect(answer(big)?.state.rate).toBe(2); // what OBS's embed plays at most (V-10)
  });

  it("answers an unchanged rate after the wait, and play/pause once the player says so", async () => {
    const { server, page, embed, answer } = await rig();
    page.start();
    await until(() => server.isConnected("obs"));
    page.playerReady(embed.player);
    const same = server.send("obs", { type: "speed.set", rate: 1, direct: false, hold: false });
    const t0 = Date.now();
    await until(() => answer(same) !== undefined);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    const pause = server.send("obs", { type: "transport.toggle" });
    await until(() => answer(pause) !== undefined);
    expect(answer(pause)?.state.playing).toBe(false);
  });

  it("refuses quality, answers state.get at once, and answers intents before the player is ready with no-video", async () => {
    const { server, events, page, embed, answer } = await rig();
    page.start();
    await until(() => server.isConnected("obs"));
    const early = server.send("obs", { type: "speed.reset" });
    await until(() => events.some((e) => e.type === "error" && e.error.inReplyTo === early));
    expect(events.find((e) => e.type === "error" && e.error.inReplyTo === early)).toMatchObject({ target: "obs", error: { code: "no-video" } });
    page.playerReady(embed.player);
    const q = server.send("obs", { type: "quality.set", level: "large", hold: false });
    await until(() => events.some((e) => e.type === "error" && e.error.inReplyTo === q));
    expect(events.find((e) => e.type === "error" && e.error.inReplyTo === q)).toMatchObject({ target: "obs", error: { code: "unsupported" } });
    const get = server.send("obs", { type: "state.get" });
    await until(() => answer(get) !== undefined);
    expect(events.filter((e) => e.type === "state" && e.state.inReplyTo === q)).toHaveLength(0);
  });

  it("puts a held rate back when the next video of a playlist starts (R-SPD-4)", async () => {
    const { server, page, embed, answer } = await rig();
    page.start();
    await until(() => server.isConnected("obs"));
    page.playerReady(embed.player);
    const id = server.send("obs", { type: "speed.set", rate: 1.75, direct: false, hold: true });
    await until(() => answer(id) !== undefined);
    embed.s.rate = 1; // the next video starts at 1x
    page.stateChanged(-1);
    await until(() => embed.s.rate === 1.75);
    embed.s.rate = 1; // and the embed resets it again before it plays
    page.stateChanged(1);
    await until(() => embed.s.rate === 1.75);
    embed.s.rate = 1; // later plays leave the rate alone
    page.stateChanged(2);
    page.stateChanged(1);
    await new Promise((r) => setTimeout(r, 60));
    expect(embed.s.rate).toBe(1);
  });

  it("is refused with a wrong token", async () => {
    const server = new LinkServer({ port: 0, obsToken: TOKEN, pages });
    servers.push(server);
    await server.start();
    const port = server.boundPort as number;
    const page = new ObsPage({
      params: readParams(`?v=${VIDEO}`, "#token=ffffffffffffffffffffffffffffffff", String(port)),
      openSocket: (url) => new WebSocket(url, { headers: { origin: `http://127.0.0.1:${port}` } }) as unknown as SocketLike,
      timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      newId: () => "o",
      random: () => 0
    });
    pagesStopped.push(page);
    page.start();
    await new Promise((r) => setTimeout(r, 200));
    expect(server.isConnected("obs")).toBe(false);
  });
});

describe("keep the link on for OBS (R-LNK-1, R-OBS-1)", () => {
  function fakeHub() {
    const listeners: (() => void)[] = [];
    const h = {
      acquired: 0,
      released: 0,
      obs: "page-off" as "page-off" | "connected",
      acquire: async () => void h.acquired++,
      release: () => void h.released++,
      view: () => ({ status: h.obs, state: null }),
      subscribe: (l: () => void) => {
        listeners.push(l);
        return () => undefined;
      },
      fire: () => listeners.forEach((l) => l())
    };
    return h;
  }

  it("holds the link once while on, and lets go once when turned off", () => {
    const hub = fakeHub();
    const keep = new ObsKeepAlive(hub, () => undefined);
    keep.set(true);
    keep.set(true);
    expect([hub.acquired, hub.released, keep.on]).toEqual([1, 0, true]);
    keep.set(false);
    keep.set(false);
    expect([hub.acquired, hub.released, keep.on]).toEqual([1, 1, false]);
  });

  it("turns itself on the first time an OBS page connects, once", () => {
    const hub = fakeHub();
    let asked = 0;
    new ObsKeepAlive(hub, () => void asked++);
    hub.fire();
    expect(asked).toBe(0);
    hub.obs = "connected";
    hub.fire();
    hub.fire();
    expect(asked).toBe(1);
  });

  it("never turns itself on once the operator has chosen, on or off (step 6 of the Phase 2 review)", () => {
    const hub = fakeHub();
    let asked = 0;
    const keep = new ObsKeepAlive(hub, () => void asked++);
    keep.set(false);
    hub.obs = "connected";
    hub.fire();
    expect(asked).toBe(0);
    expect(hub.acquired).toBe(0);
    keep.set(null);
    hub.fire();
    expect(asked).toBe(1);
  });

  it("does not ask while it already holds the link", () => {
    const hub = fakeHub();
    let asked = 0;
    const keep = new ObsKeepAlive(hub, () => void asked++);
    keep.set(true);
    hub.obs = "connected";
    hub.fire();
    expect(asked).toBe(0);
  });
});

describe("the OBS page keeps its link (R-LNK-3)", () => {
  it("answers the server's pings as the obs target, so the server keeps it", async () => {
    const server = new LinkServer({ port: 0, obsToken: TOKEN, pages, pingIntervalMs: 30, idleTimeoutMs: 100 });
    servers.push(server);
    await server.start();
    const port = server.boundPort as number;
    const page = new ObsPage({
      params: readParams(`?v=${VIDEO}`, `#token=${TOKEN}`, String(port)),
      openSocket: (url) => new WebSocket(url, { headers: { origin: `http://127.0.0.1:${port}` } }) as unknown as SocketLike,
      timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      newId: () => `o-${Math.random().toString(36).slice(2, 8)}`,
      random: () => 0
    });
    pagesStopped.push(page);
    const ticker = setInterval(() => server.tick(), 30);
    try {
      page.start();
      await until(() => server.isConnected("obs"));
      await new Promise((r) => setTimeout(r, 400));
      expect(server.isConnected("obs")).toBe(true);
    } finally {
      clearInterval(ticker);
    }
  });
});

describe("the page's link client speaks as the obs target (R-INT-3)", () => {
  it("answers a ping and a malformed message naming obs", () => {
    const sent: string[] = [];
    let socket: SocketLike & { open(): void; message(d: string): void };
    const make = (): SocketLike => {
      socket = {
        readyState: 0,
        send: (d: string) => void sent.push(d),
        close: () => undefined,
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
        open() {
          (this as { readyState: number }).readyState = 1;
          this.onopen?.({});
        },
        message(d: string) {
          this.onmessage?.({ data: d });
        }
      };
      return socket;
    };
    const page = new ObsPage({
      params: readParams(`?v=${VIDEO}`, `#token=${TOKEN}`, "48150"),
      openSocket: make,
      timers: { setTimeout: () => 0, clearTimeout: () => undefined },
      newId: () => "o-1",
      random: () => 0
    });
    page.start();
    socket!.open();
    sent.length = 0;
    socket!.message(JSON.stringify({ v: 1, id: "p1", target: "obs", type: "ping", t: 9 }));
    socket!.message("{bad");
    expect(sent.map((d) => JSON.parse(d))).toEqual([
      { v: 1, id: "o-1", target: "obs", type: "pong", t: 9 },
      expect.objectContaining({ type: "error", code: "bad-json", target: "obs" })
    ]);
    page.stop();
  });
});

describe("the page's start-up (R-OBS-2)", () => {
  function env(search: string, hash: string, opts: { scriptFails?: number; noYT?: boolean } = {}) {
    const log: string[] = [];
    const shown: string[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    let ready: (() => void) | null = null;
    let fails = opts.scriptFails ?? 0;
    const e: BootEnv = {
      location: { search, hash, port: "48150", pathname: "/obs", origin: "http://127.0.0.1:48150" },
      replaceAddress: (url) => void log.push(`address ${url}`),
      show: (text) => void shown.push(text),
      addScript: (src, onError) => {
        log.push(`script ${src}`);
        if (fails > 0) {
          fails--;
          onError();
        }
      },
      onApiReady: (fn) => {
        ready = fn;
      },
      createPlayer: (id) => {
        log.push(`player ${id}`);
        return opts.noYT ? null : (fakeEmbed().player as never);
      },
      openSocket: () => {
        log.push("socket");
        return { readyState: 0, send: () => undefined, close: () => undefined, onopen: null, onclose: null, onerror: null, onmessage: null };
      },
      timers: {
        setTimeout: (fn, ms) => {
          timers.push({ fn, ms });
          return timers.length;
        },
        clearTimeout: () => undefined
      },
      random: () => 0
    };
    return { e, log, shown, timers, ready: () => ready?.() };
  }

  it("takes the token out of the address before it adds YouTube's script", () => {
    const x = env(`?v=${VIDEO}&mute=1`, `#token=${TOKEN}`);
    const page = bootPage(x.e);
    expect(x.log.slice(0, 2)).toEqual([`address /obs?v=${VIDEO}&mute=1`, `script ${API_URL}`]);
    expect(x.log.every((l) => !l.includes(TOKEN))).toBe(true);
    page?.stop();
  });

  it("says what is missing and adds no script when the address is incomplete", () => {
    const x = env(`?v=${VIDEO}`, "");
    expect(bootPage(x.e)).toBeNull();
    expect(x.log).toEqual([`address /obs?v=${VIDEO}`]);
    expect(x.shown[0]).toMatch(/no token/);
  });

  it("tries YouTube's script again with growing waits when it fails to load", () => {
    const x = env(`?v=${VIDEO}`, `#token=${TOKEN}`, { scriptFails: 7 });
    const page = bootPage(x.e);
    for (let i = 0; i < 7; i++) x.timers.shift()?.fn();
    const scripts = x.log.filter((l) => l.startsWith("script")).length;
    expect(scripts).toBe(8);
    expect(SCRIPT_RETRY_MS).toEqual([2000, 4000, 8000, 16000, 30000]);
    expect(x.shown.filter((s) => /trying again/.test(s))).toHaveLength(7);
    expect(x.shown[x.shown.length - 1]).toMatch(/30 s/);
    page?.stop();
  });

  it("wires the player's events to the page and opens the link", () => {
    const x = env(`?v=${VIDEO}`, `#token=${TOKEN}`);
    let options: Parameters<BootEnv["createPlayer"]>[1] | null = null;
    const embed = fakeEmbed();
    x.e.createPlayer = (_id, o) => {
      options = o;
      return embed.player;
    };
    const page = bootPage(x.e);
    expect(x.log).toContain("socket");
    x.ready();
    const o = options as unknown as Parameters<BootEnv["createPlayer"]>[1];
    expect(o.playerVars.origin).toBe("http://127.0.0.1:48150");
    expect(o.videoId).toBe(VIDEO);
    expect(Object.keys(o.events).sort()).toEqual(["onError", "onPlaybackRateChange", "onReady", "onStateChange"]);
    o.events.onReady({ data: 0 });
    expect(page?.adapter.snapshot()).toMatchObject({ rate: 1, title: "Big Buck Bunny" });
    page?.stop();
  });

  it("makes the player once the API is ready, clears the note, and says so when YouTube is missing", () => {
    const x = env(`?v=${VIDEO}`, `#token=${TOKEN}`);
    const page = bootPage(x.e);
    x.ready();
    expect(x.log).toContain("player player");
    expect(x.shown[x.shown.length - 1]).toBe("");
    page?.stop();
    const y = env(`?v=${VIDEO}`, `#token=${TOKEN}`, { noYT: true });
    const page2 = bootPage(y.e);
    y.ready();
    expect(y.shown[y.shown.length - 1]).toMatch(/did not load/);
    page2?.stop();
  });
});
