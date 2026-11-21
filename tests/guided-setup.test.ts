// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import {
  isLoopbackObsHost,
  readObsWebsocketConfig,
  resolveObsWebsocketConfigPath,
  toObsWebsocketConfigPreview
} from "../packages/streamdeck-fadester-shared/src/obs/obs-websocket-config.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import {
  detectPlaylisterPlugin,
  evaluateSetupChecklist,
  type SetupChecklistItem
} from "../src/obs/setup-checklist.js";
import { DirectObsPropertyInspectorBridge } from "../src/pi/direct-obs-bridge.js";
import { AutoFadeKeyInstanceController } from "../src/actions/auto-fade-key.js";
import { FaderDialInstanceController } from "../src/actions/fader-dial.js";
import { PlaylisterTransportInstanceController } from "../src/actions/playlister-transport-key.js";
import { TapeDeckInstanceController } from "../src/actions/tape-deck-control.js";
import { VisualMeterInstanceController } from "../src/actions/visual-meter.js";
import { FilterController } from "../src/control/filter-controller.js";
import { TapeDecks } from "../src/control/tape-decks.js";
import { VisualSafety } from "../src/control/visual-safety.js";
import { VisualSignals } from "../src/control/visual-signals.js";
import { Hub } from "../src/vjster/plugin/hub.js";
import {
  LinkServer,
  probeVjsterPortHolder,
  probeVjsterPortStatus
} from "../src/vjster/plugin/link-server.js";
import type { FadesterGlobalSettings } from "../src/types/settings.js";
import { FakeObsServer, type FakeObsServerOptions } from "./helpers/fake-obs-server.js";
import { decodeSvgUri, svgText } from "./helpers/svg-text.js";

function sendRawHttp(port: number, rawRequest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = new Socket();
    const chunks: Buffer[] = [];
    sock.setTimeout(3000, () => {
      sock.destroy(new Error("raw HTTP timeout"));
    });
    sock.once("error", reject);
    sock.on("data", (chunk: Buffer) => chunks.push(chunk));
    sock.once("end", () => {
      sock.destroy();
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    sock.connect(port, "127.0.0.1", () => {
      sock.end(rawRequest);
    });
  });
}

describe("P1-5 Guided Setup Pass", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.pop()!;
      await fn();
    }
  });

  describe("Shared obs-websocket config reader (Windows, macOS, Linux, redaction)", () => {
    it("resolves Windows APPDATA, Windows fallback, macOS Library/Application Support, and Linux XDG paths", () => {
      expect(
        resolveObsWebsocketConfigPath({
          platform: "win32",
          env: { APPDATA: "C:\\Users\\Alice\\AppData\\Roaming" },
          homedir: "C:\\Users\\Alice"
        })
      ).toBe("C:\\Users\\Alice\\AppData\\Roaming\\obs-studio\\plugin_config\\obs-websocket\\config.json");

      expect(
        resolveObsWebsocketConfigPath({
          platform: "win32",
          env: {},
          homedir: "C:\\Users\\Bob"
        })
      ).toBe("C:\\Users\\Bob\\AppData\\Roaming\\obs-studio\\plugin_config\\obs-websocket\\config.json");

      expect(
        resolveObsWebsocketConfigPath({
          platform: "darwin",
          env: {},
          homedir: "/Users/carol"
        })
      ).toBe("/Users/carol/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json");

      expect(
        resolveObsWebsocketConfigPath({
          platform: "linux",
          env: { XDG_CONFIG_HOME: "/home/dave/.xdg" },
          homedir: "/home/dave"
        })
      ).toBe("/home/dave/.xdg/obs-studio/plugin_config/obs-websocket/config.json");

      expect(isLoopbackObsHost("127.0.0.1")).toBe(true);
      expect(isLoopbackObsHost("localhost")).toBe(true);
      expect(isLoopbackObsHost("::1")).toBe(true);
      expect(isLoopbackObsHost("[::1]")).toBe(true);
      expect(isLoopbackObsHost("192.168.1.42")).toBe(false);
    });

    it("reads fixture files for valid password, missing file, no password, invalid JSON, and refuses non-local hosts without touching disk", () => {
      const dir = mkdtempSync(join(tmpdir(), "fadester-obs-ws-"));
      cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

      const goodFile = join(dir, "good.json");
      writeFileSync(
        goodFile,
        JSON.stringify({
          alerts_enabled: false,
          auth_required: true,
          first_load: false,
          server_enabled: true,
          server_password: "fixture-secret-password",
          server_port: 4466
        }),
        "utf8"
      );

      const good = readObsWebsocketConfig({ host: "127.0.0.1", configPath: goodFile });
      expect(good).toEqual({
        ok: true,
        configPath: goodFile,
        serverPort: 4466,
        serverEnabled: true,
        authRequired: true,
        password: "fixture-secret-password"
      });
      const preview = toObsWebsocketConfigPreview(good);
      expect(preview).toEqual({
        ok: true,
        sourceRelPath: "obs-studio/plugin_config/obs-websocket/config.json",
        serverPort: 4466,
        serverEnabled: true,
        authRequired: true,
        passwordFound: true
      });
      expect(JSON.stringify(preview)).not.toContain("fixture-secret-password");
      expect(JSON.stringify(preview)).not.toContain(dir);

      const missing = readObsWebsocketConfig({
        host: "localhost",
        configPath: join(dir, "does-not-exist.json")
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.reason).toBe("missing_file");

      const noPwdFile = join(dir, "no-pwd.json");
      writeFileSync(
        noPwdFile,
        JSON.stringify({ server_port: 4455, server_enabled: true, auth_required: false, server_password: "" }),
        "utf8"
      );
      const noPwd = readObsWebsocketConfig({ host: "127.0.0.1", configPath: noPwdFile });
      expect(noPwd).toMatchObject({
        ok: false,
        reason: "no_password",
        serverPort: 4455,
        authRequired: false
      });

      const badJsonFile = join(dir, "bad.json");
      writeFileSync(badJsonFile, "{ broken", "utf8");
      const badJson = readObsWebsocketConfig({ host: "127.0.0.1", configPath: badJsonFile });
      expect(badJson).toMatchObject({ ok: false, reason: "invalid_json" });

      const readSpy = vi.fn(() => "{}");
      const remote = readObsWebsocketConfig({
        host: "10.0.0.12",
        configPath: goodFile,
        readFile: readSpy
      });
      expect(remote).toMatchObject({ ok: false, reason: "non_local" });
      expect(readSpy).not.toHaveBeenCalled();
    });

    it("drops a typed password only on the explicit 'Use OBS's own password', then signs in with OBS's saved one, and no secret reaches the page", async () => {
      const server = new FakeObsServer({ password: "saved-obs-password", missingPlugin: true });
      const port = await server.start();
      cleanup.push(() => server.stop());

      const client = new DirectObsClient({ host: "127.0.0.1", port: 1, password: "" },
        { baseReconnectMs: 60_000, wrongPasswordRetryMs: 0, readSavedPassword: () => "saved-obs-password" });
      cleanup.push(() => client.stop());

      const payloads: Record<string, unknown>[] = [];
      const savedSettings: FadesterGlobalSettings[] = [];
      const bridge = new DirectObsPropertyInspectorBridge(client, {
        sendToPropertyInspector: (payload) => payloads.push(payload),
        persistGlobalSettings: async (next) => {
          savedSettings.push({ ...next });
        },
        // (the bridge reads nothing from disk any more: the client signs in with OBS's saved password itself)
      });

      // A password typed long ago is stored and is wrong by now.
      await bridge.handleMessage({ event: "directUpdateGlobalSettings", host: "127.0.0.1", port, password: "typed-long-ago" });
      expect(savedSettings.at(-1)).toEqual({ host: "127.0.0.1", port, password: "typed-long-ago" });
      // An emptied password box changes nothing...
      await bridge.handleMessage({ event: "directUpdateGlobalSettings", host: "127.0.0.1", port });
      expect(client.getSettings().password).toBe("typed-long-ago");
      // ...the explicit action does: the stored password goes, and OBS's own saved one is used from then on.
      client.start();
      await bridge.handleMessage({ event: "directUseObsPassword" });
      expect(savedSettings.at(-1)).toEqual({ host: "127.0.0.1", port, password: "" });
      expect(client.getSettings().password).toBe("");
      await vi.waitFor(() => expect(client.isConnected()).toBe(true), { timeout: 3000 });
      const latestState = [...payloads].reverse().find((p) => p.event === "directObsState");
      expect(latestState).toMatchObject({
        connection: { host: "127.0.0.1", port, portInUse: port, local: true, passwordSet: false, obsSaved: true }
      });
      expect(payloads.some((p) => p.event === "directTestDone")).toBe(true);
      expect(JSON.stringify(payloads)).not.toContain("saved-obs-password");
      expect(JSON.stringify(payloads)).not.toContain("/Users/test");
    });
  });

  describe("Setup checklist: every line tested in passing and forced-failure states", () => {
    function byId(items: readonly SetupChecklistItem[], id: SetupChecklistItem["id"]): SetupChecklistItem {
      const found = items.find((entry) => entry.id === id);
      expect(found, id).toBeDefined();
      return found!;
    }

    async function connectDirect(opts: FakeObsServerOptions = {}): Promise<{
      server: FakeObsServer;
      client: DirectObsClient;
      port: number;
    }> {
      const server = new FakeObsServer(opts);
      const port = await server.start();
      const client = new DirectObsClient(
        { host: "127.0.0.1", port, password: opts.password ?? "" },
        { baseReconnectMs: 60_000 }
      );
      cleanup.push(() => client.stop(), () => server.stop());
      const changed = once(client, "statusChanged", { signal: AbortSignal.timeout(3000) });
      client.start();
      await changed;
      return { server, client, port };
    }

    it("reports all 12 checklist items green/ready on a healthy OBS 33 Studio Mode Fade setup", async () => {
      const { client } = await connectDirect({
        obsVersion: "33.0.1",
        studioMode: true,
        visualSidechainVendor: "decks"
      });
      const report = await evaluateSetupChecklist(client, {
        platform: "win32",
        vjsterPort: 48150,
        probeLocalObsProcess: () => ({ elevated: "ok", minimised: "ok" }),
        probeMacAccessibility: () => "not_applicable",
        probeVjsterPort: async () => ({
          state: "held",
          holder: { product: "Fadester for OBS", version: "0.11.0", port: 48150 }
        })
      });

      expect(report.items.map((item) => [item.id, item.state, item.code])).toEqual([
        ["obs_reachable", "ok", "ok"],
        ["password_accepted", "ok", "ok"],
        ["obs_version", "ok", "ok"],
        ["studio_mode", "ok", "ok"],
        ["fade_selected", "ok", "ok"],
        ["obs_not_elevated", "ok", "ok"],
        ["window_not_minimised", "ok", "ok"],
        ["macos_accessibility", "not_applicable", "not_applicable"],
        ["midi_fadester", "ok", "present"],
        ["visual_sidechain", "ok", "present"],
        ["playlister", "ok", "present"],
        ["vjster_port_holder", "ok", "port_self"]
      ]);
      expect(byId(report.items, "playlister").detail).toContain("version unknown");
    });

    it("forces each checklist item to fail/warn with a plain one-sentence fix", async () => {
      // 1) Unreachable OBS
      const offline = new DirectObsClient({ host: "127.0.0.1", port: 1, password: "" }, { baseReconnectMs: 60_000 });
      cleanup.push(() => offline.stop());
      const offlineReport = await evaluateSetupChecklist(offline, {
        platform: "darwin",
        vjsterPort: 48150,
        probeMacAccessibility: () => "fail",
        probeVjsterPort: async () => ({
          state: "held",
          holder: { product: "Fadester Companion", version: "0.9.0", port: 48150 }
        })
      });
      expect(byId(offlineReport.items, "obs_reachable")).toMatchObject({
        state: "fail",
        group: "needed",
        code: "unreachable",
        fix: "Start OBS, then tick Tools > WebSocket Server Settings > Enable WebSocket server."
      });
      expect(byId(offlineReport.items, "macos_accessibility")).toMatchObject({
        state: "note",
        group: "tbar",
        code: "ax_denied",
        fix: "Allow Stream Deck (or OpenDeck) in System Settings > Privacy & Security > Accessibility."
      });
      expect(byId(offlineReport.items, "vjster_port_holder")).toMatchObject({
        state: "warn",
        code: "port_other",
        fix: "VJster link is held by Fadester Companion 0.9.0. Close it or turn off VJster there if you use VJster on this deck."
      });

      // 2) Reachable OBS, wrong password + unknown macOS Accessibility (never guesses) + unknown port holder
      const authServer = new FakeObsServer({ password: "expected-password", missingPlugin: true });
      const authPort = await authServer.start();
      cleanup.push(() => authServer.stop());
      const badPwdClient = new DirectObsClient(
        { host: "127.0.0.1", port: authPort, password: "wrong-password" },
        { baseReconnectMs: 60_000 }
      );
      cleanup.push(() => badPwdClient.stop());
      const rejected = once(badPwdClient, "statusChanged", { signal: AbortSignal.timeout(3000) });
      badPwdClient.start();
      await rejected;

      const badPwdReport = await evaluateSetupChecklist(badPwdClient, {
        platform: "darwin",
        vjsterPort: 48150,
        probeMacAccessibility: () => "unknown",
        probeVjsterPort: async () => ({ state: "held", holder: null })
      });
      expect(byId(badPwdReport.items, "obs_reachable")).toMatchObject({ state: "ok", code: "ok" });
      expect(byId(badPwdReport.items, "password_accepted")).toMatchObject({
        state: "fail",
        code: "wrong_password",
        fix: "Type OBS's WebSocket password under OBS connection, or press Use OBS's own password there."
      });
      expect(byId(badPwdReport.items, "macos_accessibility")).toMatchObject({
        state: "unknown",
        code: "unknown",
        detail: "unknown"
      });
      expect(byId(badPwdReport.items, "vjster_port_holder")).toMatchObject({
        state: "warn",
        code: "port_unknown_holder",
        fix: "Port 48150 is in use by another program. Close it or choose another VJster port."
      });

      // 3) Connected OBS with non-33 version, Studio Mode off, Cut selected, elevated, minimised, too-old MF & VS, Playlister missing
      const { server, client } = await connectDirect({
        obsVersion: "30.2.3",
        studioMode: false,
        fadesterVersion: "0.4.0",
        includeLayerOpacityFields: false,
        visualSidechainVendor: "legacy",
        inputKinds: ["ffmpeg_source", "browser_source"]
      });
      server.currentTransitionName = "Cut";

      const failingObsReport = await evaluateSetupChecklist(client, {
        platform: "win32",
        vjsterPort: 48150,
        probeLocalObsProcess: () => ({ elevated: "fail", minimised: "fail" }),
        probeMacAccessibility: () => "not_applicable",
        probeVjsterPort: async () => ({ state: "free" })
      });

      expect(byId(failingObsReport.items, "obs_version")).toMatchObject({
        state: "note",
        code: "not_obs_33",
        fix: "Tested with OBS 33. Other versions usually work; the T-bar dial moves OBS's own slider only on OBS 33."
      });
      expect(byId(failingObsReport.items, "studio_mode")).toMatchObject({
        state: "note",
        code: "studio_off",
        fix: "Only for the T-bar dial and Preview keys: turn on Studio Mode in OBS (View > Studio Mode)."
      });
      expect(byId(failingObsReport.items, "fade_selected")).toMatchObject({
        state: "note",
        code: "not_fade",
        fix: "Only for the T-bar dial: select the Fade transition in OBS's Scene Transitions dock."
      });
      expect(byId(failingObsReport.items, "obs_not_elevated")).toMatchObject({
        state: "note",
        code: "elevated",
        fix: "Close OBS and start it normally without Run as administrator."
      });
      expect(byId(failingObsReport.items, "window_not_minimised")).toMatchObject({
        state: "note",
        code: "minimised",
        fix: "Restore OBS's main window from the taskbar so the native T-bar can reach it."
      });
      expect(byId(failingObsReport.items, "midi_fadester")).toMatchObject({
        state: "warn",
        code: "too_old",
        fix: "Update Midi Fadester in OBS for Clean FX, slot configuration, and single-owner layer opacity."
      });
      expect(byId(failingObsReport.items, "visual_sidechain")).toMatchObject({
        state: "warn",
        code: "too_old",
        fix: "Install Midi Fadester 0.9.0 or newer in OBS: it includes Visual Sidechain, with live safety state, tempo lock, and Tape Deck controls."
      });
      expect(byId(failingObsReport.items, "playlister")).toMatchObject({
        state: "info",
        code: "missing",
        detail: "Not installed (optional, version unknown)",
        fix: "Optional: install Playlister in OBS if you use Playlister Transport keys."
      });
      expect(byId(failingObsReport.items, "vjster_port_holder")).toMatchObject({
        state: "ok",
        code: "port_free"
      });

      // 4) Optional plugins absent altogether -> info state with optional install sentence
      const { client: bareClient } = await connectDirect({
        missingPlugin: true,
        visualSidechainVendor: "none",
        inputKinds: ["ffmpeg_source"]
      });
      const absentReport = await evaluateSetupChecklist(bareClient, {
        platform: "darwin",
        probeMacAccessibility: () => "ok",
        probeVjsterPort: async () => ({ state: "free" })
      });
      expect(byId(absentReport.items, "macos_accessibility")).toMatchObject({ state: "ok", code: "ok" });
      expect(byId(absentReport.items, "midi_fadester")).toMatchObject({ state: "info", code: "missing" });
      expect(byId(absentReport.items, "visual_sidechain")).toMatchObject({ state: "info", code: "missing" });
    });
  });

  describe("VJster GET /whoami and port-holder naming", () => {
    it("serves only { product, version, port } with strict Host check, rejects bad or duplicate Host headers with 403, sends no CORS headers, and names port holders", async () => {
      const secretToken = "0123456789abcdef0123456789abcdef";
      const pinnedExt = "abcdefghijklmnopabcdefghijklmnop";
      const holder = new LinkServer({
        port: 0,
        obsToken: secretToken,
        allowedExtensionIds: [pinnedExt],
        identity: { product: "Fadester Companion", version: "0.9.0" }
      });
      await holder.start();
      cleanup.push(() => holder.stop());
      const port = holder.boundPort!;

      const goodIp = await sendRawHttp(port, `GET /whoami HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      expect(goodIp.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);
      expect(goodIp.toLowerCase()).not.toContain("access-control-allow-");
      expect(goodIp).not.toContain(secretToken);
      expect(goodIp).not.toContain(pinnedExt);
      const bodyJson = JSON.parse(goodIp.split("\r\n\r\n")[1]!) as Record<string, unknown>;
      expect(Object.keys(bodyJson).sort()).toEqual(["port", "product", "version"]);
      expect(bodyJson).toEqual({
        product: "Fadester Companion",
        version: "0.9.0",
        port
      });

      const goodLocalhost = await sendRawHttp(
        port,
        `GET /whoami HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`
      );
      expect(goodLocalhost.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);

      const headResp = await sendRawHttp(
        port,
        `HEAD /whoami HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`
      );
      expect(headResp.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);
      expect(headResp.split("\r\n\r\n")[1]).toBe("");

      const badHost = await sendRawHttp(
        port,
        `GET /whoami HTTP/1.1\r\nHost: attacker.example:${port}\r\nConnection: close\r\n\r\n`
      );
      expect(badHost.startsWith("HTTP/1.1 403")).toBe(true);

      const missingHost10 = await sendRawHttp(port, "GET /whoami HTTP/1.0\r\nConnection: close\r\n\r\n");
      expect(missingHost10.startsWith("HTTP/1.1 403") || missingHost10.startsWith("HTTP/1.0 403")).toBe(true);

      const missingHost11 = await sendRawHttp(port, "GET /whoami HTTP/1.1\r\nConnection: close\r\n\r\n");
      expect(missingHost11.startsWith("HTTP/1.1 400") || missingHost11.startsWith("HTTP/1.1 403")).toBe(true);

      const twoHosts = await sendRawHttp(
        port,
        `GET /whoami HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nHost: attacker.example\r\nConnection: close\r\n\r\n`
      );
      expect(twoHosts.startsWith("HTTP/1.1 400") || twoHosts.startsWith("HTTP/1.1 403")).toBe(true);

      // Also verify HTTP/1.0 with two Host headers reaches our own rawHeaders check and gets 403:
      const twoHosts10 = await sendRawHttp(
        port,
        `GET /whoami HTTP/1.0\r\nHost: 127.0.0.1:${port}\r\nHost: attacker.example\r\nConnection: close\r\n\r\n`
      );
      expect(twoHosts10.startsWith("HTTP/1.1 403") || twoHosts10.startsWith("HTTP/1.0 403")).toBe(true);

      // Hub clash against a holder that answers /whoami records port-in-use and probeVjsterPortHolder names the holder:
      const hub = new Hub({ port }, (o) => new LinkServer(o), 60_000, 60_000);
      cleanup.push(() => hub.release());
      await hub.acquire();
      expect(hub.portInUse).toBe(true);
      expect(hub.view("browser").status).toBe("port-in-use");
      const holderInfo = await probeVjsterPortHolder(port);
      expect(holderInfo).toEqual({
        product: "Fadester Companion",
        version: "0.9.0",
        port
      });
      const probeStatus = await probeVjsterPortStatus(port);
      expect(probeStatus).toEqual({
        state: "held",
        holder: { product: "Fadester Companion", version: "0.9.0", port }
      });

      // Fallback when port is held by a non-VJster TCP listener that closes without /whoami:
      const silentTcp = createTcpServer((sock) => sock.destroy());
      await new Promise<void>((resolve) => silentTcp.listen(0, "127.0.0.1", () => resolve()));
      cleanup.push(
        () =>
          new Promise<void>((resolve) => {
            silentTcp.close(() => resolve());
          })
      );
      const silentPort = (silentTcp.address() as { port: number }).port;
      expect(await probeVjsterPortHolder(silentPort, 400)).toBeNull();
      expect(await probeVjsterPortStatus(silentPort, 400)).toEqual({ state: "held", holder: null });
    });
  });

  describe("Feature-detection gates on keys and dials (never version numbers)", () => {
    it("shows 'Update Midi Fadester' with a plain sentence when a Midi Fadester request is missing (OBS's 600, or 604)", async () => {
      const server = new FakeObsServer({ fadesterVersion: "0.3.0", missingPlugin: false });
      const port = await server.start();
      cleanup.push(() => server.stop());

      const client = new FadesterClient({ host: "127.0.0.1", port, password: "" });
      const store = new FadesterStore(client);
      cleanup.push(() => client.stop());
      const ready = once(client, "statusChanged", { signal: AbortSignal.timeout(3000) });
      client.start();
      await ready;
      await new Promise((r) => setTimeout(r, 30));

      // Simulate an older Midi Fadester build without auto_fade and nudge_fader. OBS answers 600 "No request was found
      // by that name." (the fake server's default); 604 is what test servers answered and is still accepted.
      server.disabledMidiFadesterRequests.add("auto_fade");
      server.disabledMidiFadesterRequests.add("nudge_fader");

      const stateReadsBefore = server.vendorCallLog.filter((call) => call.requestType === "get_state").length;
      await expect(
        client.autoFade({ slot: "fader_1", to: 1, ms: 500 })
      ).rejects.toThrow("Update Midi Fadester in OBS to use 'auto_fade'.");
      server.missingRequestCode = 604;
      await expect(
        client.autoFade({ slot: "fader_1", to: 1, ms: 500 })
      ).rejects.toThrow("Update Midi Fadester in OBS to use 'auto_fade'.");
      server.missingRequestCode = 600;
      // A missing request is not a reason to read the whole state again.
      await new Promise((r) => setTimeout(r, 30));
      expect(server.vendorCallLog.filter((call) => call.requestType === "get_state").length).toBe(stateReadsBefore);

      const keyImages: string[] = [];
      const keyCtrl = new AutoFadeKeyInstanceController(
        store,
        {
          setImage: async (img) => {
            keyImages.push(decodeSvgUri(img));
          },
          showAlert: async () => {}
        },
        { slot: "fader_1", direction: "up", durationSec: 1 },
        16
      );
      cleanup.push(() => keyCtrl.disappear());
      keyCtrl.appear();
      await keyCtrl.handleKeyDown();
      await vi.waitFor(() => {
        expect(svgText(keyImages.at(-1) ?? "")).toContain("Update Midi Fadester");
      });

      const dialFrames: string[] = [];
      const dialCtrl = new FaderDialInstanceController(
        store,
        {
          setFeedback: async ({ canvas }) => {
            dialFrames.push(decodeSvgUri(canvas));
          },
          showAlert: async () => {}
        },
        { slot: "fader_1", stepPerTick: 0.02, acceleration: false },
        16
      );
      cleanup.push(() => dialCtrl.disappear());
      dialCtrl.appear();
      await dialCtrl.handleRotate(1);
      await vi.waitFor(() => {
        expect(svgText(dialFrames.at(-1) ?? "")).toContain("Update Midi Fadester");
      });
    });

    it("shows 'Update Midi Fadester' on Visual Sidechain Meter and Tape Deck when vendor requests/fields are missing", async () => {
      const server = new FakeObsServer({ missingPlugin: true, visualSidechainVendor: "legacy" });
      server.visualSidechainDecks = [
        {
          source: "Deck 1",
          filter: "Visual Sidechain: Tape Deck",
          deck_id: "deck_1",
          role: "owner",
          state: "playing",
          tape: "clip.mp4",
          speed_percent: 100,
          effective_speed_percent: 100,
          playing: true,
          loop: true
        }
      ];
      const port = await server.start();
      cleanup.push(() => server.stop());

      const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
      cleanup.push(() => client.stop());
      const filters = new FilterController(client);
      const safety = new VisualSafety(client, filters);
      const signals = new VisualSignals(client, safety);
      const tapeDecks = new TapeDecks(client);

      const ready = once(client, "statusChanged", { signal: AbortSignal.timeout(3000) });
      client.start();
      await ready;
      await signals.refreshSignals();
      await tapeDecks.refreshDecks();

      expect(signals.getSnapshot().supportsTempoGrid).toBe(false);
      await expect(signals.setBpm(128)).rejects.toThrow(
        "Update Midi Fadester in OBS (it includes Visual Sidechain) to use 'set_bpm'."
      );
      expect(signals.getSnapshot().needsTempoUpdate).toBe(true);

      const meterFrames: string[] = [];
      const meter = new VisualMeterInstanceController(
        signals,
        client,
        {
          render: async (uri) => {
            const prefix = uri.startsWith("data:image/svg+xml;base64,")
              ? Buffer.from(uri.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8")
              : decodeSvgUri(uri);
            meterFrames.push(prefix);
          },
          showAlert: async () => {}
        },
        "dial",
        { operation: "tap_tempo", dialRotate: "adjust_bpm", refreshRate: 10 }
      );
      cleanup.push(() => meter.disappear());
      meter.appear();
      await vi.waitFor(() => {
        expect(meterFrames.at(-1) ?? "").toContain("Update Midi Fadester");
      });

      // Legacy get_decks omits `version`, so TapeDecks detects deckCommandUnsupported immediately and throws a plain sentence on deck_command:
      expect(tapeDecks.getInspectorState().deckCommandUnsupported).toBe(true);
      await expect(tapeDecks.executeOperation("Deck 1", "play_pause")).rejects.toThrow(
        "Update Midi Fadester in OBS (it includes Visual Sidechain) to use 'deck_command'."
      );

      const deckFrames: string[] = [];
      const deckCtrl = new TapeDeckInstanceController(
        tapeDecks,
        client,
        {
          render: async (uri) => {
            const prefix = uri.startsWith("data:image/svg+xml;base64,")
              ? Buffer.from(uri.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8")
              : decodeSvgUri(uri);
            deckFrames.push(prefix);
          },
          showAlert: async () => {}
        },
        "key",
        { deck: "Deck 1", operation: "play_pause" }
      );
      cleanup.push(() => deckCtrl.disappear());
      deckCtrl.appear();
      await vi.waitFor(() => {
        expect(deckFrames.at(-1) ?? "").toContain("Update Midi Fadester");
      });
    });

    it("detects Playlister by input kind with 'version unknown' and draws 'Install Playlister' when absent", async () => {
      const server = new FakeObsServer({
        missingPlugin: true,
        inputKinds: ["wasapi_output_capture", "ffmpeg_source"]
      });
      const port = await server.start();
      cleanup.push(() => server.stop());

      const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
      cleanup.push(() => client.stop());
      const ready = once(client, "statusChanged", { signal: AbortSignal.timeout(3000) });
      client.start();
      await ready;

      const detected = await detectPlaylisterPlugin(client);
      expect(detected).toEqual({
        status: "missing",
        inputKind: "obs_playlister_source",
        version: "version unknown"
      });

      const keyFrames: string[] = [];
      const plKey = new PlaylisterTransportInstanceController(
        client,
        {
          setImage: async (img) => { keyFrames.push(decodeSvgUri(img)); },
          showAlert: async () => {}
        },
        { inputUuid: "", operation: "playpause" },
        16
      );
      cleanup.push(() => plKey.disappear());
      plKey.appear();
      await vi.waitFor(() => {
        expect(keyFrames.at(-1) ?? "").toContain(">Install Playlister<");
      });
    });
  });
});
