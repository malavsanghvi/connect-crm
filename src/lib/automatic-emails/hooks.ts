// Hooks other streams call so automatic emails (0770) follow what they do.
//
// onDonationsUploaded: the donation upload calls it after its rows are saved. Uploaded donations get NO receipt email by
// default: the upload marks its own transaction (select app.mark_donation_upload(); in the database function that inserts the
// rows), so the payment trigger stays quiet, and this hook asks the database to queue receipts for the uploaded payments, which
// it does only when the community switched on automatic receipts AND "email receipts for uploaded donations too" (Settings ›
// Automatic emails; off by default) and the treasurer's approval of the receipt templates is current. Calling it twice for the
// same payments sends nothing twice (one email per payment and address).

import { failure } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";

export type UploadReceiptsResult =
  | { ok: true; queued: number; skipped: number; /** Why nothing (or not everything) was queued, in plain English; null when all were. */ note: string | null }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onDonationsUploaded(
  paymentIds: readonly string[],
  ctx: { db: Pick<AppSupabase, "rpc">; centerId: string },
): Promise<UploadReceiptsResult> {
  const ids = [...new Set(paymentIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0) return { ok: true, queued: 0, skipped: paymentIds.length, note: paymentIds.length ? "None of the rows is a recorded payment." : null };
  const { data, error } = await ctx.db.rpc("email_receipts_for_uploaded", { p_center: ctx.centerId, p_payments: ids });
  if (error) return failure("Could not queue receipt emails for the uploaded donations", error);
  const d = (data ?? {}) as { queued?: unknown; skipped?: unknown; reason?: unknown };
  const queued = Number(d.queued) || 0;
  const skipped = (Number(d.skipped) || 0) + (paymentIds.length - ids.length);
  const reason = typeof d.reason === "string" && d.reason ? d.reason : null;
  return { ok: true, queued, skipped, note: reason ?? (skipped > 0 ? `${skipped} of the rows get no receipt (imported history, an opening balance, or not a payment that went through).` : null) };
}
