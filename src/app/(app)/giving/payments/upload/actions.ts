"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { rpcJson } from "@/lib/commands/catalog/db";
import { CommandDbError } from "@/lib/commands/types";
import { donationLookups, sameFileUpload, uploadSetting } from "@/lib/data/giving-upload";
import { failure, type ActionResult } from "@/lib/errors";
import { checkDonationRows, readDonationLines, type DonationLookups, type DonationUploadRow, type ReadDonations } from "@/lib/giving-upload/donations";
import { onDonationsUploaded } from "@/lib/giving-upload/receipts-hook";
import { MAX_UPLOAD_ROWS, isSha256, isUploadKey, type UploadTable } from "@/lib/giving-upload/sheet";
import { isModuleEnabled, moduleOffMessage } from "@/lib/modules";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { authorizeAction } from "@/lib/session";

import type { FileForReview } from "../../pledges/upload/actions";

// Upload donations (GV-U slice C; NEEDS OWNER OK: a bulk way to record money). Whoever may record a payment by hand may upload them
// (giving.record_offline or giving.manage, owner rule 2026-10-13); applying to pledges needs giving.manage, and without it every row
// is recorded and not applied, as the Record payment sheet does. The file is read in the browser; its rows come here to be looked up;
// the confirmed rows are recorded in ONE database call (app.record_donation_upload, 0777), each through
// app.record_offline_payment_once (0658): all or nothing, once per confirmation. No undo (a refund a second person approves fixes a
// wrong row). No receipt is emailed by the upload (onDonationsUploaded).

export type PreparedDonations = { read: ReadDonations; lookups: DonationLookups; sameFile: { createdAt: string; rowCount: number } | null };

const CELL_MAX = 1000;

function tableOf(input: FileForReview | null | undefined): UploadTable | null {
  if (!input || typeof input.fileName !== "string" || (input.source !== "csv" && input.source !== "xlsx")) return null;
  if (!Array.isArray(input.headers) || !Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > MAX_UPLOAD_ROWS) return null;
  const clean = (v: unknown) => (typeof v === "string" ? v.slice(0, CELL_MAX) : "");
  const rows: UploadTable["rows"] = [];
  for (const r of input.rows) {
    if (!r || !Number.isInteger(r.line) || !Array.isArray(r.cells) || r.cells.length > 100) return null;
    rows.push({ line: r.line, cells: r.cells.map(clean) });
  }
  return { fileName: input.fileName.slice(0, 200), source: input.source, headers: input.headers.slice(0, 100).map(clean), rows };
}

export async function prepareDonationUploadAction(input: FileForReview): Promise<ActionResult<PreparedDonations>> {
  const auth = await authorizeAction("recordPayment", "check the file");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", session.center.name) };
  const table = tableOf(input);
  if (!table) return { ok: false, error: `Could not check the file — it could not be read as rows (at most ${MAX_UPLOAD_ROWS}). Choose the file again.` };
  const s = uploadSetting(session);
  const read = readDonationLines(table, s.conv, s.today, { household: s.household });
  try {
    const [lookups, sameFile] = await Promise.all([
      donationLookups(session, read.fileProblems.length > 0 ? { ...read, lines: [] } : read),
      isSha256(input.sha256) ? sameFileUpload(session, "payments", input.sha256) : Promise.resolve(null),
    ]);
    return { ok: true, data: { read, lookups, sameFile } };
  } catch (error) {
    return failure("Could not check the file", error instanceof CommandDbError ? error.dbError : error);
  }
}

export type RecordDonationUploadInput = { key: string; fileName: string; sha256: string | null; reason: string; rows: DonationUploadRow[] };
export type RecordedDonationUpload = {
  uploadId: string;
  replayed: boolean;
  count: number;
  totalCents: number;
  notApplied: number | null;
  receipts: string;
  payments: { row: number; paymentId: string; receiptNumber: string | null; householdId: string; amountCents: number; appliedCents: number }[];
};

export async function recordDonationUploadAction(input: RecordDonationUploadInput): Promise<ActionResult<RecordedDonationUpload>> {
  return withActivity("giving.upload_donations", () => recordUpload(input));
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function recordUpload(input: RecordDonationUploadInput): Promise<ActionResult<RecordedDonationUpload>> {
  const auth = await authorizeAction("recordPayment", "record the payments");
  if (!auth.ok) return auth;
  const { session } = auth;
  const { center } = session;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", center.name) };
  if (!isUploadKey(input?.key)) return { ok: false, error: "Could not record the payments — check the file again, so that it cannot be recorded twice." };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) return { ok: false, error: 'Could not record the payments — say why they are recorded (for example "Sunday collection checks").' };
  if (reason.length > 500) return { ok: false, error: "Could not record the payments — keep the reason to 500 characters or fewer." };
  const s = uploadSetting(session);
  const rows = checkDonationRows(input.rows, s.today);
  if (!rows.ok) return { ok: false, error: `Could not record the payments — ${rows.error[0].toLowerCase()}${rows.error.slice(1)}` };
  let j: Record<string, unknown> | null;
  try {
    j = (await rpcJson(
      session.db,
      "record_donation_upload",
      {
        p_center: center.id,
        p_idempotency_key: input.key,
        p_file_name: typeof input.fileName === "string" ? input.fileName.slice(0, 200) : null,
        p_file_sha256: isSha256(input.sha256) ? input.sha256 : null,
        p_reason: reason,
        p_rows: rows.value,
      },
      "record the payments",
    )) as Record<string, unknown> | null;
  } catch (error) {
    return failure("Could not record the payments. Nothing was recorded", error instanceof CommandDbError ? error.dbError : error);
  }
  const uploadId = str(j?.upload_id);
  if (!j || !uploadId) {
    return { ok: false, error: "The payments may not have been recorded: the database did not say. Open Payments to check before trying again." };
  }
  const list = Array.isArray(j.payments) ? (j.payments as Record<string, unknown>[]) : [];
  const payments = list.map((p) => ({
    row: Number(p.row),
    paymentId: str(p.payment_id) ?? "",
    receiptNumber: str(p.receipt_number),
    householdId: str(p.household_id) ?? "",
    amountCents: Number(p.amount_cents ?? 0),
    appliedCents: Number(p.applied_cents ?? 0),
  }));
  // No receipt is emailed by the upload unless the community switched on receipts for uploaded donations (automatic emails, 0770).
  // Queuing them needs giving.manage (app.email_receipts_for_uploaded); a volunteer's upload is told so instead of an error.
  let receiptsSentence: string;
  if (!canAccess(session, "givingManage")) {
    receiptsSentence = "No receipts were emailed: receipts for uploaded donations are sent from a treasurer's upload.";
  } else {
    const receipts = await onDonationsUploaded(
      payments.map((p) => p.paymentId),
      { db: session.db, centerId: center.id },
    );
    receiptsSentence = receipts.ok
      ? receipts.queued > 0
        ? `${receipts.queued} receipt ${receipts.queued === 1 ? "email was" : "emails were"} queued.${receipts.note ? ` ${receipts.note}` : ""}`
        : (receipts.note ?? "No receipts were emailed.")
      : `The payments are recorded, but ${receipts.error[0].toLowerCase()}${receipts.error.slice(1)}`;
  }
  const notApplied = typeof j.not_applied === "number" ? j.not_applied : null;
  const data: RecordedDonationUpload = {
    uploadId,
    replayed: j.replayed === true,
    count: Number(j.count ?? payments.length),
    totalCents: Number(j.total_cents ?? 0),
    notApplied,
    receipts: receiptsSentence,
    payments,
  };
  revalidatePath("/giving/payments");
  revalidatePath("/giving/payments/upload");
  revalidatePath("/giving/pledges");
  revalidatePath("/giving");
  const money = formatCents(data.totalCents, s.currency, s.locale);
  const word = data.count === 1 ? "payment" : "payments";
  const applied = payments.reduce((sum, p) => sum + p.appliedCents, 0);
  return {
    ok: true,
    data,
    message: data.replayed
      ? `This upload was already recorded: ${data.count} ${word}, ${money}. Nothing was added.`
      : `Recorded ${data.count} ${word}, ${money}; ${formatCents(applied, s.currency, s.locale)} applied to pledges.${notApplied ? ` ${notApplied} ${notApplied === 1 ? "is" : "are"} recorded but not applied: a treasurer can apply ${notApplied === 1 ? "it" : "them"}.` : ""}`,
  };
}
