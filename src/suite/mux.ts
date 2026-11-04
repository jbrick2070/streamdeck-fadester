// SPDX-License-Identifier: GPL-2.0-or-later
// The suite's message router (docs/SUITE.md). One plugin process talks to Stream Deck or OpenDeck; behind it the
// Fadester plugin and the VJster plugin each run as before, each believing it is the only plugin. This module is the
// pure part: which child gets a message from the host, what a child's message means to the host, and how the one
// stored global-settings object is shared (Fadester keeps its keys at the top, VJster keeps its own under one name,
// so neither one's `port` or `language` reaches the other). No sockets and no clock live here, so it tests as
// plain calls.

export type Child = "fadester" | "vjster";
export type Message = Record<string, unknown> & { event?: string; action?: string; context?: string; payload?: unknown };

export interface MuxOptions {
  /** The plugin id Stream Deck or OpenDeck registered the suite under (the context of plugin-level messages). */
  pluginUuid: string;
  /** The host's action uuid for each VJster action, and the uuid the VJster plugin knows it by. */
  vjsterActions: Readonly<Record<string, string>>;
  /** The key of the global-settings object that holds VJster's own settings. */
  namespace: string;
  /** The plugin id each child was started with, when it is not the suite's own; its plugin-level messages are put back to the suite's. */
  childUuids?: Readonly<Partial<Record<Child, string>>>;
  /** Messages for the host (Stream Deck or OpenDeck). */
  toHost(message: Message): void;
  /** Messages for a child plugin. */
  toChild(child: Child, message: Message): void;
}

/** The event a VJster settings page sends to have its global settings saved by the suite. */
export const SUITE_GLOBAL_EVENT = "suiteGlobal";
/** The id of the suite's own read of the stored settings. */
const READ_ID = "suite-global-settings";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const CHILDREN = ["fadester", "vjster"] as const;

export class SuiteMux {
  private full: Record<string, unknown> = {};
  private fullKnown = false;
  /** The reads a child has waiting on the host's answer, by the ids they carried (the answer to each must carry its id back). */
  private readonly waiting = new Map<Child, unknown[]>();
  /** Saves that arrived before the stored object was known: applied once it is, so a save can never replace what it has not seen. */
  private readonly held: Array<() => void> = [];
  private readonly owner = new Map<string, Child>();
  private readonly devices = new Map<string, Message>();
  private readonly appearances = new Map<string, Message>();
  private readonly toVjsterUuid: Readonly<Record<string, string>>;
  private readonly toHostUuid = new Map<string, string>();

  constructor(private readonly options: MuxOptions) {
    this.toVjsterUuid = options.vjsterActions;
    for (const [host, child] of Object.entries(options.vjsterActions)) this.toHostUuid.set(child, host);
  }

  /** The whole global-settings object as the suite last knew it. */
  get settings(): Readonly<Record<string, unknown>> {
    return this.full;
  }

  /** Ask the host for the stored settings: once the connection is up, and again from time to time until they are known. */
  start(): void {
    if (!this.fullKnown) this.options.toHost({ event: "getGlobalSettings", context: this.options.pluginUuid, id: READ_ID });
  }

  private isVjster(action: string): boolean {
    return Object.hasOwn(this.toVjsterUuid, action);
  }

  private slice(): Record<string, unknown> {
    const mine = this.full[this.options.namespace];
    return isRecord(mine) ? { ...mine } : {};
  }

  private withoutSlice(): Record<string, unknown> {
    const { [this.options.namespace]: _mine, ...rest } = this.full;
    return rest;
  }

  private view(child: Child): Record<string, unknown> {
    return child === "vjster" ? this.slice() : this.withoutSlice();
  }

  private settingsReply(child: Child, id?: unknown): Message {
    return { event: "didReceiveGlobalSettings", ...(id !== undefined ? { id } : {}), payload: { settings: this.view(child) } };
  }

  /** A message from the host: delivered to the child that owns it, or to both. */
  fromHost(message: Message): void {
    if (message.event === "didReceiveGlobalSettings") {
      // A second answer to the suite's own read, after the settings were known and perhaps saved since, is older than what is held.
      if (this.fullKnown && message.id === READ_ID) return;
      const payload = isRecord(message.payload) ? message.payload : {};
      this.full = isRecord(payload.settings) ? { ...payload.settings } : {};
      const firstTime = !this.fullKnown;
      this.fullKnown = true;
      // An answer goes to the ones that asked, each with its read's id (the SDK hands it to that read only). News (no id) goes to both.
      for (const child of CHILDREN) {
        const ids = this.waiting.get(child) ?? [];
        this.waiting.delete(child);
        for (const id of ids) this.options.toChild(child, this.settingsReply(child, id));
        if (ids.length === 0 && message.id === undefined) this.options.toChild(child, this.settingsReply(child));
      }
      if (firstTime) for (const apply of this.held.splice(0)) apply();
      return;
    }
    this.remember(message);
    const action = typeof message.action === "string" ? message.action : undefined;
    if (message.event === "sendToPlugin" && action !== undefined && this.isVjster(action) && isRecord(message.payload) && message.payload.event === SUITE_GLOBAL_EVENT) {
      this.saveVjsterSettings(message.payload.settings);
      return;
    }
    if (action !== undefined) {
      const child: Child = this.isVjster(action) ? "vjster" : "fadester";
      if (typeof message.context === "string") {
        if (message.event === "willDisappear") this.owner.delete(message.context);
        else this.owner.set(message.context, child);
      }
      this.options.toChild(child, child === "vjster" ? { ...message, action: this.toVjsterUuid[action] } : message);
      return;
    }
    const known = typeof message.context === "string" ? this.owner.get(message.context) : undefined;
    if (known) this.options.toChild(known, message);
    else for (const child of CHILDREN) this.options.toChild(child, message);
  }

  /** What a child that starts again must be told to be where the others are: the decks, the settings, the keys and dials showing. */
  replayFor(child: Child): Message[] {
    const out: Message[] = [...this.devices.values()];
    if (this.fullKnown) out.push(this.settingsReply(child));
    for (const [context, message] of this.appearances) {
      if (this.owner.get(context) !== child) continue;
      const action = typeof message.action === "string" ? message.action : "";
      out.push(child === "vjster" ? { ...message, action: this.toVjsterUuid[action] } : message);
    }
    return out;
  }

  private remember(message: Message): void {
    const device = typeof (message as { device?: unknown }).device === "string" ? (message as { device: string }).device : undefined;
    if (message.event === "deviceDidConnect" && device) this.devices.set(device, message);
    if (message.event === "deviceDidDisconnect" && device) this.devices.delete(device);
    if (typeof message.context !== "string") return;
    if (message.event === "willAppear") this.appearances.set(message.context, message);
    if (message.event === "willDisappear") this.appearances.delete(message.context);
    // The key's settings as they are now, so a child that starts again is not given the ones it first appeared with.
    if (message.event === "didReceiveSettings" && isRecord(message.payload)) this.updateAppearance(message.context, message.payload.settings);
  }

  private updateAppearance(context: string, settings: unknown): void {
    const appeared = this.appearances.get(context);
    if (!appeared || !isRecord(settings)) return;
    this.appearances.set(context, { ...appeared, payload: { ...(isRecord(appeared.payload) ? appeared.payload : {}), settings } });
  }

  /** Tell each key and dial a child owns that it is not working (the child cannot be started again). */
  showAlertsFor(child: Child): void {
    for (const [context, owner] of this.owner) if (owner === child) this.options.toHost({ event: "showAlert", context });
  }

  /** A message from a child plugin: handled here, or passed to the host with the VJster action uuid translated. */
  fromChild(child: Child, message: Message): void {
    switch (message.event) {
      case "registerPlugin":
        return; // the suite registered once, for both
      case "getGlobalSettings": {
        if (this.fullKnown) {
          this.options.toChild(child, this.settingsReply(child, message.id));
          return;
        }
        // One read of the host serves everyone waiting; each is answered with its own id.
        const asked = this.waiting.size > 0;
        this.waiting.set(child, [...(this.waiting.get(child) ?? []), message.id]);
        if (!asked) this.start();
        return;
      }
      case "setGlobalSettings": {
        const payload = isRecord(message.payload) ? message.payload : {};
        this.whenKnown(() => {
          this.full = child === "vjster" ? { ...this.full, [this.options.namespace]: payload } : { ...payload, ...this.sliceEntry() };
          this.options.toHost({ event: "setGlobalSettings", context: this.options.pluginUuid, payload: this.full });
        });
        return;
      }
      default: {
        if (message.event === "setSettings" && typeof message.context === "string") this.updateAppearance(message.context, message.payload);
        const action = typeof message.action === "string" ? message.action : undefined;
        const mapped = action !== undefined ? this.toHostUuid.get(action) : undefined;
        const own = this.options.childUuids?.[child];
        this.options.toHost({ ...message, ...(mapped ? { action: mapped } : {}), ...(own !== undefined && message.context === own ? { context: this.options.pluginUuid } : {}) });
      }
    }
  }

  /** Run a save now if the stored object is known, otherwise once it is (and ask for it). */
  private whenKnown(save: () => void): void {
    if (this.fullKnown) save();
    else {
      this.held.push(save);
      this.start();
    }
  }

  private sliceEntry(): Record<string, unknown> {
    return this.options.namespace in this.full ? { [this.options.namespace]: this.full[this.options.namespace] } : {};
  }

  /** VJster's settings page asked for its global settings to be saved: written under VJster's name, the rest kept, and VJster told. */
  private saveVjsterSettings(settings: unknown): void {
    const mine = isRecord(settings) ? settings : {};
    this.whenKnown(() => {
      this.full = { ...this.full, [this.options.namespace]: mine };
      this.options.toHost({ event: "setGlobalSettings", context: this.options.pluginUuid, payload: this.full });
      this.options.toChild("vjster", this.settingsReply("vjster"));
    });
  }
}
