// SPDX-License-Identifier: GPL-2.0-or-later
// Fadester Suite Setup carries the release's own number, as every other product of the suite does (the step to 1.5.0).
// Until then it was named by its build date: its file, its entry in Windows Installed apps and its wizard said a
// date where everything it installs says a version, and a second run of the workflow on a later day attached a
// second setup to the same release. The wizard cannot be built here (it needs Inno Setup and a finished Companion
// build), so these checks read the scripts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CI's Windows runner checks files out with CRLF.
const read = (rel: string): string => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("Suite Setup: its version is the release's", () => {
  it("reads the number from package.json and names the file and the setup by it, not by the date", () => {
    const build = read("installer/build-suite.ps1");
    expect(build).toContain("(Join-Path $PSScriptRoot '..\\package.json')");
    expect(build).toContain('$name = "Fadester-Suite-Setup-$suiteVersion-Windows-x64"');
    expect(build).toContain('"/DSuiteVersion=$suiteVersion"');
    expect(build).not.toContain("Get-Date");
    // A version Inno Setup and Windows can both show; anything else stops the build before a download.
    expect(build).toContain("if ($suiteVersion -notmatch '^\\d+\\.\\d+\\.\\d+$') { throw");
    expect(build.indexOf("$suiteVersion -notmatch")).toBeLessThan(build.indexOf("function Get-Pinned"));
    const script = read("installer/FadesterSuite.iss");
    expect(script).toContain("AppVersion={#SuiteVersion}");
    expect(script).toContain("AppVerName=Fadester Suite Setup {#SuiteVersion}");
  });

  it("is the tag's number: the release stops a tag that differs from package.json", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain(`pkg=$(node -p "require('./package.json').version")`);
    expect(release).toContain('[ "v$pkg" = "$GITHUB_REF_NAME" ]');
  });

  it("is found by the workflow whatever its number, and replaces itself on a second run", () => {
    const workflow = read(".github/workflows/suite-installer.yml");
    expect(workflow).toContain("Get-ChildItem setup -Filter 'Fadester-Suite-Setup-*.exe'");
    expect(workflow).toContain('gh release upload "$TAG" setup/Fadester-Suite-Setup-*.exe setup/Fadester-Suite-Setup-*.sha256 --clobber');
    expect(workflow).toContain("pick '^Fadester-Suite-Setup-.*\\.exe$'");
  });

  it("says so where the setup is described", () => {
    const readme = read("installer/README.md");
    expect(readme).toContain("Fadester-Suite-Setup-<version>-Windows-x64.exe");
    expect(readme).not.toContain("Fadester-Suite-Setup-<date>");
    expect(read("docs/START-HERE.md")).toContain("Fadester-Suite-Setup-<version>-Windows-x64.exe");
  });
});
