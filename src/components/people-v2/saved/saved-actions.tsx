"use client";

import { createContext, useContext, type ReactNode } from "react";

import { deleteViewAction, renameViewAction, saveViewAction, setPinAction } from "@/app/(app)/people/saved-actions";
import type { ActionResult } from "@/lib/errors";

// The writes the saved-views screens make, behind one small interface. The page gives it the real Server Actions; the dev preview
// (src/app/dev/people-views) gives it fakes that answer the way each state should look, so the screens can be checked without a
// database. A component never calls a Server Action directly.

export type SaveViewInput = { name: string; list: string; params: Record<string, string>; sort?: string | null };
export type SavedBits = { id: string; name: string };

export type SavedActions = {
  save: (input: SaveViewInput) => Promise<ActionResult<SavedBits>>;
  rename: (input: { id: string; name: string }) => Promise<ActionResult<SavedBits>>;
  remove: (input: { id: string }) => Promise<ActionResult>;
  pin: (input: { householdId: string; pinned: boolean }) => Promise<ActionResult<{ pinned: boolean }>>;
};

export const realSavedActions: SavedActions = { save: saveViewAction, rename: renameViewAction, remove: deleteViewAction, pin: setPinAction };

const Ctx = createContext<SavedActions>(realSavedActions);

export function SavedActionsProvider({ actions, children }: { actions?: SavedActions; children: ReactNode }) {
  return <Ctx.Provider value={actions ?? realSavedActions}>{children}</Ctx.Provider>;
}

export function useSavedActions(): SavedActions {
  return useContext(Ctx);
}

/** A call that throws (the server did not answer) is told in words, never swallowed. */
export async function attempt<T>(doing: string, call: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call();
  } catch (error) {
    console.error(`[people saved views] ${doing} did not complete:`, error);
    return { ok: false, error: `Could not ${doing} — the server did not respond. Check your connection and try again.` };
  }
}
