// SPDX-License-Identifier: GPL-2.0-or-later
// VJster: keep the link on for OBS (docs/vjster/REQUIREMENTS.md R-LNK-1,
// R-OBS-1). OBS loads its browser source once, when it starts or the source
// is refreshed, and does not retry. The page comes from the plugin's link
// server, which normally runs only while a VJster action is on the deck, so an
// OBS started while it is off would show an error page. The first time an OBS
// page connects, the setting turns itself on, unless the operator has already
// chosen it on or off; from then on only the operator changes it.

import type { TargetView } from "./display.js";

/** The part of the hub this uses. */
export interface KeepAliveHub {
  acquire(): Promise<void>;
  release(): void;
  view(target: "obs"): TargetView;
  subscribe(listener: () => void): () => void;
}

export class ObsKeepAlive {
  private holding = false;
  /** The operator's choice; null until one is stored (the setting never set). */
  private choice: boolean | null = null;
  private asked = false;

  /** `firstConnect` runs once, when an OBS page connects and the operator has not chosen yet. */
  constructor(
    private readonly hub: KeepAliveHub,
    private readonly firstConnect: () => void
  ) {
    hub.subscribe(() => this.check());
  }

  /** Follow the stored setting: on holds the link; off or not chosen lets the usual start and stop rule apply. */
  set(choice: boolean | null): void {
    this.choice = choice;
    if (choice === true && !this.holding) {
      this.holding = true;
      void this.hub.acquire().catch(() => undefined);
    } else if (choice !== true && this.holding) {
      this.holding = false;
      this.hub.release();
    }
  }

  get on(): boolean {
    return this.holding;
  }

  private check(): void {
    if (this.choice !== null || this.asked) return;
    if (this.hub.view("obs").status !== "connected") return;
    this.asked = true;
    this.firstConnect();
  }
}
