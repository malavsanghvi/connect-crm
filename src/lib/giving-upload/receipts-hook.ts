// The donations upload calls this after its rows are saved (owner rule 2026-10-13: no receipt is emailed on upload; the automatic
// emails stream adds "email receipts for uploaded donations too" under a receipt switch that is off by default).
//
// TODO(GV-U · automatic emails 0770): when feat/comms-auto-emails is merged, replace this file's body with
//   export { onDonationsUploaded } from "@/lib/automatic-emails/hooks";
// The signature is the same. Until then it sends nothing and says so.

import type { AppSupabase } from "@/lib/supabase/server";

export type UploadReceiptsResult =
  | { ok: true; queued: number; skipped: number; /** Why nothing (or not everything) was queued, in plain English. */ note: string | null }
  | { ok: false; error: string };

export async function onDonationsUploaded(
  paymentIds: readonly string[],
  ctx: { db: Pick<AppSupabase, "rpc">; centerId: string },
): Promise<UploadReceiptsResult> {
  void ctx;
  return { ok: true, queued: 0, skipped: paymentIds.length, note: "No receipts were emailed for these payments." };
}
