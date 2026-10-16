"use server";

import { EVIDENCE_BUCKET, logProofViews, signEvidencePaths } from "@/lib/data/payment-proofs";
import { readPublicEnv } from "@/lib/env";
import { failure, type ActionResult } from "@/lib/errors";
import { checkEvidenceFile, evidenceFilesFrom, evidenceObjectPath, type PaymentEvidenceFile } from "@/lib/payment-proofs/evidence-files";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// Evidence on a recorded payment (migration 0874): the family's proof files and the photos staff attach themselves (a check, a cash
// receipt). The database decides who may read, attach and remove (RLS and attach_payment_evidence / remove_payment_evidence_file);
// these actions only ask, and say in words what the database refused. A file is never sent through a Server Action: the browser
// uploads it straight to a signed address made here (a photo of a check can be 10 MB).

const NO_ACCESS = "You don't have access to this area.";

export type PaymentEvidenceView = { files: PaymentEvidenceFile[]; apiKey: string | null; notice: string | null };

/**
 * The files of one payment with links that last 10 minutes. Opening the section shows the files, so each shown file is noted in the
 * audit log (log_proof_view, 0872); a failure to note it is reported on the server and never hides a file.
 */
export async function loadPaymentEvidenceAction(paymentId: string): Promise<ActionResult<PaymentEvidenceView>> {
  const doing = "load the evidence";
  const auth = await authorizeAction("payments", doing);
  if (!auth.ok) return auth;
  if (!isUuid(paymentId)) return { ok: false, error: `Could not ${doing} — the payment was not found.` };
  const { db } = auth.session;
  const res = await db
    .from("payment_proof_files")
    .select("id, proof_id, storage_path, content_type, bytes, created_at, deleted_at, deleted_reason")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: true });
  if (res.error) {
    if (res.error.code === "42501") return { ok: false, error: NO_ACCESS };
    return failure(`Could not ${doing}`, res.error);
  }
  const rows = res.data ?? [];
  const signed = await signEvidencePaths(db, rows.filter((r) => !r.deleted_at).map((r) => r.storage_path));
  const files = evidenceFilesFrom(rows, signed.urls);
  await logProofViews(db, files.filter((f) => f.url).map((f) => f.id));
  const env = readPublicEnv();
  return { ok: true, data: { files, apiKey: env.ok ? env.env.supabaseAnonKey : null, notice: signed.error } };
}

export type EvidenceUploadTicket = { path: string; signedUrl: string; contentType: string; apiKey: string | null };

/** A signed address for one staff file of one payment. The file is checked here too (type, size, the 5-file limit), before any bytes move. */
export async function prepareEvidenceUploadAction(input: { paymentId: string; fileName: string; type: string; size: number }): Promise<ActionResult<EvidenceUploadTicket>> {
  const doing = "start the upload";
  const auth = await authorizeAction("recordPayment", doing);
  if (!auth.ok) return auth;
  const paymentId = String(input?.paymentId ?? "");
  if (!isUuid(paymentId)) return { ok: false, error: `Could not ${doing} — the payment was not found.` };
  const { db, center } = auth.session;
  const [pay, live] = await Promise.all([
    db.from("payments").select("id").eq("id", paymentId).eq("center_id", center.id).maybeSingle(),
    db.from("payment_proof_files").select("id", { count: "exact", head: true }).eq("payment_id", paymentId).is("proof_id", null).is("deleted_at", null),
  ]);
  if (pay.error) return failure(`Could not ${doing}`, pay.error);
  if (!pay.data) return { ok: false, error: `Could not ${doing} — that payment was not found, or you cannot see it.` };
  if (live.error) return failure(`Could not ${doing}`, live.error);
  const fileName = String(input?.fileName ?? "").slice(0, 300);
  const check = checkEvidenceFile({ name: fileName, type: String(input?.type ?? ""), size: Number(input?.size) }, live.count ?? 0);
  if (!check.ok) return { ok: false, error: `Could not ${doing} — ${check.error}` };

  const path = evidenceObjectPath(center.id, paymentId, crypto.randomUUID(), fileName, check.contentType);
  const signed = await db.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data) {
    const message = signed.error?.message ?? "";
    console.error(`[giving/payments] could not sign an upload to ${EVIDENCE_BUCKET}/${path}:`, signed.error);
    if (/bucket not found/i.test(message)) return { ok: false, error: `Could not ${doing} — the payment evidence storage area is not set up on this server yet. Ask Weaver to create it.` };
    if (/row-level security|unauthorized|permission/i.test(message)) {
      return { ok: false, error: `Could not ${doing} — storage refused it: attaching needs giving.record_offline or giving.manage, and Payment proofs must be switched on.` };
    }
    return failure(`Could not ${doing}`, signed.error ?? "storage did not answer");
  }
  const env = readPublicEnv();
  return { ok: true, data: { path: signed.data.path, signedUrl: signed.data.signedUrl, contentType: check.contentType, apiKey: env.ok ? env.env.supabaseAnonKey : null } };
}

/**
 * Keeps an uploaded file with the payment. When the database refuses, the uploaded bytes are deleted straight away (and, if that
 * fails too, the daily orphan clean-up removes them within three days); the refusal is shown in words.
 */
export async function attachEvidenceAction(input: { paymentId: string; path: string; contentType: string; bytes: number; sha256: string | null }): Promise<ActionResult> {
  const doing = "attach the file";
  const auth = await authorizeAction("recordPayment", doing);
  if (!auth.ok) return auth;
  const paymentId = String(input?.paymentId ?? "");
  const path = String(input?.path ?? "");
  if (!isUuid(paymentId) || !path) return { ok: false, error: `Could not ${doing} — the upload was not complete. Start again.` };
  const { db } = auth.session;
  const res = await db.rpc("attach_payment_evidence", {
    p_payment: paymentId,
    p_path: path,
    p_content_type: String(input.contentType ?? ""),
    p_bytes: Number(input.bytes),
    ...(input.sha256 ? { p_sha256: input.sha256 } : {}),
  });
  if (res.error) {
    const removed = await db.storage.from(EVIDENCE_BUCKET).remove([path]);
    if (removed.error) console.error(`[giving/payments] could not delete the unattached upload ${path}; the daily clean-up will:`, removed.error);
    return failure(`Could not ${doing}`, res.error);
  }
  return { ok: true, message: "File attached to the payment." };
}

/** Takes a staff file back (giving.manage, with a reason). The row stays as a record that it existed; the stored copy is deleted. */
export async function removeEvidenceFileAction(input: { fileId: string; reason: string }): Promise<ActionResult> {
  const doing = "remove the file";
  const auth = await authorizeAction("givingManage", doing);
  if (!auth.ok) return auth;
  const fileId = String(input?.fileId ?? "");
  if (!isUuid(fileId)) return { ok: false, error: `Could not ${doing} — the file was not found.` };
  const { db } = auth.session;
  const res = await db.rpc("remove_payment_evidence_file", { p_file: fileId, p_reason: String(input?.reason ?? "") });
  if (res.error) return failure(`Could not ${doing}`, res.error);
  const path = (res.data as { storage_path?: unknown } | null)?.storage_path;
  if (typeof path !== "string" || !path) {
    console.error("[giving/payments] remove_payment_evidence_file gave no path:", res.data);
    return { ok: true, message: "File removed from the payment. Its stored copy will be deleted by the daily clean-up." };
  }
  const gone = await db.storage.from(EVIDENCE_BUCKET).remove([path]);
  if (gone.error) {
    console.error(`[giving/payments] removed the record but could not delete ${path}; the daily clean-up will:`, gone.error);
    return { ok: true, message: "File removed from the payment. Its stored copy could not be deleted right now; the daily clean-up will delete it within three days." };
  }
  return { ok: true, message: "File removed from the payment." };
}
