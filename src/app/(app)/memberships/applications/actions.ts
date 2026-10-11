"use server";

import { withActivity } from "@/lib/activity/with-activity";
import { runScreenCommand } from "@/lib/commands/screen";
import type { ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";

// Deciding an application is a command now (people.decide_application): this action reads the form and calls the same
// `execute` that the ⌘K palette and Niva use, so there is one code path.

export async function decideApplicationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return withActivity("people.decide_application", () => decideApplication(formData), {
    entityFrom: { kind: "application", id: String(formData.get("id") ?? "") },
  });
}

async function decideApplication(formData: FormData): Promise<ActionResult> {
  const decision = String(formData.get("decision") ?? "");
  const doing = decision === "reject" ? "decline the application" : "approve the application";
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — it was not found.` };
  if (decision !== "approve" && decision !== "reject") return { ok: false, error: "Could not record the decision — choose approve or decline." };
  return runScreenCommand("people.decide_application", { id, decision, reason: String(formData.get("reason") ?? "") }, doing);
}
