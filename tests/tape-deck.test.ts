// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { TapeDecks, formatTapeDeckSpeed } from "../src/control/tape-decks.js";
import { TapeDeckForm, TapeDeckInstanceController } from "../src/actions/tape-deck-control.js";
import { DirectObsPropertyInspectorBridge } from "../src/pi/direct-obs-bridge.js";
import { setLanguage } from "../src/i18n/strings.js";
import { FakeObsServer, FakeObsServerOptions } from "./helpers/fake-obs-server.js";
import { MiniDocument, MiniElement, documentFromPage } from "./helpers/mini-dom.js";
import { PLUGIN_DIR, deckTable } from "./helpers/languages.js";

describe("Tape Deck action & controller (P1-6)", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  function makeDeck(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      source: "Deck A",
      filter: "Visual Sidechain: Tape Deck",
      deck_id: "deck_1",
      role: "owner",
      state: "playing",
      tape: "C:/videos/loop.mp4",
      speed_percent: 150,
      effective_speed_percent: 150,
      speed_fader: { slot: -1, slot_id: "", min_percent: 50, max_percent: 200, live: false },
      tape_pitch: false,
      playing: true,
      loop: true,
      start_seconds: 0,
      linked: false,
      ...overrides
    };
  }

  async function setup(
    opts: FakeObsServerOptions = { missingPlugin: true, visualSidechainVendor: "decks" },
    initialDecks: Array<Record<string, unknown>> = []
  ): Promise<{
    server: FakeObsServer;
    client: DirectObsClient;
    tapeDecks: TapeDecks;
  }> {
    const server = new FakeObsServer(opts);
    server.visualSidechainDecks = initialDecks;
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const tapeDecks = new TapeDecks(client);
    cleanup.push(() => client.stop(), () => server.stop());
    const ready = once(client, "connectionReady", { signal: AbortSignal.timeout(3000) });
    client.start();
    await ready;
    return { server, client, tapeDecks };
  }

  function deckSink() {
    const svgs: string[] = [];
    let alerts = 0;
    return {
      sink: {
        render: async (svg: string) => {
          svgs.push(svg);
        },
        showAlert: async () => {
          alerts++;
        }
      },
      svgs,
      alerts: (): number => alerts,
      last: (): string => svgs.at(-1) ?? "",
      waitSvg: (predicate: (svg: string) => boolean): Promise<void> =>
        vi.waitFor(() => expect(predicate(svgs.at(-1) ?? ""), svgs.at(-1)).toBe(true), { timeout: 3000 })
    };
  }

  afterEach(async () => {
    setLanguage("en", null);
    for (const step of cleanup.splice(0)) await step();
  });

  it("formats speeds in both % and x forms across the ladder and arbitrary integers", () => {
    expect(formatTapeDeckSpeed(25)).toBe("25% (0.25x)");
    expect(formatTapeDeckSpeed(50)).toBe("50% (0.5x)");
    expect(formatTapeDeckSpeed(100)).toBe("100% (1x)");
    expect(formatTapeDeckSpeed(125)).toBe("125% (1.25x)");
    expect(formatTapeDeckSpeed(150)).toBe("150% (1.5x)");
    expect(formatTapeDeckSpeed(800)).toBe("800% (8x)");
    expect(formatTapeDeckSpeed(133)).toBe("133% (1.33x)");
  });

  it("shows NOT LOADED across key and dial when Visual Sidechain is absent", async () => {
    const { client, tapeDecks } = await setup({ missingPlugin: true, visualSidechainVendor: "none" });
    await vi.waitFor(() => expect(tapeDecks.sample().state).toBe("not_loaded"));

    const forms: Array<{ form: TapeDeckForm; viewBox: string }> = [
      { form: "key", viewBox: 'viewBox="0 0 120 120"' },
      { form: "dial", viewBox: 'viewBox="0 0 200 100"' }
    ];

    for (const { form, viewBox } of forms) {
      const s = deckSink();
      const ctrl = new TapeDeckInstanceController(tapeDecks, client, s.sink, form);
      cleanup.push(() => ctrl.disappear());
      ctrl.appear();
      await s.waitSvg(
        (svg) =>
          svg.includes(viewBox) &&
          svg.includes('data-state="not_loaded"') &&
          svg.includes(">NOT LOADED<")
      );
    }
  });

  it("shows NO DECK when no Tape Deck exists or when the named source is missing, then updates live via decks_changed", async () => {
    const { server, client, tapeDecks } = await setup(
      { missingPlugin: true, visualSidechainVendor: "decks" },
      []
    );
    await vi.waitFor(() => expect(tapeDecks.getAvailability()).toBe("loaded"));

    const key = deckSink();
    const dial = deckSink();
    const keyCtrl = new TapeDeckInstanceController(tapeDecks, client, key.sink, "key");
    const dialCtrl = new TapeDeckInstanceController(tapeDecks, client, dial.sink, "dial", {
      deck: "Deck B"
    });
    cleanup.push(() => keyCtrl.disappear(), () => dialCtrl.disappear());
    keyCtrl.appear();
    dialCtrl.appear();

    await key.waitSvg((svg) => svg.includes('data-state="no_deck"') && svg.includes(">NO DECK<"));
    await dial.waitSvg((svg) => svg.includes('data-state="no_deck"') && svg.includes(">NO DECK<"));

    // Push a live decks_changed event for Deck A: automatic key turns active at 150% (1.5x) Playing;
    // Deck B dial stays NO DECK until Deck B appears.
    server.emitVisualSidechainDecksChanged([makeDeck({ source: "Deck A", speed_percent: 150, effective_speed_percent: 150, playing: true })]);
    await key.waitSvg(
      (svg) =>
        svg.includes('data-state="active"') &&
        svg.includes(">150% (1.5x)<") &&
        svg.includes(">Playing<") &&
        svg.includes(">Deck A<")
    );
    expect(dial.last()).toContain('data-state="no_deck"');

    // Add Deck B paused at 75% (0.75x): Deck B dial turns active immediately with zero polling.
    server.emitVisualSidechainDecksChanged([
      makeDeck({ source: "Deck A", speed_percent: 150, effective_speed_percent: 150, playing: true }),
      makeDeck({
        source: "Deck B",
        deck_id: "deck_2",
        speed_percent: 75,
        effective_speed_percent: 75,
        playing: false,
        state: "paused"
      })
    ]);
    await dial.waitSvg(
      (svg) =>
        svg.includes('data-state="active"') &&
        svg.includes(">75% (0.75x)<") &&
        svg.includes(">Paused<") &&
        svg.includes(">Deck B<")
    );
    expect(server.visualSidechainCallLog.filter((c) => c.requestType === "get_decks")).toHaveLength(1);
  });

  it("rides speed along the ladder on dial turn and executes all five key/dial operations via deck_command", async () => {
    let nowMs = 1_700_000_000_000;
    const advance = (ms: number): number => {
      nowMs += ms;
      return nowMs;
    };
    const { server, client, tapeDecks } = await setup(
      { missingPlugin: true, visualSidechainVendor: "decks" },
      [makeDeck({ source: "Deck A", speed_percent: 100, effective_speed_percent: 100, playing: true })]
    );
    await vi.waitFor(() => expect(tapeDecks.sample("Deck A").state).toBe("active"));

    const dial = deckSink();
    const dialCtrl = new TapeDeckInstanceController(
      tapeDecks,
      client,
      dial.sink,
      "dial",
      { deck: "Deck A", operation: "play_pause" },
      () => nowMs
    );
    cleanup.push(() => dialCtrl.disappear());
    dialCtrl.appear();
    await dial.waitSvg((svg) => svg.includes(">100% (1x)<") && svg.includes(">Playing<"));

    // Turn +2 rungs: 100% -> 125% -> 150% (1.5x)
    await dialCtrl.rotate(2, advance(150));
    await dial.waitSvg((svg) => svg.includes(">150% (1.5x)<"));

    // Press play_pause -> Paused
    await dialCtrl.press(advance(150));
    await dial.waitSvg((svg) => svg.includes(">Paused<"));

    // Configure key operations: speed_up, speed_down, normal_speed, cue_to_start
    const key = deckSink();
    const keyCtrl = new TapeDeckInstanceController(
      tapeDecks,
      client,
      key.sink,
      "key",
      { deck: "Deck A", operation: "speed_up" },
      () => nowMs
    );
    cleanup.push(() => keyCtrl.disappear());
    keyCtrl.appear();

    await keyCtrl.press(advance(150));
    await key.waitSvg((svg) => svg.includes(">200% (2x)<"));

    keyCtrl.updateSettings({ deck: "Deck A", operation: "speed_down" });
    await keyCtrl.press(advance(150));
    await key.waitSvg((svg) => svg.includes(">150% (1.5x)<"));

    keyCtrl.updateSettings({ deck: "Deck A", operation: "normal_speed" });
    await keyCtrl.press(advance(150));
    await key.waitSvg((svg) => svg.includes(">100% (1x)<"));

    keyCtrl.updateSettings({ deck: "Deck A", operation: "cue_to_start" });
    await keyCtrl.press(advance(150));
    expect(
      server.visualSidechainCallLog.some(
        (c) => c.requestType === "deck_command" && c.requestData.op === "cue_to_start"
      )
    ).toBe(true);
    expect(key.alerts()).toBe(0);
  });

  it("surfaces vendor validation sentences and 604 Update Midi Fadester gates cleanly without silent no-ops", async () => {
    let nowMs = 1_700_000_000_000;
    // 1. Empty tape cue_to_start -> verbatim plain-sentence error + showAlert
    const { client, tapeDecks } = await setup(
      { missingPlugin: true, visualSidechainVendor: "decks" },
      [makeDeck({ source: "Deck A", tape: "", state: "empty", playing: false })]
    );
    await vi.waitFor(() => expect(tapeDecks.sample("Deck A").state).toBe("active"));

    const key = deckSink();
    const keyCtrl = new TapeDeckInstanceController(
      tapeDecks,
      client,
      key.sink,
      "key",
      { deck: "Deck A", operation: "cue_to_start" },
      () => nowMs
    );
    cleanup.push(() => keyCtrl.disappear());
    keyCtrl.appear();

    await expect(tapeDecks.executeOperation("Deck A", "cue_to_start")).rejects.toThrow(
      "Cue to start needs a tape loaded in 'Deck A'."
    );

    nowMs += 200;
    await keyCtrl.press(nowMs);
    expect(key.alerts()).toBe(1);
    await key.waitSvg((svg) => svg.includes("Cue to start needs a tap"));

    // 2. Older Visual Sidechain (0.6.0: get_decks works, deck_command returns 604) -> "Update Midi Fadester"
    const legacy = await setup(
      { missingPlugin: true, visualSidechainVendor: "legacy" },
      [makeDeck({ source: "Legacy Deck" })]
    );
    await vi.waitFor(() => expect(legacy.tapeDecks.sample("Legacy Deck").state).toBe("active"));

    const legDial = deckSink();
    const legCtrl = new TapeDeckInstanceController(
      legacy.tapeDecks,
      legacy.client,
      legDial.sink,
      "dial",
      { deck: "Legacy Deck" },
      () => nowMs
    );
    cleanup.push(() => legCtrl.disappear());
    legCtrl.appear();

    nowMs += 200;
    await legCtrl.press(nowMs);
    expect(legDial.alerts()).toBe(1);
    await legDial.waitSvg((svg) => svg.includes("Update Midi Fadester"));
  });

  it("caps cell redraws to at most 10 per second under rapid decks_changed bursts and translates labels", async () => {
    vi.useFakeTimers();
    try {
      let nowMs = 1_700_000_000_000;
      const server = new FakeObsServer({ missingPlugin: true, visualSidechainVendor: "decks" });
      server.visualSidechainDecks = [makeDeck({ speed_percent: 100, effective_speed_percent: 100 })];
      const port = await server.start();
      const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
      const tapeDecks = new TapeDecks(client);
      cleanup.push(() => client.stop(), () => server.stop());

      const s = deckSink();
      const ctrl = new TapeDeckInstanceController(
        tapeDecks,
        client,
        s.sink,
        "key",
        { deck: "Deck A", operation: "cue_to_start" },
        () => nowMs
      );
      cleanup.push(() => ctrl.disappear());
      ctrl.appear();

      // Directly feed 25 rapid decks_changed payloads inside a single 1000 ms window (every 40 ms).
      const before = s.svgs.length;
      for (let i = 0; i < 25; i++) {
        nowMs += 40;
        client.emit("namedVendorEvent", "visual-sidechain", "decks_changed", {
          version: "0.7.0",
          api_version: 1,
          decks: [
            makeDeck({
              speed_percent: 100 + i * 5,
              effective_speed_percent: 100 + i * 5
            })
          ]
        });
        await vi.advanceTimersByTimeAsync(40);
      }
      const renderedInOneSecond = s.svgs.length - before;
      expect(renderedInOneSecond).toBeLessThanOrEqual(11);

      // Language switch updates the drawn title immediately.
      nowMs += 200;
      setLanguage("de", deckTable("de"));
      await vi.advanceTimersByTimeAsync(120);
      expect(s.last()).toContain("Zum Anfang");
    } finally {
      vi.useRealTimers();
    }
  });

  it("populates Browser Source names from get_decks in ui/tape-deck.html and broadcasts via DirectObsPropertyInspectorBridge", async () => {
    const { client, tapeDecks } = await setup(
      { missingPlugin: true, visualSidechainVendor: "decks" },
      [
        makeDeck({ source: "Deck Left", deck_id: "d1" }),
        makeDeck({ source: "Deck Right", deck_id: "d2" })
      ]
    );
    await vi.waitFor(() => expect(tapeDecks.getDecks()).toHaveLength(2));

    const sentToPi: Array<Record<string, unknown>> = [];
    const bridge = new DirectObsPropertyInspectorBridge(
      client,
      {
        sendToPropertyInspector: (payload) => sentToPi.push(payload),
        persistGlobalSettings: async () => {}
      },
      undefined,
      tapeDecks
    );
    await bridge.handleMessage({ event: "directPiReady" });
    const latest = sentToPi.at(-1)!;
    expect(latest.tapeDecks).toMatchObject({
      availability: "loaded",
      deckCommandUnsupported: false
    });

    // Run shipped ui/tape-deck.html in MiniDocument VM and verify dropdown + selection save.
    const uiDir = join(PLUGIN_DIR, "ui");
    const html = readFileSync(join(uiDir, "tape-deck.html"), "utf8");
    const document: MiniDocument = documentFromPage(html);
    const sockets: Array<{ sent: Array<Record<string, unknown>>; onopen?: () => void; onmessage?: (ev: { data: string }) => void }> = [];
    class FakeWs {
      public static readonly OPEN = 1;
      public readyState = 1;
      public readonly sent: Array<Record<string, unknown>> = [];
      public onopen?: () => void;
      public onmessage?: (ev: { data: string }) => void;
      public constructor() {
        sockets.push(this);
      }
      public send(data: string): void {
        this.sent.push(JSON.parse(data) as Record<string, unknown>);
      }
    }
    const ctx: Record<string, unknown> = {
      document,
      WebSocket: FakeWs,
      console,
      localStorage: { getItem: () => null, setItem: () => {} },
      setTimeout: () => 1,
      clearTimeout: () => {}
    };
    ctx.window = ctx;
    createContext(ctx);
    for (const [, src, inline] of html.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g)) {
      runInContext(src ? readFileSync(join(uiDir, src), "utf8") : inline, ctx);
    }
    (ctx.connectElgatoStreamDeckSocket as (...args: string[]) => void)(
      "28196",
      "pi-td",
      "registerPropertyInspector",
      JSON.stringify({ application: { language: "en" } }),
      JSON.stringify({
        action: "io.github.jbrick2070.fadester-for-obs.tape-deck",
        payload: { settings: {}, controller: "Encoder" }
      })
    );
    const ws = sockets[0];
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ event: "sendToPropertyInspector", payload: latest }) });

    const deckSelect = document.getElementById("td-deck") as MiniElement;
    expect(deckSelect.options.map((o) => o.value)).toEqual(["", "Deck Left", "Deck Right"]);
    deckSelect.value = "Deck Right";
    deckSelect.onchange?.();
    const setSettingsMsg = ws.sent.find((m) => m.event === "setSettings");
    expect((setSettingsMsg?.payload as Record<string, unknown>)?.deck).toBe("Deck Right");
  });
});
