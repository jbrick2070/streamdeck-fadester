// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plugin's global settings, written through one serial queue (PLAN.md
 * 11.1, RL-1). Stream Deck stores the whole object on every write and sends
 * no echo back to the plugin, so each save merges its change into the last
 * known object: a language save keeps the connection, a connection save keeps
 * the language, and a save made before the start-up read waits for it.
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

export class GlobalSettingsStore {
  /**
   * Resolves once the start-up read finished, failed or timed out, or once Stream Deck
   * sent the settings itself; every save waits for it.
   */
  public readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private started = false;
  /** A newer object arrived (a page's write) before the start-up read answered: the read does not replace it. */
  private replaced = false;
  /** The store wrote at least once: a late start-up read must not replace what it wrote. */
  private written = false;
  private current: FadesterGlobalSettings = {};
  private queue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly port: GlobalSettingsPort,
    private readonly readTimeoutMs = START_READ_TIMEOUT_MS
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
        // A late answer replaces nothing newer (settings sent by Stream Deck, or the store's own write).
        if (!this.replaced && !this.written) this.current = copyOf(stored);
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

  /** Settings Stream Deck sent (`onDidReceiveGlobalSettings`): they replace what is known. */
  public replace(settings: FadesterGlobalSettings | undefined): void {
    this.replaced = true;
    this.current = copyOf(settings);
    // A whole settings object is known now: saves need not wait for the start-up read.
    this.resolveReady();
  }

  /**
   * Merges `change` into the stored settings and writes the whole object, after
   * the start-up read and after every earlier save. Resolves with what was written.
   */
  public patch(change: FadesterGlobalSettings): Promise<FadesterGlobalSettings> {
    const task = this.queue.then(async () => {
      await this.ready;
      const next = { ...this.current, ...change };
      this.current = next;
      this.written = true;
      const written = { ...next };
      await this.port.setGlobalSettings(written);
      return written;
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
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
