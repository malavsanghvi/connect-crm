"use server";

import { revalidatePath } from "next/cache";

import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { CLAIM_STATE_LABEL, isClaimState } from "@/lib/matching/catch";
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
  const result = (data ?? {}) as { status?: unknown; because?: unknown };
  return {
    ok: true,
    message: decisionMessage(typeof result.status === "string" ? result.status : "", "community", typeof result.because === "string" ? result.because : null),
  };
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

// ── Phase 1 (0886-0888): claims ──────────────────────────────────────────────

function revalidateClaims() {
  revalidatePath("/giving/matching/catch");
  revalidatePath("/giving/matching/claims");
  revalidatePath("/giving/matching/employers");
}

/** Records "asked" for every gift of a member that can still be claimed (app.ask_match_claims). */
export async function askClaimsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const personId = String(fd.get("person_id") ?? "");
  const programId = String(fd.get("program_id") ?? "");
  const firstName = String(fd.get("first_name") ?? "").trim().slice(0, 80) || "this member";
  if (!isUuid(personId) || !isUuid(programId)) return { ok: false, error: "Could not record the request — the member or the program was not found. Reload the page and try again." };
  const note = String(fd.get("note") ?? "").trim();
  if (note.length > 500) return { ok: false, error: "Could not record the request — the note can be at most 500 characters." };
  const auth = await authorizeActionWhere((s) => matchingCan(s, "manage"), "record the request", "matching.manage");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, "Asked a member to claim a gift match");
  const { data, error } = await db.rpc("ask_match_claims", { p_center: auth.session.center.id, p_person: personId, p_program: programId, p_note: note || undefined });
  if (error) return failure("Could not record the request", error);
  revalidateClaims();
  const asked = typeof (data as { asked?: unknown } | null)?.asked === "number" ? (data as { asked: number }).asked : 1;
  return { ok: true, message: `Recorded. ${firstName}'s ${asked === 1 ? "gift is" : `${asked} gifts are`} now under Claims as asked.` };
}

/** Moves a claim on, closes it, or opens it again (app.set_match_claim_state). */
export async function setClaimStateAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const claimId = String(fd.get("claim_id") ?? "");
  const state = String(fd.get("state") ?? "");
  if (!isUuid(claimId)) return { ok: false, error: "Could not update the claim — it was not found. Reload the page and try again." };
  if (!isClaimState(state)) return { ok: false, error: "Could not update the claim — choose where it stands." };
  const note = String(fd.get("note") ?? "").trim();
  if (note.length > 500) return { ok: false, error: "Could not update the claim — the note can be at most 500 characters." };
  const auth = await authorizeActionWhere((s) => matchingCan(s, "manage"), "update the claim", "matching.manage");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, `Gift match claim: ${CLAIM_STATE_LABEL[state]}`);
  const { error } = await db.rpc("set_match_claim_state", { p_center: auth.session.center.id, p_claim: claimId, p_state: state, p_note: note || undefined });
  if (error) return failure("Could not update the claim", error);
  revalidateClaims();
  return { ok: true, message: `Updated: ${CLAIM_STATE_LABEL[state].toLowerCase()}.` };
}

/** Records a claim the office already knows about, such as the first match an employer paid (app.record_match_claim). */
export async function recordClaimAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const personId = String(fd.get("person_id") ?? "");
  const paymentId = String(fd.get("payment_id") ?? "");
  const state = String(fd.get("state") ?? "received");
  if (!isUuid(personId)) return { ok: false, error: "Could not record the claim — the person was not found. Reload the page and try again." };
  if (!isUuid(paymentId)) return { ok: false, error: "Could not record the claim — choose the gift." };
  if (!["asked", "requested", "verified", "received"].includes(state)) return { ok: false, error: "Could not record the claim — choose where it stands." };
  const day = String(fd.get("received_on") ?? "").trim();
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "Could not record the claim — the day must look like 2026-10-17." };
  const note = String(fd.get("note") ?? "").trim();
  if (note.length > 500) return { ok: false, error: "Could not record the claim — the note can be at most 500 characters." };
  const auth = await authorizeActionWhere((s) => matchingCan(s, "manage"), "record the claim", "matching.manage");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, "Recorded a gift match claim");
  const { error } = await db.rpc("record_match_claim", {
    p_center: auth.session.center.id,
    p_person: personId,
    p_payment: paymentId,
    p_state: state,
    p_received_on: state === "received" && day ? day : undefined,
    p_note: note || undefined,
  });
  if (error) return failure("Could not record the claim", error);
  revalidateClaims();
  revalidatePath("/giving/matching/claims/record");
  return {
    ok: true,
    message: state === "received" ? "Recorded. This employer now counts as having paid here, so its other members show under To catch." : "Recorded under Claims.",
  };
}
