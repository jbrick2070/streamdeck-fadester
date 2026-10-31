// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the service worker's WebSocket to the plugin
// (docs/vjster/REQUIREMENTS.md R-LNK-3, R-INT-3; PLAN.md Phase 1 step 4).
// Reconnects with backoff from 1 s to 30 s, answers pings, answers a
// malformed message with `error`, hands valid intents to the router.

import { PROTOCOL_VERSION, errorReply, parse, serialize, type Intent, type Message } from "../../src/vjster/shared/protocol.js";

/** The part of a WebSocket the client uses (the browser's, or `ws` in tests). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface LinkClientOptions {
  url(): string;
  open(url: string): SocketLike;
  onIntent(intent: Intent): void;
  onOpen?(): void;
  onClose?(): void;
  newId(): string;
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
  /** Jitter source in [0, 1); tests pass a constant. */
  random?: () => number;
}

export const MIN_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30_000;
/** The server closed this socket because a newer one for the same target took over (R-LNK-4). */
export const CLOSE_REPLACED = 4000;
const OPEN = 1;

export class LinkClient {
  private socket: SocketLike | null = null;
  private retryTimer: unknown = null;
  private backoff = MIN_BACKOFF_MS;
  private running = false;
  private readonly timers: NonNullable<LinkClientOptions["timers"]>;
  private readonly random: () => number;

  constructor(private readonly options: LinkClientOptions) {
    this.timers = options.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    this.random = options.random ?? Math.random;
  }

  get connected(): boolean {
    return this.socket?.readyState === OPEN;
  }

  /** The delay before the next attempt, for tests and the options page. */
  get nextDelayMs(): number {
    return this.backoff;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const s = this.socket;
    this.socket = null;
    s?.close(1000, "stopped");
  }

  /** Connect now if not connected (the one-minute alarm calls this, R-LNK-3). */
  ensure(): void {
    if (!this.running) return this.start();
    if (this.socket === null && this.retryTimer === null) this.connect();
  }

  /** Drop the connection and connect again at once, for example after the port changed. */
  restart(): void {
    this.stop();
    this.backoff = MIN_BACKOFF_MS;
    this.start();
  }

  send(message: Message): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(serialize(message));
    return true;
  }

  private connect(): void {
    this.retryTimer = null;
    let socket: SocketLike;
    try {
      socket = this.options.open(this.options.url());
    } catch {
      return this.scheduleRetry();
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.backoff = MIN_BACKOFF_MS;
      this.options.onOpen?.();
    };
    socket.onmessage = (ev) => {
      if (this.socket === socket) this.onMessage(ev.data);
    };
    // A refused connection while the plugin's server is stopped is normal (R-LNK-3): no log.
    socket.onerror = () => undefined;
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      // Replaced by another copy of the extension (a second Chrome profile, say):
      // wait the longest delay before taking the link back, so the two do not trade it every second.
      if (closeCode(ev) === CLOSE_REPLACED) this.backoff = MAX_BACKOFF_MS;
      this.options.onClose?.();
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer !== null) return;
    // Up to 20 % jitter, so many tabs reloading do not reconnect in lockstep.
    const delay = Math.round(this.backoff * (1 - 0.2 * this.random()));
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    this.retryTimer = this.timers.setTimeout(() => this.connect(), delay);
  }

  private onMessage(data: unknown): void {
    const result = parse(typeof data === "string" ? data : null, "intents");
    if (!result.ok) {
      this.send(errorReply(result.code, result.reason, result.inReplyTo, { id: this.options.newId(), target: "browser" }));
      return;
    }
    const m = result.message;
    if (m.type === "ping") {
      this.send({ v: PROTOCOL_VERSION, id: this.options.newId(), target: "browser", type: "pong", t: m.t });
      return;
    }
    if (m.type === "pong" || m.type === "state" || m.type === "error") return;
    // Only intents are left (parse accepted "intents"; keepalives were handled above).
    this.options.onIntent(m as Intent);
  }
}

function closeCode(ev: unknown): number | null {
  const code = typeof ev === "object" && ev !== null ? (ev as { code?: unknown }).code : undefined;
  return typeof code === "number" ? code : null;
}
