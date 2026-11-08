// SPDX-License-Identifier: GPL-2.0-or-later
import { randomUUID } from "node:crypto";
import { t } from "../i18n/strings.js";

export const MIX_NAMESPACE = "io.github.jbrick2070.fadester.mix.v1";
export type MixCommand = "mix.up" | "mix.down" | "mix.fadeOut" | "mix.restore";
export interface MixState {
  availability: "offline" | "disabled" | "ready";
  db: number | null;
}
const OFFLINE: MixState = { availability: "offline", db: null };

export function mixProblem(state: MixState): string | undefined {
  if (state.availability === "ready") return undefined;
  return t(state.availability === "disabled" ? "mixDisabled" : "mixOffline");
}

/** One observer and one correlation table for every visible mix control on the OBS connection. */
export class WholeMixClient {
  public state: MixState = OFFLINE;
  private watchers = 0;
  private poll?: ReturnType<typeof setInterval>;
  private serial = 0;
  private lastState = 0;
  private readonly pending = new Map<string, {
    reply: (ok: boolean, next: MixState) => void;
    fail: () => void;
  }>();

  public constructor(
    private readonly connected: () => boolean,
    private readonly send: (eventData: Record<string, unknown>) => Promise<unknown>,
    private readonly changed: () => void
  ) {}

  public observe(): () => void {
    if (++this.watchers === 1) {
      this.refresh();
      this.poll = setInterval(() => this.refresh(), 2500);
      this.poll.unref();
    }
    return () => {
      if (--this.watchers === 0) {
        clearInterval(this.poll);
        this.reset();
      }
    };
  }

  public refresh(): void {
    if (this.watchers && this.connected() && this.pending.size === 0) {
      void this.request("mix.status").catch(() => {});
    }
  }

  public reset(): void {
    for (const pending of this.pending.values()) pending.fail();
    this.publish(OFFLINE);
  }

  public async command(op: MixCommand, steps = 1): Promise<void> {
    // An explicit, current opt-in is required. An unknown provider only receives a status probe.
    if (!this.connected() || this.state.availability !== "ready" || this.pending.size >= 32) {
      this.refresh();
      throw new Error("Mix controller unavailable");
    }
    if (!Number.isInteger(steps) || steps < 1 || steps > 32) throw new Error("Invalid mix step count");
    await this.request(op, steps);
  }

  public receive(event: Record<string, unknown>): void {
    if (event.namespace !== MIX_NAMESPACE || event.op !== "reply" || typeof event.id !== "string" ||
        typeof event.ok !== "boolean" || typeof event.enabled !== "boolean" || typeof event.message !== "string" ||
        !(event.db === null || (typeof event.db === "number" && Number.isFinite(event.db) && event.db <= 0))) return;
    const next: MixState = !event.enabled ? { availability: "disabled", db: null }
      : event.ok ? { availability: "ready", db: event.db } : OFFLINE;
    this.pending.get(event.id)?.reply(event.ok, next);
  }

  private request(op: MixCommand | "mix.status", steps = 1): Promise<void> {
    const id = randomUUID();
    const order = ++this.serial;
    return new Promise<void>((resolve, reject) => {
      const finish = (ok: boolean, next: MixState): void => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timeout);
        if (order > this.lastState) {
          this.lastState = order;
          this.publish(next);
        }
        if (ok) resolve();
        else reject(new Error("Mix request unconfirmed"));
      };
      const fail = (): void => finish(false, OFFLINE);
      const timeout = setTimeout(fail, op === "mix.status" ? 4000 : 12000);
      this.pending.set(id, { reply: finish, fail });
      // A BroadcastCustomEvent ACK only confirms OBS delivered the envelope. Wait for the owner.
      void this.send({ namespace: MIX_NAMESPACE, id, op, sentAtMs: Date.now(),
        ...(op === "mix.up" || op === "mix.down" ? { steps } : {}) }).catch(fail);
    });
  }

  private publish(next: MixState): void {
    if (this.state.availability === next.availability && this.state.db === next.db) return;
    this.state = next;
    this.changed();
  }
}
