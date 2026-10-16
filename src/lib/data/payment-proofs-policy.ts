import "server-only";

import type { Json } from "@/lib/database.types";
import { failure, type DbErrorLike } from "@/lib/errors";
import { plainDbSentence } from "@/lib/payment-proofs/decide";
import { parseProofPolicy, type ProofPolicy } from "@/lib/payment-proofs/policy";
import type { CrmSession } from "@/lib/session";

// Settings: the organization's payment-proof rules (migrations 0865 proof_policy and 0866 set_proof_policy). The database merges the
// patch over the rules already there, checks every value, and asks for a fresh 2FA code (SQLSTATE CCSTP) when the years are shortened.

export type PolicyRead = { ok: true; policy: ProofPolicy } | { ok: false; error: string; noAccess?: boolean };

export async function readProofPolicy(session: CrmSession): Promise<PolicyRead> {
  const res = await session.db.rpc("proof_policy", { p_center: session.center.id });
  if (res.error) {
    if (res.error.code === "42501") return { ok: false, error: "You don't have access to this area.", noAccess: true };
    return { ok: false, error: failure("Could not load the payment confirmation rules", res.error).error };
  }
  return { ok: true, policy: parseProofPolicy(res.data) };
}

export type PolicyWrite = { ok: true; policy: ProofPolicy } | { ok: false; error: string; stepUp?: boolean };

/** Writes a patch of the rules. A refusal the database worded itself is shown as it wrote it; the technical detail is logged. */
export async function writeProofPolicy(session: CrmSession, patch: Record<string, unknown>, reason: string | null, doing: string): Promise<PolicyWrite> {
  const args: { p_center: string; p_policy: Json; p_reason?: string } = { p_center: session.center.id, p_policy: patch as Json };
  if (reason && reason.trim()) args.p_reason = reason.trim().slice(0, 500);
  const res = await session.db.rpc("set_proof_policy", args);
  if (res.error) {
    const base = failure(doing, res.error);
    const own = plainDbSentence(res.error as DbErrorLike);
    if (own && !base.stepUp) return { ok: false, error: `${doing} — ${own}` };
    return base.stepUp ? { ok: false, error: base.error, stepUp: true } : { ok: false, error: base.error };
  }
  return { ok: true, policy: parseProofPolicy(res.data) };
}
