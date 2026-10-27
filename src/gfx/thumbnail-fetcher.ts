// SPDX-License-Identifier: GPL-2.0-or-later
import { FadesterSlot } from "../types/contract.js";
import { FadesterClient } from "../obs/fadester-client.js";

export interface ThumbnailPair {
  thumbnailA?: string;
  thumbnailB?: string;
}

export class ThumbnailFetcher {
  private readonly client: FadesterClient;
  private readonly intervalMs: number;
  private readonly onUpdated: (pair: ThumbnailPair) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private activeSourceA = "";
  private activeSourceB = "";
  private latestPair: ThumbnailPair = {};

  public constructor(
    client: FadesterClient,
    onUpdated: (pair: ThumbnailPair) => void,
    intervalMs = 750
  ) {
    this.client = client;
    this.onUpdated = onUpdated;
    // Clamp between 500 ms (2 FPS) and 1000 ms (1 FPS) per GRAPHICS-NOTES.md
    this.intervalMs = Math.max(500, Math.min(1000, intervalMs));
  }

  public getLatest(): ThumbnailPair {
    return this.latestPair;
  }

  public syncSlotState(
    visible: boolean,
    connected: boolean,
    showThumbnails: boolean,
    slot?: FadesterSlot
  ): void {
    const shouldRun =
      visible &&
      connected &&
      showThumbnails &&
      slot !== undefined &&
      slot.available &&
      slot.target_mode === "crossfade_ab" &&
      Boolean(slot.source_a || slot.source_b);

    if (!shouldRun || !slot) {
      this.stop();
      return;
    }

    const sourcesChanged =
      slot.source_a !== this.activeSourceA || slot.source_b !== this.activeSourceB;
    this.activeSourceA = slot.source_a;
    this.activeSourceB = slot.source_b;

    if (sourcesChanged) {
      this.latestPair = {};
    }

    if (this.timer === null) {
      void this.fetchOnce();
      this.timer = setInterval(() => {
        void this.fetchOnce();
      }, this.intervalMs);
    } else if (sourcesChanged) {
      void this.fetchOnce();
    }
  }

  public async fetchOnce(): Promise<void> {
    if (this.inFlight || !this.client.isConnected()) {
      return;
    }
    const srcA = this.activeSourceA;
    const srcB = this.activeSourceB;
    if (!srcA && !srcB) {
      return;
    }

    this.inFlight = true;
    try {
      const [imgA, imgB] = await Promise.all([
        srcA ? this.client.getSourceScreenshot(srcA, 96, 54).catch(() => undefined) : undefined,
        srcB ? this.client.getSourceScreenshot(srcB, 96, 54).catch(() => undefined) : undefined
      ]);

      if (srcA === this.activeSourceA && srcB === this.activeSourceB) {
        const nextPair: ThumbnailPair = {
          thumbnailA: imgA ?? this.latestPair.thumbnailA,
          thumbnailB: imgB ?? this.latestPair.thumbnailB
        };
        if (
          nextPair.thumbnailA !== this.latestPair.thumbnailA ||
          nextPair.thumbnailB !== this.latestPair.thumbnailB
        ) {
          this.latestPair = nextPair;
          this.onUpdated(this.latestPair);
        }
      }
    } finally {
      this.inFlight = false;
    }
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.activeSourceA = "";
    this.activeSourceB = "";
    this.latestPair = {};
  }
}
