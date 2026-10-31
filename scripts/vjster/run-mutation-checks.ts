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
  },
  {
    id: "M-V-22",
    rule: "ad hold: nothing changes while an ad plays (R-BEH-1)",
    file: "vjster-extension/src/adapter-core.ts",
    from: "    if (c.adShowing()) {",
    to: "    if (c.adShowing() && kind === undefined) {",
    tests: ["tests/vjster-ext-adapter.test.ts"]
  },
  {
    id: "M-V-23",
    rule: "two play/pause toggles during one ad cancel (R-BEH-1)",
    file: "vjster-extension/src/adapter-core.ts",
    from: 'if (kind === "transport" && this.held.get("transport")) this.held.delete("transport");',
    to: 'if (kind === undefined) this.held.delete("transport");',
    tests: ["tests/vjster-ext-adapter.test.ts"]
  },
  {
    id: "M-V-24",
    rule: "after a direct write the element really plays the asked rate (R-SPD-2)",
    file: "vjster-extension/src/adapter-core.ts",
    from: 'if (c.kind === "youtube" && c.elementRate() !== target) c.setElementRate(target);',
    to: "void target;",
    tests: ["tests/vjster-ext-adapter.test.ts"]
  },
  {
    id: "M-V-25",
    rule: "the worker takes only a plain host name from the bridge (R-LNK-5)",
    file: "vjster-extension/src/messages.ts",
    from: 'const host = typeof data.host === "string" && /^[A-Za-z0-9.-]{1,253}$/.test(data.host) ? data.host : null;',
    to: 'const host = typeof data.host === "string" ? data.host : null;',
    tests: ["tests/vjster-ext-messages.test.ts"]
  },
  {
    id: "M-V-26",
    rule: "a tab joins the registry only once its video has played (R-TGT-1)",
    file: "vjster-extension/src/router.ts",
    from: "    } else if (before || state.playing || played) {",
    to: "    } else {",
    tests: ["tests/vjster-ext-router.test.ts"]
  },
  {
    id: "M-V-27",
    rule: "reconnect backoff stops doubling at 30 s (R-LNK-3)",
    file: "vjster-extension/src/link-client.ts",
    from: "this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);",
    to: "this.backoff = this.backoff * 2;",
    tests: ["tests/vjster-ext-link.test.ts"]
  },
  {
    id: "M-V-28",
    rule: "the extension answers a malformed message with an error (R-INT-3)",
    file: "vjster-extension/src/link-client.ts",
    from: '      this.send(errorReply(result.code, result.reason, result.inReplyTo, { id: this.options.newId(), target: "browser" }));',
    to: "      void result;",
    tests: ["tests/vjster-ext-link.test.ts"]
  },
  {
    id: "M-V-29",
    rule: "titles lose control characters before they leave the page (PLAN.md 3.3)",
    file: "vjster-extension/src/page-state.ts",
    from: '.replace(CONTROL, " ")',
    to: '.replace(/~/g, " ")',
    tests: ["tests/vjster-ext-messages.test.ts"]
  },
  {
    id: "M-V-30",
    rule: "a press resets to 1x only when the dial was not turned while held (R-SPD-3)",
    file: "src/vjster/plugin/controllers.ts",
    from: "    if (!wasDown || this.turnedWhileDown) return;",
    to: "    if (!wasDown) return;",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-31",
    rule: "an answered request stops showing as pending (R-BEH-4)",
    file: "src/vjster/plugin/controllers.ts",
    from: "    else if (state && this.value.id !== null && state.inReplyTo === this.value.id) this.drop();",
    to: "    else if (state && this.value.id !== null && state.inReplyTo === this.value.id) void state;",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-32",
    rule: "dial turns are coalesced to one request per 50 ms (R-BEH-3)",
    file: "src/vjster/plugin/controllers.ts",
    from: "    this.pending.set(rate);\n    this.out.push(rate);",
    to: "    this.pending.set(rate);\n    this.pending.sentAs(this.sendNow({ type: \"speed.set\", rate, direct: this.settings.extended, hold: this.settings.hold }));",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-33",
    rule: "page titles are escaped before they are drawn (R-BEH-5)",
    file: "src/vjster/plugin/display.ts",
    from: 'ch === "<" ? "&lt;"',
    to: 'ch === "<" ? "<"',
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-34",
    rule: "settings changes reconfigure the link one after another",
    file: "src/vjster/plugin/hub.ts",
    from: "    const run = this.queue.then(() => this.applyOptions(options));",
    to: "    const run = this.applyOptions(options);",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-35",
    rule: "a dial alerts instead of sending when the extension is off (R-BEH-4)",
    file: "src/vjster/plugin/controllers.ts",
    from: '    if (blocked(view, "speed")) return this.sink.alert();',
    to: '    if (blocked(view, "speed") && view.state === undefined) return this.sink.alert();',
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-36",
    rule: "a quality preset is dimmed and refused when the video lacks its level (R-QLT-5)",
    file: "src/vjster/plugin/controllers.ts",
    from: "    return this.settings.level === AUTO || (state?.availableQualities.includes(this.settings.level) ?? false);",
    to: "    return state !== undefined;",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-37",
    rule: "bundled profiles are built byte for byte the same every time",
    file: "scripts/vjster/build-profiles.ts",
    from: "  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01",
    to: "  const DOS_DATE = (0 << 9) | (1 << 5) | 2; // 1980-01-02",
    tests: ["tests/vjster-plugin-package.test.ts"]
  },
  {
    id: "M-V-38",
    rule: "an answer counts only from the tab the intent went to (step 4 review)",
    file: "vjster-extension/src/router.ts",
    from: "    if (inReplyTo !== null && this.claim(inReplyTo, tabId)) {",
    to: "    if (inReplyTo !== null) {",
    tests: ["tests/vjster-ext-router.test.ts"]
  },
  {
    id: "M-V-39",
    rule: "a page error counts only from the tab the intent went to",
    file: "vjster-extension/src/router.ts",
    from: "    if (inReplyTo === null || !this.claim(inReplyTo, tabId)) return;",
    to: "    if (inReplyTo === null) return;",
    tests: ["tests/vjster-ext-router.test.ts"]
  },
  {
    id: "M-V-40",
    rule: "the bridge listens only to its own window, never a frame",
    file: "vjster-extension/src/bridge-core.ts",
    from: "    if (event.source !== win) return;",
    to: "    void win;",
    tests: ["tests/vjster-ext-wiring.test.ts"]
  },
  {
    id: "M-V-41",
    rule: "the worker takes page reports only from this extension's own bridge",
    file: "vjster-extension/src/worker-core.ts",
    from: "    if (sender.id !== c.runtime.id || tabId === undefined || sender.frameId !== 0) return;",
    to: "    if (tabId === undefined || sender.frameId !== 0) return;",
    tests: ["tests/vjster-ext-wiring.test.ts"]
  },
  {
    id: "M-V-42",
    rule: "intents go to a tab's top frame only",
    file: "vjster-extension/src/worker-core.ts",
    from: "        await c.tabs.sendMessage(tabId, { kind: \"intent\", intent: plainIntent(intent) }, { frameId: 0 });",
    to: "        await c.tabs.sendMessage(tabId, { kind: \"intent\", intent: plainIntent(intent) }, { frameId: 1 });",
    tests: ["tests/vjster-ext-wiring.test.ts"]
  },
  {
    id: "M-V-43",
    rule: "a page that is left says its video is gone",
    file: "vjster-extension/src/bridge-core.ts",
    from: "  win.addEventListener(\"pagehide\", () => toWorker(",
    to: "  win.addEventListener(\"pagehide-never\" as \"pagehide\", () => toWorker(",
    tests: ["tests/vjster-ext-wiring.test.ts"]
  },
  {
    id: "M-V-44",
    rule: "a return to Auto is read back (R-QLT-3)",
    file: "vjster-extension/src/adapter-core.ts",
    from: "    if (ok) this.pollQuality({ from });",
    to: "    void from;",
    tests: ["tests/vjster-ext-adapter.test.ts"]
  },
  {
    id: "M-V-45",
    rule: "a replaced connection waits the longest delay before taking the link back",
    file: "vjster-extension/src/link-client.ts",
    from: "      if (closeCode(ev) === CLOSE_REPLACED) this.backoff = MAX_BACKOFF_MS;",
    to: "      void ev;",
    tests: ["tests/vjster-ext-link.test.ts"]
  },
  {
    id: "M-V-46",
    rule: "missing quality methods lose only quality control (R-QLT-2)",
    file: "vjster-extension/src/youtube.ts",
    from: "  if (!el || !hasAll(el, CORE_METHODS)) return null;",
    to: "  if (!el || !hasAll(el, [...CORE_METHODS, ...QUALITY_METHODS])) return null;",
    tests: ["tests/vjster-ext-wiring.test.ts"]
  },
  {
    id: "M-V-47",
    rule: "the adapter listens only to its own window",
    file: "vjster-extension/src/page-wiring.ts",
    from: "    if (event.source !== win) return;",
    to: "    void win;",
    tests: ["tests/vjster-ext-wiring.test.ts"]
  },
  {
    id: "M-V-48",
    rule: "a link that opens asks every tab for fresh state",
    file: "vjster-extension/src/router.ts",
    from: "    this.deps.refreshTabs();\n    this.pushTarget(null);",
    to: "    this.pushTarget(null);",
    tests: ["tests/vjster-ext-router.test.ts", "tests/vjster-ext-link.test.ts"]
  },
  {
    id: "M-V-49",
    rule: "an unsolicited report that says nothing new is skipped",
    file: "vjster-extension/src/adapter-core.ts",
    from: "      if (text === this.lastSent) return;",
    to: "      void text;",
    tests: ["tests/vjster-ext-adapter.test.ts"]
  },
  {
    id: "M-V-50",
    rule: "the worker passes on whether a paused tab's video has played",
    file: "vjster-extension/src/worker-core.ts",
    from: "router.pageState(tabId, sender.tab?.windowId ?? -1, s, message.host, message.inReplyTo, message.played);",
    to: "router.pageState(tabId, sender.tab?.windowId ?? -1, s, message.host, message.inReplyTo, false);",
    tests: ["tests/vjster-ext-wiring.test.ts"]
  },
  {
    id: "M-V-51",
    rule: "a held level is resolved again while the list fills in after navigation (R-QLT-7)",
    file: "vjster-extension/src/adapter-core.ts",
    from: "      this.pollQuality({ held });",
    to: "      void held;",
    tests: ["tests/vjster-ext-adapter.test.ts"]
  },
  {
    id: "M-V-52",
    rule: "a buffering YouTube player counts as playing",
    file: "vjster-extension/src/youtube.ts",
    from: "const PLAYING_STATES = new Set([1, 3]);",
    to: "const PLAYING_STATES = new Set([1]);",
    tests: ["tests/vjster-ext-wiring.test.ts"]
  },
  {
    id: "M-V-53",
    rule: "a held level is not re-applied while an ad shows (R-BEH-1)",
    file: "vjster-extension/src/adapter-core.ts",
    from: "        if (level !== null && preferred !== level && !this.adShowing()) this.safely(() => c.setQuality(level));",
    to: "        if (level !== null && preferred !== level) this.safely(() => c.setQuality(level));",
    tests: ["tests/vjster-ext-adapter.test.ts"]
  },
  {
    id: "M-V-64",
    rule: "an unanswered request redraws by itself when it expires (R-BEH-4, step 5 review)",
    file: "src/vjster/plugin/controllers.ts",
    from: "      this.expired();",
    to: "      void this.expired;",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-65",
    rule: "lone surrogates never reach an SVG (step 5 review)",
    file: "src/vjster/plugin/display.ts",
    from: "      (code >= 0xd800 && code <= 0xdfff) ||",
    to: "      false ||",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-66",
    rule: "no server before the stored settings are applied",
    file: "src/vjster/plugin/hub.ts",
    from: "    return gate ? gate.then(go) : go();",
    to: "    return go();",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-67",
    rule: "a taken port is tried again (D-11)",
    file: "src/vjster/plugin/hub.ts",
    from: "    }, this.retryMs);",
    to: "    }, this.retryMs * 1000);",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-68",
    rule: "the pin key shows the pinned title (R-TGT-2)",
    file: "src/vjster/plugin/controllers.ts",
    from: "sub: pinned ? (title ? fit(title, 14) : \"PINNED\") : \"PIN TAB\",",
    to: "sub: pinned ? \"PINNED\" : \"PIN TAB\",",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-69",
    rule: "turns during an ad add up while the page holds them (R-BEH-1)",
    file: "src/vjster/plugin/controllers.ts",
    from: "    if (state?.adPlaying) {",
    to: "    if (state?.adPlaying && false) {",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-70",
    rule: "an error drops the pending value it answers",
    file: "src/vjster/plugin/controllers.ts",
    from: "    if (!this.value || id === null || this.value.id !== id) return false;",
    to: "    if (true) return false;",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-71",
    rule: "only the ad word lets a control through (step 5 review)",
    file: "src/vjster/plugin/controllers.ts",
    from: "  return w !== null && w.word !== AD_WORD;",
    to: "  return w !== null && w.word !== AD_WORD && w.word !== \"N/A\";",
    tests: ["tests/vjster-plugin-units.test.ts"]
  },
  {
    id: "M-V-72",
    rule: "a malformed pinned extension id is kept, so the server fails closed",
    file: "src/vjster/plugin/settings.ts",
    from: "    .filter((id) => id.length > 0 && id.length <= 64)",
    to: "    .filter((id) => /^[a-p]{32}$/.test(id))",
    tests: ["tests/vjster-plugin-units.test.ts"]
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
    // A Windows checkout may have CRLF line endings; match the flip the same way.
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const from = m.from.split("\n").join(eol);
    const to = m.to.split("\n").join(eol);
    const count = text.split(from).length - 1;
    if (count !== 1) {
      errors.push(`${m.id}: target found ${count} times in ${m.file}; it must be found exactly once`);
      console.log(`[ERROR]    ${m.id} target found ${count} times in ${m.file}`);
      continue;
    }
    console.log(`           ${m.id} flipping ${m.file}`);
    try {
      active = { path, original };
      writeFileSync(path, Buffer.from(text.replace(from, () => to), "utf8"));
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
