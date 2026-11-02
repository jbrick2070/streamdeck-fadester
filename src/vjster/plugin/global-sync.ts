// SPDX-License-Identifier: GPL-2.0-or-later
// VJster's plugin-wide settings writes (docs/vjster/PLAN.md 9, R-LANG-8): no
// write loses a key. The plugin's own saves run one at a time, each merging
// its change into what the plugin holds, with a fresh read filling in only
// the keys the plugin does not hold; a write that omits the port, the
// extension allow list, the language, the keep-on choice or the OBS token
// (a settings page whose copy is older, or a read that never answered) keeps
// what the plugin knows. An empty allow list lets any extension connect, so
// losing the list is the worst case this guards against.

import type { JsonObject } from "@elgato/utils";
import { globalSettings, type GlobalSettings } from "./settings.js";

/**
 * `written` with every key it omits that the plugin knows filled in from
 * `current`: port, extensionIds (when the plugin has any), language (as stored,
 * when one is stored), obsAlwaysOn (once chosen) and the OBS token (when the
 * written one is missing or malformed; `newToken` makes one if the plugin has
 * none either). A key the write has is kept as written.
 */
export function keepOmitted(written: JsonObject, current: GlobalSettings, newToken?: () => string): JsonObject {
  const out: JsonObject = { ...written };
  if (!("port" in written)) out.port = current.port;
  if (!("extensionIds" in written) && current.extensionIds.length > 0) out.extensionIds = [...current.extensionIds];
  if (!("language" in written) && current.languageRaw !== undefined) out.language = current.languageRaw as JsonObject[string];
  if (!("obsAlwaysOn" in written) && current.obsAlwaysOn !== null) out.obsAlwaysOn = current.obsAlwaysOn;
  if (globalSettings(written).obsToken === null) {
    const token = current.obsToken ?? newToken?.();
    if (token) out.obsToken = token;
  }
  return out;
}

/**
 * A settings page's write as the plugin keeps it: with what it omitted filled
 * in (keepOmitted); `changed` says the plugin must write the repaired copy back.
 */
export function repairPageWrite(incoming: JsonObject, current: GlobalSettings, newToken: () => string): { settings: JsonObject; changed: boolean } {
  const settings = keepOmitted(incoming, current, newToken);
  const changed = Object.keys(settings).length !== Object.keys(incoming).length || settings.obsToken !== incoming.obsToken;
  return { settings, changed };
}

export interface GlobalSaverOptions {
  /** Stream Deck's stored plugin-wide settings (getGlobalSettings). */
  read(): Promise<JsonObject>;
  /** Stores them (setGlobalSettings). */
  write(settings: JsonObject): Promise<void>;
  /** What the plugin applies now. */
  current(): GlobalSettings;
  /** Applies a saved copy. */
  apply(settings: GlobalSettings): Promise<void>;
  /** How long a read may take before what the plugin knows stands in for it. */
  readTimeoutMs?: number;
}

/** The plugin's own saves, one at a time, each its change over what the plugin holds, a fresh read under both (R-LANG-8). */
export class GlobalSaver {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: GlobalSaverOptions) {}

  /**
   * Merge `change` over what the plugin holds, with the stored copy under both for the keys the plugin
   * does not hold, save, and apply. The plugin's copy is the base, not the read: a settings page's write
   * reaches the plugin (onDidReceiveGlobalSettings, then apply) before any read can reflect it, so a read
   * answered after such a write, from before it, must not bring back the old port or allow list; and a
   * stored allow list that is empty or holds no id never replaces the ids the plugin knows (a deliberate
   * clear from the settings page reaches the plugin through apply first, so it is not undone).
   */
  save(change: JsonObject): Promise<void> {
    const run = async (): Promise<void> => {
      const stored = await this.readOrNothing();
      const current = this.options.current();
      const merged = keepOmitted({ ...stored, ...keepOmitted({}, current), ...change }, current);
      await this.options.write(merged);
      await this.options.apply(globalSettings(merged));
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** The stored settings; an empty object when the read fails or does not answer in time (keepOmitted fills it). */
  private readOrNothing(): Promise<JsonObject> {
    const ms = this.options.readTimeoutMs ?? 5000;
    return new Promise<JsonObject>((resolve) => {
      const timer = setTimeout(() => resolve({}), ms);
      (timer as { unref?: () => void }).unref?.();
      this.options.read().then(
        (stored) => {
          clearTimeout(timer);
          resolve(typeof stored === "object" && stored !== null && !Array.isArray(stored) ? stored : {});
        },
        () => {
          clearTimeout(timer);
          resolve({});
        }
      );
    });
  }
}
