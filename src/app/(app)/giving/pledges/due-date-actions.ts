"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { rpcJson } from "@/lib/commands/catalog/db";
import { CommandDbError } from "@/lib/commands/types";
import { formatDate, todayInTz } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import { checkDueChange, type ChangeDueInput } from "@/lib/giving-due";
import { isModuleEnabled, moduleOffMessage } from "@/lib/modules";
import { authorizeAction } from "@/lib/session";

// Change an open pledge's due date (every pledge has one, 0775): giving.manage, Giving on, a reason that shows in the family's History.
// No money moves, so no second person. The database checks everything again (app.set_pledge_due_on).

export type ChangedDue = { pledgeId: string; pledgeNumber: string | null; householdId: string; dueOn: string; was: string | null; changed: boolean };

export async function changePledgeDueAction(input: ChangeDueInput): Promise<ActionResult<ChangedDue>> {
  return withActivity("giving.change_due_date", () => changeDue(input), {
    entityFrom: (result) => ({ kind: "pledge", id: result?.data?.pledgeId }),
  });
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function changeDue(input: ChangeDueInput): Promise<ActionResult<ChangedDue>> {
  const auth = await authorizeAction("givingManage", "change the due date");
  if (!auth.ok) return auth;
  const { session } = auth;
  const { db, center } = session;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", center.name) };
  const checked = checkDueChange(input, todayInTz(center.time_zone));
  if (!checked.ok) return { ok: false, error: `Could not change the due date — ${checked.error[0].toLowerCase()}${checked.error.slice(1)}` };
  const { pledgeId, dueOn, reason } = checked.value;
  let j: Record<string, unknown> | null;
  try {
    j = (await rpcJson(db, "set_pledge_due_on", { p_center: center.id, p_pledge: pledgeId, p_due_on: dueOn, p_reason: reason }, "change the due date")) as Record<
      string,
      unknown
    > | null;
  } catch (error) {
    return failure("Could not change the due date", error instanceof CommandDbError ? error.dbError : error);
  }
  if (!j || !str(j.pledge_id)) {
    return { ok: false, error: "The due date may not have changed: the database did not say. Open the pledge again to check before trying again." };
  }
  const data: ChangedDue = {
    pledgeId: str(j.pledge_id) ?? pledgeId,
    pledgeNumber: str(j.pledge_number),
    householdId: str(j.household_id) ?? "",
    dueOn: str(j.due_on) ?? dueOn,
    was: str(j.was),
    changed: j.changed === true,
  };
  revalidatePath("/giving/pledges");
  revalidatePath("/giving");
  if (data.householdId) revalidatePath(`/households/${data.householdId}`);
  const ref = data.pledgeNumber ?? "The pledge";
  return {
    ok: true,
    data,
    message: data.changed
      ? `${ref} is now due on ${formatDate(data.dueOn, center.time_zone)}.`
      : `${ref} was already due on ${formatDate(data.dueOn, center.time_zone)}. Nothing changed.`,
  };
}
