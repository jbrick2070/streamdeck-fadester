// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page: answer an intent only once the embed says what it did
// (docs/vjster/REQUIREMENTS.md R-INT-4, R-BEH-4). The embed's getters lag one
// message behind (embed-control.ts), so an answer sent at once would carry the
// old rate and the deck would show it. The page holds the answer until the
// player's matching event arrives, or for at most `waitMs`, then answers with
// what the player says by then.

/** Which player event confirms an intent: a rate change, or a play/pause state change. */
export type SettleKind = "rate" | "state";

export interface SettleTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const SETTLE_MS = 300;

export class AnswerSettler {
  private readonly waiting = new Map<SettleKind, { ids: string[]; timer: unknown }>();

  constructor(
    private readonly answer: (ids: readonly string[]) => void,
    private readonly timers: SettleTimers,
    private readonly waitMs = SETTLE_MS
  ) {}

  /** Hold the answer to intent `id` until the player reports `kind`. */
  hold(id: string, kind: SettleKind): void {
    const entry = this.waiting.get(kind);
    if (entry) {
      entry.ids.push(id);
      return;
    }
    const timer = this.timers.setTimeout(() => this.release(kind), this.waitMs);
    this.waiting.set(kind, { ids: [id], timer });
  }

  /** The player reported `kind`: answer everything waiting for it. */
  playerEvent(kind: SettleKind): void {
    this.release(kind);
  }

  /** Drop everything (the page is closing). */
  dispose(): void {
    for (const { timer } of this.waiting.values()) this.timers.clearTimeout(timer);
    this.waiting.clear();
  }

  private release(kind: SettleKind): void {
    const entry = this.waiting.get(kind);
    if (!entry) return;
    this.waiting.delete(kind);
    this.timers.clearTimeout(entry.timer);
    this.answer(entry.ids);
  }
}

/** Which event settles an intent's answer, or null to answer at once. */
export function settleKind(type: string): SettleKind | null {
  if (type.startsWith("speed.")) return "rate";
  if (type === "transport.toggle") return "state";
  return null;
}

/**
 * The page's side of settling: which answers wait, and what goes out now.
 * An error answers at once and ends the wait for that intent.
 */
export class SettledAnswers {
  private readonly settling = new Set<string>();
  private readonly settler: AnswerSettler;

  constructor(answer: (id: string) => void, timers: SettleTimers, waitMs = SETTLE_MS) {
    this.settler = new AnswerSettler(
      (ids) => {
        for (const id of ids) if (this.settling.delete(id)) answer(id);
      },
      timers,
      waitMs
    );
  }

  /** Call before the adapter handles the intent. */
  begin(intent: { readonly id: string; readonly type: string }): void {
    const kind = settleKind(intent.type);
    if (kind === null) return;
    this.settling.add(intent.id);
    this.settler.hold(intent.id, kind);
  }

  /** Whether one of the adapter's reports goes out now. */
  passes(report: { readonly kind: "state" | "error"; readonly inReplyTo: string | null }): boolean {
    if (report.inReplyTo === null || !this.settling.has(report.inReplyTo)) return true;
    if (report.kind === "error") {
      this.settling.delete(report.inReplyTo);
      return true;
    }
    return false;
  }

  playerEvent(kind: SettleKind): void {
    this.settler.playerEvent(kind);
  }

  dispose(): void {
    this.settler.dispose();
    this.settling.clear();
  }
}
