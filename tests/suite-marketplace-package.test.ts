// SPDX-License-Identifier: GPL-2.0-or-later
// The Elgato Marketplace edition (scripts/suite/package-marketplace.ts): the same plugin under the ID the Marketplace
// product has had since 0.8. Staging must change the ID in every file that names it, the profiles included, lose no
// file and no action, and refuse a result that still names the other ID or drops an action people already have keys
// for. Packing itself needs a finished build and Elgato's tool, so it is not run here.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { zip } from "../scripts/profile-checks.js";
import {
  MARKETPLACE_08_ACTIONS, MARKETPLACE_ID, SUITE_ID, filesNaming, reId, reIdProfile, stageMarketplace, unzip
} from "../scripts/suite/package-marketplace.js";

const SUITE_DIR = `${SUITE_ID}.sdPlugin`;
const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "fadester-marketplace-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A small plugin folder with the given actions, one profile, one picture and a log. */
function fakePlugin(actions: readonly string[]): string {
  const dir = join(temp(), SUITE_DIR);
  mkdirSync(join(dir, "profiles"), { recursive: true });
  mkdirSync(join(dir, "logs"), { recursive: true });
  mkdirSync(join(dir, "imgs"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    UUID: SUITE_ID, Version: "1.5.0.0", Actions: actions.map((action) => ({ UUID: `${SUITE_ID}.${action}` }))
  }));
  writeFileSync(join(dir, "profiles", "desk.streamDeckProfile"), zip([
    { path: "manifest.json", content: JSON.stringify({ Name: "Desk" }) },
    { path: "Profiles/A/manifest.json", content: JSON.stringify({ Actions: { "0,0": { UUID: `${SUITE_ID}.fader` } } }) }
  ]));
  writeFileSync(join(dir, "imgs", "key.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  writeFileSync(join(dir, "logs", "plugin.0.log"), `started ${SUITE_ID}`);
  return dir;
}

describe("the Marketplace edition's ID", () => {
  it("changes every mention and nothing else", () => {
    expect(reId(`a ${SUITE_ID}.fader b ${SUITE_ID}.sdPlugin/bin c`)).toBe(`a ${MARKETPLACE_ID}.fader b ${MARKETPLACE_ID}.sdPlugin/bin c`);
    expect(reId("com.jbrick2070.vjster.speed and com.elgato.streamdeck.page")).toBe("com.jbrick2070.vjster.speed and com.elgato.streamdeck.page");
  });

  it("re-identifies a profile's actions and keeps its entries, their order and their other content", () => {
    const profile = zip([
      { path: "manifest.json", content: "{\"Name\":\"Scène\"}" },
      { path: "Profiles/A/manifest.json", content: `{"UUID":"${SUITE_ID}.obs-fader","Other":"com.elgato.streamdeck.page"}` }
    ]);
    const entries = unzip(reIdProfile(profile));
    expect(entries.map((entry) => entry.path)).toEqual(["manifest.json", "Profiles/A/manifest.json"]);
    expect(entries[0].content).toBe("{\"Name\":\"Scène\"}");
    expect(entries[1].content).toBe(`{"UUID":"${MARKETPLACE_ID}.obs-fader","Other":"com.elgato.streamdeck.page"}`);
  });
});

describe("staging the Marketplace edition", () => {
  it("stages a plugin under the Marketplace ID, profiles included, without the logs", () => {
    const source = fakePlugin([...MARKETPLACE_08_ACTIONS, "tape-deck"]);
    const staged = stageMarketplace(source, temp());
    expect(staged.dir.endsWith(`${MARKETPLACE_ID}.sdPlugin`)).toBe(true);
    expect(staged.version).toBe("1.5.0.0");
    expect(staged.actions).toEqual([...MARKETPLACE_08_ACTIONS, "tape-deck"]);
    expect(staged.files).toBe(3);
    expect(staged.changed.sort()).toEqual(["manifest.json", "profiles/desk.streamDeckProfile"]);
    expect(existsSync(join(staged.dir, "logs"))).toBe(false);
    expect(readFileSync(join(staged.dir, "imgs", "key.png")).equals(readFileSync(join(source, "imgs", "key.png")))).toBe(true);
    expect(filesNaming(staged.dir, SUITE_ID)).toEqual([]);
    const profile = unzip(readFileSync(join(staged.dir, "profiles", "desk.streamDeckProfile")));
    expect(profile[1].content).toContain(`${MARKETPLACE_ID}.fader`);
  });

  it("refuses a plugin that lost an action the Marketplace's 0.8 had", () => {
    const source = fakePlugin(MARKETPLACE_08_ACTIONS.filter((action) => action !== "fader"));
    expect(() => stageMarketplace(source, temp())).toThrow(/would lose their action: fader/);
  });

  it("refuses a result that still names the other ID, in a file it does not rewrite", () => {
    const source = fakePlugin(MARKETPLACE_08_ACTIONS);
    writeFileSync(join(source, "imgs", "odd.png"), Buffer.from(`\x89PNG ${SUITE_ID}`, "latin1"));
    expect(() => stageMarketplace(source, temp())).toThrow(/still name .*imgs\/odd\.png/);
  });

  it("refuses a folder that is not Fadester for OBS", () => {
    const source = fakePlugin(MARKETPLACE_08_ACTIONS);
    writeFileSync(join(source, "manifest.json"), JSON.stringify({ UUID: "com.example.other", Actions: [] }));
    expect(() => stageMarketplace(source, temp())).toThrow(/expected the plugin/);
  });

  it("stages the real plugin folder: the same actions, every profile re-identified, nothing left of the other ID", () => {
    const manifest = JSON.parse(readFileSync(join(SUITE_DIR, "manifest.json"), "utf8")) as { Version: string; Actions: { UUID: string }[] };
    const staged = stageMarketplace(SUITE_DIR, temp());
    expect(staged.version).toBe(manifest.Version);
    expect(staged.actions).toEqual(manifest.Actions.map((action) => action.UUID.slice(SUITE_ID.length + 1)));
    expect(staged.actions).toEqual(expect.arrayContaining([...MARKETPLACE_08_ACTIONS]));
    expect(filesNaming(staged.dir, SUITE_ID)).toEqual([]);

    const profiles = readdirSync(join(SUITE_DIR, "profiles")).filter((name) => name.endsWith(".streamDeckProfile"));
    expect(profiles.length).toBeGreaterThan(10);
    let actions = 0;
    for (const name of profiles) {
      const before = unzip(readFileSync(join(SUITE_DIR, "profiles", name)));
      const after = unzip(readFileSync(join(staged.dir, "profiles", name)));
      expect(after.map((entry) => entry.path)).toEqual(before.map((entry) => entry.path));
      for (const [index, entry] of after.entries()) {
        expect(entry.content).toBe(reId(before[index].content));
        actions += entry.content.split(`${MARKETPLACE_ID}.`).length - 1;
      }
    }
    expect(actions).toBeGreaterThan(50);
    // the staged manifest still points at files that are there (icons, settings pages, layouts, profiles)
    const stagedManifest = JSON.parse(readFileSync(join(staged.dir, "manifest.json"), "utf8")) as {
      Profiles: { Name: string }[]; Actions: { PropertyInspectorPath?: string }[];
    };
    for (const profile of stagedManifest.Profiles) expect(existsSync(join(staged.dir, `${profile.Name}.streamDeckProfile`))).toBe(true);
    for (const action of stagedManifest.Actions) {
      if (action.PropertyInspectorPath) expect(existsSync(join(staged.dir, action.PropertyInspectorPath))).toBe(true);
    }
  });
});
