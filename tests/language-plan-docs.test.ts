// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The language choice plan in the repository (PLAN.md 11.3, step L.0): the four
 * documents carry it, every requirement row once, every decision answered.
 */
const ROOT = process.cwd();
const DOCS = ["PLAN.md", "REQUIREMENTS.md", "docs/vjster/PLAN.md", "docs/vjster/REQUIREMENTS.md"];

function text(path: string): string {
  return readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
}

/** The body of the `## ` section whose heading starts with `heading`, up to the next `## `. */
function section(path: string, heading: string): string {
  const lines = text(path).split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${heading}`));
  expect(start, `${path}: no section "${heading}"`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

function rowIds(body: string, pattern: RegExp): string[] {
  return body.split("\n").flatMap((line) => {
    const match = pattern.exec(line);
    return match ? [match[1]] : [];
  });
}

const LANG_IDS = Array.from({ length: 10 }, (_, index) => `R-LANG-${index + 1}`);
const DECISION_IDS = Array.from({ length: 12 }, (_, index) => `D-L${index + 1}`);

describe("Language choice plan in the repository (PLAN.md 11, step L.0)", () => {
  it("lists R-LANG-1..10 once each in REQUIREMENTS.md 9e and docs/vjster/REQUIREMENTS.md 10b", () => {
    expect(rowIds(section("REQUIREMENTS.md", "9e."), /^\| `(R-LANG-\d+)` \|/)).toEqual(LANG_IDS);
    expect(rowIds(section("docs/vjster/REQUIREMENTS.md", "10b."), /^\| (R-LANG-\d+) \|/)).toEqual(LANG_IDS);
  });

  it("answers D-L1..12 in PLAN.md 11.6, approved 2026-11-01", () => {
    const plan = section("PLAN.md", "11.");
    const decisions = plan.slice(plan.indexOf("### 11.6"));
    expect(decisions).toContain("approved by the operator 2026-11-01");
    const rows = decisions.split("\n").filter((line) => /^\| D-L\d+ \|/.test(line));
    expect(rows.map((row) => /^\| (D-L\d+) \|/.exec(row)![1])).toEqual(DECISION_IDS);
    for (const row of rows) {
      const cells = row.split("|").map((cell) => cell.trim());
      expect(cells[3], `${cells[1]} has no answer`).toMatch(/\*\*.+\*\*/);
    }
  });

  it("places the steps L.0 to L.8 in PLAN.md 11 and VJster's part in docs/vjster/PLAN.md 9", () => {
    const plan = section("PLAN.md", "11.");
    for (let step = 0; step <= 8; step += 1) {
      expect(plan, `PLAN.md 11 lacks step L.${step}`).toContain(`**Step L.${step} --`);
    }
    const rootMutations = [
      ..."abcdefg".split("").map((letter) => `M-11.1${letter}`),
      ..."abc".split("").map((letter) => `M-11.2${letter}`),
      "M-11.4a",
    ];
    for (const mutation of rootMutations) {
      expect(plan, `PLAN.md 11 lacks ${mutation}`).toContain(mutation);
    }
    const vjster = section("docs/vjster/PLAN.md", "9.");
    expect(vjster.split("\n")[0], "VJster section 9 heading lacks the R-LANG pointer").toContain("R-LANG-1..10");
    expect(vjster, "VJster section 9 lacks step L.0").toContain("**L.0**");
    expect(vjster, "VJster section 9 lacks the L.0 as-built entry").toContain("*L.0 (2026-11-01):*");
    for (const mutation of ["M-V-90", "M-V-91", "M-V-92", "M-V-93", "M-V-94"]) {
      expect(vjster, `docs/vjster/PLAN.md 9 lacks ${mutation}`).toContain(mutation);
    }
  });

  it("keeps the four documents in UTF-8 without BOM and free of the banned word", () => {
    const bannedWord = ["dum", "my"].join("");
    for (const path of DOCS) {
      const bytes = readFileSync(join(ROOT, path));
      expect(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, `BOM in ${path}`).toBe(false);
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      expect(decoded.toLowerCase().includes(bannedWord), `banned word in ${path}`).toBe(false);
    }
  });
});
