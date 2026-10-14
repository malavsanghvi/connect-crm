"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { InlineSave } from "@/app/(app)/households/[id]/inline-actions";
import { UNDO_MS } from "@/lib/people-v2/inline-edit";

// The "Saved … Undo" bar: it stays for 30 seconds after a change (docs/PEOPLE_REDESIGN.md section 5). Undo writes a compensating,
// audited change with the earlier value; if someone else changed the value since, it does not run and says so. The bar holds the
// latest change only. It sits above the phone's bottom bars so it is never hidden by them.

export type UndoOffer = {
  message: string;
  /** Writes the earlier value back. */
  run: () => Promise<InlineSave>;
  /** Said after it worked: "Put Tunde's mobile back". */
  doneMessage: string;
};

type UndoApi = { offer: (o: UndoOffer) => void };
const Ctx = createContext<UndoApi | null>(null);

/** The undo bar's API, or null outside a provider (an edit then simply has no Undo). */
export function useUndo(): UndoApi | null {
  return useContext(Ctx);
}

type Entry = { id: number; offer: UndoOffer; status: "offered" | "working" | "done" | "failed"; error: string | null };

export function UndoProvider({ children, windowMs = UNDO_MS }: { children: ReactNode; windowMs?: number }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const seq = useRef(0);

  const offer = useCallback((o: UndoOffer) => {
    seq.current += 1;
    setEntry({ id: seq.current, offer: o, status: "offered", error: null });
  }, []);

  const dismiss = useCallback(() => setEntry(null), []);

  // The offer lapses after the window; the confirmation after an undo goes after a few seconds. An error stays until dismissed.
  const id = entry?.id;
  const status = entry?.status;
  useEffect(() => {
    if (id === undefined || status === undefined) return;
    if (status !== "offered" && status !== "done") return;
    const t = setTimeout(() => setEntry((cur) => (cur && cur.id === id ? null : cur)), status === "offered" ? windowMs : 4000);
    return () => clearTimeout(t);
  }, [id, status, windowMs]);

  async function undo() {
    if (!entry || entry.status !== "offered") return;
    const current = entry;
    setEntry({ ...current, status: "working", error: null });
    let result: InlineSave;
    try {
      result = await current.offer.run();
    } catch (error) {
      console.error("[family] undo did not complete:", error);
      setEntry((cur) =>
        cur && cur.id === current.id ? { ...cur, status: "failed", error: "Could not put it back — the server did not respond. Nothing was changed." } : cur,
      );
      return;
    }
    setEntry((cur) => {
      if (!cur || cur.id !== current.id) return cur;
      if (result.ok) return { ...cur, status: "done", error: null };
      const why = result.kind === "conflict" ? "Could not put it back — someone changed it since. Nothing was changed." : result.error;
      return { ...cur, status: "failed", error: why };
    });
  }

  const api = useMemo(() => ({ offer }), [offer]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <UndoBar entry={entry} windowMs={windowMs} onUndo={undo} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

function UndoBar({ entry, windowMs, onUndo, onDismiss }: { entry: Entry | null; windowMs: number; onUndo: () => void; onDismiss: () => void }) {
  // The line under the message runs down over the window. It starts full, and one frame later is told to shrink.
  const [shrunk, setShrunk] = useState<number | null>(null);
  const id = entry?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    const frame = requestAnimationFrame(() => setShrunk(id));
    return () => cancelAnimationFrame(frame);
  }, [id]);

  return (
    <div aria-live="polite" aria-atomic="true">
      {entry ? (
        <div
          key={entry.id}
          role={entry.status === "failed" ? "alert" : "status"}
          data-testid="undo-bar"
          className="fixed bottom-[9.5rem] left-1/2 z-50 w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-[14px] bg-[var(--v2-ink)] text-white shadow-toast md:bottom-6 md:[html[data-slideover]_&]:left-[calc((100vw-520px)/2)] md:[html[data-slideover]_&]:w-[min(34rem,calc(100vw-560px))]"
        >
          <div className="flex items-center gap-3 px-4 py-3 text-[14px]">
            <span className="min-w-0 flex-1">
              {entry.status === "done" ? entry.offer.doneMessage : entry.status === "failed" ? entry.error : entry.offer.message}
              {entry.status === "working" ? "…" : ""}
            </span>
            {entry.status === "offered" ? (
              <button
                type="button"
                onClick={onUndo}
                className="min-h-10 rounded-full bg-white/15 px-4 text-[14px] font-bold text-white hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                Undo
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close"
              className="grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/15 hover:text-white"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {entry.status === "offered" ? (
            <span
              aria-hidden="true"
              className="block h-[3px] bg-gold"
              style={{ width: shrunk === entry.id ? "0%" : "100%", transition: `width ${windowMs}ms linear` }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
