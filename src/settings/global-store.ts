// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plugin's global settings, written through one serial queue (PLAN.md
 * 11.1, RL-1). Stream Deck stores the whole object on every write and sends
 * no echo back to the plugin, so each save merges its change into the last
 * known object: a language save keeps the connection, a connection save keeps
 * the language, and a save made before the start-up read waits for it. A save
 * made after that read failed or timed out is held in memory, logged, and
 * written once the object is known (the read answers late, or Stream Deck
 * sends the settings): it never writes its own keys as the whole object,
 * which would erase the host, the port and the password.
 */
import type { FadesterGlobalSettings } from "../types/settings.js";

/** What the store needs from Stream Deck (`streamDeck.settings` in the plugin, a fake in the tests). */
export interface GlobalSettingsPort {
  getGlobalSettings(): Promise<FadesterGlobalSettings | undefined>;
  setGlobalSettings(settings: FadesterGlobalSettings): Promise<void>;
}

function copyOf(settings: unknown): FadesterGlobalSettings {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? { ...(settings as FadesterGlobalSettings) }
    : {};
}

/** How long the start-up read may take before saves run from what is known (Stream Deck normally answers at once). */
export const START_READ_TIMEOUT_MS = 5000;

/** The log line of a save held in memory because the whole settings object is not known yet. */
export const NOT_READ_MESSAGE = "settings not read; not saved";

/** The log line of a write Stream Deck refused; the change is held for the next write. */
export const NOT_SAVED_MESSAGE = "settings not saved";

export class GlobalSettingsStore {
  /**
   * Resolves once the start-up read finished, failed or timed out, or once Stream Deck
   * sent the settings itself; every save waits for it.
   */
  public readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private started = false;
  /** The whole stored object is known: the start-up read answered, or Stream Deck sent the settings. */
  private known = false;
  /** Changes applied in memory while the object was not known; written once, as soon as it is. */
  private pending: FadesterGlobalSettings | undefined;
  private current: FadesterGlobalSettings = {};
  private queue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly port: GlobalSettingsPort,
    private readonly readTimeoutMs = START_READ_TIMEOUT_MS,
    private readonly log?: (message: string) => void
  ) {
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /** The start-up read; call it once Stream Deck is connected. A second call returns the first one's snapshot. */
  public async start(): Promise<FadesterGlobalSettings> {
    if (this.started) {
      await this.ready;
      return this.snapshot();
    }
    this.started = true;
    // A read that fails or never answers must not hold the saves for good: they run from what is known.
    const read = this.port.getGlobalSettings().then(
      (stored) => {
        // A late answer replaces nothing newer (settings sent by Stream Deck); it is merged with the saves held meanwhile.
        if (!this.known) this.learn(copyOf(stored));
      },
      () => undefined
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.readTimeoutMs);
    });
    try {
      await Promise.race([read, timedOut]);
    } finally {
      clearTimeout(timer);
      this.resolveReady();
    }
    return this.snapshot();
  }

  /** A copy of the last known settings. */
  public snapshot(): FadesterGlobalSettings {
    return { ...this.current };
  }

  /**
   * Settings Stream Deck sent (`onDidReceiveGlobalSettings`): they replace what is known. They are newer
   * than the saves held while the start-up read was out, so a held key they carry gives way to theirs.
   */
  public replace(settings: FadesterGlobalSettings | undefined): void {
    const next = copyOf(settings);
    if (this.pending) for (const key of Object.keys(next)) delete (this.pending as Record<string, unknown>)[key];
    this.learn(next);
  }

  /**
   * Merges `change` into the stored settings and writes the whole object, after
   * the start-up read and after every earlier save. Resolves with what was written;
   * while the stored object is not known (the read failed or timed out), with what
   * is held, written once the object is known.
   */
  public patch(change: FadesterGlobalSettings): Promise<FadesterGlobalSettings> {
    const task = this.queue.then(async () => {
      await this.ready;
      const next = { ...this.current, ...change };
      this.current = next;
      if (!this.known) {
        this.pending = { ...this.pending, ...change };
        this.log?.(NOT_READ_MESSAGE);
        return { ...next };
      }
      return this.write(change);
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  /**
   * The whole stored object, from the start-up read or from Stream Deck, becomes the known object,
   * with the changes held meanwhile on top; those are then written once, through the queue. Saves
   * need not wait for the start-up read any more.
   */
  private learn(stored: FadesterGlobalSettings): void {
    this.known = true;
    const held = this.pending;
    this.pending = undefined;
    this.current = { ...stored, ...held };
    this.resolveReady();
    if (held === undefined || Object.keys(held).length === 0) return;
    const task = this.queue.then(() => this.write(held));
    this.queue = task.then(() => undefined, () => undefined);
  }

  /**
   * Writes the whole known object, which carries `change`. A write Stream Deck refuses is logged and
   * `change` is held again, so the next write (a later save, or settings Stream Deck sends) carries it;
   * a write that succeeds stored every held change, so nothing stays held.
   */
  private async write(change: FadesterGlobalSettings): Promise<FadesterGlobalSettings> {
    const written = { ...this.current };
    try {
      await this.port.setGlobalSettings(written);
    } catch (error) {
      this.pending = { ...change, ...this.pending };
      this.log?.(NOT_SAVED_MESSAGE);
      throw error;
    }
    this.pending = undefined;
    return written;
  }
}

/**
 * The connection part of a save (host, port, password), the keys a connection save may change.
 * A key the save leaves undefined is skipped, so a connection save never removes a key: by design,
 * since the pages always send all three (a cleared password arrives as "").
 */
export function connectionChange(settings: FadesterGlobalSettings): FadesterGlobalSettings {
  const change: FadesterGlobalSettings = {};
  if (settings.host !== undefined) change.host = settings.host;
  if (settings.port !== undefined) change.port = settings.port;
  if (settings.password !== undefined) change.password = settings.password;
  return change;
}

/** What a connection save tells besides the store: the two clients take the page's settings. */
export interface ConnectionSettingsListener {
  updateSettings(settings: FadesterGlobalSettings): void;
}

/**
 * The pages' connection saver (`persistGlobalSettings` of both bridges, PLAN.md 11.1, RL-1): it saves
 * through the store's merged queue, never with a whole-object write of its own, then tells the clients.
 */
export function connectionSaver(
  store: Pick<GlobalSettingsStore, "patch">,
  listeners: readonly ConnectionSettingsListener[]
): (settings: FadesterGlobalSettings) => Promise<void> {
  return async (settings) => {
    await store.patch(connectionChange(settings));
    for (const listener of listeners) listener.updateSettings(settings);
  };
}
