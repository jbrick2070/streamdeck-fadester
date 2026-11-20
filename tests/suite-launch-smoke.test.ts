// SPDX-License-Identifier: GPL-2.0-or-later
// The packaged plugin, started as Stream Deck starts it (G-02): the built entry bin/plugin.js (the suite launcher)
// against a pretend host. It must register, start both of its plugins (Fadester and VJster) from the built files, and
// each must answer a key that appears. Skipped when the plugin is not built; the release workflow builds it first and
// runs this on Linux, Windows and macOS.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { VJSTER_NAMESPACE, suiteActionId } from "../src/suite/actions.js";

const PLUGIN_DIR = resolve("io.github.jbrick2070.fadester-for-obs.sdPlugin");
const ENTRY = join(PLUGIN_DIR, "bin", "plugin.js");
const built = existsSync(ENTRY) && existsSync(join(PLUGIN_DIR, "bin", "fadester.js")) && existsSync(join(PLUGIN_DIR, "bin", "vjster", "plugin.js"));
const UUID = "io.github.jbrick2070.fadester-for-obs";
const SCENE_ACTION = `${UUID}.scene-transition`;

/** A port nothing listens on: taken and given back, so a connection to it is refused at once. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

type Message = Record<string, unknown> & { event?: string; context?: string };

describe.skipIf(!built)("the built plugin starts as Stream Deck starts it (G-02)", () => {
  let host: WebSocketServer | undefined;
  let plugin: ChildProcess | undefined;

  afterEach(async () => {
    plugin?.kill();
    plugin = undefined;
    await new Promise<void>((done) => (host ? host.close(() => done()) : done()));
    host = undefined;
  });

  it("registers once, and both the Fadester and the VJster plugin inside it draw a key that appears", async () => {
    const obsPort = await closedPort();
    const linkPort = await closedPort();
    host = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((done) => host!.once("listening", () => done()));
    const hostPort = (host.address() as { port: number }).port;
    const received: Message[] = [];
    let socket: WebSocket | undefined;
    host.on("connection", (ws) => {
      socket = ws;
      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as Message;
        received.push(message);
        // The stored settings: an OBS address where nothing answers (never the OBS on this computer: a typed
        // password and a host that is not "this computer" switch every saved-settings read off), and a link port
        // of the test's own, so a real VJster on 48150 is left alone.
        if (message.event === "getGlobalSettings") {
          ws.send(JSON.stringify({
            event: "didReceiveGlobalSettings",
            ...(message.id !== undefined ? { id: message.id } : {}),
            payload: { settings: { host: "127.0.0.2", port: obsPort, password: "smoke-test", [VJSTER_NAMESPACE]: { port: linkPort } } }
          }));
        }
      });
    });
    const info = {
      application: { font: "", language: "en", platform: process.platform === "darwin" ? "mac" : "windows", platformVersion: "10.0.26200", version: "7.4.2.22730" },
      colors: {},
      devicePixelRatio: 1,
      devices: [{ id: "smoke-device", name: "Stream Deck", size: { columns: 5, rows: 3 }, type: 0 }],
      plugin: { uuid: UUID, version: "0.0.0.0" }
    };
    let output = "";
    plugin = spawn(process.execPath, [ENTRY, "-port", String(hostPort), "-pluginUUID", UUID, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], {
      cwd: PLUGIN_DIR,
      stdio: ["ignore", "pipe", "pipe"]
    });
    plugin.stdout?.on("data", (chunk) => { output += String(chunk); });
    plugin.stderr?.on("data", (chunk) => { output += String(chunk); });
    const until = async (what: string, check: () => boolean, ms = 30000): Promise<void> => {
      const start = Date.now();
      while (!check()) {
        if (Date.now() - start > ms) throw new Error(`${what}: not within ${ms} ms. Plugin output: ${output.slice(-1500)}`);
        await new Promise((done) => setTimeout(done, 50));
      }
    };

    await until("the plugin registers", () => received.some((message) => message.event === "registerPlugin" && message.uuid === UUID));
    expect(received.filter((message) => message.event === "registerPlugin")).toHaveLength(1);

    const appear = (action: string, context: string): void => {
      socket!.send(JSON.stringify({
        event: "willAppear", action, context, device: "smoke-device",
        payload: { controller: "Keypad", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings: {} }
      }));
    };
    // Sent again until answered: a child that is still starting gets what is showing when it has registered.
    const drawn = (context: string): boolean => received.some((message) => message.event === "setImage" && message.context === context);
    const showUntilDrawn = async (action: string, context: string): Promise<void> => {
      appear(action, context);
      await until(`${action} draws its key`, () => drawn(context));
    };
    await showUntilDrawn(SCENE_ACTION, "smoke-fadester-key");
    await showUntilDrawn(suiteActionId("speed-preset"), "smoke-vjster-key");
    // Both drew a picture of their own (an SVG data URI), and neither ended.
    for (const context of ["smoke-fadester-key", "smoke-vjster-key"]) {
      const image = received.find((message) => message.event === "setImage" && message.context === context)!.payload as { image?: string };
      expect(String(image.image)).toMatch(/^data:image\/svg\+xml/);
    }
    expect(plugin.exitCode).toBeNull();
  }, 90000);
});
