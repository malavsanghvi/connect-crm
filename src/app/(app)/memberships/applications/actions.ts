"use server";

import { revalidatePath } from "next/cache";

import { planDecision, type ApplicationDecision } from "@/lib/applications";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

export async function decideApplicationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const decision = String(formData.get("decision") ?? "") as ApplicationDecision;
  const doing = decision === "reject" ? "reject the application" : "approve the application";
  const auth = await authorizeAction("applicationsDecide", doing);
  if (!auth.ok) return auth;
  const { session } = auth;
  const { db, center } = session;

  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — it was not found.` };
  if (decision !== "approve" && decision !== "reject") return { ok: false, error: "Could not record the decision — choose approve or reject." };
  if (decision === "reject" && !reason) {
    return { ok: false, error: "Could not reject the application — give a reason (it is kept for the applicant's record)." };
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

  const isEc = session.isPlatformAdmin || session.roles.some((r) => r.key === "executive_committee" && r.scopeKind === "center");
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

  const { data, error } = await db
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
  revalidatePath(`/households/${app.household_id}`);
  const message =
    plan.next === "awaiting_ec"
      ? "Center review recorded. It now waits for Executive Committee approval."
      : plan.next === "approved"
        ? "Approved. This records the decision only — the membership record and the fee capture are not created automatically yet."
        : "Rejected. The reason is saved with the application.";
  return { ok: true, message };
}
