// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FilterController } from "../src/control/filter-controller.js";
import { VS_PANIC_HOTKEY, VS_RESTORE_HOTKEY, VisualSafety } from "../src/control/visual-safety.js";
import { VisualPanicInstanceController } from "../src/actions/visual-panic-key.js";
import { setLanguage } from "../src/i18n/strings.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";
import { deckTable } from "./helpers/languages.js";

/**
 * Visual Panic keys and the deck's latch (PLAN.md 10.3, R-RIG-6), against the
 * fake OBS: what a press sends, the Restore hold, a missing Visual Sidechain,
 * and the latch's lifetime.
 */
describe("Visual Panic", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  async function connect(): Promise<{ server: FakeObsServer; client: DirectObsClient; safety: VisualSafety; filters: FilterController }> {
    const server = new FakeObsServer({ missingPlugin: true });
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const filters = new FilterController(client);
    const safety = new VisualSafety(client, filters);
    cleanup.push(() => client.stop(), () => server.stop());
    const connected = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await connected;
    return { server, client, safety, filters };
  }

  function keySink() {
    const images: string[] = [];
    let alerts = 0;
    let oks = 0;
    return {
      sink: {
        setImage: async (image: string) => { images.push(decodeURIComponent(image.replace("data:image/svg+xml;utf8,", ""))); },
        showAlert: async () => { alerts++; },
        showOk: async () => { oks++; }
      },
      alerts: (): number => alerts,
      oks: (): number => oks,
      last: (): string => images.at(-1) ?? "",
      waitImage: (predicate: (svg: string) => boolean): Promise<void> =>
        vi.waitFor(() => expect(predicate(images.at(-1) ?? ""), images.at(-1)).toBe(true), { timeout: 3000 })
    };
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  afterEach(async () => {
    setLanguage("en", null);
    for (const step of cleanup.splice(0)) await step();
  });

  it("sends one Panic per press, with no debounce, retries after a failed send, and latches until Restore", async () => {
    const { server, client, safety, filters } = await connect();
    const panic = keySink();
    const restore = keySink();
    const panicKey = new VisualPanicInstanceController(safety, client, panic.sink, { operation: "panic" }, 10);
    const restoreKey = new VisualPanicInstanceController(safety, client, restore.sink, { operation: "restore" }, 10, 400);
    cleanup.push(() => panicKey.disappear(), () => restoreKey.disappear());
    panicKey.appear();
    restoreKey.appear();
    await panic.waitImage((svg) => svg.includes(">PANIC<") && svg.includes('data-icon="panic"') && svg.includes('fill="#EF4444"'));
    await restore.waitImage((svg) => svg.includes(">Restore<") && svg.includes(">Hold 0.4 s<"));

    await panicKey.handleKeyDown();
    await panicKey.handleKeyDown();
    expect(server.hotkeyTriggerLog.map((entry) => entry.hotkeyName)).toEqual([VS_PANIC_HOTKEY, VS_PANIC_HOTKEY]);
    expect(safety.isLatched()).toBe(true);
    expect(filters.isPanicLatched()).toBe(true);
    await panic.waitImage((svg) => svg.includes("<title>PANIC SENT —") && svg.includes('data-icon="panic-sent"') && svg.includes(">Hold Restore to undo<"));

    // A failed send shows OBS's words and the next press sends again.
    server.hotkeyFailNext = "Hotkey failed.";
    await panicKey.handleKeyDown();
    expect(panic.alerts()).toBe(1);
    await panic.waitImage((svg) => svg.includes(">Hotkey failed.<"));
    expect(safety.isLatched()).toBe(true);
    await panicKey.handleKeyDown();
    expect(server.hotkeyTriggerAttempts).toBe(4);
    expect(server.hotkeyTriggerLog).toHaveLength(3);

    // Restore: a short press sends nothing; the hold sends it and clears the latch.
    await restoreKey.handleKeyDown();
    await restore.waitImage((svg) => svg.includes(">Keep holding<"));
    await restoreKey.handleKeyUp();
    await sleep(500);
    expect(server.hotkeyTriggerLog.filter((entry) => entry.hotkeyName === VS_RESTORE_HOTKEY)).toEqual([]);
    expect(safety.isLatched()).toBe(true);
    await restoreKey.handleKeyDown();
    await vi.waitFor(() => expect(safety.isLatched()).toBe(false), { timeout: 2000 });
    expect(server.hotkeyTriggerLog.at(-1)!.hotkeyName).toBe(VS_RESTORE_HOTKEY);
    expect(filters.isPanicLatched()).toBe(false);
    await vi.waitFor(() => expect(restore.oks()).toBe(1));
    await panic.waitImage((svg) => svg.includes(">PANIC<") && svg.includes('data-icon="panic"'));
  });

  it("holds Restore for 800 ms by default before it sends", async () => {
    const { server, client, safety } = await connect();
    const restore = keySink();
    const key = new VisualPanicInstanceController(safety, client, restore.sink, { operation: "restore" }, 10);
    cleanup.push(() => key.disappear());
    key.appear();
    await key.handleKeyDown();
    await sleep(500);
    await key.handleKeyUp();
    await sleep(500);
    expect(server.hotkeyTriggerAttempts).toBe(0);
    await key.handleKeyDown();
    await sleep(600);
    expect(server.hotkeyTriggerAttempts).toBe(0);
    await vi.waitFor(() => expect(server.hotkeyTriggerLog.map((entry) => entry.hotkeyName)).toEqual([VS_RESTORE_HOTKEY]), { timeout: 1000 });
    // Restore may be offered freely: Visual Sidechain's Restore writes back only what a Panic saved.
    expect(restore.alerts()).toBe(0);
  });

  it("says Visual Sidechain is not loaded when OBS has no such hotkey, and latches nothing", async () => {
    const { server, client, safety, filters } = await connect();
    server.hotkeyNames = server.hotkeyNames.filter((name) => !name.startsWith("visual_sidechain_"));
    const panic = keySink();
    const key = new VisualPanicInstanceController(safety, client, panic.sink, { operation: "panic" }, 10);
    cleanup.push(() => key.disappear());
    key.appear();
    await key.handleKeyDown();
    expect(server.hotkeyTriggerAttempts).toBe(1);
    expect(safety.isLatched()).toBe(false);
    expect(filters.isPanicLatched()).toBe(false);
    expect(panic.alerts()).toBe(1);
    await panic.waitImage((svg) => svg.includes(">Visual Sidechain missing<") && svg.includes('data-icon="panic"'));
    await expect(safety.restore()).rejects.toThrow(/Visual Sidechain missing/);
  });

  it("clears the latch on a reconnect and on a disconnect, and sends nothing while offline", async () => {
    const { server, client, safety } = await connect();
    await safety.panic();
    expect(safety.isLatched()).toBe(true);
    // A reconnect keeps the status connected: the latch still clears at once (an OBS restart resets Panic).
    const ready = once(client, "connectionReady", { signal: AbortSignal.timeout(3000) });
    client.reconnectNow();
    expect(safety.isLatched()).toBe(false);
    await ready;
    await safety.panic();
    expect(safety.isLatched()).toBe(true);
    const offline = once(client, "statusChanged", { signal: AbortSignal.timeout(3000) });
    await server.stop();
    await offline;
    expect(safety.isLatched()).toBe(false);
    const panic = keySink();
    const key = new VisualPanicInstanceController(safety, client, panic.sink, { operation: "panic" }, 10);
    cleanup.push(() => key.disappear());
    key.appear();
    const attempts = server.hotkeyTriggerAttempts;
    await key.handleKeyDown();
    expect(panic.alerts()).toBe(1);
    expect(server.hotkeyTriggerAttempts).toBe(attempts);
    await panic.waitImage((svg) => svg.includes('data-icon="panic"') && !svg.includes(">Strobe and flash off<"));
  });

  it("keeps a newer Panic's latch when an older Restore is answered, and keeps it when a Restore fails", async () => {
    const { server, safety } = await connect();
    server.hotkeyDelayMs = 150;
    const restore = safety.restore();
    await sleep(20);
    const panic = safety.panic();
    await Promise.all([restore, panic]);
    expect(server.hotkeyTriggerLog.map((entry) => entry.hotkeyName)).toEqual([VS_RESTORE_HOTKEY, VS_PANIC_HOTKEY]);
    expect(safety.isLatched()).toBe(true);
    server.hotkeyDelayMs = 0;
    server.hotkeyFailNext = "Hotkey failed.";
    await expect(safety.restore()).rejects.toThrow(/Hotkey failed/);
    expect(safety.isLatched()).toBe(true);
    await safety.restore();
    expect(safety.isLatched()).toBe(false);
  });

  it("sets the latch before OBS answers, so no Visual Sidechain write slips in behind Panic", async () => {
    const { server, safety, filters } = await connect();
    server.hotkeyDelayMs = 150;
    const panic = safety.panic();
    // At once, not when OBS answers.
    expect(safety.isLatched()).toBe(true);
    expect(filters.isPanicLatched()).toBe(true);
    const mix = { sourceUuid: "scene-uuid", filterName: "Aura", filterKind: "visual_sidechain_shader_filter", setting: "vs_effect_mix_pct" };
    await expect(filters.nudge(mix, 0.1, Date.now())).rejects.toThrow(/Restore first/);
    await panic;
    expect(server.hotkeyTriggerLog.map((entry) => entry.hotkeyName)).toEqual([VS_PANIC_HOTKEY]);
    expect(server.filterRequestLog).toEqual([]);
  });

  it("sends Panic while the catalog read after the identify still runs, and never restarts that connection", async () => {
    const server = new FakeObsServer({ missingPlugin: true });
    server.sceneListDelayMs = 800;
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const filters = new FilterController(client);
    const safety = new VisualSafety(client, filters);
    cleanup.push(() => client.stop(), () => server.stop());
    const panic = keySink();
    const key = new VisualPanicInstanceController(safety, client, panic.sink, { operation: "panic" }, 10);
    cleanup.push(() => key.disappear());
    key.appear();
    // Before the socket is identified: refused, and the opening socket is not torn down.
    client.start();
    expect(client.hasLiveSocket()).toBe(true);
    await key.handleKeyDown();
    expect(panic.alerts()).toBe(1);
    await vi.waitFor(() => expect(client.isIdentified()).toBe(true), { timeout: 2000 });
    expect(client.isConnected()).toBe(false);
    const attempts = client.getConnectAttemptCount();
    expect(attempts).toBe(1);
    await key.handleKeyDown();
    expect(server.hotkeyTriggerLog.map((entry) => entry.hotkeyName)).toEqual([VS_PANIC_HOTKEY]);
    expect(panic.alerts()).toBe(1);
    expect(safety.isLatched()).toBe(true);
    await vi.waitFor(() => expect(client.isConnected()).toBe(true), { timeout: 3000 });
    expect(client.getConnectAttemptCount()).toBe(attempts);
    expect(safety.isLatched()).toBe(true);
  });

  it("drops a Restore hold when the key is hidden or retargeted", async () => {
    const { server, client, safety } = await connect();
    const first = new VisualPanicInstanceController(safety, client, keySink().sink, { operation: "restore" }, 10, 150);
    first.appear();
    await first.handleKeyDown();
    first.disappear();
    const second = new VisualPanicInstanceController(safety, client, keySink().sink, { operation: "restore" }, 10, 150);
    cleanup.push(() => second.disappear());
    second.appear();
    await second.handleKeyDown();
    second.updateSettings({ operation: "panic" });
    await sleep(300);
    expect(server.hotkeyTriggerAttempts).toBe(0);
  });

  it("draws the Panic words in the deck's language", async () => {
    const { client, safety } = await connect();
    setLanguage("de", deckTable("de"));
    const panic = keySink();
    const restore = keySink();
    const panicKey = new VisualPanicInstanceController(safety, client, panic.sink, { operation: "panic" }, 10);
    const restoreKey = new VisualPanicInstanceController(safety, client, restore.sink, { operation: "restore" }, 10);
    cleanup.push(() => panicKey.disappear(), () => restoreKey.disappear());
    panicKey.appear();
    restoreKey.appear();
    await panic.waitImage((svg) => svg.includes(">PANIK<") && svg.includes(">Strobe und Blitz aus<"));
    await restore.waitImage((svg) => svg.includes(">Wiederherstellen<") && svg.includes(">0,8 s halten<"));
    await panicKey.handleKeyDown();
    await panic.waitImage((svg) => svg.includes("<title>PANIK GESENDET —") && !svg.includes("PANIC"));
  });

  it("uses Visual Sidechain's vendor truth channel (`get_safety`, `panic`, `restore`, `safety_changed`) and recovers Panic state on plugin restart", async () => {
    const server = new FakeObsServer({ missingPlugin: true, visualSidechainVendor: "safety" });
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const filters = new FilterController(client);
    const safety = new VisualSafety(client, filters);
    cleanup.push(() => client.stop(), () => server.stop());
    const ready = once(client, "connectionReady", { signal: AbortSignal.timeout(2000) });
    client.start();
    await ready;
    await vi.waitFor(() => expect(safety.getMode()).toBe("vendor"));
    expect(safety.isLatched()).toBe(false);

    const panic = keySink();
    const restore = keySink();
    const panicKey = new VisualPanicInstanceController(safety, client, panic.sink, { operation: "panic" }, 10);
    const restoreKey = new VisualPanicInstanceController(safety, client, restore.sink, { operation: "restore" }, 10, 200);
    cleanup.push(() => panicKey.disappear(), () => restoreKey.disappear());
    panicKey.appear();
    restoreKey.appear();
    await panic.waitImage((svg) => svg.includes('data-icon="panic"'));

    // 1. Pressing Panic on the OBS keyboard emits `safety_changed` and flips the Stream Deck key within one event.
    server.triggerVisualSidechainSafety(true, 1731542400123);
    await panic.waitImage((svg) => svg.includes('data-icon="panic-sent"'));
    expect(safety.isLatched()).toBe(true);
    expect(safety.getSinceMs()).toBe(1731542400123);
    expect(filters.isPanicLatched()).toBe(true);

    // 2. Restarting the deck plugin mid-Panic reads `get_safety` on connect and comes back showing PANIC SENT.
    const client2 = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const filters2 = new FilterController(client2);
    const safety2 = new VisualSafety(client2, filters2);
    const panic2 = keySink();
    const panicKey2 = new VisualPanicInstanceController(safety2, client2, panic2.sink, { operation: "panic" }, 10);
    cleanup.push(() => panicKey2.disappear(), () => client2.stop());
    panicKey2.appear();
    client2.start();
    await panic2.waitImage((svg) => svg.includes('data-icon="panic-sent"'));
    expect(safety2.isLatched()).toBe(true);
    expect(safety2.getSinceMs()).toBe(1731542400123);
    expect(filters2.isPanicLatched()).toBe(true);

    // 3. Pressing Panic on the deck sends vendor request `panic` every time (no hotkey fallback needed).
    const beforeCalls = server.visualSidechainCallLog.filter((c) => c.requestType === "panic").length;
    await panicKey.handleKeyDown();
    await panicKey.handleKeyDown();
    expect(server.visualSidechainCallLog.filter((c) => c.requestType === "panic")).toHaveLength(beforeCalls + 2);
    expect(server.hotkeyTriggerLog).toEqual([]);

    // 4. Holding Restore sends vendor request `restore` and clears both decks via `safety_changed`.
    await restoreKey.handleKeyDown();
    await vi.waitFor(() => expect(safety.isLatched()).toBe(false), { timeout: 2000 });
    await vi.waitFor(() => expect(safety2.isLatched()).toBe(false), { timeout: 2000 });
    await panic.waitImage((svg) => svg.includes('data-icon="panic"'));
    await panic2.waitImage((svg) => svg.includes('data-icon="panic"'));
    expect(server.visualSidechainCallLog.at(-1)?.requestType).toBe("restore");
    expect(safety.getSinceMs()).toBe(0);
  });

  it("falls back to frontend hotkeys and the local latch when Visual Sidechain 0.6.0 lacks safety vendor requests", async () => {
    const server = new FakeObsServer({ missingPlugin: true, visualSidechainVendor: "legacy" });
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const filters = new FilterController(client);
    const safety = new VisualSafety(client, filters);
    cleanup.push(() => client.stop(), () => server.stop());
    const ready = once(client, "connectionReady", { signal: AbortSignal.timeout(2000) });
    client.start();
    await ready;
    await vi.waitFor(() => expect(safety.getMode()).toBe("legacy"));

    await safety.panic();
    expect(safety.isLatched()).toBe(true);
    expect(server.hotkeyTriggerLog.map((entry) => entry.hotkeyName)).toEqual([VS_PANIC_HOTKEY]);
    await safety.restore();
    expect(safety.isLatched()).toBe(false);
    expect(server.hotkeyTriggerLog.map((entry) => entry.hotkeyName)).toEqual([VS_PANIC_HOTKEY, VS_RESTORE_HOTKEY]);
  });
});
