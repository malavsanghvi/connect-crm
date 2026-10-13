"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { addCustomFieldAction, saveCustomValueAction, setCustomFieldStatusAction, type AddFieldCall, type AddFieldSave } from "@/app/(app)/households/[id]/custom-actions";
import { saveHouseholdFieldsAction, savePersonFieldsAction, type InlineSave } from "@/app/(app)/households/[id]/inline-actions";
import { addPersonInlineAction, type AddPersonCall, type AddPersonSave } from "@/app/(app)/households/[id]/slideover-actions";
import { addPersonId, retirePersonId, type AddIdInput, type RetireIdInput } from "@/app/(app)/identifiers/person-id-seam";
import { markDeceasedAction, undoDeceasedAction } from "@/app/(app)/people/deceased-actions";
import type { FormAction } from "@/components/action-form";
import type { ActionResult } from "@/lib/errors";
import { defKeyOf } from "@/lib/people-v2/custom-fields";
import type { Values } from "@/lib/people-v2/inline-edit";

// The writes the Family page and the person slide-over make, behind one small interface. The page gives it the real Server Actions;
// the dev previews (src/app/dev/people-family, src/app/dev/people-slideover) give it fakes that answer the way each state should
// look, so the screens can be checked without a database. Every write goes through this: a component never calls a Server Action
// directly.

export type EditTarget =
  | { kind: "person"; personId: string; householdId: string | null }
  | { kind: "household"; householdId: string }
  /** One custom field's value (src/lib/people-v2/custom-fields.ts); `path` is the page to refresh after a save. */
  | { kind: "custom"; entity: "people" | "households"; recordId: string; path: string };

export type SaveInput = { fields: Values; expect: Values; reason?: string | null; label: string };

export type FamilyActions = {
  /** Click-to-edit: one person's details or the household's. */
  save: (target: EditTarget, input: SaveInput) => Promise<InlineSave>;
  /** The inline "Add person" card. */
  addPerson: (input: AddPersonCall) => Promise<AddPersonSave>;
  /** The IDs section: add and retire. These two are the seam slice 6 swaps for commands (src/app/(app)/identifiers/person-id-seam.ts). */
  ids: {
    add: (input: AddIdInput) => Promise<ActionResult>;
    retire: (input: RetireIdInput) => Promise<ActionResult>;
  };
  /** The two sheets under ⋯ that are forms: mark as deceased, and undo it (the classic flows' own actions). */
  deceased: { mark: FormAction; undo: FormAction };
  /** Custom fields: add one, archive or restore one (the Settings screen's own actions). A value is saved through `save` with a "custom" target. */
  custom: {
    add: (input: AddFieldCall) => Promise<AddFieldSave>;
    setStatus: (input: { id: string; status: "active" | "archived" }) => Promise<ActionResult>;
  };
};

export const realActions: FamilyActions = {
  save: (target, input) => {
    if (target.kind === "custom") {
      const field = Object.keys(input.fields)[0] ?? "";
      return saveCustomValueAction({
        entity: target.entity,
        recordId: target.recordId,
        key: defKeyOf(field),
        value: input.fields[field] ?? "",
        expect: input.expect[field] ?? "",
        label: input.label,
        path: target.path,
      });
    }
    return target.kind === "person"
      ? savePersonFieldsAction({ ...input, personId: target.personId, householdId: target.householdId })
      : saveHouseholdFieldsAction({ ...input, householdId: target.householdId });
  },
  addPerson: addPersonInlineAction,
  ids: { add: addPersonId, retire: retirePersonId },
  deceased: { mark: markDeceasedAction, undo: undoDeceasedAction },
  custom: { add: addCustomFieldAction, setStatus: setCustomFieldStatusAction },
};

const Ctx = createContext<FamilyActions>(realActions);

/** `actions` may give only some of the writes (a preview that fakes the saves); the rest are the real ones. */
export function FamilyActionsProvider({ actions, children }: { actions?: Partial<FamilyActions>; children: ReactNode }) {
  const value = useMemo(() => ({ ...realActions, ...actions }), [actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFamilyActions(): FamilyActions {
  return useContext(Ctx);
}
