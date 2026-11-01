// SPDX-License-Identifier: GPL-2.0-or-later
// VJster end to end in another language (docs/vjster/PLAN.md 8.3): the real
// plugin under a pretend Stream Deck set to German draws the German deck words
// from de.json; set to a language with no file, it draws English.
import { createServer } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
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

/** Start the plugin in `language`; `sims` holds the sim before it starts, so afterAll stops it even if the start fails. */
async function run(language: string, sims: DeckSim[]): Promise<DeckSim> {
  const sim = new DeckSim();
  sims.push(sim);
  sim.language = language;
  await sim.start(true, await freePort());
  for (const p of livePlusLayout()) sim.appear(p);
  await until(() => sim.images.size === 12);
  return sim;
}

describe("VJster plugin end to end, in another language", () => {
  const sims: DeckSim[] = [];
  afterAll(async () => {
    for (const s of sims) await s.stop();
  });

  it("draws German from de.json, profile labels included (R-I18N-1, R-I18N-2)", async () => {
    const sim = await run("de", sims);
    expect(words(sim.svg("dial-0"))).toEqual(expect.arrayContaining(["TEMPO", "WEB", "ERWEITERUNG AUS"]));
    expect(words(sim.svg("dial-1"))).toContain("FEIN");
    expect(words(sim.svg("dial-2"))).toContain("QUALITÄT");
    expect(words(sim.svg("dial-3"))).toContain("FX-TEMPO");
    expect(words(sim.svg("key-0-1"))).toContain("PAUSE");
    expect(words(sim.svg("key-1-1"))).toContain("ANHEFTEN");
    expect(words(sim.svg("key-2-1"))).toEqual(expect.arrayContaining(["AUTO", "QUALITÄT"]));
  }, 30_000);

  it("draws English for a language that has no file", async () => {
    const sim = await run("it", sims);
    expect(words(sim.svg("dial-0"))).toEqual(expect.arrayContaining(["SPEED", "EXTENSION OFF"]));
    expect(words(sim.svg("key-1-1"))).toContain("PIN TAB");
  }, 30_000);
});
