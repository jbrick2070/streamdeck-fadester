// SPDX-License-Identifier: GPL-2.0-or-later
// Dedicated worker_thread for OBS 33's Studio Mode T-bar on Windows (docs/TBAR-WINDOWS-INPLUGIN-DESIGN.md).
// Joins COM's multithreaded apartment once on this thread, keeps all COM pointers here, and runs synchronous UIA calls
// off the plugin's main event loop.
import { parentPort, workerData } from "node:worker_threads";
import type { UiaRefusalReason, UiaSlider } from "./uia-slider.js";

export interface UiaWorkerRequest {
  seq: number;
  generation: number;
  op: "read" | "move" | "forget" | "close";
  expected?: number;
  desired?: number;
}

export type UiaWorkerBootMessage =
  | { ready: true }
  | { ready: false; message: string };

export type UiaWorkerCallReply =
  | { seq: number; generation: number; status: "ok"; value: number }
  | { seq: number; generation: number; status: "refusal"; message: string; reason: UiaRefusalReason }
  | { seq: number; generation: number; status: "uncertain"; message: string };

export type UiaWorkerMessage = UiaWorkerBootMessage | UiaWorkerCallReply;

const port = Number((workerData as { port?: unknown } | null)?.port ?? 0);

async function startWorker(): Promise<void> {
  if (!parentPort) return;
  let uiaModule: typeof import("./uia-slider.js");
  try {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid OBS WebSocket port: ${String(port)}`);
    }
    uiaModule = await import("./uia-slider.js");
    uiaModule.initializeCom();
  } catch (error) {
    parentPort.postMessage({
      ready: false,
      message: error instanceof Error ? error.message : String(error)
    } satisfies UiaWorkerBootMessage);
    parentPort.close();
    return;
  }

  let slider: UiaSlider | null = null;

  const ensureSlider = (): UiaSlider => {
    if (slider && !slider.isRunning) {
      slider.dispose();
      slider = null;
    }
    if (!slider) {
      const pid = uiaModule.listenerPid(port);
      slider = new uiaModule.UiaSlider(pid);
    }
    return slider;
  };

  parentPort.on("message", (msg: UiaWorkerRequest) => {
    const { seq, generation, op } = msg;
    try {
      if (op === "close") {
        slider?.dispose();
        slider = null;
        uiaModule.uninitializeCom();
        parentPort?.postMessage({ seq, generation, status: "ok", value: 0 } satisfies UiaWorkerCallReply);
        parentPort?.close();
        return;
      }
      if (op === "forget") {
        slider?.forget();
        parentPort?.postMessage({ seq, generation, status: "ok", value: 0 } satisfies UiaWorkerCallReply);
        return;
      }
      if (op === "read") {
        const value = ensureSlider().read();
        parentPort?.postMessage({ seq, generation, status: "ok", value } satisfies UiaWorkerCallReply);
        return;
      }
      if (op === "move") {
        const value = ensureSlider().move(msg.expected ?? -1, msg.desired ?? -1);
        parentPort?.postMessage({ seq, generation, status: "ok", value } satisfies UiaWorkerCallReply);
        return;
      }
      throw new uiaModule.UiaRefusal(`Unknown worker operation: ${String(op)}`, "unavailable");
    } catch (error) {
      if (error instanceof uiaModule.UiaRefusal) {
        parentPort?.postMessage({
          seq,
          generation,
          status: "refusal",
          message: error.message,
          reason: error.reason
        } satisfies UiaWorkerCallReply);
        return;
      }
      if (error instanceof uiaModule.UiaUncertain || op === "move") {
        parentPort?.postMessage({
          seq,
          generation,
          status: "uncertain",
          message: error instanceof Error ? error.message : String(error)
        } satisfies UiaWorkerCallReply);
        return;
      }
      parentPort?.postMessage({
        seq,
        generation,
        status: "refusal",
        message: error instanceof Error ? error.message : String(error),
        reason: "unavailable"
      } satisfies UiaWorkerCallReply);
    }
  });

  parentPort.postMessage({ ready: true } satisfies UiaWorkerBootMessage);
}

void startWorker();
