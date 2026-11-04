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
  /** Messages for the host (Stream Deck or OpenDeck). */
  toHost(message: Message): void;
  /** Messages for a child plugin. */
  toChild(child: Child, message: Message): void;
}

/** The event a VJster settings page sends to have its global settings saved by the suite. */
export const SUITE_GLOBAL_EVENT = "suiteGlobal";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export class SuiteMux {
  private full: Record<string, unknown> = {};
  private fullKnown = false;
  /** The children waiting for the host to answer a settings read, with the id each one's read carried (the answer must carry it back). */
  private readonly waiting = new Map<Child, unknown>();
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
      const payload = isRecord(message.payload) ? message.payload : {};
      this.full = isRecord(payload.settings) ? { ...payload.settings } : {};
      this.fullKnown = true;
      // A read's answer goes to the one that asked, with its id (the SDK hands it to that read only); anything else is news for both.
      for (const child of ["fadester", "vjster"] as const) {
        this.options.toChild(child, this.settingsReply(child, this.waiting.get(child)));
        this.waiting.delete(child);
      }
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
    else for (const child of ["fadester", "vjster"] as const) this.options.toChild(child, message);
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
  }

  /** A message from a child plugin: handled here, or passed to the host with the VJster action uuid translated. */
  fromChild(child: Child, message: Message): void {
    switch (message.event) {
      case "registerPlugin":
        return; // the suite registered once, for both
      case "getGlobalSettings":
        if (this.fullKnown) this.options.toChild(child, this.settingsReply(child, message.id));
        else {
          // One read of the host serves everyone waiting.
          const asked = this.waiting.size > 0;
          this.waiting.set(child, message.id);
          if (!asked) this.options.toHost({ event: "getGlobalSettings", context: this.options.pluginUuid, id: "suite-global-settings" });
        }
        return;
      case "setGlobalSettings": {
        const payload = isRecord(message.payload) ? message.payload : {};
        this.full = child === "vjster" ? { ...this.full, [this.options.namespace]: payload } : { ...payload, ...this.sliceEntry() };
        this.fullKnown = true;
        this.options.toHost({ event: "setGlobalSettings", context: this.options.pluginUuid, payload: this.full });
        return;
      }
      default: {
        const action = typeof message.action === "string" ? message.action : undefined;
        const mapped = action !== undefined ? this.toHostUuid.get(action) : undefined;
        this.options.toHost(mapped ? { ...message, action: mapped } : message);
      }
    }
  }

  private sliceEntry(): Record<string, unknown> {
    return this.options.namespace in this.full ? { [this.options.namespace]: this.full[this.options.namespace] } : {};
  }

  /** VJster's settings page asked for its global settings to be saved: written under VJster's name, the rest kept, and VJster told. */
  private saveVjsterSettings(settings: unknown): void {
    const mine = isRecord(settings) ? settings : {};
    this.full = { ...this.full, [this.options.namespace]: mine };
    this.fullKnown = true;
    this.options.toHost({ event: "setGlobalSettings", context: this.options.pluginUuid, payload: this.full });
    this.options.toChild("vjster", this.settingsReply("vjster"));
  }
}
