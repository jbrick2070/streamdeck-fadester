// SPDX-License-Identifier: GPL-2.0-or-later
// Fadester Suite Setup and the Elgato Marketplace edition of Fadester for OBS (PUBLISHING.md, "The Elgato Marketplace
// edition"). The Marketplace sells the same plugin under another ID, and Stream Deck holds the two IDs as two
// plugins. Setup must not add a second copy beside a Marketplace edition, and must say so when both are there
// already. The wizard cannot run here (it installs into Program Files), so these checks read the script; the real
// run is installer/tests/Test-Suite.ps1 ("marketplace-edition"), with a broken-guard variant in the workflow.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETPLACE_ID, SUITE_ID } from "../scripts/suite/package-marketplace.js";

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

describe("Suite Setup and the Elgato Marketplace edition", () => {
  it("looks for the Marketplace edition's folder where Stream Deck keeps plugins, under the Marketplace's ID", () => {
    const present = body("MarketplaceEditionPresent");
    // the folder is what counts, when something is in it: a plugin from the Marketplace can come with a manifest
    // that cannot be read, and an empty folder is not a plugin
    expect(present).toContain(`FindFirst(UserAppData() + '\\Elgato\\StreamDeck\\Plugins\\${MARKETPLACE_ID}.sdPlugin\\*', Found)`);
    expect(present).toContain("if (Found.Name <> '.') and (Found.Name <> '..') then Result := True;");
    // the broken-guard variant switches exactly this off
    expect(present).toMatch(/#ifdef BREAK_MARKETPLACE_GUARD\n\s*Result := False;\n#endif/);
    // the version is shown in brackets when it can be read, and left out when it cannot
    const brackets = body("MarketplaceEditionInBrackets");
    expect(brackets).toContain(`${MARKETPLACE_ID}.sdPlugin\\manifest.json', 'Version')`);
    expect(brackets).toContain("if Result <> '' then Result := ' (' + Result + ')';");
    for (const key of ["NoteMarketplaceSd", "NoteBothSd"]) {
      const english = new RegExp(`^${key}=(.*)$`, "m").exec(script)![1];
      // the bracket is part of %1: no space before it and no brackets around it in the sentence
      expect(english, key).toMatch(/\S%1/);
      expect(english, key).not.toContain("(%1)");
      // the version is the plugin's: never right after "Stream Deck", where it reads as Stream Deck's own
      expect(english, key).not.toContain("Stream Deck%1");
    }
  });

  it("offers no second copy beside a Marketplace edition, and says so on the first page and in the log", () => {
    const offer = body("StreamDeckOfferWanted");
    expect(offer).toContain(`'\\Elgato\\StreamDeck\\Plugins\\${SUITE_ID}.sdPlugin\\manifest.json'`);
    const alone = offer.indexOf("if MarketplaceEditionPresent() and not FileExists(OwnManifest) then");
    expect(alone).toBeGreaterThan(0);
    const skip = offer.slice(alone, offer.indexOf("else", alone));
    expect(skip).toContain("StreamDeckOffer := 3;");
    expect(skip).toContain("Note('MARKETPLACE-EDITION',");
    expect(skip).toContain("CustomMessage('NoteMarketplaceSd'), [MarketplaceEditionInBrackets(), '{#SdVersion}']");
    // only 1 means "ask Stream Deck to import"
    expect(offer).toContain("Result := StreamDeckOffer = 1;");
  });

  it("with both editions there already, handles its own copy as always and tells the person to remove one", () => {
    const offer = body("StreamDeckOfferWanted");
    const both = offer.slice(offer.indexOf("else", offer.indexOf("StreamDeckOffer := 3;")));
    expect(both).toContain("BothEditions := True;");
    expect(both).toContain("Note('BOTH-EDITIONS',");
    expect(both).toContain("CustomMessage('NoteBothSd'), [MarketplaceEditionInBrackets()]");
    expect(both.indexOf("Note('BOTH-EDITIONS',")).toBeLessThan(both.indexOf("NewerOnDisk('Fadester for OBS in Stream Deck', 'NoteNewerSd', OwnManifest"));
    expect(both).toContain("StreamDeckOffer := 2;");
  });

  it("says it again on the last page: the Marketplace sentence in place of the offer, and that there are two", () => {
    const from = script.indexOf("if WizardIsComponentSelected('streamdeck') then", script.indexOf("Summary := Summary + CustomMessage('DoneOldVs')"));
    const last = script.slice(from, script.indexOf("Log('Summary: ' + Summary);", from));
    const marketplace = last.search(/if StreamDeckOffer = 3 then\s+Summary := Summary \+ FmtMessage\(CustomMessage\('NoteMarketplaceSd'\)/);
    const newer = last.indexOf("CustomMessage('NoteNewerSd')");
    const importing = last.indexOf("CustomMessage('DoneSdImporting')");
    // the Marketplace branch comes first, so neither the newer-copy sentence nor the import follows it
    expect(marketplace).toBeGreaterThan(0);
    expect(marketplace).toBeLessThan(newer);
    expect(newer).toBeLessThan(importing);
    expect(last).toMatch(/if BothEditions then\s+Summary := Summary \+ FmtMessage\(CustomMessage\('NoteBothSd'\)/);
  });

  it("is decided before the first page is built, so the note is on it", () => {
    const first = script.indexOf("  StreamDeckOfferWanted();\n");
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(script.indexOf("CreateOutputMsgMemoPage(wpWelcome, CustomMessage('BeforeTitle')"));
  });

  it("has a real run and a broken-guard run in the workflow", () => {
    const tests = read("installer", "tests", "Test-Suite.ps1");
    expect(tests).toContain("function Test-MarketplaceEdition {");
    expect(tests).toContain("'marketplace-edition' = { Test-MarketplaceEdition }");
    expect(tests).toContain(`'${MARKETPLACE_ID}.sdPlugin'`);
    const workflow = read(".github", "workflows", "suite-installer.yml");
    expect(workflow).toContain("'OBS', 'STORE', 'DOWNGRADE', 'VJSTER', 'MARKETPLACE'");
    expect(workflow).toContain("- { test: marketplace-edition, guard: MARKETPLACE }");
  });
});
