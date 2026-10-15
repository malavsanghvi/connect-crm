// The browser side of remembering (prototype). Storage can throw, or be empty, in a private window or with site data blocked, so every
// read and write is wrapped. When a write fails the choice still holds for this page (kept in memory) and `failed()` says so, so the
// screen can tell the person plainly that it could not be remembered: never a silent fallback.

import { parseProgress, serializeProgress, type Progress } from "./progress";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** What the server (and the first client render) sees: nothing is known yet, so no invitation is drawn that could mismatch. */
export const UNLOADED = "unloaded";

export type ProgressStore = {
  subscribe(listener: () => void): () => void;
  /** The raw remembered text for a key ("" when nothing is remembered). A string, so useSyncExternalStore can compare snapshots. */
  snapshot(key: string): string;
  /** Applies a change to the remembered progress. `ok` is false when the browser would not keep it. */
  update(key: string, change: (p: Progress) => Progress): { ok: boolean };
  /** True once a write has failed and none has worked since. */
  failed(): boolean;
};

export function createProgressStore(getStorage: () => StorageLike | null): ProgressStore {
  const memory = new Map<string, string>();
  const listeners = new Set<() => void>();
  let failedWrite = false;

  function storage(): StorageLike | null {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  function snapshot(key: string): string {
    try {
      const stored = storage()?.getItem(key);
      if (typeof stored === "string") return stored;
    } catch {
      // Reading is blocked: fall back to what this page itself remembered.
    }
    return memory.get(key) ?? "";
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot,
    update(key, change) {
      const next = serializeProgress(change(parseProgress(snapshot(key))));
      memory.set(key, next);
      let ok = true;
      try {
        const s = storage();
        if (!s) throw new Error("no storage");
        s.setItem(key, next);
      } catch {
        ok = false;
      }
      failedWrite = !ok;
      for (const l of listeners) l();
      return { ok };
    },
    failed: () => failedWrite,
  };
}
