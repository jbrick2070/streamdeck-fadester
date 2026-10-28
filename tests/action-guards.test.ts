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

describe("Action guards: offline nudges, unavailable slots, label and readout options", () => {
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

  it("offline dial ticks reconnect at most once per 2 s and never send a request", async () => {
    client = new FadesterClient({ host: "127.0.0.1", port: 1, password: "" });
    const store = new FadesterStore(client);
    client.start();
    await new Promise((r) => setTimeout(r, 30));
    const attemptsBefore = client.getConnectAttemptCount();

    let alerts = 0;
    const dial = new FaderDialInstanceController(
      store,
      { setFeedback: async () => {}, showAlert: async () => { alerts++; } },
      { slot: "fader_1" },
      16
    );
    dial.appear();
    const t0 = 1_000_000;
    await dial.handleRotate(1, t0);
    await dial.handleRotate(1, t0 + 100);
    await dial.handleRotate(1, t0 + 1900);
    await dial.handleRotate(1, t0 + 2100);
    expect(alerts).toBe(4);
    // Exactly two forced reconnects: at t0 and t0 + 2100.
    expect(client.getConnectAttemptCount() - attemptsBefore).toBe(2);
    dial.disappear();
  });

  it("does not reconnect-nudge while halted on a wrong password", async () => {
    server = new FakeObsServer({ password: "right" });
    const port = await server.start();
    client = new FadesterClient({ host: "127.0.0.1", port, password: "wrong" });
    const store = new FadesterStore(client);
    await new Promise<void>((resolve) => {
      client!.once("statusChanged", () => resolve());
      client!.start();
    });
    expect(client.getStatus().kind).toBe("wrong_password");
    const attempts = client.getConnectAttemptCount();
    const key = new AutoFadeKeyInstanceController(
      store,
      { setImage: async () => {}, showAlert: async () => {} },
      { slot: "fader_1" },
      16
    );
    await key.handleKeyDown(5_000_000);
    await key.handleKeyDown(5_010_000);
    expect(client.getConnectAttemptCount()).toBe(attempts);
    expect(server.connectionCount).toBe(1);
  });

  it("alerts locally and sends nothing when the saved slot reports unavailable", async () => {
    server = new FakeObsServer({ studioMode: false });
    const port = await server.start();
    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(client);
    await new Promise<void>((resolve) => {
      client!.once("statusChanged", () => resolve());
      client!.start();
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(store.getSlot("crossfader")?.available).toBe(false);

    let dialAlerts = 0;
    const dial = new FaderDialInstanceController(
      store,
      { setFeedback: async () => {}, showAlert: async () => { dialAlerts++; } },
      { slot: "crossfader", longPressAction: "clean_all_fx" },
      16
    );
    dial.appear();
    const callsBefore = server.vendorCallLog.length;
    await dial.handleRotate(3);
    dial.handleDialDown();
    await dial.handleDialUp();
    await dial.handleTouchTap(100, 80);
    expect(dialAlerts).toBe(3);
    expect(server.vendorCallLog.length).toBe(callsBefore);

    // Clean All FX is slot-independent and still runs on an unavailable slot.
    dial.handleDialDown();
    await new Promise((r) => setTimeout(r, 900));
    expect(server.vendorCallLog.some((c) => c.requestType === "reset_fx")).toBe(true);
    await dial.handleDialUp();
    dial.disappear();

    let keyAlerts = 0;
    const key = new AutoFadeKeyInstanceController(
      store,
      { setImage: async () => {}, showAlert: async () => { keyAlerts++; } },
      { slot: "crossfader", to: 1, durationMs: 500 },
      16
    );
    const before = server.vendorCallLog.length;
    await key.handleKeyDown();
    expect(keyAlerts).toBe(1);
    expect(server.vendorCallLog.length).toBe(before);
  });

  it("renders the label override and percent readout on dial and key, and accepts 0.5 % and 10 % steps", async () => {
    server = new FakeObsServer();
    const port = await server.start();
    client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
    const store = new FadesterStore(client);
    await new Promise<void>((resolve) => {
      client!.once("statusChanged", () => resolve());
      client!.start();
    });
    await new Promise((r) => setTimeout(r, 40));

    const canvases: string[] = [];
    const dial = new FaderDialInstanceController(
      store,
      { setFeedback: async ({ canvas }) => { canvases.push(decodeSvgUri(canvas)); }, showAlert: async () => {} },
      { slot: "fx_1", labelOverride: "  Blur   amount that is too long ", readoutStyle: "percent", stepPerTick: 0.005 },
      16
    );
    dial.appear();
    await new Promise((r) => setTimeout(r, 60));
    const svg = dial.renderSvgString();
    expect(svg).toContain("Blur amount th");
    expect(svg).not.toContain(" px<");
    expect(svg).toMatch(/>\d+%<\/text>/);
    expect(dial.getSettings().stepPerTick).toBe(0.005);
    expect(dial.getSettings().labelOverride).toBe("Blur amount th");
    dial.updateSettings({ slot: "fx_1", stepPerTick: 0.1, readoutStyle: "auto" });
    expect(dial.getSettings().stepPerTick).toBe(0.1);
    expect(dial.renderSvgString()).toContain(" px<");
    dial.disappear();

    const key = new AutoFadeKeyInstanceController(
      store,
      { setImage: async () => {}, showAlert: async () => {} },
      { slot: "fx_1", labelOverride: "Blur", readoutStyle: "percent" },
      16
    );
    const keySvg = key.renderSvgString();
    expect(keySvg).toContain(">Blur<");
    expect(keySvg).not.toContain(" px<");
    expect(key.getSettings().readoutStyle).toBe("percent");

    // Unknown readout style and non-string labels fall back safely.
    key.updateSettings({ slot: "fx_1", labelOverride: 42 as unknown as string, readoutStyle: "weird" as unknown as "auto" });
    expect(key.getSettings()).toMatchObject({ labelOverride: "", readoutStyle: "auto" });
  });
});
