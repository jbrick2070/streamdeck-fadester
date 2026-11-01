// SPDX-License-Identifier: GPL-2.0-or-later
// The Suite Demo Kit's VJster speed run (demo-kit/check-kit.py, plan section 8): the real VJster
// plugin, from source, under the repo's deck simulator (scripts/vjster/deck-sim.ts) with the
// kit's "Suite Demo Kit Speed +" layout from demo-kit/kit-layouts.json, serving the real OBS
// page (built by `npx rollup -c vjster-page/rollup.config.mjs`).
//
// It prints one JSON line per event on stdout:
//   {"event":"address","address":...}  the page address for a YouTube link, as the settings page
//                                      builds it; check-kit.py points the kit's Speed Page at it
//   {"event":"connected","words":[...]} the speed dial's strip once the page in OBS reports a rate
//   {"event":"step","press":...,"want":...,"seen":...,"ok":...}  one dial turn or key press and
//                                      what the strip shows after it (the rate the page reports)
//   {"event":"done","ok":...}
// and exits. No hardware, no Stream Deck app, no Chrome: the page is the one OBS loads.
//
// Run: node --import tsx scripts/kit-speed-run.ts --video https://youtu.be/<id> [--wait-s 120]
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeckSim, PLUGIN_DIR, type Placed } from "./vjster/deck-sim.js";

const ROOT = process.cwd();
const UUID = "com.jbrick2070.vjster";

interface KitControl {
  kind: string;
  at: [number, number];
  settings: Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const words = (svg: string): string[] => [...svg.matchAll(/>([^<>]{1,60})<\/text>/g)].map((m) => m[1]);
const say = (line: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(line)}\n`);

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await sleep(50);
  }
  return true;
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

/** The kit's Speed + layout as the deck simulator places actions. */
export function kitSpeedLayout(file = join(ROOT, "demo-kit", "kit-layouts.json")): Placed[] {
  const layout = JSON.parse(readFileSync(file, "utf8")).vjster as { keys: KitControl[]; encoders: KitControl[] };
  const place = (c: KitControl, controller: "Keypad" | "Encoder"): Placed => ({
    context: controller === "Encoder" ? `dial-${c.at[0]}` : `key-${c.at[0]}-${c.at[1]}`,
    action: `${UUID}.${c.kind}`,
    controller,
    column: c.at[0],
    row: c.at[1],
    settings: c.settings
  });
  return [...layout.keys.map((k) => place(k, "Keypad")), ...layout.encoders.map((e) => place(e, "Encoder"))];
}

async function main(): Promise<boolean> {
  const video = arg("video", "");
  const waitMs = Number(arg("wait-s", "120")) * 1000;
  const pageDir = arg("page-dir", join(PLUGIN_DIR, "bin", "obs"));
  if (!video) throw new Error("--video <YouTube link> is required");
  if (!existsSync(join(pageDir, "player.html")) || !existsSync(join(pageDir, "player.js"))) {
    throw new Error(`no built OBS page in ${pageDir}: run npx rollup -c vjster-page/rollup.config.mjs`);
  }
  const sim = new DeckSim();
  await sim.start(true, await freePort(), { VJSTER_PAGE_DIR: pageDir });
  try {
    const placed = kitSpeedLayout();
    for (const p of placed) sim.appear(p);
    const dial = placed.find((p) => p.controller === "Encoder")!.context;
    const at = (kind: string, settings: Record<string, unknown>) =>
      placed.find((p) => p.action === `${UUID}.${kind}` && Object.entries(settings).every(([k, v]) => p.settings[k] === v))!.context;

    // The settings page: a pasted YouTube link becomes the page address with this computer's key.
    // Once the plugin has its stored settings and its OBS page key, its status carries an address.
    const ready = () => sim.toPage.some((m) => m.event === "status" && typeof m.address === "string" && m.address !== "");
    for (let tries = 0; !ready() && tries < 40; tries++) {
      sim.pageAppeared(dial);
      await until(ready, 500);
    }
    if (!ready()) throw new Error(`the plugin never had an OBS page address: ${JSON.stringify(sim.toPage.slice(-2))}`);
    sim.fromPage(dial, { event: "obs-address", input: video });
    if (!(await until(() => sim.toPage.some((m) => m.event === "obs-address" && m.found === true), 10000))) {
      throw new Error(`the plugin built no page address: ${JSON.stringify(sim.toPage)}`);
    }
    const address = (sim.toPage.find((m) => m.event === "obs-address" && m.found === true) as { address: string }).address;
    say({ event: "address", address });

    const strip = () => words(sim.svg(dial));
    const transport = at("transport", {});
    const rate = /^\d+(\.\d+)?x$/;
    if (!(await until(() => strip().some((w) => rate.test(w)) && !strip().includes("NO PAGE"), waitMs))) {
      say({ event: "connected", ok: false, words: strip() });
      return false;
    }
    say({ event: "connected", ok: true, words: strip(), transport: words(sim.svg(transport)) });
    await sleep(1500);

    // The key's one caption: "OBS PLAYING" or "OBS PAUSED" (controllers.ts, captionObs).
    const paused = () => words(sim.svg(transport)).some((w) => w.includes("PAUSED"));
    const playing = () => words(sim.svg(transport)).some((w) => w.includes("PLAYING"));
    // Each press, the strip word it must lead to (the rate the page in OBS reports back), and
    // for play / pause the transport key's own word.
    const steps: Array<{ press: string; want: string; act: () => void; seen?: () => boolean }> = [
      { press: "SPEED dial +1 notch", want: "1.25x", act: () => sim.rotate(dial, 1) },
      { press: "0.5x key", want: "0.5x", act: () => sim.key(at("speed-preset", { rate: 0.5 })) },
      { press: "+0.25 key", want: "0.75x", act: () => sim.key(at("speed-step", { direction: 1 })) },
      { press: "2x key", want: "2x", act: () => sim.key(at("speed-preset", { rate: 2 })) },
      { press: "-0.25 key", want: "1.75x", act: () => sim.key(at("speed-step", { direction: -1 })) },
      { press: "1x key", want: "1x", act: () => sim.key(at("speed-preset", { rate: 1 })) },
      { press: "play / pause key", want: "PAUSED", act: () => sim.key(transport), seen: paused },
      { press: "play / pause key again", want: "PLAYING", act: () => sim.key(transport), seen: playing }
    ];
    let ok = true;
    for (const step of steps) {
      step.act();
      const seen = await until(step.seen ?? (() => strip().includes(step.want)), 15000);
      ok &&= seen;
      const shown = step.seen ? words(sim.svg(transport)) : strip();
      say({ event: "step", press: step.press, want: step.want, seen: shown.join(" | "), ok: seen });
      await sleep(1500);
    }
    return ok;
  } finally {
    await sim.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
  .then((ok) => {
    say({ event: "done", ok });
    process.exit(ok ? 0 : 1);
  })
  .catch((error: unknown) => {
    say({ event: "done", ok: false, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
