"use server";

import { revalidatePath } from "next/cache";

import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { decisionFromForm, decisionMessage } from "@/lib/matching/decision";
import { programFromForm } from "@/lib/matching/directory";
import { matchingCan } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeActionWhere, dbWithReason } from "@/lib/session";

// Gift matching (CatchTheMatch slice 2, migrations 0765-0767). Every write goes through a database function that checks who
// may again (never a platform admin as such: 0757) and answers in plain English. Not recorded in the activity stream:
// CatchTheMatch is the organization's own data (docs/CATCH_THE_MATCH.md section 6).

function revalidateMatching() {
  revalidatePath("/giving/matching");
}

/** Staff send what a member told them about an employer's program (matching.view or matching.manage). */
export async function submitProgramAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const programId = String(fd.get("program_id") ?? "");
  if (programId && !isUuid(programId)) return { ok: false, error: "Could not send it — the directory entry was not found. Reload the page and try again." };
  const parsed = programFromForm(fd, "community");
  if (!parsed.ok) return { ok: false, error: `Could not send it — ${parsed.error[0].toLowerCase()}${parsed.error.slice(1)}` };
  const note = String(fd.get("note") ?? "").trim();
  if (note.length > 1000) return { ok: false, error: "Could not send it — the note can be at most 1000 characters." };
  const auth = await authorizeActionWhere((s) => matchingCan(s, "view"), "send it", "matching.view or matching.manage");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, "Sent to the gift matching directory");
  const { error } = await db.rpc("submit_match_program", {
    p_center: auth.session.center.id,
    // A company not in the directory yet: no entry (the generated type has no null for an argument without a default).
    p_program: programId || (null as unknown as string),
    p_proposal: parsed.facts as unknown as Json,
    p_note: note || undefined,
  });
  if (error) return failure("Could not send it to the gift matching directory", error);
  revalidateMatching();
  return { ok: true, message: "Sent. A CatchTheMatch manager checks it before it reaches the directory." };
}

/** A CatchTheMatch manager approves, rejects or marks a duplicate (app.decide_match_submission). */
export async function decideSubmissionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = decisionFromForm(fd);
  if (!parsed.ok) return { ok: false, error: `Could not decide — ${parsed.error}` };
  const auth = await authorizeActionWhere((s) => matchingCan(s, "manage"), "decide", "matching.manage");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, parsed.args.p_reason ?? "Decided a gift matching submission");
  const { data, error } = await db.rpc("decide_match_submission", { ...parsed.args, p_program: parsed.args.p_program as unknown as Json | undefined });
  if (error) return failure("Could not decide on the submission", error);
  revalidateMatching();
  const status = (data as { status?: unknown } | null)?.status;
  return { ok: true, message: decisionMessage(typeof status === "string" ? status : "", "community") };
}

/** A CatchTheMatch manager confirms the directory entry an employer on file is (app.link_match_program). */
export async function linkProgramAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const personId = String(fd.get("person_id") ?? "");
  const programId = String(fd.get("program_id") ?? "");
  const firstName = String(fd.get("first_name") ?? "").trim().slice(0, 80) || "this person";
  if (!isUuid(personId) || !isUuid(programId)) return { ok: false, error: "Could not link the employer — the person or the entry was not found. Reload the page and try again." };
  const auth = await authorizeActionWhere((s) => matchingCan(s, "manage"), "link the employer", "matching.manage");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, "Linked to the gift matching directory");
  const { error } = await db.rpc("link_match_program", { p_center: auth.session.center.id, p_person: personId, p_program: programId });
  if (error) return failure("Could not link the employer to the directory entry", error);
  revalidateMatching();
  revalidatePath("/households");
  revalidatePath(`/people/${personId}`);
  return { ok: true, message: `Linked. ${firstName}'s employer is now this directory entry.` };
}

export async function unlinkProgramAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const personId = String(fd.get("person_id") ?? "");
  if (!isUuid(personId)) return { ok: false, error: "Could not remove the link — the person was not found. Reload the page and try again." };
  const auth = await authorizeActionWhere((s) => matchingCan(s, "manage"), "remove the link", "matching.manage");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, "Link to the gift matching directory removed");
  const { data, error } = await db.rpc("unlink_match_program", { p_center: auth.session.center.id, p_person: personId });
  if (error) return failure("Could not remove the link to the directory entry", error);
  revalidateMatching();
  revalidatePath("/households");
  revalidatePath(`/people/${personId}`);
  if (data !== true) return { ok: false, error: "Could not remove the link — there was none any more. Reload the page." };
  return { ok: true, message: "Link removed. The employer on file stays as it is." };
}
