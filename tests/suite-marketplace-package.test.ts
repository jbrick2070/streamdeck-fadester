// SPDX-License-Identifier: GPL-2.0-or-later
// The Elgato Marketplace edition (scripts/suite/package-marketplace.ts): the same plugin under the ID the Marketplace
// product has had since 0.8. Staging must change the ID in every file that names it, the profiles included, leave
// every other file byte for byte, lose no file and no action, and refuse a result that still names the other ID,
// names an action the manifest lacks, or drops an action people already have keys for. Packing itself needs a
// finished build and Elgato's tool, so it is not run here.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { zip } from "../scripts/profile-checks.js";
import {
  MARKETPLACE_08_ACTIONS, MARKETPLACE_ID, SUITE_ID, actionIdsIn, filesNaming, reId, reIdBytes, reIdProfile, stageMarketplace, unzip
} from "../scripts/suite/package-marketplace.js";
import { VJSTER_KINDS } from "../src/suite/actions.js";

const SUITE_DIR = `${SUITE_ID}.sdPlugin`;
const VJSTER_ACTIONS = VJSTER_KINDS.map((kind) => `vjster-${kind}`);
const ALL_ACTIONS = [...MARKETPLACE_08_ACTIONS, ...VJSTER_ACTIONS];
const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "fadester-marketplace-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const text = (entry: { data: Buffer }): string => entry.data.toString("utf8");

/** A small plugin folder with the given actions, one profile, one picture and a log. */
function fakePlugin(actions: readonly string[], keyAction = "fader"): string {
  const dir = join(temp(), SUITE_DIR);
  mkdirSync(join(dir, "profiles"), { recursive: true });
  mkdirSync(join(dir, "logs"), { recursive: true });
  mkdirSync(join(dir, "imgs"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    UUID: SUITE_ID, Version: "1.5.0.0", Actions: actions.map((action) => ({ UUID: `${SUITE_ID}.${action}` }))
  }));
  writeFileSync(join(dir, "en.json"), JSON.stringify({ [`${SUITE_ID}.fader`]: { Name: "Fader" }, Localization: {} }));
  writeFileSync(join(dir, "profiles", "desk.streamDeckProfile"), zip([
    { path: "manifest.json", content: JSON.stringify({ Name: "Desk" }) },
    { path: "Profiles/A/manifest.json", content: JSON.stringify({ Actions: { "0,0": { UUID: `${SUITE_ID}.${keyAction}`, Plugin: { UUID: SUITE_ID } } } }) }
  ]));
  writeFileSync(join(dir, "imgs", "key.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  writeFileSync(join(dir, "logs", "plugin.0.log"), `started ${SUITE_ID}`);
  return dir;
}

describe("the Marketplace edition's ID", () => {
  it("changes every mention and nothing else", () => {
    expect(reId(`a ${SUITE_ID}.fader b ${SUITE_ID}.sdPlugin/bin c`)).toBe(`a ${MARKETPLACE_ID}.fader b ${MARKETPLACE_ID}.sdPlugin/bin c`);
    // other IDs, and the Companion's protocol name, which starts like the plugin's ID and must stay as it is
    const others = "com.jbrick2070.vjster.speed com.elgato.streamdeck.page io.github.jbrick2070.fadester.mix.v1";
    expect(reId(others)).toBe(others);
  });

  it("leaves bytes that do not name the ID untouched, and refuses to rewrite ones that are not text", () => {
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a]); // "café" in Latin-1: not valid UTF-8
    expect(reIdBytes(latin1, "notes.txt")).toBe(latin1);
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`{"UUID":"${SUITE_ID}.fader"}\r\n`, "utf8")]);
    expect(reIdBytes(bom, "a.json").equals(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`{"UUID":"${MARKETPLACE_ID}.fader"}\r\n`, "utf8")]))).toBe(true);
    const broken = Buffer.concat([Buffer.from(SUITE_ID, "utf8"), Buffer.from([0xff, 0xfe])]);
    expect(() => reIdBytes(broken, "odd.js")).toThrow(/odd\.js names .* but is not UTF-8 text/);
  });
});

describe("reading and rewriting a profile archive", () => {
  it("re-identifies a profile's actions and keeps its entries, their order and their other content", () => {
    const profile = zip([
      { path: "manifest.json", content: "{\"Name\":\"Scène\"}" },
      { path: "Profiles/A/manifest.json", content: `{"UUID":"${SUITE_ID}.obs-fader","Other":"com.elgato.streamdeck.page"}` }
    ]);
    const entries = unzip(reIdProfile(profile));
    expect(entries.map((entry) => entry.path)).toEqual(["manifest.json", "Profiles/A/manifest.json"]);
    expect(text(entries[0])).toBe("{\"Name\":\"Scène\"}");
    expect(text(entries[1])).toBe(`{"UUID":"${MARKETPLACE_ID}.obs-fader","Other":"com.elgato.streamdeck.page"}`);
  });

  it("carries an entry that is not text byte for byte", () => {
    const picture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80, 0xc3]);
    const profile = zip([
      { path: "Profiles/A/manifest.json", content: `{"UUID":"${SUITE_ID}.fader"}` },
      { path: "Profiles/A/Images/key.png", content: picture }
    ]);
    const entries = unzip(reIdProfile(profile));
    expect(entries[1].path).toBe("Profiles/A/Images/key.png");
    expect(entries[1].data.equals(picture)).toBe(true);
    expect(text(entries[0])).toContain(MARKETPLACE_ID);
  });

  it("finds the end record behind an archive comment that holds the end signature", () => {
    const archive = zip([{ path: "a.json", content: "{\"a\":1}" }]);
    const comment = Buffer.from([0x50, 0x4b, 0x05, 0x06, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    const withComment = Buffer.concat([archive, comment]);
    withComment.writeUInt16LE(comment.length, archive.length - 2);
    expect(unzip(withComment).map((entry) => [entry.path, text(entry)])).toEqual([["a.json", "{\"a\":1}"]]);
  });

  it("refuses what it does not read: no archive, ZIP64 marks, an entry that runs past the directory", () => {
    expect(() => unzip(Buffer.from("not an archive at all, just some text"))).toThrow(/Not a ZIP archive/);
    const archive = zip([{ path: "a.json", content: "{\"a\":1}" }]);
    const end = archive.length - 22;
    const zip64Count = Buffer.from(archive);
    zip64Count.writeUInt16LE(0xffff, end + 10);
    expect(() => unzip(zip64Count)).toThrow(/ZIP64/);
    const directory = archive.readUInt32LE(end + 16);
    const zip64Size = Buffer.from(archive);
    zip64Size.writeUInt32LE(0xffffffff, directory + 20);
    expect(() => unzip(zip64Size)).toThrow(/a\.json: ZIP64/);
    const tooLong = Buffer.from(archive);
    tooLong.writeUInt32LE(archive.length, directory + 20);
    expect(() => unzip(tooLong)).toThrow(/a\.json: damaged ZIP entry/);
  });
});

describe("staging the Marketplace edition", () => {
  it("stages a plugin under the Marketplace ID, profiles included, without the logs", () => {
    const source = fakePlugin([...ALL_ACTIONS, "tape-deck"]);
    writeFileSync(join(source, "notes.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9])); // Latin-1, names no ID
    const staged = stageMarketplace(source, temp());
    expect(staged.dir.endsWith(`${MARKETPLACE_ID}.sdPlugin`)).toBe(true);
    expect(staged.version).toBe("1.5.0.0");
    expect(staged.actions).toEqual([...ALL_ACTIONS, "tape-deck"]);
    expect(staged.files).toBe(5);
    expect(staged.changed.sort()).toEqual(["en.json", "manifest.json", "profiles/desk.streamDeckProfile"]);
    expect(staged.actionIdsChecked).toBe(3); // the key's action and its plugin in the profile, one language key
    expect(existsSync(join(staged.dir, "logs"))).toBe(false);
    for (const same of ["imgs/key.png", "notes.txt"]) {
      expect(readFileSync(join(staged.dir, same)).equals(readFileSync(join(source, same)))).toBe(true);
    }
    expect(filesNaming(staged.dir, SUITE_ID)).toEqual([]);
    expect(text(unzip(readFileSync(join(staged.dir, "profiles", "desk.streamDeckProfile")))[1])).toContain(`${MARKETPLACE_ID}.fader`);
  });

  it("refuses a plugin that lost an action the Marketplace's 0.8 had", () => {
    const source = fakePlugin(ALL_ACTIONS.filter((action) => action !== "obs-fade"));
    expect(() => stageMarketplace(source, temp())).toThrow(/would lose their action: obs-fade/);
  });

  it("refuses a plugin without one of the suite's VJster actions", () => {
    const source = fakePlugin(ALL_ACTIONS.filter((action) => action !== "vjster-pin"));
    expect(() => stageMarketplace(source, temp())).toThrow(/lacks the suite's VJster actions: vjster-pin/);
  });

  it("refuses a profile key whose action the manifest does not list", () => {
    const source = fakePlugin(ALL_ACTIONS, "ghost");
    expect(() => stageMarketplace(source, temp())).toThrow(/name an action the manifest does not list: .*\.ghost \(profiles\/desk\.streamDeckProfile, Profiles\/A\/manifest\.json\)/);
  });

  it("refuses built code that registers an action the manifest does not list", () => {
    const source = fakePlugin(ALL_ACTIONS);
    mkdirSync(join(source, "bin"), { recursive: true });
    writeFileSync(join(source, "bin", "fadester.js"), `const actions = [action({ UUID: "${SUITE_ID}.fader" }), action({ UUID: "${SUITE_ID}.ghost" })];\n`);
    expect(() => stageMarketplace(source, temp())).toThrow(/name an action the manifest does not list: .*\.ghost \(bin\/fadester\.js\)/);
  });

  it("counts the actions the built code registers", () => {
    const source = fakePlugin(ALL_ACTIONS);
    mkdirSync(join(source, "bin"), { recursive: true });
    writeFileSync(join(source, "bin", "fadester.js"), `const actions = [action({ UUID: "${SUITE_ID}.fader" }), action({UUID:"${SUITE_ID}.obs-fade"})];\n`);
    const staged = stageMarketplace(source, temp());
    expect(actionIdsIn(staged.dir).filter((entry) => entry.where === "bin/fadester.js").map((entry) => entry.id))
      .toEqual([`${MARKETPLACE_ID}.fader`, `${MARKETPLACE_ID}.obs-fade`]);
  });

  it("refuses a result that still names the other ID, in a file it does not rewrite", () => {
    const source = fakePlugin(ALL_ACTIONS);
    writeFileSync(join(source, "imgs", "odd.png"), Buffer.from(`\x89PNG ${SUITE_ID}`, "latin1"));
    expect(() => stageMarketplace(source, temp())).toThrow(/still name .*imgs\/odd\.png/);
  });

  it("refuses a folder that is not Fadester for OBS", () => {
    const source = fakePlugin(ALL_ACTIONS);
    writeFileSync(join(source, "manifest.json"), JSON.stringify({ UUID: "com.example.other", Actions: [] }));
    expect(() => stageMarketplace(source, temp())).toThrow(/expected the plugin/);
  });

  it("stages the real plugin folder: every action a key, a language file or the code names is one of the manifest's", () => {
    const manifest = JSON.parse(readFileSync(join(SUITE_DIR, "manifest.json"), "utf8")) as { Version: string; Actions: { UUID: string }[] };
    const staged = stageMarketplace(SUITE_DIR, temp());
    expect(staged.version).toBe(manifest.Version);
    expect(staged.actions).toEqual(manifest.Actions.map((action) => action.UUID.slice(SUITE_ID.length + 1)));
    expect(staged.actions).toEqual(expect.arrayContaining([...ALL_ACTIONS]));
    expect(filesNaming(staged.dir, SUITE_ID)).toEqual([]);

    // membership, counted again here: every whole action ID found is in the manifest, and there are many
    const known = new Set([MARKETPLACE_ID, ...staged.actions.map((action) => `${MARKETPLACE_ID}.${action}`)]);
    const named = actionIdsIn(staged.dir);
    expect(named.filter((entry) => !known.has(entry.id))).toEqual([]);
    expect(named.filter((entry) => entry.where.includes(".streamDeckProfile")).length).toBeGreaterThan(200);
    // the language files: as many action names as the folder it was made from has (counted there, by its own ID)
    const languageKeys = readdirSync(SUITE_DIR).filter((name) => /^[a-z_A-Z]+\.json$/.test(name) && name !== "manifest.json")
      .flatMap((name) => Object.keys(JSON.parse(readFileSync(join(SUITE_DIR, name), "utf8")) as object)).filter((key) => key.startsWith(SUITE_ID));
    expect(languageKeys.length).toBeGreaterThanOrEqual(staged.actions.length);
    expect(named.filter((entry) => /^[a-z_A-Z]+\.json$/.test(entry.where)).length).toBe(languageKeys.length);
    // the built code, when a build is there: the twelve actions Fadester registers itself (VJster's seven are put
    // together from the ID and a kind, and are checked by kind)
    if (existsSync(join(SUITE_DIR, "bin", "fadester.js"))) {
      const own = staged.actions.filter((action) => !action.startsWith("vjster-")).map((action) => `${MARKETPLACE_ID}.${action}`);
      const inCode = named.filter((entry) => entry.where === "bin/fadester.js").map((entry) => entry.id);
      expect([...new Set(inCode)].sort()).toEqual(own.sort());
    }

    const profiles = readdirSync(join(SUITE_DIR, "profiles")).filter((name) => name.endsWith(".streamDeckProfile"));
    expect(profiles.length).toBeGreaterThan(10);
    for (const name of profiles) {
      const before = unzip(readFileSync(join(SUITE_DIR, "profiles", name)));
      const after = unzip(readFileSync(join(staged.dir, "profiles", name)));
      expect(after.map((entry) => entry.path)).toEqual(before.map((entry) => entry.path));
      for (const [index, entry] of after.entries()) expect(text(entry)).toBe(reId(text(before[index])));
    }
    // a file that never named the ID is the same bytes in the staged folder
    const untouched = readdirSync(join(SUITE_DIR, "imgs"), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(SUITE_DIR.length + 1));
    expect(untouched.length).toBeGreaterThan(10);
    for (const file of untouched) {
      expect(readFileSync(join(staged.dir, file)).equals(readFileSync(join(SUITE_DIR, file))), file).toBe(true);
    }
    // the staged manifest still points at files that are there (settings pages, profiles)
    const stagedManifest = JSON.parse(readFileSync(join(staged.dir, "manifest.json"), "utf8")) as {
      Profiles: { Name: string }[]; Actions: { PropertyInspectorPath?: string }[];
    };
    for (const profile of stagedManifest.Profiles) expect(existsSync(join(staged.dir, `${profile.Name}.streamDeckProfile`))).toBe(true);
    for (const action of stagedManifest.Actions) {
      if (action.PropertyInspectorPath) expect(existsSync(join(staged.dir, action.PropertyInspectorPath))).toBe(true);
    }
  });
});
