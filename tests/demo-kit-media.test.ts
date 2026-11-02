// SPDX-License-Identifier: GPL-2.0-or-later
// The Suite Demo Kit's media builder (demo-kit/build-kit.py) is Python; its unit tests
// are demo-kit/test_build_kit.py. This runs them inside vitest so the gate and the
// mutation runner see them. They are skipped, with the reason, only when Python with
// numpy and Pillow is not on this machine (opencv went with the generated loops in kit 1.1).
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const PYTHON = process.env.PYTHON ?? "python";

const probe = spawnSync(PYTHON, ["-B", "-c", "import numpy, PIL"], { encoding: "utf8" });
const pythonReady = probe.status === 0;
if (!pythonReady) {
  console.warn(`demo-kit media tests skipped: ${PYTHON} with numpy and PIL not found (${probe.error?.message ?? probe.stderr})`);
}

describe("demo-kit build-kit.py media", () => {
  it.skipIf(!pythonReady)("passes its Python unit tests", () => {
    const run = spawnSync(PYTHON, ["-B", join(ROOT, "demo-kit", "test_build_kit.py")], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" }
    });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    // No CI: a test that skips here (no ffmpeg, fonts or stock folder) is said out loud.
    for (const reason of output.match(/^skipped: .*$/gm) ?? []) {
      console.warn(`demo-kit media tests ${reason}`);
    }
    expect(run.status, output).toBe(0);
    expect(output).toMatch(/Ran \d+ tests/);
  }, 120_000);
});
