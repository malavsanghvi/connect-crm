"use server";

import { revalidatePath } from "next/cache";

import { ACTIVITY_NOTICE_VERSION } from "@/lib/activity/consent";
import { canMoveIdea, decisionTarget, ideaStatus, isIdeaDecision, parseIdeaReason, MAX_REASON_LENGTH } from "@/lib/activity/ideas";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason, type CrmSession } from "@/lib/session";

/**
 * Only the community's own administrator (settings.manage) decides about activity recording and about its ideas. Weaver staff
 * can look, where the community let them, but never agree, withdraw or answer for the community; the database refuses them
 * too, this gives the plain-English reason first.
 */
async function communityAdmin(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  if (auth.session.isPlatformAdmin) {
    return { ok: false, error: `Could not ${doing} — only this community's own administrator can decide this, not the Weaver team.` };
  }
  return auth;
}

// ── The community's agreement ────────────────────────────────────────────────

/**
 * The administrator agrees to activity recording (app.give_activity_consent: settings.manage, never Weaver staff, a fresh 2FA
 * check). It records who agreed, when and which version of the notice they read, switches recording on, and keeps the sharing
 * choice. The database asks for the 2FA code (CCSTP): the form opens the security-code window and sends the same answer again
 * once it is verified. The form carries the version of the notice that was on screen; if the notice has changed since, nothing
 * is recorded.
 */
export async function giveActivityConsentAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "record your agreement";
  const auth = await communityAdmin(doing);
  if (!auth.ok) return auth;
  if (String(fd.get("notice_version") ?? "") !== ACTIVITY_NOTICE_VERSION) {
    return { ok: false, error: `Could not ${doing} — the notice changed after you opened this page. Reload the page and read it again.` };
  }
  const share = fd.get("share") === "on";
  const { session } = auth;
  const { error } = await session.db.rpc("give_activity_consent", {
    p_center: session.center.id,
    p_share_with_weaver: share,
    p_notice_version: ACTIVITY_NOTICE_VERSION,
  });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/settings/automation");
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: share
      ? "Thank you. Recording is on, and Weaver staff can see counts of how communities use Weaver (no names, no content)."
      : "Thank you. Recording is on; only your own administrators see the results.",
  };
}

/** The administrator withdraws the agreement (app.withdraw_activity_consent): recording stops at once and sharing ends. */
export async function withdrawActivityConsentAction(): Promise<ActionResult> {
  const doing = "withdraw your agreement";
  const auth = await communityAdmin(doing);
  if (!auth.ok) return auth;
  const { session } = auth;
  const { error } = await session.db.rpc("withdraw_activity_consent", { p_center: session.center.id });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/settings/automation");
  revalidatePath("/", "layout");
  return { ok: true, message: "Your agreement is withdrawn. Weaver has stopped noting how your community uses it." };
}

/**
 * The administrator decides whether Weaver staff may see counts (app.set_activity_sharing: settings.manage, a fresh 2FA check,
 * only while the agreement stands). The form says which way to go (share = "true" or "false").
 */
export async function setActivitySharingAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "change whether Weaver staff see the counts";
  const share = fd.get("share");
  if (share !== "true" && share !== "false") {
    return { ok: false, error: `Could not ${doing} — the page is out of date. Reload it and try again.` };
  }
  const auth = await communityAdmin(doing);
  if (!auth.ok) return auth;
  const { session } = auth;
  const { error } = await session.db.rpc("set_activity_sharing", { p_center: session.center.id, p_share: share === "true" });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/settings/automation");
  return {
    ok: true,
    message:
      share === "true"
        ? "Weaver staff can now see counts of how communities use Weaver (no names, no content)."
        : "Weaver staff can no longer see counts of how your community uses Weaver.",
  };
}

// ── Answering an idea ────────────────────────────────────────────────────────

/**
 * Accept an automation idea, set it aside as not useful, or put it back in the list (Settings › Automation ideas).
 *
 * The change is an ordinary update of the idea's status. The database lets it through only for people with settings.manage in
 * this community (not Weaver staff), only for an idea they can see (not hidden by the small-group rule), and stamps who answered
 * and when itself (0622). The optional reason goes in the audit log with the change, like every reason in the portal
 * (x-audit-reason); it is not stored on the idea. The update names the status the person saw, so if somebody else answered the
 * same idea a moment earlier nothing is overwritten and the person is told.
 */
export async function decideIdeaAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "save your answer";
  const auth = await communityAdmin(doing);
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
