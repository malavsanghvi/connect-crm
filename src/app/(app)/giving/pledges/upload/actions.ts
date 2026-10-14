"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { rpcJson } from "@/lib/commands/catalog/db";
import { CommandDbError } from "@/lib/commands/types";
import { pledgeLookups, sameFileUpload, uploadSetting } from "@/lib/data/giving-upload";
import { failure, type ActionResult } from "@/lib/errors";
import { lookupValues, readPledgeLines, checkUploadRows, type PledgeLookups, type PledgeUploadRow, type ReadPledges } from "@/lib/giving-upload/pledges";
import { MAX_UPLOAD_ROWS, isSha256, isUploadKey, type UploadSource, type UploadTable } from "@/lib/giving-upload/sheet";
import { isModuleEnabled, moduleOffMessage } from "@/lib/modules";
import { formatCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// Upload pledges (GV-U slice B; NEEDS OWNER OK). giving.manage, as recording one pledge by hand. The file is read in the browser;
// its rows come here to be looked up (prepare), the person reviews and confirms, and the confirmed rows are recorded in ONE database
// call (app.record_pledge_upload, 0776): all or nothing, once per confirmation, each row through the rules of recording a pledge by
// hand. No money moves. The whole upload can be cancelled while nothing is paid against it.

export type FileForReview = { fileName: string; source: UploadSource; sha256: string | null; headers: string[]; rows: { line: number; cells: string[] }[] };
export type PreparedPledges = { read: ReadPledges; lookups: PledgeLookups; sameFile: { createdAt: string; rowCount: number } | null };

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

/** Look the file's rows up: households by any identifier, the funds and campaigns, the adults, and pledges already recorded. */
export async function preparePledgeUploadAction(input: FileForReview): Promise<ActionResult<PreparedPledges>> {
  const auth = await authorizeAction("recordPledge", "check the file");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", session.center.name) };
  const table = tableOf(input);
  if (!table) return { ok: false, error: `Could not check the file — it could not be read as rows (at most ${MAX_UPLOAD_ROWS}). Choose the file again.` };
  const s = uploadSetting(session);
  const read = readPledgeLines(table, s.conv, s.today, { household: s.household });
  try {
    const days = read.lines.map((l) => l.pledgedOn).filter((d): d is string => !!d);
    const [lookups, sameFile] = await Promise.all([
      pledgeLookups(session, read.fileProblems.length > 0 ? [] : lookupValues(read.lines), days),
      isSha256(input.sha256) ? sameFileUpload(session, "pledges", input.sha256) : Promise.resolve(null),
    ]);
    return { ok: true, data: { read, lookups, sameFile } };
  } catch (error) {
    return failure("Could not check the file", error instanceof CommandDbError ? error.dbError : error);
  }
}

/** `sendEmails`: the box "Email each family their pledge" (0793); on unless it is false. */
export type RecordPledgeUploadInput = { key: string; fileName: string; sha256: string | null; reason: string; rows: PledgeUploadRow[]; sendEmails?: boolean };
export type RecordedPledgeUpload = {
  uploadId: string;
  replayed: boolean;
  count: number;
  totalCents: number;
  /** The families were to be emailed their pledge (the box was ticked, and it is not a replay). */
  emails: boolean;
  pledges: { row: number; pledgeId: string; pledgeNumber: string | null; householdId: string; amountCents: number; dueOn: string | null }[];
};

export async function recordPledgeUploadAction(input: RecordPledgeUploadInput): Promise<ActionResult<RecordedPledgeUpload>> {
  return withActivity("giving.upload_pledges", () => recordUpload(input));
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function recordUpload(input: RecordPledgeUploadInput): Promise<ActionResult<RecordedPledgeUpload>> {
  const auth = await authorizeAction("recordPledge", "record the pledges");
  if (!auth.ok) return auth;
  const { session } = auth;
  const { center } = session;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", center.name) };
  if (!isUploadKey(input?.key)) return { ok: false, error: "Could not record the pledges — check the file again, so that it cannot be recorded twice." };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) return { ok: false, error: 'Could not record the pledges — say why they are recorded (for example "Pledge cards from the annual dinner"). It shows in each family\'s History.' };
  if (reason.length > 500) return { ok: false, error: "Could not record the pledges — keep the reason to 500 characters or fewer." };
  const s = uploadSetting(session);
  const rows = checkUploadRows(input.rows, s.today);
  if (!rows.ok) return { ok: false, error: `Could not record the pledges — ${rows.error[0].toLowerCase()}${rows.error.slice(1)}` };
  let j: Record<string, unknown> | null;
  try {
    j = (await rpcJson(
      session.db,
      "record_pledge_upload",
      {
        p_center: center.id,
        p_idempotency_key: input.key,
        p_file_name: typeof input.fileName === "string" ? input.fileName.slice(0, 200) : null,
        p_file_sha256: isSha256(input.sha256) ? input.sha256 : null,
        p_reason: reason,
        p_rows: rows.value,
        p_send_emails: input.sendEmails !== false,
      },
      "record the pledges",
    )) as Record<string, unknown> | null;
  } catch (error) {
    return failure("Could not record the pledges. Nothing was recorded", error instanceof CommandDbError ? error.dbError : error);
  }
  const uploadId = str(j?.upload_id);
  if (!j || !uploadId) {
    return { ok: false, error: "The pledges may not have been recorded: the database did not say. Open Pledges to check before trying again." };
  }
  const list = Array.isArray(j.pledges) ? (j.pledges as Record<string, unknown>[]) : [];
  const data: RecordedPledgeUpload = {
    uploadId,
    replayed: j.replayed === true,
    count: Number(j.count ?? list.length),
    totalCents: Number(j.total_cents ?? 0),
    // A replay queues nothing again; a first recording emails unless the box was unticked.
    emails: j.replayed === true ? false : j.emails !== false,
    pledges: list.map((p) => ({
      row: Number(p.row),
      pledgeId: str(p.pledge_id) ?? "",
      pledgeNumber: str(p.pledge_number),
      householdId: str(p.household_id) ?? "",
      amountCents: Number(p.amount_cents ?? 0),
      dueOn: str(p.due_on),
    })),
  };
  revalidatePath("/giving/pledges");
  revalidatePath("/giving/pledges/upload");
  revalidatePath("/giving");
  const money = formatCents(data.totalCents, s.currency, s.locale);
  const numbers = data.pledges.map((p) => p.pledgeNumber).filter((n): n is string => !!n);
  const range = numbers.length > 1 ? ` (${numbers[0]} to ${numbers[numbers.length - 1]})` : numbers.length === 1 ? ` (${numbers[0]})` : "";
  return {
    ok: true,
    data,
    message: data.replayed
      ? `This upload was already recorded: ${data.count} ${data.count === 1 ? "pledge" : "pledges"}, ${money}. Nothing was added.`
      : `Recorded ${data.count} ${data.count === 1 ? "pledge" : "pledges"}${range}, ${money}.`,
  };
}

export async function cancelPledgeUploadAction(input: { uploadId: string; reason: string }): Promise<ActionResult<{ cancelled: number }>> {
  return withActivity("giving.cancel_pledge_upload", () => cancelUpload(input));
}

async function cancelUpload(input: { uploadId: string; reason: string }): Promise<ActionResult<{ cancelled: number }>> {
  const auth = await authorizeAction("recordPledge", "cancel the upload");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", session.center.name) };
  if (!isUuid(input?.uploadId ?? "")) return { ok: false, error: "Could not cancel the upload — it was not found. Reload the page." };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3) return { ok: false, error: "Could not cancel the upload — say why. It shows in each family's History." };
  let j: Record<string, unknown> | null;
  try {
    j = (await rpcJson(
      session.db,
      "cancel_pledge_upload",
      { p_center: session.center.id, p_upload: input.uploadId, p_reason: reason.slice(0, 500) },
      "cancel the upload",
    )) as Record<string, unknown> | null;
  } catch (error) {
    return failure("Could not cancel the upload. Nothing was cancelled", error instanceof CommandDbError ? error.dbError : error);
  }
  const n = Number(j?.cancelled ?? 0);
  revalidatePath("/giving/pledges");
  revalidatePath("/giving/pledges/upload");
  revalidatePath("/giving");
  return {
    ok: true,
    data: { cancelled: n },
    message: j?.already === true ? "This upload was already cancelled. Nothing changed." : `Cancelled the upload: ${n} ${n === 1 ? "pledge" : "pledges"} cancelled.`,
  };
}
