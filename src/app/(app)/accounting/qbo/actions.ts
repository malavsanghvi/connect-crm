"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { QBO_PURPOSES } from "@/lib/labels";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

function refresh() {
  revalidatePath("/accounting/qbo");
  revalidatePath("/");
}

export async function saveMappingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboManage", "save the account mapping");
  if (!auth.ok) return auth;
  const purpose = String(formData.get("purpose") ?? "");
  const accountId = String(formData.get("qbo_account_id") ?? "").trim();
  const accountName = String(formData.get("qbo_account_name") ?? "").trim();
  const label = QBO_PURPOSES.find((p) => p.purpose === purpose)?.label ?? purpose;
  if (!/^[a-z_.]{2,60}$/.test(purpose)) return { ok: false, error: "Could not save the mapping — unknown purpose." };
  if (!accountId) return { ok: false, error: `Could not save the mapping for ${label} — enter the QuickBooks account id.` };
  if (accountId.length > 60 || accountName.length > 200) return { ok: false, error: "Could not save the mapping — the value is too long." };
  const { error } = await auth.session.db.from("qbo_account_mappings").upsert(
    {
      center_id: auth.session.center.id,
      purpose,
      qbo_account_id: accountId,
      qbo_account_name: accountName || null,
      // A changed mapping must be approved again before anything posts with it.
      approved_by: null,
      approved_at: null,
    },
    { onConflict: "center_id,purpose" },
  );
  if (error) return failure(`Could not save the mapping for ${label}`, error);
  refresh();
  return { ok: true, message: `Saved ${label}. Approve it before postings use it.` };
}

export async function approveMappingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboManage", "approve the account mapping");
  if (!auth.ok) return auth;
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not approve the mapping — it was not found." };
  const { data, error } = await auth.session.db
    .from("qbo_account_mappings")
    .update({ approved_by: auth.session.userId, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("center_id", auth.session.center.id)
    .select("purpose");
  if (error) return failure("Could not approve the mapping", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not approve the mapping — no change was saved (you may lack permission)." };
  refresh();
  return { ok: true, message: "Mapping approved." };
}

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
