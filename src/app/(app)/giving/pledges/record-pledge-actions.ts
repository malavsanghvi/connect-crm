"use server";

import { withActivity } from "@/lib/activity/with-activity";
import { CommandDbError, CommandError } from "@/lib/commands/types";
import { loadPledgeSheetOptions, recordManualPledge } from "@/lib/data/record-pledge";
import { todayInTz } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import { checkPledge, isRequestId, type PledgeSheetOptions, type RecordedPledge, type RecordPledgeInput } from "@/lib/giving-actions/record-pledge";
import { isModuleEnabled, moduleOffMessage } from "@/lib/modules";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// The Record pledge sheet (docs/GIVING_REDESIGN.md slice 7; NEEDS OWNER OK). giving.manage only (section 10 decision 3). The sheet's
// button records through recordPledgeAction; one sheet records once (its request id is the confirmation, app.record_manual_pledge
// returns the same pledge for the same id). There is no undo here: a pledge recorded by mistake is written off by two people.

/** What the sheet offers: funds, campaigns, opportunities (when that module is on) and, once a family is chosen, its adults. */
export async function pledgeSheetOptionsAction(householdId: string | null): Promise<ActionResult<PledgeSheetOptions>> {
  const auth = await authorizeAction("recordPledge", "open Record a pledge");
  if (!auth.ok) return auth;
  if (householdId !== null && !isUuid(householdId)) return { ok: false, error: "Could not open the family — it was not found." };
  try {
    return { ok: true, data: await loadPledgeSheetOptions(auth.session, householdId) };
  } catch (error) {
    if (error instanceof CommandDbError) return failure("Could not load the funds, campaigns and adults for the pledge", error.dbError);
    return failure("Could not load the funds, campaigns and adults for the pledge", error);
  }
}

export async function recordPledgeAction(input: RecordPledgeInput): Promise<ActionResult<RecordedPledge>> {
  return withActivity("giving.record_pledge", () => recordPledge(input), {
    entityFrom: (result) => ({ kind: "pledge", id: result?.data?.pledgeId }),
  });
}

async function recordPledge(input: RecordPledgeInput): Promise<ActionResult<RecordedPledge>> {
  const auth = await authorizeAction("recordPledge", "record the pledge");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", session.center.name) };
  if (!isRequestId(input?.requestId)) return { ok: false, error: "Could not record the pledge — close the sheet and open it again, so that it cannot be recorded twice." };
  const checked = checkPledge(input, todayInTz(session.center.time_zone));
  if (!checked.ok) return { ok: false, error: `Could not record the pledge — ${lowerFirst(checked.error)}` };
  try {
    const recorded = await recordManualPledge(session, checked.value, `sheet:${input.requestId}`);
    return {
      ok: true,
      data: recorded,
      message: recorded.replayed ? `This pledge was already recorded (${recorded.pledgeNumber ?? "number pending"}). Nothing was added.` : undefined,
    };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, error: `Could not record the pledge — ${lowerFirst(error.message)}` };
    if (error instanceof CommandDbError) return failure("Could not record the pledge", error.dbError);
    return failure("Could not record the pledge", error);
  }
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
