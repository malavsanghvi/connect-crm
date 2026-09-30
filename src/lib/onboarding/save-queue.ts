// The queue behind "your progress is saved as you go" (pure: no React, no I/O of its own).
//
// Saves are sent one at a time, each carrying the version the last one returned, so two of this page's own saves can
// never collide. A burst of quick changes (answers to questions) waits for the save in flight and then goes out as one
// save. A save that fails keeps what it had not saved (newer changes win over it) and says so; it is sent again on
// `retry` or with the next change, never dropped. `exclusive` holds saves back while rows are written, because
// writing the first batch of an upload changes the draft's version on the server.

import { isEmptyPatch, mergePatches, type SavePatch } from "./progress";

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  /** The save failed: the work is still on the page and is sent again on retry. */
  | { kind: "failed"; error: string }
  /** Someone else saved the same draft in between: the page must be reloaded to see their work. */
  | { kind: "conflict"; error: string };

export type SendResult = { ok: true; data?: { version: number } } | { ok: false; error: string; conflict?: boolean };
export type Send = (input: { id: string; version: number; patch: SavePatch }) => Promise<SendResult>;

export class SaveQueue {
  private id: string | null = null;
  private version = 0;
  private pending: SavePatch | null = null;
  private running: Promise<boolean> | null = null;
  private locks = 0;
  private failed = false;

  constructor(
    private readonly send: Send,
    private readonly onStatus: (s: SaveStatus) => void,
  ) {}

  /** Point the queue at a draft (after Start, or after resuming one). */
  attach(id: string, version: number): void {
    this.id = id;
    this.version = version;
    this.pending = null;
    this.failed = false;
    this.onStatus({ kind: "idle" });
  }

  /** Forget the draft (after starting over or finishing). Whatever was waiting is dropped. */
  detach(): void {
    this.id = null;
    this.version = 0;
    this.pending = null;
    this.failed = false;
    this.onStatus({ kind: "idle" });
  }

  /** Queue a change and send it with anything else waiting. Resolves true once everything queued is saved. */
  save(patch: SavePatch): Promise<boolean> {
    this.pending = mergePatches(this.pending, patch);
    this.failed = false;
    return this.flush();
  }

  /** Send what is waiting (again, after a failure). */
  retry(): Promise<boolean> {
    this.failed = false;
    return this.flush();
  }

  /** Run `fn` with saves held back; afterwards whatever waited is sent. `fn` reports the new version when it changes it. */
  async exclusive<T>(fn: (id: string, setVersion: (v: number) => void) => Promise<T>): Promise<T> {
    if (!this.id) throw new Error("the draft was not started");
    this.locks += 1;
    try {
      if (this.running) await this.running;
      return await fn(this.id, (v) => {
        this.version = v;
      });
    } finally {
      this.locks -= 1;
      if (this.locks === 0) void this.flush();
    }
  }

  private flush(): Promise<boolean> {
    if (this.running) return this.running;
    let finished = false;
    const run = (async () => {
      let ok = true;
      while (this.locks === 0 && this.id && !isEmptyPatch(this.pending)) {
        const patch = this.pending!;
        this.pending = null;
        this.onStatus({ kind: "saving" });
        let res: SendResult;
        try {
          res = await this.send({ id: this.id, version: this.version, patch });
        } catch (err) {
          // The call itself failed (connection lost, server restarting): same as a refused save, and never a stuck queue.
          console.error("[onboarding] saving progress failed:", err instanceof Error ? err.message.slice(0, 200) : "unknown error");
          res = { ok: false, error: "Could not save your progress — the connection to the server failed. Check your internet connection and try again." };
        }
        if (res.ok && res.data) {
          this.version = res.data.version;
          this.failed = false;
          this.onStatus({ kind: "saved", at: new Date() });
        } else {
          // Keep what was not saved (newer changes win over it), and say so.
          this.pending = mergePatches(patch, this.pending ?? {});
          this.failed = true;
          ok = false;
          if (res.ok) this.onStatus({ kind: "failed", error: "Could not save your progress — the database did not confirm it." });
          else this.onStatus(res.conflict ? { kind: "conflict", error: res.error } : { kind: "failed", error: res.error });
          break;
        }
      }
      // No await between the last look at the queue and here: a change made after this starts a new flush.
      finished = true;
      this.running = null;
      return ok;
    })();
    if (!finished) this.running = run;
    return run;
  }
}
