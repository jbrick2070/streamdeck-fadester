// SPDX-License-Identifier: GPL-2.0-or-later
// The Suite Demo Kit's collection (demo-kit/kit_collection.py, kit_obs.py) is Python; its
// unit tests are demo-kit/test_kit_collection.py, standard library only. This runs them
// inside vitest so the gate and the mutation runner see them; they are skipped, with the
// reason, only when no Python 3.10+ is on this machine. They also check the committed
// demo-kit/kit-template.json against demo-kit/kit-ids.json. No OBS is started.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const PYTHON = process.env.PYTHON ?? "python";

const probe = spawnSync(PYTHON, ["-B", "-c", "import sys; assert sys.version_info >= (3, 10)"], { encoding: "utf8" });
const pythonReady = probe.status === 0;
if (!pythonReady) {
  console.warn(`demo-kit collection tests skipped: ${PYTHON} 3.10+ not found (${probe.error?.message ?? probe.stderr})`);
}

describe("demo-kit collection (kit-ids.json, kit-template.json)", () => {
  it.skipIf(!pythonReady)("passes its Python unit tests", () => {
    const run = spawnSync(PYTHON, ["-B", join(ROOT, "demo-kit", "test_kit_collection.py")], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" }
    });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    expect(run.status, output).toBe(0);
    expect(output).toMatch(/Ran \d+ tests/);
    expect(output).not.toMatch(/skipped/);
  }, 60_000);
});
