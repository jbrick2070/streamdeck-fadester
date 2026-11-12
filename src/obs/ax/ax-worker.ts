// SPDX-License-Identifier: GPL-2.0-or-later
// Dedicated worker_thread for OBS 33's Studio Mode T-bar on macOS.
// Keeps all CoreFoundation / AXUIElement handles on this thread and runs synchronous macOS Accessibility IPC off the
// plugin's main event loop, speaking the exact same message protocol as uia-worker.ts.
import { parentPort, workerData } from "node:worker_threads";
import type { AxSlider } from "./ax-slider.js";
import type { UiaWorkerBootMessage, UiaWorkerCallReply, UiaWorkerRequest } from "../uia/uia-worker.js";

const workerInit = (workerData as { port?: unknown; allowPrompt?: unknown } | null) ?? {};
const port = Number(workerInit.port ?? 0);
const initialAllowPrompt = workerInit.allowPrompt !== false;

async function startWorker(): Promise<void> {
  if (!parentPort) return;
  let axModule: typeof import("./ax-slider.js");
  try {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid OBS WebSocket port: ${String(port)}`);
    }
    axModule = await import("./ax-slider.js");
  } catch (error) {
    parentPort.postMessage({
      ready: false,
      message: error instanceof Error ? error.message : String(error)
    } satisfies UiaWorkerBootMessage);
    parentPort.close();
    return;
  }

  let slider: AxSlider | null = null;
  let setupPromptAvailable = initialAllowPrompt;

  const ensureSlider = (): AxSlider => {
    if (slider && !slider.isRunning) {
      slider.dispose();
      slider = null;
    }
    if (!slider) {
      const pid = axModule.listenerPid(port);
      slider = new axModule.AxSlider(pid);
    }
    return slider;
  };

  parentPort.on("message", (msg: UiaWorkerRequest) => {
    const { seq, generation, op } = msg;
    try {
      if (op === "close") {
        slider?.dispose();
        slider = null;
        axModule.disposeAxConstants();
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
        const s = ensureSlider();
        const allowPrompt = setupPromptAvailable;
        setupPromptAvailable = false;
        const value = s.read(allowPrompt);
        parentPort?.postMessage({ seq, generation, status: "ok", value } satisfies UiaWorkerCallReply);
        return;
      }
      if (op === "move") {
        const value = ensureSlider().move(msg.expected ?? -1, msg.desired ?? -1);
        parentPort?.postMessage({ seq, generation, status: "ok", value } satisfies UiaWorkerCallReply);
        return;
      }
      throw new axModule.AxRefusal(`Unknown worker operation: ${String(op)}`, "unavailable");
    } catch (error) {
      if (error instanceof axModule.AxRefusal) {
        parentPort?.postMessage({
          seq,
          generation,
          status: "refusal",
          message: error.message,
          reason: error.reason
        } satisfies UiaWorkerCallReply);
        return;
      }
      if (error instanceof axModule.AxUncertain || op === "move") {
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
