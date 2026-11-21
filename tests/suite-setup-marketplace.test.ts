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
  it("looks for the Marketplace edition where Stream Deck keeps plugins, under the Marketplace's ID", () => {
    const version = body("MarketplaceEditionVersion");
    expect(version).toContain(`'\\Elgato\\StreamDeck\\Plugins\\${MARKETPLACE_ID}.sdPlugin'`);
    expect(version).toContain("ManifestVersion(Folder + '\\manifest.json', 'Version')");
    // a folder without a manifest is not a plugin: nothing is reported
    expect(version).toContain("if FileExists(Folder + '\\manifest.json') then");
    // the broken-guard variant switches exactly this off
    expect(version).toMatch(/#ifdef BREAK_MARKETPLACE_GUARD\n\s*Result := '';\n#endif/);
  });

  it("offers no second copy beside a Marketplace edition, and says so on the first page and in the log", () => {
    const offer = body("StreamDeckOfferWanted");
    expect(offer).toContain(`'\\Elgato\\StreamDeck\\Plugins\\${SUITE_ID}.sdPlugin\\manifest.json'`);
    const alone = offer.indexOf("if (Marketplace <> '') and not FileExists(OwnManifest) then");
    expect(alone).toBeGreaterThan(0);
    const skip = offer.slice(alone, offer.indexOf("else", alone));
    expect(skip).toContain("StreamDeckOffer := 3;");
    expect(skip).toContain("Note('MARKETPLACE-EDITION',");
    expect(skip).toContain("CustomMessage('NoteMarketplaceSd'), [Marketplace, '{#SdVersion}']");
    // only 1 means "ask Stream Deck to import"
    expect(offer).toContain("Result := StreamDeckOffer = 1;");
  });

  it("with both editions there already, handles its own copy as always and tells the person to remove one", () => {
    const offer = body("StreamDeckOfferWanted");
    const both = offer.slice(offer.indexOf("else", offer.indexOf("StreamDeckOffer := 3;")));
    expect(both).toContain("Note('BOTH-EDITIONS',");
    expect(both).toContain("CustomMessage('NoteBothSd'), [Marketplace]");
    expect(both.indexOf("Note('BOTH-EDITIONS',")).toBeLessThan(both.indexOf("NewerOnDisk('Fadester for OBS in Stream Deck', 'NoteNewerSd', OwnManifest"));
    expect(both).toContain("StreamDeckOffer := 2;");
  });

  it("repeats it on the last page instead of the newer-copy sentence", () => {
    expect(script).toContain(
      "if not StreamDeckOfferWanted() and (StreamDeckOffer = 3) then\n" +
      "      Summary := Summary + FmtMessage(CustomMessage('NoteMarketplaceSd'), [MarketplaceEditionVersion(), '{#SdVersion}']) + #13#10\n" +
      "    else if not StreamDeckOfferWanted() then"
    );
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
