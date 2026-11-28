// SPDX-License-Identifier: GPL-2.0-or-later
// Fadester Suite Setup and Fadester for OBS under its pre-0.10 ID. Up to 0.9.x the plugin's ID was OLD_ID, and
// Stream Deck holds the two IDs as two plugins. Setup must not add a second copy beside the older one, and must say
// so when both are there already. The wizard cannot run here (it installs into Program Files), so these checks read
// the script; the real run is installer/tests/Test-Suite.ps1 ("old-id-plugin"), with a broken-guard variant in the
// workflow.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUITE_PLUGIN_ID } from "../src/suite/actions.js";

/** Fadester for OBS's ID up to 0.9.x. */
const OLD_ID = "com.jbrick2070.fadester-for-obs";

// CI's Windows runner checks files out with CRLF.
const read = (...path: string[]): string => readFileSync(join(__dirname, "..", ...path), "utf8").replace(/\r\n/g, "\n");
const script = read("installer", "FadesterSuite.iss");
/** The body of one Pascal function or procedure of the script. */
function body(name: string): string {
  const start = script.search(new RegExp(`^(function|procedure) ${name}\\(`, "m"));
  expect(start, name).toBeGreaterThan(0);
  const end = script.indexOf("\nend;\n", start);
  return script.slice(start, end);
}

describe("Suite Setup and Fadester for OBS under its pre-0.10 ID", () => {
  it("looks for the older plugin's folder where Stream Deck keeps plugins, under the pre-0.10 ID", () => {
    const present = body("OldIdPluginPresent");
    // the folder is what counts, when something is in it: the manifest is not relied on, and an empty folder is
    // not a plugin
    expect(present).toContain(`FindFirst(UserAppData() + '\\Elgato\\StreamDeck\\Plugins\\${OLD_ID}.sdPlugin\\*', Found)`);
    expect(present).toContain("if (Found.Name <> '.') and (Found.Name <> '..') then Result := True;");
    // the broken-guard variant switches exactly this off
    expect(present).toMatch(/#ifdef BREAK_OLDID_GUARD\n\s*Result := False;\n#endif/);
    // the version is shown in brackets when it can be read, and left out when it cannot
    const brackets = body("OldIdPluginInBrackets");
    expect(brackets).toContain(`${OLD_ID}.sdPlugin\\manifest.json', 'Version')`);
    expect(brackets).toContain("if Result <> '' then Result := ' (' + Result + ')';");
    for (const key of ["NoteOldIdSd", "NoteBothSd"]) {
      const english = new RegExp(`^${key}=(.*)$`, "m").exec(script)![1];
      // the bracket is part of %1: no space before it and no brackets around it in the sentence
      expect(english, key).toMatch(/\S%1/);
      expect(english, key).not.toContain("(%1)");
      // the version is the plugin's: never right after "Stream Deck", where it reads as Stream Deck's own
      expect(english, key).not.toContain("Stream Deck%1");
      // the way out: Stream Deck's own Uninstall, where it is
      expect(english, key).toContain("Preferences > Plugins");
      expect(english, key).toContain("Uninstall");
    }
  });

  it("puts the version after the plugin or its copy in every language, never after Stream Deck", () => {
    // the 12 translations of setup's own messages (the folder also holds files for other pages)
    const languages = ["de", "es", "fr", "it", "ja", "ko", "nl", "pt-BR", "ru", "tr", "zh-CN", "zh-TW"];
    for (const code of languages) {
      const name = `${code}.isl`;
      const text = read("installer", "lang", name);
      for (const key of ["NoteOldIdSd", "NoteBothSd"]) {
        const line = new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1] ?? "";
        expect(line, `${name} ${key}`).toMatch(/\S%1/);
        expect(line, `${name} ${key}`).not.toContain("(%1)");
        expect(line, `${name} ${key}`).not.toContain("Stream Deck%1");
        expect(line, `${name} ${key}`).toContain("0.10");
      }
      // which version this setup carries
      expect(text, name).toMatch(/^NoteOldIdSd=.*%2/m);
      // the old key is gone everywhere
      expect(text, name).not.toMatch(/^NoteMarketplaceSd=/m);
    }
  });

  it("offers no second copy beside the older plugin, and says so on the first page and in the log", () => {
    const offer = body("StreamDeckOfferWanted");
    expect(offer).toContain(`'\\Elgato\\StreamDeck\\Plugins\\${SUITE_PLUGIN_ID}.sdPlugin\\manifest.json'`);
    const alone = offer.indexOf("if OldIdPluginPresent() and not FileExists(OwnManifest) then");
    expect(alone).toBeGreaterThan(0);
    const skip = offer.slice(alone, offer.indexOf("else", alone));
    expect(skip).toContain("StreamDeckOffer := 3;");
    expect(skip).toContain("Note('OLD-ID-PLUGIN',");
    expect(skip).toContain("CustomMessage('NoteOldIdSd'), [OldIdPluginInBrackets(), '{#SdVersion}']");
    // only 1 means "ask Stream Deck to import"
    expect(offer).toContain("Result := StreamDeckOffer = 1;");
  });

  it("with both IDs there already, handles its own copy as always and tells the person to uninstall the older one", () => {
    const offer = body("StreamDeckOfferWanted");
    const both = offer.slice(offer.indexOf("else", offer.indexOf("StreamDeckOffer := 3;")));
    expect(both).toContain("BothIds := True;");
    expect(both).toContain("Note('BOTH-IDS',");
    expect(both).toContain("CustomMessage('NoteBothSd'), [OldIdPluginInBrackets()]");
    expect(both.indexOf("Note('BOTH-IDS',")).toBeLessThan(both.indexOf("NewerOnDisk('Fadester for OBS in Stream Deck', 'NoteNewerSd', OwnManifest"));
    expect(both).toContain("StreamDeckOffer := 2;");
  });

  it("says it again on the last page: the older-plugin sentence in place of the offer, and that there are two", () => {
    const from = script.indexOf("if WizardIsComponentSelected('streamdeck') then", script.indexOf("Summary := Summary + CustomMessage('DoneOldVs')"));
    const last = script.slice(from, script.indexOf("Log('Summary: ' + Summary);", from));
    const oldId = last.search(/if StreamDeckOffer = 3 then\s+Summary := Summary \+ FmtMessage\(CustomMessage\('NoteOldIdSd'\)/);
    const newer = last.indexOf("CustomMessage('NoteNewerSd')");
    const importing = last.indexOf("CustomMessage('DoneSdImporting')");
    // the older-plugin branch comes first, so neither the newer-copy sentence nor the import follows it
    expect(oldId).toBeGreaterThan(0);
    expect(oldId).toBeLessThan(newer);
    expect(newer).toBeLessThan(importing);
    expect(last).toMatch(/if BothIds then\s+Summary := Summary \+ FmtMessage\(CustomMessage\('NoteBothSd'\)/);
  });

  it("is decided before the first page is built, so the note is on it", () => {
    const first = script.indexOf("  StreamDeckOfferWanted();\n");
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(script.indexOf("CreateOutputMsgMemoPage(wpWelcome, CustomMessage('BeforeTitle')"));
  });

  it("has a real run and a broken-guard run in the workflow", () => {
    const tests = read("installer", "tests", "Test-Suite.ps1");
    expect(tests).toContain("function Test-OldIdPlugin {");
    expect(tests).toContain("'old-id-plugin' = { Test-OldIdPlugin }");
    expect(tests).toContain(`'${OLD_ID}.sdPlugin'`);
    const workflow = read(".github", "workflows", "suite-installer.yml");
    expect(workflow).toContain("'OBS', 'STORE', 'DOWNGRADE', 'VJSTER', 'OLDID'");
    expect(workflow).toContain("- { test: old-id-plugin, guard: OLDID }");
    // the old names are gone from the script, its tests and the workflow
    for (const text of [script, tests, workflow]) {
      expect(text).not.toMatch(/MARKETPLACE|Marketplace/);
      expect(text).not.toContain("BOTH-EDITIONS");
    }
  });
});
