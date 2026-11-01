// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import {
  PlaylisterTransportInstanceController,
  describeMediaState,
  formatMediaClock
} from "../src/actions/playlister-transport-key.js";
import { setLanguage } from "../src/i18n/strings.js";
import { FakeObsServer, FakeObsServerOptions } from "./helpers/fake-obs-server.js";
import { deckTable } from "./helpers/languages.js";

/**
 * The Playlister transport key (PLAN.md 9.3, R-PLT-1, R-PLT-6): what it draws
 * from the client's observed state and what a press sends, against the fake OBS.
 */
describe("Playlister transport key", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  function keySink() {
    const images: string[] = [];
    let alerts = 0;
    return {
      sink: {
        setImage: async (image: string) => { images.push(decodeURIComponent(image.replace("data:image/svg+xml;utf8,", ""))); },
        showAlert: async () => { alerts++; }
      },
      last: (): string => images.at(-1) ?? "",
      alerts: (): number => alerts,
      waitImage: (predicate: (svg: string) => boolean): Promise<void> =>
        vi.waitFor(() => expect(predicate(images.at(-1) ?? ""), images.at(-1)).toBe(true), { timeout: 3000 })
    };
  }

  async function connect(options: FakeObsServerOptions = {}): Promise<{ server: FakeObsServer; client: DirectObsClient; reel: string }> {
    const server = new FakeObsServer({ missingPlugin: true, ...options });
    const reel = server.addPlaylister("Reel", { durationMs: 90000, cursorMs: 1000 }).inputUuid;
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    cleanup.push(() => client.stop(), () => server.stop());
    const connected = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await connected;
    return { server, client, reel };
  }

  afterEach(async () => {
    setLanguage("en", null);
    for (const step of cleanup.splice(0)) await step();
  });

  it("draws the observed state word and time, and the connection, missing, wrong-kind, unsupported and RPC problems", async () => {
    const { server, client, reel } = await connect();
    const model = server.mediaInputs.get(reel)!;
    const { sink, alerts, waitImage, last } = keySink();
    const key = new PlaylisterTransportInstanceController(client, sink, { inputUuid: "", operation: "playpause" }, 16);
    cleanup.push(() => key.disappear());
    key.appear();
    // Unbound: the operation word stays, "Choose a Playlister" replaces the subtitle, the plus glyph shows.
    await waitImage((svg) => svg.includes(">Play / pause<") && svg.includes(">Choose a Playlister<") && svg.includes('d="M60 21v28M46 35h28"'));
    const command = vi.spyOn(client, "mediaCommand");
    await key.handleKeyDown();
    expect(command).not.toHaveBeenCalled();
    expect(alerts()).toBe(1);

    key.updateSettings({ inputUuid: reel, operation: "status" });
    await waitImage((svg) => svg.includes(">Status<") && svg.includes(">Stopped<") && svg.includes('data-icon="status"'));
    model.state = "OBS_MEDIA_STATE_PLAYING";
    model.cursorMs = 61000;
    await waitImage((svg) => svg.includes(">Playing 1:01/1:30<"));
    model.durationMs = 7200000;
    model.cursorMs = 7200000;
    await waitImage((svg) => svg.includes(">Playing 2:00:00/2:00:00<"));
    model.state = "OBS_MEDIA_STATE_PAUSED";
    await waitImage((svg) => svg.includes(">Paused 2:00:00/2:00:00<"));
    // A held still: PLAYING with no duration draws the word alone.
    model.state = "OBS_MEDIA_STATE_PLAYING";
    model.durationMs = 0;
    await waitImage((svg) => svg.includes(">Playing<"));
    expect(formatMediaClock(59999)).toBe("0:59");
    expect(formatMediaClock(5999000)).toBe("99:59");
    expect(formatMediaClock(6000000)).toBe("1:40:00");
    // The subtitle words the client's state without inventing a time or an outcome.
    const observed = { availability: "ok" as const, mediaState: "playing" as const, mediaCursor: 1500, mediaDuration: null, pending: "none" as const, queued: 0 };
    expect(describeMediaState(observed)).toBe("Playing");
    expect(describeMediaState({ ...observed, mediaDuration: 4000 })).toBe("Playing 0:01/0:04");
    expect(describeMediaState({ ...observed, pending: "play" })).toBe("Play sent");
    expect(describeMediaState({ ...observed, pending: "pause" })).toBe("Pause sent");
    expect(describeMediaState({ ...observed, pending: "unconfirmed" })).toBe("Sent, unconfirmed");
    expect(describeMediaState({ ...observed, pending: "pause", queued: 4 })).toBe("Busy");
    expect(describeMediaState({ ...observed, mediaState: "unknown" })).toBe("Unknown");

    key.updateSettings({ inputUuid: "no-such-input", operation: "next" });
    await waitImage((svg) => svg.includes(">Next<") && svg.includes(">Playlister missing<") && svg.includes('d="M60 19 80 52H40Z"'));
    const desktop = client.getCatalog().inputDetails.find((input) => input.inputName === "Desktop Audio")!.inputUuid;
    key.updateSettings({ inputUuid: desktop, operation: "next" });
    await waitImage((svg) => svg.includes(">Not a Playlister<"));

    // A failed request is this key's problem until the next observed state change.
    key.updateSettings({ inputUuid: reel, operation: "next" });
    await waitImage((svg) => svg.includes(">Playing<"));
    server.mediaFailNext = "Playlister refused.";
    await key.handleKeyDown();
    expect(alerts()).toBe(2);
    await waitImage((svg) => svg.includes(">Playlister refused.<"));
    model.state = "OBS_MEDIA_STATE_STOPPED";
    await waitImage((svg) => svg.includes(">Stopped<") && !svg.includes("refused"));

    // A German deck draws the German state word.
    setLanguage("de", deckTable("de"));
    model.state = "OBS_MEDIA_STATE_ENDED";
    await waitImage((svg) => svg.includes(">Beendet<") && svg.includes(">Weiter<"));
    setLanguage("en", null);

    // An OBS without the media requests.
    const limited = await connect({ availableRequests: ["GetInputList", "GetMediaInputStatus"] });
    const other = keySink();
    const unsupported = new PlaylisterTransportInstanceController(limited.client, other.sink, { inputUuid: limited.reel, operation: "stop" }, 16);
    cleanup.push(() => unsupported.disappear());
    unsupported.appear();
    await other.waitImage((svg) => svg.includes(">Stop<") && svg.includes(">Update OBS<"));
    await unsupported.handleKeyDown();
    expect(other.alerts()).toBe(1);
    expect(limited.server.mediaActionAttempts).toBe(0);

    // OBS gone: the connection reason, as every direct key draws it.
    await server.stop();
    await waitImage((svg) => svg.includes("websocket is off"));
    expect(last()).not.toContain("Stopped");
  }, 15000);

  it("a Status press sends nothing, another press sends one request, and overflow shows busy without a request", async () => {
    const { server, client, reel } = await connect({ mediaActionDelayMs: 400 });
    const { sink, alerts, waitImage } = keySink();
    const key = new PlaylisterTransportInstanceController(client, sink, { inputUuid: reel, operation: "status" }, 16);
    cleanup.push(() => key.disappear());
    key.appear();
    await waitImage((svg) => svg.includes(">Stopped<"));
    await key.handleKeyDown();
    await key.handleKeyDown();
    expect(server.mediaActionAttempts).toBe(0);
    expect(alerts()).toBe(0);

    key.updateSettings({ inputUuid: reel, operation: "next" });
    await key.handleKeyDown();
    expect(server.directCallLog.map((call) => call.requestData?.mediaAction)).toEqual(["OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT"]);
    expect(alerts()).toBe(0);

    const presses = [key.handleKeyDown(), key.handleKeyDown(), key.handleKeyDown(), key.handleKeyDown()];
    await vi.waitFor(() => expect(server.mediaActionAttempts).toBe(2));
    // Four queued: the busy word, before any press was refused.
    await waitImage((svg) => svg.includes(">Busy<"));
    await key.handleKeyDown();
    expect(alerts()).toBe(1);
    expect(server.mediaActionAttempts).toBe(2);
    await waitImage((svg) => svg.includes("Playlister is busy"));
    await Promise.all(presses);
    expect(server.mediaActionAttempts).toBe(5);
    expect(server.directCallLog).toHaveLength(5);
    // Presses that Stop purges settle quietly: no alert, no problem.
    const queued = [key.handleKeyDown(), key.handleKeyDown(), key.handleKeyDown()];
    await vi.waitFor(() => expect(server.mediaActionAttempts).toBe(6));
    key.updateSettings({ inputUuid: reel, operation: "stop" });
    await key.handleKeyDown();
    await Promise.all(queued);
    expect(alerts()).toBe(1);
    expect(server.directCallLog.slice(5).map((call) => call.requestData?.mediaAction))
      .toEqual(["OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT", "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP"]);
    await waitImage((svg) => svg.includes(">Stopped<") && !svg.includes("busy"));
  }, 15000);

  it("acquires and releases its watch on appear, retarget and disappear, and drops a rejection from the old target after a retarget", async () => {
    const offline = new DirectObsClient();
    const watches: Array<{ uuid: string; release: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(offline, "watchMedia").mockImplementation((uuid: string) => {
      const release = vi.fn();
      watches.push({ uuid, release });
      return release;
    });
    const { sink } = keySink();
    const key = new PlaylisterTransportInstanceController(offline, sink, { inputUuid: "reel-a", operation: "next" }, 16);
    // Invisible keys hold no watch, retargeted or not.
    key.updateSettings({ inputUuid: "reel-b", operation: "next" });
    expect(watches).toEqual([]);
    key.appear();
    expect(watches.map((watch) => watch.uuid)).toEqual(["reel-b"]);
    key.updateSettings({ inputUuid: "reel-c", operation: "next" });
    expect(watches[0].release).toHaveBeenCalledTimes(1);
    expect(watches.map((watch) => watch.uuid)).toEqual(["reel-b", "reel-c"]);
    // The same target with another operation keeps its watch.
    key.updateSettings({ inputUuid: "reel-c", operation: "stop" });
    expect(watches).toHaveLength(2);
    key.disappear();
    key.disappear();
    expect(watches[1].release).toHaveBeenCalledTimes(1);
    expect(offline.listenerCount("mediaStateChanged")).toBe(0);
    key.appear();
    // A second appear without a disappear doubles nothing.
    key.appear();
    expect(watches.map((watch) => watch.uuid)).toEqual(["reel-b", "reel-c", "reel-c", "reel-c"]);
    expect(watches[2].release).toHaveBeenCalledTimes(1);
    expect(offline.listenerCount("mediaStateChanged")).toBe(1);
    key.disappear();
    expect(watches[3].release).toHaveBeenCalledTimes(1);
    expect(offline.listenerCount("statusChanged")).toBe(1);
    vi.restoreAllMocks();

    // A rejection from the old target after a retarget is dropped: no alert, no problem.
    const { server, client, reel } = await connect({ mediaActionDelayMs: 200 });
    const bumper = server.addPlaylister("Bumper").inputUuid;
    await vi.waitFor(() => expect(client.getCatalog().inputDetails.some((input) => input.inputUuid === bumper)).toBe(true));
    const live = keySink();
    const retargeted = new PlaylisterTransportInstanceController(client, live.sink, { inputUuid: reel, operation: "next" }, 16);
    cleanup.push(() => retargeted.disappear());
    retargeted.appear();
    await live.waitImage((svg) => svg.includes(">Stopped<"));
    server.mediaFailNext = "Late failure.";
    const press = retargeted.handleKeyDown();
    retargeted.updateSettings({ inputUuid: bumper, operation: "next" });
    await press;
    expect(live.alerts()).toBe(0);
    await live.waitImage((svg) => svg.includes(">Stopped<"));
    expect(live.last()).not.toContain("Late failure");
    expect(server.mediaActionAttempts).toBe(1);
  });
});
