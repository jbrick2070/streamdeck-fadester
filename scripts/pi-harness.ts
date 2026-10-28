// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Local Property Inspector harness: serves the real ui/*.html pages over HTTP
 * and emulates the Stream Deck PI websocket in front of a FakeObsServer +
 * PropertyInspectorBridge, so the PI JavaScript can be exercised in a browser
 * without Stream Deck or OBS. Development aid only; not shipped.
 *
 *   node --import tsx scripts/pi-harness.ts [--page fader-dial|auto-fade-key]
 *   open http://127.0.0.1:4480/
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import { PropertyInspectorBridge } from "../src/pi/pi-bridge.js";
import { FakeObsServer } from "../tests/helpers/fake-obs-server.js";
import { FadesterGlobalSettings } from "../src/types/settings.js";

const HTTP_PORT = Number(process.env.PI_HARNESS_HTTP_PORT ?? 4480);
const SD_WS_PORT = Number(process.env.PI_HARNESS_SD_PORT ?? 4481);
const UI_DIR = join(process.cwd(), "com.jbrick2070.fadester-for-obs.sdPlugin", "ui");
const pageArgIndex = process.argv.indexOf("--page");
const PAGE = pageArgIndex >= 0 ? process.argv[pageArgIndex + 1] : "fader-dial";
const ACTION_UUID =
  PAGE === "auto-fade-key"
    ? "com.jbrick2070.fadester-for-obs.auto-fade"
    : "com.jbrick2070.fadester-for-obs.fader";

async function main(): Promise<void> {
  const obs = new FakeObsServer({ password: "harness-pw", buildCommit: "h4rn355" });
  const obsPort = await obs.start();

  const client = new FadesterClient({ host: "127.0.0.1", port: obsPort, password: "harness-pw" });
  const store = new FadesterStore(client);

  const piSockets = new Set<WebSocket>();
  let actionSettings: Record<string, unknown> = { slot: "fader_1" };
  let globalSettings: FadesterGlobalSettings = { host: "127.0.0.1", port: obsPort, password: "harness-pw" };

  const bridge = new PropertyInspectorBridge(store, client, {
    sendToPropertyInspector(payload) {
      const msg = JSON.stringify({
        event: "sendToPropertyInspector",
        action: ACTION_UUID,
        context: "ctx-1",
        payload
      });
      for (const s of piSockets) {
        if (s.readyState === WebSocket.OPEN) s.send(msg);
      }
    },
    async persistGlobalSettings(settings) {
      globalSettings = { ...settings };
      console.log("[harness] persisted global settings:", { ...settings, password: settings.password ? "<set>" : "" });
    }
  });

  const sdServer = new WebSocketServer({ host: "127.0.0.1", port: SD_WS_PORT });
  sdServer.on("connection", (ws) => {
    piSockets.add(ws);
    ws.on("close", () => piSockets.delete(ws));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString("utf8")) as { event?: string; payload?: Record<string, unknown> };
      if (msg.event === "registerPropertyInspector") {
        console.log("[harness] PI registered");
        return;
      }
      if (msg.event === "setSettings") {
        actionSettings = (msg.payload ?? {}) as Record<string, unknown>;
        console.log("[harness] action settings:", JSON.stringify(actionSettings));
        ws.send(
          JSON.stringify({
            event: "didReceiveSettings",
            action: ACTION_UUID,
            context: "ctx-1",
            payload: { settings: actionSettings }
          })
        );
        return;
      }
      if (msg.event === "sendToPlugin") {
        const p = (msg.payload ?? {}) as Record<string, unknown>;
        const safe = { ...p };
        if ("password" in safe) safe.password = "<typed>";
        console.log("[harness] sendToPlugin:", JSON.stringify(safe));
        void bridge.handleMessage(p);
      }
    });
  });

  const bootstrap = `
<script>
  window.addEventListener("load", function () {
    window.connectElgatoStreamDeckSocket(
      ${SD_WS_PORT},
      "pi-uuid-1",
      "registerPropertyInspector",
      JSON.stringify({ application: { version: "7.1" } }),
      JSON.stringify({ action: ${JSON.stringify(ACTION_UUID)}, context: "ctx-1", payload: { settings: ${JSON.stringify(actionSettings)} } })
    );
  });
</script>`;

  const http = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    const rel = url === "/" ? `${PAGE}.html` : url.replace(/^\/+/, "");
    const file = join(UI_DIR, rel);
    if (!file.startsWith(UI_DIR) || !existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = extname(file);
    const type = ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
    let body = readFileSync(file, "utf8");
    if (ext === ".html") {
      body = body.replace("</body>", bootstrap + "</body>");
    }
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    res.end(body);
  });
  http.listen(HTTP_PORT, "127.0.0.1", () => {
    console.log(`[harness] PI page: http://127.0.0.1:${HTTP_PORT}/  (page=${PAGE}, fake OBS on ${obsPort})`);
    console.log(`[harness] toggles: POST /__studio/off|on, /__obs/stop|start are not implemented; use Ctrl+C`);
  });

  client.start();
  void globalSettings;
}

void main();
