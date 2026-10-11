"use server";

import { revalidatePath } from "next/cache";

import { canMoveIdea, decisionTarget, ideaStatus, isIdeaDecision, parseIdeaReason, MAX_REASON_LENGTH } from "@/lib/activity/ideas";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

/**
 * Accept an automation idea, set it aside as not useful, or put it back in the list (Settings › Automation ideas).
 *
 * The change is an ordinary update of the idea's status. The database lets it through only for people with settings.manage in
 * this community, only for an idea they can see (not hidden by the small-group rule), and stamps who answered and when itself
 * (0622). The optional reason goes in the audit log with the change, like every reason in the portal (x-audit-reason); it is
 * not stored on the idea. The update names the status the person saw, so if somebody else answered the same idea a moment
 * earlier nothing is overwritten and the person is told.
 */
export async function decideIdeaAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "save your answer";
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;

  const id = String(fd.get("id") ?? "");
  const decision = fd.get("decision");
  if (!isUuid(id) || !isIdeaDecision(decision)) {
    return { ok: false, error: `Could not ${doing} — the page is out of date. Reload it and try again.` };
  }
  const from = ideaStatus(String(fd.get("from") ?? ""));
  const to = decisionTarget(decision);
  if (!canMoveIdea(from, to)) {
    return { ok: false, error: `Could not ${doing} — this idea can't be changed that way any more. Reload the page to see where it stands.` };
  }
  const why = parseIdeaReason(fd.get("reason"));
  if (!why.ok) return { ok: false, error: `Could not ${doing} — keep the reason under ${MAX_REASON_LENGTH} characters.` };

  const { session } = auth;
  const db = why.reason ? await dbWithReason(session, why.reason) : session.db;
  const { data, error } = await db
    .from("automation_candidates")
    .update({ status: to })
    .eq("id", id)
    .eq("center_id", session.center.id)
    .eq("status", from)
    .select("id");
  if (error) return failure(`Could not ${doing}`, error);
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: `Could not ${doing} — this idea was already answered, or it is no longer in the list. Reload the page to see where it stands.`,
    };
  }
  revalidatePath("/settings/automation");
  const message =
    to === "accepted"
      ? "Saved. The idea is now under “Ideas you accepted”."
      : to === "dismissed"
        ? "Saved. The idea is set aside; you can bring it back from “Ideas you set aside”."
        : "Saved. The idea is back in the list.";
  return { ok: true, message };
}
