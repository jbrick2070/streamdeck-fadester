// SPDX-License-Identifier: GPL-2.0-or-later
// The suite plugin's entry (docs/SUITE.md): it registers with Stream Deck or OpenDeck once, starts the Fadester plugin
// and the VJster plugin as two child processes exactly as the host would start them, and passes messages between
// them (the routing is src/suite/mux.ts). A child that stops is started again and given the keys and dials that were
// showing; children end by themselves when this process does.

import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { VJSTER_ACTIONS, VJSTER_NAMESPACE } from "./actions.js";
import { WATCHDOG, parseLaunchArgs } from "./launch-args.js";
import { SuiteMux, type Child, type Message } from "./mux.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const CHILDREN: Record<Child, { script: string; cwd: string }> = {
  fadester: { script: join(root, "bin", "fadester.js"), cwd: root },
  vjster: { script: join(root, "bin", "vjster", "plugin.js"), cwd: join(root, "vjster") }
};

const logFile = join(root, "logs", "suite.log");
function log(line: string): void {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > 200_000) truncateSync(logFile, 0);
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // a log that cannot be written must never stop the plugin
  }
}

interface Link {
  server: WebSocketServer;
  socket: WebSocket | null;
  ready: boolean;
  queue: string[];
  process: ChildProcess | null;
  starts: number[];
  /** The child has run before: it is given what was showing, not what arrived while it was down. */
  replay: boolean;
}

function main(): void {
  const args = parseLaunchArgs(process.argv.slice(2));
  const host = new WebSocket(`ws://127.0.0.1:${args.port}`);
  const links = new Map<Child, Link>();
  let ending = false;

  const mux = new SuiteMux({
    pluginUuid: args.uuid,
    vjsterActions: VJSTER_ACTIONS,
    namespace: VJSTER_NAMESPACE,
    toHost(message) {
      if (host.readyState === WebSocket.OPEN) host.send(JSON.stringify(message));
    },
    toChild(child, message) {
      const link = links.get(child);
      if (!link) return;
      const text = JSON.stringify(message);
      if (link.ready && link.socket?.readyState === WebSocket.OPEN) link.socket.send(text);
      else link.queue.push(text);
    }
  });

  const start = (child: Child): void => {
    const link = links.get(child)!;
    const port = (link.server.address() as { port: number }).port;
    const now = Date.now();
    link.starts = link.starts.filter((at) => now - at < 60_000);
    if (link.starts.length >= 5) {
      log(`${child}: stopped 5 times in a minute; not started again`);
      return;
    }
    link.starts.push(now);
    link.ready = false;
    const spec = CHILDREN[child];
    // What a child prints goes to its own file, started again each time the child starts (a crash leaves its reason there).
    let output: number | "ignore" = "ignore";
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      const file = join(dirname(logFile), `${child}-output.log`);
      writeFileSync(file, `${new Date().toISOString()} ${child} started
`);
      output = openSync(file, "a");
    } catch {
      // no log file, no output: the child still runs
    }
    const run = spawn(process.execPath, [`--import=data:text/javascript,${encodeURIComponent(WATCHDOG)}`, spec.script, "-port", String(port), "-pluginUUID", args.uuid, "-registerEvent", args.registerEvent, "-info", args.info], {
      cwd: spec.cwd,
      env: { ...process.env, SUITE_PARENT_PID: String(process.pid) },
      stdio: ["ignore", output, output],
      windowsHide: true
    });
    if (typeof output === "number") closeSync(output);
    link.process = run;
    run.on("error", (error) => log(`${child}: could not start: ${error.message}`));
    run.on("exit", (code) => {
      log(`${child}: ended (code ${code ?? "none"})`);
      if (link.process === run) link.process = null;
      link.replay = true;
      if (!ending) setTimeout(() => start(child), 1000);
    });
  };

  for (const child of ["fadester", "vjster"] as const) {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    const link: Link = { server, socket: null, ready: false, queue: [], process: null, starts: [], replay: false };
    links.set(child, link);
    server.on("connection", (socket) => {
      link.socket = socket;
      socket.on("message", (raw) => {
        let message: Message;
        try {
          message = JSON.parse(String(raw)) as Message;
        } catch {
          return;
        }
        if (message.event === "registerPlugin" && !link.ready) {
          link.ready = true;
          if (link.replay) {
            link.queue.length = 0;
            for (const replayed of mux.replayFor(child)) socket.send(JSON.stringify(replayed));
          } else {
            for (const text of link.queue.splice(0)) socket.send(text);
          }
        }
        mux.fromChild(child, message);
      });
      socket.on("close", () => {
        if (link.socket === socket) {
          link.socket = null;
          link.ready = false;
        }
      });
    });
  }

  const end = (): void => {
    if (ending) return;
    ending = true;
    for (const link of links.values()) {
      link.process?.kill();
      link.server.close();
    }
    host.close();
    setTimeout(() => process.exit(0), 200);
  };

  host.on("open", () => {
    host.send(JSON.stringify({ event: args.registerEvent, uuid: args.uuid }));
    log("registered; starting the Fadester and VJster plugins");
    for (const child of ["fadester", "vjster"] as const) {
      const link = links.get(child)!;
      const ready = (): void => start(child);
      if (link.server.address()) ready();
      else link.server.once("listening", ready);
    }
  });
  host.on("message", (raw) => {
    try {
      mux.fromHost(JSON.parse(String(raw)) as Message);
    } catch {
      // a message that is not JSON is not for us
    }
  });
  host.on("close", end);
  host.on("error", end);
  process.on("SIGTERM", end);
  process.on("SIGINT", end);
}

main();
