// SPDX-License-Identifier: GPL-2.0-or-later
// The TourBox companion drives the real VJster extension logic: the built
// bridge (tourbox/bridge, .NET 8) hosts the VJster link, a stand-in extension
// (the real Router, LinkClient and Adapter around a fake YouTube player, as
// scripts/vjster/deck-sim.ts uses them) connects to it, and a "dispatch"
// typed on the bridge's stdin runs an action exactly as the TourBox hotkey
// would. No Chrome, no TourBox, no OBS (the bridge stays "Offline" for OBS).
//
// Skipped when the bridge is not built or no .NET runtime is found:
//   dotnet build tourbox/bridge/FadesterTourBoxBridge.csproj -c Release
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterAll, describe, expect, it } from "vitest";
import { Adapter } from "../vjster-extension/src/adapter-core.js";
import { LinkClient, type SocketLike } from "../vjster-extension/src/link-client.js";
import { Router } from "../vjster-extension/src/router.js";
import { fakePlayer } from "../scripts/vjster/deck-sim.js";

const root = join(__dirname, "..");
const exe = join(root, "tourbox", "bridge", "bin", "Release", "net8.0-windows", "FadesterTourBoxBridge.exe");
const dotnetRoot = process.env.DOTNET_ROOT ?? join(process.env.LOCALAPPDATA ?? "", "FadesterBuildTools", "dotnet");
const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const available = process.platform === "win32" && existsSync(exe) && existsSync(join(dotnetRoot, "dotnet.exe"));

const temps: string[] = [];
const children: ChildProcess[] = [];
afterAll(() => {
  for (const c of children) if (c.exitCode === null) c.kill();
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

/** A free loopback port, found by binding 0. */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** Start the bridge in listen mode with a config that keeps OBS offline and the VJster link on `port`. */
async function startBridge(port: number): Promise<{ child: ChildProcess; lines: string[]; waitFor: (needle: string, from?: number, ms?: number) => Promise<string> }> {
  const dir = mkdtempSync(join(tmpdir(), "fadester-tb-"));
  temps.push(dir);
  const config = join(dir, "config.json");
  // Port 1 for OBS: nothing listens there, so the bridge stays Offline for OBS and only VJster actions run.
  writeFileSync(config, JSON.stringify({ host: "127.0.0.1", port: 1, vjsterEnabled: true, vjsterPort: port, vjsterExtensionId: "" }));
  const child = spawn(exe, ["--listen", "--config", config, "--map", join(root, "tourbox", "presets", "map.json")], {
    env: { ...process.env, DOTNET_ROOT: dotnetRoot, FADESTER_OBS_PASSWORD: "none" },
    stdio: ["pipe", "pipe", "pipe"]
  });
  children.push(child);
  const lines: string[] = [];
  const waiters: { needle: string; resolve: (line: string) => void }[] = [];
  const onData = (d: Buffer) => {
    for (const line of d.toString().split(/\r?\n/)) {
      if (!line) continue;
      lines.push(line);
      for (const w of waiters.splice(0)) {
        if (line.includes(w.needle)) w.resolve(line);
        else waiters.push(w);
      }
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  /** The first line containing `needle` at index `from` or later, so an earlier, similar line is not taken for the answer. */
  const waitFor = (needle: string, from = 0, ms = 15000): Promise<string> => {
    const found = lines.slice(from).find((l) => l.includes(needle));
    if (found) return Promise.resolve(found);
    // The bridge registers real global hotkeys: with the operator's own companion running they are taken, and it says so.
    const fatal = lines.find((l) => l.startsWith("ERROR:"));
    if (fatal) return Promise.reject(new Error(`the bridge failed: ${fatal} (is another Fadester for TourBox running?)`));
    return new Promise((resolve, reject) => {
      waiters.push({ needle, resolve });
      setTimeout(() => reject(new Error(`no "${needle}" from the bridge in ${ms} ms; got:\n${lines.join("\n")}`)), ms);
    });
  };
  await waitFor("VJster link listening");
  return { child, lines, waitFor };
}

describe("the live OBS fixture (tourbox/tests/live-obs.py)", () => {
  it("copies VjsterLink.cs whenever it copies BridgeConfig.cs, which uses it", () => {
    const text = readFileSync(join(root, "tourbox", "tests", "live-obs.py"), "utf8");
    // Every list of C# files to copy that names BridgeConfig.cs (another `sources` list in the file holds scenes).
    const lists = text.split(/\r?\n/).filter((l) => /^\s*sources\s*(=|\+=)\s*\[/.test(l) && l.includes("BridgeConfig.cs"));
    expect(lists.length).toBeGreaterThan(0);
    for (const line of lists) expect(line).toContain("VjsterLink.cs");
  });
});

describe.skipIf(!available)("the TourBox companion hosts the VJster link for the real extension logic", () => {
  it("a dispatched TourBox action reaches the page and the page's answer reaches the panel line", async () => {
    const port = await freePort();
    const bridge = await startBridge(port);
    // The stand-in extension, exactly as the deck simulator builds it: real Router, LinkClient and Adapter over a fake player.
    const player = fakePlayer("Big Buck Bunny");
    const TAB = 7;
    let id = 0;
    const newId = () => `sim-${++id}`;
    // eslint-disable-next-line prefer-const
    let router: Router;
    const adapter = new Adapter(
      () => player.control,
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
      newId,
      timers: { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 200)), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
    });
    router = new Router({
      sendToTab: async (_tab, intent) => {
        adapter.handle(intent);
        return true;
      },
      refreshTabs: () => adapter.refresh(),
      sendToLink: (m) => {
        client.send(m);
      },
      savePin: () => undefined,
      now: () => Date.now(),
      newId
    });
    router.tabActivated(TAB, 1);
    router.focusChanged(1);
    client.start();
    await bridge.waitFor("the Chrome extension connected");

    /** Type the action on the bridge's stdin, as the panel could; returns where the bridge's answer will start. */
    const dispatch = (action: string): number => {
      const from = bridge.lines.length;
      bridge.child.stdin!.write(`dispatch ${action}\n`);
      return from;
    };
    let from = dispatch("vjster.speed.up");
    const line = await bridge.waitFor("Video 1.25x", from);
    expect(player.s.rate).toBe(1.25);
    expect(line).toContain("playing");
    from = dispatch("vjster.speed.fineUp");
    await bridge.waitFor("Video 1.3x", from);
    expect(player.s.rate).toBeCloseTo(1.3, 5);
    from = dispatch("vjster.playPause");
    await bridge.waitFor("paused", from);
    expect(player.s.playing).toBe(false);
    from = dispatch("vjster.speed.reset");
    await bridge.waitFor("Video 1x", from);
    expect(player.s.rate).toBe(1);
    from = dispatch("vjster.status");
    const status = await bridge.waitFor("Big Buck Bunny", from);
    expect(status).toContain("Video 1x");
    // An OBS action while OBS is offline is still refused, as before.
    from = dispatch("music.up");
    await bridge.waitFor("OBS is not connected. Music up was not sent.", from);

    client.stop();
    adapter.dispose();
    await bridge.waitFor("the Chrome extension disconnected");
    bridge.child.stdin!.write("quit\n");
    await bridge.waitFor("Bridge stopped.");
  }, 60000);
});
