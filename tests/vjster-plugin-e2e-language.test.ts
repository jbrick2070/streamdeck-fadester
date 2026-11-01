// SPDX-License-Identifier: GPL-2.0-or-later
// VJster end to end in another language (docs/vjster/PLAN.md 8.3): the real
// plugin under a pretend Stream Deck set to German draws the German deck words
// from de.json; set to a language with no file, it draws English. With the
// Language choice (PLAN.md 9, step L.3): a stored choice is drawn from the
// start without any write, a write that sets it redraws live, and a pick from
// the settings page is saved by the plugin with the port and the extension
// allow list kept.
import { createServer } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { DeckSim, livePlusLayout } from "../scripts/vjster/deck-sim.js";
import { deckStrings, readLocalization } from "../src/vjster/plugin/language.js";
import { PLUGIN_DIR } from "./vjster-languages.js";

const TOKEN = "0123456789abcdef0123456789abcdef";
const IDS = ["abcdefghijklmnopabcdefghijklmnop"];

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
async function run(language: string, sims: DeckSim[], stored: Record<string, unknown> = {}): Promise<DeckSim> {
  const sim = new DeckSim();
  sims.push(sim);
  sim.language = language;
  Object.assign(sim.globalSettings, stored);
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
    // The OBS page address carries Stream Deck's language (PLAN.md 8.6).
    sim.pageAppeared("dial-0");
    await until(() => sim.toPage.some((m) => m.event === "status"));
    const status = sim.toPage.find((m) => m.event === "status") as { address: string };
    expect(status.address).toMatch(/\/obs\?v=VIDEO_ID&hl=de#token=[0-9a-f]{32}$/);
  }, 30_000);

  it("draws English for a language that has no file", async () => {
    const sim = await run("it", sims);
    expect(words(sim.svg("dial-0"))).toEqual(expect.arrayContaining(["SPEED", "EXTENSION OFF"]));
    expect(words(sim.svg("key-1-1"))).toContain("PIN TAB");
  }, 30_000);

  it("draws a stored fixed language from the start, without any write (R-LANG-1, M-V-90, M-V-93)", async () => {
    const sim = await run("en", sims, { language: "de", obsToken: TOKEN, extensionIds: IDS });
    await until(() => words(sim.svg("key-1-1")).includes("ANHEFTEN"));
    expect(words(sim.svg("dial-0"))).toEqual(expect.arrayContaining(["TEMPO", "WEB"]));
    expect(words(sim.svg("key-0-1"))).toContain("PAUSE");
    sim.pageAppeared("key-1-1");
    await until(() => sim.toPage.some((m) => m.event === "status"));
    expect(sim.toPage.find((m) => m.event === "language")).toEqual({ event: "language", choice: "de", resolved: "de" });
    // The OBS page address keeps Stream Deck's language (D-L7).
    expect((sim.toPage.find((m) => m.event === "status") as { address: string }).address).toMatch(/&hl=en#/);
    expect(sim.globalWrites).toEqual([]);
  }, 30_000);

  it("draws Dutch for a stored nl, without any write (English where nl.json has no text yet)", async () => {
    const sim = await run("de", sims, { language: "nl", obsToken: TOKEN });
    const dutch = deckStrings("nl", (l) => readLocalization(l, PLUGIN_DIR));
    await until(() => words(sim.svg("key-1-1")).includes(dutch.pinTab));
    expect(words(sim.svg("dial-0"))).toContain(dutch.speed);
    sim.pageAppeared("key-1-1");
    await until(() => sim.toPage.some((m) => m.event === "language"));
    expect(sim.toPage.find((m) => m.event === "language")).toEqual({ event: "language", choice: "nl", resolved: "nl" });
    expect(sim.globalWrites).toEqual([]);
  }, 30_000);

  it("redraws live when the stored language changes, and saves a page's pick keeping the port and the allow list", async () => {
    const sim = await run("en", sims, { obsToken: TOKEN, extensionIds: IDS });
    const port = sim.globalSettings.port;
    expect(words(sim.svg("key-1-1"))).toContain("PIN TAB");
    // A settings page's write that sets the language and omits the port and the allow list.
    sim.saveGlobal({ obsToken: TOKEN, language: "de" });
    await until(() => words(sim.svg("key-1-1")).includes("ANHEFTEN"));
    expect(words(sim.svg("dial-2"))).toContain("QUALITÄT");
    await until(() => sim.globalWrites.length > 0);
    expect(sim.globalWrites.at(-1)).toMatchObject({ port, extensionIds: IDS, language: "de", obsToken: TOKEN });
    // A pick on the settings page: the plugin saves it and answers.
    sim.pageAppeared("key-1-1");
    sim.fromPage("key-1-1", { event: "setLanguage", choice: "fr" });
    await until(() => words(sim.svg("key-1-1")).includes("ÉPINGLER"));
    await until(() => sim.toPage.some((m) => m.event === "language" && m.choice === "fr"));
    expect(sim.toPage.filter((m) => m.event === "language").at(-1)).toEqual({ event: "language", choice: "fr", resolved: "fr" });
    expect(sim.globalWrites.at(-1)).toEqual({ port, extensionIds: IDS, language: "fr", obsToken: TOKEN });
    // A value the page does not offer saves nothing.
    const writes = sim.globalWrites.length;
    sim.fromPage("key-1-1", { event: "setLanguage", choice: "pt_BR" });
    await until(() => sim.toPage.filter((m) => m.event === "language").length >= 3);
    expect(sim.globalWrites).toHaveLength(writes);
  }, 30_000);
});
