// SPDX-License-Identifier: GPL-2.0-or-later
// OBS 33's own T-bar slider, moved from outside OBS by the bundled FadesterNativeSlider.exe (Windows UI Automation).
// OBS ignores obs-websocket's SetTBarPosition for its visible slider (obsproject/obs-studio#11372), and its release
// reads that slider: so a throw that moves the real slider is the one that follows on screen and that OBS can take.
// The helper is the one Fadester Companion uses (tourbox/native/NativeSlider.cpp); it finds OBS by the WebSocket port.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** OBS's slider range: 0 (Program) to 1023 (Preview fully faded in). */
export const NATIVE_TBAR_MAX = 1023;

/** The helper wrote nothing: OBS is as it was (the slider moved by hand, OBS's window is closed, the helper is missing). */
export class NativeTbarRefusal extends Error {}

/** A write may or may not have reached OBS: it is never replayed, and the throw is given up. */
export class NativeTbarUncertain extends Error {}

/** Moves and reads OBS's real T-bar slider, in normalised 0..1 positions. */
export interface NativeTbar {
  /** The slider's position now. */
  read(): Promise<number>;
  /** Moves the slider from `from` (refused if it is no longer there) to `to`; equal values wait for it to park there. */
  move(from: number, to: number): Promise<number>;
  /** Ends the helper for good: a request after this is refused without starting it again. */
  close(): void;
}

export function nativeTick(position: number): number {
  if (!Number.isFinite(position) || position < 0 || position > 1) throw new RangeError("T-bar position outside 0..1");
  return Math.round(position * NATIVE_TBAR_MAX);
}

/**
 * Whether OBS's own slider can be reached from here: Windows, OBS on this computer, OBS 33. The helper still checks the
 * slider's names and range before each write and writes nothing to a slider it does not recognise.
 */
export function nativeTbarEligible(platform: string, host: string, obsVersion: string): boolean {
  const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host.trim().toLowerCase());
  return platform === "win32" && local && /^33\.\d+\.\d+(\D|$)/.test(obsVersion);
}

/** The bundled helper next to this script (bin/native/), or undefined when it is not there. */
export function bundledNativeTbarPath(): string | undefined {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), "native", "FadesterNativeSlider.exe");
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

const REPLY_TIMEOUT_MS = 3000;
const PARK_POLLS = 24;
const PARK_POLL_MS = 25;

/**
 * One helper process for one OBS WebSocket port, started on first use and ended by `close` or any failure. It stays up
 * between throws: starting it again (and a virus scan of that start) must not land on a live turn.
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
      reply = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiting = null;
          reject(new NativeTbarUncertain("The OBS slider helper did not answer."));
        }, this.replyTimeoutMs);
        this.waiting = {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); }
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
