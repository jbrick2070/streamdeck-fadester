// SPDX-License-Identifier: GPL-2.0-or-later
// VJster link server: the loopback WebSocket the Chrome extension and the
// Phase 2 OBS page connect to (docs/vjster/REQUIREMENTS.md R-LNK-1..5,
// PLAN.md 3.3 and Phase 1 step 3). Runs in the Stream Deck plugin (Node).
//
// Who may connect, checked on the HTTP upgrade before any WebSocket exists:
// - exactly one Host header, naming the server itself (127.0.0.1 or localhost
//   on its port), which defeats DNS rebinding;
// - with a `token` query parameter, that parameter decides alone: it must
//   equal the OBS page token (compared in constant time) and the connection
//   is the `obs` target;
// - without one, the Origin must be `chrome-extension://<32 letters a-p>`,
//   one of the pinned extension ids when there are any, and the connection is
//   the `browser` target.
// Anything else gets a plain HTTP 403 and no WebSocket.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  DEFAULT_LINK_PORT,
  LINK_HOST,
  MAX_MESSAGE_CHARS,
  PROTOCOL_VERSION,
  parse,
  serialize,
  type ErrorReport,
  type Intent,
  type StateReport,
  type Target
} from "../shared/protocol.js";

/** Bytes a frame may carry: MAX_MESSAGE_CHARS UTF-16 units can need three bytes each. */
export const MAX_PAYLOAD_BYTES = MAX_MESSAGE_CHARS * 3;
export const DEFAULT_PING_INTERVAL_MS = 20_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
/** A dropped report is answered with `state.get` at most this often per connection. */
export const REASK_MIN_MS = 2000;
/** Refusals are logged at most this often, with a count of the ones in between. */
export const REFUSAL_LOG_MS = 10_000;

/** Close codes the server uses (4000-4999 are free for applications). */
export const CLOSE_REPLACED = 4000;
export const CLOSE_IDLE = 4001;
export const CLOSE_SHUTDOWN = 1001;

const EXTENSION_ID = /^[a-p]{32}$/;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** What the server logs. Never a URL, a title, a token or a message body (R-BEH-5). */
export interface LinkLog {
  info(message: string): void;
  warn(message: string): void;
}

const silentLog: LinkLog = { info: () => undefined, warn: () => undefined };

/** The clock and interval timer the keepalive uses; monotonic by default, so sleep and clock steps do not close healthy peers at once. */
export interface LinkClock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const realClock: LinkClock = {
  now: () => performance.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>)
};

export interface LinkServerOptions {
  port?: number;
  /** Extension ids allowed to connect; empty or absent allows any extension. */
  allowedExtensionIds?: readonly string[];
  /** The OBS page token (32 lowercase hex digits); absent refuses every token connection. */
  obsToken?: string | null;
  pingIntervalMs?: number;
  idleTimeoutMs?: number;
  log?: LinkLog;
  clock?: LinkClock;
}

/** An intent as the deck builds it; the server adds `v`, `id` and `target`. */
export type IntentBody = Intent extends infer I ? (I extends Intent ? Omit<I, "v" | "id" | "target"> : never) : never;

export type LinkEvent =
  | { readonly type: "connected"; readonly target: Target }
  | { readonly type: "disconnected"; readonly target: Target }
  | { readonly type: "state"; readonly target: Target; readonly state: StateReport }
  | { readonly type: "error"; readonly target: Target; readonly error: ErrorReport };

/** The port cannot be bound: another program holds it, or Windows reserves it (D-11). */
export class LinkPortInUseError extends Error {
  constructor(
    readonly port: number,
    readonly code: string
  ) {
    super(`port ${port} on ${LINK_HOST} is not available (${code})`);
  }
}

/** A fresh OBS page token: 128 random bits as 32 hex digits (R-LNK-2). */
export function newObsToken(): string {
  return randomBytes(16).toString("hex");
}

/** Why an upgrade is refused, or which target it is. Exported for tests. */
export function classifyUpgrade(
  headers: { readonly host?: string; readonly origin?: string },
  url: string,
  port: number,
  allowedExtensionIds: readonly string[],
  obsToken: string | null
): { ok: true; target: Target } | { ok: false; reason: string } {
  const host = headers.host ?? "";
  if (host !== `${LINK_HOST}:${port}` && host !== `localhost:${port}`) return { ok: false, reason: "host" };

  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const token = new URLSearchParams(query).get("token");
  if (token !== null) {
    if (obsToken === null || !TOKEN_PATTERN.test(token) || !TOKEN_PATTERN.test(obsToken)) return { ok: false, reason: "token" };
    const same = timingSafeEqual(Buffer.from(token, "utf8"), Buffer.from(obsToken, "utf8"));
    return same ? { ok: true, target: "obs" } : { ok: false, reason: "token" };
  }

  const match = EXTENSION_ORIGIN.exec(headers.origin ?? "");
  if (!match) return { ok: false, reason: "origin" };
  if (allowedExtensionIds.length > 0 && !allowedExtensionIds.includes(match[1])) return { ok: false, reason: "extension-id" };
  return { ok: true, target: "browser" };
}

interface Peer {
  readonly socket: WebSocket;
  readonly target: Target;
  lastHeardAt: number;
  lastReaskAt: number;
  warnedMalformed: boolean;
}

export class LinkServer {
  private readonly port: number;
  private readonly allowed: readonly string[];
  private readonly obsToken: string | null;
  private readonly pingIntervalMs: number;
  private readonly idleTimeoutMs: number;
  private readonly log: LinkLog;
  private readonly clock: LinkClock;
  private readonly listeners = new Set<(event: LinkEvent) => void>();
  private readonly peers = new Map<Target, Peer>();
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private pingTimer: unknown = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private nextId = 1;
  private readonly idPrefix = randomBytes(4).toString("hex");
  private refusalsSinceLog = 0;
  private lastRefusalLogAt = Number.NEGATIVE_INFINITY;

  constructor(options: LinkServerOptions = {}) {
    this.port = options.port ?? DEFAULT_LINK_PORT;
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.log = options.log ?? silentLog;
    this.clock = options.clock ?? realClock;
    // Bad settings would refuse everyone silently; say so once, and fail closed.
    const ids = (options.allowedExtensionIds ?? []).map((id) => id.toLowerCase());
    const goodIds = ids.filter((id) => EXTENSION_ID.test(id));
    if (goodIds.length < ids.length) this.log.warn(`ignored ${ids.length - goodIds.length} malformed pinned extension id(s)`);
    this.allowed = ids.length > 0 && goodIds.length === 0 ? ["-"] : goodIds;
    const token = options.obsToken ?? null;
    if (token !== null && !TOKEN_PATTERN.test(token)) this.log.warn("ignored a malformed OBS page token; OBS pages cannot connect");
    this.obsToken = token !== null && TOKEN_PATTERN.test(token) ? token : null;
  }

  /** The port this server was configured with. */
  get configuredPort(): number {
    return this.port;
  }

  /** Subscribe to connection, state and error events; returns the unsubscribe function. */
  on(listener: (event: LinkEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get running(): boolean {
    return this.http !== null;
  }

  /** The port actually bound (differs from the option only when it was 0). */
  get boundPort(): number | null {
    const address = this.http?.address();
    return address && typeof address === "object" ? (address as AddressInfo).port : null;
  }

  isConnected(target: Target): boolean {
    return this.peers.get(target)?.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Bind 127.0.0.1 and start accepting (R-LNK-1). Overlapping calls share one
   * start; a start during a stop waits for the stop. Rejects with
   * LinkPortInUseError when the port is taken or reserved.
   */
  start(): Promise<void> {
    if (this.http) return Promise.resolve();
    if (!this.starting) {
      this.starting = (this.stopping ?? Promise.resolve()).then(() => this.doStart()).finally(() => (this.starting = null));
    }
    return this.starting;
  }

  private async doStart(): Promise<void> {
    if (this.http) return;
    const http = createServer((_req, res) => {
      // Plain HTTP gets nothing but a refusal: this server only upgrades.
      res.writeHead(426, { "content-type": "text/plain", connection: "close" });
      res.end("upgrade required");
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => this.onUpgrade(wss, req, socket, head));
    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        http.removeListener("listening", onListening);
        reject(err.code === "EADDRINUSE" || err.code === "EACCES" ? new LinkPortInUseError(this.port, err.code) : err);
      };
      const onListening = () => {
        http.removeListener("error", onError);
        resolve();
      };
      http.once("error", onError);
      http.once("listening", onListening);
      http.listen(this.port, LINK_HOST);
    });
    // Errors after listening (an accept failure, for example) are logged, never thrown.
    http.on("error", (err: NodeJS.ErrnoException) => this.log.warn(`link server error (${err.code ?? err.name})`));
    this.http = http;
    this.wss = wss;
    this.pingTimer = this.clock.setInterval(() => this.pingAll(), this.pingIntervalMs);
    this.log.info(`link server listening on ${LINK_HOST}:${this.boundPort}`);
  }

  /** Close every connection, report each as gone, and free the port. Waits for a pending start. */
  stop(): Promise<void> {
    if (!this.stopping) {
      this.stopping = (this.starting ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => this.doStop())
        .finally(() => (this.stopping = null));
    }
    return this.stopping;
  }

  private async doStop(): Promise<void> {
    if (this.pingTimer !== null) this.clock.clearInterval(this.pingTimer);
    this.pingTimer = null;
    const gone = [...this.peers.values()];
    this.peers.clear();
    for (const peer of gone) {
      peer.socket.close(CLOSE_SHUTDOWN, "server stopping");
      this.emit({ type: "disconnected", target: peer.target });
    }
    const http = this.http;
    const wss = this.wss;
    this.http = null;
    this.wss = null;
    wss?.clients.forEach((client) => client.terminate());
    wss?.close();
    if (http) {
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections?.();
      });
      this.log.info("link server stopped");
    }
  }

  /**
   * Send an intent to a target. Returns its id, or null when that target is
   * not connected (the caller shows "Extension off" or "No page", R-BEH-4).
   */
  send(target: Target, body: IntentBody): string | null {
    const peer = this.peers.get(target);
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) return null;
    const id = this.newId();
    const intent = { ...body, v: PROTOCOL_VERSION, id, target } as Intent;
    peer.socket.send(serialize(intent));
    return id;
  }

  private newId(): string {
    return `d${this.idPrefix}-${this.nextId++}`;
  }

  private emit(event: LinkEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // The exception's text could carry page content (R-BEH-5): log a fixed line.
        this.log.warn("a link listener threw");
      }
    }
  }

  private refuse(reason: string, socket: Duplex): void {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    // Anyone on this machine can knock; keep the log from filling up.
    this.refusalsSinceLog++;
    const now = this.clock.now();
    if (now - this.lastRefusalLogAt >= REFUSAL_LOG_MS) {
      const more = this.refusalsSinceLog > 1 ? ` (and ${this.refusalsSinceLog - 1} more since the last note)` : "";
      this.log.warn(`refused a connection (${reason})${more}`);
      this.lastRefusalLogAt = now;
      this.refusalsSinceLog = 0;
    }
  }

  private onUpgrade(wss: WebSocketServer, req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const port = this.boundPort ?? this.port;
    // Node keeps only the first of two Host headers; a browser never sends two, so refuse them.
    const hostHeaders = req.rawHeaders.filter((_v, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === "host").length;
    if (hostHeaders !== 1) return this.refuse("host", socket);
    const verdict = classifyUpgrade(
      { host: req.headers.host, origin: typeof req.headers.origin === "string" ? req.headers.origin : undefined },
      req.url ?? "/",
      port,
      this.allowed,
      this.obsToken
    );
    if (!verdict.ok) return this.refuse(verdict.reason, socket);
    wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, verdict.target));
  }

  private accept(socket: WebSocket, target: Target): void {
    const previous = this.peers.get(target);
    if (previous) {
      // Latest wins (R-LNK-4); only for the same target.
      this.peers.delete(target);
      previous.socket.close(CLOSE_REPLACED, "replaced by a newer connection");
    }
    const now = this.clock.now();
    const peer: Peer = { socket, target, lastHeardAt: now, lastReaskAt: Number.NEGATIVE_INFINITY, warnedMalformed: false };
    this.peers.set(target, peer);
    this.log.info(`${target} connected`);

    socket.on("message", (data: RawData, isBinary: boolean) => this.onMessage(peer, data, isBinary));
    socket.on("close", () => {
      if (this.peers.get(target) === peer) {
        this.peers.delete(target);
        this.log.info(`${target} disconnected`);
        this.emit({ type: "disconnected", target });
      }
    });
    socket.on("error", () => socket.terminate());

    this.emit({ type: "connected", target });
    // Ask for the current state at once (R-LNK-4).
    this.send(target, { type: "state.get" });
  }

  private onMessage(peer: Peer, data: RawData, isBinary: boolean): void {
    // A replaced or closed connection no longer speaks for its target.
    if (this.peers.get(peer.target) !== peer) return;
    peer.lastHeardAt = this.clock.now();
    const text = isBinary ? null : Buffer.isBuffer(data) ? data.toString("utf8") : Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data).toString("utf8");
    const result = parse(text, "reports");
    if (!result.ok || result.message.target !== peer.target) {
      // Only targets answer with `error`; the deck drops the message, says so
      // once per connection without its content, and asks again, at most once
      // every REASK_MIN_MS so a target that keeps sending bad reports cannot
      // start a loop (PLAN.md 3.3).
      if (!peer.warnedMalformed) {
        peer.warnedMalformed = true;
        this.log.warn(`dropped a message from ${peer.target}: ${result.ok ? "wrong target" : isBinary ? "binary frame" : result.code}`);
      }
      const now = this.clock.now();
      if (now - peer.lastReaskAt >= REASK_MIN_MS) {
        peer.lastReaskAt = now;
        this.send(peer.target, { type: "state.get" });
      }
      return;
    }
    const message = result.message;
    switch (message.type) {
      case "state":
        this.emit({ type: "state", target: peer.target, state: message });
        return;
      case "error":
        this.emit({ type: "error", target: peer.target, error: message });
        return;
      case "ping":
        peer.socket.send(serialize({ v: PROTOCOL_VERSION, id: this.newId(), target: peer.target, type: "pong", t: message.t }));
        return;
      case "pong":
        return;
    }
  }

  /**
   * Keepalive (R-LNK-3): a ping to every peer, and a close for one silent
   * longer than the idle timeout. With the default timers a silent peer is
   * closed 60 to 80 s after its last message.
   */
  private pingAll(): void {
    const now = this.clock.now();
    for (const peer of [...this.peers.values()]) {
      if (now - peer.lastHeardAt > this.idleTimeoutMs) {
        this.log.warn(`${peer.target} silent for ${Math.round((now - peer.lastHeardAt) / 1000)} s; closing`);
        this.peers.delete(peer.target);
        peer.socket.close(CLOSE_IDLE, "no answer to pings");
        this.emit({ type: "disconnected", target: peer.target });
        continue;
      }
      if (peer.socket.readyState === WebSocket.OPEN) {
        peer.socket.send(serialize({ v: PROTOCOL_VERSION, id: this.newId(), target: peer.target, type: "ping", t: Math.round(now) }));
      }
    }
  }

  /** Run one keepalive round now; tests with a fake clock call this instead of waiting. */
  tick(): void {
    this.pingAll();
  }
}

/**
 * Runs the server only while VJster actions are in use (R-LNK-1): `acquire`
 * when an action appears, `release` when it disappears. The server starts on
 * the first acquire and stops `stopDelayMs` after the last release, so a page
 * or profile switch does not drop the link.
 */
export class LinkLifecycle {
  private users = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private starting: Promise<void> | null = null;
  private lastError: Error | null = null;

  constructor(
    private readonly server: Pick<LinkServer, "start" | "stop" | "running">,
    private readonly stopDelayMs = 60_000,
    private readonly timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = { setTimeout, clearTimeout }
  ) {}

  /** The start error, if the last start failed (for example LinkPortInUseError, D-11). */
  get error(): Error | null {
    return this.lastError;
  }

  get userCount(): number {
    return this.users;
  }

  acquire(): Promise<void> {
    this.users++;
    if (this.stopTimer) {
      this.timers.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.server.running) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.server
        .start()
        .then(() => {
          this.lastError = null;
        })
        .catch((e: unknown) => {
          this.lastError = e instanceof Error ? e : new Error(String(e));
        })
        .finally(() => {
          this.starting = null;
        });
    }
    return this.starting;
  }

  release(): void {
    if (this.users === 0) return;
    this.users--;
    if (this.users > 0 || this.stopTimer) return;
    this.stopTimer = this.timers.setTimeout(() => {
      this.stopTimer = null;
      if (this.users === 0) void this.server.stop();
    }, this.stopDelayMs);
  }
}
