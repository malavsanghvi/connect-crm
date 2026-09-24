"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { parseAmountToCents, formatCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// Two-person rule (0016): refunds, pledge write-offs and voting-eligibility
// overrides need a first person to record the request and a DIFFERENT
// authorized person to approve via app.approve_as_second(). The database
// trigger refuses the final status change otherwise — its message is shown.

function refresh() {
  revalidatePath("/");
  revalidatePath("/giving/pledges");
  revalidatePath("/giving/payments");
  revalidatePath("/people/voting");
}

const TARGETS = {
  pledges: { access: "givingApprove", what: "the pledge write-off" },
  payments: { access: "givingApprove", what: "the refund" },
  eligibility_snapshots: { access: "peopleApprove", what: "the voting-eligibility override" },
} as const;

export async function approveAsSecondAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const table = String(formData.get("table") ?? "") as keyof typeof TARGETS;
  const id = String(formData.get("id") ?? "");
  const target = TARGETS[table];
  if (!target || !isUuid(id)) return { ok: false, error: "Could not approve — the request was not found." };
  const auth = await authorizeAction(target.access, `approve ${target.what}`);
  if (!auth.ok) return auth;
  const { error } = await auth.session.db.rpc("approve_as_second", { p_table: table, p_id: id });
  if (error) return failure(`Could not approve ${target.what}`, error);
  refresh();
  return { ok: true, message: `Second approval recorded for ${target.what}.` };
}

// ---------------------------------------------------------------------------
// Pledge write-offs
// ---------------------------------------------------------------------------
export async function requestWriteOffAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("givingManage", "request the write-off");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: "Could not request the write-off — the pledge was not found." };
  if (!reason) return { ok: false, error: "Could not request the write-off — give a reason; the second approver will read it." };
  const { data, error } = await db
    .from("pledges")
    .update({ written_off_by: userId, written_off_second_approver: null, write_off_reason: reason.slice(0, 1000) })
    .eq("id", id)
    .eq("center_id", center.id)
    .in("status", ["open", "partially_paid"])
    .is("written_off_by", null)
    .select("id, pledge_number");
  if (error) return failure("Could not request the write-off", error);
  if (!data || data.length === 0) {
    return { ok: false, error: "Could not request the write-off — the pledge is no longer open, a request already exists, or you lack permission." };
  }
  refresh();
  return { ok: true, message: `Write-off of ${data[0].pledge_number ?? "the pledge"} requested. A different person with giving.approve must approve it.` };
}

export async function cancelWriteOffRequestAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("givingManage", "withdraw the write-off request");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not withdraw the request — the pledge was not found." };
  const { data, error } = await db
    .from("pledges")
    .update({ written_off_by: null, written_off_second_approver: null, write_off_reason: null })
    .eq("id", id)
    .eq("center_id", center.id)
    .in("status", ["open", "partially_paid"])
    .select("id");
  if (error) return failure("Could not withdraw the write-off request", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not withdraw the request — the pledge is no longer open." };
  refresh();
  return { ok: true, message: "Write-off request withdrawn." };
}

export async function completeWriteOffAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("givingManage", "write off the pledge");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not write off the pledge — it was not found." };
  const { data, error } = await db
    .from("pledges")
    .update({ status: "written_off", closed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("center_id", center.id)
    .in("status", ["open", "partially_paid"])
    .select("id, pledge_number");
  // The database refuses this unless two different people approved (check_violation).
  if (error) return failure("Could not write off the pledge", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not write off the pledge — it is no longer open, or you lack permission." };
  refresh();
  return { ok: true, message: `${data[0].pledge_number ?? "Pledge"} written off.` };
}

// ---------------------------------------------------------------------------
// Refunds (offline and bank payments; card refunds go through the payment provider)
// ---------------------------------------------------------------------------
export async function requestRefundAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("givingManage", "request the refund");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const amountText = String(formData.get("amount") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: "Could not request the refund — the payment was not found." };
  if (!reason) return { ok: false, error: "Could not request the refund — give a reason; the second approver will read it." };
  const current = await db.from("payments").select("amount_cents, refunded_cents").eq("id", id).eq("center_id", center.id).maybeSingle();
  if (current.error) return failure("Could not request the refund", current.error);
  if (!current.data) return { ok: false, error: "Could not request the refund — the payment was not found, or you can't see it." };
  const refundable = current.data.amount_cents - current.data.refunded_cents;
  const cents = amountText ? parseAmountToCents(amountText) : refundable;
  if (cents === null || cents <= 0) return { ok: false, error: "Could not request the refund — enter the amount to refund, e.g. 251.00." };
  if (cents > refundable) {
    return { ok: false, error: `Could not request the refund — at most ${formatCents(refundable, center.currency)} of this payment can be refunded.` };
  }
  const { data, error } = await db
    .from("payments")
    .update({ refund_approved_by: userId, refund_second_approver: null, refund_reason: reason.slice(0, 1000), refund_requested_cents: cents })
    .eq("id", id)
    .eq("center_id", center.id)
    .is("refund_approved_by", null)
    .select("id, receipt_number");
  if (error) return failure("Could not request the refund", error);
  if (!data || data.length === 0) {
    return { ok: false, error: "Could not request the refund — a request already exists, or you lack permission." };
  }
  refresh();
  return {
    ok: true,
    message: `Refund of ${formatCents(cents, center.currency)} on ${data[0].receipt_number ?? "the payment"} requested. A different person with giving.approve must approve it.`,
  };
}

export async function recordRefundAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("givingManage", "record the refund");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = String(formData.get("id") ?? "");
  const cents = parseAmountToCents(String(formData.get("amount") ?? ""));
  if (!isUuid(id)) return { ok: false, error: "Could not record the refund — the payment was not found." };
  if (cents === null || cents <= 0) return { ok: false, error: "Could not record the refund — enter the amount refunded, e.g. 51.00." };

  const current = await db
    .from("payments")
    .select("amount_cents, refunded_cents, provider, status")
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (current.error) return failure("Could not record the refund", current.error);
  if (!current.data) return { ok: false, error: "Could not record the refund — the payment was not found, or you can't see it." };
  const p = current.data;
  if (p.provider !== "offline" && p.provider !== "bank") {
    return { ok: false, error: "Card and online payments are refunded through the payment provider, not recorded here." };
  }
  const total = p.refunded_cents + cents;
  if (total > p.amount_cents) {
    return {
      ok: false,
      error: `Could not record the refund — that would refund ${formatCents(total, center.currency)} of a ${formatCents(p.amount_cents, center.currency)} payment.`,
    };
  }
  const { data, error } = await db
    .from("payments")
    .update({ refunded_cents: total, status: total === p.amount_cents ? "refunded" : "partially_refunded" })
    .eq("id", id)
    .eq("refunded_cents", p.refunded_cents)
    .select("id");
  // The database refuses this unless two different people approved (check_violation).
  if (error) return failure("Could not record the refund", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not record the refund — the payment changed meanwhile. Reload and try again." };
  refresh();
  return { ok: true, message: `Refund of ${formatCents(cents, center.currency)} recorded.` };
}
