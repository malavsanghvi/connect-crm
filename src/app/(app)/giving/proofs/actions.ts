"use server";

import { revalidatePath } from "next/cache";

import { communityFormat } from "@/lib/community-format";
import { SIGNED_URL_SECONDS, signEvidencePaths } from "@/lib/data/payment-proofs";
import { failure, isStepUpError, type DbErrorLike } from "@/lib/errors";
import { approveArgs, decisionMessage, duplicateFromError, isUuid, parseDecision, plainDbSentence, reasonProblem, type ApproveInput, type DecisionState } from "@/lib/payment-proofs/decide";
import type { Lookalike } from "@/lib/payment-proofs/queue";
import { authorizeAction } from "@/lib/session";
import { formatCents } from "@/lib/money";

// Giving > Payment proofs: the four decisions on a member's proof. Every write is an app.* function (migration 0866) that checks who
// the caller is, and the database refuses what the screen does not: your own household's proof, a second approval by the same person,
// a lookalike payment without a reason. The answer is always shown next to what the person did; the technical detail is logged here.

export type ProofResult =
  | { ok: true; message: string; state: DecisionState }
  | { ok: false; error: string; stepUp?: boolean; /** The lookalike payments the database found (SQLSTATE CCDUP): the screen asks merge or different gift. */ lookalikes?: Lookalike[] };

const PATHS = ["/giving/proofs", "/giving", "/"];
function refresh() {
  for (const p of PATHS) revalidatePath(p);
}

/** One failure: the database's own plain sentence when it wrote one, else the portal's explanation. The detail is logged either way. */
function proofFailure(doing: string, error: DbErrorLike): ProofResult {
  const base = failure(doing, error);
  const own = plainDbSentence(error);
  if (own && !isStepUpError(error)) return { ok: false, error: `${doing} — ${own}` };
  return base.stepUp ? { ok: false, error: base.error, stepUp: true } : { ok: false, error: base.error };
}

const NOT_SENT = "Nothing was changed.";

export async function approveProofAction(input: ApproveInput): Promise<ProofResult> {
  const doing = "Could not approve the proof";
  const auth = await authorizeAction("recordPayment", "approve the payment proof");
  if (!auth.ok) return auth;
  const built = approveArgs(input);
  if (!built.ok) return { ok: false, error: `${doing} — ${built.error} ${NOT_SENT}` };
  const { session } = auth;
  const res = await session.db.rpc("approve_payment_proof", built.args);
  if (res.error) {
    const dup = duplicateFromError(res.error);
    if (dup) {
      console.error("[giving/proofs] approve stopped by a lookalike payment:", res.error.details);
      return {
        ok: false,
        error: "Could not approve the proof — this family already has a lookalike of this payment. Keep the photos with it, or say why this is a different gift.",
        lookalikes: dup,
      };
    }
    return proofFailure(doing, res.error);
  }
  const decision = parseDecision(res.data);
  if (!decision) {
    console.error("[giving/proofs] unexpected answer from approve_payment_proof:", res.data);
    return { ok: false, error: `${doing} — the answer was not in the expected shape. Reload the page to see whether it went through.` };
  }
  const fmt = communityFormat(session.center);
  refresh();
  return {
    ok: true,
    state: decision.state,
    message: decisionMessage(decision, { reconciled: Boolean(built.args.p_bank_txn) && decision.state === "approved", money: (c) => formatCents(c, fmt.currency, fmt.locale) }),
  };
}

export async function rejectProofAction(proofId: string, reason: string): Promise<ProofResult> {
  const doing = "Could not reject the proof";
  const auth = await authorizeAction("recordPayment", "reject the payment proof");
  if (!auth.ok) return auth;
  if (!isUuid(proofId)) return { ok: false, error: `${doing} — that proof was not recognised. Reload the page and try again.` };
  const bad = reasonProblem(reason, "reject");
  if (bad) return { ok: false, error: `${doing} — ${bad} ${NOT_SENT}` };
  const res = await auth.session.db.rpc("reject_payment_proof", { p_proof: proofId, p_reason: reason.trim() });
  if (res.error) return proofFailure(doing, res.error);
  const decision = parseDecision(res.data);
  if (!decision) {
    console.error("[giving/proofs] unexpected answer from reject_payment_proof:", res.data);
    return { ok: false, error: `${doing} — the answer was not in the expected shape. Reload the page to see whether it went through.` };
  }
  refresh();
  return { ok: true, state: decision.state, message: decisionMessage(decision, { reconciled: false, money: () => "" }) };
}

export async function askProofAction(proofId: string, question: string): Promise<ProofResult> {
  const doing = "Could not send the question";
  const auth = await authorizeAction("recordPayment", "ask about the payment proof");
  if (!auth.ok) return auth;
  if (!isUuid(proofId)) return { ok: false, error: `${doing} — that proof was not recognised. Reload the page and try again.` };
  const bad = reasonProblem(question, "ask");
  if (bad) return { ok: false, error: `${doing} — ${bad} ${NOT_SENT}` };
  const res = await auth.session.db.rpc("ask_proof_question", { p_proof: proofId, p_question: question.trim() });
  if (res.error) return proofFailure(doing, res.error);
  const decision = parseDecision(res.data);
  if (!decision) {
    console.error("[giving/proofs] unexpected answer from ask_proof_question:", res.data);
    return { ok: false, error: `${doing} — the answer was not in the expected shape. Reload the page to see whether it went through.` };
  }
  refresh();
  return { ok: true, state: decision.state, message: decisionMessage(decision, { reconciled: false, money: () => "" }) };
}

export type SignedFiles = { ok: true; urls: Record<string, string>; seconds: number; partial: string | null } | { ok: false; error: string };

/**
 * New 10-minute links for the files of one proof (a card past the first few, or links that have expired). The files are read with the
 * caller's own session, so the database decides whether this person may see them: a proof the person cannot read returns nothing.
 */
export async function signProofFilesAction(proofId: string): Promise<SignedFiles> {
  const doing = "Could not open the proof files";
  const auth = await authorizeAction("payments", "open the payment proof files");
  if (!auth.ok) return auth;
  if (!isUuid(proofId)) return { ok: false, error: `${doing} — that proof was not recognised. Reload the page and try again.` };
  const { db } = auth.session;
  const rows = await db.from("payment_proof_files").select("id, storage_path, deleted_at").eq("proof_id", proofId);
  if (rows.error) return { ok: false, error: failure(doing, rows.error).error };
  const paths = (rows.data ?? []).filter((r) => !r.deleted_at && r.storage_path).map((r) => r.storage_path as string);
  if (paths.length === 0) return { ok: false, error: `${doing} — you don't have access to this proof's files, or they were removed.` };
  const signed = await signEvidencePaths(db, paths);
  if (signed.urls.size === 0) return { ok: false, error: signed.error ?? `${doing} — no link could be made. Try again.` };
  const urls: Record<string, string> = {};
  for (const [path, url] of signed.urls) urls[path] = url;
  return { ok: true, urls, seconds: SIGNED_URL_SECONDS, partial: signed.error };
}
