// SPDX-License-Identifier: GPL-2.0-or-later
// VJster hub: the one link server the deck actions share, the latest state
// per target, and the start and stop rule (docs/vjster/REQUIREMENTS.md
// R-LNK-1..4, R-BEH-4, D-11; PLAN.md 3.2).

import { DEFAULT_LINK_PORT, type ErrorReport, type StateReport, type Target } from "../shared/protocol.js";
import type { LinkStatus, TargetView } from "./display.js";
import { LinkLifecycle, LinkPortInUseError, LinkServer, type IntentBody, type LinkEvent, type LinkServerOptions } from "./link-server.js";

/** The part of LinkServer the hub uses, so tests can stand in. */
export interface ServerLike {
  readonly running: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  on(listener: (event: LinkEvent) => void): () => void;
  isConnected(target: Target): boolean;
  send(target: Target, body: IntentBody): string | null;
}

export type ServerFactory = (options: LinkServerOptions) => ServerLike;

/** How often a taken port is tried again while actions want the link (D-11). */
export const PORT_RETRY_MS = 30_000;

export class Hub {
  private server: ServerLike;
  private unsubscribe: () => void;
  private readonly lifecycle: LinkLifecycle;
  private readonly states = new Map<Target, StateReport>();
  private readonly listeners = new Set<() => void>();
  private readonly errorListeners = new Set<(target: Target, error: ErrorReport) => void>();
  private options: LinkServerOptions;
  private readyGate: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    options: LinkServerOptions,
    private readonly factory: ServerFactory = (o) => new LinkServer(o),
    stopDelayMs = 60_000,
    private readonly retryMs = PORT_RETRY_MS
  ) {
    this.options = options;
    this.server = factory(options);
    this.unsubscribe = this.server.on((e) => this.onEvent(e));
    // The lifecycle starts and stops whichever server is current, through this proxy.
    const current = (): ServerLike => this.server;
    const proxy = {
      start: () => current().start(),
      stop: () => current().stop().then(() => this.changed()),
      get running(): boolean {
        return current().running;
      }
    };
    this.lifecycle = new LinkLifecycle(proxy, stopDelayMs);
  }

  /**
   * Start nothing until `ready` settles (the stored settings are applied), so
   * the server never runs on the default port or without the extension pin.
   * Acquires and releases made meanwhile run afterwards, in order.
   */
  holdUntil(ready: Promise<unknown>): void {
    const gate: Promise<void> = ready.then(
      () => undefined,
      () => undefined
    );
    this.readyGate = gate;
    void gate.then(() => {
      if (this.readyGate === gate) this.readyGate = null;
    });
  }

  /** An action appeared: the server runs while at least one is on the deck (R-LNK-1). */
  acquire(): Promise<void> {
    const gate = this.readyGate;
    const go = (): Promise<void> =>
      this.lifecycle.acquire().then(() => {
        this.changed();
        this.scheduleRetry();
      });
    return gate ? gate.then(go) : go();
  }

  release(): void {
    const gate = this.readyGate;
    if (gate) void gate.then(() => this.lifecycle.release());
    else this.lifecycle.release();
  }

  /** While the port is taken and actions want the link, try again every retryMs (D-11). */
  private scheduleRetry(): void {
    if (this.retryTimer !== null || !this.portInUse || this.lifecycle.userCount === 0) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.portInUse || this.lifecycle.userCount === 0) return;
      void this.lifecycle.acquire().then(() => {
        this.lifecycle.release();
        this.changed();
        this.scheduleRetry();
      });
    }, this.retryMs);
  }

  /** What a target looks like to the deck now (R-BEH-4). */
  view(target: Target): TargetView {
    let status: LinkStatus;
    if (this.lifecycle.error instanceof LinkPortInUseError) status = "port-in-use";
    else if (!this.server.isConnected(target)) status = target === "browser" ? "extension-off" : "page-off";
    else status = "connected";
    return { status, state: status === "connected" ? (this.states.get(target) ?? null) : null };
  }

  /** Send an intent; returns its id, or null when the target is not connected. */
  send(target: Target, body: IntentBody): string | null {
    return this.server.send(target, body);
  }

  /** Called on every change of any target's state or connection. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onError(listener: (target: Target, error: ErrorReport) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /**
   * New port, extension ids or OBS token: replace the server, keeping it
   * running if it was. Calls run one after another, never interleaved, so two
   * settings updates arriving together cannot leave two servers behind.
   */
  reconfigure(options: LinkServerOptions): Promise<void> {
    const run = this.queue.then(() => this.applyOptions(options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private queue: Promise<void> = Promise.resolve();

  private async applyOptions(options: LinkServerOptions): Promise<void> {
    const key = (o: LinkServerOptions) =>
      JSON.stringify([o.port ?? DEFAULT_LINK_PORT, o.obsToken ?? null, [...(o.allowedExtensionIds ?? [])].sort()]);
    if (key(options) === key(this.options)) return;
    this.options = options;
    const wasRunning = this.server.running;
    await this.server.stop();
    this.unsubscribe();
    this.states.clear();
    this.server = this.factory(options);
    this.unsubscribe = this.server.on((e) => this.onEvent(e));
    if (wasRunning || this.lifecycle.userCount > 0) {
      // An extra acquire starts the new server (recording a port clash, D-11);
      // the matching release leaves the count as it was.
      await this.lifecycle.acquire();
      this.lifecycle.release();
    }
    this.changed();
    this.scheduleRetry();
  }

  get portInUse(): boolean {
    return this.lifecycle.error instanceof LinkPortInUseError;
  }

  private onEvent(e: LinkEvent): void {
    if (e.type === "state") this.states.set(e.target, e.state);
    else if (e.type === "disconnected") this.states.delete(e.target);
    else if (e.type === "error") for (const l of this.errorListeners) l(e.target, e.error);
    this.changed();
  }

  private changed(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // A drawing listener must never stop the others.
      }
    }
  }
}
