"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isHouseholdRole } from "@/lib/people";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

function refresh() {
  revalidatePath("/people/requests");
  revalidatePath("/households");
  revalidatePath("/people");
}

export async function decideHouseholdRequestAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const decision = String(formData.get("decision") ?? "");
  const doing = decision === "reject" ? "decline the request" : "approve the request";
  const auth = await authorizeAction("householdRequestsDecide", doing);
  if (!auth.ok) return auth;
  const { session } = auth;

  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — it was not found.` };
  if (decision !== "approve" && decision !== "reject") return { ok: false, error: "Could not record the decision — choose approve or decline." };

  const roleRaw = String(formData.get("role") ?? "");
  if (decision === "approve" && (!isHouseholdRole(roleRaw) || roleRaw === "primary")) {
    return { ok: false, error: "Could not approve the request — choose their relationship to the household first." };
  }
  const reason = String(formData.get("reason") ?? "").trim();
  if (decision === "reject" && !reason) {
    return { ok: false, error: "Could not decline the request — give a reason (it is kept for the household's record)." };
  }
  if (reason.length > 1000) return { ok: false, error: `Could not ${doing} — the reason is longer than 1,000 characters.` };

  const db = await dbWithReason(session, reason || `Family change request ${decision === "approve" ? "approved" : "declined"}`);
  const res = await db.rpc("decide_household_change_request", {
    p_request: id,
    p_decision: decision,
    ...(decision === "approve" && isHouseholdRole(roleRaw) ? { p_role: roleRaw } : {}),
    ...(reason ? { p_reason: reason } : {}),
  });
  if (res.error) return failure(`Could not ${doing}`, res.error);
  refresh();
  return { ok: true, message: decision === "approve" ? "Request approved — they're now in the household · audit logged" : "Request declined · audit logged" };
}
