"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { CommandDbError, CommandError } from "@/lib/commands/types";
import { deletePledge, editPledge, loadPledgeEditSheet, type PledgeEditSheet } from "@/lib/data/edit-pledge";
import { failure, type ActionResult } from "@/lib/errors";
import {
  DELETE_REASON_PROMPT,
  checkEditChanges,
  checkEditReason,
  checkPledgeId,
  deletedMessage,
  editedMessage,
  type DeletedPledge,
  type DeletePledgeInput,
  type EditedPledge,
  type EditPledgeInput,
} from "@/lib/giving-actions/edit-pledge";
import { isModuleEnabled, moduleOffMessage } from "@/lib/modules";
import { authorizeAction } from "@/lib/session";

// Edit and delete a pledge (migration 0782; NEEDS OWNER OK). giving.manage only, the same people who record a pledge or change a due
// date. The sheet reads the pledge with what may change on it (app.pledge_edit_state); its buttons save through editPledgeAction and
// deletePledgeAction. The database checks everything again, says why something is locked, and writes the reason to the audit entry
// the family's History shows. No money moves, so no second person.

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

function refresh(householdId: string) {
  revalidatePath("/giving/pledges");
  revalidatePath("/giving");
  if (householdId) revalidatePath(`/households/${householdId}`);
}

/** What the Edit sheet opens with: the pledge, what is locked and why, and the funds, campaigns and adults to choose from. */
export async function pledgeEditSheetAction(pledgeId: string): Promise<ActionResult<PledgeEditSheet>> {
  const auth = await authorizeAction("givingManage", "open the pledge");
  if (!auth.ok) return auth;
  if (!isModuleEnabled(auth.session, "giving")) return { ok: false, error: moduleOffMessage("giving", auth.session.center.name) };
  const id = checkPledgeId(pledgeId);
  if (!id.ok) return { ok: false, error: `Could not open the pledge — ${lowerFirst(id.error)}` };
  try {
    return { ok: true, data: await loadPledgeEditSheet(auth.session, id.value) };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, error: `Could not open the pledge — ${lowerFirst(error.message)}` };
    if (error instanceof CommandDbError) return failure("Could not open the pledge", error.dbError);
    return failure("Could not open the pledge", error);
  }
}

export async function editPledgeAction(input: EditPledgeInput): Promise<ActionResult<EditedPledge>> {
  return withActivity("giving.edit_pledge", () => edit(input), {
    entityFrom: (result) => ({ kind: "pledge", id: result?.data?.pledgeId }),
  });
}

async function edit(input: EditPledgeInput): Promise<ActionResult<EditedPledge>> {
  const auth = await authorizeAction("givingManage", "change the pledge");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", session.center.name) };
  const id = checkPledgeId(input?.pledgeId);
  if (!id.ok) return { ok: false, error: `Could not change the pledge — ${lowerFirst(id.error)}` };
  const changes = checkEditChanges(input?.changes);
  if (!changes.ok) return { ok: false, error: `Could not change the pledge — ${lowerFirst(changes.error)}` };
  const reason = checkEditReason(input?.reason);
  if (!reason.ok) return { ok: false, error: `Could not change the pledge — ${lowerFirst(reason.error)}` };
  try {
    const done = await editPledge(session, id.value, changes.value, reason.value);
    if (done.changed) refresh(done.householdId);
    return { ok: true, data: done, message: editedMessage(done) };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, error: `Could not change the pledge — ${lowerFirst(error.message)}` };
    if (error instanceof CommandDbError) return failure("Could not change the pledge", error.dbError);
    return failure("Could not change the pledge", error);
  }
}

export async function deletePledgeAction(input: DeletePledgeInput): Promise<ActionResult<DeletedPledge>> {
  return withActivity("giving.delete_pledge", () => remove(input), {
    entityFrom: (result) => ({ kind: "pledge", id: result?.data?.pledgeId }),
  });
}

async function remove(input: DeletePledgeInput): Promise<ActionResult<DeletedPledge>> {
  const auth = await authorizeAction("givingManage", "delete the pledge");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", session.center.name) };
  const id = checkPledgeId(input?.pledgeId);
  if (!id.ok) return { ok: false, error: `Could not delete the pledge — ${lowerFirst(id.error)}` };
  const reason = checkEditReason(input?.reason, DELETE_REASON_PROMPT);
  if (!reason.ok) return { ok: false, error: `Could not delete the pledge — ${lowerFirst(reason.error)}` };
  try {
    const done = await deletePledge(session, id.value, reason.value);
    refresh(done.householdId);
    return { ok: true, data: done, message: deletedMessage(done) };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, error: `Could not delete the pledge — ${lowerFirst(error.message)}` };
    if (error instanceof CommandDbError) return failure("Could not delete the pledge", error.dbError);
    return failure("Could not delete the pledge", error);
  }
}
