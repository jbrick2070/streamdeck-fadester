// SPDX-License-Identifier: GPL-2.0-or-later
// VJster end to end: the real plugin (from source) under a pretend Stream Deck,
// the real extension logic and adapter around a fake YouTube player
// (docs/vjster/PLAN.md Phase 1 step 5; scripts/vjster/deck-sim.ts).
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeckSim, livePlusLayout } from "../scripts/vjster/deck-sim.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await sleep(20);
  }
};

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

const words = (svg: string): string[] => [...svg.matchAll(/>([^<>]{1,60})<\/text>/g)].map((m) => m[1]);

describe("VJster plugin end to end", () => {
  const sim = new DeckSim();
  let port = 0;

  beforeAll(async () => {
    port = await freePort();
    await sim.start(true, port);
    for (const p of livePlusLayout()) sim.appear(p);
  }, 30_000);

  afterAll(async () => {
    await sim.stop();
  });

  it("draws every action, and says EXTENSION OFF before the extension connects (R-BEH-4)", async () => {
    await until(() => sim.images.size === 12);
    expect(words(sim.svg("dial-0"))).toContain("EXTENSION OFF");
    expect(words(sim.svg("dial-2"))).toContain("EXTENSION OFF");
  });

  it("refuses a turn with an alert while there is no extension", async () => {
    const before = sim.alerts.length;
    sim.rotate("dial-0", 1);
    await until(() => sim.alerts.length > before);
    expect(sim.player.s.rate).toBe(1);
  });

  it("shows the playing video once the extension connects", async () => {
    sim.connectExtension(port);
    await until(() => words(sim.svg("dial-0")).includes("1x"));
    expect(words(sim.svg("dial-0"))).toContain("Big Buck Bunny 60fps 4K - O...");
    expect(words(sim.svg("dial-2"))).toContain("1080p");
    expect(words(sim.svg("key-2-0"))).toContain("1x");
  });

  it("speeds up one step per notch, finer while held, and shows what the page reports (R-SPD-1, R-SPD-6)", async () => {
    sim.rotate("dial-0", 1);
    await until(() => sim.player.s.rate === 1.25);
    await until(() => words(sim.svg("dial-0")).includes("1.25x"));
    sim.rotate("dial-0", 2, true);
    await until(() => sim.player.s.rate === 1.35);
  });

  it("nudges by 0.05 on the nudge dial (the bundled layout)", async () => {
    sim.rotate("dial-1", -3);
    await until(() => sim.player.s.rate === 1.2);
  });

  it("returns to 1x on a press without a turn (R-SPD-3)", async () => {
    sim.press("dial-0");
    await until(() => sim.player.s.rate === 1);
  });

  it("steps quality down from the level playing under Auto, then back to Auto on a press (R-QLT-1)", async () => {
    sim.rotate("dial-2", -1);
    await until(() => sim.player.s.preferred === "hd720");
    await until(() => words(sim.svg("dial-2")).includes("720p"));
    sim.press("dial-2");
    await until(() => sim.player.s.preferred === "auto");
  });

  it("writes FX speeds straight to the element and marks them EXT (R-SPD-2)", async () => {
    sim.key("key-3-1");
    await until(() => sim.player.s.rate === 8);
    await until(() => words(sim.svg("dial-0")).includes("EXT"));
    sim.key("key-0-0");
    await until(() => sim.player.s.rate === 0.1);
    sim.key("key-2-0");
    await until(() => sim.player.s.rate === 1);
  });

  it("lights a preset key while its speed plays", async () => {
    sim.key("key-3-0");
    await until(() => sim.player.s.rate === 2);
    await until(() => sim.svg("key-3-0").includes('stroke-width="6"'));
    expect(sim.svg("key-2-0")).not.toContain('stroke-width="6"');
    sim.key("key-2-0");
    await until(() => sim.player.s.rate === 1);
  });

  it("pauses and plays from the key and from a tap on the speed strip", async () => {
    sim.key("key-0-1");
    await until(() => sim.player.s.playing === false);
    await until(() => words(sim.svg("key-0-1")).includes("PAUSED"));
    sim.tap("dial-0");
    await until(() => sim.player.s.playing === true);
  });

  it("pins and unpins the tab, and the key shows it (R-TGT-2)", async () => {
    sim.key("key-1-1");
    await until(() => words(sim.svg("key-1-1")).includes("Big Buck Bu..."));
    sim.key("key-1-1");
    await until(() => words(sim.svg("key-1-1")).includes("PIN TAB"));
  });

  it("holds every change during an ad and applies it after (R-BEH-1)", async () => {
    sim.player.s.ad = true;
    sim.pageChanged();
    await until(() => words(sim.svg("dial-0")).includes("AD"));
    sim.key("key-3-0");
    await sleep(300);
    expect(sim.player.s.rate).toBe(1);
    sim.player.s.ad = false;
    sim.pageChanged();
    await until(() => sim.player.s.rate === 2);
  });

  it("applies settings the settings page changes (didReceiveSettings)", async () => {
    sim.settings("dial-1", { label: "WARP", step: 0.05, fineStep: 0.05, extended: false, hold: true });
    await until(() => words(sim.svg("dial-1")).includes("WARP"));
  });

  it("raised no alert after the extension connected", () => {
    // The only alert is the refused turn before the extension connected.
    expect(sim.alerts).toHaveLength(1);
  });

  it("stored a fresh OBS page token in the plugin-wide settings (R-LNK-2)", () => {
    expect(sim.globalSettings.obsToken).toMatch(/^[0-9a-f]{32}$/);
    expect(sim.globalSettings.port).toBe(port);
  });
});
