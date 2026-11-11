// SPDX-License-Identifier: GPL-2.0-or-later
// The static plugin images and the packed plugin's OBS page (docs/vjster/PLAN.md section 9, L.6;
// R-LANG-1, R-LANG-6). Stream Deck draws the static key images inside the dial circles and in
// its action list whatever language the plugin is set to, so they carry no word; and the pack
// must hold bin/obs, which only the page build writes.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { GLYPHS, IMAGES_DIR, KEYS, renderAll } from "../scripts/vjster/make-plugin-images.js";

const ROOT = process.cwd();
const VJSTER = join(ROOT, "com.jbrick2070.vjster.sdPlugin");
const FADESTER = join(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin");

/** Every file under a folder, by path relative to it with forward slashes. */
function filesUnder(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path, base));
    else out.push(relative(base, path).replace(/\\/g, "/"));
  }
  return out.sort();
}

/**
 * The text content of every `<text>` element, with any inner tags (`<tspan>`) stripped so their
 * text is scanned too, entities decoded as far as the images use them.
 */
function textsIn(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  );
}

/** Two or more Latin letters in a row: a word (or an abbreviation), not a number such as "1x", "+0.25" or "1080p". */
const WORD = /[A-Za-z]{2,}/;

describe("the static plugin images are language-neutral (L.6)", () => {
  const imageFiles = [VJSTER, FADESTER].flatMap((plugin) =>
    filesUnder(join(plugin, "imgs")).map((rel) => ({ plugin, rel, path: join(plugin, "imgs", ...rel.split("/")) }))
  );

  it("covers both plugins' key images, icons and plugin icons", () => {
    const svgs = imageFiles.filter((f) => f.rel.endsWith(".svg"));
    expect(svgs.filter((f) => f.plugin === VJSTER && f.rel.endsWith("/key.svg"))).toHaveLength(7);
    // Fadester's eight, and the seven VJster images the suite plugin carries as copies (scripts/suite/assemble.ts).
    expect(svgs.filter((f) => f.plugin === FADESTER && f.rel.endsWith("/key.svg"))).toHaveLength(15);
    expect(imageFiles.filter((f) => f.rel.endsWith(".png")).map((f) => f.rel)).toEqual(
      expect.arrayContaining(["plugin/plugin-icon.png", "plugin/plugin-icon@2x.png"])
    );
  });

  it("puts no word in any SVG text element: a number or a symbol only (R-LANG-1)", () => {
    for (const f of imageFiles.filter((x) => x.rel.endsWith(".svg"))) {
      const svg = readFileSync(f.path, "utf8");
      // A word could also hide in a title or description, or be split over tspans; the images use none of them.
      expect(svg, relative(ROOT, f.path)).not.toMatch(/<(tspan|title|desc)\b/);
      for (const text of textsIn(svg)) expect(text, `${relative(ROOT, f.path)}: "${text}"`).not.toMatch(WORD);
    }
  });

  it("checks the plugin icons' generators draw no text (the PNG pixels themselves are not read)", () => {
    // Fadester's PNGs come from scripts/generate-plugin-icons.ts (fader tracks and caps only); VJster's from
    // vjster-extension/icons/icon.svg. This test reads those sources, not the pixels: it shows the PNGs are
    // real PNGs and that neither generator paints text, which is as far as a test can go without an OCR.
    for (const f of imageFiles.filter((x) => x.rel.endsWith(".png"))) {
      const head = readFileSync(f.path).subarray(0, 8);
      expect([...head], f.rel).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    }
    const generator = readFileSync(join(ROOT, "scripts/generate-plugin-icons.ts"), "utf8");
    expect(generator).not.toMatch(/fillText|<text|font/);
    for (const text of textsIn(readFileSync(join(ROOT, "vjster-extension/icons/icon.svg"), "utf8"))) expect(text).not.toMatch(WORD);
  });

  it("gives every VJster key spec an empty caption and a wordless main text, and every icon a drawing without text", () => {
    for (const [name, model] of Object.entries(KEYS)) {
      expect(model.sub, name).toBe("");
      expect(model.main, name).not.toMatch(WORD);
      if (model.main === "") expect(model.glyph, `${name} has neither a number nor a symbol`).toBeDefined();
    }
    for (const [name, body] of Object.entries(GLYPHS)) expect(body, name).not.toMatch(/<text/);
  });

  it("keeps the committed VJster images equal to a fresh render, so the generator is the source", () => {
    const rendered = renderAll();
    expect([...rendered.keys()].sort()).toEqual(filesUnder(IMAGES_DIR).filter((f) => f.endsWith(".svg")));
    for (const [rel, text] of rendered) {
      const committed = readFileSync(join(IMAGES_DIR, ...rel.split("/")), "utf8").replace(/\r\n/g, "\n");
      expect(committed, rel).toBe(text);
    }
  });

  it("draws the Quality dial's default image as a symbol and the play and pin keys without a caption", () => {
    const quality = readFileSync(join(IMAGES_DIR, "actions", "quality", "key.svg"), "utf8");
    expect(quality).not.toMatch(/<text/);
    expect(quality).toMatch(/<rect x="38"[^>]*stroke="#2bf0ff"/);
    for (const name of ["pin", "transport"]) {
      expect(readFileSync(join(IMAGES_DIR, "actions", name, "key.svg"), "utf8"), name).not.toMatch(/<text/);
    }
  });
});

describe("the plugin build ships the OBS page (L.6)", () => {
  const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  it("builds the page before the plugin bundle, from the one build script", () => {
    expect(scripts["build:vjster-page"]).toContain("vjster-page/rollup.config.mjs");
    const vjster = scripts["build:vjster"];
    expect(vjster).toContain("build:vjster-page");
    expect(vjster).toContain("vjster-plugin/rollup.config.mjs");
    expect(vjster.indexOf("build:vjster-page")).toBeLessThan(vjster.indexOf("vjster-plugin/rollup.config.mjs"));
    expect(scripts.build).toContain("build:vjster");
  });

  // bin/ is not committed, so a fresh checkout has no build output and this check has nothing to read. It does
  // not skip: it fails whenever any build output of either plugin exists (so after `npm run build`, which writes
  // Fadester's bin/plugin.js first) and bin/obs is missing or wrong, which is what M-V-96 would leave behind.
  // Only a tree with no build output at all passes it with nothing checked; the script check above holds there.
  it("leaves bin/obs/player.html and player.js next to the built bundle whenever anything is built", () => {
    const built = [join(VJSTER, "bin", "plugin.js"), join(FADESTER, "bin", "plugin.js")].filter((p) => existsSync(p));
    if (built.length === 0) return;
    const html = join(VJSTER, "bin", "obs", "player.html");
    const js = join(VJSTER, "bin", "obs", "player.js");
    const hint = `after a build of ${built.map((p) => relative(ROOT, p)).join(", ")}: run npm run build:vjster`;
    expect(existsSync(join(VJSTER, "bin", "plugin.js")), `bin/plugin.js is missing ${hint}`).toBe(true);
    expect(existsSync(html), `bin/obs/player.html is missing ${hint}`).toBe(true);
    expect(existsSync(js), `bin/obs/player.js is missing ${hint}`).toBe(true);
    expect(statSync(js).size).toBeGreaterThan(1000);
    expect(readFileSync(html, "utf8")).toContain("/obs/player.js");
    expect(readFileSync(html, "utf8")).toBe(readFileSync(join(ROOT, "vjster-page", "player.html"), "utf8"));
    // The bundle is the page's own code (its boot reads the #note element), not some other build's output.
    expect(readFileSync(js, "utf8")).toContain('getElementById("note")');
  });
});
