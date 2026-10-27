// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect, afterEach } from "vitest";
import { CellRateLimiter } from "../src/gfx/cell-rate-limiter.js";
import { ThumbnailFetcher } from "../src/gfx/thumbnail-fetcher.js";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

describe("Step 1.3 — Per-Cell 10 FPS Rate Limiter & 1–2 FPS Thumbnail Fetcher", () => {
  let server: FakeObsServer | null = null;
  let client: FadesterClient | null = null;

  afterEach(async () => {
    if (client) {
      client.stop();
      client = null;
    }
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("caps cell updates to ~10 FPS and guarantees trailing-edge final value flush", async () => {
    const flushed: number[] = [];
    const limiter = new CellRateLimiter<number>((val) => {
      flushed.push(val);
    }, 100);

    // Burst 10 updates within 20 ms
    const start = Date.now();
    for (let i = 1; i <= 10; i++) {
      limiter.push(i / 10, start + i);
    }

    // Only the first should have flushed synchronously
    expect(flushed).toEqual([0.1]);

    // Wait for trailing edge (120 ms)
    await new Promise((r) => setTimeout(r, 140));
    expect(flushed).toEqual([0.1, 1.0]);
    limiter.dispose();
  });

  it("fetches 96x54 thumbnails at 1-2 FPS with single-flight deduplication and stops on disappear", async () => {
    server = new FakeObsServer({ screenshotDelayMs: 60 });
    const port = await server.start();

    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    await new Promise<void>((resolve) => {
      client!.once("statusChanged", () => resolve());
      client!.start();
    });

    const updates: Array<{ thumbnailA?: string; thumbnailB?: string }> = [];
    const fetcher = new ThumbnailFetcher(
      client,
      (pair) => updates.push(pair),
      500
    );

    const crossfadeSlot = server.slots.find((s) => s.id === "fader_1")!;
    fetcher.syncSlotState(true, true, true, crossfadeSlot);

    // Attempt overlapping manual fetchOnce calls while the first is in flight
    void fetcher.fetchOnce();
    void fetcher.fetchOnce();

    await new Promise((r) => setTimeout(r, 150));
    expect(updates.length).toBe(1);
    expect(updates[0].thumbnailA).toContain("data:image/jpeg;base64,FAKE_THUMB_");
    expect(updates[0].thumbnailB).toContain("data:image/jpeg;base64,FAKE_THUMB_");
    // Single-flight guard means at most 2 concurrent GetSourceScreenshot calls (Source A + Source B)
    expect(server.maxConcurrentScreenshots).toBeLessThanOrEqual(2);

    // Stop when action disappears
    fetcher.stop();
    const countAfterStop = server.screenshotCallCount;
    await new Promise((r) => setTimeout(r, 600));
    expect(server.screenshotCallCount).toBe(countAfterStop);
  });
});
