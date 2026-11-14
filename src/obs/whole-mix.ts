// SPDX-License-Identifier: GPL-2.0-or-later
import { randomUUID } from "node:crypto";
import { t } from "../i18n/strings.js";

export const MIX_NAMESPACE = "io.github.jbrick2070.fadester.mix.v1";
export type MixCommand = "mix.up" | "mix.down" | "mix.fadeOut" | "mix.restore";
export interface MixProviderIdentity {
  id: string;
  name: string;
  version: string;
}
export interface MixState {
  availability: "offline" | "disabled" | "conflict" | "ready";
  db: number | null;
}
const OFFLINE: MixState = { availability: "offline", db: null };
const CONFLICT: MixState = { availability: "conflict", db: null };
const REPIN_SETTLE_MS = 250;
const LEGACY_PROVIDER_KEY = "__legacy__";

export function mixProblem(state: MixState): string | undefined {
  if (state.availability === "ready") return undefined;
  if (state.availability === "conflict") return t("mixConflict");
  return t(state.availability === "disabled" ? "mixDisabled" : "mixOffline");
}

function parseProvider(raw: unknown): MixProviderIdentity | null | "invalid" {
  if (raw === undefined) return null;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "invalid";
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.version !== "string") {
    return "invalid";
  }
  const id = record.id.trim();
  const name = record.name.trim();
  const version = record.version.trim();
  if (!id || !name || !version) return "invalid";
  return { id, name, version };
}

/** One observer and one correlation table for every visible mix control on the OBS connection. */
export class WholeMixClient {
  public state: MixState = OFFLINE;
  private watchers = 0;
  private poll?: ReturnType<typeof setInterval>;
  private serial = 0;
  private lastState = 0;
  private pinnedProviderId: string | null = null;
  private conflict = false;
  private readonly sentIds = new Map<string, Set<string>>();
  private readonly pending = new Map<string, {
    op: MixCommand | "mix.status";
    reply: (ok: boolean, next: MixState) => void;
    settle: (ok: boolean, next: MixState, providerId: string | null) => void;
    fail: () => void;
    conflict: () => void;
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
    this.pinnedProviderId = null;
    this.conflict = false;
    this.sentIds.clear();
    for (const pending of this.pending.values()) pending.fail();
    this.publish(OFFLINE);
  }

  public async command(op: MixCommand, steps = 1): Promise<void> {
    if (this.conflict || this.state.availability === "conflict") {
      throw new Error(t("mixConflict"));
    }
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
    const provider = parseProvider(event.provider);
    if (provider === "invalid") return;
    const responders = this.sentIds.get(event.id);
    if (!responders) return;
    responders.add(provider ? provider.id : LEGACY_PROVIDER_KEY);
    if (responders.size >= 2) {
      this.latchConflict();
      return;
    }
    const inflight = this.pending.get(event.id);
    if (!inflight) return;
    const next: MixState = !event.enabled ? { availability: "disabled", db: null }
      : event.ok ? { availability: "ready", db: event.db } : OFFLINE;
    const mismatch = provider !== null && this.pinnedProviderId !== null && provider.id !== this.pinnedProviderId;
    if (inflight.op !== "mix.status") {
      if (this.conflict || mismatch) {
        this.latchConflict();
        return;
      }
      if (provider !== null && this.pinnedProviderId === null) {
        this.pinnedProviderId = provider.id;
      }
      inflight.reply(event.ok, next);
      return;
    }
    if (this.conflict || mismatch) {
      inflight.settle(event.ok, next, provider?.id ?? null);
      return;
    }
    if (provider !== null && this.pinnedProviderId === null) {
      this.pinnedProviderId = provider.id;
    }
    inflight.reply(event.ok, next);
  }

  private latchConflict(): void {
    this.conflict = true;
    this.lastState = ++this.serial;
    for (const pending of this.pending.values()) pending.conflict();
    this.publish(CONFLICT);
  }

  private request(op: MixCommand | "mix.status", steps = 1): Promise<void> {
    const id = randomUUID();
    if (this.sentIds.size >= 256) {
      const oldest = this.sentIds.keys().next().value;
      if (oldest !== undefined) this.sentIds.delete(oldest);
    }
    const responders = new Set<string>();
    this.sentIds.set(id, responders);
    const order = ++this.serial;
    return new Promise<void>((resolve, reject) => {
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const clearTimers = (): void => {
        clearTimeout(timeout);
        if (settleTimer !== undefined) {
          clearTimeout(settleTimer);
          settleTimer = undefined;
        }
      };
      const finish = (ok: boolean, next: MixState): void => {
        if (!this.pending.delete(id)) return;
        clearTimers();
        if (this.conflict) {
          reject(new Error(t("mixConflict")));
          return;
        }
        if (order > this.lastState) {
          this.lastState = order;
          this.publish(next);
        }
        if (ok) resolve();
        else reject(new Error("Mix request unconfirmed"));
      };
      const settle = (ok: boolean, next: MixState, providerId: string | null): void => {
        if (settleTimer !== undefined) return;
        settleTimer = setTimeout(() => {
          settleTimer = undefined;
          if (responders.size >= 2) {
            this.latchConflict();
            return;
          }
          this.conflict = false;
          this.pinnedProviderId = providerId;
          finish(ok, next);
        }, REPIN_SETTLE_MS);
        settleTimer.unref?.();
      };
      const fail = (): void => {
        if (op === "mix.status" && responders.size === 0) {
          this.pinnedProviderId = null;
          this.conflict = false;
        }
        finish(false, OFFLINE);
      };
      const conflict = (): void => {
        if (!this.pending.delete(id)) return;
        clearTimers();
        reject(new Error(t("mixConflict")));
      };
      const timeout = setTimeout(fail, op === "mix.status" ? 4000 : 12000);
      this.pending.set(id, { op, reply: finish, settle, fail, conflict });
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
