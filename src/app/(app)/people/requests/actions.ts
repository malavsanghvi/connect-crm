"use server";

import { runScreenCommand } from "@/lib/commands/screen";
import type { ActionResult } from "@/lib/errors";
import { isHouseholdRole } from "@/lib/people";
import { isUuid } from "@/lib/search-params";

// Deciding a family change request is a command now (people.decide_household_request): this action reads the form and
// calls the same `execute` that the ⌘K palette and Niva use, so there is one code path.
export async function decideHouseholdRequestAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const decision = String(formData.get("decision") ?? "");
  const doing = decision === "reject" ? "decline the request" : "approve the request";
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — it was not found.` };
  if (decision !== "approve" && decision !== "reject") return { ok: false, error: "Could not record the decision — choose approve or decline." };
  const role = String(formData.get("role") ?? "");
  const raw: Record<string, string> = { id, decision, reason: String(formData.get("reason") ?? "") };
  // A relationship that is not one of the five (or is "primary") is the same as none chosen.
  if (isHouseholdRole(role) && role !== "primary") raw.role = role;
  return runScreenCommand("people.decide_household_request", raw, doing);
}
