// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the service worker's WebSocket to the plugin
// (docs/vjster/REQUIREMENTS.md R-LNK-3, R-INT-3; PLAN.md Phase 1 step 4).
// Reconnects with backoff from 1 s to 30 s, answers pings, answers a
// malformed message with `error`, hands valid intents to the router.

import { PROTOCOL_VERSION, errorReply, parse, serialize, type Intent, type Message, type Target } from "../../src/vjster/shared/protocol.js";

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
  /** Which target this client is: the extension (default) or the OBS page (Phase 2). */
  target?: Target;
  /** Told when this client gives the link up to a newer one (true) and when it holds the link again (false). */
  onStandby?(standby: boolean): void;
}

export const MIN_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30_000;
/** The server closed this socket because a newer one for the same target took over (R-LNK-4). */
export const CLOSE_REPLACED = 4000;
/**
 * Added to the address by a client that was replaced: "take me only if nobody holds this target". The server refuses
 * such a connection while the newer client is there, so two clients for one target (two OBS sources with the VJster
 * page, the extension in two Chrome profiles) do not take the link from each other in turns. A server that does not
 * know the parameter ignores it.
 */
export const STANDBY_QUERY = "standby=1";
const CONNECTING = 0;
const OPEN = 1;

export class LinkClient {
  private socket: SocketLike | null = null;
  private retryTimer: unknown = null;
  private backoff = MIN_BACKOFF_MS;
  private running = false;
  /** Replaced by a newer client and not back on the link since: every attempt is a standby one. */
  private standingBy = false;
  private readonly timers: NonNullable<LinkClientOptions["timers"]>;
  private readonly random: () => number;

  constructor(private readonly options: LinkClientOptions) {
    this.timers = options.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    this.random = options.random ?? Math.random;
  }

  get connected(): boolean {
    return this.socket?.readyState === OPEN;
  }

  /** A socket is opening now: neither connected nor refused yet. */
  get connecting(): boolean {
    return this.socket?.readyState === CONNECTING;
  }

  /** The delay before the next attempt, for tests and the options page. */
  get nextDelayMs(): number {
    return this.backoff;
  }

  /** A newer client holds this target's link; this one asks only for a free link until it is on it again. */
  get standby(): boolean {
    return this.standingBy;
  }

  /**
   * `standby`: this client was replaced before it was stopped (the extension's worker, which Chrome stops and starts
   * again, remembers it), so it goes on asking for a free link only.
   */
  start(options: { standby?: boolean } = {}): void {
    if (this.running) return;
    this.running = true;
    if (options.standby) this.standingBy = true;
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
    // The operator asked for this connection: it takes the link like a new client.
    this.setStandby(false);
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
      const url = this.options.url();
      socket = this.options.open(this.standingBy ? `${url}${url.includes("?") ? "&" : "?"}${STANDBY_QUERY}` : url);
    } catch {
      return this.scheduleRetry();
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.backoff = MIN_BACKOFF_MS;
      // The link was free (or the server is an older one, which lets the latest connection win).
      this.setStandby(false);
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
      // From here on it asks only for a free link (a refused attempt closes without this code and changes nothing):
      // the newer client keeps the link until it leaves.
      if (closeCode(ev) === CLOSE_REPLACED) this.setStandby(true);
      this.options.onClose?.();
      this.scheduleRetry();
    };
  }

  private setStandby(standby: boolean): void {
    if (this.standingBy === standby) return;
    this.standingBy = standby;
    this.options.onStandby?.(standby);
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer !== null) return;
    // A client standing by looks every 24 to 30 s whether the link is free, never faster.
    if (this.standingBy) this.backoff = MAX_BACKOFF_MS;
    // Up to 20 % jitter, so many tabs reloading do not reconnect in lockstep.
    const delay = Math.round(this.backoff * (1 - 0.2 * this.random()));
    this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    this.retryTimer = this.timers.setTimeout(() => this.connect(), delay);
  }

  private onMessage(data: unknown): void {
    const result = parse(typeof data === "string" ? data : null, "intents");
    if (!result.ok) {
      this.send(errorReply(result.code, result.reason, result.inReplyTo, { id: this.options.newId(), target: this.options.target ?? "browser" }));
      return;
    }
    const m = result.message;
    if (m.type === "ping") {
      this.send({ v: PROTOCOL_VERSION, id: this.options.newId(), target: this.options.target ?? "browser", type: "pong", t: m.t });
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
