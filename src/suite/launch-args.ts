// SPDX-License-Identifier: GPL-2.0-or-later
// What Stream Deck and OpenDeck pass a plugin, and the line a child runs first (src/suite/launcher.ts).

/** `-port 28196 -pluginUUID <id> -registerEvent registerPlugin -info <json>`, as the host starts a plugin. */
export function parseLaunchArgs(argv: readonly string[]): { port: number; uuid: string; registerEvent: string; info: string } {
  const value = (name: string): string => {
    const at = argv.indexOf(name);
    const found = at >= 0 ? argv[at + 1] : undefined;
    if (found === undefined) throw new Error(`the host did not pass ${name}`);
    return found;
  };
  const port = Number(value("-port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("the host passed a port that is not a port");
  return { port, uuid: value("-pluginUUID"), registerEvent: value("-registerEvent"), info: value("-info") };
}

/** The first message of a connection on a child's port registers this start's child: `{ event: "registerPlugin", uuid }` with the uuid it was given. Anything else, `null` included, is not the child. */
export function registersChild(message: unknown, uuid: string): boolean {
  if (typeof message !== "object" || message === null || Array.isArray(message) || uuid === "") return false;
  const m = message as { event?: unknown; uuid?: unknown };
  return m.event === "registerPlugin" && m.uuid === uuid;
}

/** A line for a child to run first: end when the process that started it is gone. Stream Deck and OpenDeck stop only the suite's own process. */
export const WATCHDOG = "setInterval(()=>{try{process.kill(Number(process.env.SUITE_PARENT_PID),0)}catch{process.exit(0)}},2000).unref()";
