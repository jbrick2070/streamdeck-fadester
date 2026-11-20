// SPDX-License-Identifier: GPL-2.0-or-later
// What a key says at a glance (UI review U2-03, U2-11, U2-15): which scene key is on Program or in Preview, the name
// of OBS's own transition, and "OBS is not there" as a picture and a sentence of its own.
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObsSceneTransitionKeyInstanceController } from "../src/actions/obs-scene-transition-key.js";
import { ON_AIR_TAG_TEXT_WIDTH, renderDirectKeySvg } from "../src/gfx/direct-obs-renderer.js";
import { setLanguage } from "../src/i18n/strings.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";
import { deckTable } from "./helpers/languages.js";

const decode = (image: string): string => decodeURIComponent(image.slice("data:image/svg+xml;utf8,".length));

describe("a key's picture says what is on air and what is wrong", () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    setLanguage("en", null);
    for (const step of cleanup.splice(0)) await step();
  });

  it("marks a working key whose scene is on Program or in Preview with a frame and the word, never by colour alone", () => {
    const base = { connected: true, reason: "", title: "Opening", subtitle: "Scene 1 · Fade", configured: true, icon: "scene" as const };
    const plain = renderDirectKeySvg(base);
    expect(plain).not.toContain("data-on-air");
    const program = renderDirectKeySvg({ ...base, onAir: "program" });
    expect(program).toContain('data-on-air="program"');
    expect(program).toContain(">PROGRAM<");
    expect(program).toContain('stroke="#EF4444" stroke-width="5"');
    const preview = renderDirectKeySvg({ ...base, onAir: "preview" });
    expect(preview).toContain(">PREVIEW<");
    expect(preview).toContain('stroke="#22C55E" stroke-width="5"');
    // The key keeps its name and what it does.
    for (const svg of [program, preview]) {
      expect(svg).toContain(">Opening<");
      expect(svg).toContain(">Scene 1 · Fade<");
    }
    // A key that cannot work is not marked: its problem is what it shows.
    expect(renderDirectKeySvg({ ...base, onAir: "program", problem: "Scene unavailable" })).not.toContain("data-on-air");
    expect(renderDirectKeySvg({ ...base, onAir: "program", connected: false, reason: "OBS not connected" })).not.toContain("data-on-air");
    // OBS's own words in the deck's language, fitted to the tag.
    setLanguage("de", deckTable("de"));
    const german = renderDirectKeySvg({ ...base, onAir: "program" });
    expect(german).toContain(">PROGRAMM<");
    expect(ON_AIR_TAG_TEXT_WIDTH).toBeLessThanOrEqual(76 - 6);
  });

  it("says 'OBS is not there' large, with a picture of its own, and keeps the key's name small", () => {
    const offline = renderDirectKeySvg({ connected: false, reason: "Turn on OBS WebSocket", title: "Opening", subtitle: "Scene 1 · Fade", configured: true, icon: "scene" });
    expect(offline).toContain('data-offline="true"');
    // The instruction is the large text (on two lines), the key's own name is in the band below.
    expect(offline).toContain(">Turn on OBS<");
    expect(offline).toContain(">WebSocket<");
    expect(offline).toMatch(/font-size="9"[^>]*>Opening</);
    expect(offline).toContain("<title>Opening — Turn on OBS WebSocket</title>");
    // A problem of the key itself keeps the warning triangle and the key's name large; no broken link.
    const problem = renderDirectKeySvg({ connected: true, reason: "", title: "Opening", problem: "Scene unavailable", configured: true, icon: "scene" });
    expect(problem).not.toContain("data-offline");
    expect(problem).toContain('<path d="M60 19 80 52H40Z"/>');
    expect(offline).not.toContain('<path d="M60 19 80 52H40Z"/>');
    // An unset key is neither.
    expect(renderDirectKeySvg({ connected: false, reason: "OBS not connected", title: "", configured: false })).not.toContain("data-offline");
  });

  it("a scene key shows whether its scene is on Program or in Preview, and OBS's own transition by name", async () => {
    const server = new FakeObsServer({ missingPlugin: true, studioMode: false });
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    cleanup.push(() => client.stop(), () => server.stop());
    const ready = once(client, "connectionReady", { signal: AbortSignal.timeout(3000) });
    client.start();
    await ready;
    const key = (sceneTarget: string, operation: "transition" | "cut" = "transition") => {
      const images: string[] = [];
      const controller = new ObsSceneTransitionKeyInstanceController(client, {
        setImage: async (image: string) => { images.push(decode(image)); },
        showAlert: async () => {}
      }, { sceneTarget, operation }, 10);
      cleanup.push(() => controller.disappear());
      controller.appear();
      return { last: () => images.at(-1) ?? "" };
    };
    const live = key("Scene Live");
    const next = key("Scene Preview");
    const other = key("Scene 3");
    const toProgram = key("__current_preview__");
    const role = key("__next_scene__");
    await vi.waitFor(() => expect(live.last()).toContain('data-on-air="program"'));
    // Regular mode: no Preview, so only the Program scene's key is marked.
    expect(next.last()).not.toContain("data-on-air");
    expect(other.last()).not.toContain("data-on-air");
    // OBS's selected transition is named in place of the general word.
    await vi.waitFor(() => expect(role.last()).toContain(">Next · Fade<"));
    expect(role.last()).not.toContain("Transition");

    server.setStudioModeExternally(true);
    await vi.waitFor(() => expect(next.last()).toContain('data-on-air="preview"'));
    expect(live.last()).toContain('data-on-air="program"');
    expect(other.last()).not.toContain("data-on-air");
    // The key that puts Preview on Program is not a scene's key: it carries no mark, and no "take".
    await vi.waitFor(() => expect(toProgram.last()).toContain(">To Program · Fade<"));
    expect(toProgram.last()).not.toContain("data-on-air");
    expect(toProgram.last()).not.toMatch(/\btake\b/i);

    // Program changes: the mark moves with it.
    server.emitObsEvent("CurrentProgramSceneChanged", { sceneName: "Scene 3" });
    await vi.waitFor(() => expect(other.last()).toContain('data-on-air="program"'));
    await vi.waitFor(() => expect(live.last()).not.toContain("data-on-air"));

    // OBS goes away: every key says so, none claims to be on air.
    await server.stop();
    await vi.waitFor(() => expect(other.last()).toContain('data-offline="true"'), { timeout: 5000 });
    expect(other.last()).not.toContain("data-on-air");
  }, 15000);
});
