// SPDX-License-Identifier: GPL-2.0-or-later
// VJster mutation checks (docs/vjster/REQUIREMENTS.md R-TST-4).
//
// Each check flips one named rule in VJster's code and expects an assertion in
// the named test files to fail. A flip counts as killed only then. It is an
// error, not a kill, when a test filter matches no file, when a flipped file
// stops a test file from loading, or when vitest does not finish in time. A
// flip the tests do not notice "survives". Every check runs, so one survivor
// does not hide the next, and the run fails if any check survived or erred.
//
// The flipped file is put back byte for byte in a finally block, and also on
// Ctrl+C or a normal exit. Only a hard kill (Task Manager, SIGKILL) can leave
// it flipped; the runner prints the file it is about to flip, and in the
// worktree it runs in, `git checkout -- <file>` restores it.
//
// The runner rewrites tracked files, so it refuses to run anywhere but a
// linked git worktree (`git worktree add`), never in the shared checkout that
// may hold someone else's work (R-HOME-5). `--here` overrides that on purpose.
//
//   node --import tsx scripts/vjster/run-mutation-checks.ts [--here] [--list]

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VITEST = resolve(ROOT, "node_modules/vitest/vitest.mjs");
const ALL_VJSTER_TESTS = ["tests/vjster-"];
const VITEST_TIMEOUT_MS = 180_000;

interface Mutation {
  readonly id: string;
  /** The rule the flip breaks, with the requirement it serves. */
  readonly rule: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** Test file filters; an assertion in one of the files they match must fail. */
  readonly tests: readonly string[];
}

export const MUTATIONS: readonly Mutation[] = [
  {
    id: "M-V-1",
    rule: "clamp bound: rates never go below the range minimum (R-SPD-2)",
    file: "src/vjster/shared/speed.ts",
    from: "Math.min(range.maxT, Math.max(range.minT, t))",
    to: "Math.min(range.maxT, t)",
    tests: ["tests/vjster-speed.test.ts"]
  },
  {
    id: "M-V-2",
    rule: "snap grid: rates live on the player's 0.05 grid (R-SPD-1, F-10)",
    file: "src/vjster/shared/speed.ts",
    from: "const PER_X = 20;",
    to: "const PER_X = 10;",
    tests: ["tests/vjster-speed.test.ts"]
  },
  {
    id: "M-V-3",
    rule: "step grid: a turn goes to the next grid point in its direction (R-SPD-1)",
    file: "src/vjster/shared/speed.ts",
    from: "(Math.floor((curT - GRID_ANCHOR_T) / stepT) + 1)",
    to: "(Math.round((curT - GRID_ANCHOR_T) / stepT) + 1)",
    tests: ["tests/vjster-speed.test.ts"]
  },
  {
    id: "M-V-4",
    rule: "coalescing: the last value of a burst is the one sent (R-BEH-3)",
    file: "src/vjster/shared/coalesce.ts",
    from: "      waiting = { value };",
    to: "      if (!waiting) waiting = { value };",
    tests: ["tests/vjster-coalesce.test.ts"]
  },
  {
    id: "M-V-5",
    rule: "pin: a pin on a tab that is gone is ignored (R-TGT-2)",
    file: "src/vjster/shared/target.ts",
    from: "if (ctx.pinnedTabId !== null && tabs.some((t) => t.tabId === ctx.pinnedTabId)) return ctx.pinnedTabId;",
    to: "if (ctx.pinnedTabId !== null) return ctx.pinnedTabId;",
    tests: ["tests/vjster-target.test.ts"]
  },
  {
    id: "M-V-6",
    rule: "quality stops at both ends of the list (R-QLT-1)",
    file: "src/vjster/shared/quality.ts",
    from: "Math.min(cycle.length - 1, Math.max(0, at - ticks))",
    to: "Math.max(0, at - ticks)",
    tests: ["tests/vjster-quality.test.ts"]
  },
  {
    id: "M-V-7",
    rule: "a state report's host is a host name, never a URL (R-LNK-5)",
    file: "src/vjster/shared/protocol.ts",
    from: "const HOST_PATTERN = /^[A-Za-z0-9.-]{1,253}$/;",
    to: "const HOST_PATTERN = /^.{1,253}$/;",
    tests: ["tests/vjster-protocol.test.ts"]
  },
  {
    id: "M-V-8",
    rule: "unknown fields are dropped (R-INT-3)",
    file: "src/vjster/shared/protocol.ts",
    from: "      return { ...env, type };",
    to: "      return { ...raw, ...env, type } as Intent;",
    tests: ["tests/vjster-protocol.test.ts"]
  },
  {
    id: "M-V-9",
    rule: "origin check: only a Chrome extension may connect without a token (R-LNK-2)",
    file: "src/vjster/plugin/link-server.ts",
    from: 'if (!match) return { ok: false, reason: "origin" };',
    to: 'if (!match) return { ok: true, target: "browser" };',
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-10",
    rule: "Host check: the Host header must name the server itself (R-LNK-2, DNS rebinding)",
    file: "src/vjster/plugin/link-server.ts",
    from: 'if (host !== `${LINK_HOST}:${port}` && host !== `localhost:${port}`) return { ok: false, reason: "host" };',
    to: 'void host;',
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-11",
    rule: "token check: the OBS page must present the exact token (R-LNK-2)",
    file: "src/vjster/plugin/link-server.ts",
    from: 'const same = timingSafeEqual(Buffer.from(token, "utf8"), Buffer.from(obsToken, "utf8"));',
    to: "const same = true;",
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-12",
    rule: "latest wins: a newer connection closes the older one (R-LNK-4)",
    file: "src/vjster/plugin/link-server.ts",
    from: '      previous.socket.close(CLOSE_REPLACED, "replaced by a newer connection");',
    to: "      void previous;",
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-13",
    rule: "keepalive: a peer silent past the idle timeout is closed (R-LNK-3)",
    file: "src/vjster/plugin/link-server.ts",
    from: "if (now - peer.lastHeardAt > this.idleTimeoutMs) {",
    to: "if (now - peer.lastHeardAt > this.idleTimeoutMs * 1000) {",
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-14",
    rule: "a report must carry the target of the connection it came on (PLAN.md 3.3)",
    file: "src/vjster/plugin/link-server.ts",
    from: "if (!result.ok || result.message.target !== peer.target) {",
    to: "if (!result.ok) {",
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-15",
    rule: "the server stops only after the stop delay, so a page switch keeps the link (R-LNK-1)",
    file: "src/vjster/plugin/link-server.ts",
    from: "    }, this.stopDelayMs);",
    to: "    }, 0);",
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-16",
    rule: "a replaced or closed connection no longer speaks for its target (step 3 review)",
    file: "src/vjster/plugin/link-server.ts",
    from: "    if (this.peers.get(peer.target) !== peer) return;",
    to: "    void 0;",
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-17",
    rule: "a dropped report is re-asked at most once per 2 s (PLAN.md 3.3)",
    file: "src/vjster/plugin/link-server.ts",
    from: "      if (now - peer.lastReaskAt >= REASK_MIN_MS) {",
    to: "      if (now >= 0) {",
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-18",
    rule: "stop reports every live connection gone (R-BEH-4)",
    file: "src/vjster/plugin/link-server.ts",
    from: '      peer.socket.close(CLOSE_SHUTDOWN, "server stopping");\n      this.emit({ type: "disconnected", target: peer.target });',
    to: '      peer.socket.close(CLOSE_SHUTDOWN, "server stopping");',
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-19",
    rule: "two Host headers are refused (R-LNK-2)",
    file: "src/vjster/plugin/link-server.ts",
    from: 'if (hostHeaders !== 1) return this.refuse("host", socket);',
    to: "void hostHeaders;",
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-20",
    rule: "refusals are logged at most once per 10 s (step 3 review)",
    file: "src/vjster/plugin/link-server.ts",
    from: "if (now - this.lastRefusalLogAt >= REFUSAL_LOG_MS) {",
    to: "if (now >= 0) {",
    tests: ["tests/vjster-link-server.test.ts"]
  },
  {
    id: "M-V-21",
    rule: "a throwing listener is logged without its text (R-BEH-5)",
    file: "src/vjster/plugin/link-server.ts",
    from: "      } catch {\n        // The exception's text could carry page content (R-BEH-5): log a fixed line.",
    to: "      } catch (e) {\n        this.log.warn(String(e));",
    tests: ["tests/vjster-link-server.test.ts"]
  }
];

interface AssertionResult {
  status: string;
}
interface FileResult {
  name: string;
  status: string;
  message?: string;
  assertionResults?: AssertionResult[];
}

type Outcome =
  | { kind: "passed" }
  | { kind: "failed-assertion" }
  | { kind: "error"; reason: string };

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const norm = (p: string): string => resolve(ROOT, p).replace(/\\/g, "/").toLowerCase();

function inLinkedWorktree(): boolean {
  return norm(git(["rev-parse", "--absolute-git-dir"])) !== norm(git(["rev-parse", "--git-common-dir"]));
}

/** Run vitest on the filters and read its JSON report. */
function vitest(filters: readonly string[]): Outcome {
  const dir = mkdtempSync(join(tmpdir(), "vjster-mutation-"));
  const report = join(dir, "report.json");
  try {
    const res = spawnSync(process.execPath, [VITEST, "run", "--reporter=json", `--outputFile=${report}`, ...filters], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: VITEST_TIMEOUT_MS,
      env: { ...process.env, FORCE_COLOR: "0" }
    });
    if (res.error) return { kind: "error", reason: `vitest did not finish: ${res.error.message}` };
    if (!existsSync(report)) return { kind: "error", reason: `vitest wrote no report (exit ${res.status})` };
    const files: FileResult[] = JSON.parse(readFileSync(report, "utf8")).testResults ?? [];
    for (const filter of filters) {
      if (!files.some((f) => norm(f.name).includes(filter.toLowerCase()))) {
        return { kind: "error", reason: `the filter ${filter} matched no test file` };
      }
    }
    const notLoaded = files.filter((f) => f.status === "failed" && (f.assertionResults ?? []).length === 0);
    if (notLoaded.length > 0) {
      return { kind: "error", reason: `a test file failed to load: ${notLoaded.map((f) => f.name).join(", ")}` };
    }
    const failed = files.some((f) => (f.assertionResults ?? []).some((a) => a.status === "failed"));
    if (failed) return { kind: "failed-assertion" };
    if (res.status !== 0) return { kind: "error", reason: `vitest exited ${res.status} with no failed assertion` };
    return { kind: "passed" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The file currently flipped, so a signal or exit can put it back. */
let active: { path: string; original: Buffer } | null = null;

function restoreActive(): void {
  if (active) {
    writeFileSync(active.path, active.original);
    active = null;
  }
}

function main(): number {
  const args = new Set(process.argv.slice(2));
  if (args.has("--list")) {
    for (const m of MUTATIONS) console.log(`${m.id}  ${m.rule}  [${m.file}]`);
    return 0;
  }
  if (!args.has("--here") && !inLinkedWorktree()) {
    console.error("Refusing to run: this is not a linked git worktree, and the runner rewrites tracked files.");
    console.error("Run it in a `git worktree add` copy, or pass --here if this checkout holds no one else's work.");
    return 2;
  }

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      restoreActive();
      process.exit(130);
    });
  }
  process.on("exit", restoreActive);

  console.log("=== VJster mutation checks ===");
  const baseline = vitest(ALL_VJSTER_TESTS);
  if (baseline.kind !== "passed") {
    console.error(`The VJster tests do not pass before any flip; fix them first (${baseline.kind === "error" ? baseline.reason : "an assertion failed"}).`);
    return 2;
  }

  let killed = 0;
  const survivors: string[] = [];
  const errors: string[] = [];
  for (const m of MUTATIONS) {
    const path = resolve(ROOT, m.file);
    const original = readFileSync(path);
    const text = original.toString("utf8");
    const count = text.split(m.from).length - 1;
    if (count !== 1) {
      errors.push(`${m.id}: target found ${count} times in ${m.file}; it must be found exactly once`);
      console.log(`[ERROR]    ${m.id} target found ${count} times in ${m.file}`);
      continue;
    }
    console.log(`           ${m.id} flipping ${m.file}`);
    try {
      active = { path, original };
      writeFileSync(path, Buffer.from(text.replace(m.from, m.to), "utf8"));
      const outcome = vitest(m.tests);
      if (outcome.kind === "failed-assertion") {
        killed++;
        console.log(`[KILLED]   ${m.id} (${m.rule})`);
      } else if (outcome.kind === "passed") {
        survivors.push(m.id);
        console.log(`[SURVIVED] ${m.id} (${m.rule}): ${m.tests.join(", ")} still pass`);
      } else {
        errors.push(`${m.id}: ${outcome.reason}`);
        console.log(`[ERROR]    ${m.id}: ${outcome.reason}`);
      }
    } finally {
      restoreActive();
      if (!readFileSync(path).equals(original)) errors.push(`${m.id}: ${m.file} was not restored byte for byte`);
    }
  }

  const after = vitest(ALL_VJSTER_TESTS);
  if (after.kind !== "passed") errors.push(`the VJster tests fail after the run, so a restore went wrong (${after.kind})`);

  console.log(`=== ${killed} killed, ${survivors.length} survived, ${errors.length} errors ===`);
  for (const e of errors) console.error(`ERROR: ${e}`);
  return survivors.length === 0 && errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
