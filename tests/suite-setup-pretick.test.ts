// SPDX-License-Identifier: GPL-2.0-or-later
// Fadester Suite Setup ticks its components from what the PC has (UI review U3-07): OBS Studio, a Stream Deck app or
// OpenDeck, TourBox Console or a game controller. The rule that matters most: it never changes a choice that is
// already made. The wizard itself cannot run here (it installs into Program Files), so these checks read the script;
// installer/README.md lists the hand test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CI's Windows runner checks files out with CRLF.
const script = readFileSync(join(__dirname, "..", "installer", "FadesterSuite.iss"), "utf8").replace(/\r\n/g, "\n");
/** The body of one Pascal function or procedure of the script. */
function body(name: string): string {
  const start = script.search(new RegExp(`^(function|procedure) ${name}\\(`, "m"));
  expect(start, name).toBeGreaterThan(0);
  const end = script.indexOf("\nend;\n", start);
  return script.slice(start, end);
}

describe("Suite Setup: components start ticked from what this PC has", () => {
  it("leaves a choice that is already made alone", () => {
    const made = body("ChoiceAlreadyMade");
    for (const sign of ["WizardSilent()", "'/COMPONENTS='", "'/TYPE='", "'/LOADINF='", "InstalledVersion('{#SuiteAppId}')"]) expect(made).toContain(sign);
    const pretick = body("PretickFromThisPc");
    // The first thing it does, before any component is touched.
    expect(pretick.indexOf("if ChoiceAlreadyMade() then")).toBeGreaterThan(0);
    expect(pretick.indexOf("if ChoiceAlreadyMade() then")).toBeLessThan(pretick.indexOf("WizardSelectComponents"));
  });

  it("only ever unticks, names every unticked part on the first page, and keeps everything when nothing was found", () => {
    const pretick = body("PretickFromThisPc");
    const selections = [...pretick.matchAll(/WizardSelectComponents\('([^']*)'\)/g)].map((m) => m[1]);
    expect(selections).toEqual(["!obs\\mf,!obs\\pl,!obs", "!streamdeck", "!companion", "!vjsterext"]);
    for (const message of ["NoteNoObs", "NoteNoDeck", "NoteNoController"]) expect(pretick).toContain(`CustomMessage('${message}')`);
    expect(pretick).toContain("if not (HasObs or HasDeck or HasController) then Exit;");
    expect(pretick.indexOf("if not (HasObs or HasDeck or HasController) then Exit;")).toBeLessThan(pretick.indexOf("WizardSelectComponents"));
  });

  it("counts a part of the suite that is already installed as found, so an update is never unticked", () => {
    const pretick = body("PretickFromThisPc");
    expect(pretick).toMatch(/HasObs := ObsPresent\(\) or \(InstalledVersion\('\{#MfAppId\}'\) <> ''\) or \(InstalledVersion\('\{#PlAppId\}'\) <> ''\);/);
    expect(pretick).toMatch(/HasController := TourBoxConsolePresent\(\) or GamepadConnected\(\) or \(InstalledVersion\('\{#CoAppId\}'\) <> ''\);/);
  });

  it("looks before the other first-page checks, and a missing XInput cannot stop setup", () => {
    const wizard = body("InitializeWizard");
    expect(wizard.indexOf("PretickFromThisPc();")).toBeGreaterThan(0);
    expect(wizard.indexOf("PretickFromThisPc();")).toBeLessThan(wizard.indexOf("NewerInstalled("));
    expect(script).toContain("external 'XInputGetState@xinput1_4.dll stdcall delayload';");
    expect(body("GamepadConnected")).toMatch(/try[\s\S]*except[\s\S]*Result := False;/);
  });
});
