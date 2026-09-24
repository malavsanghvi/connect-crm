import "server-only";

import { explainError } from "@/lib/errors";
import { can, canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

export type TaskCount = { ok: true; count: number } | { ok: false; error: string } | null;

/**
 * The Home badge: how many requests wait on the two-person rule (pledge
 * write-offs, refunds, voting-eligibility overrides). Same filters as the
 * Home approvals queue (src/app/(app)/approvals-queue.tsx), counted only.
 * Null when the user cannot see the queue at all.
 */
export async function countHomeTasks(session: CrmSession): Promise<TaskCount> {
  if (!canAccess(session, "approvals")) return null;
  const { db, center } = session;
  const seesGiving = can(session, ["giving.view", "giving.manage"]);
  const seesPeople = can(session, ["people.view", "people.approve"]);
  try {
    const [pledges, payments, overrides] = await Promise.all([
      seesGiving
        ? db
            .from("pledges")
            .select("id", { count: "exact", head: true })
            .eq("center_id", center.id)
            .not("written_off_by", "is", null)
            .in("status", ["open", "partially_paid"])
        : null,
      seesGiving
        ? db
            .from("payments")
            .select("id", { count: "exact", head: true })
            .eq("center_id", center.id)
            .not("refund_approved_by", "is", null)
            .eq("refunded_cents", 0)
        : null,
      seesPeople
        ? db
            .from("eligibility_snapshots")
            .select("id", { count: "exact", head: true })
            .eq("center_id", center.id)
            .not("override_by", "is", null)
            .is("override_second_approver", null)
        : null,
    ]);
    const error = pledges?.error ?? payments?.error ?? overrides?.error ?? null;
    if (error) {
      console.error("[home-tasks] could not count waiting approvals:", error);
      return { ok: false, error: `Could not count your tasks — ${explainError(error)}` };
    }
    return { ok: true, count: (pledges?.count ?? 0) + (payments?.count ?? 0) + (overrides?.count ?? 0) };
  } catch (error) {
    console.error("[home-tasks] counting waiting approvals threw:", error);
    return { ok: false, error: `Could not count your tasks — ${explainError(error)}` };
  }
}
