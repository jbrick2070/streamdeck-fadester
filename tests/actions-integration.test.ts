// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect, afterEach } from "vitest";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import { FaderDialInstanceController } from "../src/actions/fader-dial.js";
import { AutoFadeKeyInstanceController } from "../src/actions/auto-fade-key.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";

function decodeSvgUri(uri: string): string {
  const prefix = "data:image/svg+xml;utf8,";
  return uri.startsWith(prefix) ? decodeURIComponent(uri.slice(prefix.length)) : uri;
}

describe("Step 1.4 — End-to-End Fader Dial & Auto-fade Key Integration", () => {
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

  it("drives Fader dial turn, short press, 800 ms hold with Hold indicator, touchTap, and Auto-fade key", async () => {
    server = new FakeObsServer();
    const port = await server.start();

    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(client);
    await new Promise<void>((resolve) => {
      client!.once("statusChanged", () => resolve());
      client!.start();
    });
    await new Promise((r) => setTimeout(r, 30));

    const dialCanvasHistory: string[] = [];
    let dialAlerts = 0;
    const dialCtrl = new FaderDialInstanceController(
      store,
      {
        setFeedback: async ({ canvas }) => {
          dialCanvasHistory.push(decodeSvgUri(canvas));
        },
        showAlert: async () => {
          dialAlerts++;
        }
      },
      { slot: "crossfader", stepPerTick: 0.02, acceleration: false },
      16
    );
    dialCtrl.appear();

    const keyImageHistory: string[] = [];
    const keyCtrl = new AutoFadeKeyInstanceController(
      store,
      {
        setImage: async (img) => {
          keyImageHistory.push(decodeSvgUri(img));
        },
        showAlert: async () => {}
      },
      { slot: "crossfader", to: 1, durationMs: 1200 },
      16
    );
    keyCtrl.appear();

    expect(dialAlerts).toBe(0);
    expect(dialCanvasHistory.at(-1)).toContain("0%");
    expect(keyImageHistory.at(-1)).toContain("0%");

    // 1. Rotate dial by +3 ticks at 2% -> 6%
    await dialCtrl.handleRotate(3, 1000);
    await new Promise((r) => setTimeout(r, 30));
    expect(store.getSlot("crossfader")?.value).toBe(0.06);
    expect(dialCanvasHistory.at(-1)).toContain("6%");
    expect(keyImageHistory.at(-1)).toContain("6%");

    // 2. Short press (< 800 ms): shows Hold indicator on down, clears and snaps to 100% on up
    dialCtrl.handleDialDown();
    expect(dialCtrl.renderSvgString()).toContain("HOLD 3s FADE");
    await dialCtrl.handleDialUp();
    await new Promise((r) => setTimeout(r, 30));
    expect(dialCtrl.renderSvgString()).not.toContain("HOLD 3s FADE");
    expect(store.getSlot("crossfader")?.value).toBe(1.0);
    expect(dialCanvasHistory.at(-1)).toContain("100%");

    // 3. Long press (>= 800 ms): fires 3000 ms auto_fade to 0% and does NOT fire short press on release
    const autoFadeCountBefore = server.vendorCallLog.filter(
      (c) => c.requestType === "auto_fade"
    ).length;
    dialCtrl.handleDialDown();
    expect(dialCtrl.renderSvgString()).toContain("HOLD 3s FADE");
    await new Promise((r) => setTimeout(r, 850));
    expect(dialCtrl.renderSvgString()).not.toContain("HOLD 3s FADE");

    const setFaderCountBeforeUp = server.vendorCallLog.filter(
      (c) => c.requestType === "set_fader_value"
    ).length;
    await dialCtrl.handleDialUp();
    const setFaderCountAfterUp = server.vendorCallLog.filter(
      (c) => c.requestType === "set_fader_value"
    ).length;
    expect(setFaderCountAfterUp).toBe(setFaderCountBeforeUp);

    const lastAutoFade = server.vendorCallLog
      .filter((c) => c.requestType === "auto_fade")
      .at(-1);
    expect(
      server.vendorCallLog.filter((c) => c.requestType === "auto_fade").length
    ).toBe(autoFadeCountBefore + 1);
    expect(lastAutoFade?.requestData).toEqual({
      slot: "crossfader",
      to: 0.0,
      ms: 3000
    });

    // 4. TouchTap on bottom bar midpoint (x = 100, y = 75) -> jumps to 50%
    await dialCtrl.handleTouchTap(100, 75);
    await new Promise((r) => setTimeout(r, 30));
    expect(store.getSlot("crossfader")?.value).toBe(0.5);

    // 5. Auto-fade key press -> runs auto_fade(crossfader, to: 1, ms: 1200)
    await keyCtrl.handleKeyDown();
    await new Promise((r) => setTimeout(r, 30));
    expect(store.getSlot("crossfader")?.value).toBe(1.0);

    dialCtrl.disappear();
    keyCtrl.disappear();
  });

  it("updates connected dial (crossfader) and key (master) live on state_changed when switching to nanokontrol2 without restart", async () => {
    server = new FakeObsServer({
      fadesterVersion: "0.3.0",
      buildCommit: "642d6b7"
    });
    const port = await server.start();

    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(client);
    await new Promise<void>((resolve) => {
      client!.once("statusChanged", () => resolve());
      client!.start();
    });
    await new Promise((r) => setTimeout(r, 30));

    const dialCanvasHistory: string[] = [];
    const dialCtrl = new FaderDialInstanceController(
      store,
      {
        setFeedback: async ({ canvas }) => {
          dialCanvasHistory.push(decodeSvgUri(canvas));
        },
        showAlert: async () => {}
      },
      { slot: "crossfader" },
      16
    );
    dialCtrl.appear();

    const keyImageHistory: string[] = [];
    const keyCtrl = new AutoFadeKeyInstanceController(
      store,
      {
        setImage: async (img) => {
          keyImageHistory.push(decodeSvgUri(img));
        },
        showAlert: async () => {}
      },
      { slot: "master", to: 0, durationMs: 1000 },
      16
    );
    keyCtrl.appear();

    // Initially on apc40mk2: crossfader shows T-bar 0%, master shows 100%
    expect(dialCanvasHistory.at(-1)).toContain('data-cell="tbar"');
    expect(keyImageHistory.at(-1)).toContain('data-key="auto-fade"');
    expect(keyImageHistory.at(-1)).toContain(">100%<");

    // Load nanokontrol2 (turns off crossfader AND master) while connected
    await client.loadProfile({ name: "nanokontrol2" });
    await new Promise((r) => setTimeout(r, 40));

    expect(store.getProfile()).toBe("nanokontrol2");
    expect(store.getProfileTier()).toBe("beta");
    expect(dialCanvasHistory.at(-1)).toContain("Not used. Click to set up.");
    expect(dialCanvasHistory.at(-1)).not.toContain('data-cell="tbar"');
    expect(keyImageHistory.at(-1)).toContain('data-key="status"');
    expect(keyImageHistory.at(-1)).toContain("Not used. Click to set up.");
    expect(keyImageHistory.at(-1)).not.toContain(">100%<");

    // Switch back to apc40mk2 -> both recover live without restart
    await client.loadProfile({ name: "apc40mk2" });
    await new Promise((r) => setTimeout(r, 40));
    expect(dialCanvasHistory.at(-1)).toContain('data-cell="tbar"');
    expect(keyImageHistory.at(-1)).toContain('data-key="auto-fade"');
    expect(keyImageHistory.at(-1)).toContain(">100%<");

    dialCtrl.disappear();
    keyCtrl.disappear();
  });
});
