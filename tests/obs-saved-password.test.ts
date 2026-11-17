// SPDX-License-Identifier: GPL-2.0-or-later
// With no password typed, the plugin signs in with the password OBS saved on this computer, as Fadester
// Companion does (FIX-1 of the 2026-11-17 hand test). A typed password always wins.
import { describe, it, expect, afterEach } from "vitest";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FakeObsServer } from "./helpers/fake-obs-server.js";
import { savedObsPasswordFor } from "../packages/streamdeck-fadester-shared/src/obs/obs-websocket-config.js";

function config(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ server_enabled: true, server_port: 4455, auth_required: true, server_password: "obs-saved", ...over });
}
const reader = (text: string) => () => text;

async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("savedObsPasswordFor", () => {
  it("returns OBS's saved password for a local host on OBS's port", () => {
    expect(savedObsPasswordFor("127.0.0.1", 4455, { readFile: reader(config()) })).toBe("obs-saved");
    expect(savedObsPasswordFor("localhost", 4455, { readFile: reader(config()) })).toBe("obs-saved");
  });

  it("returns nothing for another computer, without reading the file", () => {
    let read = false;
    expect(savedObsPasswordFor("192.168.1.20", 4455, { readFile: () => { read = true; return config(); } })).toBe("");
    expect(read).toBe(false);
  });

  it("returns nothing when the port differs, authentication is off, or the file is missing or broken", () => {
    expect(savedObsPasswordFor("127.0.0.1", 4456, { readFile: reader(config()) })).toBe("");
    expect(savedObsPasswordFor("127.0.0.1", 4455, { readFile: reader(config({ auth_required: false })) })).toBe("");
    expect(savedObsPasswordFor("127.0.0.1", 4455, { readFile: () => { throw new Error("ENOENT"); } })).toBe("");
    expect(savedObsPasswordFor("127.0.0.1", 4455, { readFile: reader("{not json") })).toBe("");
  });
});

describe("signing in with OBS's saved password", () => {
  let server: FakeObsServer | null = null;
  let client: FadesterClient | DirectObsClient | null = null;

  afterEach(async () => {
    client?.stop();
    client = null;
    if (server) await server.stop();
    server = null;
  });

  it("connects with no password typed when OBS's saved password is right (both clients)", async () => {
    for (const make of [
      (port: number, read: (h: string, p: number) => string) => new FadesterClient({ host: "127.0.0.1", port, password: "" }, { readSavedPassword: read }),
      (port: number, read: (h: string, p: number) => string) => new DirectObsClient({ host: "127.0.0.1", port, password: "" }, { readSavedPassword: read })
    ]) {
      server = new FakeObsServer({ password: "obs-saved" });
      const port = await server.start();
      const asked: Array<[string, number]> = [];
      client = make(port, (host, p) => { asked.push([host, p]); return "obs-saved"; });
      client.start();
      await waitUntil(() => client!.getStatus().kind === "connected" || client!.getStatus().kind === "missing_plugin");
      expect(client.getStatus().kind).not.toBe("wrong_password");
      expect(client.usesSavedObsPassword()).toBe(true);
      expect(asked[0]).toEqual(["127.0.0.1", port]);
      client.stop();
      client = null;
      await server.stop();
      server = null;
    }
  });

  it("a typed password wins and the saved one is not read", async () => {
    server = new FakeObsServer({ password: "typed" });
    const port = await server.start();
    let read = false;
    client = new FadesterClient({ host: "127.0.0.1", port, password: "typed" }, { readSavedPassword: () => { read = true; return "obs-saved"; } });
    client.start();
    await waitUntil(() => client!.getStatus().kind === "connected");
    expect(read).toBe(false);
    expect(client.usesSavedObsPassword()).toBe(false);
  });

  it("shows Wrong password when OBS's saved password is stale", async () => {
    server = new FakeObsServer({ password: "new-in-obs" });
    const port = await server.start();
    client = new FadesterClient({ host: "127.0.0.1", port, password: "" }, { readSavedPassword: () => "old", baseReconnectMs: 30, maxReconnectMs: 60 });
    client.start();
    await waitUntil(() => client!.getStatus().kind === "wrong_password");
  });

  it("does not read anything when OBS asks for no password", async () => {
    server = new FakeObsServer({ password: "" });
    const port = await server.start();
    let read = false;
    client = new FadesterClient({ host: "127.0.0.1", port, password: "" }, { readSavedPassword: () => { read = true; return "x"; } });
    client.start();
    await waitUntil(() => client!.getStatus().kind === "connected");
    expect(read).toBe(false);
    expect(client.usesSavedObsPassword()).toBe(false);
  });
});
