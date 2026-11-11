// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { VjlinkController } from "../src/control/vjlink.js";
import { VjlinkInstanceController } from "../src/actions/vjlink-control.js";
import { normalizeVjlinkSettings, VjlinkSettings } from "../src/types/settings.js";
import { setLanguage } from "../src/i18n/strings.js";
import { FakeObsServer, fakeVjlink } from "./helpers/fake-obs-server.js";
import { deckTable } from "./helpers/languages.js";

/**
 * VJLink keys and dials against the fake OBS with a fake VJLink (vendor
 * "obs-vjlink", answered as obs-vjlink's websocket_handler.c answers): what a
 * press or a turn sends, what the control draws, a missing VJLink, VJLink's own
 * refusals, and reading VJLink only while a control is on screen.
 */
describe("VJLink keys and dials", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  async function connect(installed = true): Promise<{ server: FakeObsServer; client: DirectObsClient; vjlink: VjlinkController }> {
    const server = new FakeObsServer({ missingPlugin: true });
    if (installed) server.vjlink = fakeVjlink();
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const vjlink = new VjlinkController(client, 40, 60);
    cleanup.push(() => vjlink.dispose(), () => client.stop(), () => server.stop());
    const connected = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await connected;
    return { server, client, vjlink };
  }

  function control(vjlink: VjlinkController, dial: boolean, settings: VjlinkSettings) {
    const images: string[] = [];
    let alerts = 0;
    const instance = new VjlinkInstanceController(vjlink, {
      render: async (svg: string) => { images.push(svg); },
      showAlert: async () => { alerts++; }
    }, dial, settings, 5);
    instance.appear(settings);
    cleanup.push(() => instance.disappear());
    return {
      instance,
      alerts: (): number => alerts,
      last: (): string => images.at(-1) ?? "",
      waitImage: (predicate: (svg: string) => boolean): Promise<void> =>
        vi.waitFor(() => expect(predicate(images.at(-1) ?? ""), images.at(-1)).toBe(true), { timeout: 3000 })
    };
  }

  const sent = (server: FakeObsServer): string[] => server.vjlinkCallLog.map((call) => call.requestType).filter((type) => type !== "GetState");
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  afterEach(async () => {
    setLanguage("en", null);
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  it("normalizes settings: unknown values fall back, the step is one of 1, 2, 5 or 10 percent", () => {
    expect(normalizeVjlinkSettings(undefined)).toEqual({
      keyOperation: "next", presetName: "", macro: "energy", stepPercent: 2, dialPress: "tap", labelOverride: "", accent: "default"
    });
    expect(normalizeVjlinkSettings({ keyOperation: "explode" as never, macro: "volume" as never, stepPercent: 3, dialPress: "x" as never,
      presetName: `  ${"p".repeat(80)}  ` })).toMatchObject({ keyOperation: "next", macro: "energy", stepPercent: 2, dialPress: "tap", presetName: "p".repeat(64) });
    expect(normalizeVjlinkSettings({ stepPercent: 10, macro: "react", dialPress: "none" })).toMatchObject({ stepPercent: 10, macro: "react", dialPress: "none" });
  });

  it("a Next key steps VJLink's preset and draws the new one; Previous wraps round", async () => {
    const { server, vjlink } = await connect();
    const next = control(vjlink, false, { keyOperation: "next" });
    await next.waitImage((svg) => svg.includes("Next preset") && svg.includes("Preset 1"));
    await next.instance.keyDown();
    expect(sent(server)).toEqual(["NextPreset"]);
    expect(server.vjlink?.presetIndex).toBe(1);
    await next.waitImage((svg) => svg.includes("Preset 2"));
    const previous = control(vjlink, false, { keyOperation: "previous" });
    await previous.instance.keyDown();
    await previous.instance.keyDown();
    expect(server.vjlink?.presetIndex).toBe(2);
    await previous.waitImage((svg) => svg.includes("Previous preset") && svg.includes("Preset 3"));
    expect(next.alerts() + previous.alerts()).toBe(0);
  });

  it("a Preset key selects by name; VJLink's own words come back for a name it does not have", async () => {
    const { server, vjlink } = await connect();
    const key = control(vjlink, false, { keyOperation: "preset", presetName: "Strobe" });
    await key.waitImage((svg) => svg.includes("Strobe") && svg.includes("Go to preset"));
    await key.instance.keyDown();
    expect(server.vjlinkCallLog.find((call) => call.requestType === "SetPreset")?.requestData).toEqual({ preset_name: "Strobe" });
    expect(server.vjlink?.presetIndex).toBe(2);
    key.instance.updateSettings({ keyOperation: "preset", presetName: "Nope" });
    await key.instance.keyDown();
    expect(key.alerts()).toBe(1);
    await key.waitImage((svg) => svg.includes("Preset not found"));
    expect(server.vjlink?.presetIndex).toBe(2);
  });

  it("a Preset key without a name asks for one and sends nothing", async () => {
    const { server, vjlink } = await connect();
    const key = control(vjlink, false, { keyOperation: "preset", presetName: "   " });
    await key.waitImage((svg) => svg.includes("Type a preset name"));
    await key.instance.keyDown();
    expect(key.alerts()).toBe(1);
    expect(sent(server)).toEqual([]);
    expect(key.last()).toContain("Type a preset name");
  });

  it("Tap BPM taps VJLink's tempo and draws the BPM it reports", async () => {
    const { server, vjlink } = await connect();
    const key = control(vjlink, false, { keyOperation: "tap" });
    await key.waitImage((svg) => svg.includes("Tap BPM") && svg.includes("120 BPM"));
    await key.instance.keyDown();
    expect(sent(server)).toEqual(["TapBPM"]);
    await key.waitImage((svg) => svg.includes("128 BPM"));
  });

  it("Blackout toggles VJLink's blackout and the key shows which way it stands", async () => {
    const { server, vjlink } = await connect();
    const key = control(vjlink, false, { keyOperation: "blackout" });
    await key.waitImage((svg) => svg.includes("Blackout") && svg.includes(">OFF<"));
    await key.instance.keyDown();
    expect(server.vjlink?.blackout).toBe(true);
    await key.waitImage((svg) => svg.includes(">ON<") && svg.includes('data-icon="look-off"'));
    await key.instance.keyDown();
    expect(server.vjlink?.blackout).toBe(false);
    await key.waitImage((svg) => svg.includes(">OFF<") && svg.includes('data-icon="look-on"'));
    expect(sent(server)).toEqual(["Blackout", "Blackout"]);
  });

  it("a dial rides one macro in steps of its notch size and clamps at 0 and 100 %", async () => {
    const { server, vjlink } = await connect();
    const dial = control(vjlink, true, { macro: "energy", stepPercent: 5 });
    await dial.waitImage((svg) => svg.includes("Energy · VJLink") && svg.includes("50 %"));
    await dial.instance.rotate(2);
    expect(server.vjlink?.macros.energy).toBeCloseTo(0.6, 5);
    await dial.waitImage((svg) => svg.includes("60 %"));
    await dial.instance.rotate(20);
    expect(server.vjlink?.macros.energy).toBe(1);
    await dial.waitImage((svg) => svg.includes("100 %"));
    await dial.instance.rotate(-40);
    expect(server.vjlink?.macros.energy).toBe(0);
    await dial.waitImage((svg) => svg.includes(">0 %<"));
    // Only the chosen macro was ever sent.
    const sets = server.vjlinkCallLog.filter((call) => call.requestType === "SetMacros").map((call) => Object.keys(call.requestData));
    expect(sets.every((keys) => keys.length === 1 && keys[0] === "energy")).toBe(true);
    // Every value sent stays within the macro's 0..1, whatever the turns asked for.
    const values = server.vjlinkCallLog.filter((call) => call.requestType === "SetMacros").map((call) => call.requestData.energy as number);
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(server.vjlink?.macros.chaos).toBe(0.2);
  });

  it("quick turns while a send travels arrive as the newest value, and a read does not pull the dial back", async () => {
    const { server, vjlink } = await connect();
    const dial = control(vjlink, true, { macro: "speed", stepPercent: 1 });
    await dial.waitImage((svg) => svg.includes("Speed · VJLink") && svg.includes("50 %"));
    await Promise.all(Array.from({ length: 10 }, () => dial.instance.rotate(1)));
    await vi.waitFor(() => expect(server.vjlink?.macros.speed).toBeCloseTo(0.6, 5), { timeout: 3000 });
    const sends = server.vjlinkCallLog.filter((call) => call.requestType === "SetMacros").length;
    expect(sends).toBeGreaterThanOrEqual(1);
    expect(sends).toBeLessThan(10);
    await sleep(200);
    expect(dial.last()).toContain("60 %");
  });

  it("a dial's press taps the BPM or blacks out, as chosen; Nothing sends nothing", async () => {
    const { server, vjlink } = await connect();
    const dial = control(vjlink, true, { macro: "color", dialPress: "tap" });
    await dial.waitImage((svg) => svg.includes("Press: tap BPM"));
    await dial.instance.dialDown();
    expect(sent(server)).toEqual(["TapBPM"]);
    dial.instance.updateSettings({ macro: "color", dialPress: "blackout" });
    await dial.instance.dialDown();
    expect(server.vjlink?.blackout).toBe(true);
    await dial.waitImage((svg) => svg.includes("Visuals blacked out"));
    dial.instance.updateSettings({ macro: "color", dialPress: "none" });
    await dial.instance.dialDown();
    expect(sent(server)).toEqual(["TapBPM", "Blackout"]);
  });

  it("with no VJLink in OBS every control says so, and a press alerts without harm", async () => {
    const { vjlink } = await connect(false);
    const key = control(vjlink, false, { keyOperation: "next" });
    const dial = control(vjlink, true, { macro: "energy" });
    await key.waitImage((svg) => svg.includes("VJLink missing"));
    await dial.waitImage((svg) => svg.includes("VJLink missing"));
    expect(vjlink.getState().availability).toBe("missing");
    await key.instance.keyDown();
    expect(key.alerts()).toBe(1);
    await key.waitImage((svg) => svg.includes("VJLink missing"));
    await dial.instance.rotate(1);
    expect(dial.alerts()).toBe(1);
  });

  it("a press while OBS is not connected alerts and sends nothing", async () => {
    const { server, client, vjlink } = await connect();
    client.stop();
    await vi.waitFor(() => expect(client.isConnected()).toBe(false), { timeout: 2000 });
    const key = control(vjlink, false, { keyOperation: "blackout" });
    await key.instance.keyDown();
    expect(key.alerts()).toBe(1);
    expect(sent(server)).toEqual([]);
  });

  it("VJLink is read only while a control is on screen", async () => {
    const { server, vjlink } = await connect();
    const reads = (): number => server.vjlinkCallLog.filter((call) => call.requestType === "GetState").length;
    await sleep(150);
    expect(reads()).toBe(0);
    const key = control(vjlink, false, { keyOperation: "next" });
    await vi.waitFor(() => expect(reads()).toBeGreaterThanOrEqual(3), { timeout: 3000 });
    expect(vjlink.isWatched()).toBe(true);
    key.instance.disappear();
    expect(vjlink.isWatched()).toBe(false);
    const after = reads();
    await sleep(200);
    expect(reads()).toBeLessThanOrEqual(after + 1);
  });

  it("draws in the deck's language", async () => {
    const { vjlink } = await connect();
    setLanguage("de", deckTable("de"));
    const key = control(vjlink, false, { keyOperation: "tap" });
    const dial = control(vjlink, true, { macro: "color" });
    await key.waitImage((svg) => svg.includes("BPM tippen") && svg.includes("120 BPM"));
    await dial.waitImage((svg) => svg.includes("Farbe · VJLink") && svg.includes("Drücken: BPM tippen"));
  });
});
