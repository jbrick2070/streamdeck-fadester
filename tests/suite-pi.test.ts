// SPDX-License-Identifier: GPL-2.0-or-later
// VJster's settings page inside the suite plugin (docs/SUITE.md): it knows its action ids by the suite's names, reads its own
// part of the stored global settings, and never writes the stored object: it asks the plugin to save its part.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPage } from "./helpers/vjster-pi-dom.js";

const ROOT = join(import.meta.dirname, "..");
const SUITE_ACTION = "io.github.jbrick2070.fadester-for-obs.vjster-speed";

/** The page's Save button, after the operator typed a port. */
function savePort(page: ReturnType<typeof loadPage>, port: string): void {
  page.byId("port").value = port;
  for (const listener of page.byId("port").listeners.input ?? []) listener({});
  for (const listener of page.byId("save-global").listeners.click ?? []) listener({});
}

describe("VJster's settings page in the suite", () => {
  it("asks the plugin to save its part, and writes nothing to the stored object", () => {
    const page = loadPage("en", "speed", {}, { suite: true });
    // The host sends the whole stored object: Fadester's keys at the top, VJster's under vjster.
    page.fromDeck({ event: "didReceiveGlobalSettings", payload: { settings: { host: "127.0.0.1", port: 4455, password: "secret", vjster: { port: 48160, obsAlwaysOn: true } } } });
    page.toPage({ event: "status", port: 48160, browser: "extension-off", extensionIds: [], badIds: 0, obsPage: true, obs: "page-off", obsAlwaysOn: true });
    savePort(page, "48161");
    expect(page.sent.filter((m) => m.event === "setGlobalSettings")).toEqual([]);
    const save = page.sent.filter((m) => m.event === "sendToPlugin" && (m.payload as { event?: string }).event === "suiteGlobal");
    expect(save).toHaveLength(1);
    expect(save[0]).toMatchObject({ action: SUITE_ACTION, context: "ctx" });
    const settings = (save[0].payload as { settings: Record<string, unknown> }).settings;
    expect(settings.port).toBe(48161);
    expect(settings.obsAlwaysOn).toBe(true);
    // Nothing of Fadester's reaches VJster's part, and the language is never part of a page's save.
    expect(Object.keys(settings)).not.toEqual(expect.arrayContaining(["host"]));
    expect(settings).not.toHaveProperty("password");
    expect(settings).not.toHaveProperty("language");
  });

  it("sends its other messages under the suite's action id", () => {
    const page = loadPage("en", "speed", {}, { suite: true });
    page.sent.length = 0;
    page.toPage({ event: "status", port: 48150, browser: "extension-off", extensionIds: [], badIds: 0, obsPage: true, obs: "page-off", obsAlwaysOn: false });
    page.byId("obs-video").value = "https://example.test/watch?v=abcdefghijk";
    for (const listener of page.byId("obs-video").listeners.input ?? []) listener({ target: page.byId("obs-video") });
    const actions = new Set(page.sent.filter((m) => m.event === "sendToPlugin").map((m) => m.action));
    expect([...actions]).toEqual([SUITE_ACTION]);
  });

  it("still writes the stored object itself when it runs as the standalone plugin", () => {
    const page = loadPage("en", "speed", {});
    page.fromDeck({ event: "didReceiveGlobalSettings", payload: { settings: { port: 48160 } } });
    page.toPage({ event: "status", port: 48160, browser: "extension-off", extensionIds: [], badIds: 0, obsPage: true, obs: "page-off", obsAlwaysOn: false });
    savePort(page, "48161");
    expect(page.sent.filter((m) => m.event === "setGlobalSettings")).toHaveLength(1);
    expect(page.sent.filter((m) => m.event === "sendToPlugin" && (m.payload as { event?: string }).event === "suiteGlobal")).toEqual([]);
  });

  it("is the same page file the standalone plugin has, with the suite's script ahead of it", () => {
    const page = readFileSync(join(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin", "ui", "vjster", "vjster.html"), "utf8");
    expect(page.indexOf('<script src="suite.js"></script>')).toBeGreaterThan(0);
    expect(page.indexOf('<script src="suite.js"></script>')).toBeLessThan(page.indexOf('<script src="vjster.js"></script>'));
    expect(readFileSync(join(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin", "ui", "vjster", "suite.js"), "utf8")).toContain('prefix: "io.github.jbrick2070.fadester-for-obs.vjster-"');
  });
});
