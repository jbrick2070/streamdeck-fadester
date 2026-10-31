// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page, plugin side end to end: the real plugin (from source) under
// the pretend Stream Deck serves the page files, answers its settings page,
// keeps the page across a port change, repairs a lost token and remembers the
// operator's choice for keeping the link on (docs/vjster/PLAN.md Phase 2;
// REQUIREMENTS.md R-OBS-1..2, R-LNK-1..2).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { DeckSim } from "../scripts/vjster/deck-sim.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean | Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("condition not reached");
    await sleep(25);
  }
};

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.end();
  });
}

const VIDEO = "aqz-KE-bpKQ";

describe("the plugin serves and manages the OBS page", () => {
  const sim = new DeckSim();
  const dir = mkdtempSync(join(tmpdir(), "vjster-page-e2e-"));
  let port = 0;
  let port2 = 0;

  beforeAll(async () => {
    writeFileSync(join(dir, "player.html"), "<!doctype html><title>VJster fixture</title>");
    writeFileSync(join(dir, "player.js"), "void 'fixture';");
    port = await freePort();
    port2 = await freePort();
    await sim.start(true, port, { VJSTER_PAGE_DIR: dir });
    sim.appear({
      context: "dial-0",
      action: "com.jbrick2070.vjster.speed",
      controller: "Encoder",
      column: 0,
      row: 0,
      settings: { label: "OBS", target: "obs" }
    });
  }, 30_000);

  afterAll(async () => {
    await sim.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the page files from its own link server", async () => {
    await until(async () => (await get(port, "/obs")).status === 200);
    expect((await get(port, "/obs")).body).toContain("VJster fixture");
    expect((await get(port, "/obs/player.js")).body).toBe("void 'fixture';");
  });

  it("tells a settings page that appears what it needs, with the address carrying the token", async () => {
    sim.pageAppeared("dial-0");
    await until(() => sim.toPage.some((m) => m.event === "status"));
    const status = sim.toPage.find((m) => m.event === "status") as Record<string, unknown>;
    const token = sim.globalSettings.obsToken as string;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(status).toMatchObject({ obsPage: true, obsAlwaysOn: null, found: false, address: `http://127.0.0.1:${port}/obs?v=VIDEO_ID#token=${token}` });
  });

  it("builds the address from a pasted YouTube link", async () => {
    sim.fromPage("dial-0", { event: "obs-address", input: `https://youtu.be/${VIDEO}?si=x` });
    await until(() => sim.toPage.some((m) => m.event === "obs-address"));
    const token = sim.globalSettings.obsToken as string;
    expect(sim.toPage.find((m) => m.event === "obs-address")).toEqual({ event: "obs-address", address: `http://127.0.0.1:${port}/obs?v=${VIDEO}#token=${token}`, found: true });
  });

  it("keeps serving the page after the port changes", async () => {
    sim.saveGlobal({ ...sim.globalSettings, port: port2 });
    await until(async () => (await get(port2, "/obs")).status === 200);
    expect((await get(port2, "/obs")).body).toContain("VJster fixture");
  });

  it("puts the token back when a settings write drops it", async () => {
    const token = sim.globalSettings.obsToken as string;
    const { obsToken: _dropped, ...rest } = sim.globalSettings;
    void _dropped;
    sim.saveGlobal(rest);
    await until(() => sim.globalSettings.obsToken === token);
  });

  it("turns keep-the-link-on on at the first OBS page, and an explicit off stays off", async () => {
    const token = sim.globalSettings.obsToken as string;
    const connect = () => new WebSocket(`ws://127.0.0.1:${port2}/?token=${token}`, { headers: { origin: `http://127.0.0.1:${port2}` } });
    let ws = connect();
    await until(() => sim.globalSettings.obsAlwaysOn === true);
    ws.close();
    sim.saveGlobal({ ...sim.globalSettings, obsAlwaysOn: false });
    await sleep(200);
    ws = connect();
    await new Promise((r) => ws.once("open", r));
    await sleep(500);
    expect(sim.globalSettings.obsAlwaysOn).toBe(false);
    ws.close();
    // A settings page whose copy lacks the choice must not lose it.
    const { obsAlwaysOn: _choice, ...stale } = sim.globalSettings;
    void _choice;
    sim.saveGlobal(stale);
    await until(() => sim.globalSettings.obsAlwaysOn === false);
  });
});
