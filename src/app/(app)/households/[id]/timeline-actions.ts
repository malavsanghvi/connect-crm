"use server";

import { failure, type ActionResult } from "@/lib/errors";
import { parseTimeline, type TimelineEntry } from "@/lib/payment-proofs/timeline";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// READ ONLY. The timeline of one pledge (app.pledge_timeline, 0874): pledged, each proof event, each payment applied, Bank reconciled.
// The database decides who may read (the household's adults, and staff who verify or view giving); this only asks and says so in words.

const NO_ACCESS = "You don't have access to this area.";

export async function loadPledgeTimelineAction(pledgeId: string): Promise<ActionResult<TimelineEntry[]>> {
  const doing = "load the timeline";
  const auth = await authorizeAction("pledges", doing);
  if (!auth.ok) return auth;
  if (!isUuid(pledgeId)) return { ok: false, error: `Could not ${doing} — the pledge was not found.` };
  const r = await auth.session.db.rpc("pledge_timeline", { p_pledge: pledgeId });
  if (r.error) {
    // The database says "You don't have access to this area" itself (42501); say it the same way, not as a failed change.
    if (r.error.code === "42501") return { ok: false, error: NO_ACCESS };
    return failure(`Could not ${doing}`, r.error);
  }
  const entries = parseTimeline(r.data);
  if (!entries) {
    console.error("[household] pledge_timeline returned an unexpected shape:", r.data);
    return { ok: false, error: `Could not ${doing} — the database answered in a shape this screen does not understand (has the latest migration been applied?).` };
  }
  return { ok: true, data: entries };
}
