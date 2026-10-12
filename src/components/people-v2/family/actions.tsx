"use client";

import { createContext, useContext, type ReactNode } from "react";

import { saveHouseholdFieldsAction, savePersonFieldsAction, type InlineSave } from "@/app/(app)/households/[id]/inline-actions";
import type { Values } from "@/lib/people-v2/inline-edit";

// The two writes click-to-edit makes, behind one small interface. The page gives it the real Server Actions; the dev preview
// (src/app/dev/people-family) gives it fakes that answer the way each state should look, so the screens can be checked without a
// database. Every edit goes through this: a component never calls a Server Action directly.

export type EditTarget = { kind: "person"; personId: string; householdId: string } | { kind: "household"; householdId: string };

export type SaveInput = { fields: Values; expect: Values; reason?: string | null; label: string };

export type FamilyActions = {
  save: (target: EditTarget, input: SaveInput) => Promise<InlineSave>;
};

export const realActions: FamilyActions = {
  save: (target, input) =>
    target.kind === "person"
      ? savePersonFieldsAction({ ...input, personId: target.personId, householdId: target.householdId })
      : saveHouseholdFieldsAction({ ...input, householdId: target.householdId }),
};

const Ctx = createContext<FamilyActions>(realActions);

export function FamilyActionsProvider({ actions, children }: { actions?: FamilyActions; children: ReactNode }) {
  return <Ctx.Provider value={actions ?? realActions}>{children}</Ctx.Provider>;
}

export function useFamilyActions(): FamilyActions {
  return useContext(Ctx);
}
