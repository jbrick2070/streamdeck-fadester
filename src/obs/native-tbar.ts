// SPDX-License-Identifier: GPL-2.0-or-later
// OBS 33's own T-bar slider on Windows, moved in-process from a dedicated COM MTA worker thread via UI Automation
// (NativeTbarUia, docs/TBAR-WINDOWS-INPLUGIN-DESIGN.md). OBS ignores obs-websocket's SetTBarPosition for its visible
// slider (obsproject/obs-studio#11372), and its release reads that slider: so a throw that moves the real slider is the
// one that follows on screen and that OBS can finish or cancel cleanly with a single release.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { UiaRefusalReason } from "./uia/uia-slider.js";
import type { UiaWorkerCallReply, UiaWorkerMessage, UiaWorkerRequest } from "./uia/uia-worker.js";

/** OBS's slider range: 0 (Program) to 1023 (Preview fully faded in). */
export const NATIVE_TBAR_MAX = 1023;
/** Per-call UI Automation worker deadline on the main thread (~80 ms, docs/TBAR-WINDOWS-INPLUGIN-DESIGN.md §3.2). */
export const UIA_CALL_TIMEOUT_MS = 80;
/** Initial worker thread + koffi load budget before the first call is raced at UIA_CALL_TIMEOUT_MS. */
export const UIA_BOOT_TIMEOUT_MS = 1500;
/** Maximum wait for a busy-tainted worker's late reply before reconciliation gives up on UIA. */
export const UIA_TAINT_DRAIN_MS = 1200;

/** Nothing was written: OBS is as it was (slider moved by hand, OBS window closed/minimised, or OBS running as admin). */
export class NativeTbarRefusal extends Error {
  public constructor(message: string, public readonly reason: UiaRefusalReason = "refused") {
    super(message);
  }
}

/** The UIA backend itself could not load (missing addon or COM UIA2 unavailable); nothing was written. */
export class NativeTbarUnavailable extends NativeTbarRefusal {
  public constructor(message: string) {
    super(message, "unavailable");
  }
}

/** A write may or may not have reached OBS: it is never replayed, and the throw reconciles via read(). */
export class NativeTbarUncertain extends Error {}

/** The backend did not answer within its deadline: uncertain until the late reply arrives and a fresh read succeeds. */
export class NativeTbarTimeout extends NativeTbarUncertain {}

/** Moves and reads OBS's real T-bar slider, in normalised 0..1 positions. */
export interface NativeTbar {
  /** The slider's position now. */
  read(): Promise<number>;
  /** Moves the slider from `from` (refused if it is no longer there) to `to`; equal values wait for it to park there. */
  move(from: number, to: number): Promise<number>;
  /** Drops cached UIA element handles (for example when Studio Mode toggles and OBS rebuilds its T-bar). */
  invalidate?(): void;
  /** Ends the backend for good: a request after this is refused without starting it again. */
  close(): void;
}

export function nativeTick(position: number): number {
  if (!Number.isFinite(position) || position < 0 || position > 1) throw new RangeError("T-bar position outside 0..1");
  return Math.round(position * NATIVE_TBAR_MAX);
}

/** Why OBS's own slider cannot be reached from here: not Windows, OBS on another computer, an OBS other than 33. */
export type NativeTbarBlocker = "notWindows" | "remote" | "version";

/** What keeps OBS's own slider out of reach, or undefined when the backend can try it. */
export function nativeTbarBlocker(platform: string, host: string, obsVersion: string): NativeTbarBlocker | undefined {
  if (platform !== "win32") return "notWindows";
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host.trim().toLowerCase())) return "remote";
  if (!/^33\.\d+\.\d+(\D|$)/.test(obsVersion)) return "version";
  return undefined;
}

/**
 * Whether OBS's own slider can be reached from here: Windows, OBS on this computer, OBS 33. The backend still checks
 * the slider's names, orientation and range before each write and writes nothing to a slider it does not recognise.
 */
export function nativeTbarEligible(platform: string, host: string, obsVersion: string): boolean {
  return nativeTbarBlocker(platform, host, obsVersion) === undefined;
}

/** The bundled worker script next to bin/fadester.js, or undefined when running unbuilt source. */
export function bundledUiaWorkerPath(): string | undefined {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), "uia-worker.js");
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Resolves the built worker script either next to the bundle or in the repo's .sdPlugin/bin directory. */
export function builtUiaWorkerPath(): string | undefined {
  const adjacent = bundledUiaWorkerPath();
  if (adjacent) return adjacent;
  try {
    const repoBuilt = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../io.github.jbrick2070.fadester-for-obs.sdPlugin/bin/uia-worker.js"
    );
    return existsSync(repoBuilt) ? repoBuilt : undefined;
  } catch {
    return undefined;
  }
}

/** Legacy helper lookup kept only for compatibility; FadesterNativeSlider.exe is no longer bundled or used by default. */
export function bundledNativeTbarPath(): string | undefined {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), "native", "FadesterNativeSlider.exe");
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Minimal worker surface used by NativeTbarUia so fake workers can exercise timeouts and taint on any OS. */
export interface UiaWorkerLike {
  postMessage(message: UiaWorkerRequest): void;
  on(event: "message", listener: (message: UiaWorkerMessage) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

export interface NativeTbarUiaOptions {
  workerPath?: string;
  workerFactory?: (port: number) => UiaWorkerLike;
  callTimeoutMs?: number;
  bootTimeoutMs?: number;
  taintDrainMs?: number;
}

const REPLY_TIMEOUT_MS = 3000;
const PARK_POLLS = 24;
const PARK_POLL_MS = 25;

interface InFlightCall {
  seq: number;
  generation: number;
  op: UiaWorkerRequest["op"];
  timedOut: boolean;
  resolve: (reply: UiaWorkerCallReply) => void;
  reject: (error: Error) => void;
  idlePromise: Promise<void>;
  markIdle: () => void;
}

/**
 * In-plugin Windows UI Automation backend (Route B). Keeps one COM MTA worker thread per OBS connection, enforces an
 * ~80 ms per-call deadline, and quarantines a timed-out call as busy-tainted until its late reply arrives and a fresh
 * read() confirms the slider's position. Never terminates the worker mid-COM-call.
 */
export class NativeTbarUia implements NativeTbar {
  private readonly callTimeoutMs: number;
  private readonly bootTimeoutMs: number;
  private readonly taintDrainMs: number;
  private readonly createWorker: (port: number) => UiaWorkerLike;
  private worker: UiaWorkerLike | null = null;
  private bootPromise: Promise<void> | null = null;
  private bootFailure: Error | null = null;
  private inFlight: InFlightCall | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private generation = 1;
  private tainted = false;
  private pendingForget = false;
  private retired = false;

  public constructor(
    private readonly port: number,
    options: NativeTbarUiaOptions = {}
  ) {
    this.callTimeoutMs = options.callTimeoutMs ?? UIA_CALL_TIMEOUT_MS;
    this.bootTimeoutMs = options.bootTimeoutMs ?? UIA_BOOT_TIMEOUT_MS;
    this.taintDrainMs = options.taintDrainMs ?? UIA_TAINT_DRAIN_MS;
    if (options.workerFactory) {
      this.createWorker = options.workerFactory;
    } else {
      const script = options.workerPath ?? builtUiaWorkerPath();
      this.createWorker = (targetPort: number) => {
        if (!script) throw new NativeTbarUnavailable("The in-plugin T-bar UIA worker is not built.");
        return new Worker(script, { workerData: { port: targetPort } });
      };
    }
  }

  public read(): Promise<number> {
    return this.serial(async () => {
      if (this.retired) throw new NativeTbarRefusal("The OBS T-bar UIA backend was closed.");
      await this.drainBusyWorker();
      await this.flushPendingForget();
      const tick = await this.dispatch("read");
      this.tainted = false;
      return tick / NATIVE_TBAR_MAX;
    });
  }

  public async move(from: number, to: number): Promise<number> {
    const expected = nativeTick(from);
    const desired = nativeTick(to);
    if (expected === desired) {
      // OBS parks its slider asynchronously after a release: wait for it without writing.
      for (let attempt = 0; attempt < PARK_POLLS; attempt++) {
        if (nativeTick(await this.read()) === desired) return to;
        await new Promise((resolve) => setTimeout(resolve, PARK_POLL_MS));
      }
      throw new NativeTbarUncertain("OBS did not park its T-bar where expected.");
    }
    return this.serial(async () => {
      if (this.retired) throw new NativeTbarRefusal("The OBS T-bar UIA backend was closed.");
      if (this.tainted || this.inFlight) {
        throw new NativeTbarUncertain("Prior T-bar UIA call is unconfirmed; read first.");
      }
      await this.flushPendingForget();
      const actual = await this.dispatch("move", expected, desired);
      if (actual !== desired) {
        this.tainted = true;
        throw new NativeTbarUncertain("OBS did not confirm the new T-bar position.");
      }
      return actual / NATIVE_TBAR_MAX;
    });
  }

  public invalidate(): void {
    if (this.retired) return;
    this.generation++;
    if (this.worker) this.pendingForget = true;
  }

  public close(): void {
    if (this.retired) return;
    this.retired = true;
    this.generation++;
    this.pendingForget = false;
    const active = this.inFlight;
    if (active && !active.timedOut) {
      active.reject(new NativeTbarUncertain("The OBS T-bar UIA backend closed."));
    }
    const worker = this.worker;
    if (!worker) return;
    const finishShutdown = (): void => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.bootPromise = null;
      try {
        worker.postMessage({ seq: ++this.seq, generation: this.generation, op: "close" });
      } catch {
        // worker already closed
      }
      setTimeout(() => {
        void worker.terminate().catch(() => undefined);
      }, 60).unref?.();
    };
    if (active) {
      const fallback = setTimeout(finishShutdown, Math.min(this.taintDrainMs, 600));
      fallback.unref?.();
      void active.idlePromise.then(() => {
        clearTimeout(fallback);
        finishShutdown();
      });
    } else {
      finishShutdown();
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async ensureWorker(): Promise<UiaWorkerLike> {
    if (this.retired) throw new NativeTbarRefusal("The OBS T-bar UIA backend was closed.");
    if (this.bootFailure) throw this.bootFailure;
    if (!this.worker || !this.bootPromise) {
      let worker: UiaWorkerLike;
      try {
        worker = this.createWorker(this.port);
      } catch (error) {
        const failure = error instanceof NativeTbarUnavailable
          ? error
          : new NativeTbarUnavailable(error instanceof Error ? error.message : String(error));
        this.bootFailure = failure;
        throw failure;
      }
      this.worker = worker;
      const boot = new Promise<void>((resolveBoot, rejectBoot) => {
        let settled = false;

        worker.on("message", (message: UiaWorkerMessage) => {
          if ("ready" in message) {
            if (settled) return;
            settled = true;
            if (message.ready) {
              resolveBoot();
            } else {
              const err = new NativeTbarUnavailable(message.message);
              this.bootFailure = err;
              if (this.worker === worker) {
                this.worker = null;
                this.bootPromise = null;
              }
              rejectBoot(err);
            }
            return;
          }
          this.handleReply(worker, message);
        });

        const onLost = (why: string): void => {
          if (this.worker === worker) {
            this.worker = null;
            this.bootPromise = null;
          }
          if (!settled) {
            settled = true;
            const err = new NativeTbarUnavailable(why);
            this.bootFailure = err;
            rejectBoot(err);
            return;
          }
          const active = this.inFlight;
          if (active) {
            this.inFlight = null;
            this.tainted = true;
            active.markIdle();
            if (!active.timedOut) {
              active.reject(new NativeTbarUncertain(why));
            }
          }
        };

        worker.on("error", (err: Error) => onLost(`T-bar UIA worker error: ${err.message}`));
        worker.on("exit", (code: number) => onLost(`T-bar UIA worker exited (${code})`));
      });
      boot.catch(() => {});
      this.bootPromise = boot;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.bootPromise,
        new Promise<never>((_, rejectTimeout) => {
          timer = setTimeout(
            () => rejectTimeout(new NativeTbarTimeout("The T-bar UIA worker did not finish starting in time.")),
            this.bootTimeoutMs
          );
          timer.unref?.();
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (this.bootFailure) throw this.bootFailure;
    if (!this.worker) throw new NativeTbarUnavailable("The T-bar UIA worker exited during startup.");
    return this.worker;
  }

  private handleReply(worker: UiaWorkerLike, reply: UiaWorkerCallReply): void {
    if (this.worker !== worker) return;
    const active = this.inFlight;
    if (!active || reply.seq !== active.seq) return; // drop stale or unsolicited replies
    this.inFlight = null;
    active.markIdle();
    if (active.timedOut) return; // late reply arrived: worker is free again, but taint stays until read()
    if (reply.generation !== this.generation) {
      this.pendingForget = true;
      if (active.op === "move") {
        this.tainted = true;
        active.reject(new NativeTbarUncertain("T-bar UIA generation changed during move."));
      } else {
        active.reject(new NativeTbarRefusal("T-bar UIA generation changed during call."));
      }
      return;
    }
    active.resolve(reply);
  }

  private async drainBusyWorker(): Promise<void> {
    const active = this.inFlight;
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      active.idlePromise.then(() => true),
      new Promise<boolean>((resolveDrain) => {
        timer = setTimeout(() => resolveDrain(false), this.taintDrainMs);
        timer.unref?.();
      })
    ]);
    if (timer) clearTimeout(timer);
    if (!drained || this.inFlight) {
      throw new NativeTbarTimeout("The busy-tainted T-bar UIA worker is still blocked.");
    }
  }

  private async flushPendingForget(): Promise<void> {
    if (!this.pendingForget || !this.worker || this.inFlight) return;
    this.pendingForget = false;
    try {
      await this.dispatch("forget");
    } catch (error) {
      if (!(error instanceof NativeTbarTimeout)) {
        this.pendingForget = true;
      }
      throw error;
    }
  }

  private async dispatch(op: "read" | "move" | "forget", expected?: number, desired?: number): Promise<number> {
    const worker = await this.ensureWorker();
    if (this.retired) throw new NativeTbarRefusal("The OBS T-bar UIA backend was closed.");
    if (this.inFlight) throw new NativeTbarUncertain("Another T-bar UIA call is still in flight.");

    const seq = ++this.seq;
    const generation = this.generation;
    let markIdle!: () => void;
    const idlePromise = new Promise<void>((resolveIdle) => {
      markIdle = resolveIdle;
    });

    const reply = await new Promise<UiaWorkerCallReply>((resolveReply, rejectReply) => {
      const timer = setTimeout(() => {
        if (this.inFlight?.seq === seq) {
          this.inFlight.timedOut = true;
          this.tainted = true;
        }
        rejectReply(new NativeTbarTimeout("The OBS T-bar UIA call timed out."));
      }, this.callTimeoutMs);
      timer.unref?.();

      this.inFlight = {
        seq,
        generation,
        op,
        timedOut: false,
        idlePromise,
        markIdle,
        resolve: (res) => {
          clearTimeout(timer);
          resolveReply(res);
        },
        reject: (err) => {
          clearTimeout(timer);
          rejectReply(err);
        }
      };

      worker.postMessage({ seq, generation, op, expected, desired });
    });

    if (reply.status === "ok") {
      if (!(reply.value >= 0 && reply.value <= NATIVE_TBAR_MAX)) {
        this.tainted = true;
        throw new NativeTbarUncertain("Unexpected slider value from T-bar UIA worker.");
      }
      return reply.value;
    }
    if (reply.status === "refusal") {
      if (reply.reason === "unavailable") throw new NativeTbarUnavailable(reply.message);
      throw new NativeTbarRefusal(reply.message, reply.reason);
    }
    this.tainted = true;
    throw new NativeTbarUncertain(reply.message);
  }
}

/**
 * Default in-plugin T-bar backend for local Windows OBS 33.x: loads koffi + COM IUIAutomation2 on a dedicated worker
 * thread when built for Windows x64 or arm64; undefined elsewhere.
 */
export function defaultNativeTbar(port: number): NativeTbar | undefined {
  if (process.platform !== "win32" || (process.arch !== "x64" && process.arch !== "arm64")) return undefined;
  const workerPath = bundledUiaWorkerPath();
  return workerPath ? new NativeTbarUia(port, { workerPath }) : undefined;
}

/**
 * Legacy out-of-process helper driver kept for stand-in protocol tests; FadesterNativeSlider.exe is not bundled.
 */
export class NativeTbarHelper implements NativeTbar {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private waiting: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private retired = false;

  /** `prefix` goes before the helper's own arguments (tests run a stand-in script under Node). */
  public constructor(
    private readonly exe: string,
    private readonly port: number,
    private readonly prefix: string[] = [],
    private readonly replyTimeoutMs = REPLY_TIMEOUT_MS
  ) {}

  public read(): Promise<number> {
    return this.serial(() => this.request("READ")).then((tick) => tick / NATIVE_TBAR_MAX);
  }

  public async move(from: number, to: number): Promise<number> {
    const expected = nativeTick(from);
    const next = nativeTick(to);
    if (expected === next) {
      // OBS parks its slider asynchronously after a release: wait for it, never pull a hand's slider back.
      for (let attempt = 0; attempt < PARK_POLLS; attempt++) {
        if (nativeTick(await this.read()) === next) return to;
        await new Promise((resolve) => setTimeout(resolve, PARK_POLL_MS));
      }
      throw new NativeTbarUncertain("OBS did not park its T-bar where expected.");
    }
    const actual = await this.serial(() => this.request(`${expected} ${next}`));
    if (actual !== next) throw new NativeTbarUncertain("OBS did not confirm the new T-bar position.");
    return actual / NATIVE_TBAR_MAX;
  }

  public close(): void {
    this.retired = true; // a request still queued must not start a helper nobody will close
    this.reset();
  }

  /** Lets the running helper go; the next request starts a fresh one. */
  private reset(): void {
    const child = this.child;
    this.child = null;
    this.buffer = "";
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.reject(new NativeTbarUncertain("The OBS slider helper closed."));
    if (child) {
      child.stdin.end();
      if (child.exitCode === null) setTimeout(() => { if (child.exitCode === null) child.kill(); }, 200).unref();
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null) return this.child;
    this.buffer = ""; // nothing a helper that exited left half-written belongs to the next one
    const child = spawn(this.exe, [...this.prefix, "--port", String(this.port)], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      // A helper closed after a timeout can still answer late: its line must never confirm the next helper's request.
      if (this.child !== child) return;
      this.buffer += chunk;
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, "");
        this.buffer = this.buffer.slice(newline + 1);
        const waiting = this.waiting;
        this.waiting = null;
        waiting?.resolve(line);
      }
    });
    child.stderr.resume();
    const lost = (): void => {
      if (this.child !== child) return;
      this.child = null;
      const waiting = this.waiting;
      this.waiting = null;
      waiting?.reject(new NativeTbarUncertain("Lost the OBS slider helper."));
    };
    child.on("exit", lost);
    child.on("error", lost);
    child.stdin.on("error", lost); // a write to a helper that already exited
    this.child = child;
    return child;
  }

  private async request(line: string): Promise<number> {
    if (this.retired) throw new NativeTbarRefusal("The OBS slider helper was closed.");
    let reply: string;
    try {
      const child = this.start();
      reply = await new Promise<string>((resolveLine, rejectLine) => {
        const timer = setTimeout(() => {
          this.waiting = null;
          rejectLine(new NativeTbarTimeout("The OBS slider helper did not answer."));
        }, this.replyTimeoutMs);
        this.waiting = {
          resolve: (value) => { clearTimeout(timer); resolveLine(value); },
          reject: (error) => { clearTimeout(timer); rejectLine(error); }
        };
        child.stdin.write(`${line}\n`);
      });
    } catch (error) {
      this.reset(); // A write that timed out may still land: never send it again on this helper.
      throw error instanceof Error ? error : new NativeTbarUncertain(String(error));
    }
    if (reply.startsWith("ERR ")) {
      const why = reply.slice(4);
      // The helper says when a write may have landed; any other refusal wrote nothing.
      if (why.startsWith("write unconfirmed") || why.startsWith("prior write unconfirmed")) {
        this.reset();
        throw new NativeTbarUncertain(why);
      }
      throw new NativeTbarRefusal(why);
    }
    const match = /^OK (\d+)$/.exec(reply);
    const value = match ? Number(match[1]) : NaN;
    if (!(value >= 0 && value <= NATIVE_TBAR_MAX)) {
      this.reset();
      throw new NativeTbarUncertain("Unexpected reply from the OBS slider helper.");
    }
    return value;
  }
}
