"use server";

import { revalidatePath } from "next/cache";

import { planDecision, type ApplicationDecision } from "@/lib/applications";
import { failure, type ActionResult } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { passesRoleChecks } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason, type CrmSession } from "@/lib/session";

export async function decideApplicationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const decision = String(formData.get("decision") ?? "") as ApplicationDecision;
  const doing = decision === "reject" ? "decline the application" : "approve the application";
  const auth = await authorizeAction("applicationsDecide", doing);
  if (!auth.ok) return auth;
  const { session } = auth;
  const { db, center } = session;

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — it was not found.` };
  if (decision !== "approve" && decision !== "reject") return { ok: false, error: "Could not record the decision — choose approve or decline." };
  if (decision === "reject" && !reason) {
    return { ok: false, error: "Could not decline the application — give a reason (it is kept for the applicant's record)." };
  }
  if (reason.length > 1000) return { ok: false, error: `Could not ${doing} — the reason is longer than 1,000 characters.` };

  const appRes = await db
    .from("membership_applications")
    .select("id, status, tier, membership_type_id, center_decided_by, household_id")
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (appRes.error) return failure(`Could not ${doing}`, appRes.error);
  if (!appRes.data) return { ok: false, error: `Could not ${doing} — it was not found, or you can't see it.` };
  const app = appRes.data;

  const typeRes = await db.from("membership_types").select("ec_approval_required").eq("id", app.membership_type_id).maybeSingle();
  if (typeRes.error) return failure(`Could not ${doing}`, typeRes.error);

  // The owner passes the Executive Committee check too (0501; owner decision 2026-09-25, second batch).
  const isEc = passesRoleChecks(session) || session.roles.some((r) => r.key === "executive_committee" && r.scopeKind === "center");
  const plan = planDecision(
    {
      status: app.status,
      tier: app.tier,
      ecApprovalRequired: typeRes.data?.ec_approval_required ?? false,
      centerDecidedBy: app.center_decided_by,
    },
    decision,
    { userId: session.userId, isExecutiveCommittee: isEc },
  );
  if (!plan.ok) return { ok: false, error: `Could not ${doing} — ${plan.reason}.` };

  const now = new Date().toISOString();
  const update =
    plan.step === "ec"
      ? { status: plan.next, ec_decided_by: session.userId, ec_decided_at: now }
      : plan.step === "center"
        ? { status: plan.next, center_decided_by: session.userId, center_decided_at: now, center_reason: reason || null }
        : app.status === "awaiting_ec"
          ? { status: plan.next, ec_decided_by: session.userId, ec_decided_at: now, center_reason: reason }
          : { status: plan.next, center_decided_by: session.userId, center_decided_at: now, center_reason: reason };

  const writer = reason ? await dbWithReason(session, reason) : db;
  const { data, error } = await writer
    .from("membership_applications")
    .update(update)
    .eq("id", id)
    .eq("status", app.status) // someone else may have decided meanwhile
    .select("id");
  if (error) return failure(`Could not ${doing}`, error);
  if (!data || data.length === 0) {
    return { ok: false, error: `Could not ${doing} — it changed while you were looking (or you lack permission). Reload and try again.` };
  }
  revalidatePath("/memberships/applications");
  revalidatePath("/");
  revalidatePath(`/households/${app.household_id}`);
  const message =
    plan.next === "awaiting_ec"
      ? "Center review recorded. It now waits for Executive Committee approval."
      : plan.next === "approved"
        ? await approvedMessage(db, id)
        : "Declined. The reason is saved with the application.";
  return { ok: true, message };
}

/** What approval created (0130: the membership, and an open fee pledge when the type has a fee). */
async function approvedMessage(db: CrmSession["db"], id: string): Promise<string> {
  const appRes = await db.from("membership_applications").select("fee_cents, membership_id").eq("id", id).maybeSingle();
  const membershipId = appRes.data?.membership_id;
  const m = membershipId ? await db.from("memberships").select("tier, fee_pledge_id").eq("id", membershipId).maybeSingle() : null;
  if (appRes.error || !m || m.error || !m.data) {
    console.error("approved application: could not read the new membership", appRes.error ?? m?.error ?? "no membership_id");
    return "Approved. The membership record could not be read back — reload the household to check it.";
  }
  const fee = appRes.data?.fee_cents ?? 0;
  const tier = m.data.tier.charAt(0).toUpperCase() + m.data.tier.slice(1);
  if (fee <= 0) return `Approved · ${tier} membership is now active.`;
  return m.data.fee_pledge_id
    ? `Approved · ${tier} membership is now active, and the ${formatCents(fee)} fee is recorded as an open pledge (card payment is not connected yet).`
    : `Approved · ${tier} membership is now active. The ${formatCents(fee)} fee was not recorded because Pledges & donations is switched off.`;
}
