// SPDX-License-Identifier: GPL-2.0-or-later
// The extension says it needs the VJster plugin and links to it: the options page's notice and links, the
// manifest's home page, and the page a first install opens.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "..", "vjster-extension");
const html = readFileSync(join(dir, "options.html"), "utf8");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
const background = readFileSync(join(dir, "src", "background.ts"), "utf8");
const REPO = "https://github.com/jbrick2070/streamdeck-fadester";

describe("the extension says it needs the VJster plugin", () => {
  it("has the notice and three links on the options page, each a project page that opens in a new tab", () => {
    expect(html).toContain('data-i18n="companionNote"');
    const links = [...html.matchAll(/<a href="([^"]+)"([^>]*)data-i18n="(link[A-Za-z]+)"/g)];
    expect(links.map((m) => m[3])).toEqual(["linkGet", "linkHelp", "linkPrivacy"]);
    for (const [, href, rest] of links) {
      expect(href.startsWith(`${REPO}/`), href).toBe(true);
      expect(rest).toContain('target="_blank"');
      expect(rest).toContain("noopener");
    }
  });

  it("names the project's home page in the manifest", () => {
    expect(manifest.homepage_url).toBe(REPO);
  });

  it("opens the options page on a first install only, not on an update", () => {
    expect(background).toMatch(/onInstalled\.addListener\(\(details\) => \{\s*if \(details\.reason === "install"\) void chrome\.runtime\.openOptionsPage\(\);\s*\}\);/);
  });
});
