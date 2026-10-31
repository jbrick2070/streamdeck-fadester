// SPDX-License-Identifier: GPL-2.0-or-later
// The VJster mutation runner's flips stay valid (docs/vjster/REQUIREMENTS.md R-TST-4).
// A flip whose target text no longer appears exactly once, or whose test filter
// names no file, would make the runner report an error; this catches it in the
// normal suite, before anyone runs the mutations.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MUTATIONS } from "../scripts/vjster/run-mutation-checks.js";

const ROOT = process.cwd();

describe("VJster mutation flips", () => {
  it("have unique ids", () => {
    expect(new Set(MUTATIONS.map((m) => m.id)).size).toBe(MUTATIONS.length);
  });

  for (const m of MUTATIONS) {
    it(`${m.id} targets text that appears exactly once and names test files that exist`, () => {
      const text = readFileSync(resolve(ROOT, m.file), "utf8");
      // Match line endings the way the runner does, so a CRLF checkout is checked the same.
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      expect(text.split(m.from.split("\n").join(eol)).length - 1).toBe(1);
      expect(m.to).not.toBe(m.from);
      for (const t of m.tests) expect(existsSync(resolve(ROOT, t)), t).toBe(true);
    });
  }
});
