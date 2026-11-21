// SPDX-License-Identifier: GPL-2.0-or-later
// The release's check that a changed component is not published under a version it already published (G-07, QA-A03).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPONENTS, checkComponents, type Git } from "../scripts/release-component-versions.mjs";

const COMPANION = "installer/components.json";
const EXTENSION = "vjster-extension/manifest.json";
const companion = (version: string): string => JSON.stringify({ components: { companion: { version } } });
const extension = (version: string): string => JSON.stringify({ version });

/** A pretend history: tags newest first, each with its two version files, and the files changed since each tag. */
function history(tags: Array<{ tag: string; companion: string; extension: string; changed?: string[] }>): Git & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    tags: () => tags.map((entry) => entry.tag),
    show: (ref, file) => {
      const entry = tags.find((candidate) => candidate.tag === ref);
      if (!entry) return null;
      return file === COMPANION ? companion(entry.companion) : file === EXTENSION ? extension(entry.extension) : null;
    },
    changed: (from, paths) => {
      asked.push(from);
      const entry = tags.find((candidate) => candidate.tag === from);
      return (entry?.changed ?? []).filter((file) => paths.some((path) => file === path || file.startsWith(`${path}/`)));
    }
  };
}
const now = (companionVersion: string, extensionVersion: string) => (file: string): string | null =>
  file === COMPANION ? companion(companionVersion) : file === EXTENSION ? extension(extensionVersion) : null;

describe("a release never repeats a component's version over changed files (QA-A03)", () => {
  it("passes a component whose files did not change since its version was first released", () => {
    const git = history([
      { tag: "v0.12.16", companion: "0.1.17", extension: "0.1.6", changed: ["src/plugin.ts", "README.md"] },
      { tag: "v0.12.14", companion: "0.1.17", extension: "0.1.6", changed: ["src/plugin.ts", "README.md"] },
      { tag: "v0.12.13", companion: "0.1.16", extension: "0.1.6", changed: ["tourbox/bridge/Program.cs"] }
    ]);
    const results = checkComponents(git, now("0.1.17", "0.1.6"));
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    // Each is compared with the release that introduced its own version, not just with the tag before.
    expect(git.asked).toEqual(["v0.12.14", "v0.12.13"]);
  });

  it("stops when tourbox/ changed and the Companion version did not, and names what to raise", () => {
    const git = history([{ tag: "v0.12.16", companion: "0.1.17", extension: "0.1.6", changed: ["tourbox/panel/PanelText.cs"] }]);
    const [companionResult, extensionResult] = checkComponents(git, now("0.1.17", "0.1.6"));
    expect(companionResult.ok).toBe(false);
    expect(companionResult.message).toContain("still 0.1.17");
    expect(companionResult.message).toContain("tourbox/panel/PanelText.cs");
    expect(companionResult.message).toContain("components.companion.version");
    expect(extensionResult.ok).toBe(true);
  });

  it("counts the VJster OBS page as part of the Companion: a change only in vjster-page/ stops it too", () => {
    const git = history([{ tag: "v0.12.16", companion: "0.1.17", extension: "0.1.6", changed: ["vjster-page/src/page-boot.ts"] }]);
    const [companionResult, extensionResult] = checkComponents(git, now("0.1.17", "0.1.6"));
    expect(companionResult.ok).toBe(false);
    expect(extensionResult.ok).toBe(true);
  });

  it("checks the VJster extension the same way, by its own version", () => {
    const git = history([{ tag: "v0.12.16", companion: "0.1.17", extension: "0.1.6", changed: ["vjster-extension/_locales/it/messages.json"] }]);
    const [companionResult, extensionResult] = checkComponents(git, now("0.1.17", "0.1.6"));
    expect(companionResult.ok).toBe(true);
    expect(extensionResult.ok).toBe(false);
    expect(extensionResult.message).toContain("vjster-extension/manifest.json");
  });

  it("passes every component whose version was raised, whatever changed: the step that raises all versions", () => {
    const git = history([{
      tag: "v0.12.16", companion: "0.1.17", extension: "0.1.6",
      changed: ["tourbox/panel/PanelText.cs", "vjster-page/src/page-boot.ts", "vjster-extension/src/worker-core.ts"]
    }]);
    expect(checkComponents(git, now("1.5.0", "1.5.0")).map((result) => result.ok)).toEqual([true, true]);
    // Raising only one leaves the other stopped.
    expect(checkComponents(git, now("1.5.0", "0.1.6")).map((result) => result.ok)).toEqual([true, false]);
  });

  it("passes with no earlier release, and stops when a version cannot be read", () => {
    expect(checkComponents(history([]), now("0.1.17", "0.1.6")).map((result) => result.ok)).toEqual([true, true]);
    expect(checkComponents(history([]), () => null).map((result) => result.ok)).toEqual([false, false]);
  });

  it("reads the versions this repository has now, and the release workflow runs it before the Companion is built", () => {
    for (const component of COMPONENTS) {
      const version = component.read(JSON.parse(readFileSync(component.versionFile, "utf8")));
      expect(typeof version === "string" && version.length > 0, component.name).toBe(true);
    }
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    expect(workflow).toContain("node scripts/release-component-versions.mjs");
    expect(workflow).toMatch(/fetch-depth: 0/);
    expect(readFileSync("PUBLISHING.md", "utf8")).toContain("## Version numbers at a release");
  });
});
