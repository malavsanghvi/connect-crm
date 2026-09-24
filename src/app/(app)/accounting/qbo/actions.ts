"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

function refresh() {
  revalidatePath("/accounting/qbo");
  revalidatePath("/");
}

// The account mapping moved to Accounting › QuickBooks setup (setup/actions.ts):
// accounts are chosen from the chart pulled from QuickBooks and the mapping is
// approved as a whole with a fresh 2FA check (app.approve_qbo_mapping).

export async function retryPostingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboManage", "retry the posting");
  if (!auth.ok) return auth;
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not retry — the posting was not found." };
  const { data, error } = await auth.session.db
    .from("ledger_postings")
    .update({ status: "queued" })
    .eq("id", id)
    .eq("center_id", auth.session.center.id)
    .eq("status", "failed")
    .select("id");
  if (error) return failure("Could not retry the posting", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not retry — the posting is no longer in the failed state." };
  refresh();
  return { ok: true, message: "Queued again. The QuickBooks poster will pick it up on its next run." };
}

export async function retryAllFailedAction(): Promise<ActionResult> {
  const auth = await authorizeAction("qboManage", "retry the failed postings");
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db
    .from("ledger_postings")
    .update({ status: "queued" })
    .eq("center_id", auth.session.center.id)
    .eq("status", "failed")
    .select("id");
  if (error) return failure("Could not retry the failed postings", error);
  refresh();
  const n = data?.length ?? 0;
  return { ok: true, message: n === 0 ? "There were no failed postings to retry." : `Queued ${n} posting${n === 1 ? "" : "s"} again.` };
}
